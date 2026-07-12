import { useState, useEffect } from "react";
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
    if (!authLoading && user) navigate("/app", { replace: true });
  }, [user, authLoading, navigate]);

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
    navigate("/app", { replace: true });
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