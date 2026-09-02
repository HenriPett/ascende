// ASCENDE — Tendências verificáveis (Fase 3): O CÁLCULO.
//
// REGRA DE OURO: o modelo explica, o código calcula. Nenhum número que a
// pessoa vê sai de um LLM. É este arquivo que tira o número das mãos do
// modelo, e por isso ele é PURO: nenhum import de supabase, nenhuma leitura
// de relógio. A data de referência ENTRA como parâmetro.
//
// O critério de pronto da fase é reprodutibilidade: o mesmo conjunto de
// eventos tem que produzir o mesmo insight, sempre. Três coisas garantem isso:
//   1. zero `Date.now()` / `new Date()` sem argumento aqui dentro;
//   2. toda ordenação tem desempate explícito (por `day`, que é ISO e portanto
//      ordena cronologicamente como texto) — dois dias com o mesmo valor nunca
//      trocam de lugar entre execuções;
//   3. arredondamento único, aplicado só no fim (ROUND_DECIMALS).
//
// MÉTODO (deliberadamente simples, sem p-valor): pareia os dias em que os dois
// lados foram medidos, parte pela MEDIANA do lado esquerdo, compara a MEDIANA
// do lado direito entre os grupos. Mediana e não média porque uma única fatura
// de R$ 800 não pode ditar a conclusão da pessoa.

/** Versão da regra de cálculo. Persistida junto do insight: sem ela, mudar a
 *  fórmula em seis meses reescreveria o passado em silêncio e a pessoa veria
 *  um número diferente do que leu ontem, sem nada explicando por quê. */
export const CALC_VERSION = "insights/1";

/* ─── Parâmetros do método (todos do contrato da fase) ─────────────────── */
/** Dias pareados mínimos para qualquer conclusão. Conta sobre os pares
 *  VÁLIDOS (os dois lados medidos e, nas análises financeiras, o dia coberto
 *  por has_finance) — nunca sobre os dias do calendário. */
export const MIN_OVERLAP_DAYS = 21;
/** Dias mínimos em CADA grupo (alto e baixo). */
export const MIN_GROUP_DAYS = 7;
/** Diferença relativa mínima para chamar de tendência. */
export const MIN_RELATIVE_DIFF = 0.15;
/** Arredondamento único, aplicado apenas na saída. */
const ROUND_DECIMALS = 2;

/** Uma linha por (pessoa, dia local em America/Sao_Paulo).
 *  `null` = NÃO MEDIDO. `0` = medido e deu zero. Confundir os dois produz
 *  "você gastou R$ 0 com comida" para quem só não importou a fatura. */
export interface DailyMetrics {
  day: string;            // "2026-08-14" — data LOCAL, não UTC
  sleep_hours: number | null;
  workout_minutes: number | null;   // null = nenhum treino registrado no dia
  workout_count: number;            // 0 quando não houve
  meals_logged: number;             // quantas refeições a pessoa registrou
  food_spend: number;               // gasto com comida no dia (0 se nenhum)
  total_spend: number;              // gasto total no dia (0 se nenhum)
  /**
   * O lado financeiro deste dia EXISTE de verdade: o dia está coberto por um
   * extrato confirmado (data_sources kind='financial_statement',
   * status='confirmed') ou tem ao menos uma transação registrada.
   *
   * Existe porque `total_spend: 0` tem dois significados que o número não
   * separa: "não gastou nada nesse dia" e "essa pessoa não acompanha finanças
   * neste período". Sem esta coluna, quem importou fatura só de agosto entra
   * com zeros falsos em julho, e a comparação de medianas ACHA tendência onde
   * só existe buraco de dado — inventar padrão é pior que não ter padrão.
   *
   * Só as análises financeiras exigem isto; treino_sono não depende dele.
   */
  has_finance: boolean;
}

export type InsightKind = "sono_gasto_seguinte" | "refeicao_gasto_comida" | "treino_sono";
export type InsightStatus = "tendencia" | "sem_tendencia" | "dados_insuficientes";

/** Por que não deu para concluir. Existe para a tela poder ser específica em
 *  vez de dizer "faltam dados" para três situações diferentes. */
export type InsufficientReason =
  | "overlap"        // poucos dias em que os dois lados foram medidos
  | "grupo_pequeno"  // há dias, mas um dos grupos ficou abaixo do mínimo
  | "sem_variacao";  // um dos lados é constante: não há alto e baixo a comparar

