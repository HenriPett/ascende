// ASCENDE — Captura conversacional
// Texto livre → eventos estruturados PROPOSTOS + memórias duráveis, em UMA
// única chamada de IA (modelo econômico). O app pede confirmação antes de
// gravar qualquer evento — a IA nunca grava sozinha.
// Limite diário por plano validado NO SERVIDOR (free: 3/dia; Ascende+: 30/dia).
import {
  serviceClient, requireUser, assertRateLimit, corsFor, isTrivialMessage,
  extractEventsAndMemories,
} from "../_shared/lib.ts";
import { countUsage } from "../_shared/usage.ts";
import { getEntitlements, spDayStartUtc, nextSpDayStartUtc, limitResponse } from "../_shared/entitlements.ts";

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);
    await assertRateLimit(supabase, user.id, "capture", 80, 5); // anti-abuso (independe de plano)

    const { text } = await req.json();
    if (!text || typeof text !== "string" || text.length > 2000) {
      return json({ error: "Texto inválido." }, 400);
    }

    // Mensagens sem conteúdo registrável não consomem cota nem chamada de IA
    if (isTrivialMessage(text)) return json({ events: [], learned: [] });

    // Limite do plano (validado no servidor; frontend só exibe)
    const ent = await getEntitlements(supabase, user.id);
    if (ent.flags.premium_limits_enabled && ent.limits.capture_daily !== null) {
      const used = await countUsage(supabase, user.id, ["capture"], spDayStartUtc());
      if (used >= ent.limits.capture_daily) {
        return limitResponse(req, "capture", ent.limits.capture_daily, nextSpDayStartUtc(),
          `Você usou as ${ent.limits.capture_daily} capturas inteligentes de hoje. Registros manuais continuam ilimitados.`);
      }
    }

    const { events, learned } = await extractEventsAndMemories(
      supabase, user.id, text, "capture", ent.limits.memory_cap,
    );
    return json({ events, learned });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});