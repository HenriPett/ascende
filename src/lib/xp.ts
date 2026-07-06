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