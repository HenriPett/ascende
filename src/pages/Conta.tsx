import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { ChevronRight, CreditCard, LogOut, MessageSquarePlus, Settings, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useXp } from "@/hooks/useXp";
import { useProfile } from "@/hooks/useProfile";
import FeedbackDialog from "@/components/core/FeedbackDialog";
import ProfileCompleteness from "@/components/core/ProfileCompleteness";
import { levelTitle } from "@/lib/xp";
import { NAV, appPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   CONTA — o que antes era uma folha aberta pela quinta célula da barra
   ═══════════════════════════════════════════════════════════════════════════

   POR QUE VIROU PÁGINA. A folha da conta fazia a barra de baixo prometer cinco
   lugares e entregar três lugares e dois gestos: "Conta" abria uma folha por
   cima da aba em que a pessoa estava, e nunca ficava acesa — ali a barra
   deixava de responder "onde eu estou" (`tab-bars.md › Best practices`: "Use a
   tab bar to support navigation, not to provide actions"). Como lugar, ela
   acende como as outras, e Ajustes e Assinatura — que se abrem daqui — passam a
   ser da seção dela e ganham o VOLTAR do cabeçalho.

   O QUE NÃO MUDOU, e era o argumento original da folha: ela continua EMBAIXO,
   na barra, ao alcance do polegar. O canto superior direito, onde muitos apps
   põem a conta, é a pior área de alcance de um iPhone segurado com uma mão.

   O QUE SAIU DAQUI:
   · O SELETOR DE TEMA. Ele disputava o primeiro nível com Assinatura e Sair, e
     o iOS pede o contrário: o app segue a aparência do sistema, e uma escolha
     própria, se existir, é coisa de Ajustes, não de primeiro nível
     (`dark-mode.md`: "Avoid offering an app-specific appearance setting"). Ele
     mora em Ajustes, com "Automático" primeiro.
   · O MODAL SOBRE MODAL. O "Enviar feedback" abria um diálogo por cima da
     folha, que continuava aberta embaixo (`sheets.md`: "Display only one sheet
     at a time"). Numa página, o diálogo é o único modal da tela.

   As linhas têm 48 pt, como tinham na folha, e ficam agrupadas como uma lista
   do iOS: um cartão, linhas separadas por fio, e o chevron dizendo "isto abre
   outra tela". */

const LINHA =
  "flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-body " +
  "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-inset focus-visible:ring-ring";

function Linha({ to, icone, children }: { to: string; icone: ReactNode; children: ReactNode }) {
  return (
    <Link to={to} className={LINHA}>
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-muted-foreground" aria-hidden>{icone}</span>
        <span className="min-w-0">{children}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

export default function Conta() {
  const { profile } = useProfile();
  const { xp, level } = useXp();
  const primeiroNome = profile?.name ? String(profile.name).split(" ")[0] : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5 animate-fade-up">
      <h1 className="font-display text-2xl font-semibold">{primeiroNome ?? "Sua conta"}</h1>

      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        <Linha to={appPath("score")} icone={<Trophy className="h-5 w-5" />}>
          Nível {level} · {levelTitle(level)}
          <span className="block text-footnote text-muted-foreground">{xp} XP</span>
        </Linha>
      </div>

      {/* O "Complete seu retrato" mora aqui desde que saiu da Hoje: é dado de
          CONTA, não do dia. Ele se esconde sozinho quando o perfil está
          completo. */}
      <div className="[&>*]:mt-0">
        <ProfileCompleteness />
      </div>

      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        <Linha to={NAV.avatar} icone={<Settings className="h-5 w-5" />}>Ajustes</Linha>
        <Linha to={appPath("assinatura")} icone={<CreditCard className="h-5 w-5" />}>Assinatura</Linha>
      </div>

      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        <FeedbackDialog
          trigger={
            <button type="button" className={LINHA}>
              <span className="flex items-center gap-3">
                <MessageSquarePlus className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                Enviar feedback
              </span>
            </button>
          }
        />
        {/* Sair não é destrutivo — nada se apaga, e entrar de novo devolve
            tudo — então não ganha vermelho nem confirmação. Vermelho, nesta
            casa, é para o que não volta. */}
        <button
          type="button"
          className={cn(LINHA, "text-muted-foreground")}
          onClick={() => { void supabase.auth.signOut(); }}
        >
          <span className="flex items-center gap-3">
            <LogOut className="h-5 w-5 shrink-0" aria-hidden />
            Sair da conta
          </span>
        </button>
      </div>
    </div>
  );
}
