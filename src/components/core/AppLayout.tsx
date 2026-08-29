import { NavLink, Outlet, Link } from "react-router-dom";
import { Sun, Moon, MessageCircle, Mountain, BarChart3, Settings } from "lucide-react";
import { useXp } from "@/hooks/useXp";
import { useTheme } from "@/hooks/useTheme";
import Logo from "@/components/core/Logo";
import FeedbackDialog from "@/components/core/FeedbackDialog";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Hoje", icon: Sun, end: true },
  { to: "/app/pilares", label: "Pilares", icon: Mountain },
  { to: "/app/conselheiro", label: "Conselheiro", icon: MessageCircle },
  { to: "/app/score", label: "Indicadores", icon: BarChart3 },
  { to: "/app/ajustes", label: "Ajustes", icon: Settings },
];

/* O anel de foco só existia dentro de `Button`. Todo elemento interativo cru
   daqui (toggle de tema, links de navegação, selo de nível) caía no outline
   padrão do navegador — visível, mas estranho ao resto do sistema. */
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function ThemeToggle() {
  const { isDark, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
        FOCUS_RING,
      )}
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

function LevelBadge() {
  const { level, progress, xp } = useXp();
  return (
    <Link
      to="/app/score"
      className={cn("flex items-center gap-2 group rounded-full", FOCUS_RING)}
      aria-label={`Nível ${level}, ${xp} XP`}
    >
      <div className="relative w-9 h-9">
        <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15" fill="none"
            stroke="hsl(var(--gold))" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${progress * 94.2} 94.2`}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gold-ink">
          {level}
        </span>
      </div>
      <div className="hidden sm:block leading-tight">
        <p className="text-xs font-semibold">Nível {level}</p>
        <p className="text-[11px] text-muted-foreground">{xp} XP</p>
      </div>
    </Link>
  );
}

export default function AppLayout() {
  return (
    <div className="min-h-dvh bg-background bg-ether">
      {/* Primeira parada do Tab: pular o cabeçalho e os cinco itens de
          navegação, que se repetem em toda rota. */}
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

      {/* Topo — cristal.
          `viewport-fit=cover` + standalone/WKWebView fazem o conteúdo passar
          por baixo da status bar e da Dynamic Island. O recuo entra como
          padding do cabeçalho para que o vidro suba até a borda da tela em
          vez de deixar uma faixa transparente. */}
      <header className="sticky top-0 z-30 glass border-x-0 border-t-0 rounded-none safe-top">
        <div className="container flex items-center justify-between h-14">
          <Link to="/app" aria-label="Ascende — início" className={cn("rounded-full", FOCUS_RING)}>
            <Logo size="sm" />
          </Link>

          {/* Navegação desktop. Breakpoint em `lg` (1024px), não `md` (768px):
              achado de QA ao vivo — entre 768-840px (iPad em retrato incluído)
              o header não tinha largura para logo + 5 itens + ações à direita
              sem colidir. Abaixo de 1024px a pílula flutuante inferior assume
              (já testada sem overflow em nenhum viewport). */}
          <nav className="hidden lg:flex items-center gap-1" aria-label="Principal">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to} to={to} end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors",
                    FOCUS_RING,
                    isActive ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )
                }
              >
                <Icon className="w-4 h-4" /> {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            {/* Canal TEMPORÁRIO de feedback (fase de consolidação) */}
            <FeedbackDialog />
            <ThemeToggle />
            <LevelBadge />
          </div>
        </div>
      </header>

      {/* `tabIndex={-1}` para que o skip-link consiga pousar o foco aqui. */}
      <main id="conteudo" tabIndex={-1} className="container pb-32 lg:pb-10 pt-5 focus:outline-none">
        <Outlet />
      </main>

      {/* Navegação inferior mobile/tablet — pílula de cristal flutuante.
          Some só em `lg` (1024px), acompanhando a navegação desktop acima. */}
      <nav
        className="lg:hidden fixed bottom-3 inset-x-3 z-30 max-w-md mx-auto rounded-full glass shadow-lg shadow-black/10"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Principal"
      >
        <div className="grid grid-cols-5 h-16 px-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to} to={to} end={end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-0.5 text-[10px] rounded-full my-1.5 transition-colors",
                  FOCUS_RING,
                  isActive ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground"
                )
              }
            >
              <Icon className="w-5 h-5" /> {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
