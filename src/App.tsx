import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
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
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const Hoje = lazy(() => import("@/pages/Hoje"));
const Chat = lazy(() => import("@/pages/Chat"));
const Pilares = lazy(() => import("@/pages/Pilares"));
const Prosperidade = lazy(() => import("@/pages/Prosperidade"));
const Vitalidade = lazy(() => import("@/pages/Vitalidade"));
const Alimentacao = lazy(() => import("@/pages/Alimentacao"));
const Mente = lazy(() => import("@/pages/Mente"));
const Score = lazy(() => import("@/pages/Score"));
const Batalhas = lazy(() => import("@/pages/Batalhas"));
const Planos = lazy(() => import("@/pages/Planos"));
const Legal = lazy(() => import("@/pages/Legal"));
const Ajustes = lazy(() => import("@/pages/Ajustes"));
const Assinatura = lazy(() => import("@/pages/Assinatura"));
const NotFound = lazy(() => import("@/pages/NotFound"));

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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Suspense fallback={<Splash />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/privacidade" element={<Legal doc="privacidade" />} />
            <Route path="/termos" element={<Legal doc="termos" />} />
            <Route path="/aviso-legal" element={<Legal doc="aviso-legal" />} />
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
              <Route index element={<Hoje />} />
              <Route path="conselheiro" element={<Chat />} />
              <Route path="pilares" element={<Pilares />} />
              <Route path="prosperidade" element={<Prosperidade />} />
              <Route path="vitalidade" element={<Vitalidade />} />
              <Route path="alimentacao" element={<Alimentacao />} />
              <Route path="mente" element={<Mente />} />
              <Route path="batalhas" element={<Batalhas />} />
              <Route path="assinatura" element={<Assinatura />} />
              <Route path="planos" element={<Planos />} />
              <Route path="score" element={<Score />} />
              <Route path="ajustes" element={<Ajustes />} />
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