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
import { Loader2 } from "lucide-react";

export default function Auth() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  useEffect(() => {
    if (!authLoading && user) navigate("/app", { replace: true });
  }, [user, authLoading, navigate]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
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
      toast.success("Conta criada! Confira seu e-mail para confirmar o cadastro e depois entre.");
    }
  };

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