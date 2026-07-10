// ASCENDE — Exclusão definitiva da conta (SEMPRE gratuita; plano §6 e §19)
// Confirmação reforçada: o corpo precisa trazer confirm: "EXCLUIR".
// auth.users(id) tem ON DELETE CASCADE em todas as tabelas → apaga tudo.
//
// Etapa 1.1 do plano de consolidação: antes de excluir, qualquer assinatura
// Stripe ativa é CANCELADA automaticamente — a conta nunca some deixando uma
// cobrança recorrente viva. Se o cancelamento falhar por instabilidade, a
// exclusão é interrompida com uma mensagem clara (proteção financeira do
// usuário) e pode ser tentada de novo em seguida.
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

    const { confirm } = await req.json().catch(() => ({}));
    if (confirm !== "EXCLUIR") {
      return json({ error: 'Confirmação inválida. Envie confirm: "EXCLUIR".' }, 400);
    }

    // ── Cancela automaticamente assinaturas Stripe em aberto ──────
    const { data: subs, error: subsErr } = await supabase.from("subscriptions")
      .select("id,provider_subscription_id,status")
      .eq("user_id", user.id).eq("provider", "stripe")
      .in("status", ["active", "trialing", "past_due", "incomplete"])
      .not("provider_subscription_id", "is", null);
    if (subsErr) {
      console.error("delete-account subs lookup", subsErr);
      return json({ error: "Não consegui verificar sua assinatura agora. Tente novamente." }, 503);
    }
    for (const s of subs ?? []) {
      try {
        // Cancelamento IMEDIATO no Stripe (DELETE /v1/subscriptions/{id})
        await stripe(`/subscriptions/${s.provider_subscription_id}`, {}, "DELETE");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Assinatura já cancelada/inexistente no Stripe: pode seguir.
        const alreadyGone = /no such subscription|resource_missing|canceled/i.test(msg);
        if (!alreadyGone) {
          console.error("delete-account stripe cancel", msg);
          return json({
            error: "Não consegui cancelar sua assinatura no Stripe agora. Para sua segurança, a conta não foi excluída. Tente novamente em instantes ou cancele primeiro pelo portal em Assinatura.",
          }, 502);
        }
      }
      const { error: updErr } = await supabase.from("subscriptions")
        .update({ status: "canceled", cancel_at_period_end: false, updated_at: new Date().toISOString() })
        .eq("id", s.id);
      if (updErr) console.error("delete-account sub update", updErr);
    }

    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      console.error("delete-account", error);
      return json({ error: "Não consegui excluir agora. Tente novamente." }, 500);
    }
    return json({ deleted: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});