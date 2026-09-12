// ASCENDE — A máquina de estados do bloco "Aprendi sobre você" (correção quente).
//
// O que esta fase resolve: a pessoa lia "aprendi que você treina de manhã",
// via que estava torto, e tinha que sair da conversa, ir em Ajustes e caçar a
// linha para consertar. Agora ela corrige ou recusa ali mesmo, no balão em que
// o Conselheiro acabou de aprender.
//
// Por que a lógica mora AQUI e não dentro do componente: a linha tem seis
// situações (parada, editando, salvando, corrigida, recusada-com-desfazer,
// removida) e três delas dependem de tempo. Espalhado por `useState` isso vira
// um emaranhado que só dá para conferir clicando; num reducer puro dá para
// escrever o caso "a rede caiu no meio da recusa" e provar que a linha volta ao
// que era. Mesmo arranjo de memories.ts x memoriesData.ts: o que é regra fica
// testável sem rede nem navegador.
//
// Nada aqui toca o Supabase nem o relógio — o tempo entra por `tick`, em
// milissegundos, justamente para o teste não depender de esperar 8 segundos.

import { validateMemoryContent, type LearnedMemory } from "@/lib/memories";

/** Quanto tempo o "Desfazer" fica de pé depois de uma recusa. Oito segundos é
 *  o que a Prisma fechou: tempo de ler a linha mudar e se arrepender, sem
 *  deixar o balão da conversa preso na tela. */
export const UNDO_WINDOW_MS = 8000;

/** Os últimos instantes da janela são usados para o fade de saída. A linha já
 *  está indo embora aqui — se a transição travar, o pior que acontece é ela
 *  sumir sem suavidade, nunca uma linha invisível que continua ocupando o
 *  bloco (é a mesma preocupação da nota sobre `animate-fade-up` no
 *  tailwind.config.ts: animação não pode ter poder sobre o que existe). */
export const UNDO_FADE_MS = 400;

/** O que a linha está FAZENDO. O que já ACONTECEU com ela são os dois
 *  booleanos abaixo — separar os dois é o que evita ter que lembrar "para
 *  onde eu volto se cancelar", porque cancelar só mexe na fase. */
export type LearnedRowPhase = "parada" | "editando" | "salvando" | "removida";

/** Qual chamada está no ar. Importa no erro: cada uma volta para um lugar
 *  diferente. */
export type LearnedRowPending = "corrigir" | "recusar" | "desfazer" | null;

export interface LearnedRow {
  id: string;
  /** O texto que a linha mostra hoje — já com a correção, quando houve uma. */
  content: string;
  category: string;
  phase: LearnedRowPhase;
  /** A pessoa já reescreveu esta linha. Nunca volta a ser falso: corrigir e
   *  depois recusar e desfazer devolve a linha CORRIGIDA, não a original. */
  corrigida: boolean;
  /** Está dentro da janela de desfazer. */
  recusada: boolean;
  /** O que está no textarea. Só tem sentido em `editando`/`salvando`. */
  draft: string;
  /** Erro inline, sob o textarea ou sob a linha. Nunca vira toast: toast em
   *  cima do chat é uma segunda camada flutuante que este bloco não precisa. */
  error: string | null;
  pending: LearnedRowPending;
  /** Quanto sobra da janela de desfazer, em ms. Contagem REGRESSIVA em vez de
   *  um timestamp de quando recusou: é isso que deixa o timer pausar de graça
   *  (basta não descontar) quando a pessoa está editando outra linha. */
  undoLeftMs: number;
}

export interface LearnedBlockState {
  rows: LearnedRow[];
  /** Id da linha com o menu aberto; null = nenhum. Mora no estado, e não só
   *  dentro do Radix, porque duas regras dependem de saber que há um menu
   *  aberto: o timer do desfazer e o auto-dispensa do bloco. */
  menu: string | null;
}

/* ── Leitura: o que a linha mostra ────────────────────────────────────────
   Derivado, nunca guardado — um campo "outcome" gravado junto seria mais uma
   coisa para sair de sincronia com os booleanos. */

/** `intacta`: como a IA aprendeu · `corrigida`: com o texto da pessoa ·
 *  `recusada`: fora do retrato, ainda dá para desfazer. */
export type LearnedRowOutcome = "intacta" | "corrigida" | "recusada";

export function rowOutcome(row: LearnedRow): LearnedRowOutcome {
  if (row.recusada) return "recusada";
  return row.corrigida ? "corrigida" : "intacta";
}

/** A linha aceita menu (corrigir/recusar)? Só quando está parada e no
 *  retrato: recusada só oferece Desfazer, e quem está salvando não aceita uma
 *  segunda ordem por cima. */
