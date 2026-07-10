// ASCENDE — Permissões e limites por plano (validação NO SERVIDOR)
// Fonte única de verdade: app_settings ('flags' e 'plan_limits'), com padrões
// embutidos como fallback. O frontend apenas EXIBE o resultado.
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsFor } from "./lib.ts";

export const TZ = "America/Sao_Paulo";

/* ─── Datas no fuso do usuário (America/Sao_Paulo) ───────────────
   Regra do projeto: instantes ficam em UTC no banco; agrupamentos e
   limites diários/semanais/mensais usam fronteiras calculadas em SP. */

function spOffsetMinutes(d: Date): number {
  // Diferença UTC−SP em minutos no instante d (funciona com/sem horário de verão)
  const sp = new Date(d.toLocaleString("en-US", { timeZone: TZ }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((utc.getTime() - sp.getTime()) / 60000);
}

/** Partes (ano, mês, dia, dia-da-semana) do instante `d` vistos de São Paulo. */
export function spParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year), m: Number(parts.month), day: Number(parts.day),
    weekday: String(parts.weekday), // Sun..Sat
    dateIso: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Instante UTC (ISO) em que começa o dia SP que contém `d`. */
export function spDayStartUtc(d = new Date()): string {
  const { y, m, day } = spParts(d);
  const guess = new Date(Date.UTC(y, m - 1, day, 0, 0, 0));
  return new Date(guess.getTime() + spOffsetMinutes(guess) * 60000).toISOString();
}

/** Início da semana SP (segunda-feira 00:00 SP) em UTC ISO. */
export function spWeekStartUtc(d = new Date()): string {
  const { y, m, day, weekday } = spParts(d);
  const dowMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const back = dowMap[weekday] ?? 0;
  const guess = new Date(Date.UTC(y, m - 1, day - back, 0, 0, 0));
  return new Date(guess.getTime() + spOffsetMinutes(guess) * 60000).toISOString();
}

/** Início do mês SP em UTC ISO. */
export function spMonthStartUtc(d = new Date()): string {
  const { y, m } = spParts(d);
  const guess = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  return new Date(guess.getTime() + spOffsetMinutes(guess) * 60000).toISOString();
}

export function nextSpDayStartUtc(d = new Date()): string {
  return new Date(new Date(spDayStartUtc(d)).getTime() + 24 * 3600_000).toISOString();
}
export function nextSpWeekStartUtc(d = new Date()): string {
  return new Date(new Date(spWeekStartUtc(d)).getTime() + 7 * 24 * 3600_000).toISOString();
}
export function nextSpMonthStartUtc(d = new Date()): string {
  const { y, m } = spParts(d);
  const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1;
  const guess = new Date(Date.UTC(ny, nm - 1, 1, 0, 0, 0));
  return new Date(guess.getTime() + spOffsetMinutes(guess) * 60000).toISOString();
}
export function isSundayInSP(d = new Date()): boolean {
  return spParts(d).weekday === "Sun";
}

/* ─── Flags, limites e entitlements ─────────────────────────────── */

export interface PlanLimits {
  capture_daily: number | null;
  chat_daily: number | null;
  chat_weekly: number | null;
  chat_monthly: number | null;
  meal_photos_monthly: number | null;
  body_photos_monthly: number | null;
  document_analyses_monthly: number | null;
  briefing_daily: boolean;
  weekly_review: boolean;
  monthly_report: boolean;
  max_active_plans: number;
  memory_cap: number;
  advanced_analytics: boolean;
}

export const DEFAULT_LIMITS: { free: PlanLimits; plus: PlanLimits } = {
  free: {
    capture_daily: 3, chat_weekly: 5, chat_daily: null, chat_monthly: null,
    meal_photos_monthly: 2, body_photos_monthly: 1, document_analyses_monthly: 0,
    briefing_daily: false, weekly_review: true, monthly_report: false,
    max_active_plans: 1, memory_cap: 20, advanced_analytics: false,
  },
  plus: {
    capture_daily: 30, chat_daily: 15, chat_monthly: 300, chat_weekly: null,
    meal_photos_monthly: 30, body_photos_monthly: 10, document_analyses_monthly: 10,
    briefing_daily: true, weekly_review: true, monthly_report: true,
    max_active_plans: 5, memory_cap: 150, advanced_analytics: true,
  },
};

export interface Flags {
  subscriptions_enabled: boolean;
  stripe_checkout_enabled: boolean;
  premium_limits_enabled: boolean;
  new_ai_telemetry_enabled: boolean;
  model_routing_enabled: boolean;
  new_score_enabled: boolean;
  global_timeline_enabled: boolean;
  apple_billing_enabled: boolean;
  /** Composição corporal por foto: suspensa por padrão (plano Etapa 4.1). */
  body_photo_enabled: boolean;
}

const DEFAULT_FLAGS: Flags = {
  subscriptions_enabled: false, stripe_checkout_enabled: false,
  premium_limits_enabled: false, new_ai_telemetry_enabled: true,
  model_routing_enabled: true, new_score_enabled: false,
  global_timeline_enabled: false, apple_billing_enabled: false,
  body_photo_enabled: false,
};

export async function getFlags(supabase: SupabaseClient): Promise<Flags> {
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "flags").maybeSingle();
    return { ...DEFAULT_FLAGS, ...(data?.value as Partial<Flags> ?? {}) };
  } catch { return DEFAULT_FLAGS; }
}

