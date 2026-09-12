import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Brain, X, Pencil, ThumbsDown, Check, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  MEMORY_CATEGORY_LABEL, MEMORY_CONTENT_MAX, type LearnedMemory,
} from "@/lib/memories";
import { updateMemoryContent, rejectMemory, reactivateMemory } from "@/lib/memoriesData";
import {
  initLearnedBlock, learnedBlockReducer, pedidoDeCorrecao, statusAoDesfazer,
  rowAceitaMenu, rowOutcome, rowSaindo, blocoCongelado, blocoVazio,
  type LearnedRow,
} from "@/lib/learnedRows";

/**
 * Bloco discreto exibido logo após uma resposta da IA: mostra o que ela
 * aprendeu sobre a pessoa NESTA mensagem — e deixa consertar ali mesmo.
 *
 * Antes daqui o bloco era só um aviso: para tirar do retrato uma frase torta,
 * a pessoa tinha que abandonar a conversa, abrir Ajustes e caçar a linha. O
 * fundador descreveu a dor exatamente assim, e ela é pior do que parece —
 * corrigir longe do momento significa corrigir depois de o Conselheiro já ter
 * usado a suposição errada no turno seguinte.
 *
 * Duas ações, e só duas (decisão da Prisma):
 * • "Corrigir" — o texto vira o da pessoa.
 * • "Isso não é sobre mim" — sai do retrato na hora, com ~8s de Desfazer.
 *
 * Ficaram de fora "isso está certo" (pedir confirmação 3s depois de a pessoa
 * ter dito a coisa é o app duvidando dela), "só por um tempo" (prazo é decisão
 * de retrato frio, não de momento) e "apagar de vez" (irreversível dentro de
 * um balão que some sozinho). Ajustes continua com as cinco.
 *
 * Sem `toast` em nenhum caminho, nem no erro: toast em cima do chat é uma
 * segunda camada flutuante, e tudo o que este bloco tem a dizer cabe na
 * própria linha.
 *
 * A máquina de estados da linha vive em @/lib/learnedRows — pura e testada.
 * Aqui fica só o que precisa de React: o relógio do desfazer e as idas ao
 * banco.
 */
export default function LearnedInsights({
  items, onDismiss,
}: { items: LearnedMemory[]; onDismiss: () => void }) {
  if (!items.length) return null;
  // Aprendizado novo é bloco novo: remontar pelo conjunto de ids zera menu,
  // edição e relógios de uma vez, sem uma ação de "reset" que alguém teria
  // que lembrar de disparar.
  return <Bloco key={items.map((m) => m.id).join("|")} items={items} onDismiss={onDismiss} />;
}

/** De quanto em quanto tempo o relógio do desfazer anda. 250ms é fino o
 *  bastante para a linha sair na hora certa e grosso o bastante para não
 *  renderizar o balão da conversa 60 vezes por segundo. */
const TICK_MS = 250;

const ERRO_PADRAO = "Não consegui salvar. Tente de novo.";

