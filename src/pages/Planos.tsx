import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/core/Markdown";
import { toast } from "sonner";
import { ClipboardList, MessageCircle, Archive, ArchiveRestore, Trash2, ChevronRight } from "lucide-react";

interface Plan {
  id: string;
  title: string;
  kind: string;
  pillar: string | null;
  content: string;
  status: string;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  alimentar: "Alimentar", treino: "Treino", financeiro: "Financeiro", rotina: "Rotina", outro: "Plano",
};
const KIND_VAR: Record<string, string> = {
  alimentar: "--alimentacao", treino: "--vitalidade", financeiro: "--prosperidade", rotina: "--mente",
};

export default function Planos() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState<Plan | null>(null);

  const { data: plans, isLoading } = useQuery({
    queryKey: ["plans", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("plans").select("*")
        .eq("user_id", user!.id).order("created_at", { ascending: false }).limit(50);
      return (data ?? []) as Plan[];
    },
  });

  const setStatus = async (plan: Plan, status: "ativo" | "arquivado") => {
    const { error } = await supabase.from("plans").update({ status }).eq("id", plan.id);
    if (error) { toast.error("Não consegui atualizar."); return; }
    toast.success(status === "arquivado" ? "Plano arquivado." : "Plano reativado.");
    setOpen(null);
    qc.invalidateQueries({ queryKey: ["plans"] });
  };

  const remove = async (plan: Plan) => {
    const { error } = await supabase.from("plans").delete().eq("id", plan.id);
    if (error) { toast.error("Não consegui excluir."); return; }
    toast.success("Plano excluído.");
    setOpen(null);
    qc.invalidateQueries({ queryKey: ["plans"] });
  };

  const active = (plans ?? []).filter((p) => p.status === "ativo");
  const archived = (plans ?? []).filter((p) => p.status === "arquivado");

  const PlanRow = ({ p }: { p: Plan }) => {
    const hsl = KIND_VAR[p.kind] ? `hsl(var(${KIND_VAR[p.kind]}))` : "hsl(var(--gold))";
    return (
      <button onClick={() => setOpen(p)} className="w-full text-left">
        <Card className="flex items-center gap-3 p-3.5 hover:bg-muted/40 transition-colors">
          <div className="w-10 h-10 rounded-md grid place-items-center shrink-0"
            style={{ background: `${hsl.slice(0, -1)} / 0.12)` }}>
            <ClipboardList className="w-5 h-5" style={{ color: hsl }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{p.title}</p>
            <p className="text-xs text-muted-foreground">
              {KIND_LABEL[p.kind] ?? "Plano"} · {new Date(p.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
            </p>
          </div>
          {p.status === "arquivado" && <Badge variant="secondary" className="text-[10px] shrink-0">arquivado</Badge>}
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Card>
      </button>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold">Meus planos</h1>
        <p className="text-sm text-muted-foreground">
          Os planos que o Conselheiro montou para você, guardados fora do chat. Ele acompanha os ativos.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!isLoading && !(plans ?? []).length && (
        <Card className="p-6 text-center space-y-3">
          <ClipboardList className="w-8 h-8 mx-auto text-muted-foreground" />
          <div>
            <p className="font-semibold">Nenhum plano ainda</p>
            <p className="text-sm text-muted-foreground mt-1">
              Peça ao Conselheiro um plano alimentar, de treino ou financeiro. Quando ele montar
              um plano completo, você poderá salvá-lo aqui com um toque.
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link to="/app/conselheiro">
              <MessageCircle className="w-4 h-4 mr-1.5" /> Falar com o Conselheiro
            </Link>
          </Button>
        </Card>
      )}

      {active.length > 0 && (
        <div className="space-y-2">
          {active.map((p) => <PlanRow key={p.id} p={p} />)}
        </div>
      )}

      {archived.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground pt-2">Arquivados</p>
          {archived.map((p) => <PlanRow key={p.id} p={p} />)}
        </div>
      )}

      {/* Detalhe do plano */}
      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-lg max-h-[85dvh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="pr-6 break-words font-display">{open?.title}</DialogTitle>
            <DialogDescription asChild>
              <div className="flex items-center gap-2 pt-0.5">
                {open && (
                  <span className="inline-flex items-center text-[11px] font-semibold rounded-full px-2.5 py-0.5"
                    style={{
                      background: `${(KIND_VAR[open.kind] ? `hsl(var(${KIND_VAR[open.kind]})` : "hsl(var(--gold)")} / 0.14)`,
                      color: KIND_VAR[open.kind] ? `hsl(var(${KIND_VAR[open.kind]}))` : "hsl(var(--gold))",
                    }}>
                    {KIND_LABEL[open.kind] ?? "Plano"}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {open && `criado em ${new Date(open.created_at).toLocaleDateString("pt-BR")}`}
                </span>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto text-sm pr-1">
            {open && <Markdown content={open.content} doc />}
          </div>
          {open && (
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
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}