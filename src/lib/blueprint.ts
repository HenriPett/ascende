// Blueprint da Subida — matemática local e tipos (Emenda 4).
// A parte que NÃO precisa de IA vive aqui: TMB (Mifflin-St Jeor) e gasto
// energético estimado, calculados no navegador enquanto a pessoa responde —
// é o "cada resposta muda algo que você VÊ na hora" da emenda. Também é o
// fallback honesto quando a função de IA estiver indisponível: o onboarding
// nunca quebra por dependência de IA.

export interface BodyInput {
  birthYear?: number | null;
  sex?: string | null;          // "feminino" | "masculino" | null
  heightCm?: number | null;
  weightKg?: number | null;
}

/** TMB por Mifflin-St Jeor. null se faltar dado essencial. */
export function tmbMifflin({ birthYear, sex, heightCm, weightKg }: BodyInput): number | null {
  const year = new Date().getFullYear();
  const age = birthYear && birthYear > 1900 ? year - birthYear : null;
  if (!age || !heightCm || !weightKg || heightCm < 80 || weightKg < 20) return null;
  // Sexo não informado: média entre as duas fórmulas (premissa declarada).
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === "masculino") return Math.round(base + 5);
  if (sex === "feminino") return Math.round(base - 161);
  return Math.round(base - 78);
}

const ACTIVITY_FACTOR: Record<string, number> = {
  sedentario: 1.2, leve: 1.375, moderado: 1.55, intenso: 1.725,
};

/** Gasto diário estimado (TDEE): TMB × fator de atividade. */
export function tdee(tmb: number | null, activityLevel?: string | null): number | null {
  if (!tmb) return null;
  const f = ACTIVITY_FACTOR[activityLevel ?? ""] ?? 1.3; // sem nível: fator conservador
  return Math.round(tmb * f);
}

/** Faixa calórica exibida no retrato ("~1.900–2.300 kcal/dia"). */
export function kcalRangeLabel(tdeeKcal: number | null): string | null {
  if (!tdeeKcal) return null;
  const lo = Math.round((tdeeKcal * 0.92) / 50) * 50;
  const hi = Math.round((tdeeKcal * 1.08) / 50) * 50;
  return `~${lo.toLocaleString("pt-BR")}–${hi.toLocaleString("pt-BR")} kcal/dia`;
}

/* ── Contrato da função onboarding-blueprint ───────────────────────────── */

export interface BlueprintHabit { name: string; pillar: string; why?: string | null }

/** Um plano do blueprint (uma área). Cada um vira uma linha própria em
 *  "Meus planos" — o blueprint nunca entrega um plano composto disfarçado. */
export interface BlueprintPlan {
  kind: "alimentar" | "treino" | "financeiro" | "rotina";
  pillar: string | null;
  title: string;
  content_markdown: string;
}

export interface BlueprintProposal {
  /** Apresentação do conjunto (o fio que liga os planos). */
  overview: string;
  /** Planos SEPARADOS, um por área. */
  plans: BlueprintPlan[];
  daily_calories_kcal: number | null;
  daily_protein_g: number | null;
  weekly_workouts: number | null;
  sleep_hours_target: number | null;
  daily_spend_limit: number | null;
  water_goal_ml: number | null;
  habits: BlueprintHabit[];
  /** Blocos pulados viram premissas declaradas (vocabulário do Conselheiro). */
  assumptions: string[];
}

/** Rótulo e pilar visual de cada tipo de plano do blueprint. */
export const PLAN_KIND_META: Record<string, { label: string; colorVar: string }> = {
  alimentar: { label: "Alimentação", colorVar: "--alimentacao" },
  treino: { label: "Treino", colorVar: "--vitalidade" },
  financeiro: { label: "Financeiro", colorVar: "--prosperidade" },
  rotina: { label: "Rotina", colorVar: "--mente" },
};