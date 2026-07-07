import { NavLink, Outlet, Link } from "react-router-dom";
import { Sun, Moon, MessageCircle, Mountain, BarChart3, Settings } from "lucide-react";
import { useXp } from "@/hooks/useXp";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Hoje", icon: Sun, end: true },
  { to: "/app/pilares", label: "Pilares", icon: Mountain },
  { to: "/app/conselheiro", label: "Conselheiro", icon: MessageCircle },
  { to: "/app/score", label: "Score", icon: BarChart3 },
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
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gold">
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
    <div className="min-h-dvh bg-background">
      {/* Topo */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur border-b">
        <div className="container flex items-center justify-between h-14">
          <Link to="/app" className="flex items-center gap-2">
            <svg viewBox="0 0 64 64" className="w-7 h-7" aria-hidden>
              <rect width="64" height="64" rx="16" fill="hsl(var(--primary))" />
              <path d="M14 46 L32 16 L50 46" fill="none" stroke="hsl(var(--gold))" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="32" cy="16" r="4.5" fill="hsl(var(--gold))" />
            </svg>
            <span className="font-display font-semibold text-lg tracking-tight">Ascende</span>
          </Link>

          {/* Navegação desktop */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Principal">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to} to={to} end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors",
                    isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )
                }
              >
                <Icon className="w-4 h-4" /> {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <LevelBadge />
          </div>
        </div>
      </header>

      <main className="container pb-28 md:pb-10 pt-5">
        <Outlet />
      </main>

      {/* Navegação inferior mobile */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t safe-bottom"
        aria-label="Principal"
      >
        <div className="grid grid-cols-5 h-16">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to} to={to} end={end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-0.5 text-[11px]",
                  isActive ? "text-primary font-semibold" : "text-muted-foreground"
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