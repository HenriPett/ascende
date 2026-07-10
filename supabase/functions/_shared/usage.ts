// ASCENDE — Telemetria de IA (medição real de custo)
// Toda chamada à Anthropic passa por `anthropicCall`, que registra em ai_usage:
// tokens (incl. cache), custo estimado, sucesso, erro, latência e request id.
// Falha na telemetria NUNCA derruba a chamada principal.
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Preços por milhão de tokens (USD). Atualize aqui quando a Anthropic mudar.
const PRICES_PER_MTOK: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-4-6": { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

function estimateCostUsd(model: string, u: {
  input_tokens?: number; output_tokens?: number;
  cache_creation_input_tokens?: number; cache_read_input_tokens?: number;
}): number {
  const p = PRICES_PER_MTOK[model] ?? { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 };
  const cost =
    ((u.input_tokens ?? 0) * p.in +
      (u.output_tokens ?? 0) * p.out +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

async function isTelemetryEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "flags").maybeSingle();
    return Boolean((data?.value as Record<string, unknown> | undefined)?.["new_ai_telemetry_enabled"] ?? true);
  } catch { return true; }
}

/**
 * Chama a API da Anthropic e registra o consumo em ai_usage.
 * `feature` identifica a chamada interna (chat-principal, chat-captura,
 * chat-memorias, chat-metas, capture, briefing, analyze-meal, analyze-body...).
 * Retorna a Response crua — o chamador decide como tratar o corpo.
 */
export async function anthropicCall(
  supabase: SupabaseClient,
  userId: string,
  feature: string,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
): Promise<{ res: Response; data: unknown | null }> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    logUsage(supabase, userId, feature, String(body.model ?? ""), null, false, "network_error", Date.now() - started, null);
    throw e;
  }
  const duration = Date.now() - started;
  let data: unknown | null = null;
  if (res.ok) {
    data = await res.json();
    // deno-lint-ignore no-explicit-any
    const d = data as any;
    logUsage(supabase, userId, feature, String(body.model ?? ""), d?.usage ?? null, true, null, duration, d?.id ?? null);
  } else {
    const errText = await res.text().catch(() => "");
    console.error(`Anthropic error [${feature}]`, res.status, errText.slice(0, 400));
    logUsage(supabase, userId, feature, String(body.model ?? ""), null, false, `http_${res.status}`, duration, null);
  }
  return { res, data };
}

/** Grava a linha de consumo (fire-and-forget seguro). */
function logUsage(
  supabase: SupabaseClient, userId: string, feature: string, model: string,
  // deno-lint-ignore no-explicit-any
  usage: any, success: boolean, errorCode: string | null, durationMs: number, requestId: string | null,
) {
  (async () => {
    try {
      if (!(await isTelemetryEnabled(supabase))) return;
      await supabase.from("ai_usage").insert({
        user_id: userId,
        feature,
        model,
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
        cache_creation_tokens: usage?.cache_creation_input_tokens ?? 0,
        cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
        estimated_cost_usd: usage ? estimateCostUsd(model, usage) : 0,
        provider_request_id: requestId,
        success,
        error_code: errorCode,
        duration_ms: durationMs,
      });
    } catch (e) {
      console.error("ai_usage: falha ao registrar", e);
    }
  })();
}

/** Conta chamadas bem-sucedidas de uma feature desde um instante (para limites). */
export async function countUsage(
  supabase: SupabaseClient, userId: string, features: string[], sinceIso: string,
): Promise<number> {
  const { count, error } = await supabase.from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("success", true)
    .in("feature", features).gte("created_at", sinceIso);
  if (error) { console.error("countUsage", error.message); return 0; }
  return count ?? 0;
}