function Bloco({
  items, onDismiss,
}: { items: LearnedMemory[]; onDismiss: () => void }) {
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(learnedBlockReducer, items, initLearnedBlock);

  const congelado = blocoCongelado(state);
  const contando = state.rows.some((r) => r.phase === "parada" && r.recusada);

  // O relógio do desfazer. Ele só existe enquanto há o que contar, e PARA
  // enquanto o bloco está congelado — quem parou para corrigir a linha de cima
  // não pode perder o Desfazer da de baixo por ter demorado.
  useEffect(() => {
    if (!contando || congelado) return;
    const t = setInterval(() => dispatch({ type: "tick", ms: TICK_MS }), TICK_MS);
    return () => clearInterval(t);
  }, [contando, congelado]);

  // Quando a última linha vai embora, o bloco não tem mais o que dizer.
  const vazio = blocoVazio(state);
  useEffect(() => { if (vazio) onDismiss(); }, [vazio, onDismiss]);
  if (vazio) return null;

  /** Toda escrita passa por aqui: marca a linha como salvando, chama o banco e
   *  traduz a falha em uma frase na própria linha. É este `catch` que cumpre a
   *  regra da casa de que falha de rede não pode mentir — o reducer devolve a
   *  linha ao que era antes da tentativa. */
  const executar = async (
    row: LearnedRow, acao: "corrigir" | "recusar" | "desfazer", chamada: () => Promise<unknown>,
  ) => {
    dispatch({ type: "salvando", id: row.id, acao });
    try {
      await chamada();
      // Ajustes mostra a mesma memória: sem isto, a lista de lá continuaria
      // com o texto velho até a próxima visita.
      qc.invalidateQueries({ queryKey: ["ai-memories"] });
      if (acao === "corrigir") return true;
      dispatch(acao === "recusar" ? { type: "recusado", id: row.id } : { type: "desfeito", id: row.id });
      return true;
    } catch (e) {
      dispatch({
        type: "falhou", id: row.id,
        error: e instanceof Error && e.message ? e.message : ERRO_PADRAO,
      });
      return false;
    }
  };

  const salvarCorrecao = async (row: LearnedRow) => {
    const pedido = pedidoDeCorrecao(row, row.draft);
    if (pedido.kind === "invalido") {
      dispatch({ type: "falhou", id: row.id, error: pedido.error });
      return;
    }
    // Não mudou nada: fechar o campo é a resposta certa. Gravar promoveria a
    // memória a "confirmada" — o app registrando uma confirmação que ela não
    // deu, só porque abriu e fechou o campo.
    if (pedido.kind === "sem-mudanca") {
      dispatch({ type: "cancelar", id: row.id });
      return;
    }
    const ok = await executar(row, "corrigir", () => updateMemoryContent(row.id, pedido.content));
    // O texto que a linha passa a mostrar é o VALIDADO, não o cru do campo.
    if (ok) dispatch({ type: "corrigido", id: row.id, content: pedido.content });
  };

  const recusar = (row: LearnedRow) => executar(row, "recusar", () => rejectMemory(row.id));
  // Desfazer é reativar: recusar marca a memória, nunca apaga — é por isso que
  // dá para voltar atrás aqui e, depois dos 8s, ainda em Descartadas.
  //
  // `statusAoDesfazer` é o que impede o desfazer de REBAIXAR uma linha que já
  // tinha sido corrigida. Sem ele, o chat continuava dizendo "Corrigido por
  // você" e Ajustes voltava a perguntar "isso está certo?" sobre o mesmo item.
  const desfazer = (row: LearnedRow) => executar(row, "desfazer",
    () => reactivateMemory(row.id, { voltarComo: statusAoDesfazer(row) }));

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-2 animate-fade-up">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Brain className="w-4 h-4 text-primary" />
          Aprendi sobre você
        </p>
        {/* Dispensar é sempre saída: este X não consulta `blocoCongelado`. Ele
            some com o BLOCO, enquanto as linhas agem item a item — hierarquias
            diferentes, por isso não competem.

            `h-11 w-11` cravado, e não o `size="icon"` sozinho. O `icon` só
            chega a 44px sob `coarse:` (ponteiro grosso), e o QA mediu 40x40 em
            TODO ambiente que ele conseguiu usar — inclusive com user agent de
            iPhone, porque `pointer: coarse` não é emulável no portal. Um alvo
            que só é 44 em ambiente que ninguém consegue medir é, na prática,
            um alvo de 40: fica 44 sempre, e some a discussão.

            A margem negativa devolve os 20px de crescimento ao layout, então o
            cabeçalho fica exatamente onde estava (ver o comentário longo em
            FirstTimeTip.tsx sobre por que se cresce a CAIXA e não um ::after). */}
        <Button
          variant="ghost" size="icon"
          className="h-11 w-11 -my-2.5 -mr-2 shrink-0 text-muted-foreground"
          onClick={onDismiss} aria-label="Dispensar o que o Conselheiro aprendeu"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <ul className="space-y-1">
        {state.rows.map((row) => (
          <Linha
            key={row.id} row={row} menuAberto={state.menu === row.id}
            onMenu={(v) => dispatch(v ? { type: "abrirMenu", id: row.id } : { type: "fecharMenu" })}
            onEditar={() => dispatch({ type: "editar", id: row.id })}
            onRascunho={(draft) => dispatch({ type: "rascunho", id: row.id, draft })}
            onCancelar={() => dispatch({ type: "cancelar", id: row.id })}
            onSalvar={() => salvarCorrecao(row)}
            onRecusar={() => recusar(row)}
            onDesfazer={() => desfazer(row)}
          />
        ))}
      </ul>

      {/* O rodapé mandava "apague em Ajustes" — que era exatamente a viagem
          que o bloco agora poupa. Com as ações aqui dentro, ele passa a dizer
          o que dá para fazer NESTA tela, e Ajustes vira o que de fato é: o
          histórico completo, para a revisão fria. */}
      <p className="text-[11px] text-muted-foreground">
        Vou lembrar disso nas próximas conversas. Toque em qualquer linha para corrigir ou
        tirar do seu retrato.{" "}
        <Link to="/app/ajustes" className="underline underline-offset-2 hover:text-foreground">
          Tudo o que sei sobre você fica em Ajustes.
        </Link>
      </p>
    </div>
  );
}

