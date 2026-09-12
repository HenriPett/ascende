import { useEffect, useReducer } from "react";
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
  initLearnedBlock, learnedBlockReducer, pedidoDeCorrecao,
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
  const desfazer = (row: LearnedRow) => executar(row, "desfazer", () => reactivateMemory(row.id));

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

            `size="icon"` no lugar do antigo `h-6 w-6`: no toque o botão passa a
            medir 44x44 de verdade em getBoundingClientRect, e não só a ter um
            ::after desse tamanho (ver o comentário longo em FirstTimeTip.tsx
            sobre por que o pseudo-elemento não conta). A margem negativa
            devolve o crescimento ao layout, e o cabeçalho fica onde estava. */}
        <Button
          variant="ghost" size="icon" className="-my-2 -mr-2 shrink-0 text-muted-foreground"
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

      <p className="text-[11px] text-muted-foreground">
        Vou lembrar disso nas próximas conversas.{" "}
        <Link to="/app/ajustes" className="underline underline-offset-2 hover:text-foreground">
          Veja e apague o que sei sobre você em Ajustes.
        </Link>
      </p>
    </div>
  );
}

/** O erro fica na linha, em 11px, e some quando a pessoa mexe de novo. */
function ErroInline({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-destructive" role="alert">{children}</p>;
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
      <li className="space-y-2 py-1">
        <label
          htmlFor={`aprendizado-${row.id}`}
          className="text-[11px] font-medium text-muted-foreground"
        >
          Como isso deveria estar escrito?
        </label>
        {/* Sem placeholder: o campo abre com o texto atual dentro, porque é
            correção e não redação em branco. */}
        <Textarea
          id={`aprendizado-${row.id}`}
          value={row.draft}
          onChange={(e) => onRascunho(e.target.value)}
          maxLength={MEMORY_CONTENT_MAX}
          rows={3}
          disabled={salvando}
          className="resize-none text-sm"
        />
        {row.error && <ErroInline>{row.error}</ErroInline>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {row.draft.trim().length}/{MEMORY_CONTENT_MAX}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancelar} disabled={salvando}>
              Cancelar
            </Button>
            <Button size="sm" onClick={onSalvar} disabled={salvando || !row.draft.trim()}>
              {salvando
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : (<><Check className="w-4 h-4 mr-1" /> Salvar</>)}
            </Button>
          </div>
        </div>
      </li>
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
      <li
        className={cn(
          "flex items-center justify-between gap-2 transition-opacity duration-300",
          rowSaindo(row) && "opacity-0",
        )}
      >
        <div className="min-w-0">
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
    <li>
      <DropdownMenu open={menuAberto} onOpenChange={onMenu}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={recusando || !rowAceitaMenu(row)}
            aria-label={`Corrigir ou recusar: ${row.content}`}
            className="w-full flex items-start gap-2 min-h-11 px-1.5 -mx-1.5 py-2 rounded-lg text-left text-sm hover:bg-primary/10 data-[state=open]:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {recusando
              ? <Loader2 className="mt-1 w-3 h-3 shrink-0 animate-spin text-primary" />
              : <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />}
            <span className="min-w-0 break-words">
              {row.content}
              <span className="ml-1.5 text-[11px] text-muted-foreground">· {categoria}</span>
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
