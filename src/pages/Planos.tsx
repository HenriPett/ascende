import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from "@/components/ui/drawer";
import { Markdown } from "@/components/core/Markdown";
import QueryError from "@/components/core/QueryError";
import PlanSections from "@/components/core/PlanSections";
import { isSectionedKind } from "@/lib/planSections";
import { toast } from "sonner";
import { isPlanCapError } from "@/lib/fnError";
import {
  ClipboardList, MessageCircle, Archive, ArchiveRestore, Trash2, ChevronRight,
  UtensilsCrossed, Dumbbell, Coins, Repeat,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Plan {
  id: string;
  title: string;
  kind: string;
  pillar: string | null;
  content: string;
  status: string;
  created_at: string;
}

/* A pergunta que o estado vazio já entrega escrita. É a mesma da Jornada
   (SIGNATURE_QUESTION, Jornada.tsx:40) de propósito: é a prova nº 1 do
   POSICIONAMENTO — o plano alimentar que cabe no bolso — e é o que
   transforma "não sei o que pedir" em plano salvo. */
const EMPTY_STATE_QUESTION =
  "Monte um plano alimentar para o meu objetivo que caiba no meu orçamento";

const KIND_LABEL: Record<string, string> = {
  alimentar: "Alimentar", treino: "Treino", financeiro: "Financeiro", rotina: "Rotina", outro: "Plano",
};
/* Alimentar e treino são a MESMA cor desde a fusão, e está certo assim: a cor
   nunca foi o que distinguia esses cartões — o rótulo ("Alimentar"/"Treino"),
   o ícone (UtensilsCrossed/Dumbbell) e a seção com título próprio já fazem
   isso. Ressuscitar o coral como cor de TIPO DE PLANO, sem pilar por trás,
   recriaria exatamente a incoerência que a fusão removeu: uma cor de categoria
   que não corresponde a categoria nenhuma do app. */
const KIND_VAR: Record<string, string> = {
  alimentar: "--vitalidade", treino: "--vitalidade", financeiro: "--prosperidade", rotina: "--mente",
};
const KIND_ICON: Record<string, LucideIcon> = {
  alimentar: UtensilsCrossed, treino: Dumbbell, financeiro: Coins, rotina: Repeat,
};

/* Alimentar e treino ganham seção própria na lista: são os planos que a pessoa
 * consulta e ajusta toda semana, e agora têm visualização por item. Os demais
 * seguem juntos em "Outros planos" — separá-los em quatro grupos de uma linha
 * cada só espalharia a tela. Arquivados nunca entram nos grupos por tipo: um
 * plano guardado não é "o seu plano alimentar" (recomendação da Prisma). */
const GROUPS: { id: string; label: string; hint: string; match: (kind: string) => boolean }[] = [
  {
    id: "alimentar",
    label: "Plano alimentar",
    hint: "cada refeição separada, e editável",
    match: (k) => k === "alimentar",
  },
  {
    id: "treino",
    label: "Plano de treino",
    hint: "cada dia separado, e editável",
    match: (k) => k === "treino",
  },
  {
    id: "outros",
    label: "Outros planos",
    hint: "financeiro, rotina e outros",
    match: (k) => k !== "alimentar" && k !== "treino",
  },
];

const kindColor = (kind: string) =>
  KIND_VAR[kind] ? `hsl(var(${KIND_VAR[kind]}))` : "hsl(var(--gold))";
const kindTint = (kind: string) =>
  KIND_VAR[kind] ? `hsl(var(${KIND_VAR[kind]}) / 0.12)` : "hsl(var(--gold) / 0.12)";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

export default function Planos() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  // Guardamos o ID, não o objeto: depois de editar uma seção a lista é
  // refeita, e o plano aberto precisa mostrar o conteúdo NOVO. Com o objeto
  // congelado no estado, a tela continuaria exibindo a versão anterior.
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: plans, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["plans", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("*")
        .eq("user_id", user!.id).order("created_at", { ascending: false }).limit(50);
      // Lista vazia aqui vira o convite de "peça o primeiro plano" — errado
      // para quem já tem cinco.
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });

  const open = (plans ?? []).find((p) => p.id === openId) ?? null;

  const setStatus = async (plan: Plan, status: "ativo" | "arquivado") => {
    const { error } = await supabase.from("plans").update({ status }).eq("id", plan.id);
    if (error) {
      /* "Tente de novo" para uma coisa que NUNCA vai funcionar por repetição
         é o pior erro que uma tela pode dar: manda a pessoa insistir no que
         não tem saída. Reativar com a vaga ocupada esbarra em
         `enforce_active_plans_cap` e a mensagem genérica não contava nem que
         existe limite, nem que a troca é possível — ela é, em dois passos.
         O erro agora ensina o caminho em vez de esconder o beco. */
      if (isPlanCapError(error)) {
        toast.error(
          "Seu plano mantém um número limitado de planos ativos. Arquive o que está ativo e depois reative este — nada se perde na troca.",
        );
        return;
      }
      toast.error("Não consegui atualizar o plano. Tente de novo.");
      return;
    }
    toast.success(status === "arquivado" ? "Plano arquivado." : "Plano reativado.");
    setOpenId(null);
    qc.invalidateQueries({ queryKey: ["plans"] });
  };

  const remove = async (plan: Plan) => {
    const { error } = await supabase.from("plans").delete().eq("id", plan.id);
    if (error) { toast.error("Não consegui excluir o plano. Tente de novo."); return; }
    toast.success("Plano excluído.");
    setOpenId(null);
    qc.invalidateQueries({ queryKey: ["plans"] });
  };

  /** Grava o markdown remontado por PlanSections. O componente só sai do modo
   *  de edição quando isto devolve `true`: falha de rede não pode apagar o
   *  texto que a pessoa acabou de escrever. */
  const saveContent = async (plan: Plan, nextContent: string): Promise<boolean> => {
    const { error } = await supabase.from("plans").update({ content: nextContent }).eq("id", plan.id);
    if (error) {
      toast.error("Não consegui salvar a alteração. Seu texto continua aqui — tente de novo.");
      return false;
    }
    toast.success("Alteração salva no plano.");
    qc.invalidateQueries({ queryKey: ["plans"] });
    return true;
  };

  const all = plans ?? [];
  const active = all.filter((p) => p.status === "ativo");
  const archived = all.filter((p) => p.status === "arquivado");

  const PlanRow = ({ p }: { p: Plan }) => {
    const Icon = KIND_ICON[p.kind] ?? ClipboardList;
    return (
      <button onClick={() => setOpenId(p.id)} className="w-full text-left">
        <Card className="flex items-center gap-3 p-3.5 hover:bg-muted/40 transition-colors">
          <div className="w-10 h-10 rounded-md grid place-items-center shrink-0"
            style={{ background: kindTint(p.kind) }}>
            <Icon className="w-5 h-5" style={{ color: kindColor(p.kind) }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{p.title}</p>
            <p className="text-xs text-muted-foreground">
              {KIND_LABEL[p.kind] ?? "Plano"} · {formatDate(p.created_at)}
            </p>
          </div>
          {p.status === "arquivado" && <Badge variant="secondary" className="text-[10px] shrink-0">arquivado</Badge>}
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Card>
      </button>
    );
  };

  const GroupHeading = ({ label, hint, count }: { label: string; hint?: string; count: number }) => (
    <div className="flex items-baseline gap-2 px-0.5">
      <h2 className="font-display text-sm font-semibold">{label}</h2>
      <span className="text-xs text-muted-foreground min-w-0 truncate">
        {count > 1 && <>{count} planos{hint ? " · " : ""}</>}
        {hint}
      </span>
    </div>
  );

  // Corpo do plano aberto: seccionado para alimentar/treino, documento
  // inteiro para o resto (financeiro, rotina, outro) — sem regressão.
  const detailBody = open && (
    isSectionedKind(open.kind)
      ? (
        <PlanSections
          key={open.id}
          content={open.content}
          kind={open.kind}
          onSave={(next) => saveContent(open, next)}
        />
      )
      : <Markdown content={open.content} doc />
  );

  const detailMeta = open && (
    <div className="flex items-center gap-2 pt-0.5">
      <span className="inline-flex items-center text-[11px] font-semibold rounded-full px-2.5 py-0.5"
        style={{ background: kindTint(open.kind), color: kindColor(open.kind) }}>
        {KIND_LABEL[open.kind] ?? "Plano"}
      </span>
      <span className="text-xs text-muted-foreground">criado em {formatDate(open.created_at)}</span>
      {open.status === "arquivado" && (
        <Badge variant="secondary" className="text-[10px]">arquivado</Badge>
      )}
    </div>
  );

  const detailActions = open && (
    <div className="flex flex-wrap gap-2 justify-end pt-2 border-t shrink-0">
      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(open)}>
        <Trash2 className="w-4 h-4 mr-1" /> Excluir
      </Button>
      {open.status === "ativo" ? (
        <Button variant="outline" size="sm" onClick={() => setStatus(open, "arquivado")}>
          <Archive className="w-4 h-4 mr-1" /> Arquivar
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setStatus(open, "ativo")}>
          <ArchiveRestore className="w-4 h-4 mr-1" /> Reativar
        </Button>
      )}
      <Button asChild size="sm">
        <Link to="/app/conselheiro">
          <MessageCircle className="w-4 h-4 mr-1" /> Ajustar com o Conselheiro
        </Link>
      </Button>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold">Meus planos</h1>
        <p className="text-sm text-muted-foreground">
          Os planos que o Conselheiro montou para você, guardados aqui fora da conversa.
          Ele consulta os planos ativos sempre que responde.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {isError && (
        <QueryError
          title="Não consegui carregar seus planos."
          detail="Pode ser a conexão — nenhum plano foi perdido nem arquivado."
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      )}

      {!isLoading && !isError && !all.length && (
        <Card className="p-6 text-center space-y-3">
          <ClipboardList className="w-8 h-8 mx-auto text-muted-foreground" />
          <div>
            {/* O título nomeava a ausência e o botão abria uma caixa de texto
                em branco para quem acabou de provar que não sabe o que pedir.
                A Jornada já resolveu isto melhor (Jornada.tsx:169): manda a
                pergunta pronta pelo gancho ?q=. Esta tela ficou com a versão
                fraca — agora usa o mesmo padrão, e a pergunta que ela carrega
                é a Porta do POSICIONAMENTO (corpo + dinheiro no orçamento). */}
            <p className="font-semibold">Seu primeiro plano nasce de uma pergunta</p>
            {/* Modo condicional de propósito. A primeira redação afirmava que
                "o Conselheiro já sabe quanto você ganha, o que você gasta com
                comida e como anda seu corpo" — falso para quem pulou os blocos
                de renda e de corpo no onboarding, e falso na voz dele,
                afirmando um conhecimento que ele não tem. É o mesmo defeito
                que semOrigemTexto (memories.ts:203) já existe para combater. */}
            <p className="text-sm text-muted-foreground mt-1">
              Com o que você já contou, o Conselheiro monta: um plano alimentar dentro do seu
              orçamento, um treino que caiba na sua rotina ou um teto de gasto. O que faltar,
              ele pergunta — e você guarda o plano aqui.
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link to={`/app/conselheiro?q=${encodeURIComponent(EMPTY_STATE_QUESTION)}`}>
              <MessageCircle className="w-4 h-4 mr-1.5" /> Pedir um plano que cabe no meu bolso
            </Link>
          </Button>
        </Card>
      )}

      {/* Ativos, agrupados por tipo */}
      {GROUPS.map((g) => {
        const rows = active.filter((p) => g.match(p.kind));
        if (!rows.length) return null;
        return (
          <section key={g.id} className="space-y-2">
            <GroupHeading label={g.label} hint={g.hint} count={rows.length} />
            {rows.map((p) => <PlanRow key={p.id} p={p} />)}
          </section>
        );
      })}

      {archived.length > 0 && (
        <section className="space-y-2">
          <GroupHeading label="Arquivados" count={archived.length} />
          {archived.map((p) => <PlanRow key={p.id} p={p} />)}
        </section>
      )}

      {/* Detalhe do plano.
          No celular vira gaveta quase inteira: um plano é documento, e editar
          um textarea com o teclado aberto dentro de um diálogo de 85dvh fica
          apertado demais (recomendação da Prisma). */}
      {isMobile ? (
        <Drawer open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
          <DrawerContent className="h-[92dvh] flex flex-col">
            <DrawerHeader className="text-left shrink-0 pb-2">
              <DrawerTitle className="pr-6 break-words font-display">{open?.title}</DrawerTitle>
              <DrawerDescription asChild><div>{detailMeta}</div></DrawerDescription>
            </DrawerHeader>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 text-sm">
              {detailBody}
            </div>
            <div className="shrink-0 px-4 pb-3 safe-bottom">{detailActions}</div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
          <DialogContent className="max-w-lg max-h-[85dvh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle className="pr-6 break-words font-display">{open?.title}</DialogTitle>
              <DialogDescription asChild><div>{detailMeta}</div></DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto text-sm pr-1">
              {detailBody}
            </div>
            {detailActions}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