/** Como os grupos foram partidos. Faz parte do que torna o número
 *  conferível: "acima_da_mediana" = alto é `> corte`; "a_partir_da_mediana" =
 *  alto é `>= corte`. Ver splitByMedian() para quando cada uma é usada. */
export type SplitRule = "acima_da_mediana" | "a_partir_da_mediana";

export interface InsightPeriod {
  /** Primeiro e último dia que ENTRARAM no cálculo (não a janela pedida). */
  start: string;
  end: string;
}

interface InsightBase {
  kind: InsightKind;
  calc_version: string;
  /** Quantos dias pareados entraram. É o "quantos dias" que a tela mostra. */
  sample_size: number;
  period: InsightPeriod | null;
  /** O que foi comparado, em português, exatamente como o cálculo fez. */
  labels: { left: string; right: string };
}

export interface TrendInsight extends InsightBase {
  status: "tendencia";
  /** Mediana do lado direito no grupo de valor ALTO do lado esquerdo. */
  high_group_median: number;
  low_group_median: number;
  high_group_days: number;
  low_group_days: number;
  /** Mediana do lado esquerdo que separou os grupos. */
  split_value: number;
  split_rule: SplitRule;
  /** Variação relativa do grupo alto em relação ao baixo, em %. Negativo =
   *  o grupo alto teve valor MENOR. Ver relativeDiff() para o denominador. */
  delta_pct: number;
  direction: "maior" | "menor";
}

export interface NoTrendInsight extends InsightBase {
  status: "sem_tendencia";
  high_group_median: number;
  low_group_median: number;
  high_group_days: number;
  low_group_days: number;
  split_value: number;
  split_rule: SplitRule;
  delta_pct: number;
}

export interface InsufficientInsight extends InsightBase {
  status: "dados_insuficientes";
  reason: InsufficientReason;
  /** Quantos dias ainda faltam. Para `overlap`, quantos dias pareados faltam
   *  para chegar a MIN_OVERLAP_DAYS. Para `grupo_pequeno`, quantos dias faltam
   *  ao MENOR grupo para chegar a MIN_GROUP_DAYS. Para `sem_variacao` é 0:
   *  o que falta ali não é quantidade de dias, é variação. */
  days_missing: number;
}

export type Insight = TrendInsight | NoTrendInsight | InsufficientInsight;

/* ─── Primitivas ──────────────────────────────────────────────────────── */

/** Arredondamento único da saída. Os cálculos correm em precisão cheia e só
 *  o resultado passa por aqui — arredondar no meio faz o número derivar. */
function round(value: number): number {
  const f = 10 ** ROUND_DECIMALS;
  return Math.round(value * f) / f;
}

/**
 * Mediana. Para tamanho par é a média dos dois centrais, o que a torna
 * independente de como empates foram ordenados: é parte de por que a saída não
 * muda quando a entrada vem embaralhada.
 */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Variação relativa do grupo alto em relação ao BAIXO (a referência, que é o
 * que a frase para a pessoa diz: "nos dias de X alto, Y foi tanto % menor").
 * Denominador é |mediana do baixo|; quando ela é 0 o quociente não existe,
 * então: 0 vs 0 = 0% (nada mudou) e 0 vs algo = 100% (mudança máxima
 * representável) — nunca Infinity, que envenenaria a comparação e a serialização.
 */
export function relativeDiff(lowMedian: number, highMedian: number): number {
  if (lowMedian === 0) return highMedian === 0 ? 0 : (highMedian > 0 ? 1 : -1);
  return (highMedian - lowMedian) / Math.abs(lowMedian);
}

/** Um par pronto para análise: os dois lados já medidos. */
interface Pair {
  /** Dia que ancora o par (o dia do lado ESQUERDO). */
  day: string;
  left: number;
  right: number;
}

/**
 * Ordena os pares de forma TOTAL: por valor do lado esquerdo e, em caso de
 * empate, pelo dia. Sem o desempate, dois dias com o mesmo valor podem trocar
 * de lugar entre execuções (o `sort` do V8 é estável, mas a ordem de ENTRADA
 * não é garantida) — é o empate mal desempatado que passa despercebido no
 * teste ingênuo e quebra a reprodutibilidade em produção.
 */
function sortPairs(pairs: Pair[]): Pair[] {
  return [...pairs].sort((a, b) => (a.left - b.left) || a.day.localeCompare(b.day));
}

