import { Link } from "react-router-dom";
import { UserRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useProfile } from "@/hooks/useProfile";

/* "Complete seu retrato" — dado de CONTA, não do dia.
 *
 * Morava na Hoje, no fim da segunda seção. Saiu na Fase 4 porque a Hoje passou
 * a ter teto de 5 zonas e uma regra: quem ocupa espaço lá tem que ser sobre
 * HOJE. Completude de perfil é sobre a conta, e por isso vive na folha do
 * avatar, junto de Ajustes e Assinatura.
 *
 * Continua se escondendo sozinho quando o perfil está completo — o componente
 * não é responsável por saber onde está montado. */
export default function ProfileCompleteness() {
  const { profile } = useProfile();
  if (!profile) return null;

  const items = [
    { label: "Ano de nascimento", done: !!profile.birth_year },
    { label: "Sexo", done: !!profile.sex },
    { label: "Altura", done: !!profile.height_cm },
    { label: "Nível de atividade", done: !!profile.activity_level },
  ];
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  const pct = Math.round((done / items.length) * 100);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full grid place-items-center shrink-0 bg-gold/10">
          <UserRound className="w-5 h-5 text-gold-ink" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm font-semibold">Complete seu retrato — {pct}%</p>
            <p className="text-xs text-muted-foreground">
              Com esses dados, o Conselheiro monta planos de verdade em vez de pedir informações.
            </p>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-gold transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {items.filter((i) => !i.done).map((i) => (
              <Link key={i.label} to="/app/ajustes"
                className="text-[11px] rounded-full border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
                + {i.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Seus planos ativos (análise UX item 2): o Blueprint é o clímax de um
   onboarding de 9 blocos — e sumia atrás de dois toques (Pilares > Meus
   planos). Aqui ele volta para a tela onde a pessoa vive, como atalho, sem
   duplicar a gestão: ver, abrir e acompanhar continua em Meus planos. ── */
