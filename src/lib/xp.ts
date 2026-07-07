// Nível derivado do XP total. Curva suave: nível = √(xp/50) + 1.
// Nv1→2: 50xp | Nv2→3: 200xp | Nv3→4: 450xp ...
export function levelFromXp(xp: number) {
  const level = Math.floor(Math.sqrt(Math.max(xp, 0) / 50)) + 1;
  const currentFloor = 50 * (level - 1) ** 2;
  const nextFloor = 50 * level ** 2;
  const progress = nextFloor === currentFloor ? 0 : (xp - currentFloor) / (nextFloor - currentFloor);
  return { level, progress: Math.min(Math.max(progress, 0), 1), nextFloor, currentFloor };
}

// Títulos da subida — a metáfora da montanha em cada etapa.
const TITLES: [minLevel: number, title: string][] = [
  [1, "Desperto"],
  [2, "Primeiro Passo"],
  [3, "Caminhante"],
  [5, "Trilheiro"],
  [7, "Escalador"],
  [10, "Guardião da Trilha"],
  [13, "Montanhista"],
  [16, "Domador de Picos"],
  [20, "Vento da Altitude"],
  [25, "Lenda da Montanha"],
];

export function levelTitle(level: number): string {
  let t = TITLES[0][1];
  for (const [min, title] of TITLES) if (level >= min) t = title;
  return t;
}

/** Próximo título e em qual nível ele chega (null se já está no último). */
export function nextTitle(level: number): { title: string; atLevel: number } | null {
  for (const [min, title] of TITLES) if (min > level) return { title, atLevel: min };
  return null;
}

/* XP por tipo de registro — espelha o gatilho award_xp_for_event no setup.sql.
   Se mudar lá, mude aqui (usado nos toasts e no feed de ganhos). */
export const XP_BY_KIND: Record<string, number> = {
  habit_done: 10, workout: 8, practice: 8, mood: 5, sleep: 5, nap: 2,
  meal: 4, water: 2, journal: 6, weight: 3, body: 4, gratitude: 5, transaction: 2,
};
export const XP_REASON_LABEL: Record<string, string> = {
  habit_done: "Hábito concluído", workout: "Treino registrado", practice: "Prática registrada",
  mood: "Humor registrado", sleep: "Sono registrado", nap: "Soneca registrada", meal: "Refeição registrada",
  water: "Hidratação registrada", journal: "Entrada no diário", weight: "Peso registrado",
  body: "Composição corporal registrada", gratitude: "Gratidão registrada", transaction: "Lançamento financeiro",
};
export const xpForKind = (kind: string) => XP_BY_KIND[kind] ?? 3;
/** Converte reasons antigos ("Registro: meal") para rótulo legível. */
export function xpReasonLabel(reason: string): string {
  const m = reason.match(/^Registro: (\w+)$/);
  return m ? (XP_REASON_LABEL[m[1]] ?? reason) : reason;
}