/** O erro fica na linha, em 11px, e some quando a pessoa mexe de novo. */
function ErroInline({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-destructive" role="alert">{children}</p>;
}

/** Teto da caixa de correção, como o `COMPOSER_MAX_H` do Conselheiro: passou
 *  disso, ela rola por dentro em vez de empurrar o resto do bloco tela abaixo. */
const CAMPO_MAX_H = 160;

/**
 * O campo que substitui a linha.
 *
 * Três defeitos que o QA mediu moram aqui, e os três são do mesmo tipo — a
 * caixa não sabia onde estava:
 *
 * 1. ALTURA FIXA. `rows={3}` dá 78px de área útil contra um limite de 200
 *    caracteres; num campo de 248px de largura (a barra de captura da Hoje é
 *    estreita, aninhada em dois cartões) 199 caracteres precisam de 156px. A
 *    quarta linha aparecia fatiada no meio dos glifos. É o mesmo defeito que o
 *    compositor do Conselheiro já teve, e a solução é a mesma: crescer com o
 *    conteúdo até um teto (ver COMPOSER_MAX_H em Chat.tsx).
 *
 * 2. FORA DA TELA. Na Hoje em 390x844 o Salvar nascia em y=797 com a barra de
 *    navegação ocupando 766–832: o botão ficava 100% coberto, o clique caía na
 *    nav, e a página NÃO rolava sozinha. Quem tentasse corrigir um aprendizado
 *    pelo celular na tela Hoje simplesmente não conseguia salvar. `scroll-mb-32`
 *    é o mesmo número do `pb-32` que o AppLayout já reserva para a nav — é
 *    assim que o navegador fica sabendo que aqueles pixels não são visíveis.
 *
 * 3. SEM FOCO. A pessoa pedia para corrigir e o teclado não subia; era preciso
 *    tocar de novo no campo. `preventScroll` porque quem decide o scroll é o
 *    `scrollIntoView` abaixo, que conhece a nav — o foco sozinho não conhece.
 */
function CampoCorrecao({
  row, salvando, onRascunho, onCancelar, onSalvar,
}: {
  row: LearnedRow;
  salvando: boolean;
  onRascunho: (draft: string) => void;
  onCancelar: () => void;
  onSalvar: () => void;
}) {
  const campo = useRef<HTMLTextAreaElement>(null);
  const caixa = useRef<HTMLLIElement>(null);

  // Antes da pintura, senão a caixa aparece com a altura errada por um quadro.
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";                     // mede o conteúdo do zero
    const h = Math.min(el.scrollHeight, CAMPO_MAX_H);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > CAMPO_MAX_H ? "auto" : "hidden";
  }, [row.draft, row.error]);

  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    // Cursor no fim, não selecionando tudo: ela veio consertar um pedaço da
    // frase, e um Ctrl+A implícito apaga tudo no primeiro caractere digitado.
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Na montagem e sempre que um erro entra (o erro cresce a caixa e pode
  // empurrar o Salvar para debaixo da nav de novo).
  useEffect(() => {
    caixa.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [row.error]);

  return (
    // `px-1.5 -mx-1.5`: a mesma caixa da linha normal, para o bloco não deslocar
    // 6px ao entrar e sair da correção.
    <li ref={caixa} className="space-y-2 px-1.5 -mx-1.5 py-1 scroll-mb-32">
      <label
        htmlFor={`aprendizado-${row.id}`}
        className="text-[11px] font-medium text-muted-foreground"
      >
        Como isso deveria estar escrito?
      </label>
      {/* Sem placeholder: o campo abre com o texto atual dentro, porque é
          correção e não redação em branco. */}
      <Textarea
        ref={campo}
        id={`aprendizado-${row.id}`}
        value={row.draft}
        onChange={(e) => onRascunho(e.target.value)}
        maxLength={MEMORY_CONTENT_MAX}
        rows={2}
        disabled={salvando}
        className="resize-none text-sm min-h-11"
      />
      {row.error && <ErroInline>{row.error}</ErroInline>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {row.draft.trim().length}/{MEMORY_CONTENT_MAX}
        </span>
        {/* `h-11` por cima do `size="sm"`: o `sm` é h-9 = 36px MEDIDOS, e ao
            contrário do `icon` ele nem tem variante `coarse:` — falhava a régua
            dos 44 em qualquer ambiente, com dedo ou com mouse. */}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="h-11" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </Button>
          <Button size="sm" className="h-11" onClick={onSalvar} disabled={salvando || !row.draft.trim()}>
            {salvando
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : (<><Check className="w-4 h-4 mr-1" /> Salvar</>)}
          </Button>
        </div>
      </div>
    </li>
  );
}

function Linha({
  row, menuAberto, onMenu, onEditar, onRascunho, onCancelar, onSalvar, onRecusar, onDesfazer,
}: {
  row: LearnedRow;
  menuAberto: boolean;
  onMenu: (open: boolean) => void;
  onEditar: () => void;
  onRascunho: (draft: string) => void;
  onCancelar: () => void;
  onSalvar: () => void;
  onRecusar: () => void;
  onDesfazer: () => void;
}) {
  if (row.phase === "removida") return null;

  const categoria = MEMORY_CATEGORY_LABEL[row.category] ?? MEMORY_CATEGORY_LABEL.outro;
  const salvando = row.phase === "salvando";
  const outcome = rowOutcome(row);

  /* ── Editando (e salvando a correção) ──────────────────────────────────
     O campo substitui a LINHA, em vez de empilhar sob ela: é o único formato
     de formulário que cabe num balão de conversa, e é exatamente o que a
     pessoa pediu ao tocar. */
  if (row.phase === "editando" || (salvando && row.pending === "corrigir")) {
    return (
      <CampoCorrecao
        row={row} salvando={salvando}
        onRascunho={onRascunho} onCancelar={onCancelar} onSalvar={onSalvar}
      />
    );
  }

  /* ── Recusada: a janela de desfazer ────────────────────────────────────
     A linha NÃO some na hora. Ela fica dizendo o que aconteceu, com o botão de
     voltar atrás ao lado, e só depois sai — com fade, que é uma transição de
     opacidade e não um keyframe: uma transição travada deixa a linha visível,
     nunca o contrário. */
  if (outcome === "recusada") {
    const desfazendo = salvando && row.pending === "desfazer";
    return (
      // `px-1.5 -mx-1.5` e o marcador: a mesma caixa e a mesma coluna de texto
      // da linha normal. Sem os dois, recusar deslocava a linha 6px para a
      // direita e ainda começava o texto 14px antes das outras — a coluna não
      // se sustentava entre os estados, e o bloco "pulava" a cada ação.
      <li
        className={cn(
          "flex items-center gap-2 px-1.5 -mx-1.5 min-h-11 transition-opacity duration-300",
          rowSaindo(row) && "opacity-0",
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">Tirei isso do seu retrato</p>
          {row.error && <ErroInline>{row.error}</ErroInline>}
        </div>
        {/* 44px de verdade: `min-h-11` mede no getBoundingClientRect. */}
        <button
          type="button"
          onClick={onDesfazer}
          disabled={desfazendo}
          className="shrink-0 inline-flex items-center gap-1.5 min-h-11 px-3 -mr-1 rounded-lg text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {desfazendo
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Undo2 className="w-4 h-4" aria-hidden />}
          Desfazer
        </button>
      </li>
    );
  }

  /* ── Parada: a linha normal (ou já corrigida) ──────────────────────────
     Nenhum ícone de ação permanente. Três aprendizados × dois botões seriam
     seis alvos dentro de um balão de conversa; em vez disso, a LINHA INTEIRA é
     o alvo e abre um menu de dois itens ancorado nela.

     `min-h-11` e não um ::after de 44px: a caixa precisa MEDIR 44px, senão
     toda auditoria de acessibilidade reprova o alvo e ninguém consegue provar
     o contrário sem simular um toque (o mesmo raciocínio do `py-3.5 -my-3.5`
     em FirstTimeTip.tsx). Aqui a linha já é um bloco próprio, então dá para
     crescer com `min-h-11` direto, sem margem negativa. */
  const recusando = salvando && row.pending === "recusar";
  return (
    // O `-mx-1.5` mora no <li>, e não no botão, pelo mesmo motivo dos outros
    // dois estados — mas aqui ele também conserta uma assimetria: `w-full`
    // dentro do <li> mede a largura do <ul>, então margem negativa no BOTÃO
    // deslizava a caixa 6px para a esquerda em vez de alargá-la 12, e o realce
    // sobrava de um lado e faltava do outro. No <li>, o `w-full` já nasce com
    // a largura certa.
    <li className="-mx-1.5">
      <DropdownMenu open={menuAberto} onOpenChange={onMenu}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={recusando || !rowAceitaMenu(row)}
            aria-label={`Corrigir ou recusar: ${row.content}`}
            className="w-full flex items-start gap-2 min-h-11 px-1.5 py-2 rounded-lg text-left text-sm hover:bg-primary/10 data-[state=open]:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {recusando
              ? <Loader2 className="mt-1 w-3 h-3 shrink-0 animate-spin text-primary" />
              : <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />}
            <span className="min-w-0 break-words">
              {row.content}
              {/* `whitespace-nowrap`: sem isto o "·" (1,4px de largura) sobrava
                  sozinho no fim da linha e a categoria descia para a seguinte —
                  um separador separando nada. Agora os dois quebram juntos. */}
              <span className="ml-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                · {categoria}
              </span>
              {/* A linha passa a dizer de quem é a frase. A AUTORIA da memória
                  não muda com isso — quem deduziu primeiro continua tendo
                  deduzido, e o banco congela `created_by` por gatilho. Isto
                  aqui é sobre o TEXTO, que agora é dela. */}
              {outcome === "corrigida" && (
                <span className="block text-[11px] text-muted-foreground">Corrigido por você</span>
              )}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={onEditar} className="min-h-11">
            <Pencil className="w-4 h-4 mr-2" aria-hidden /> Corrigir
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRecusar} className="min-h-11">
            <ThumbsDown className="w-4 h-4 mr-2" aria-hidden /> Isso não é sobre mim
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {row.error && <div className="px-1.5 pb-1"><ErroInline>{row.error}</ErroInline></div>}
    </li>
  );
}
