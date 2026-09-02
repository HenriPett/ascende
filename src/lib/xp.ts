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
// Densificados no meio e no topo (plano de feedbacks): a curva quadrática
// deixa os níveis altos lentos — sem marcos intermediários, o XP virava
// ruído no mês 3. Agora sempre há um "próximo título" a poucos níveis.
const TITLES: [minLevel: number, title: string][] = [
  [1, "Desperto"],
  [2, "Primeiro Passo"],
  [3, "Caminhante"],
  [4, "Ritmo de Trilha"],
  [5, "Trilheiro"],
  [6, "Meia-Encosta"],
  [7, "Escalador"],
  [8, "Acima da Névoa"],
  [10, "Guardião da Trilha"],
  [12, "Rocha Firme"],
  [13, "Montanhista"],
  [14, "Cordilheira"],
  [16, "Domador de Picos"],
  [18, "Ar Rarefeito"],
  [20, "Vento da Altitude"],
  [22, "Alta Montanha"],
  [25, "Lenda da Montanha"],
  [30, "Cume Maior"],
  [40, "Horizonte Infinito"],
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
/* Explica o XP uma única vez, no primeiro registro da vida do usuário
   (análise UX P2.3): "+4 XP" sem contexto não significa nada no dia 1.
   Única função com efeito colateral neste módulo — mora aqui porque é copy
   de XP, e o acesso a localStorage está protegido para nunca derrubar quem
   navega com armazenamento bloqueado (nem os testes, que rodam sem DOM). */
export function xpToastSuffix(): string {
  try {
    if (localStorage.getItem("ascend-xp-explained")) return "";
    localStorage.setItem("ascend-xp-explained", "1");
    return " — cada registro sobe seu nível de vida real";
  } catch { return ""; }
}
