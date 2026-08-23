// ASCENDE — Estado da assinatura + permissões + uso atual (para o frontend EXIBIR)
// A validação real dos limites acontece em cada função; aqui é só leitura.
import { serviceClient, requireUser, corsFor } from "../_shared/lib.ts";
import { countUsage } from "../_shared/usage.ts";
import {
  getEntitlements, spDayStartUtc, spWeekStartUtc, spMonthStartUtc,
} from "../_shared/entitlements.ts";

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);

    const ent = await getEntitlements(supabase, user.id);

    const countChat = async (sinceIso: string) => {
      const { count } = await supabase.from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id).eq("role", "user").gte("created_at", sinceIso);
      return count ?? 0;
    };
    const [chatToday, chatWeek, chatMonth, captureToday, mealsMonth, bodyMonth, docsMonth, pricingRow] =
      await Promise.all([
        countChat(spDayStartUtc()),
        countChat(spWeekStartUtc()),
        countChat(spMonthStartUtc()),
        // Endpoint de EXIBIÇÃO: strict:false (erro de contagem vira 0 na tela;
        // a validação real, fail-closed, acontece em cada função de IA).
        countUsage(supabase, user.id, ["capture"], spDayStartUtc(), { strict: false }),
        countUsage(supabase, user.id, ["analyze-meal"], spMonthStartUtc(), { strict: false }),
        countUsage(supabase, user.id, ["analyze-body"], spMonthStartUtc(), { strict: false }),
        countUsage(supabase, user.id, ["chat-documento"], spMonthStartUtc(), { strict: false }),
        supabase.from("app_settings").select("value").eq("key", "pricing").maybeSingle(),
      ]);

    return json({
      plan: ent.plan,
      limits: ent.limits,
      flags: ent.flags,
      subscription: ent.subscription,
      honeymoon_until: ent.honeymoon_until,
      usage: {
        chat_today: chatToday, chat_week: chatWeek, chat_month: chatMonth,
        capture_today: captureToday, meal_photos_month: mealsMonth,
        body_photos_month: bodyMonth, document_analyses_month: docsMonth,
      },
      pricing: pricingRow.data?.value ?? null,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});