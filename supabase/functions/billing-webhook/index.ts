// ASCENDE — Webhook do Stripe (verify_jwt = false; autenticado pela ASSINATURA do Stripe)
//
// Garantias desta versão (plano de consolidação, Etapa 1.1):
// • Estados explícitos por evento: processing → processed | failed | ignored.
// • Falha de processamento retorna 500 ao Stripe → o Stripe REENVIA o evento.
// • Reprocessamento seguro: eventos 'failed' (ou 'processing' travados há mais
//   de 5 minutos) são reprocessados quando o Stripe reenvia; duplicados já
//   'processed'/'ignored' retornam 200 sem efeito.
// • TODOS os resultados do Supabase são verificados — erro de banco nunca é
//   confundido com sucesso nem com evento duplicado.
// • O Ascende+ NUNCA é ativado pelo checkout.session.completed: esse evento
//   apenas vincula usuário ↔ customer. A ativação vem exclusivamente dos
//   eventos confiáveis customer.subscription.created/updated (status real).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyStripeSignature } from "../_shared/stripe.ts";

const service = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const STUCK_PROCESSING_MS = 5 * 60_000;

// deno-lint-ignore no-explicit-any
async function resolveUserId(supabase: any, obj: any): Promise<string | null> {
  const metaUid = obj?.metadata?.user_id;
  if (typeof metaUid === "string" && metaUid.length > 10) return metaUid;
  const ref = obj?.client_reference_id;
  if (typeof ref === "string" && ref.length > 10) return ref;
  const customer = typeof obj?.customer === "string" ? obj.customer : null;
  if (customer) {
    const { data, error } = await supabase.from("subscriptions")
      .select("user_id").eq("provider", "stripe").eq("provider_customer_id", customer)
      .limit(1).maybeSingle();
    if (error) throw new Error(`resolveUserId: ${error.message}`);
    if (data?.user_id) return data.user_id as string;
  }
  return null;
}

const toIso = (epoch: unknown) =>
  typeof epoch === "number" && epoch > 0 ? new Date(epoch * 1000).toISOString() : null;

