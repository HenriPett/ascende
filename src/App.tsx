import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { syncAnalytics } from "@/lib/analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import AppLayout from "@/components/core/AppLayout";
// Carregamento sob demanda por rota (plano §6.4): o usuário não baixa o app
// inteiro para abrir a tela Hoje. Landing e Auth ficam no bundle inicial
// (primeira visita); cada página do app vira um chunk próprio.
import Landing from "@/pages/Landing";
import Auth from "@/pages/Auth";
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const Legal = lazy(() => import("@/pages/Legal"));
const Recusas = lazy(() => import("@/pages/Recusas"));
const NotFound = lazy(() => import("@/pages/NotFound"));
// As páginas de /app vivem no registro de rotas: é ele que o teste usa para
// provar que nenhuma rota antiga sumiu ou virou redirect (src/lib/routes.ts).
import { APP_ROUTES } from "@/lib/routes";
// Fica no bundle inicial de propósito: ele precisa rodar ANTES do primeiro
// <Navigate> de RequireAuth, que é quem apaga o `?convite=` da URL.
import { GuardaDoConvite } from "@/components/social/ConviteEmTransito";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Splash() {
  return (
    <div className="min-h-dvh grid place-items-center bg-background">
      <div className="animate-pulse font-display text-xl text-muted-foreground">Ascende</div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/auth" state={{ from: location }} replace />;
  return <>{children}</>;
}

function RequireOnboarded({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useProfile();
  if (loading) return <Splash />;
  if (profile && !profile.onboarded) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/* Telemetria só nas páginas públicas: como a SPA troca de rota sem recarregar,
   a decisão precisa ser reavaliada a cada navegação (ver src/lib/analytics.ts). */
function AnalyticsGate() {
  const { pathname } = useLocation();
  useEffect(() => { syncAnalytics(pathname); }, [pathname]);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <AnalyticsGate />
          {/* Guarda o `?convite=` antes que o redirecionamento para /auth ou
              /onboarding leve a URL embora. Ver ConviteEmTransito.tsx. */}
          <GuardaDoConvite />
          <Suspense fallback={<Splash />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/privacidade" element={<Legal doc="privacidade" />} />
            <Route path="/termos" element={<Legal doc="termos" />} />
            <Route path="/aviso-legal" element={<Legal doc="aviso-legal" />} />
            <Route path="/recusas" element={<Recusas />} />
            <Route
              path="/onboarding"
              element={<RequireAuth><Onboarding /></RequireAuth>}
            />
            <Route
              path="/app"
              element={
                <RequireAuth>
                  <RequireOnboarded>
                    <AppLayout />
                  </RequireOnboarded>
                </RequireAuth>
              }
            >
              {/* Montadas a partir de APP_ROUTES. Nenhuma rota de /app pode
                  ser um <Navigate>: alias renderiza a tela, não redireciona
                  (ver o cabeçalho de src/lib/routes.ts). */}
              {APP_ROUTES.map(({ path, Component }) => (
                path === ""
                  ? <Route key="__index" index element={<Component />} />
                  : <Route key={path} path={path} element={<Component />} />
              ))}
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster position="top-center" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  );
}