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
//
// A ORDEM DA FRASE É A DECISÃO. PRINCIPIOS.md, micro-incoerência 2, é
// explícito: "o framing carrega o valor. Vocabulário de operadora de celular
// é regressão." A versão anterior tinha a COTA como sujeito de cada linha
// ("Conselheiro: 15 mensagens por dia") — cinco linhas de ração, lidas
// exatamente no segundo em que a pessoa não quer fazer a conta do próprio
// uso. O número continua aqui, e continua exato: mudou de sujeito para
// PROVA. Quem reescrever isto de volta para "recurso: N por período" está
// desfazendo uma decisão do PRINCIPIOS, não melhorando a redação.
const PLUS_BENEFITS = [
  "Perguntar quando a dúvida aparece, não quando a semana virar — 15 conversas por dia",
  "Contar o dia quantas vezes quiser: 30 capturas por dia, sem escolher o que vale a pena",
  "Uma leitura da sua vida toda manhã, avisada no seu WhatsApp",
  "A foto do prato e a fatura em PDF viram registro: 30 refeições e 10 documentos por mês",
  "Cinco planos vivos ao mesmo tempo — e um Conselheiro que lembra de 150 coisas suas",
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
            {/* "Conhecer" nomeia uma atividade (ler mais), não um resultado —
                e ao lado de um "Agora não" bem escrito, a saída ficava mais
                clara que a entrada. O rótulo agora diz o resultado E responde
                a última dúvida de quem tem orçamento apertado: tocar aqui
                não cobra nada, leva para uma tela de comparação. */}
            <Button onClick={() => { onClose(); navigate("/app/assinatura"); }}>
              Ver o que muda — sem pagar nada agora
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