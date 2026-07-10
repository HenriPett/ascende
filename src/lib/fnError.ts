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
