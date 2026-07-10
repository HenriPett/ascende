// Paywall contextual: aparece SOMENTE quando um limite do plano é atingido
// (plano §16). Mostra o recurso, o limite, quando renova e o caminho de upgrade.
import { useNavigate } from "react-router-dom";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useEntitlements } from "@/hooks/useEntitlements";
import type { PlanLimitError } from "@/lib/fnError";
import { formatSP } from "@/lib/dates";

const FEATURE_LABEL: Record<string, string> = {
  counselor: "Conselheiro",
  capture: "Captura inteligente",
  briefing: "Briefing diário",
  "analyze-meal": "Análise de refeição por foto",
  "analyze-body": "Análise de composição corporal",
  document_analysis: "Análise de documentos (PDF)",
  plans: "Planos ativos",
};

const PLUS_BENEFITS = [
  "Conselheiro: 15 mensagens por dia (até 300 no mês)",
  "Captura inteligente: 30 por dia",
  "Briefing diário + retrospectiva semanal + relatório mensal",
  "30 análises de refeição e 10 análises de PDF por mês",
  "Até 5 planos ativos e 150 memórias do Conselheiro",
];

export default function Paywall({
  info, onClose,
}: { info: PlanLimitError | null; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: ent } = useEntitlements();
  if (!info) return null;

  const label = FEATURE_LABEL[info.feature] ?? info.feature;
  const resetLabel = info.reset_at
    ? formatSP(info.reset_at, { day: "2-digit", month: "2-digit" })
    : null;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-gold" /> Limite de hoje atingido
          </DialogTitle>
          <DialogDescription>
            {info.error} {resetLabel && <>Renova em <strong>{resetLabel}</strong>.</>}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border p-3 space-y-1.5 text-sm">
          <p><span className="text-muted-foreground">Recurso:</span> <strong>{label}</strong></p>
          <p><span className="text-muted-foreground">Seu limite atual:</span> <strong>{info.limit}</strong></p>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Com o Ascende+ você tem:</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            {PLUS_BENEFITS.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="text-sm">
            <p className="font-semibold">{ent?.pricing?.monthly_label ?? "R$ 19,90/mês"}</p>
            <p className="text-xs text-muted-foreground">{ent?.pricing?.annual_label ?? "ou plano anual com desconto"}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Agora não</Button>
            <Button onClick={() => { onClose(); navigate("/app/assinatura"); }}>
              Conhecer o Ascende+
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Registros manuais, hábitos, exportação e privacidade continuam sempre gratuitos.
        </p>
      </DialogContent>
    </Dialog>
  );
}
