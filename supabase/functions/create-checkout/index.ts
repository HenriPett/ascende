// ASCENDE — Cria a sessão de checkout do Stripe (assinatura Ascende+)
// Requer flags: subscriptions_enabled e stripe_checkout_enabled.
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY_ID, STRIPE_PRICE_ANNUAL_ID, APP_ORIGIN.
// Etapa 1.1 do plano: quem JÁ tem assinatura ativa não abre novo checkout
// (evita assinatura e cobrança duplicadas para o mesmo usuário).
import { serviceClient, requireUser, corsFor } from "../_shared/lib.ts";
import { getFlags } from "../_shared/entitlements.ts";
import { stripe, findOrCreateCustomer, resolveAppOrigin } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);

    const flags = await getFlags(supabase);
    if (!flags.subscriptions_enabled || !flags.stripe_checkout_enabled) {
      return json({ error: "Assinaturas ainda não estão disponíveis." }, 403);
    }

    // Bloqueio de checkout duplicado: uma assinatura ativa por usuário.
    const { data: hasPlus, error: plusErr } = await supabase.rpc("has_ascend_plus", { uid: user.id });
    if (plusErr) {
      console.error("create-checkout has_ascend_plus", plusErr);
      return json({ error: "Não consegui verificar sua assinatura agora. Tente de novo." }, 503);
    }
    if (hasPlus === true) {
      return json({ error: "Você já tem o Ascende+ ativo. Gerencie a assinatura pelo portal, em Assinatura." }, 409);
    }
    // Também bloqueia se houver assinatura Stripe em aberto (incomplete/past_due),
    // para não criar uma segunda assinatura no mesmo cliente.
    const { data: openSub, error: openErr } = await supabase.from("subscriptions")
      .select("id,status").eq("user_id", user.id).eq("provider", "stripe")
      .in("status", ["active", "trialing", "past_due"]).limit(1).maybeSingle();
    if (openErr) {
      console.error("create-checkout open sub", openErr);
      return json({ error: "Não consegui verificar sua assinatura agora. Tente de novo." }, 503);
    }
    if (openSub) {
      return json({ error: "Já existe uma assinatura em andamento para a sua conta. Gerencie-a pelo portal, em Assinatura." }, 409);
    }

    const { plan } = await req.json().catch(() => ({}));
    const priceId = plan === "annual"
      ? Deno.env.get("STRIPE_PRICE_ANNUAL_ID")
      : Deno.env.get("STRIPE_PRICE_MONTHLY_ID");
    if (!priceId) return json({ error: "Preço não configurado." }, 500);

    const origin = resolveAppOrigin(req);
    const customerId = await findOrCreateCustomer(supabase, user.id, user.email ?? undefined);

    const session = await stripe("/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][user_id]": user.id,
      allow_promotion_codes: "true",
      success_url: `${origin}/app/assinatura?status=sucesso`,
      cancel_url: `${origin}/app/assinatura?status=cancelado`,
    });
    return json({ url: session.url });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Não consegui iniciar o checkout agora. Tente de novo." }, 500);
  }
});