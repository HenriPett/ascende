// ASCENDE — Importação de CSV de apps de saúde (puro, testável, sem I/O).
//
// POR QUE ISTO NÃO PASSA PELA IA
// O Conselheiro dizia "absorvi seu arquivo" e não absorvia nada: 555 noites de
// sono num prompt estouram o limite de tokens, custam caro, demoram — e o que
// volta é alucinação, porque o modelo resume em vez de transcrever.
// CSV é dado ESTRUTURADO. Parsear aqui é instantâneo, de graça, e não inventa
// um número sequer. A IA continua sendo para o que ela faz bem: interpretar
// linguagem solta ("dormi mal ontem"), não transcrever planilha.
//
// Formatos reconhecidos hoje:
//   • Sleep Cycle  — export de sono, separado por ";"
//   • Hevy treinos — uma linha por SÉRIE; várias linhas = uma sessão
//   • Hevy medidas — peso corporal e circunferências
//
// Tudo o que não for reconhecido devolve null. Fingir que importou é
// exatamente o defeito que este módulo existe para corrigir.

import type { ProposedEvent } from "@/lib/captureEvents";

/** Fuso do app. Fixo em -03:00: o Brasil não tem horário de verão desde 2019,
 *  e todo export tratado aqui é posterior a isso. Constante em vez de
 *  `new Date(...)` local: o parsing precisa dar o mesmo resultado em qualquer
 *  máquina, inclusive no CI. */
const APP_UTC_OFFSET = "-03:00";

/** Teto por importação. Mantém as mais RECENTES: as janelas de 7 e 14 dias dos
 *  Indicadores são o que a pessoa vê, e um export de anos inteiros não deve
 *  virar uma fila de milhares de inserts. */
export const MAX_IMPORT_EVENTS = 1000;

export type HealthCsvFormat = "sleep" | "workout" | "measurement";

/** Grupos musculares do app — os mesmos de Vitalidade, para o mapa de
 *  equilíbrio continuar funcionando com treino importado. */
export const MUSCLE_GROUPS = ["Peito", "Costas", "Pernas", "Ombros", "Braços", "Core", "Cardio"] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface ImportedEvent extends ProposedEvent {
  /** Instante do registro, com fuso explícito. */
  occurred_at: string;
  /** "YYYY-MM-DD" — chave de deduplicação e rótulo na revisão. */
  day: string;
}

export interface ImportStats {
  /** Linhas de dado lidas (sem o cabeçalho). */
  rows: number;
  /** Linhas descartadas por estarem incompletas ou ilegíveis. */
  skipped: number;
  /** Registros do mesmo tipo e mesmo dia, colapsados em um. */
  duplicates: number;
  /** Registros cortados pelo teto de MAX_IMPORT_EVENTS. */
  truncated: number;
}

export interface ImportResult {
  format: HealthCsvFormat;
  /** App de origem, para a interface dizer o que reconheceu. */
  sourceLabel: string;
  events: ImportedEvent[];
  stats: ImportStats;
  range: { from: string; to: string } | null;
}

/* ── CSV ──────────────────────────────────────────────────────────────────
   Parser próprio em vez de split(","): o Hevy escreve títulos com vírgula
   dentro de aspas ("Quarta, ombros e braços"). Suporta aspas duplas com
   escape por duplicação ("" dentro do campo) e quebra de linha dentro do
   campo citado. */

export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delimiter) { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // Linhas totalmente vazias (fim de arquivo, linhas em branco no meio)
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Separador do arquivo: o que mais aparece FORA das aspas no cabeçalho. */
export function detectDelimiter(headerLine: string): string {
  let quoted = false;
  const count: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const c of headerLine) {
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted && c in count) count[c]++;
  }
  return (Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0) > 0
    ? Object.entries(count).sort((a, b) => b[1] - a[1])[0][0]
    : ",";
}