// deno-lint-ignore no-explicit-any
async function upsertSubscription(supabase: any, sub: any, userId: string) {
  const item = sub?.items?.data?.[0];
  const { error } = await supabase.from("subscriptions").upsert({
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
  if (error) throw new Error(`upsertSubscription: ${error.message}`);
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
  const eventId = String(event.id ?? "");
  if (!eventId) return new Response("evento sem id", { status: 400 });

  const hash = Array.from(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)),
  )).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);

  // ── Idempotência com reprocessamento seguro ────────────────────
  // Distingue "evento novo", "duplicado já processado" e "falha anterior".
  const { data: existing, error: lookupErr } = await supabase
    .from("billing_webhook_events")
    .select("id,status,processed_at,attempts")
    .eq("provider", "stripe").eq("provider_event_id", eventId)
    .maybeSingle();
  if (lookupErr) {
    // Erro de banco na verificação: NÃO tratar como duplicado.
    console.error("webhook lookup", lookupErr);
    return new Response(JSON.stringify({ error: "banco indisponível" }), { status: 500 });
  }

  if (existing) {
    const stuck = existing.status === "processing" &&
      Date.now() - new Date(existing.processed_at).getTime() > STUCK_PROCESSING_MS;
    const retryable = existing.status === "failed" || stuck;
    if (!retryable) {
      return new Response(JSON.stringify({ received: true, duplicate: true, status: existing.status }), { status: 200 });
    }
    const { error } = await supabase.from("billing_webhook_events")
      .update({
        status: "processing", processed_at: new Date().toISOString(),
        attempts: (existing.attempts ?? 1) + 1, last_error: null,
      })
      .eq("id", existing.id);
    if (error) {
      console.error("webhook retry mark", error);
      return new Response(JSON.stringify({ error: "banco indisponível" }), { status: 500 });
    }
  } else {
    const { error: insErr } = await supabase.from("billing_webhook_events").insert({
      provider: "stripe", provider_event_id: eventId,
      event_type: String(event.type), payload_hash: hash, status: "processing",
    });
    if (insErr) {
      // 23505 = corrida com outra entrega do MESMO evento: deixa a outra processar.
      if ((insErr as { code?: string }).code === "23505") {
        return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
      }
      console.error("webhook insert", insErr);
      return new Response(JSON.stringify({ error: "banco indisponível" }), { status: 500 });
    }
  }

  // ── Processamento ──────────────────────────────────────────────
  let status = "processed";
  let lastError: string | null = null;
  try {
    const obj = event.data?.object ?? {};
    switch (event.type) {
      case "checkout.session.completed": {
        // NÃO ativa o plano aqui. Apenas garante o vínculo user ↔ customer
        // para que eventos futuros da assinatura sejam resolvidos. O status
        // real chega em customer.subscription.created/updated.
        const userId = await resolveUserId(supabase, obj);
        const subId = typeof obj.subscription === "string" ? obj.subscription : null;
        if (userId && subId) {
          const { data: subRow, error: selErr } = await supabase.from("subscriptions")
            .select("id").eq("provider", "stripe").eq("provider_subscription_id", subId).maybeSingle();
          if (selErr) throw new Error(`checkout select: ${selErr.message}`);
          if (!subRow) {
            const { error } = await supabase.from("subscriptions").insert({
              user_id: userId, provider: "stripe",
              provider_customer_id: typeof obj.customer === "string" ? obj.customer : null,
              provider_subscription_id: subId, plan_key: "ascend_plus",
              status: "incomplete", // aguarda o evento confiável da assinatura
              updated_at: new Date().toISOString(),
            });
            if (error && (error as { code?: string }).code !== "23505") {
              throw new Error(`checkout insert: ${error.message}`);
            }
          } else {
            const { error } = await supabase.from("subscriptions")
              .update({
                user_id: userId,
                provider_customer_id: typeof obj.customer === "string" ? obj.customer : null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", subRow.id);
            if (error) throw new Error(`checkout update: ${error.message}`);
          }
        } else if (!userId) {
          throw new Error("checkout: usuário não identificado (metadata/client_reference_id ausentes)");
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const userId = await resolveUserId(supabase, obj);
        if (!userId) {
          // O Stripe pode entregar este evento ANTES do checkout.session.completed.
          // failed + 500 → o Stripe reenvia e o vínculo já vai existir.
          throw new Error("subscription: usuário não encontrado para o customer");
        }
        await upsertSubscription(supabase, obj, userId);
        break;
      }
      case "invoice.payment_failed": {
        const subId = typeof obj.subscription === "string" ? obj.subscription : null;
        if (subId) {
          const { error } = await supabase.from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("provider", "stripe").eq("provider_subscription_id", subId);
          if (error) throw new Error(`payment_failed: ${error.message}`);
        }
        break;
      }
      case "invoice.payment_succeeded": {
        // Renovação: customer.subscription.updated também chega; nada extra necessário.
        break;
      }
      default:
        status = "ignored";
    }
  } catch (e) {
    console.error("webhook handler", event.type, e);
    status = "failed";
    lastError = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
  }

  const { error: finErr } = await supabase.from("billing_webhook_events")
    .update({ status, last_error: lastError, processed_at: new Date().toISOString() })
    .eq("provider", "stripe").eq("provider_event_id", eventId);
  if (finErr) console.error("webhook finalize", finErr);

  if (status === "failed") {
    // 500 → o Stripe tenta de novo com backoff. O evento fica registrado
    // como 'failed' e o reenvio será reprocessado (bloco de idempotência acima).
    return new Response(JSON.stringify({ received: true, status }), { status: 500 });
  }
  return new Response(JSON.stringify({ received: true, status }), { status: 200 });
});