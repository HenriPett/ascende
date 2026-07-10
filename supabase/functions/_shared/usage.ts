// ASCENDE — Telemetria de IA (medição real de custo)
// Toda chamada à Anthropic passa por `anthropicCall`, que registra em ai_usage:
// tokens (incl. cache), custo estimado, sucesso, erro, latência e request id.
//
// Etapa 3 do plano de consolidação:
// • Telemetria GARANTIDA: a gravação usa EdgeRuntime.waitUntil quando
//   disponível (a função só encerra depois da escrita) e, sem ele, é
//   aguardada explicitamente. Nada mais é "fire-and-forget".
// • Limites FAIL-CLOSED: se a contagem de uso falhar no banco, a verificação
//   de limite lança 503 (interrompe temporariamente) em vez de devolver 0 e
//   liberar uso ilimitado. `countUsage(..., { strict: false })` continua
//   disponível para telas de exibição.
// • Limites ATÔMICOS: `reserveUsage` reserva a cota NO BANCO (função SQL com
//   advisory lock) antes da chamada de IA; `releaseUsage` devolve a reserva
//   quando a chamada falha. Duas requisições simultâneas não passam mais
//   juntas pela mesma janela de verificação.
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Runtime do Supabase Edge: waitUntil mantém a função viva até a promise terminar.
// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: { waitUntil?: (p: Promise<any>) => void } | undefined;

async function ensureCompletes(p: Promise<unknown>): Promise<void> {
  try {
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") {
      EdgeRuntime.waitUntil(p);
      return;
    }
  } catch { /* segue para o await */ }
  await p;
}

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

export interface AnthropicCallOptions {
  /** Reserva de cota criada por reserveUsage: em caso de SUCESSO a linha da
   * reserva é atualizada com os tokens/custo reais (evitando contagem dupla);
   * em caso de FALHA uma linha de erro é registrada à parte e cabe ao
   * chamador liberar a reserva com releaseUsage. */
  reservationId?: number | null;
}

/**
 * Chama a API da Anthropic e registra o consumo em ai_usage.
 * `feature` identifica a chamada interna (chat-principal, chat-extracao,
 * capture, briefing, analyze-meal, analyze-body...).
 * Retorna a Response crua — o chamador decide como tratar o corpo.
 */
export async function anthropicCall(
  supabase: SupabaseClient,
  userId: string,
  feature: string,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
  opts: AnthropicCallOptions = {},
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
    await logUsage(supabase, userId, feature, String(body.model ?? ""), null, false, "network_error", Date.now() - started, null, null);
    throw e;
  }
  const duration = Date.now() - started;
  let data: unknown | null = null;
  if (res.ok) {
    data = await res.json();
    // deno-lint-ignore no-explicit-any
    const d = data as any;
    await logUsage(supabase, userId, feature, String(body.model ?? ""), d?.usage ?? null, true, null, duration, d?.id ?? null, opts.reservationId ?? null);
  } else {
    const errText = await res.text().catch(() => "");
    console.error(`Anthropic error [${feature}]`, res.status, errText.slice(0, 400));
    await logUsage(supabase, userId, feature, String(body.model ?? ""), null, false, `http_${res.status}`, duration, null, null);
  }
  return { res, data };
}

/** Grava a linha de consumo — com garantia de conclusão (waitUntil/await). */
function logUsage(
  supabase: SupabaseClient, userId: string, feature: string, model: string,
  // deno-lint-ignore no-explicit-any
  usage: any, success: boolean, errorCode: string | null, durationMs: number,
  requestId: string | null, reservationId: number | null,
): Promise<void> {
  const write = (async () => {
    try {
      if (!(await isTelemetryEnabled(supabase))) return;
      const row = {
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
      };
      if (reservationId && success) {
        // Preenche a reserva já contabilizada — nunca conta a mesma chamada duas vezes.
        const { error } = await supabase.from("ai_usage").update(row).eq("id", reservationId);
        if (error) console.error("ai_usage: falha ao completar reserva", error.message ?? error);
      } else {
        const { error } = await supabase.from("ai_usage").insert(row);
        if (error) console.error("ai_usage: falha ao registrar", error.message ?? error);
      }
    } catch (e) {
      console.error("ai_usage: falha ao registrar", e);
    }
  })();
  return ensureCompletes(write);
}

/**
 * Conta chamadas bem-sucedidas de uma feature desde um instante.
 * PADRÃO (strict): falha do banco LANÇA 503 — verificação de limite que não
 * consegue contar interrompe a função, nunca libera uso ilimitado.
 * Para telas de exibição use { strict: false } (retorna 0 em erro).
 */
export async function countUsage(
  supabase: SupabaseClient, userId: string, features: string[], sinceIso: string,
  opts: { strict?: boolean } = {},
): Promise<number> {
  const strict = opts.strict !== false;
  const { count, error } = await supabase.from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("success", true)
    .in("feature", features).gte("created_at", sinceIso);
  if (error) {
    console.error("countUsage", error.message);
    if (strict) {
      throw new Response(JSON.stringify({
        error: "Não consegui verificar seu limite de uso agora. Tente novamente em instantes.",
        code: "LIMIT_CHECK_UNAVAILABLE",
      }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    return 0;
  }
  return count ?? 0;
}

/**
 * Reserva ATOMICAMENTE uma unidade de cota da feature (função SQL
 * reserve_ai_usage, com advisory lock por usuário+feature).
 * Retorna: { id } quando reservou; { id: null } quando o limite foi atingido.
 * Falha do banco lança 503 (fail-closed).
 */
export async function reserveUsage(
  supabase: SupabaseClient, userId: string, feature: string,
  cap: number | null, sinceIso: string,
): Promise<{ id: number | null }> {
  const { data, error } = await supabase.rpc("reserve_ai_usage", {
    uid: userId, feat: feature, cap, since: sinceIso,
  });
  if (error) {
    console.error("reserveUsage", error.message);
    throw new Response(JSON.stringify({
      error: "Não consegui verificar seu limite de uso agora. Tente novamente em instantes.",
      code: "LIMIT_CHECK_UNAVAILABLE",
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
  return { id: (data as number | null) ?? null };
}

/** Devolve uma reserva quando a chamada de IA falhou (não consome cota). */
export async function releaseUsage(supabase: SupabaseClient, reservationId: number | null | undefined): Promise<void> {
  if (!reservationId) return;
  const { error } = await supabase.rpc("release_ai_usage", { reservation_id: reservationId });
  if (error) console.error("releaseUsage", error.message);
}