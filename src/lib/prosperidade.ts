// Prosperidade em camadas — tipos e lógica pura (testável, sem I/O).
//
// O mês financeiro tem três camadas, da mais barata para a mais precisa:
//   1. ESTIMADO   — "chute honesto" por categoria variável (category_estimates)
//   2. RECORRENTE — fixos cadastrados uma vez, materializados todo mês
//   3. REAL       — lançamentos do dia a dia (manual, captura, importação)
//
// Regra de composição do mês corrente, por categoria variável:
//   previsto = max(real acumulado, estimativa) — o real SUBSTITUI o estimado,
//   nunca soma com ele. O trecho estimado aparece hachurado nos gráficos e é
//   declarado como premissa na boca do Conselheiro.

export const CATEGORIES = [
  "Mercado", "Alimentação fora", "Transporte", "Moradia", "Saúde", "Lazer",
  "Educação", "Assinaturas", "Salário", "Extra", "Outros",
] as const;

/** Categorias variáveis: as que a pessoa controla no dia a dia — só elas
 *  recebem estimativa. Fixos viram recorrentes; o resto é real. */
export const VARIABLE_CATEGORIES = ["Mercado", "Alimentação fora", "Transporte", "Lazer"] as const;

/** Sugestões de fixos do Raio-X (a pessoa adiciona os que existem para ela). */
export const FIXED_SUGGESTIONS = [
  { category: "Moradia", label: "Aluguel / prestação" },
  { category: "Moradia", label: "Contas de casa (luz, água, internet)" },
  { category: "Assinaturas", label: "Assinaturas (streaming, celular...)" },
  { category: "Transporte", label: "Transporte fixo (mensalidade, seguro)" },
  { category: "Educação", label: "Escola / curso" },
  { category: "Saúde", label: "Plano de saúde / academia" },
  { category: "Outros", label: "Parcelas / empréstimos" },
] as const;

export type TxSource = "manual" | "capture" | "import" | "recurring";

export interface Tx {
  id: string;
  kind: "income" | "expense";
  amount: number;
  category: string;
  description: string | null;
  occurred_at: string; // YYYY-MM-DD
  source: TxSource;
  recurring_id?: string | null;
}

export interface CategoryEstimate {
  id: string;
  category: string;
  amount: number;
}

export interface RecurringTx {
  id: string;
  kind: "income" | "expense";
  amount: number;
  category: string;
  description: string | null;
  day_of_month: number;
  active: boolean;
}

/** Lançamento PROPOSTO pela importação de fatura — só grava após confirmação.
 *  Compras parceladas são expandidas no servidor: além da parcela da fatura,
 *  entram as passadas e as futuras (origin marca cada uma; o usuário desmarca
 *  o que não quiser e duplicatas já registradas vêm desmarcadas). */
export interface ProposedStatementTx {
  kind: "income" | "expense";
  amount: number;
  category: string;
  description: string;
  occurred_at: string; // YYYY-MM-DD
  origin?: "statement" | "past" | "future";
  installment?: string | null; // "3/10"
}

export interface CategoryComposition {
  category: string;
  real: number;       // registrado (qualquer source)
  estimated: number;  // estimativa declarada (0 se não houver)
  /** max(real, estimated): o valor "previsto" do mês para esta categoria. */
  expected: number;
  /** Parte ainda estimada (expected − real), para o trecho hachurado. */
  estimatedRemainder: number;
}

/** Compõe real × estimado por categoria variável, sem dupla contagem. */
export function composeVariableMonth(
  monthExpensesByCategory: Record<string, number>,
  estimates: CategoryEstimate[],
): CategoryComposition[] {
  const estMap: Record<string, number> = {};
  for (const e of estimates) estMap[e.category] = Number(e.amount);
  const cats = [...new Set([...Object.keys(estMap), ...Object.keys(monthExpensesByCategory)])];
  return cats
    .map((category) => {
      const real = Math.max(0, monthExpensesByCategory[category] ?? 0);
      const estimated = Math.max(0, estMap[category] ?? 0);
      const expected = Math.max(real, estimated);
      return { category, real, estimated, expected, estimatedRemainder: Math.max(0, expected - real) };
    })
    .sort((a, b) => b.expected - a.expected);
}

