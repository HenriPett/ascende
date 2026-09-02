// ASCENDE — Tendências verificáveis: a camada de dados (Fase 3).
//
// Aqui NÃO mora regra de cálculo. A conta é pura e vive em insights.ts, sem
// Supabase e sem relógio, porque o critério da fase é reprodutibilidade: o
// mesmo conjunto de eventos tem que produzir o mesmo insight, duas vezes
// seguidas. Este arquivo só faz duas coisas: ler os dias agregados e guardar
// (ou reler) o resultado.
//
// O tipo `DailyMetrics` é o contrato entre os dois lados. Ele está declarado
// aqui porque é a forma da linha que a leitura devolve — quem calcula importa
// com `import type`, que o TypeScript apaga na compilação, então nenhum teste
// puro acaba puxando o cliente do Supabase por tabela.
//
// A distinção que atravessa o arquivo inteiro: `null` é NÃO MEDIDO, `0` é
// medido e deu zero. Nenhuma função aqui pode transformar um no outro — é o
// que separa "você não dormiu" de "você não registrou o sono".

import { supabase } from "@/integrations/supabase/client";

/** Uma linha por (pessoa, dia local em America/Sao_Paulo), vinda da view
 *  `daily_metrics`. Só existe linha para dias em que a pessoa registrou
 *  alguma coisa — dia sem registro nenhum não vira zero. */
export interface DailyMetrics {
  /** "2026-08-14" — data LOCAL, não UTC. */
  day: string;
  /** null = não mediu. Só sono noturno; soneca (`nap`) não entra. */
  sleep_hours: number | null;
  /** null = nenhum treino, ou treino sem duração declarada. */
  workout_minutes: number | null;
  workout_count: number;
  meals_logged: number;
  food_spend: number;
  total_spend: number;
  /**
   * O dia tem COBERTURA financeira? É o que separa "gastou zero" de "não
   * acompanha finanças por aqui" — sem isso, os dois viram `total_spend: 0` e
   * o cálculo encontra tendência dentro de um buraco de dado.
   *
   * true quando: (a) um extrato CONFIRMADO da pessoa cobre este dia (aí a
   * ausência de lançamento é informação: ela não gastou), ou (b) existe
   * lançamento neste dia (anotação manual, sem extrato).
   *
   * Quem calcula gasto deve descartar os dias com false — não são zero,
   * são ausência.
   */
  has_finance: boolean;
  /** Critério MAIS RIGOROSO: o gasto do dia vem de extrato CONFIRMADO, então
   *  existe mesmo que a pessoa não tenha aberto o app naquele dia.
   *  `refeicao_gasto_comida` exige este, e não `has_finance`: lá os dois lados
   *  são "ela registrou algo hoje", e sem extrato a análise mediria o uso do
   *  app em vez do comportamento com comida. */
  finance_from_statement: boolean;
}

/** Nomes internos das três análises (viram a coluna `kind`, com CHECK no
 *  banco: escrever qualquer outra coisa é erro de gravação, não dado novo). */
export type InsightKind = "sono_gasto_seguinte" | "refeicao_gasto_comida" | "treino_sono";

/** `sem_tendencia` e `dados_insuficientes` são RESULTADOS, não falhas: as duas
 *  aparecem na tela. Esconder o "não encontramos padrão" seria mostrar só o
 *  que deu certo, que é a forma educada de mentir. */
export type InsightStatus = "tendencia" | "sem_tendencia" | "dados_insuficientes";

export interface Insight {
  id: string;
  user_id: string;
  kind: InsightKind;
  /** Versão da REGRA que produziu isto (ex.: "insights/1"). Faz parte da
   *  identidade: mudar a fórmula não reescreve o passado em silêncio. */
  calc_version: string;
  period_start: string;
  period_end: string;
  /** Dias PAREADOS que entraram na conta (o overlap), não dias do período. */
  sample_size: number;
  status: InsightStatus;
  /** Números crus da conta — é o que deixa a pessoa (e nós) conferir. */
  result: Record<string, unknown>;
  headline: string | null;
  computed_at: string;
  source_ids: string[];
}