/** Nome de coluna comparável: sem acento, sem caixa, sem pontuação. */
function normalizeHeader(name: string): string {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/* ── Datas ────────────────────────────────────────────────────────────────
   Três formatos no mundo real: ISO do Sleep Cycle ("2022-08-03 08:15:39"),
   pt-BR abreviado do Hevy ("26 Ago 2026, 17:51") e o mesmo em inglês, quando
   o app está em outro idioma. Tudo vira wall-clock explícito: nada de
   `new Date(string)`, que muda de resultado conforme o fuso da máquina. */

const MONTHS: Record<string, number> = {
  jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6,
  jul: 7, ago: 8, aug: 8, set: 9, sep: 9, sept: 9, out: 10, oct: 10,
  nov: 11, dez: 12, dec: 12,
};

interface Stamp { y: number; mo: number; d: number; h: number; mi: number; s: number }

const pad = (n: number, len = 2) => String(n).padStart(len, "0");
const dayOf = (t: Stamp) => `${pad(t.y, 4)}-${pad(t.mo)}-${pad(t.d)}`;
const isoOf = (t: Stamp) => `${dayOf(t)}T${pad(t.h)}:${pad(t.mi)}:${pad(t.s)}${APP_UTC_OFFSET}`;

/** Minutos entre dois instantes do mesmo fuso. */
const minutesBetween = (a: Stamp, b: Stamp) =>
  (Date.UTC(b.y, b.mo - 1, b.d, b.h, b.mi, b.s) - Date.UTC(a.y, a.mo - 1, a.d, a.h, a.mi, a.s)) / 60000;

function valid(t: Stamp): Stamp | null {
  if (t.mo < 1 || t.mo > 12 || t.d < 1 || t.d > 31) return null;
  if (t.y < 1990 || t.y > 2100) return null;
  if (t.h > 23 || t.mi > 59 || t.s > 59) return null;
  return t;
}

export function parseStamp(raw: string): Stamp | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  // 2022-08-03 08:15:39 | 2022-08-03T08:15:39 | 2022-08-03
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return valid({
      y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: Math.floor(+(m[6] ?? 0)),
    });
  }

  // 26 Ago 2026, 17:51 | 10 Set 2025, 00:00 | 26 Aug 2026 17:51
  m = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const mo = MONTHS[normalizeHeader(m[2]).slice(0, 4)] ?? MONTHS[normalizeHeader(m[2]).slice(0, 3)];
    if (!mo) return null;
    return valid({ y: +m[3], mo, d: +m[1], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: Math.floor(+(m[6] ?? 0)) });
  }

  // 03/08/2022 08:15 (dd/mm/aaaa)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return valid({ y: +m[3], mo: +m[2], d: +m[1], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: Math.floor(+(m[6] ?? 0)) });
  }

  return null;
}

/** Número tolerante a vírgula decimal e a campo vazio. */
function num(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim().replace(/%$/, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ── Detecção de formato ──────────────────────────────────────────────────
   Por PRESENÇA de colunas, não por posição nem por nome exato: o export muda
   de idioma e de ordem entre versões do app. */

export interface DetectedFormat {
  format: HealthCsvFormat;
  sourceLabel: string;
  delimiter: string;
  headers: string[];
}

export function detectHealthCsv(text: string): DetectedFormat | null {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.trim() !== "");
  if (!firstLine) return null;

  const delimiter = detectDelimiter(firstLine);
  const headers = (parseCsv(firstLine, delimiter)[0] ?? []).map(normalizeHeader);
  if (headers.length < 2) return null;

  const has = (...names: string[]) => names.some((n) => headers.includes(n));
  const hasPrefix = (p: string) => headers.some((h) => h.startsWith(p));

  // Treino ANTES de peso: o export de treino do Hevy também tem weight_kg,
  // mas ali é a carga da série, não a pessoa na balança.
  if (has("exercise_title", "exercise", "exercicio") && has("start_time", "start", "inicio")) {
    return { format: "workout", sourceLabel: "treinos (Hevy)", delimiter, headers };
  }
  if (has("start") && has("end") && (hasPrefix("time_asleep") || hasPrefix("sleep_quality") || hasPrefix("time_in_bed"))) {
    return { format: "sleep", sourceLabel: "sono (Sleep Cycle)", delimiter, headers };
  }
  if (has("weight_kg", "weight", "peso", "peso_kg") && has("date", "data", "start_time")) {
    return { format: "measurement", sourceLabel: "peso e medidas", delimiter, headers };
  }
  return null;
}

/* ── Grupos musculares ────────────────────────────────────────────────────
   Do nome do exercício para o vocabulário do app. A ordem importa: "Crucifixo
   INVERTIDO" é ombro posterior, não peito, e cai na regra de invertido antes
   de chegar na de crucifixo. */

const MUSCLE_RULES: [MuscleGroup, RegExp][] = [
  ["Cardio", /esteira|corrida|correr|caminhada|bicicleta|bike|eliptico|escada|remo_ergometrico|cardio|spinning/],
  ["Core", /abdominal|abdomen|prancha|core|obliquo|infra/],
  ["Ombros", /invertid|posterior|desenvolvimento|elevacao_lateral|shoulder|ombro|deltoid|encolhimento_militar/],
  ["Braços", /rosca|biceps|triceps|martelo|scott|fundos|curl|extensao_de_triceps/],
  ["Pernas", /agachamento|leg_press|extensora|flexora|abdutora|adutora|panturrilha|quadriceps|posterior_de_coxa|hack|terra_romeno|afundo|avanco|gluteo|perna/],
  ["Costas", /remada|puxada|barra_fixa|pullover|pulldown|row|levantamento_terra|encolhimento|lombar|dorsal|costas|trapezio/],
  ["Peito", /supino|crucifixo|voador|peito|chest|press_de_peito|flexao/],
];

/** Grupos que o nome do exercício sugere. Vazio quando não dá para afirmar —
 *  chutar músculo enche o mapa de equilíbrio de ruído. */
export function musclesForExercise(title: string): MuscleGroup[] {
  const key = normalizeHeader(title);
  if (!key) return [];
  const found = new Set<MuscleGroup>();

  // "Crucifixo invertido" / "aberturas invertidas": ombro posterior.
  const isReverse = /invertid|posterior/.test(key);
  for (const [group, re] of MUSCLE_RULES) {
    if (!re.test(key)) continue;
    if (isReverse && (group === "Peito" || group === "Costas")) continue;
    found.add(group);
  }
  // Terra e terra romeno pegam costas e pernas — é o que são.
  return MUSCLE_GROUPS.filter((g) => found.has(g));
}

/* ── Parsers por formato ──────────────────────────────────────────────────
   Cada um devolve eventos JÁ no formato ProposedEvent que o app grava, mais
   `occurred_at` (a data REAL do registro, não a de hoje) e `day`. */

interface RowReader {
  (row: string[], col: (name: string, ...alts: string[]) => string | undefined): void;
}

function readRows(text: string, detected: DetectedFormat, onRow: RowReader): number {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""), detected.delimiter);
  const headers = (rows[0] ?? []).map(normalizeHeader);
  const index = (name: string) => headers.indexOf(name);

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const col = (name: string, ...alts: string[]) => {
      for (const n of [name, ...alts]) {
        const i = index(n);
        if (i >= 0 && row[i] !== undefined) return row[i];
      }
      // Última tentativa: coluna cujo nome COMEÇA com o pedido
      // ("time_asleep_seconds" para "time_asleep").
      for (const n of [name, ...alts]) {
        const i = headers.findIndex((h) => h.startsWith(n));
        if (i >= 0 && row[i] !== undefined) return row[i];
      }
      return undefined;
    };
    onRow(row, col);
  }
  return Math.max(0, rows.length - 1);
}

