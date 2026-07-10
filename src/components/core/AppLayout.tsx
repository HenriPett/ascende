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

function ThemeToggle() {
  const { isDark, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
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
    <Link to="/app/score" className="flex items-center gap-2 group" aria-label={`Nível ${level}, ${xp} XP`}>
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
      {/* Topo — cristal */}
      <header className="sticky top-0 z-30 glass border-x-0 border-t-0 rounded-none">
        <div className="container flex items-center justify-between h-14">
          <Link to="/app" aria-label="Ascende — início">
            <Logo size="sm" />
          </Link>

          {/* Navegação desktop */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Principal">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to} to={to} end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors",
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

      <main className="container pb-32 md:pb-10 pt-5">
        <Outlet />
      </main>

      {/* Navegação inferior mobile — pílula de cristal flutuante */}
      <nav
        className="md:hidden fixed bottom-3 inset-x-3 z-30 max-w-md mx-auto rounded-full glass shadow-lg shadow-black/10"
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