/**
 * Índice por dia, para conseguir olhar o dia seguinte em O(1). Se a mesma data
 * aparecer duas vezes (não deveria: a view é uma linha por pessoa/dia), a
 * PRIMEIRA em ordem de dia vence — decisão arbitrária mas fixa, para a saída
 * não depender da ordem em que as linhas chegaram.
 */
function indexByDay(rows: DailyMetrics[]): Map<string, DailyMetrics> {
  const byDay = new Map<string, DailyMetrics>();
  for (const row of [...rows].sort((a, b) => a.day.localeCompare(b.day))) {
    if (!byDay.has(row.day)) byDay.set(row.day, row);
  }
  return byDay;
}

/** "2026-08-14" + 1 dia = "2026-08-15". Aritmética em UTC de propósito: a
 *  string já é a data LOCAL, então somar aqui não pode reintroduzir fuso. */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  const out = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${out.getUTCFullYear()}-${p(out.getUTCMonth() + 1)}-${p(out.getUTCDate())}`;
}

/* ─── O motor comum das três análises ─────────────────────────────────── */

/**
 * Parte os pares em grupo baixo e alto pela mediana do lado esquerdo.
 *
 * Invariante que vem primeiro: valores IGUAIS do lado esquerdo ficam SEMPRE no
 * mesmo grupo. Dois dias com o mesmo valor receberam o mesmo "tratamento" e
 * não podem cair em grupos diferentes só porque o índice do meio caiu no meio
 * de um empate — seria arbitrário e, pior, mudaria com a ordem de entrada.
 *
 * Isso obriga a cortar por VALOR, e aí nenhuma regra única serve para todas as
 * formas de dado:
 *   • sono em {5,8} com 11 e 10 dias -> mediana 5. Com `>= mediana` o grupo
 *     BAIXO fica vazio.
 *   • refeicoes em {0,3} com 15 e 16 dias -> mediana 3. Com `> mediana` o
 *     grupo ALTO fica vazio, e uma comparacao legitima ("registrou x nao
 *     registrou") morreria como falta de variacao. E o caso real: meals_logged
 *     e workout_count tem cardinalidade baixissima.
 *
 * Entao tentamos `> mediana` e, se isso esvaziar um lado, `>= mediana`. A
 * ordem das tentativas e fixa, logo o resultado e deterministico; e a regra
 * escolhida sai na saida (`split_rule`), porque numero que a pessoa nao pode
 * conferir e pior que nenhum.
 */
function splitByMedian(pairs: Pair[], splitValue: number): {
  low: Pair[]; high: Pair[]; rule: SplitRule;
} {
  const strictHigh = pairs.filter((p) => p.left > splitValue);
  const strictLow = pairs.filter((p) => p.left <= splitValue);
  if (strictHigh.length && strictLow.length) {
    return { low: strictLow, high: strictHigh, rule: "acima_da_mediana" };
  }
  const inclusiveHigh = pairs.filter((p) => p.left >= splitValue);
  const inclusiveLow = pairs.filter((p) => p.left < splitValue);
  return { low: inclusiveLow, high: inclusiveHigh, rule: "a_partir_da_mediana" };
}

function insufficient(
  kind: InsightKind, labels: { left: string; right: string },
  sample: number, period: InsightPeriod | null,
  reason: InsufficientReason, daysMissing: number,
): InsufficientInsight {
  return {
    kind, calc_version: CALC_VERSION, sample_size: sample, period, labels,
    status: "dados_insuficientes", reason, days_missing: daysMissing,
  };
}

/**
 * Recebe pares já montados e aplica o método. Devolver `dados_insuficientes`
 * aqui é SUCESSO, não erro: é a resposta honesta quando os dados não sustentam
 * conclusão, e a tela deve mostrá-la em vez de esconder o card.
 */
function analyze(
  kind: InsightKind, labels: { left: string; right: string }, pairs: Pair[],
): Insight {
  const sorted = sortPairs(pairs);
  const days = sorted.map((p) => p.day).sort((a, b) => a.localeCompare(b));
  const period: InsightPeriod | null = days.length
    ? { start: days[0], end: days[days.length - 1] }
    : null;

  // 1. Overlap mínimo.
  if (sorted.length < MIN_OVERLAP_DAYS) {
    return insufficient(kind, labels, sorted.length, period, "overlap",
      MIN_OVERLAP_DAYS - sorted.length);
  }

  // 2. Corte pela mediana do lado esquerdo (ver splitByMedian).
  const splitValue = median(sorted.map((p) => p.left));
  const { low, high, rule } = splitByMedian(sorted, splitValue);

  // 3. Um lado constante não tem alto e baixo para comparar. Isso é falta de
  //    VARIAÇÃO, não de dias — dizer "faltam N dias" aqui seria mentira.
  if (!low.length || !high.length) {
    return insufficient(kind, labels, sorted.length, period, "sem_variacao", 0);
  }

  // 4. Tamanho mínimo de cada grupo.
  const smaller = Math.min(low.length, high.length);
  if (smaller < MIN_GROUP_DAYS) {
    return insufficient(kind, labels, sorted.length, period, "grupo_pequeno",
      MIN_GROUP_DAYS - smaller);
  }

  const lowMedian = median(low.map((p) => p.right));
  const highMedian = median(high.map((p) => p.right));

  // 5. Lado direito inteiro em zero: não é "nenhum padrão", é ausência de
  //    dado daquele lado (típico de quem não registrou finanças no período).
  //    Concluir "não encontramos padrão" a partir de zeros seria vender uma
  //    medida que não fizemos.
  if (lowMedian === 0 && highMedian === 0 && sorted.every((p) => p.right === 0)) {
    return insufficient(kind, labels, sorted.length, period, "sem_variacao", 0);
  }

  const diff = relativeDiff(lowMedian, highMedian);
  const common = {
    kind, calc_version: CALC_VERSION, sample_size: sorted.length, period, labels,
    high_group_median: round(highMedian),
    low_group_median: round(lowMedian),
    high_group_days: high.length,
    low_group_days: low.length,
    split_value: round(splitValue),
    split_rule: rule,
    delta_pct: round(diff * 100),
  };

  // 6. Abaixo do mínimo relativo, "não encontramos padrão" é a resposta — e é
  //    uma resposta útil, que aparece na tela em vez de sumir.
  if (Math.abs(diff) < MIN_RELATIVE_DIFF) {
    return { ...common, status: "sem_tendencia" };
  }
  return { ...common, status: "tendencia", direction: diff > 0 ? "maior" : "menor" };
}

/* ─── As três análises ────────────────────────────────────────────────── */

/**
 * Sono do dia D × gasto TOTAL do dia D+1.
 *
 * O deslocamento de +1 dia é fixado pelo contrato da fase. Registro de uma
 * limitação real dos dados, para quem for revisar: o sono chega ao banco por
 * duas portas com significados diferentes — o check-in matinal (antes das 12h,
 * e portanto a noite que TERMINOU naquela manhã) e a captura em texto livre a
 * qualquer hora ("dormi 5h" dito à noite pode ser a noite que vai começar).
 * Não há campo que distinga as duas, então qualquer deslocamento é aproximado.
 * O rótulo abaixo diz exatamente o que foi calculado: o gasto do dia seguinte
 * ao dia em que o sono foi registrado.
 *
 * `sleep_hours` null é NÃO MEDIDO e o dia não entra — nunca vira 0, porque
 * "não registrei" e "dormi zero hora" são coisas diferentes.
 */
export function sono_gasto_seguinte(rows: DailyMetrics[]): Insight {
  const byDay = indexByDay(rows);
  const pairs: Pair[] = [];
  for (const [day, row] of byDay) {
    if (row.sleep_hours == null) continue;          // não medido: fora
    const next = byDay.get(addDays(day, 1));
    if (!next) continue;                            // sem o dia seguinte, não há par
    // O lado financeiro tem que existir no dia LIDO (o D+1, de onde sai o
    // gasto). Sem isso, um zero de "não acompanha finanças" viraria um zero
    // de "não gastou" e o método concluiria em cima de buraco.
    if (!next.has_finance) continue;
    pairs.push({ day, left: row.sleep_hours, right: next.total_spend });
  }
  return analyze("sono_gasto_seguinte", {
    left: "horas de sono registradas no dia",
    right: "gasto total do dia seguinte",
  }, pairs);
}

/**
 * Refeições registradas no dia × gasto com comida do MESMO dia.
 *
 * Não é "planejamento": não existe sinal de planejamento no banco (não há
 * hábito de planejar nem check-in de plano por dia). O que medimos é a pessoa
 * ter registrado o que comeu, e é isso que o rótulo diz. Chamar de
 * planejamento seria vender uma medida que não fizemos.
 *
 * `has_finance` protege o lado do GASTO (ver DailyMetrics), mas não o lado das
 * refeições: um dia coberto por extrato em que a pessoa não registrou nada
 * ainda entra como (0 refeições, R$ 0) e engrossa o grupo baixo. Sobra como
 * limitação conhecida — a view só tem linha para dias com algum registro, o
 * que já corta o dia totalmente vazio, mas não o dia em que ela registrou
 * outra coisa e não a comida.
 */
export function refeicao_gasto_comida(rows: DailyMetrics[]): Insight {
  const pairs: Pair[] = [];
  for (const [day, row] of indexByDay(rows)) {
    if (!row.has_finance) continue;   // gasto do dia precisa existir de verdade
    pairs.push({ day, left: row.meals_logged, right: row.food_spend });
  }
  return analyze("refeicao_gasto_comida", {
    left: "refeições registradas no dia",
    right: "gasto com comida no mesmo dia",
  }, pairs);
}

/**
 * Treino no dia D × sono da noite SEGUINTE ao treino, ou seja `sleep_hours`
 * do dia D+1.
 *
 * DECISÃO EXPLÍCITA (esta é minha, não do contrato):
 * O check-in de sono do app é MATINAL — só aparece antes das 12h em SP e
 * pergunta pela noite que acabou. Logo `sleep_hours[D]` é a noite D-1 → D: ela
 * terminou ANTES de o treino do dia D acontecer. Usá-la mediria o sono que
 * PRECEDEU o treino, que é a pergunta inversa ("dormir bem faz treinar?"), não
 * a que a fase quer. A noite que vem DEPOIS do treino do dia D é a noite
 * D → D+1, registrada na manhã de D+1: `sleep_hours[D + 1]`.
 * O rótulo diz a mesma coisa que o cálculo fez.
 *
 * Lado esquerdo é `workout_count` (não `workout_minutes`): a contagem é
 * não-nula por contrato, com 0 significando "não treinou" — que é informação
 * medida. `workout_minutes` é null em dia sem treino, e transformá-lo em 0
 * seria exatamente a confusão que o contrato proíbe.
 */
export function treino_sono(rows: DailyMetrics[]): Insight {
  const byDay = indexByDay(rows);
  const pairs: Pair[] = [];
  for (const [day, row] of byDay) {
    const next = byDay.get(addDays(day, 1));
    if (!next || next.sleep_hours == null) continue;  // sono não medido: fora
    pairs.push({ day, left: row.workout_count, right: next.sleep_hours });
  }
  return analyze("treino_sono", {
    left: "treinos registrados no dia",
    right: "horas de sono da noite seguinte ao treino",
  }, pairs);
}

/* ─── Orquestrador ────────────────────────────────────────────────────── */

export interface InsightRun {
  calc_version: string;
  /** Data de referência do cálculo. PARÂMETRO, nunca lida do relógio: é o que
   *  permite rodar duas vezes e obter exatamente o mesmo resultado. */
  reference_day: string;
  /** Janela considerada, derivada de reference_day e lookbackDays. */
  window: InsightPeriod;
  insights: Insight[];
}

/** Ordem fixa de saída: comparar duas execuções não pode depender de ordem. */
const ANALYSES: ((rows: DailyMetrics[]) => Insight)[] = [
  sono_gasto_seguinte,
  refeicao_gasto_comida,
  treino_sono,
];

/**
 * Roda as três análises sobre a janela que termina em `referenceDay`.
 *
 * `referenceDay` é o último dia considerado (inclusive) e entra como
 * parâmetro — nenhuma leitura de relógio aqui dentro. Linhas fora da janela
 * são descartadas ANTES do cálculo, para que a mesma janela sobre o mesmo
 * banco dê sempre o mesmo número, independentemente de quando rodou.
 */
export function computeInsights(
  rows: DailyMetrics[], referenceDay: string, lookbackDays = 90,
): InsightRun {
  const start = addDays(referenceDay, -(lookbackDays - 1));
  const inWindow = rows.filter((r) => r.day >= start && r.day <= referenceDay);
  return {
    calc_version: CALC_VERSION,
    reference_day: referenceDay,
    window: { start, end: referenceDay },
    insights: ANALYSES.map((fn) => fn(inWindow)),
  };
}