function parseSleep(text: string, detected: DetectedFormat) {
  const events: ImportedEvent[] = [];
  let skipped = 0;

  const rows = readRows(text, detected, (_row, col) => {
    const end = parseStamp(col("end", "fim") ?? "");
    const start = parseStamp(col("start", "inicio") ?? "");
    const seconds = num(col("time_asleep", "time_asleep_seconds", "asleep"));

    // A duração vem de "Time asleep (seconds)". Sem ela, cai para o tempo
    // entre deitar e levantar — pior, mas melhor que descartar a noite.
    let hours: number | null = seconds !== null && seconds > 0 ? seconds / 3600 : null;
    if (hours === null && start && end) hours = minutesBetween(start, end) / 60;
    if (!end || hours === null || hours <= 0 || hours > 24) { skipped++; return; }

    hours = Math.round(hours * 10) / 10;
    const quality = num(col("sleep_quality", "quality"));

    events.push({
      kind: "sleep",
      pillar: "vitalidade",
      // O sono conta no dia em que a pessoa ACORDA — é assim que ela lê
      // ("dormi 6h essa noite") e é como os Indicadores agrupam.
      occurred_at: isoOf(end),
      day: dayOf(end),
      hours,
      summary: `Sono: ${String(hours).replace(".", ",")}h`
        + (quality !== null && quality > 0 ? ` · qualidade ${Math.round(quality)}%` : ""),
    });
  });

  return { events, rows, skipped };
}

