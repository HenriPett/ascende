// ASCEND — Portal do cliente Stripe (gerenciar/cancelar assinatura)
import { serviceClient, requireUser, corsFor } from "../_shared/lib.ts";
import { stripe } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);

    const { data: sub } = await supabase.from("subscriptions")
      .select("provider_customer_id").eq("user_id", user.id).eq("provider", "stripe")
      .not("provider_customer_id", "is", null)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!sub?.provider_customer_id) {
      return json({ error: "Você ainda não tem uma assinatura para gerenciar." }, 404);
    }
    const origin = Deno.env.get("APP_ORIGIN") ?? req.headers.get("origin") ?? "";
    const session = await stripe("/billing_portal/sessions", {
      customer: sub.provider_customer_id,
      return_url: `${origin}/app/assinatura`,
    });
    return json({ url: session.url });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Não consegui abrir o portal agora. Tente de novo." }, 500);
  }
});
