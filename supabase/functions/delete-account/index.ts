// ASCEND — Exclusão definitiva da conta (SEMPRE gratuita; plano §6 e §19)
// Confirmação reforçada: o corpo precisa trazer confirm: "EXCLUIR".
// auth.users(id) tem ON DELETE CASCADE em todas as tabelas → apaga tudo.
import { serviceClient, requireUser, corsFor } from "../_shared/lib.ts";

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

    // Aviso: se houver assinatura Stripe ativa, ela deve ser cancelada pelo
    // portal antes (o app orienta). A exclusão da conta NUNCA é bloqueada.
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