function parseWorkout(text: string, detected: DetectedFormat) {
  interface Session {
    title: string; start: Stamp; end: Stamp | null;
    exercises: Set<string>; sets: number; volume: number;
  }
  const sessions = new Map<string, Session>();
  let skipped = 0;

  const rows = readRows(text, detected, (_row, col) => {
    const start = parseStamp(col("start_time", "start", "inicio") ?? "");
    if (!start) { skipped++; return; }
    const title = (col("title", "titulo", "workout_name") ?? "").trim();
    const exercise = (col("exercise_title", "exercise", "exercicio") ?? "").trim();

    // Uma sessão = mesmo título + mesmo início. É assim que o Hevy escreve:
    // uma linha por SÉRIE, repetindo o cabeçalho da sessão em todas.
    const key = `${title}|${col("start_time", "start", "inicio")}`;
    let session = sessions.get(key);
    if (!session) {
      session = {
        title: title || "Treino",
        start,
        end: parseStamp(col("end_time", "end", "fim") ?? ""),
        exercises: new Set(),
        sets: 0,
        volume: 0,
      };
      sessions.set(key, session);
    }
    if (exercise) session.exercises.add(exercise);
    session.sets++;
    const kg = num(col("weight_kg", "weight", "peso"));
    const reps = num(col("reps", "repeticoes"));
    if (kg && reps) session.volume += kg * reps;
  });

  const events: ImportedEvent[] = [];
  for (const s of sessions.values()) {
    const muscles = [...new Set([...s.exercises].flatMap(musclesForExercise))];
    const ordered = MUSCLE_GROUPS.filter((g) => muscles.includes(g));
    const duration = s.end ? Math.round(minutesBetween(s.start, s.end)) : null;

    events.push({
      kind: "workout",
      pillar: "vitalidade",
      occurred_at: isoOf(s.start),
      day: dayOf(s.start),
      description: s.title,
      ...(duration && duration > 0 && duration < 600 ? { duration_min: duration } : {}),
      ...(ordered.length ? { muscles: ordered } : {}),
      summary: `Treino: ${s.title}${ordered.length ? ` (${ordered.join(", ")})` : ""}`,
    });
  }

  return { events, rows, skipped };
}

function parseMeasurement(text: string, detected: DetectedFormat) {
  const events: ImportedEvent[] = [];
  let skipped = 0;

  const rows = readRows(text, detected, (_row, col) => {
    const when = parseStamp(col("date", "data", "start_time") ?? "");
    const kg = num(col("weight_kg", "weight", "peso", "peso_kg"));
    // O mesmo arquivo traz linhas só de circunferência, sem peso: não são
    // erro, simplesmente não viram registro de peso.
    if (!when || kg === null || kg < 20 || kg > 400) { skipped++; return; }

    const fat = num(col("fat_percent", "body_fat", "gordura"));
    events.push({
      kind: "weight",
      // `alimentacao`, não `vitalidade`: é o pilar que o resto do app usa para
      // peso (Alimentacao.tsx, Onboarding.tsx) e o que a regra do CAPTURE_TOOL
      // no backend determina. Divergir aqui faria o peso importado não aparecer
      // junto do peso registrado à mão, na aba Corpo.
      pillar: "alimentacao",
      occurred_at: isoOf(when),
      day: dayOf(when),
      kg: Math.round(kg * 10) / 10,
      summary: `Peso: ${String(Math.round(kg * 10) / 10).replace(".", ",")} kg`
        + (fat !== null && fat > 0 ? ` · ${String(fat).replace(".", ",")}% de gordura` : ""),
    });
  });

  return { events, rows, skipped };
}

/* ── Entrada pública ──────────────────────────────────────────────────── */

/**
 * Lê um CSV de app de saúde e devolve os eventos prontos para revisão.
 * `null` quando o formato não é reconhecido — o chamador precisa dizer isso
 * à pessoa, nunca fingir que importou.
 */
export function parseHealthCsv(text: string): ImportResult | null {
  const detected = detectHealthCsv(text ?? "");
  if (!detected) return null;

  const parsed =
    detected.format === "sleep" ? parseSleep(text, detected)
      : detected.format === "workout" ? parseWorkout(text, detected)
        : parseMeasurement(text, detected);

  // Deduplicação por tipo + dia: dois registros do mesmo tipo no mesmo dia
  // viram um. Vence o PRIMEIRO em ordem cronológica — regra simples e
  // previsível, que a interface consegue explicar em uma linha.
  const byDay = new Map<string, ImportedEvent>();
  let duplicates = 0;
  const chronological = [...parsed.events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  for (const ev of chronological) {
    const key = `${ev.kind}|${ev.day}`;
    if (byDay.has(key)) { duplicates++; continue; }
    byDay.set(key, ev);
  }

  // Mais recentes primeiro, e o teto corta a cauda antiga.
  const all = [...byDay.values()].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const events = all.slice(0, MAX_IMPORT_EVENTS);
  const truncated = all.length - events.length;

  const days = events.map((e) => e.day).sort();

  return {
    format: detected.format,
    sourceLabel: detected.sourceLabel,
    events,
    stats: { rows: parsed.rows, skipped: parsed.skipped, duplicates, truncated },
    range: days.length ? { from: days[0], to: days[days.length - 1] } : null,
  };
}

/** Rótulo humano do tipo importado, no plural certo. */
export function formatLabel(format: HealthCsvFormat, count: number): string {
  if (format === "sleep") return count === 1 ? "1 noite de sono" : `${count} noites de sono`;
  if (format === "workout") return count === 1 ? "1 treino" : `${count} treinos`;
  return count === 1 ? "1 pesagem" : `${count} pesagens`;
}
