// ASCENDE — Envios de saída do WhatsApp (agendado 1x/dia, ~09:05 SP)
//
// Papel: chamar a pessoa DE VOLTA ao app — nunca entregar o conteúdo aqui.
// Três convites, todos curtos, todos com link, todos desligáveis:
//   • retro    — domingo: "sua retrospectiva está pronta no app"
//   • briefing — dias úteis+sábado, só Ascende+: "seu briefing está no app"
//   • return   — silêncio de 7+ dias: o ritual de retorno começa no WhatsApp
//                (carência de 14 dias entre convites; nunca vira cobrança)
//
// Regras de custo/respeito:
//   • Fora da janela de 24h ⇒ SEMPRE template UTILITY aprovado (o + barato).
//   • Dedupe em whatsapp_sends: nunca 2x o mesmo convite no mesmo dia.
//   • "parar" no WhatsApp desliga tudo (webhook) — aqui só lemos as flags.
//
// Proteção: header x-cron-secret === WHATSAPP_CRON_SECRET.
import { serviceClient } from "../_shared/lib.ts";
import { getEntitlements, spParts } from "../_shared/entitlements.ts";
import { waSendTemplate } from "../_shared/whatsapp.ts";

const MAX_PER_RUN = 500;       // guarda-corpo de custo por execução
const RETURN_MIN_GAP_DAYS = 7; // alinhado ao RETURN_GAP_DAYS da tela Hoje
const RETURN_MAX_GAP_DAYS = 45; // depois disso, paramos de insistir
const RETURN_COOLDOWN_DAYS = 14;

interface WaSettings {
  retro_template: string; briefing_template: string; return_template: string; lang: string;
}
const DEFAULTS: WaSettings = {
  retro_template: "ascende_retro", briefing_template: "ascende_briefing",
  return_template: "ascende_retorno", lang: "pt_BR",
};

Deno.serve(async (req) => {
  const secret = Deno.env.get("WHATSAPP_CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabase = serviceClient();
  const { data: cfgRow } = await supabase.from("app_settings")
    .select("value").eq("key", "whatsapp").maybeSingle();
  const cfg: WaSettings = { ...DEFAULTS, ...(cfgRow?.value as Partial<WaSettings> ?? {}) };

  const { weekday, dateIso } = spParts();
  const isSunday = weekday === "Sun";

  const { data: links } = await supabase.from("whatsapp_links")
    .select("user_id, phone, notify_retro, notify_briefing, notify_return")
    .not("phone", "is", null).not("linked_at", "is", null).limit(2000);

  const out = { retro: 0, briefing: 0, return: 0, skipped: 0, errors: 0 };
  let budget = MAX_PER_RUN;

  const alreadySent = async (userId: string, kind: string, sinceDays = 0) => {
    let q = supabase.from("whatsapp_sends").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("kind", kind);
    if (sinceDays > 0) {
      const since = new Date(Date.now() - sinceDays * 864e5).toISOString().slice(0, 10);
      q = q.gte("sent_on", since);
    } else {
      q = q.eq("sent_on", dateIso);
    }
    const { count } = await q;
    return (count ?? 0) > 0;
  };

  const record = (userId: string, kind: string) =>
    supabase.from("whatsapp_sends").insert({ user_id: userId, kind, sent_on: dateIso });

  for (const link of links ?? []) {
    if (budget <= 0) break;
    try {
      const { data: prof } = await supabase.from("profiles")
        .select("name").eq("user_id", link.user_id).maybeSingle();
      const first = ((prof?.name ?? "").split(" ")[0] || "por aí").slice(0, 30);

      // ── Domingo: retrospectiva (todos os planos — a retro é do free também) ──
      if (isSunday && link.notify_retro) {
        if (!(await alreadySent(link.user_id, "retro"))) {
          if (await waSendTemplate(link.phone!, cfg.retro_template, cfg.lang, [first])) {
            await record(link.user_id, "retro"); out.retro++; budget--;
          } else out.errors++;
        }
        continue; // domingo: a retro é o único toque do dia (nunca 2 mensagens)
      }

      // ── Silêncio: o ritual de retorno começa aqui (prioridade sobre briefing) ──
      if (link.notify_return) {
        const { data: last } = await supabase.from("life_events")
          .select("occurred_at").eq("user_id", link.user_id)
          .order("occurred_at", { ascending: false }).limit(1);
        const lastAt = last?.[0]?.occurred_at ? new Date(String(last[0].occurred_at)).getTime() : null;
        if (lastAt) {
          const gap = Math.floor((Date.now() - lastAt) / 864e5);
          if (gap >= RETURN_MIN_GAP_DAYS && gap <= RETURN_MAX_GAP_DAYS &&
              !(await alreadySent(link.user_id, "return", RETURN_COOLDOWN_DAYS))) {
            if (await waSendTemplate(link.phone!, cfg.return_template, cfg.lang, [first])) {
              await record(link.user_id, "return"); out.return++; budget--;
            } else out.errors++;
            continue; // quem está em silêncio não recebe briefing por cima
          }
        }
      }

      // ── Briefing diário: benefício Ascende+ ──
      if (link.notify_briefing) {
        const ent = await getEntitlements(supabase, link.user_id);
        if (ent.plan === "ascend_plus" && ent.limits.briefing_daily &&
            !(await alreadySent(link.user_id, "briefing"))) {
          if (await waSendTemplate(link.phone!, cfg.briefing_template, cfg.lang, [first])) {
            await record(link.user_id, "briefing"); out.briefing++; budget--;
          } else out.errors++;
          continue;
        }
      }
      out.skipped++;
    } catch (e) {
      console.error("whatsapp-notify user", link.user_id, e);
      out.errors++;
    }
  }

  return new Response(JSON.stringify({ ok: true, date: dateIso, ...out }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});