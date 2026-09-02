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
  statement_import: "Importação de fatura",
  plans: "Planos ativos",
};

// Só benefícios que EXISTEM hoje (plano §2.2): nada de relatório mensal ou
// análises avançadas até estarem implementados de verdade.
const PLUS_BENEFITS = [
  "Conselheiro: 15 mensagens por dia (até 300 no mês)",
  "Captura inteligente: 30 por dia",
  "Briefing diário todas as manhãs (com aviso no WhatsApp)",
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
  // O título dizia sempre "limite de hoje", mas o limite atingido pode ser
  // diário, semanal ou mensal — e com o padrão do plano grátis (15 mensagens
  // por SEMANA) o corpo dizia "desta semana" embaixo de um título "de hoje".
  //
  // O período verdadeiro já chega em `info.error`, que o backend monta por
  // janela ("...desta semana...", "...deste mês...", "...de hoje..."): ler
  // dali é exato. A versão anterior deduzia o período pela distância até o
  // reset, e isso erra justamente nas bordas, que é quando alguém esbarra no
  // teto: um limite SEMANAL atingido num domingo reseta em poucas horas e
  // saía rotulado "de hoje"; um MENSAL atingido no dia 30, idem.
  // Quando a frase não disser o período, o título não inventa: fica sem
  // sufixo, porque "Você chegou ao limite" já é verdade em qualquer janela.
  // É o caso das mensagens que não são teto de período e sim recurso pago
  // ("A análise de documentos (PDF) faz parte do Ascende+") ou cortesia já
  // usada ("Você já usou a importação gratuita").
  //
  // O casamento é com as TRÊS frases exatas que o backend emite, e não com
  // "mensal"/"por mês" soltos: a oferta do Ascende+ fala em "cota mensal de
  // documentos" dentro da mesma mensagem, e um padrão frouxo rotulava a
  // importação de fatura (cortesia de uso único) como "limite deste mês".
  const said = (info.error ?? "").toLowerCase();
  const periodLabel =
    said.includes("desta semana") ? " desta semana"
    : said.includes("deste mês") ? " deste mês"
    : said.includes("de hoje") ? " de hoje"
    : "";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-gold" /> Você chegou ao limite{periodLabel} — e ele existe de propósito
          </DialogTitle>
          <DialogDescription>
            {info.error} {resetLabel && <>Renova em <strong>{resetLabel}</strong>.</>}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          O Ascende não vive da sua atenção infinita nem dos seus dados. Vive de assinatura.
          É por isso que os limites existem — e é por isso que dá para confiar no que o
          Conselheiro diz.
        </p>

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
            <p className="font-semibold">{ent?.pricing?.monthly_label ?? "R$ 29,90/mês"}</p>
            <p className="text-xs text-muted-foreground">{ent?.pricing?.annual_label ?? "R$ 239,90/ano — economia de R$ 118,90"}</p>
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
          Nossos compromissos públicos estão em{" "}
          <a href="/recusas" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            O que o Ascende recusa
          </a>.
        </p>
      </DialogContent>
    </Dialog>
  );
}