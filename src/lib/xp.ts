// Nível derivado do XP total. Curva suave: nível = √(xp/50) + 1.
// Nv1→2: 50xp | Nv2→3: 200xp | Nv3→4: 450xp ...
export function levelFromXp(xp: number) {
  const level = Math.floor(Math.sqrt(Math.max(xp, 0) / 50)) + 1;
  const currentFloor = 50 * (level - 1) ** 2;
  const nextFloor = 50 * level ** 2;
  const progress = nextFloor === currentFloor ? 0 : (xp - currentFloor) / (nextFloor - currentFloor);
  return { level, progress: Math.min(Math.max(progress, 0), 1), nextFloor, currentFloor };
}
