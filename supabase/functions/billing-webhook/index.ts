// ASCEND — Webhook do Stripe (verify_jwt = false; autenticado pela ASSINATURA do Stripe)
// Idempotente: cada evento é registrado em billing_webhook_events com chave única;
// reprocessamentos retornam 200 sem efeito. A conta do usuário guarda apenas a
// permissão final (plan_key ascend_plus) — nunca depende do id do Stripe.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyStripeSignature } from "../_shared/stripe.ts";

const service = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// deno-lint-ignore no-explicit-any
async function resolveUserId(supabase: any, obj: any): Promise<string | null> {
  const metaUid = obj?.metadata?.user_id;
  if (typeof metaUid === "string" && metaUid.length > 10) return metaUid;
  const ref = obj?.client_reference_id;
  if (typeof ref === "string" && ref.length > 10) return ref;
  const customer = typeof obj?.customer === "string" ? obj.customer : null;
  if (customer) {
    const { data } = await supabase.from("subscriptions")
      .select("user_id").eq("provider", "stripe").eq("provider_customer_id", customer)
      .limit(1).maybeSingle();
    if (data?.user_id) return data.user_id as string;
  }
  return null;
}

const toIso = (epoch: unknown) =>
  typeof epoch === "number" && epoch > 0 ? new Date(epoch * 1000).toISOString() : null;

// deno-lint-ignore no-explicit-any
async function upsertSubscription(supabase: any, sub: any, userId: string) {
  const item = sub?.items?.data?.[0];
  await supabase.from("subscriptions").upsert({
    user_id: userId,
    provider: "stripe",
    provider_customer_id: typeof sub.customer === "string" ? sub.customer : null,
    provider_subscription_id: String(sub.id),
    plan_key: "ascend_plus",
    status: String(sub.status ?? "incomplete"),
    current_period_start: toIso(sub.current_period_start ?? item?.current_period_start),
    current_period_end: toIso(sub.current_period_end ?? item?.current_period_end),
    trial_end: toIso(sub.trial_end),
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  }, { onConflict: "provider,provider_subscription_id" });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const payload = await req.text();
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const ok = await verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret);
  if (!ok) return new Response(JSON.stringify({ error: "assinatura inválida" }), { status: 400 });

  const supabase = service();
  // deno-lint-ignore no-explicit-any
  let event: any;
  try { event = JSON.parse(payload); } catch { return new Response("payload inválido", { status: 400 }); }

  // Idempotência: se já processado, retorna 200 sem reprocessar
  const hash = Array.from(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)),
  )).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  const { error: dupErr } = await supabase.from("billing_webhook_events").insert({
    provider: "stripe", provider_event_id: String(event.id),
    event_type: String(event.type), payload_hash: hash, status: "processing",
  });
  if (dupErr) {
    // provavelmente 23505: evento já recebido antes
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  let status = "processed";
  try {
    const obj = event.data?.object ?? {};
    switch (event.type) {
      case "checkout.session.completed": {
        // A assinatura em si chega em customer.subscription.created/updated;
        // aqui garantimos o vínculo user ↔ customer para eventos futuros.
        const userId = await resolveUserId(supabase, obj);
        const subId = typeof obj.subscription === "string" ? obj.subscription : null;
        if (userId && subId) {
          await supabase.from("subscriptions").upsert({
            user_id: userId, provider: "stripe",
            provider_customer_id: typeof obj.customer === "string" ? obj.customer : null,
            provider_subscription_id: subId, plan_key: "ascend_plus",
            status: "active", updated_at: new Date().toISOString(),
          }, { onConflict: "provider,provider_subscription_id" });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const userId = await resolveUserId(supabase, obj);
        if (userId) await upsertSubscription(supabase, obj, userId);
        else status = "error_user_not_found";
        break;
      }
      case "invoice.payment_failed": {
        const subId = typeof obj.subscription === "string" ? obj.subscription : null;
        if (subId) {
          await supabase.from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("provider", "stripe").eq("provider_subscription_id", subId);
        }
        break;
      }
      case "invoice.payment_succeeded": {
        // Renovação: subscription.updated também chega; nada extra necessário.
        break;
      }
      default:
        status = "ignored";
    }
  } catch (e) {
    console.error("webhook handler", e);
    status = "error";
  }
  await supabase.from("billing_webhook_events")
    .update({ status }).eq("provider", "stripe").eq("provider_event_id", String(event.id));
  // Sempre 200 para o Stripe não reenviar indefinidamente (o evento ficou registrado)
  return new Response(JSON.stringify({ received: true, status }), { status: 200 });
});
