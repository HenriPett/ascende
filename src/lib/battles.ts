export interface Battle {
  id: string;
  name: string;
  discreet_name: string | null;
  triggers: string[];
  emergency_plan: string[];
  visible_to_ai: boolean;
  active: boolean;
}

export type CheckinStatus = "clean" | "resisted" | "relapsed";

export interface BattleCheckin {
  id: string;
  battle_id: string;
  checkin_date: string; // YYYY-MM-DD
  status: CheckinStatus;
  trigger_label: string | null;
  note: string | null;
}

export const COMMON_TRIGGERS = [
  "tédio", "madrugada", "celular na cama", "estresse", "solidão",
  "ansiedade", "cansaço", "depois de beber", "fim de semana", "trabalho",
];

export const BATTLE_TEMPLATES: { name: string; triggers: string[]; hint: string }[] = [
  { name: "Redes sociais", triggers: ["tédio", "celular na cama", "madrugada"], hint: "Rolagem infinita, comparação, horas perdidas" },
  { name: "Pornografia", triggers: ["madrugada", "solidão", "tédio", "celular na cama"], hint: "Com opção de nome discreto nas telas" },
  { name: "Cigarro / vape", triggers: ["estresse", "depois de beber", "café"], hint: "Um dia de cada vez" },
  { name: "Álcool", triggers: ["fim de semana", "estresse", "eventos sociais"], hint: "Reduzir ou zerar — você define" },
  { name: "Apostas", triggers: ["tédio", "madrugada", "propaganda"], hint: "Bets, jogos, raspadinhas" },
  { name: "Compras por impulso", triggers: ["ansiedade", "madrugada", "promoções"], hint: "Conecta com seu pilar Prosperidade" },
  { name: "Procrastinação", triggers: ["tarefas difíceis", "manhã", "celular por perto"], hint: "O ladrão silencioso de dias" },
];

export const MILESTONES = [3, 7, 14, 30, 90];

// Palavras que indicam tentativa de criar "batalha contra comida" —
// nesse caso o app redireciona para hábitos positivos de Alimentação.
const FOOD_PATTERN = /comid|comer|doce|açúcar|acucar|besteira|dieta|lanche|chocolate|refrigerante|fast\s*food|guloseima/i;
export const isFoodBattle = (name: string) => FOOD_PATTERN.test(name);

const dayISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface BattleStats {
  totalClean: number;      // dias limpos acumulados (NUNCA zera)
  currentStreak: number;   // sequência atual sem recaída
  record: number;          // recorde pessoal de sequência
  relapses: number;
  resisted: number;
  nextMilestone: number | null;
}

/**
 * Estatísticas a partir dos check-ins.
 * Sequência = dias de CALENDÁRIO consecutivos com check-in limpo/resistiu,
 * contando para trás a partir de hoje (ou de ontem, se hoje ainda não teve check-in).
 */
export function computeBattleStats(checkins: BattleCheckin[]): BattleStats {
  const byDate = new Map<string, CheckinStatus>();
  for (const c of checkins) byDate.set(c.checkin_date, c.status);

  const totalClean = checkins.filter((c) => c.status !== "relapsed").length;
  const relapses = checkins.filter((c) => c.status === "relapsed").length;
  const resisted = checkins.filter((c) => c.status === "resisted").length;

  // Sequência atual
  const today = new Date();
  const start = new Date(today);
  if (!byDate.has(dayISO(today))) start.setDate(start.getDate() - 1); // hoje ainda sem check-in não quebra
  let currentStreak = 0;
  for (let d = new Date(start); ; d.setDate(d.getDate() - 1)) {
    const s = byDate.get(dayISO(d));
    if (s === "clean" || s === "resisted") currentStreak++;
    else break;
  }

  // Recorde: maior corrida de dias consecutivos sem recaída no histórico
  const dates = [...byDate.keys()].sort();
  let record = currentStreak, run = 0;
  let prev: Date | null = null;
  for (const iso of dates) {
    const st = byDate.get(iso)!;
    const d = new Date(iso + "T00:00:00");
    const consecutive = prev !== null && d.getTime() - prev.getTime() === 864e5;
    if (st === "relapsed") run = 0;
    else run = consecutive || prev === null ? run + 1 : 1;
    if (run > record) record = run;
    prev = d;
  }

  const nextMilestone = MILESTONES.find((m) => m > currentStreak) ?? null;
  return { totalClean, currentStreak, record, relapses, resisted, nextMilestone };
}

export const battleLabel = (b: Battle) => b.discreet_name?.trim() || b.name;
