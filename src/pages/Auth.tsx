import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import Logo from "@/components/core/Logo";
import { Checkbox } from "@/components/ui/checkbox";
import { LEGAL_VERSION } from "@/lib/legal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, MailCheck, Sparkles, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { loadGis, makeNoncePair, isStandalone } from "@/lib/googleIdentity";

export default function Auth() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  // Tela de confirmação de e-mail (análise UX P1.2): o ponto de maior
  // motivação do funil não pode morrer num toast de 4 segundos.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const resend = async () => {
    if (!pendingEmail || resendIn > 0) return;
    const { error } = await supabase.auth.resend({ type: "signup", email: pendingEmail });
    if (error) { toast.error("Não consegui reenviar agora. Tente em instantes."); return; }
    toast.success("Link reenviado! Confira também a caixa de spam.");
    setResendIn(30);
  };

  useEffect(() => {
    // Já logado visitando /auth: rota pelo /auth/callback, que aplica o gate
    // de consentimento quando faltar e decide onboarding × app.
    if (!authLoading && user) navigate("/auth/callback", { replace: true });
  }, [user, authLoading, navigate]);

  // ── Login social (Fase 1: Google; Apple pronto para ligar na Fase 2) ──
  // O consentimento LGPD acontece no /auth/callback (gate) — por isso o
  // botão NÃO depende do checkbox de termos desta tela.
  //
  // MÉTODO PRINCIPAL: GIS + signInWithIdToken (sem redirect de página).
  // Motivo: no app instalado (PWA), o redirect volta no NAVEGADOR e não na
  // janela do app — a sessão nunca chega (iOS separa até o storage) e o
  // botão ficava carregando para sempre. Com o GIS, o ID token chega na
  // MESMA janela e a sessão nasce aqui. O redirect fica como fallback para
  // quando VITE_GOOGLE_CLIENT_ID não está configurado ou o script não carrega.
  const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  // iOS + app instalado: o popup do GIS perde o vínculo com a janela
  // (standalone), então lá o caminho DETERMINÍSTICO é o redirect + handoff
  // (fluxo implícito: quem recebe o retorno se basta; no iOS moderno o
  // overlay compartilha o data store com o app, que entra ao ganhar foco).
  const iosStandalone = isStandalone() && /iP(hone|ad|od)/.test(navigator.userAgent);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const [gisState, setGisState] = useState<"loading" | "ready" | "fallback">(
    GOOGLE_CLIENT_ID && !iosStandalone ? "loading" : "fallback"
  );

  useEffect(() => {
    if (gisState !== "fallback") return;
    if (iosStandalone) {
      console.info("[Ascende] iOS instalado: login Google via redirect + handoff (deliberado).");
      return;
    }
    console.warn(
      GOOGLE_CLIENT_ID
        ? "[Ascende] Script do Google (GIS) não carregou — login Google caiu no modo redirect."
        : "[Ascende] VITE_GOOGLE_CLIENT_ID ausente NO BUILD — login Google está em modo redirect. " +
          "Configure a env no provedor de deploy e refaça o build."
    );
  }, [gisState, GOOGLE_CLIENT_ID, iosStandalone]);
  const gisButtonRef = useRef<HTMLDivElement>(null);
  const nonceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || iosStandalone) return;
    let cancelled = false;
    (async () => {
      const ok = await loadGis();
      if (cancelled) return;
      if (!ok || !window.google?.accounts?.id) { setGisState("fallback"); return; }
      try {
        const { nonce, hashedNonce } = await makeNoncePair();
        nonceRef.current = nonce;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: hashedNonce,
          callback: async (resp: { credential?: string }) => {
            if (!resp?.credential) return;
            setOauthLoading("google");
            const { error } = await supabase.auth.signInWithIdToken({
              provider: "google",
              token: resp.credential,
              nonce: nonceRef.current ?? undefined,
            });
            if (error) {
              setOauthLoading(null);
              toast.error("Não consegui entrar com o Google. Tente de novo.");
              return;
            }
            // Sessão criada NESTA janela: o callback decide gate de
            // consentimento → onboarding → app.
            navigate("/auth/callback", { replace: true });
          },
        });
        setGisState("ready");
      } catch {
        setGisState("fallback");
      }
    })();
    return () => { cancelled = true; };
  }, [GOOGLE_CLIENT_ID, navigate]);

  // Renderiza o botão oficial do Google quando o GIS fica pronto.
  useEffect(() => {
    if (gisState !== "ready" || !gisButtonRef.current || !window.google?.accounts?.id) return;
    gisButtonRef.current.innerHTML = "";
    window.google.accounts.id.renderButton(gisButtonRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: Math.min(400, Math.max(200, gisButtonRef.current.offsetWidth || 336)),
    });
  }, [gisState]);

  // Fallback (redirect): usado só sem VITE_GOOGLE_CLIENT_ID / script bloqueado.
  const signInWithProvider = async (provider: "google" | "apple") => {
    setOauthLoading(provider);
    // Saindo do app instalado para o navegador: sinaliza o handoff para a
    // página de callback orientar a volta. O sinal vai na PRÓPRIA URL de
    // retorno (query param) porque no iOS o overlay pode ser outro container
    // de storage — localStorage não atravessa. (No Android mantemos também a
    // flag local, redundância inofensiva.)
    const standalone = isStandalone();
    try { if (standalone) localStorage.setItem("ascende-oauth-handoff", "1"); } catch { /* noop */ }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback${standalone ? "?handoff=pwa" : ""}`,
      },
    });
    if (error) {
      setOauthLoading(null);
      toast.error("Não consegui abrir o login agora. Tente de novo.");
    }
    // Sucesso: o navegador navega para o provedor — não resetar o loading.
  };

  // Volta ao app depois do fluxo externo: 1) re-checa a sessão direto no
  // storage — se o login foi concluído no overlay do navegador (Android
  // compartilha o storage entre Chrome e PWA), o app entra sozinho ao
  // ganhar foco; 2) senão, destrava o botão em vez de girar para sempre.
  // pageshow cobre o bfcache.
  useEffect(() => {
    let checking = false;
    const onReturn = async () => {
      if (document.visibilityState !== "visible" || checking) return;
      checking = true;
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          navigate("/auth/callback", { replace: true });
          return;
        }
        setOauthLoading(null);
      } finally {
        checking = false;
      }
    };
    window.addEventListener("pageshow", onReturn);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("pageshow", onReturn);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [navigate]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      if (error.message.toLowerCase().includes("not confirmed")) {
        setPendingEmail(email);
        return;
      }
      toast.error(
        error.message.includes("Invalid login")
          ? "E-mail ou senha incorretos."
          : "Não foi possível entrar. Tente de novo."
      );
      return;
    }
    navigate("/auth/callback", { replace: true });
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error("A senha precisa ter pelo menos 8 caracteres."); return; }
    if (!acceptedTerms) {
      toast.error("Para criar a conta, é preciso ler e aceitar os Termos, a Política de Privacidade e o Aviso Legal.");
      return;
    }
    setLoading(true);
    const { error, data } = await supabase.auth.signUp({
      email, password,
      options: {
        data: {
          name,
          // Registro auditável do consentimento (LGPD): quando e qual versão foi aceita
          accepted_terms_at: new Date().toISOString(),
          accepted_terms_version: LEGAL_VERSION,
        },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(
        error.message.includes("already registered")
          ? "Este e-mail já tem conta. Use a aba Entrar."
          : "Não foi possível criar a conta. Tente de novo."
      );
      return;
    }
    if (data.session) {
      navigate("/onboarding", { replace: true });
    } else {
      setPendingEmail(email);
      setResendIn(30);
    }
  };

  // Tela dedicada: enquanto o link não é clicado, mostramos o que espera
  // do outro lado — a motivação continua viva até o e-mail chegar.
  if (pendingEmail) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background px-4">
        <div className="w-full max-w-sm">
          <Link to="/" className="flex items-center justify-center mb-6"><Logo size="lg" /></Link>
          <Card className="p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-gold/10 grid place-items-center mx-auto">
              <MailCheck className="w-6 h-6 text-gold-ink" />
            </div>
            <div>
              <h1 className="font-display text-xl font-semibold">Confirme seu e-mail</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Enviamos um link para <strong className="text-foreground">{pendingEmail}</strong>.
                Toque nele e volte aqui — sua conta já está reservada.
              </p>
            </div>
            <div className="rounded-lg border p-3 text-left space-y-1.5">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-gold" /> O que te espera do outro lado (2 minutos):
              </p>
              {[
                "Sua meta, no seu jeito — a bússola da IA",
                "Corpo + dinheiro como porta de entrada",
                "A mágica: uma frase e o dia inteiro registrado",
              ].map((t) => (
                <p key={t} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 text-success shrink-0 mt-px" /> {t}
                </p>
              ))}
            </div>
            <Button className="w-full" variant="outline" onClick={resend} disabled={resendIn > 0}>
              {resendIn > 0 ? `Reenviar link (${resendIn}s)` : "Reenviar link"}
            </Button>
            <button
              className="text-xs text-muted-foreground underline"
              onClick={() => setPendingEmail(null)}
            >
              E-mail errado? Corrigir e tentar de novo
            </button>
          </Card>
          <p className="text-center text-xs text-muted-foreground mt-4">
            Não chegou? Confira a caixa de spam — o remetente é o seu projeto Supabase.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh grid place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center justify-center mb-6">
          <Logo size="lg" />
        </Link>

        <Card className="p-6">
          {/* Login social: um botão serve entrar E criar conta — o Supabase
              vincula automaticamente identidades com o mesmo e-mail verificado.
              GIS pronto → botão oficial do Google (ID token, sem redirect);
              senão → fallback de redirect. */}
          {gisState === "loading" && <Skeleton className="h-10 w-full mb-3 rounded-md" />}
          {gisState === "ready" && (
            <div className="mb-3 flex justify-center min-h-10 relative">
              <div ref={gisButtonRef} className="w-full flex justify-center" />
              {oauthLoading === "google" && (
                <div className="absolute inset-0 grid place-items-center bg-background/70 rounded-md">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              )}
            </div>
          )}
          {gisState === "fallback" && (
          <Button
            type="button"
            variant="outline"
            className="w-full mb-3"
            onClick={() => signInWithProvider("google")}
            disabled={oauthLoading !== null}
          >
            {oauthLoading === "google" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z" />
                  <path fill="#FBBC05" d="M5.27 14.29A7.19 7.19 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a12.04 12.04 0 0 0 0 10.76l3.98-3.09z" />
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A11.99 11.99 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
                </svg>
                Continuar com Google
              </>
            )}
          </Button>
          )}
          {/* Fase 2 (Apple): mesmo fluxo — signInWithProvider("apple") — ligar
              quando o Services ID estiver configurado no Supabase. */}
          <div className="flex items-center gap-3 mb-4" aria-hidden>
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] text-muted-foreground">ou com e-mail</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Tabs defaultValue="signin">
            <TabsList className="grid grid-cols-2 w-full mb-4">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={signIn} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email-in">E-mail</Label>
                  <Input id="email-in" type="email" required autoComplete="email"
                    value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pass-in">Senha</Label>
                  <Input id="pass-in" type="password" required autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={signUp} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name-up">Como quer ser chamado(a)?</Label>
                  <Input id="name-up" required maxLength={60}
                    value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email-up">E-mail</Label>
                  <Input id="email-up" type="email" required autoComplete="email"
                    value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pass-up">Senha (mínimo 6 caracteres)</Label>
                  <Input id="pass-up" type="password" required autoComplete="new-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <label className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer">
                  <Checkbox
                    checked={acceptedTerms}
                    onCheckedChange={(v) => setAcceptedTerms(!!v)}
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
                <Button type="submit" className="w-full" disabled={loading || !acceptedTerms}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar conta grátis"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
        <p className="text-center text-xs text-muted-foreground mt-4">
          Seus dados são privados e você pode exportá-los ou apagá-los quando quiser.
        </p>
      </div>
    </div>
  );
}