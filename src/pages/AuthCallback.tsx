// Retorno do login social (OAuth via Supabase) — plano "Login com Google/Apple", Fase 1.
//
// Responsabilidades desta rota:
// 1. Esperar o supabase-js resolver a sessão que chega na URL (PKCE, automático).
// 2. GATE DE CONSENTIMENTO (LGPD): o OAuth pula o checkbox do cadastro, mas o
//    aceite cobre DADOS SENSÍVEIS (saúde, fé, emoções — Art. 11). Se o aceite
//    não está no metadata da conta, mostramos a mesma tela de consentimento e
//    gravamos via updateUser ANTES de liberar o app. Todo primeiro login
//    social passa obrigatoriamente por aqui (é o redirectTo do OAuth).
// 3. Rotear: perfil sem onboarding → /onboarding · senão → /app.
// 4. Erro/cancelamento no provedor → volta ao /auth com mensagem neutra.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import Logo from "@/components/core/Logo";
import { LEGAL_VERSION } from "@/lib/legal";
import { toast } from "sonner";
import { Loader2, CheckCircle2 } from "lucide-react";
import { isStandalone } from "@/lib/googleIdentity";

/** Erro vindo do provedor pode chegar na query (?error=...) ou no hash (#error=...). */
function readOAuthError(): string | null {
  try {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return search.get("error_description") ?? search.get("error") ??
      hash.get("error_description") ?? hash.get("error");
  } catch { return null; }
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // Handoff PWA: o login começou no app instalado e o redirect abriu AQUI,
  // no navegador. Em vez de carregar o app inteiro no lugar errado, esta
  // página confirma o login e orienta a volta — o app entra sozinho ao
  // ganhar foco (ele re-checa a sessão no storage compartilhado).
  const [handoff, setHandoff] = useState(() => {
    try {
      // O sinal principal vem na URL (?handoff=pwa) — atravessa qualquer
      // container de storage. A flag local é o reforço do Android.
      const fromUrl = new URLSearchParams(window.location.search).get("handoff") === "pwa";
      const flagged = localStorage.getItem("ascende-oauth-handoff") === "1";
      localStorage.removeItem("ascende-oauth-handoff"); // consome sempre (evita falso positivo depois)
      return (fromUrl || flagged) && !isStandalone();
    } catch { return false; }
  });

  const oauthError = readOAuthError();
  const hasConsent = Boolean(user?.user_metadata?.accepted_terms_at);

  // Erro/cancelamento no provedor: volta ao /auth, nada foi criado.
  useEffect(() => {
    if (!oauthError) return;
    toast.error("O login não foi concluído. Você pode tentar de novo — nada foi criado.");
    navigate("/auth", { replace: true });
  }, [oauthError, navigate]);

  // Sessão não chegou (link velho, storage bloqueado): não deixar a pessoa
  // presa num spinner — devolve ao /auth com mensagem honesta.
  useEffect(() => {
    if (user || oauthError) return;
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [user, oauthError]);

  useEffect(() => {
    if (!timedOut || user) return;
    toast.error("Não consegui concluir o login agora. Tente de novo.");
    navigate("/auth", { replace: true });
  }, [timedOut, user, navigate]);

  // Sessão pronta + consentimento já registrado → segue o fluxo normal
  // (exceto no handoff: aí a instrução é voltar para o app).
  useEffect(() => {
    if (authLoading || !user || !hasConsent || profileLoading || handoff) return;
    navigate(profile?.onboarded ? "/app" : "/onboarding", { replace: true });
  }, [authLoading, user, hasConsent, profile?.onboarded, profileLoading, handoff, navigate]);

  const confirmConsent = async () => {
    if (!accepted || saving) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({
      data: {
        accepted_terms_at: new Date().toISOString(),
        accepted_terms_version: LEGAL_VERSION,
      },
    });
    setSaving(false);
    if (error) {
      toast.error("Não consegui registrar o aceite. Tente de novo.");
      return;
    }
    if (handoff) return; // a tela de handoff assume — o app abre já logado
    navigate(profile?.onboarded ? "/app" : "/onboarding", { replace: true });
  };

  const declineAndExit = async () => {
    // Sem o consentimento não dá para tratar os dados sensíveis que o app
    // existe para tratar — encerramos a sessão com respeito, sem criar nada.
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  };

  // ── Handoff: login concluído no navegador; a casa é o app ──
  if (user && hasConsent && handoff) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <div className="flex items-center justify-center mb-6"><Logo size="lg" /></div>
          <Card className="p-6 space-y-3">
            <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
            <h1 className="font-display text-xl font-semibold">Login concluído!</h1>
            <p className="text-sm text-muted-foreground">
              Agora é só <strong className="text-foreground">voltar para o app Ascende</strong> —
              você já vai estar dentro. Pode fechar esta aba.
            </p>
            <button
              className="text-xs text-muted-foreground underline"
              onClick={() => { setHandoff(false); }}
            >
              Prefiro continuar aqui no navegador
            </button>
          </Card>
        </div>
      </div>
    );
  }

  // ── Gate de consentimento (primeiro login social) ──
  if (user && !hasConsent) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background px-4">
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-center mb-6"><Logo size="lg" /></div>
          <Card className="p-6 space-y-4">
            <div>
              <h1 className="font-display text-xl font-semibold">Quase lá — só falta o seu aceite</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Sua conta Google foi conectada. Como o Ascende guarda coisas íntimas
                (dinheiro, corpo, fé, emoções), a lei pede — e a gente faz questão — de
                um consentimento explícito seu antes de começar.
              </p>
            </div>
            <label className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer">
              <Checkbox
                checked={accepted}
                onCheckedChange={(v) => setAccepted(!!v)}
                className="mt-0.5"
                aria-label="Aceitar os documentos legais"
              />
              <span className="text-xs text-muted-foreground leading-relaxed">
                Li e aceito os{" "}
                <a href="/termos" target="_blank" rel="noreferrer" className="underline text-foreground">Termos de Uso</a>,{" "}
                a <a href="/privacidade" target="_blank" rel="noreferrer" className="underline text-foreground">Política de Privacidade</a>{" "}
                e o <a href="/aviso-legal" target="_blank" rel="noreferrer" className="underline text-foreground">Aviso Legal</a>,
                incluindo o tratamento dos dados sensíveis que eu optar por informar (saúde, fé, emoções)
                para personalizar minha experiência.
              </span>
            </label>
            <Button className="w-full" onClick={confirmConsent} disabled={!accepted || saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Concluir e começar"}
            </Button>
            <button className="w-full text-xs text-muted-foreground underline" onClick={declineAndExit}>
              Não aceito — sair sem criar nada
            </button>
          </Card>
          <p className="text-center text-xs text-muted-foreground mt-4">
            Seus dados são privados e você pode exportá-los ou apagá-los quando quiser.
          </p>
        </div>
      </div>
    );
  }

  // ── Resolvendo a sessão / roteando ──
  return (
    <div className="min-h-dvh grid place-items-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Logo size="lg" />
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Concluindo seu login...</p>
      </div>
    </div>
  );
}