export interface NewInsight {
  userId: string;
  kind: InsightKind;
  calcVersion: string;
  periodStart: string;
  periodEnd: string;
  sampleSize: number;
  status: InsightStatus;
  result?: Record<string, unknown>;
  headline?: string | null;
  sourceIds?: string[];
}

/* ── Conversões ─────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));

/** Número que PRESERVA o null. `numeric` pode chegar como string dependendo
 *  do driver; o que não pode, em hipótese alguma, é null virar 0 no caminho. */
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Número de coluna declarada não-nula (contagens e gastos). */
const num = (v: unknown): number => numOrNull(v) ?? 0;

function toDailyMetrics(row: Row): DailyMetrics {
  return {
    day: str(row.day).slice(0, 10),
    sleep_hours: numOrNull(row.sleep_hours),
    workout_minutes: numOrNull(row.workout_minutes),
    workout_count: num(row.workout_count),
    meals_logged: num(row.meals_logged),
    food_spend: num(row.food_spend),
    total_spend: num(row.total_spend),
    has_finance: row.has_finance === true,
    finance_from_statement: row.finance_from_statement === true,
  };
}

function toInsight(row: Row): Insight {
  const result = row.result;
  return {
    id: str(row.id),
    user_id: str(row.user_id),
    kind: str(row.kind) as InsightKind,
    calc_version: str(row.calc_version),
    period_start: str(row.period_start).slice(0, 10),
    period_end: str(row.period_end).slice(0, 10),
    sample_size: num(row.sample_size),
    status: str(row.status) as InsightStatus,
    result: result && typeof result === "object" ? (result as Record<string, unknown>) : {},
    headline: typeof row.headline === "string" && row.headline ? row.headline : null,
    computed_at: str(row.computed_at),
    source_ids: Array.isArray(row.source_ids) ? row.source_ids.map(str) : [],
  };
}

/* ── Leitura dos dias ───────────────────────────────────────────────────── */

/**
 * Os dias agregados da pessoa dentro do período (extremos incluídos),
 * ordenados do mais antigo para o mais novo.
 *
 * A ordenação vem do banco e é por `day`, que é único por pessoa: a mesma
 * consulta devolve sempre a mesma sequência, e é isso que permite ao cálculo
 * ser reproduzível sem depender de sorte de ordenação.
 *
 * Dias sem registro NENHUM não aparecem — não são zero, são ausência. Quem
 * calcula precisa tratar buraco como buraco. O mesmo vale, do lado do
 * dinheiro, para os dias com `has_finance: false`.
 */
export async function readDailyMetrics(
  userId: string, periodStart: string, periodEnd: string,
): Promise<DailyMetrics[]> {
  if (!userId || !periodStart || !periodEnd) return [];
  const { data, error } = await supabase.from("daily_metrics")
    .select(
      "day,sleep_hours,workout_minutes,workout_count,meals_logged," +
      "food_spend,total_spend,has_finance,finance_from_statement",
    )
    .eq("user_id", userId)
    .gte("day", periodStart)
    .lte("day", periodEnd)
    .order("day", { ascending: true })
    .limit(1000); // ~3 anos de dias com registro; acima disso é recorte errado
  // LANÇA, não devolve []. Uma lista vazia aqui é ambígua do jeito mais caro
  // possível: a tela não tem como distinguir "a view não existe / o RLS barrou"
  // de "a pessoa não registrou nada", e acaba dizendo "0 de 21 dias" para quem
  // registrou 60. Acusar a própria pessoa de não ter dado por causa de uma
  // migração não aplicada é o pior modo de falha desta fase.
  if (error) throw new Error(`Não consegui ler seus dias: ${error.message}`);
  return (data ?? []).map((r) => toDailyMetrics(r as unknown as Row));
}

