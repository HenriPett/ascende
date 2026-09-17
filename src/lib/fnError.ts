// Lê o corpo estruturado de erros das Edge Functions (ex.: PLAN_LIMIT_REACHED).
import { FunctionsHttpError } from "@supabase/supabase-js";

export interface PlanLimitError {
  error: string;
  code: "PLAN_LIMIT_REACHED";
  feature: string;
  limit: number;
  reset_at: string;
  upgrade_available: boolean;
}

/** Extrai o JSON de erro de um FunctionsHttpError (status 4xx/5xx). */
export async function readFnError(error: unknown): Promise<Record<string, unknown> | null> {
  if (error instanceof FunctionsHttpError) {
    try { return await error.context.json(); } catch { return null; }
  }
  return null;
}

export function isPlanLimit(body: Record<string, unknown> | null): body is Record<string, unknown> & PlanLimitError {
  return !!body && body.code === "PLAN_LIMIT_REACHED";
}

/** O gatilho `enforce_active_plans_cap` recusa o plano que passaria da cota
 *  de planos ATIVOS (setup.sql:725). Vem como erro do PostgREST, não da Edge
 *  Function, então não passa pelo `readFnError` — é outro caminho.
 *
 *  Quem chama usa isto para DEGRADAR (guardar o plano como arquivado) em vez
 *  de deixar a operação inteira cair: o limite é sobre quantos planos ficam
 *  ativos ao mesmo tempo, nunca sobre quantos a pessoa pode ter. */
export function isPlanCapError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return !!e && (e.code === "P0001" || !!e.message) &&
    String(e.message ?? "").includes("PLAN_LIMIT_REACHED");
}
