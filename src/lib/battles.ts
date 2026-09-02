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
  /**
   * A MÉTRICA PRINCIPAL: dias de calendário desde a última recaída. Não
   * pergunta se você registrou — pergunta se você recaiu. Por isso nenhuma
   * ausência a quebra. É a conta que o AA faz há noventa anos.
   * `null` = a batalha ainda não tem check-in nenhum.
   */
  daysSinceRelapse: number | null;
  /** De onde `daysSinceRelapse` conta: da última recaída, ou do primeiro
   *  check-in (quando nunca houve recaída). Muda a frase na tela. */
  cleanSince: "relapse" | "start" | null;
  /** Dias sem check-in. Existe para a tela poder ser HONESTA sobre o que
   *  não sabe ("23 dias desde a última recaída · 3 dias sem check-in") em
   *  vez de inflar em silêncio. Ver a nota de honestidade abaixo. */
  checkinGapDays: number;
  currentStreak: number;   // dias consecutivos COM check-in limpo/resistiu
  record: number;          // recorde pessoal de sequência
  relapses: number;
  resisted: number;
  nextMilestone: number | null;
}

/**
 * Estatísticas a partir dos check-ins.
 *
 * POR QUE EXISTEM DOIS NÚMEROS, E NÃO UM
 *
 * A versão anterior tinha só `currentStreak`, e ela quebrava no `else break`
 * de qualquer dia sem check-in. Isto é: `undefined` (não registrei) e
 * `"relapsed"` (recaí) tinham EXATAMENTE o mesmo efeito. Quem ficou 40 dias
 * limpo e passou cinco dias sem abrir o app voltava e lia "0" — e a barra do
 * próximo marco voltava ao começo.
 *
 * Isso é streak punitivo, que está na lista NUNCA do POSICIONAMENTO (§G.3) e
 * é prometido em público em DOIS lugares: /recusas ("Nunca usaremos sequência
 * que pune sua semana ruim. A sequência tem dia de descanso embutido") e a
 * landing. A promessa descrevia o comportamento da sequência de dias ativos
 * da Hoje (que tolera um descanso por semana) e era assinada como se valesse
 * também para a Batalha, que não tolerava nada.
 *
 * O agravante é o assunto: batalha é pornografia, cigarro, álcool, aposta. Ver
 * "0 dias" por esquecimento, num pilar onde a recaída é o evento normal, é o
 * gatilho clássico do "que-se-dane" descrito por Marlatt — o deslize (aqui nem
 * deslize houve) vira desistência porque o sistema tratou ausência como queda.
 *
 * A CORREÇÃO NÃO É PERDOAR MAIS, É PERGUNTAR OUTRA COISA:
 * `daysSinceRelapse` conta dias desde a última RECAÍDA. Nenhuma ausência a
 * quebra, porque ela não depende de registro nenhum.
 *
 * E A HONESTIDADE NÃO PODE SER SACRIFICADA JUNTO: contar dia não-registrado
 * como "limpo" seria autoengano, e em apostas ou álcool o autoengano é dano
 * real. Por isso `checkinGapDays` sai junto: a tela mostra os dois, e quem
 * está há três dias sem check-in lê isso escrito. Acolhimento sem conivência.
 *
 * `today` entra por parâmetro para o teste não depender do relógio (mesma
 * disciplina de lib/insights.ts).
 */
export function computeBattleStats(
  checkins: BattleCheckin[],
  today: Date = new Date(),
): BattleStats {
  const byDate = new Map<string, CheckinStatus>();
  for (const c of checkins) byDate.set(c.checkin_date, c.status);

  const totalClean = checkins.filter((c) => c.status !== "relapsed").length;
  const relapses = checkins.filter((c) => c.status === "relapsed").length;
  const resisted = checkins.filter((c) => c.status === "resisted").length;

  const dates = [...byDate.keys()].sort();
  const todayIso = dayISO(today);
  /** Dias inteiros entre uma data ISO e hoje. Nunca negativo: um check-in
   *  com data no futuro (relógio do aparelho adiantado) contaria dias
   *  negativos e viraria "-2 dias desde a última recaída" na tela. */
  const daysUntilToday = (iso: string) =>
    Math.max(0, Math.round(
      (new Date(todayIso + "T00:00:00").getTime() - new Date(iso + "T00:00:00").getTime()) / 864e5,
    ));

  // A métrica principal: desde a última recaída. Sem recaída nenhuma, conta
  // desde o primeiro check-in — a frase na tela muda junto (`cleanSince`),
  // porque "30 dias desde a última recaída" para quem nunca recaiu seria
  // afirmar uma recaída que não houve.
  const lastRelapse = [...dates].reverse().find((iso) => byDate.get(iso) === "relapsed") ?? null;
  const daysSinceRelapse = lastRelapse
    ? daysUntilToday(lastRelapse)
    : dates.length ? daysUntilToday(dates[0]) : null;
  const cleanSince: BattleStats["cleanSince"] =
    lastRelapse ? "relapse" : dates.length ? "start" : null;

  const lastCheckin = dates.length ? dates[dates.length - 1] : null;
  const checkinGapDays = lastCheckin ? daysUntilToday(lastCheckin) : 0;

  // Sequência de dias COM check-in limpo/resistiu. Continua existindo, agora
  // como número secundário e rotulado como o que é — não é mais ela que
  // manda na barra de marco.
  const start = new Date(today);
  if (!byDate.has(todayIso)) start.setDate(start.getDate() - 1); // hoje ainda sem check-in não quebra
  let currentStreak = 0;
  for (const d = new Date(start); ; d.setDate(d.getDate() - 1)) {
    const s = byDate.get(dayISO(d));
    if (s === "clean" || s === "resisted") currentStreak++;
    else break;
  }

  // Recorde: maior corrida de dias consecutivos sem recaída no histórico
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

  // O marco passa a correr sobre daysSinceRelapse: é o número que a promessa
  // pública descreve. Com currentStreak aqui, a barra do marco continuaria
  // voltando ao começo por ausência — que é exatamente o bug.
  const nextMilestone = MILESTONES.find((m) => m > (daysSinceRelapse ?? 0)) ?? null;
  return {
    totalClean, daysSinceRelapse, cleanSince, checkinGapDays,
    currentStreak, record, relapses, resisted, nextMilestone,
  };
}

export const battleLabel = (b: Battle) => b.discreet_name?.trim() || b.name;
