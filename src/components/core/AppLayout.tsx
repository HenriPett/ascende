import { useCallback, useMemo, useState, useEffect } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import {
  Sun, Moon, Monitor, MessageCircle, Mountain, Plus, Settings, CreditCard,
  LogOut, ChevronRight, UserRound, MessageSquarePlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useXp } from "@/hooks/useXp";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { useProfile } from "@/hooks/useProfile";
import { CaptureFocusContext, useCaptureFocus } from "@/hooks/useCaptureFocus";
import Logo from "@/components/core/Logo";
import FeedbackDialog from "@/components/core/FeedbackDialog";
import CaptureBar from "@/components/core/CaptureBar";
import ProfileCompleteness from "@/components/core/ProfileCompleteness";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { levelTitle } from "@/lib/xp";
import { NAV, appPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

/* Navegação da Fase 4:  Hoje · Jornada · [REGISTRAR] · Conselheiro · avatar
 *
 * Os caminhos vêm de NAV (src/lib/routes.ts do Forge) e não escritos à mão —
 * caminho na mão é como uma rota antiga morre sem ninguém ver. REGISTRAR não
 * está em NAV de propósito: é AÇÃO, não rota, e por isso também nunca mostra
 * estado ativo.
 *
 * Pilares, Indicadores, Planos e Batalhas saíram da BARRA e viraram seções do
 * hub /app/jornada — mas continuam com rota própria, abrindo a tela inteira.
 * O hub é uma porta a mais, nunca a única porta. */

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/* Estado ativo: o preenchimento neutro é o indicador, não a cor.
   O anterior era `bg-primary/15 text-primary` — dourado de 10px sobre vidro
   dá ~1,9:1 de contraste, e era o único sinal de "onde estou" no celular.
   O dourado fica reservado ao REGISTRAR, onde é fundo cheio com texto escuro:
   um só protagonista, como o index.css declara. */
const cellBase = "flex flex-col items-center justify-center gap-0.5 text-[10px] rounded-full my-1.5 transition-colors";
const cellActive = "bg-muted text-foreground font-semibold";
const cellIdle = "text-muted-foreground";

function NavCell({ to, label, icon: Icon, end }: {
  to: string; label: string; icon: LucideIcon; end?: boolean;
}) {
  return (
    <NavLink
      to={to} end={end}
      className={({ isActive }) => cn(cellBase, FOCUS_RING, isActive ? cellActive : cellIdle)}
    >
      <Icon className="w-5 h-5" />
      <span className="max-w-full truncate px-0.5">{label}</span>
    </NavLink>
  );
}

/* ── REGISTRAR ────────────────────────────────────────────────────────────
   Dominante SEM ocupar área nova: é a célula central da pílula que já existe,
   já flutua e cujo espaço o `main` já reserva. O círculo estoura 14px para
   cima dentro do bloco da barra — não ganha um metro quadrado de tela e não
   passa a cobrir nada que antes estava visível. A dominância vem de três
   coisas que não custam área: ser o único fundo cheio, ser redondo entre
   retângulos, e quebrar a linha da barra.

   O slot de layout tem o MESMO tamanho do ícone das outras células (20px) e o
   círculo é posicionado sobre ele — assim o rótulo "Registrar" fica na mesma
   linha de base dos outros quatro. */
function RegisterCell({ onSheet }: { onSheet: () => void }) {
  const focus = useCaptureFocus();
  return (
    <button
      type="button"
      onClick={() => (focus ? focus() : onSheet())}
      aria-label="Registrar o que aconteceu"
      className={cn(cellBase, FOCUS_RING, "text-foreground font-semibold")}
    >
      <span className="relative w-5 h-5">
        <span
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -mt-3.5 w-14 h-14 rounded-full bg-primary text-primary-foreground grid place-items-center shadow-lg shadow-black/15"
          aria-hidden
        >
          <Plus className="w-6 h-6" />
        </span>
      </span>
      <span>Registrar</span>
    </button>
  );
}

/* ── Avatar ───────────────────────────────────────────────────────────────
   Fica na barra DE BAIXO, não no topo: em 390px com uma mão, o canto superior
   direito é a pior área de alcance da tela, e mandar Ajustes para lá seria
   trocar "fora da barra" por "fora do alcance". */
function AvatarCell({ onOpen }: { onOpen: () => void }) {
  const { level, progress } = useXp();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Sua conta e ajustes"
      className={cn(cellBase, FOCUS_RING, cellIdle)}
    >
      <span className="relative w-5 h-5 grid place-items-center">
        <svg viewBox="0 0 36 36" className="absolute w-7 h-7 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15" fill="none"
            stroke="hsl(var(--gold))" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${progress * 94.2} 94.2`}
          />
        </svg>
        <span className="relative text-[10px] font-bold text-gold-ink">{level}</span>
      </span>
      <span>Conta</span>
    </button>
  );
}

/* ── A folha da conta ─────────────────────────────────────────────────────
   Ajustes sair da barra não pode virar Ajustes ficar difícil de achar. "Conta"
   estava espalhada: tema no header, assinatura dentro de Ajustes, sair no fim
   de um scroll longo. A folha junta tudo ao alcance do polegar — é isso que
   justifica a saída da barra. Linhas de 48px. */
const THEMES: { id: Theme; label: string; icon: LucideIcon }[] = [
  { id: "light", label: "Claro", icon: Sun },
  { id: "dark", label: "Escuro", icon: Moon },
  { id: "system", label: "Sistema", icon: Monitor },
];

function AccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { profile } = useProfile();
  const { xp, level } = useXp();
  const { theme, setTheme } = useTheme();
  const close = () => onOpenChange(false);

  const row = "flex items-center justify-between gap-3 h-12 px-3 rounded-lg hover:bg-muted/60 transition-colors text-sm";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Duas correções de toque nesta folha, ambas medidas em QA:
       *
       * N5 — o "Fechar" do SheetContent é 16x16 (um ícone de 16px num botão
       * sem tamanho). Escape resolve no teclado; no celular não existe
       * Escape. Aqui ele vira 44x44 SEM mudar de lugar: o botão é
       * `absolute right-4 top-4`, então o ícone estava centrado a 24px de
       * cada borda (16 + 16/2). Com a caixa em 44px, `right-0.5 top-0.5`
       * recoloca esse centro exatamente em 24px (2 + 44/2) — cresce a área,
       * o desenho fica onde estava.
       *
       * N6 — `safe-bottom` sozinho ZERAVA o respiro: ele declara
       * `padding-bottom: env(safe-area-inset-bottom)`, que num aparelho sem
       * recorte vale 0 e, sendo uma utility mais específica, apagava o `p-6`
       * do próprio SheetContent. A última linha ("Sair da conta", feedback)
       * terminava colada no rodapé do viewport — em iPhone, dentro dos ~34px
       * do indicador de home, onde o toque vira gesto do sistema. O `calc`
       * SOMA o recorte ao padding em vez de substituí-lo: 24px sempre, mais
       * o que o aparelho pedir. */}
      <SheetContent
        side="bottom"
        className={cn(
          "rounded-t-2xl max-h-[85dvh] overflow-y-auto",
          "pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
          "[&>button]:h-11 [&>button]:w-11 [&>button]:grid [&>button]:place-items-center [&>button]:right-0.5 [&>button]:top-0.5",
        )}
      >
        <SheetHeader className="text-left">
          <SheetTitle className="font-display">
            {profile?.name ? String(profile.name).split(" ")[0] : "Sua conta"}
          </SheetTitle>
        </SheetHeader>

        <Link to={appPath("score")} onClick={close} className={cn(row, "border", FOCUS_RING)}>
          <span>
            Nível {level} · {levelTitle(level)}
            <span className="block text-xs text-muted-foreground">{xp} XP</span>
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Link>

        {/* O "Complete seu retrato" saiu da Hoje e mora aqui: é dado de CONTA,
            não do dia. Ele se esconde sozinho quando o perfil está completo. */}
        <div className="[&>*]:mt-0">
          <ProfileCompleteness />
        </div>

        <div className="space-y-0.5">
          <Link to={NAV.avatar} onClick={close} className={cn(row, FOCUS_RING)}>
            <span className="flex items-center gap-2"><Settings className="w-4 h-4" /> Ajustes</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </Link>
          <Link to={appPath("assinatura")} onClick={close} className={cn(row, FOCUS_RING)}>
            <span className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> Assinatura</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </Link>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground px-3">Tema</p>
          <div className="grid grid-cols-3 gap-1.5">
            {THEMES.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={theme === id ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme(id)}
                aria-pressed={theme === id}
              >
                <Icon className="w-3.5 h-3.5 mr-1.5" /> {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          {/* O gatilho padrão do FeedbackDialog é 36x36. Ele aceita um
              `trigger` próprio, então o alvo cresce aqui — sem tocar no
              componente, que tem outro dono, e sem inchar o ícone: a caixa vai
              a 44x44 e o MessageSquarePlus continua com 16px. */}
          <FeedbackDialog
            trigger={
              <button
                type="button"
                className={cn(
                  "w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
                  FOCUS_RING,
                )}
                aria-label="Enviar feedback sobre a plataforma"
                title="Enviar feedback"
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>
            }
          />
          <Button
            variant="ghost" size="sm" className="text-muted-foreground"
            onClick={async () => { close(); await supabase.auth.signOut(); }}
          >
            <LogOut className="w-4 h-4 mr-1.5" /> Sair da conta
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A captura fora da Hoje: a MESMA CaptureBar, numa folha. Fecha sozinha no
 *  `onConfirmed` — a prop já existia. */
function CaptureSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Mesmo alvo de fechar e mesmo respiro de rodapé da folha da conta —
          o motivo está comentado lá. */}
      <SheetContent
        side="bottom"
        className={cn(
          "rounded-t-2xl max-h-[85dvh] overflow-y-auto",
          "pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
          "[&>button]:h-11 [&>button]:w-11 [&>button]:grid [&>button]:place-items-center [&>button]:right-0.5 [&>button]:top-0.5",
        )}
      >
        <SheetHeader className="text-left">
          <SheetTitle className="font-display">Registrar</SheetTitle>
        </SheetHeader>
        <CaptureBar onConfirmed={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

export default function AppLayout() {
  const [accountOpen, setAccountOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const { pathname } = useLocation();

  /* As folhas fecham na troca de rota.
   *
   * O AppLayout NÃO desmonta quando a rota muda, e nada ligava este estado ao
   * histórico — então a folha atravessava a navegação. Bug encontrado em QA ao
   * vivo, reproduzível 100%: abrir a Jornada, tocar REGISTRAR, e voltar no
   * botão do navegador aterrissava na Hoje com a folha aberta POR CIMA da
   * caixa de captura que já vive naquela tela. Duas caixas idênticas, na mesma
   * tela — exatamente o que a Fase 4 escreveu que não podia acontecer (ver
   * useCaptureFocus.tsx). E, de quebra, o REGISTRAR parava de focar a caixa de
   * baixo, mudando de comportamento sem a pessoa ter pedido.
   *
   * Vale para a folha da conta pelo mesmo motivo: navegar por um link de
   * dentro dela deixava o painel aberto sobre a tela nova. */
  useEffect(() => {
    setCaptureOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  // Ponte do REGISTRAR: a tela que embute a captura registra aqui como focá-la.
  const [focus, setFocus] = useState<(() => void) | null>(null);
  const register = useCallback((fn: (() => void) | null) => setFocus(() => fn), []);
  const captureCtx = useMemo(() => ({ register, focus }), [register, focus]);

  /* A REGRA, escrita como estado impossível em vez de como lembrete.
   *
   * O efeito acima fecha as folhas quando a ROTA muda, e isso funciona — o
   * passo a passo do QA (Jornada → REGISTRAR → voltar) foi remedido e não
   * reproduz mais. Mas "fechar na troca de rota" é um PROXY da regra; a regra
   * mesma, escrita em useCaptureFocus.tsx, é outra: uma ação por tela — a
   * folha de captura nunca pode coexistir com a caixa que a tela já embute.
   *
   * Enquanto a garantia depender de alguém lembrar de fechar no evento certo,
   * ela vale só para os eventos que alguém lembrou. Aqui a folha passa a ser
   * DERIVADA: se existe captura embutida registrada (`focus` não é nulo),
   * a folha não abre, ponto — não importa como a pessoa chegou nesse estado,
   * se por voltar no navegador, por link, por restauração de sessão ou por um
   * caminho que ninguém mapeou ainda. Duas caixas idênticas deixam de ser um
   * estado que o componente consegue representar.
   *
   * Isto não substitui o efeito de cima, complementa: o efeito zera
   * `captureOpen` a cada navegação, e por isso uma folha suprimida aqui nunca
   * reaparece sozinha ao chegar numa tela sem captura embutida. */
  const captureSheetOpen = captureOpen && !focus;

  return (
    <CaptureFocusContext.Provider value={captureCtx}>
      <div className="min-h-dvh bg-background bg-ether">
        <a
          href="#conteudo"
          className={cn(
            "sr-only focus:not-sr-only focus:fixed focus:left-3 focus:z-50 focus:rounded-full",
            "focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg",
            "focus:top-[calc(env(safe-area-inset-top,0px)+0.75rem)]",
            FOCUS_RING,
          )}
        >
          Pular para o conteúdo
        </a>

        <header className="sticky top-0 z-30 glass border-x-0 border-t-0 rounded-none safe-top">
          <div className="container flex items-center justify-between h-14">
            <Link to={NAV.hoje} aria-label="Ascende — início" className={cn("rounded-full", FOCUS_RING)}>
              <Logo size="sm" />
            </Link>

            {/* Navegação desktop: os mesmos cinco alvos, com Registrar como
                botão preenchido e o avatar à direita. */}
            <nav className="hidden lg:flex items-center gap-1" aria-label="Principal">
              {[
                { to: NAV.hoje, label: "Hoje", icon: Sun, end: true },
                { to: NAV.jornada, label: "Jornada", icon: Mountain },
                { to: NAV.conselheiro, label: "Conselheiro", icon: MessageCircle },
              ].map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to} to={to} end={end}
                  className={({ isActive }) => cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors",
                    FOCUS_RING,
                    isActive ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                  )}
                >
                  <Icon className="w-4 h-4" /> {label}
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-1.5">
              <div className="hidden lg:block">
                <RegisterDesktop onSheet={() => setCaptureOpen(true)} />
              </div>
              <button
                type="button"
                onClick={() => setAccountOpen(true)}
                aria-label="Sua conta e ajustes"
                className={cn("hidden lg:grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors", FOCUS_RING)}
              >
                <UserRound className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        <main id="conteudo" tabIndex={-1} className="container pb-32 lg:pb-10 pt-5 focus:outline-none">
          <Outlet />
        </main>

        {/* A pílula NÃO pode ganhar overflow-hidden: o REGISTRAR estoura a
            borda de cima de propósito. */}
        <nav
          className="lg:hidden fixed bottom-3 inset-x-3 z-30 max-w-md mx-auto rounded-full glass shadow-lg shadow-black/10"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
          aria-label="Principal"
        >
          <div className="grid grid-cols-5 h-16 px-1">
            <NavCell to={NAV.hoje} label="Hoje" icon={Sun} end />
            <NavCell to={NAV.jornada} label="Jornada" icon={Mountain} />
            <RegisterCell onSheet={() => setCaptureOpen(true)} />
            <NavCell to={NAV.conselheiro} label="Conselheiro" icon={MessageCircle} />
            <AvatarCell onOpen={() => setAccountOpen(true)} />
          </div>
        </nav>

        <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
        <CaptureSheet open={captureSheetOpen} onOpenChange={setCaptureOpen} />
      </div>
    </CaptureFocusContext.Provider>
  );
}

function RegisterDesktop({ onSheet }: { onSheet: () => void }) {
  const focus = useCaptureFocus();
  return (
    <Button size="sm" onClick={() => (focus ? focus() : onSheet())} aria-label="Registrar o que aconteceu">
      <Plus className="w-4 h-4 mr-1.5" /> Registrar
    </Button>
  );
}