export function rowAceitaMenu(row: LearnedRow): boolean {
  return row.phase === "parada" && !row.recusada;
}

/** Está nos últimos instantes da janela — hora de apagar suavemente. */
export function rowSaindo(row: LearnedRow): boolean {
  return row.phase === "parada" && row.recusada && row.undoLeftMs <= UNDO_FADE_MS;
}

/**
 * O bloco está congelado: tem menu aberto ou edição/salvamento em curso.
 *
 * Serve a duas coisas ao mesmo tempo, e é de propósito que seja a MESMA
 * pergunta: (1) o relógio do desfazer não corre — a pessoa que parou para
 * corrigir a linha de cima não pode perder a chance de desfazer a de baixo; e
 * (2) o bloco não se auto-dispensa por baixo de um formulário aberto.
 *
 * O X de dispensar NÃO consulta isto: dispensar é sempre saída.
 */
export function blocoCongelado(state: LearnedBlockState): boolean {
  if (state.menu) return true;
  return state.rows.some((r) => r.phase === "editando" || r.phase === "salvando");
}

/** Não sobrou linha nenhuma: as recusas venceram e o bloco não tem mais o que
 *  dizer. Quem renderiza usa isto para sumir com o bloco inteiro. */
export function blocoVazio(state: LearnedBlockState): boolean {
  return state.rows.length > 0 && state.rows.every((r) => r.phase === "removida");
}

/* ── A decisão de salvar uma correção ─────────────────────────────────────
   Fora do reducer porque quem chama precisa do texto limpo para mandar ao
   banco — e fora do componente porque "vazio", "igual ao que já estava" e
   "pode salvar" são três caminhos diferentes que merecem teste. */

export type CorrecaoKind = "invalido" | "sem-mudanca" | "salvar";

/** Sem união discriminada, pelo mesmo motivo de `MemoryContentCheck`: o
 *  projeto compila com `strict: false` e ali o TypeScript não estreita. */
export interface CorrecaoPedido {
  kind: CorrecaoKind;
  /** Texto limpo, pronto para o banco. Só confiável quando `kind` é "salvar". */
  content: string;
  /** Frase pronta para a tela. Só preenchido quando `kind` é "invalido". */
  error: string | null;
}

/**
 * O que fazer com o rascunho da linha.
 *
 * A mensagem de erro vem de `validateMemoryContent` e não é reescrita aqui: os
 * limites são os do CHECK de `ai_memories.content`, e ter duas frases para o
 * mesmo problema é como as telas começam a discordar entre si.
 *
 * "Igual ao que já estava" é caso próprio, e não um salvar inofensivo: gravar
 * promoveria a memória a `confirmada` sem a pessoa ter mudado nada — ou seja,
 * o app registraria uma confirmação que ela não deu.
 */
export function pedidoDeCorrecao(row: LearnedRow, raw: string): CorrecaoPedido {
  const check = validateMemoryContent(raw);
  if (!check.ok) {
    return { kind: "invalido", content: check.content, error: check.error };
  }
  if (check.content === row.content) {
    return { kind: "sem-mudanca", content: check.content, error: null };
  }
  return { kind: "salvar", content: check.content, error: null };
}

/* ── Estado inicial ───────────────────────────────────────────────────────── */

export function initLearnedBlock(items: LearnedMemory[]): LearnedBlockState {
  return {
    menu: null,
    rows: (items ?? []).map((m) => ({
      id: m.id,
      content: m.content,
      category: m.category,
      phase: "parada" as LearnedRowPhase,
      corrigida: false,
      recusada: false,
      draft: "",
      error: null,
      pending: null,
      undoLeftMs: 0,
    })),
  };
}

/* ── Ações ────────────────────────────────────────────────────────────────── */

export type LearnedBlockAction =
  | { type: "abrirMenu"; id: string }
  | { type: "fecharMenu" }
  | { type: "editar"; id: string }
  | { type: "rascunho"; id: string; draft: string }
  | { type: "cancelar"; id: string }
  | { type: "salvando"; id: string; acao: Exclude<LearnedRowPending, null> }
  | { type: "corrigido"; id: string; content: string }
  | { type: "recusado"; id: string }
  | { type: "desfeito"; id: string }
  | { type: "falhou"; id: string; error: string }
  | { type: "tick"; ms: number };

/** Troca UMA linha, preservando as outras por referência. */
function mapRow(
  state: LearnedBlockState, id: string, fn: (row: LearnedRow) => LearnedRow,
): LearnedBlockState {
  let mudou = false;
  const rows = state.rows.map((r) => {
    if (r.id !== id) return r;
    const next = fn(r);
    if (next !== r) mudou = true;
    return next;
  });
  return mudou ? { ...state, rows } : state;
}

