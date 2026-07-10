// ASCEND — Cliente Stripe minimalista (REST via fetch, sem SDK)
// Os dados da entidade de cobrança ficam em app_settings ('billing_entity')
// e nos secrets — nunca no código (plano §3). Trocar de conta Stripe =
// trocar secrets; os usuários e assinaturas internas não mudam.
const STRIPE_API = "https://api.stripe.com/v1";

function key(): string {
  const k = Deno.env.get("STRIPE_SECRET_KEY");
  if (!k) throw new Error("STRIPE_SECRET_KEY não configurada");
  return k;
}

/** Chamada form-encoded à API do Stripe. */
export async function stripe(
  path: string, params: Record<string, string> = {}, method = "POST",
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : body,
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Stripe error", path, res.status, JSON.stringify(data).slice(0, 400));
    throw new Error((data as { error?: { message?: string } })?.error?.message ?? "Erro no Stripe");
  }
  return data as Record<string, unknown>;
}

/** Verifica a assinatura do webhook (Stripe-Signature, HMAC-SHA256). */
export async function verifyStripeSignature(
  payload: string, sigHeader: string | null, secret: string, toleranceSec = 300,
): Promise<boolean> {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => kv.split("=") as [string, string]),
  );
  const t = parts["t"];
  const v1 = sigHeader.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !v1.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(`${t}.${payload}`));
  const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return v1.some((candidate) => timingSafeEqual(candidate, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Reaproveita (ou cria) o customer do Stripe para este usuário. */
export async function findOrCreateCustomer(
  // deno-lint-ignore no-explicit-any
  supabase: any, userId: string, email: string | undefined,
): Promise<string> {
  const { data: existing } = await supabase.from("subscriptions")
    .select("provider_customer_id").eq("user_id", userId).eq("provider", "stripe")
    .not("provider_customer_id", "is", null)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (existing?.provider_customer_id) return existing.provider_customer_id as string;
  const customer = await stripe("/customers", {
    ...(email ? { email } : {}),
    "metadata[user_id]": userId,
  });
  return String(customer.id);
}