async function getPlanLimitsConfig(supabase: SupabaseClient): Promise<{ free: PlanLimits; plus: PlanLimits }> {
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "plan_limits").maybeSingle();
    const v = (data?.value ?? {}) as { free?: Partial<PlanLimits>; plus?: Partial<PlanLimits> };
    return {
      free: { ...DEFAULT_LIMITS.free, ...(v.free ?? {}) },
      plus: { ...DEFAULT_LIMITS.plus, ...(v.plus ?? {}) },
    };
  } catch { return DEFAULT_LIMITS; }
}

export interface Entitlements {
  plan: "free" | "ascend_plus";
  limits: PlanLimits;
  flags: Flags;
  subscription: {
    provider: string; status: string;
    current_period_end: string | null; cancel_at_period_end: boolean;
  } | null;
}

/** Função central de permissões. Todas as funções de IA passam por aqui. */
export async function getEntitlements(supabase: SupabaseClient, userId: string): Promise<Entitlements> {
  const [flags, limitsCfg, { data: sub }] = await Promise.all([
    getFlags(supabase),
    getPlanLimitsConfig(supabase),
    supabase.from("subscriptions").select("provider,status,plan_key,current_period_end,cancel_at_period_end,trial_end")
      .eq("user_id", userId).eq("plan_key", "ascend_plus")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const now = Date.now();
  const active = !!sub && (
    ((sub.status === "active" || sub.status === "trialing") &&
      (!sub.current_period_end || new Date(sub.current_period_end).getTime() > now)) ||
    (["promotional", "founder", "admin"].includes(sub.provider) && sub.status === "active")
  );
  // Com assinaturas desligadas (flag), ninguém é tratado como Plus ainda.
  const isPlus = flags.subscriptions_enabled && active;
  return {
    plan: isPlus ? "ascend_plus" : "free",
    limits: isPlus ? limitsCfg.plus : limitsCfg.free,
    flags,
    subscription: sub
      ? {
          provider: sub.provider, status: sub.status,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: !!sub.cancel_at_period_end,
        }
      : null,
  };
}

/** Resposta estruturada de limite atingido (contrato do plano, seção 15). */
export function limitResponse(
  req: Request,
  feature: string,
  limit: number,
  resetAtIso: string,
  message?: string,
): Response {
  return new Response(JSON.stringify({
    error: message ?? "Limite atingido",
    code: "PLAN_LIMIT_REACHED",
    feature,
    limit,
    reset_at: resetAtIso,
    upgrade_available: true,
  }), { status: 429, headers: { ...corsFor(req), "Content-Type": "application/json" } });
}