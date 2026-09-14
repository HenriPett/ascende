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
  /** Compra parcelada registrada à mão: todas as N linhas compartilham este
   *  id. É o ÚNICO vínculo entre elas — parceladas antigas, vindas da fatura,
   *  têm `null` aqui e não se inventa vínculo por texto para elas. */
  group_id?: string | null;
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

/** Primeiro dia do ciclo a que `todayIso` pertence (YYYY-MM-DD).
 *  ESPELHO do SQL em materialize_recurrences_for():
 *    date_trunc('month', sp_today - make_interval(days => cday - 1))::date + (cday - 1)
 *  Com cycleDay ausente/1 devolve o primeiro dia do mês civil. */
export function cycleStartISO(todayIso: string, cycleDay?: number | null): string {
  const day = clampCycleDay(cycleDay);
  const [y, m, dd] = todayIso.slice(0, 10).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, dd));
  d.setUTCDate(d.getUTCDate() - (day - 1));
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  start.setUTCDate(start.getUTCDate() + (day - 1));
  return start.toISOString().slice(0, 10);
}

/**
 * A data em que um fixo do dia `dayOfMonth` deve ser materializado para cair
 * DENTRO do ciclo corrente.
 *
 * ESPELHO do SQL em materialize_recurrences_for() (setup.sql e migração
 * 20260914160000):
 *   (date_trunc('month', cycle_start)
 *      + case when day_of_month >= cday then interval '0' else interval '1 month' end)::date
 *    + (day_of_month - 1)
 *
 * POR QUE NÃO É O MÊS CIVIL: o ciclo corrente é [C do mês M, C do mês M+1 − 1].
 * Dentro dessa janela existe EXATAMENTE UMA ocorrência do dia D — é isso que
 * torna a regra bem definida, sem escolha arbitrária:
 *   D >= C  →  D do mês M      (ciclo 10, fixo 25 → 25/09)
 *   D <  C  →  D do mês M+1    (ciclo 10, fixo  5 → 05/10)
 * Datar o segundo caso em 05/09 seria datá-lo num dia que JÁ PERTENCE ao ciclo
 * anterior: foi esse o bug que deixou o salário do fundador fora do ciclo, com
 * a tela dizendo "Entradas: R$ 0".
 *
 * ESTA FUNÇÃO RODA NOS DOIS LADOS — o banco materializa os fixos do ciclo e o
 * cliente materializa NA HORA o que a pessoa acabou de criar (Raio-X, adoção
 * do salário, novo recorrente), porque a função do banco só roda quando o app
 * abre. As duas datas precisam coincidir; src/lib/cicloCliente.test.ts confronta
 * esta função com uma transcrição literal do SQL para provar que coincidem.
 *
 * `dayOfMonth` é 1..28 por CHECK no banco; o clamp aqui é só defesa (e é o
 * mesmo que o antigo currentMonthDayISO fazia).
 */
