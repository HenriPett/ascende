import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import AppLayout from "@/components/core/AppLayout";
import Landing from "@/pages/Landing";
import Auth from "@/pages/Auth";
import Onboarding from "@/pages/Onboarding";
import Hoje from "@/pages/Hoje";
import Chat from "@/pages/Chat";
import Pilares from "@/pages/Pilares";
import Prosperidade from "@/pages/Prosperidade";
import Vitalidade from "@/pages/Vitalidade";
import Alimentacao from "@/pages/Alimentacao";
import Mente from "@/pages/Mente";
import Score from "@/pages/Score";
import Batalhas from "@/pages/Batalhas";
import Ajustes from "@/pages/Ajustes";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Splash() {
  return (
    <div className="min-h-dvh grid place-items-center bg-background">
      <div className="animate-pulse font-display text-xl text-muted-foreground">Ascend</div>
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
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
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
              <Route path="score" element={<Score />} />
              <Route path="ajustes" element={<Ajustes />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  );
}