/* ── Insights ───────────────────────────────────────────────────────────── */

const INSIGHT_COLS =
  "id,user_id,kind,calc_version,period_start,period_end,sample_size,status," +
  "result,headline,computed_at,source_ids";

/**
 * Grava o resultado. Recalcular o MESMO período com a MESMA versão de regra
 * ATUALIZA a linha em vez de empilhar outra — é para isso que existe o índice
 * único (user_id, kind, calc_version, period_start, period_end).
 *
 * Consequência que vale saber: um insight calculado pela regra antiga
 * continua existindo ao lado do novo, porque `calc_version` faz parte da
 * identidade. É de propósito: dá para dizer "isto foi calculado pela regra
 * antiga" em vez de o número mudar sozinho da noite para o dia.
 */
export async function upsertInsight(input: NewInsight): Promise<Insight | null> {
  const { data, error } = await supabase.from("insights").upsert({
    user_id: input.userId,
    kind: input.kind,
    calc_version: input.calcVersion,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    sample_size: input.sampleSize,
    status: input.status,
    result: input.result ?? {},
    headline: input.headline ?? null,
    source_ids: input.sourceIds ?? [],
    computed_at: new Date().toISOString(),
  }, { onConflict: "user_id,kind,calc_version,period_start,period_end" })
    .select(INSIGHT_COLS)
    .maybeSingle();
  if (error) { console.error("upsertInsight", error.message); return null; }
  return data ? toInsight(data as unknown as Row) : null;
}

/** Os insights da pessoa, mais recentes primeiro. `calcVersion` filtra pela
 *  regra atual — sem ele, vêm também os calculados por regras antigas. */
export async function listInsights(
  userId: string, opts: { calcVersion?: string; limit?: number } = {},
): Promise<Insight[]> {
  if (!userId) return [];
  let query = supabase.from("insights").select(INSIGHT_COLS).eq("user_id", userId);
  if (opts.calcVersion) query = query.eq("calc_version", opts.calcVersion);
  const { data, error } = await query
    .order("computed_at", { ascending: false })
    .limit(opts.limit ?? 50);
  // Mesma razão do readDailyMetrics: vazio precisa significar vazio.
  if (error) throw new Error(`Não consegui ler suas tendências: ${error.message}`);
  return (data ?? []).map((r) => toInsight(r as unknown as Row));
}

/** O insight exato de um período (o mesmo que o upsert atualizaria). Serve
 *  para a tela não recalcular o que já está gravado. */
export async function getInsight(
  userId: string, kind: InsightKind, calcVersion: string,
  periodStart: string, periodEnd: string,
): Promise<Insight | null> {
  const { data, error } = await supabase.from("insights").select(INSIGHT_COLS)
    .eq("user_id", userId).eq("kind", kind).eq("calc_version", calcVersion)
    .eq("period_start", periodStart).eq("period_end", periodEnd)
    .maybeSingle();
  if (error) { console.error("getInsight", error.message); return null; }
  return data ? toInsight(data as unknown as Row) : null;
}

/* ── "Isso te ajudou?" (Fase 6, medida 4) ─────────────────────────────────
   A única coleta nova das sete medidas, e ela existe porque utilidade é
   juízo da pessoa: não dá para inferir sem perguntar.

   A linha registra uma AÇÃO NOSSA ("perguntamos sobre X"), não comportamento
   dela — nenhuma rolagem, nenhum tempo de tela, nada para terceiro. É a
   mesma classe do guides_seen, que já é o padrão da casa para não repetir o
   que já dissemos. Por isso `answer` é anulável: null é "perguntamos e ela
   não respondeu", que é um dos três estados, não um buraco.

   Teto: uma pergunta por análise por pessoa. Três na vida da conta. */

export type InsightAnswer = "sim" | "nao";