export function cycleOccurrenceISO(
  todayIso: string,
  cycleDay: number | null | undefined,
  dayOfMonth: number,
): string {
  const day = clampCycleDay(cycleDay);
  const d = Math.min(28, Math.max(1, Math.round(Number(dayOfMonth)) || 1));
  const [sy, sm] = cycleStartISO(todayIso, cycleDay).split("-").map(Number);
  const base = new Date(Date.UTC(sy, sm - 1 + (d >= day ? 0 : 1), 1));
  base.setUTCDate(base.getUTCDate() + (d - 1));
  return base.toISOString().slice(0, 10);
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
/* ─────────────────────────────────────────────────────────────────
   COMPRA PARCELADA REGISTRADA À MÃO

   Pela fatura importada isto já existia: o servidor expande a compra em
   todas as parcelas, passadas e futuras. À mão não existia — e é aqui que
   mora o dinheiro que a pessoa mais erra, porque o parcelamento é o único
   gasto que ela assume HOJE e paga em ciclos que ainda nem começaram.

   ESTE BLOCO ESPELHA supabase/functions/_shared/lib.ts (addMonthsClamp e a
   expansão em normalizeStatementItems). Espelhar é o padrão da casa para
   regra que roda nos dois lados — o servidor é Deno, o app é Vite, e não há
   módulo compartilhado entre eles. O que impede as duas cópias de divergirem
   em silêncio é src/lib/parcelas.test.ts: ele fixa a mesma aritmética que a
   fatura usa (mesma data-base, mesmo passo de um mês, mesmo rótulo "k/N").
   Se alguém mexer em um lado só, o teste cai.

   POR QUE SOMAR MÊS CIVIL RESOLVE O CICLO: somar um mês a um dia fixo avança
   exatamente UM ciclo, para qualquer financial_cycle_day — varrido nos testes
   com as 28 configurações de ciclo. A parcela k nasce em
   addMonthsClamp(dataDaCompra, k-1) e cai sozinha no ciclo certo. Não existe
   aritmética de ciclo aqui de propósito: inventá-la seria uma segunda regra
   para o mesmo fato.
────────────────────────────────────────────────────────────────── */

export const MIN_INSTALLMENTS = 2;
/** Mesmo teto do servidor (STATEMENT_MAX_INSTALLMENTS, _shared/lib.ts). */
export const MAX_INSTALLMENTS = 24;

/** Soma `delta` meses a uma data ISO, fixando o dia ao último dia do mês
 *  quando necessário (31/01 + 1 mês → 28/02).
 *  ESPELHO de addMonthsClamp() em supabase/functions/_shared/lib.ts. */
export function addMonthsClamp(iso: string, delta: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const idx = (m - 1) + delta;
  const ny = y + Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export interface InstallmentRow {
  /** 1..count */
  index: number;
  amount: number;
  occurred_at: string; // YYYY-MM-DD
  /** "Sofá · 3/10" — MESMA grafia da importação de fatura, de propósito:
   *  duas grafias para a mesma coisa seria o app falando duas línguas. */
  description: string;
}

export interface InstallmentPlan {
  count: number;
  rows: InstallmentRow[];
  /** Soma EXATA das parcelas. É este número que a linha de resumo mostra. */
  total: number;
  /** A parcela que se repete. */
  each: number;
  /** Quantas parcelas levam 1 centavo a mais (0 quando divide redondo). */
  oddCount: number;
  /** `each + 0,01` quando há sobra; igual a `each` quando não há. */
  oddAmount: number;
}

/**
 * Expande uma compra parcelada nas N linhas que ela realmente é.
 *
 * DOIS MODOS DE ENTRADA, UM SÓ CAMPO DIGITADO:
 * • "parcela" (padrão) — a pessoa digita o que a nota grita ("10x de R$ 43,90")
 *   e o total é calculado. Divisão não acontece: toda parcela é o valor
 *   digitado e o total é parcela × N, exato ao centavo.
 * • "total" — para quem só tem o total na mão. Aqui a divisão pode não fechar.
 *
 * ONDE VAI A DIFERENÇA DE CENTAVOS (modo "total"):
 * a conta é feita em CENTAVOS inteiros. `base = piso(total / N)` e a sobra
 * `r = total − base × N` (0..N−1 centavos) é distribuída de 1 em 1 nas r
 * PRIMEIRAS parcelas. Três razões, nesta ordem:
 *   1. a soma bate com o total digitado por construção — a pessoa confere
 *      contra a nota e fecha, que é o requisito inegociável;
 *   2. nenhuma parcela se afasta mais de 1 centavo da divisão ideal;
 *   3. a sobra cai no começo, em ciclos que a pessoa ainda vai conferir contra
 *      a fatura, e não escondida numa parcela a dez meses de distância que
 *      ninguém reconcilia — e é também como a fatura costuma arredondar.
 * E, principalmente: a linha de resumo DIZ isso em voz alta ("as 3 primeiras,
 * R$ 43,91"). A pessoa nunca descobre a diferença por subtração.
 *
 * Devolve `null` quando o plano não é registrável: número de parcelas fora de
 * [2, 24], valor não positivo, ou total tão pequeno que não daria 1 centavo
 * por parcela (a coluna `amount` exige > 0 — plano inválido não vira linha).
 */
export function buildInstallmentPlan(input: {
  amount: number;
  count: number;
  mode: "parcela" | "total";
  /** Já resolvida (descrição digitada ou, na falta, a categoria). */
  description: string;
  purchaseDate: string; // YYYY-MM-DD
}): InstallmentPlan | null {
  const count = Math.round(Number(input.count));
  if (!Number.isFinite(count) || count < MIN_INSTALLMENTS || count > MAX_INSTALLMENTS) return null;
  const cents = Math.round((Number(input.amount) || 0) * 100);
  if (!Number.isFinite(cents) || cents <= 0) return null;

  let base: number;
  let odd: number;
  let totalCents: number;
  if (input.mode === "total") {
    totalCents = cents;
    if (totalCents < count) return null;
    base = Math.floor(totalCents / count);
    odd = totalCents - base * count;
  } else {
    base = cents;
    odd = 0;
    totalCents = cents * count;
  }

  const label = input.description.trim();
  const rows: InstallmentRow[] = [];
  for (let k = 1; k <= count; k++) {
    rows.push({
      index: k,
      amount: (base + (k <= odd ? 1 : 0)) / 100,
      occurred_at: addMonthsClamp(input.purchaseDate, k - 1),
      description: `${label} · ${k}/${count}`,
    });
  }
  return {
    count, rows,
    total: totalCents / 100,
    each: base / 100,
    oddCount: odd,
    oddAmount: (base + (odd > 0 ? 1 : 0)) / 100,
  };
}

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "set/2026" — o mês do CICLO em que a data cai (com cycleDay 1 é o mês
 *  civil). Abreviação em tabela, não em toLocaleDateString: o rótulo entra em
 *  teste e não pode depender do ICU da máquina. */
const cycleMonthLabel = (iso: string, cycleDay?: number | null): string => {
  const [y, m] = cycleKey(iso, cycleDay).split("-").map(Number);
  return `${MONTHS_PT[m - 1]}/${y}`;
};

/** "de set/2026 a jun/2027" — a faixa de ciclos que a compra vai ocupar.
 *  É esta frase que impede a surpresa: deixa explícito, ANTES do toque, que
 *  a maioria das parcelas está no futuro. */
export function installmentSpanLabel(plan: InstallmentPlan, cycleDay?: number | null): string {
  const first = cycleMonthLabel(plan.rows[0].occurred_at, cycleDay);
  const last = cycleMonthLabel(plan.rows[plan.rows.length - 1].occurred_at, cycleDay);
  return first === last ? first : `de ${first} a ${last}`;
}

/** A linha de resumo ao vivo, logo acima do botão:
 *  "10x de R$ 43,90 · total R$ 439,00 · de set/2026 a jun/2027".
 *  O formatador entra por parâmetro para o teste não depender de locale. */
export function installmentSummary(
  plan: InstallmentPlan,
  money: (v: number) => string,
  cycleDay?: number | null,
): string {
  const head = plan.oddCount > 0
    ? `${plan.count}x de ${money(plan.each)} (${plan.oddCount === 1 ? "a 1ª" : `as ${plan.oddCount} primeiras`}, ${money(plan.oddAmount)})`
    : `${plan.count}x de ${money(plan.each)}`;
  return `${head} · total ${money(plan.total)} · ${installmentSpanLabel(plan, cycleDay)}`;
}

/** Posição da parcela dentro da compra, pela ORDEM DAS DATAS — nunca lendo
 *  o "3/10" do texto. O vínculo é o group_id; o texto é só rótulo. */
export function installmentPosition(
  rows: { id: string; occurred_at: string }[],
  id: string,
): { index: number; count: number } {
  const sorted = [...rows].sort(
    (a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id),
  );
  const i = sorted.findIndex((r) => r.id === id);
  return { index: i < 0 ? 0 : i + 1, count: sorted.length };
}

/** Quantas parcelas já aconteceram (data <= hoje). Apagar a compra inteira é
 *  onde mais se erra: a pessoa quer limpar o futuro e leva junto ciclos
 *  fechados. Esta contagem existe para ela ver isso antes. */
export function countPastInstallments(
  rows: { occurred_at: string }[],
  todayIso: string,
): number {
  return rows.filter((r) => r.occurred_at <= todayIso).length;
}

/** Rótulo da opção destrutiva:
 *  "A compra inteira — 10 lançamentos, 2 já passaram".
 *  A contagem de passados é OBRIGATÓRIA (decisão do desenho): é ela que evita
 *  apagar meses já fechados achando que se limpava só o futuro. */
export function groupDeletionLabel(count: number, past: number): string {
  const n = `${count} ${count === 1 ? "lançamento" : "lançamentos"}`;
  const p = past <= 0 ? "nenhum passou ainda"
    : past === 1 ? "1 já passou"
    : `${past} já passaram`;
  return `A compra inteira — ${n}, ${p}`;
}