export interface MonthMap {
  /** Entrada prevista do mês: max(renda declarada, entradas reais). */
  incomeExpected: number;
  incomeReal: number;
  incomeDeclared: number;
  /** Fixos comprometidos: soma das despesas recorrentes ativas. */
  committed: number;
  /** Variáveis previstos: soma dos expected por categoria variável. */
  variableExpected: number;
  variableReal: number;
  /** O que sobra para viver: entrada − comprometido − variáveis previstos. */
  leftover: number;
  /** true quando alguma parte do mapa vem de estimativa (rotular no UI). */
  hasEstimates: boolean;
}

/** O "Mapa do mês": o gráfico que tem valor no dia 1. */
export function buildMonthMap(
  monthlyIncomeDeclared: number,
  monthIncomeReal: number,
  recurrings: RecurringTx[],
  variableComposition: CategoryComposition[],
): MonthMap {
  const incomeDeclared = Math.max(0, monthlyIncomeDeclared || 0);
  const incomeReal = Math.max(0, monthIncomeReal || 0);
  const incomeExpected = Math.max(incomeDeclared, incomeReal);
  const committed = recurrings
    .filter((r) => r.active && r.kind === "expense")
    .reduce((s, r) => s + Number(r.amount), 0);
  const variableExpected = variableComposition.reduce((s, c) => s + c.expected, 0);
  const variableReal = variableComposition.reduce((s, c) => s + c.real, 0);
  const hasEstimates =
    incomeExpected === incomeDeclared && incomeDeclared > incomeReal ||
    variableComposition.some((c) => c.estimatedRemainder > 0);
  return {
    incomeExpected, incomeReal, incomeDeclared,
    committed, variableExpected, variableReal,
    leftover: incomeExpected - committed - variableExpected,
    hasEstimates,
  };
}

/** Resultado mensal estimado (base da projeção quando não há histórico):
 *  renda − fixos − variáveis estimados.
 *  Renda declarada (Raio-X) e recorrentes de ENTRADA (Salário) são a mesma
 *  renda vista por dois caminhos — vale max(declarada, recorrentes de
 *  entrada), nunca a soma (mesma regra do resto do sistema). */
export function estimatedMonthlyNet(
  monthlyIncomeDeclared: number,
  recurrings: RecurringTx[],
  estimates: CategoryEstimate[],
): number | null {
  const active = recurrings.filter((r) => r.active);
  const recIncome = active.filter((r) => r.kind === "income")
    .reduce((s, r) => s + Number(r.amount), 0);
  const recExpense = active.filter((r) => r.kind === "expense")
    .reduce((s, r) => s + Number(r.amount), 0);
  const income = Math.max(Math.max(0, monthlyIncomeDeclared || 0), recIncome);
  if (income <= 0 && recExpense <= 0 && !estimates.length) return null;
  const estOut = estimates.reduce((s, e) => s + Number(e.amount), 0);
  return income - recExpense - estOut;
}

export interface CalibrationRow {
  category: string;
  estimated: number;
  real: number;
  /** Sugestão de nova estimativa (real do mês anterior, arredondado a R$ 10).
   *  `0` quando o mês fechou sem gasto nenhum na categoria: ali a sugestão é
   *  zerar a reserva, não arredondar nada. */
  suggestion: number;
}

/**
 * Calibração do fechamento: compara mês ANTERIOR (estimado × real) e sugere
 * ajuste quando a diferença é relevante. Pergunta, não bronca.
 *
 * GASTO REAL ZERO TAMBÉM ENTRA — e é o caso que mais importa.
 *
 * Antes havia um `if (real <= 0) continue` com a justificativa "sem registro
 * real: nada a calibrar". É o contrário: a categoria que fechou o mês em R$ 0
 * é justamente a estimativa mais mal calibrada da lista. A pessoa reservou
 * R$ 500 em Lazer, gastou nada, e o "sobra para viver" ficou R$ 500 mais
 * pessimista o mês inteiro — sem que a única tela que existe para perguntar
 * "sua estimativa bateu?" tivesse perguntado.
 *
 * Duas escolhas para não virar cobrança:
 * • a sugestão é `0` (zerar), não um arredondamento de zero;
 * • só entra a partir de `minAbsDiff`, para uma estimativa de R$ 5 esquecida
 *   não gerar linha nenhuma. A checagem relativa (`minRelDiff`) não se aplica
 *   aqui: com real 0 a diferença relativa é sempre 100%, então ela não separa
 *   nada e o piso absoluto é o único filtro que decide.
 */