export interface InsightFeedback {
  id: string;
  user_id: string;
  kind: InsightKind;
  /** null = perguntamos e ela não respondeu · "sim" · "nao". */
  answer: InsightAnswer | null;
  asked_at: string;
  answered_at: string | null;
  /** Qual insight estava na tela quando perguntamos (pode ter sido apagado). */
  insight_id: string | null;
  /** Estado do card no momento da pergunta — não dá para derivar depois,
   *  porque o insight é atualizado no lugar a cada recálculo. */
  asked_status: "tendencia" | "sem_tendencia" | null;
}

const FEEDBACK_COLS = "id,user_id,kind,answer,asked_at,answered_at,insight_id,asked_status";

function toFeedback(row: Row): InsightFeedback {
  const answer = str(row.answer);
  const askedStatus = str(row.asked_status);
  return {
    id: str(row.id),
    user_id: str(row.user_id),
    kind: str(row.kind) as InsightKind,
    answer: answer === "sim" || answer === "nao" ? answer : null,
    asked_at: str(row.asked_at),
    answered_at: typeof row.answered_at === "string" && row.answered_at ? row.answered_at : null,
    insight_id: typeof row.insight_id === "string" && row.insight_id ? row.insight_id : null,
    asked_status: askedStatus === "tendencia" || askedStatus === "sem_tendencia" ? askedStatus : null,
  };
}

/** O que já foi perguntado a esta pessoa. A tela mostra a pergunta apenas
 *  para os `kind` que NÃO aparecem aqui — é isso que garante que ninguém é
 *  perguntado duas vezes, tenha respondido ou não. */
export async function listInsightFeedback(userId: string): Promise<InsightFeedback[]> {
  if (!userId) return [];
  const { data, error } = await supabase.from("insight_feedback")
    .select(FEEDBACK_COLS).eq("user_id", userId);
  if (error) { console.error("listInsightFeedback", error.message); return []; }
  return (data ?? []).map((r) => toFeedback(r as unknown as Row));
}

/**
 * Registra que a pergunta foi posta na tela. Idempotente por (user_id, kind).
 *
 * `ignoreDuplicates` não é detalhe: sem ele, um segundo render faria o upsert
 * SOBRESCREVER a linha e apagar a resposta que a pessoa já tinha dado. Com
 * ele, o banco simplesmente não faz nada quando a linha existe.
 *
 * Melhor esforço: falhar em anotar a pergunta não pode quebrar o card.
 */
export async function recordInsightAsked(
  userId: string, kind: InsightKind,
  opts: { insightId?: string | null; askedStatus?: "tendencia" | "sem_tendencia" | null } = {},
): Promise<void> {
  const { error } = await supabase.from("insight_feedback").upsert({
    user_id: userId,
    kind,
    insight_id: opts.insightId ?? null,
    asked_status: opts.askedStatus ?? null,
  }, { onConflict: "user_id,kind", ignoreDuplicates: true });
  if (error) console.error("recordInsightAsked", error.message);
}

/**
 * Guarda a resposta. Atualiza a linha da pergunta (preservando `asked_at`,
 * que é quando perguntamos); se por algum motivo a linha não existir — a
 * pessoa respondeu antes de a anotação da pergunta ter ido ao banco —, cria.
 */
export async function answerInsight(
  userId: string, kind: InsightKind, answer: InsightAnswer,
): Promise<InsightFeedback | null> {
  const answered_at = new Date().toISOString();
  const { data, error } = await supabase.from("insight_feedback")
    .update({ answer, answered_at })
    .eq("user_id", userId).eq("kind", kind)
    .select(FEEDBACK_COLS).maybeSingle();
  if (error) { console.error("answerInsight", error.message); return null; }
  if (data) return toFeedback(data as unknown as Row);

  const { data: created, error: insErr } = await supabase.from("insight_feedback")
    .insert({ user_id: userId, kind, answer, answered_at })
    .select(FEEDBACK_COLS).maybeSingle();
  if (insErr) { console.error("answerInsight insert", insErr.message); return null; }
  return created ? toFeedback(created as unknown as Row) : null;
}