export function learnedBlockReducer(
  state: LearnedBlockState, action: LearnedBlockAction,
): LearnedBlockState {
  switch (action.type) {
    case "abrirMenu": {
      const row = state.rows.find((r) => r.id === action.id);
      // Ignorar em vez de abrir um menu inútil: a linha recusada já mostra a
      // única ação que ainda faz sentido nela, que é Desfazer.
      if (!row || !rowAceitaMenu(row)) return state;
      return { ...state, menu: action.id };
    }

    case "fecharMenu":
      return state.menu === null ? state : { ...state, menu: null };

    case "editar": {
      const row = state.rows.find((r) => r.id === action.id);
      if (!row || !rowAceitaMenu(row)) return state;
      // O campo abre com o texto ATUAL dentro: é correção, não redação em
      // branco — quem toca em "Corrigir" quer mexer numa frase que já existe.
      return mapRow({ ...state, menu: null }, action.id, (r) => ({
        ...r, phase: "editando", draft: r.content, error: null, pending: null,
      }));
    }

    case "rascunho":
      return mapRow(state, action.id, (r) => {
        if (r.phase !== "editando") return r;
        // Digitar limpa o erro: a pessoa está justamente consertando o que a
        // mensagem apontou, e deixar a frase vermelha ali só a acusa de novo.
        return { ...r, draft: action.draft, error: null };
      });

    case "cancelar":
      return mapRow(state, action.id, (r) => {
        if (r.phase !== "editando") return r;
        // Só a FASE volta. `corrigida` fica onde está, então cancelar a
        // segunda correção devolve a linha com a primeira, e não com o texto
        // original da IA.
        return { ...r, phase: "parada", draft: "", error: null };
      });

    case "salvando":
      return mapRow({ ...state, menu: null }, action.id, (r) => {
        if (r.phase === "removida") return r;
        return { ...r, phase: "salvando", pending: action.acao, error: null };
      });

    case "corrigido":
      return mapRow(state, action.id, (r) => {
        if (r.phase !== "salvando") return r;
        return {
          ...r, phase: "parada", content: action.content, corrigida: true,
          draft: "", error: null, pending: null,
        };
      });

    case "recusado":
      return mapRow(state, action.id, (r) => {
        if (r.phase !== "salvando") return r;
        return {
          ...r, phase: "parada", recusada: true, undoLeftMs: UNDO_WINDOW_MS,
          draft: "", error: null, pending: null,
        };
      });

    case "desfeito":
      return mapRow(state, action.id, (r) => {
        if (r.phase !== "salvando") return r;
        return { ...r, phase: "parada", recusada: false, undoLeftMs: 0, error: null, pending: null };
      });

    case "falhou":
      return mapRow(state, action.id, (r) => {
        // Regra da casa: falha de rede não pode mentir. A linha volta
        // EXATAMENTE ao que era antes da tentativa, e a pessoa lê o porquê.
        if (r.pending === "corrigir" || r.phase === "editando") {
          // Volta para o formulário com o que ela digitou ainda lá: perder o
          // texto seria cobrar duas vezes pelo mesmo trabalho.
          return { ...r, phase: "editando", error: action.error, pending: null };
        }
        if (r.pending === "desfazer") {
          // O desfazer falhou, então a linha CONTINUA recusada. A janela
          // recomeça inteira: o botão não pode evaporar no meio da segunda
          // tentativa, que é justamente quando ela mais precisa dele.
          return {
            ...r, phase: "parada", recusada: true, undoLeftMs: UNDO_WINDOW_MS,
            error: action.error, pending: null,
          };
        }
        // Recusa que não aconteceu: a linha segue no retrato, como estava.
        return { ...r, phase: "parada", recusada: false, undoLeftMs: 0, error: action.error, pending: null };
      });

    case "tick": {
      // Congelado = relógio parado. Ver `blocoCongelado`.
      if (blocoCongelado(state)) return state;
      let mudou = false;
      const rows = state.rows.map((r) => {
        if (r.phase !== "parada" || !r.recusada) return r;
        mudou = true;
        const left = r.undoLeftMs - Math.max(0, action.ms);
        if (left > 0) return { ...r, undoLeftMs: left };
        // Venceu: a linha sai do bloco. A reversibilidade continua existindo
        // onde sempre existiu — em "Descartadas", nos Ajustes —, porque
        // recusar marca a memória, não a apaga.
        return { ...r, phase: "removida" as LearnedRowPhase, undoLeftMs: 0 };
      });
      return mudou ? { ...state, rows } : state;
    }

    default:
      return state;
  }
}