export function buildCalibration(
  prevMonthExpensesByCategory: Record<string, number>,
  estimates: CategoryEstimate[],
  minAbsDiff = 30,
  minRelDiff = 0.15,
): CalibrationRow[] {
  const rows: CalibrationRow[] = [];
  for (const e of estimates) {
    const real = Math.max(0, prevMonthExpensesByCategory[e.category] ?? 0);
    const est = Number(e.amount);
    if (real <= 0) {
      if (est < minAbsDiff) continue;
      rows.push({ category: e.category, estimated: est, real: 0, suggestion: 0 });
      continue;
    }
    const diff = Math.abs(real - est);
    if (diff < minAbsDiff || diff < est * minRelDiff) continue;
    rows.push({ category: e.category, estimated: est, real, suggestion: Math.max(10, Math.round(real / 10) * 10) });
  }
  return rows.sort((a, b) => Math.abs(b.real - b.estimated) - Math.abs(a.real - a.estimated));
}

/** Soma despesas por categoria dentro de um mês/ciclo (chave 'YYYY-MM'). */
export function expensesByCategory(txs: Tx[], monthKey: string, cycleDay?: number | null): Record<string, number> {
  const map: Record<string, number> = {};
  for (const t of txs) {
    if (t.kind !== "expense" || cycleKey(t.occurred_at, cycleDay) !== monthKey) continue;
    map[t.category] = (map[t.category] ?? 0) + Number(t.amount);
  }
  return map;
}

/* ─────────────────────────────────────────────────────────────────
   Ciclo financeiro customizável (TODO do fundador): por padrão o "mês"
   é o mês civil (dia 1 ao último dia). Quem tem salário/fatura fechando
   em outro dia pode declarar um `financial_cycle_day` (1-28) — o ciclo
   vira nesse dia, e tudo que hoje é bucketizado por mês civil (mapa do
   mês, gráficos, lista de lançamentos) passa a respeitar o ciclo dele.
   cycleDay ausente/1 é IDÊNTICO ao comportamento anterior — ninguém que
   não configurar nada é afetado.
────────────────────────────────────────────────────────────────── */

const clampCycleDay = (cycleDay?: number | null): number =>
  cycleDay && cycleDay >= 2 && cycleDay <= 28 ? Math.round(cycleDay) : 1;

/** Chave do ciclo ('YYYY-MM') a que uma data (YYYY-MM-DD) pertence: o mês em
 *  que o ciclo COMEÇOU. Com cycleDay=1 é idêntico a `iso.slice(0, 7)`. */
export function cycleKey(iso: string, cycleDay?: number | null): string {
  const day = clampCycleDay(cycleDay);
  if (day === 1) return iso.slice(0, 7);
  const [y, m, dd] = iso.slice(0, 10).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, dd));
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 7);
}

/** Rótulo do período: nome do mês civil (cycleDay=1) ou faixa "10 ago – 09 set". */
export function cycleRangeLabel(key: string, cycleDay?: number | null): string {
  const day = clampCycleDay(cycleDay);
  const [y, m] = key.split("-").map(Number);
  if (day === 1) {
    const raw = new Date(y, m - 1, 2).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  const start = new Date(y, m - 1, day);
  const end = new Date(y, m, day - 1);
  const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Quantos dias já se passaram desde o início do ciclo corrente (1 = primeiro
 *  dia do ciclo). Com cycleDay=1, é sempre igual ao dia do mês civil. */
export function daysSinceCycleStart(today: Date, cycleDay?: number | null): number {
  const day = clampCycleDay(cycleDay);
  if (day === 1) return today.getDate();
  let start = new Date(today.getFullYear(), today.getMonth(), day);
  if (start.getTime() > today.getTime()) start = new Date(today.getFullYear(), today.getMonth() - 1, day);
  return Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1;
}