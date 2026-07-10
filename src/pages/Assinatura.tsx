// Página da assinatura: plano atual, comparação Gratuito × Ascend+,
// checkout do Stripe e portal do cliente. Limites reais vêm do servidor.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, Loader2, Sparkles, ExternalLink } from "lucide-react";
import { useEntitlements } from "@/hooks/useEntitlements";
import { formatSP } from "@/lib/dates";

const FREE_FEATURES = [
  "Registros manuais, hábitos e batalhas sem limite",
  "Diário, hidratação, XP e níveis, gráficos básicos",
  "Captura inteligente: 3 por dia",
  "Conselheiro: 5 mensagens por semana",
  "2 análises de refeição por mês",
  "Retrospectiva toda semana (domingo)",
  "1 plano ativo · 20 memórias do Conselheiro",
  "Exportação de dados e privacidade — sempre grátis",
];

const PLUS_FEATURES = [
  "Tudo do plano gratuito",
  "Captura inteligente: 30 por dia",
  "Conselheiro: 15 mensagens por dia (até 300/mês)",
  "Briefing diário + retrospectiva + relatório mensal",
  "30 análises de refeição por mês",
  "Análise de documentos: 10 PDFs por mês",
  "Até 5 planos ativos · 150 memórias",
  "Gráficos e análises avançadas",
];

export default function Assinatura() {
  const qc = useQueryClient();
  const { data: ent, isLoading } = useEntitlements();
  const [searchParams, setSearchParams] = useSearchParams();
  const [starting, setStarting] = useState<"monthly" | "annual" | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    const status = searchParams.get("status");
    if (!status) return;
    if (status === "sucesso") {
      toast.success("Assinatura confirmada! Bem-vindo(a) ao Ascend+. Pode levar alguns segundos para ativar.");
      qc.invalidateQueries({ queryKey: ["entitlements"] });
    } else if (status === "cancelado") {
      toast.info("Checkout cancelado. Nada foi cobrado.");
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkoutEnabled = !!ent?.flags?.subscriptions_enabled && !!ent?.flags?.stripe_checkout_enabled;
  const isPlus = ent?.plan === "ascend_plus";

  const startCheckout = async (plan: "monthly" | "annual") => {
    setStarting(plan);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", { body: { plan } });
      if (error || !data?.url) throw new Error(data?.error ?? "erro");
      window.location.href = data.url as string;
    } catch (e) {
      toast.error(e instanceof Error && e.message !== "erro" ? e.message : "Não consegui iniciar o checkout. Tente de novo.");
      setStarting(null);
    }
  };

  const openPortal = async () => {
    setOpeningPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal", { body: {} });
      if (error || !data?.url) throw new Error(data?.error ?? "erro");
      window.location.href = data.url as string;
    } catch (e) {
      toast.error(e instanceof Error && e.message !== "erro" ? e.message : "Não consegui abrir o portal. Tente de novo.");
      setOpeningPortal(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-8">
      <div>
        <h1 className="text-xl font-display font-bold">Assinatura</h1>
        <p className="text-sm text-muted-foreground">
          O Ascend é gratuito para sempre no essencial. O Ascend+ amplia os recursos de IA.
        </p>
      </div>

      {/* Estado atual */}
      <Card className="p-4 space-y-1.5">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando seu plano...</p>
        ) : (
          <>
            <p className="text-sm">
              Seu plano: <strong>{isPlus ? "Ascend+" : "Gratuito"}</strong>
              {isPlus && ent?.subscription?.current_period_end && (
                <span className="text-muted-foreground">
                  {" · "}{ent.subscription.cancel_at_period_end ? "termina" : "renova"} em{" "}
                  {formatSP(ent.subscription.current_period_end)}
                </span>
              )}
            </p>
            {ent?.subscription?.status === "past_due" && (
              <p className="text-sm text-destructive">
                O último pagamento falhou. Atualize a forma de pagamento no portal abaixo para não perder o Ascend+.
              </p>
            )}
            {ent?.subscription && ent.subscription.provider === "stripe" && (
              <Button variant="outline" size="sm" onClick={openPortal} disabled={openingPortal}>
                {openingPortal ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Gerenciar assinatura (portal)</>)}
              </Button>
            )}
          </>
        )}
      </Card>

      <div className="grid sm:grid-cols-2 gap-3">
        <Card className="p-4 space-y-3">
          <div>
            <h2 className="font-display font-semibold">Gratuito</h2>
            <p className="text-lg font-bold">R$ 0</p>
          </div>
          <ul className="text-sm space-y-1.5">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex gap-2"><Check className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" /><span>{f}</span></li>
            ))}
          </ul>
        </Card>

        <Card className="p-4 space-y-3 border-gold/50">
          <div>
            <h2 className="font-display font-semibold flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-gold" /> Ascend+
            </h2>
            <p className="text-lg font-bold">{ent?.pricing?.monthly_label ?? "R$ 19,90/mês"}</p>
            <p className="text-xs text-muted-foreground">{ent?.pricing?.annual_label ?? "ou anual com desconto"}</p>
          </div>
          <ul className="text-sm space-y-1.5">
            {PLUS_FEATURES.map((f) => (
              <li key={f} className="flex gap-2"><Check className="w-4 h-4 text-gold shrink-0 mt-0.5" /><span>{f}</span></li>
            ))}
          </ul>
          {!isPlus && (checkoutEnabled ? (
            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={() => startCheckout("monthly")} disabled={starting !== null}>
                {starting === "monthly" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Assinar mensal"}
              </Button>
              <Button variant="outline" onClick={() => startCheckout("annual")} disabled={starting !== null}>
                {starting === "annual" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Assinar anual"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground pt-1">
              A assinatura ainda não está disponível. Em breve!
            </p>
          ))}
        </Card>
      </div>

      <p className="text-xs text-muted-foreground px-1">
        Ao encerrar a assinatura você não perde nada: seus registros, relatórios e memórias
        continuam com você; planos e memórias além do limite gratuito ficam arquivados
        (somente leitura) e voltam ao reativar. Cancelamento a qualquer momento pelo portal.
      </p>
    </div>
  );
}
