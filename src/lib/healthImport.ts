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
// COMO O RECONHECIMENTO FUNCIONA (e por que não há um parser por app)
// Um parser por aplicativo seria uma dívida que cresce sozinha: cada novidade
// do mercado viraria um arquivo novo. Aqui existe um parser por CONCEITO
// (sono, treino, peso, alimentação) e uma TABELA DE SINÔNIMOS de coluna. O
// detector olha quais CONCEITOS o cabeçalho oferece, não de qual app ele veio.
// Consequência prática: apoiar um app novo costuma ser acrescentar um sinônimo
// naquela tabela, não escrever código.
//
// Tudo o que não for reconhecido devolve null. Fingir que importou é
// exatamente o defeito que este módulo existe para corrigir.

import type { ProposedEvent } from "@/lib/captureEvents";
import { isPlausibleBodyWeightKg } from "@/lib/bodyWeight";

/** Fuso do app. Fixo em -03:00: o Brasil não tem horário de verão desde 2019,
 *  e todo export tratado aqui é posterior a isso. Constante em vez de
 *  `new Date(...)` local: o parsing precisa dar o mesmo resultado em qualquer
 *  máquina, inclusive no CI. */
const APP_UTC_OFFSET = "-03:00";
/** O mesmo fuso em minutos, para converter carimbo que vem com fuso próprio. */
const APP_OFFSET_MINUTES = -180;

/** Teto por importação.
 *
 * POR QUE 15.000, E POR QUE 1.000 ERA UMA ARMADILHA
 * O corte é `slice(0, teto)` sobre a lista do mais recente para o mais antigo,
 * e reimportar o mesmo arquivo dá o mesmo hash, a mesma fonte e exatamente as
 * mesmas linhas. Ou seja: o que o teto corta não fica "para a próxima vez" —
 * fica INALCANÇÁVEL. No export real do App Saúde do fundador, 1.998 eventos
 * foram reconhecidos e 998 cortados: dois anos entravam, oito anos ficavam
 * fora, em silêncio.
 *
 * O número vem do que a deduplicação permite existir, não de um chute: um
 * registro por TIPO e por DIA. Quatro tipos × 366 dias × 10 anos ≈ 14.640, e
 * isso já é o caso impossível de alguém que registrou tudo, todo dia, por uma
 * década. 15.000 cobre essa fronteira com folga.
 *
 * Custo de gravação: a escrita vai em lotes de 100 (captureEvents.ts), então o
 * pior caso são 150 lotes — demorado e com barra de progresso, aceitável para
 * uma importação histórica que se faz uma vez. O caso REAL fica uma ordem de
 * grandeza abaixo (os 1.998 de dez anos de iPhone), então na prática o corte
 * deixa de acontecer em vez de acontecer calado.
 *
 * Se um dia o corte voltar a ser comum, a saída não é subir o teto de novo: é
 * importar por período, e é isso que `truncatedRange` existe para a tela poder
 * dizer. */
export const MAX_IMPORT_EVENTS = 15_000;

/** Versão da REGRA que produziu estes eventos, gravada na fonte
 *  (data_sources.parser_version). Quando o parsing mudar de comportamento,
 *  suba o número: é o que permite saber depois o que foi lido pela regra
 *  antiga, sem adivinhação. */
export const PARSER_VERSION = "health-csv/2";

export type HealthCsvFormat = "sleep" | "workout" | "measurement" | "nutrition";

/** O que a importação aceita, para a interface parar de manter a lista à mão.
 *  A garantia real é a FORMA das colunas, não a marca: os apps citados são
 *  exemplos do que costuma cair em cada conceito. Um export de app não
 *  listado funciona se tiver as colunas — e é por isso que a frase da tela
 *  precisa dizer "e outros", nunca prometer uma lista fechada. */
export const SUPPORTED_SOURCES: readonly { app: string; brings: string }[] = [
  {
    app: "Sleep Cycle, AutoSleep, Oura, Whoop, Garmin, Fitbit, Samsung Health, Pillow",
    brings: "noites de sono (duração e, quando houver, qualidade)",
  },
  {
    app: "Hevy, Strong, FitNotes, Garmin, Strava, Nike Run Club",
    brings: "treinos (exercícios, duração e grupos musculares)",
  },
  {
    app: "Withings, Renpho, Zepp Life, Garmin, Fitbit, Samsung Health, Hevy",
    brings: "pesagens (peso e, quando houver, % de gordura)",
  },
  {
    app: "MyFitnessPal, Cronometer",
    brings: "alimentação (calorias e macros, por refeição ou do dia)",
  },
] as const;

/** Grupos musculares do app — os mesmos de Vitalidade, para o mapa de
 *  equilíbrio continuar funcionando com treino importado. */
export const MUSCLE_GROUPS = ["Peito", "Costas", "Pernas", "Ombros", "Braços", "Core", "Cardio"] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface ImportedEvent extends ProposedEvent {
  /** Instante do registro, com fuso explícito. */
  occurred_at: string;
  /** "YYYY-MM-DD" — chave de deduplicação e rótulo na revisão. */
  day: string;
  /** Chave estável do registro DENTRO do arquivo ("sleep|2022-08-03"). É a
   *  mesma regra da deduplicação interna (um registro por tipo e por dia), e
   *  o mesmo arquivo lido de novo produz exatamente as mesmas chaves — é ela
   *  que, junto com a fonte, torna a reimportação idempotente no banco. */
  record_key: string;
}

/** Evento recém-lido do arquivo, ANTES de ganhar a chave de proveniência
 *  (que só existe depois da deduplicação, em parseHealthCsv). */
type ParsedEvent = Omit<ImportedEvent, "record_key"> & {
  /** Sufixo INTERNO da chave de deduplicação, quando um tipo pode ter mais de
   *  um registro no mesmo dia (as refeições). Não vai para o banco. */
  dedupSuffix?: string;
};

export interface ImportStats {
  /** Linhas de dado lidas (sem o cabeçalho). */
  rows: number;
  /** Linhas descartadas por estarem incompletas ou ilegíveis. */
  skipped: number;
  /** Registros do mesmo tipo e mesmo dia, colapsados em um. */
  duplicates: number;
  /** Registros cortados pelo teto de MAX_IMPORT_EVENTS. */
  truncated: number;
  /**
   * PERÍODO que ficou de fora quando o teto cortou — sempre a ponta mais
   * ANTIGA, porque o corte guarda os mais recentes. `null` quando nada foi
   * cortado.
   *
   * Existe porque "998 registros ficaram de fora" não diz à pessoa o que ela
   * perdeu; "de 12/03/2016 a 04/09/2023" diz. É a diferença entre um aviso
   * vago e um aviso em que ela consegue agir (exportar aquele período à parte).
   *
   * Opcional no tipo de propósito: quem também constrói ImportStats (a
   * importação do App Saúde) ainda não o preenche, e um campo obrigatório
   * quebraria aquele arquivo. `undefined` significa "não sei o período", e a
   * tela deve cair no aviso só com a contagem.
   */
  truncatedRange?: { from: string; to: string } | null;
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

/** Nome de coluna comparável: sem acento, sem caixa, sem pontuação — e com
 *  camelCase QUEBRADO em tokens. O AutoSleep escreve "fromDate" e "inBed";
 *  sem separar antes de baixar a caixa, viraria "fromdate", uma palavra só,
 *  onde nenhum sinônimo casa e o arquivo seria recusado sem motivo. */
function normalizeHeader(name: string): string {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
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

/** Instante UTC (ms) para wall-clock no fuso do app. */
function stampFromUtcMs(ms: number): Stamp | null {
  const d = new Date(ms + APP_OFFSET_MINUTES * 60_000);
  if (!Number.isFinite(d.getTime())) return null;
  return valid({
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
  });
}

export function parseStamp(raw: string): Stamp | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  /* Epoch. Só com 10 dígitos (segundos) ou 13 (milissegundos) — qualquer
     outro comprimento é ambíguo (20240322 é uma data, não um epoch) e
     adivinhar aqui seria inventar a data da pessoa. */
  if (/^\d{10}$/.test(s)) return stampFromUtcMs(+s * 1000);
  if (/^\d{13}$/.test(s)) return stampFromUtcMs(+s);

  // 2022-08-03 08:15:39 | 2022-08-03T08:15:39-03:00 | 2022-08-03T11:15:39Z
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?\s*(Z|[+-]\d{2}:?\d{2})?/);
  if (m) {
    const base = valid({
      y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: Math.floor(+(m[6] ?? 0)),
    });
    if (!base) return null;
    /* Fuso EXPLÍCITO no arquivo é convertido para o fuso do app. Sem isto,
       "2024-03-22T15:50:31Z" (UTC) entraria como 15:50 em São Paulo — três
       horas adiante do que aconteceu, o que chega a mudar o dia de uma noite
       de sono. Sem indicação de fuso, o wall-clock é lido como local, que é o
       que todo export de app de celular faz. */
    const zone = m[7];
    if (!zone) return base;
    const offsetMin = zone === "Z"
      ? 0
      : (zone.startsWith("-") ? -1 : 1)
        * (+zone.slice(1, 3) * 60 + +zone.slice(-2));
    const utcMs = Date.UTC(base.y, base.mo - 1, base.d, base.h, base.mi, base.s)
      - offsetMin * 60_000;
    return stampFromUtcMs(utcMs);
  }

  // 26 Ago 2026, 17:51 | 10 Set 2025, 00:00 | 26 Aug 2026 17:51
  m = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const mo = MONTHS[normalizeHeader(m[2]).slice(0, 4)] ?? MONTHS[normalizeHeader(m[2]).slice(0, 3)];
    if (!mo) return null;
    return valid({ y: +m[3], mo, d: +m[1], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: Math.floor(+(m[6] ?? 0)) });
  }

  /* Mar 22, 2024, 3:50:31 PM — mês por NOME primeiro, com AM/PM. É o que o
     Strava escreve em activities.csv. Sem isto o arquivo é detectado e depois
     descartado linha por linha, que é o pior dos mundos: a pessoa vê "reconheci
     seu treino" e zero registros. */
  m = s.match(/^([A-Za-zÀ-ÿ]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?)?/);
  if (m) {
    const mo = MONTHS[normalizeHeader(m[1]).slice(0, 4)] ?? MONTHS[normalizeHeader(m[1]).slice(0, 3)];
    if (mo) {
      let h = +(m[4] ?? 0);
      const meridiem = (m[7] ?? "").toLowerCase();
      if (meridiem === "p" && h < 12) h += 12;
      if (meridiem === "a" && h === 12) h = 0;
      return valid({ y: +m[3], mo, d: +m[2], h, mi: +(m[5] ?? 0), s: Math.floor(+(m[6] ?? 0)) });
    }
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

/* ── Tabela de sinônimos de coluna ────────────────────────────────────────
   O CORAÇÃO desta ampliação. Cada CONCEITO lista os nomes de coluna (já
   normalizados) que o mercado usa para ele. Apoiar um app novo é acrescentar
   um sinônimo aqui — não escrever parser.

   A comparação é por igualdade e, se falhar, por prefixo COM FRONTEIRA: o
   sinônimo casa com `nome` ou `nome_...`, nunca no meio de uma palavra.
   Isso não é preciosismo — sem a fronteira, "movement" (exercício) casava com
   "movements_per_hour" do Sleep Cycle e o export de SONO era lido como
   TREINO. Exports põem a unidade no nome ("time_asleep_seconds", "weight_kg")
   e o Samsung Health prefixa tudo ("com_samsung_health_sleep_start_time"),
   então o prefixo ainda é necessário — só precisa ser disciplinado.
   Sinônimo curto e genérico como "weight" vem DEPOIS dos específicos, para
   "weight_kg" ganhar de "weight". */

type Concept =
  | "date" | "start" | "end"
  | "asleep" | "inBed" | "sleepQuality"
  | "weight" | "bodyFat"
  | "exercise" | "activityType" | "workoutTitle" | "reps" | "load" | "duration" | "distance"
  | "calories" | "protein" | "carbs" | "fatG" | "mealName";

const COLUMN_SYNONYMS: Record<Concept, readonly string[]> = {
  // Genéricas de tempo
  date: ["date", "data", "day", "dia", "datetime", "timestamp", "fecha", "start_time", "started_at", "activity_date", "workout_date", "record_date", "measurement_date"],
  // "from_date"/"to_date" são do AutoSleep (que escreve em camelCase). Exemplo
  // do que este arquivo promete: app novo entra como sinônimo, não como código.
  start: ["start_time", "start", "inicio", "started_at", "bedtime", "sleep_start", "went_to_bed", "from_date", "from"],
  end: ["end_time", "end", "fim", "ended_at", "wake_time", "wake_up_time", "sleep_end", "got_up", "to_date", "to"],

  // Sono. "asleep" é a duração DORMIDA; "inBed" é o tempo na cama (pior, mas
  // serve de queda quando o app não separa os dois).
  asleep: [
    "time_asleep_seconds", "time_asleep", "asleep_time", "asleep", "sleep_duration",
    "total_sleep_duration", "total_sleep_time", "minutes_asleep", "sleep_minutes",
    "duration_asleep", "asleep_duration", "sono", "horas_de_sono", "sleep_time", "hours_of_sleep",
    /* Genérico, por último: o AutoSleep chama a duração dormida só de "sleep".
       Está em EXACT_ONLY, então só casa com uma coluna chamada exatamente
       "sleep" — nunca dentro de "sleep_onset", que é carimbo de hora. */
    "sleep",
  ],
  inBed: ["time_in_bed_seconds", "time_in_bed", "in_bed", "time_in_bed_minutes", "bed_time_duration", "tempo_na_cama"],
  sleepQuality: ["sleep_quality", "quality", "qualidade", "sleep_score", "score", "efficiency", "sleep_efficiency"],

  // Peso e composição
  weight: ["weight_kg", "weight_lb", "weight_lbs", "peso_kg", "peso", "body_weight", "bodyweight", "mass_kg", "weight"],
  bodyFat: ["fat_percent", "body_fat_percent", "body_fat", "fat_ratio", "gordura", "percentual_de_gordura", "fat_mass_percent", "fat"],

  // Treino
  exercise: ["exercise_title", "exercise_name", "exercise", "exercicio"],
  activityType: ["activity_type", "activity_name", "activity", "type", "atividade", "tipo_de_atividade", "sport", "workout_type", "esporte"],
  workoutTitle: ["title", "titulo", "workout_name", "workout", "name", "nome", "treino", "activity_name"],
  reps: ["reps", "repeticoes", "repetitions", "rep"],
  load: ["weight_kg", "weight_lb", "weight_lbs", "peso", "carga", "load", "weight"],
  duration: ["duration_seconds", "duration_min", "duration_minutes", "duration", "duracao", "elapsed_time", "moving_time", "total_time", "time_minutes", "tempo",
    // O Garmin chama a duração da atividade de "Time" (a data fica em "Date").
    "time"],
  distance: ["distance_km", "distance_m", "distance", "distancia", "dist"],

  /* Alimentação. O Cronometer chama as calorias de "Energy (kcal)"; o
     MyFitnessPal, de "Calories". Os macros vêm com a unidade no nome
     ("Fat (g)", "Carbohydrates (g)"), e é o macro que separa um arquivo de
     COMIDA de um de atividade: Strava e Garmin também exportam "Calories",
     mas nenhum deles traz proteína. */
  calories: ["calories_kcal", "calories", "calorias", "energy_kcal", "energy", "kcal", "energia", "total_calories"],
  protein: ["protein_g", "protein_grams", "protein", "proteina_g", "proteinas", "proteina"],
  carbs: ["carbohydrates_g", "carbohydrates", "total_carbohydrate", "carbs_g", "carbs", "carboidratos_g", "carboidratos", "carboidrato"],
  fatG: ["fat_g", "total_fat_g", "total_fat", "fat_grams", "gordura_g", "gorduras_g", "gorduras", "lipidios", "fat"],
  mealName: ["meal_name", "meal_type", "meal", "refeicao", "categoria", "group"],
};

/** Nome REAL da coluna que atende ao conceito, ou undefined. Devolve o nome
 *  (não o índice) porque a unidade costuma estar nele — quem converte precisa
 *  ler "weight_lb" para saber que são libras. */
/* Sinônimos de UMA palavra genérica: valem só em casamento EXATO. O AutoSleep
   chama a duração dormida literalmente de "sleep", e o Fitbit chama o
   percentual de gordura de "Fat" — precisamos aceitar esses nomes. Mas deixar
   um token tão vago casar DENTRO de outro nome faria "sleep" pegar
   "sleep_onset" (um carimbo de hora do Whoop): o arquivo seria reconhecido
   como sono, toda linha descartada, e a pessoa veria "li seu sono: 0 noites".
   Recusar é honesto; reconhecer e devolver vazio não é. */
const EXACT_ONLY = new Set(["sleep", "time", "fat", "score", "weight", "type", "from", "to", "rep", "day", "dia", "data", "date"]);

/** Tokens de um nome de coluna normalizado: "cycle_start_time" → [cycle,start,time]. */
const tokens = (name: string) => name.split("_").filter(Boolean);

/** `needle` aparece em `hay` como sequência contígua de tokens? */
function tokenRunMatches(hay: readonly string[], needle: readonly string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((t, k) => hay[i + k] === t)) return true;
  }
  return false;
}

function findColumn(headers: readonly string[], concept: Concept): string | undefined {
  const names = COLUMN_SYNONYMS[concept];
  // 1. Nome exato.
  for (const n of names) if (headers.includes(n)) return n;
  /* 2. Sinônimo como sequência de tokens DENTRO do nome. É o que faz o Whoop
        funcionar: ele chama a data de "Cycle start time", e "start_time" está
        ali no meio. Comparar token a token (e não por substring) é o que
        impede "movement" de casar com "movements_per_hour" e transformar o
        export de SONO do Sleep Cycle em TREINO. */
  for (const n of names) {
    if (EXACT_ONLY.has(n)) continue;
    const needle = tokens(n);
    const hit = headers.find((h) => tokenRunMatches(tokens(h), needle));
    if (hit) return hit;
  }
  return undefined;
}

const hasConcept = (headers: readonly string[], concept: Concept) =>
  findColumn(headers, concept) !== undefined;

/* ── Unidades ─────────────────────────────────────────────────────────────
   Cada conversão tem teste. A regra geral: a UNIDADE vem do nome da coluna
   sempre que ele a declarar; só quando o nome é mudo é que a magnitude decide,
   e aí os limites estão escritos aqui, não espalhados. */

/** "1:23:45" | "7:30" → horas decimais. null quando não é hh:mm. */
function clockToHours(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/);
  if (!m) return null;
  return +m[1] + +m[2] / 60 + (+(m[3] ?? 0)) / 3600;
}

/** Duração em HORAS, a partir do valor e do NOME da coluna.
 *  Sem unidade no nome: <= 24 é hora, <= 1440 é minuto, acima é segundo —
 *  limites que cobrem o mundo real (ninguém dorme 25h, nem 1441 minutos). */
export function parseDurationHours(raw: string | undefined, column = ""): number | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (!s) return null;
  const clock = clockToHours(s);
  if (clock !== null) return clock;
  const n = num(s);
  if (n === null || n <= 0) return null;
  if (/second|segundo|_s$|_sec/.test(column)) return n / 3600;
  if (/minut|_min/.test(column)) return n / 60;
  if (/hour|hora|_h$|_hr/.test(column)) return n;
  if (n <= 24) return n;
  if (n <= 1440) return n / 60;
  return n / 3600;
}

/** Duração em MINUTOS (treino). Sem unidade no nome: <= 12 é hora, <= 600 é
 *  minuto, acima é segundo — um treino de 45 é 45 min, de 1,5 é 1h30. */
export function parseDurationMinutes(raw: string | undefined, column = ""): number | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (!s) return null;
  const clock = clockToHours(s);
  if (clock !== null) return clock * 60;
  const n = num(s);
  if (n === null || n <= 0) return null;
  if (/second|segundo|_s$|_sec/.test(column)) return n / 60;
  if (/minut|_min/.test(column)) return n;
  if (/hour|hora|_h$|_hr/.test(column)) return n * 60;
  if (n <= 12) return n * 60;
  if (n <= 600) return n;
  return n / 60;
}

/** Peso em KG. Libras só quando a coluna DIZ libra: converter por magnitude
 *  seria trocar 95 kg por 43 kg na cara da pessoa. */
export function parseWeightKg(raw: string | undefined, column = ""): number | null {
  const n = num(raw);
  if (n === null || n <= 0) return null;
  const kg = /(^|_)(lb|lbs|pound|pounds|libra|libras)(_|$)/.test(column) ? n * 0.45359237 : n;
  return Math.round(kg * 10) / 10;
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

/* Assinaturas de app: colunas que, JUNTAS, só aparecem naquele export. Servem
   apenas para o rótulo — a leitura não depende delas. Regra de honestidade: só
   entra aqui o que dá para afirmar com segurança. Quando o cabeçalho não
   permite afirmar a marca, o rótulo diz o CONCEITO e admite ser genérico, em
   vez de atribuir um app errado (que é pior que não dizer nada). */
const APP_FINGERPRINTS: readonly { label: string; needs: readonly string[] }[] = [
  { label: "sono (Sleep Cycle)", needs: ["sleep_quality", "movements_per_hour"] },
  { label: "treinos (Hevy)", needs: ["exercise_title", "set_index"] },
  { label: "peso e medidas (Hevy)", needs: ["fat_percent", "neck_cm"] },
  { label: "peso (Withings)", needs: ["bone_mass_kg", "hydration_kg"] },
];

function fingerprintLabel(headers: readonly string[]): string | null {
  for (const fp of APP_FINGERPRINTS) {
    if (fp.needs.every((n) => headers.some((h) => h === n || tokenRunMatches(tokens(h), tokens(n))))) return fp.label;
  }
  return null;
}

export function detectHealthCsv(text: string): DetectedFormat | null {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.trim() !== "");
  if (!firstLine) return null;

  const delimiter = detectDelimiter(firstLine);
  const headers = (parseCsv(firstLine, delimiter)[0] ?? []).map(normalizeHeader);
  if (headers.length < 2) return null;

  const has = (c: Concept) => hasConcept(headers, c);
  const app = fingerprintLabel(headers);
  const make = (format: HealthCsvFormat, conceito: string): DetectedFormat => ({
    format,
    sourceLabel: app ?? `${conceito} (formato genérico)`,
    delimiter,
    headers,
  });

  /* A ORDEM é a regra, e cada passo existe por um conflito real:

     1. TREINO primeiro. O export de treino do Hevy e do Strong tem coluna de
        peso (a carga da série, não a pessoa na balança), e o de atividade do
        Garmin e do Strava tem calorias. Ler treino depois de peso faria uma
        planilha de musculação virar histórico de pesagem.
     2. SONO antes de peso porque alguns exports de sono trazem peso do dia.
     3. PESO por último, que é o conceito de cabeçalho mais pobre (data +
        peso) e por isso o que mais casa por acidente. */
  const temTempo = has("date") || has("start");

  if ((has("exercise") || has("activityType")) && temTempo) return make("workout", "treinos");
  // Uma planilha com série/repetição/carga é treino mesmo sem nome de exercício.
  if (has("reps") && has("load") && temTempo) return make("workout", "treinos");

  if (has("asleep") && temTempo) return make("sleep", "sono");
  // Sleep Cycle e Pillow não têm coluna de duração declarada em toda versão:
  // início + fim + algum sinal de sono basta, e a duração sai da diferença.
  if (has("start") && has("end") && (has("inBed") || has("sleepQuality"))) {
    return make("sleep", "sono");
  }

  /* ALIMENTAÇÃO antes de peso e depois de treino. O macro é o discriminante:
     data + calorias sozinhas descrevem tanto um prato quanto uma corrida do
     Strava, e ler corrida como comida seria inventar uma refeição que não
     houve. Exigir proteína/carboidrato/gordura resolve, porque nenhum export
     de atividade traz macro. */
  if (has("calories") && temTempo && (has("protein") || has("carbs") || has("fatG"))) {
    return make("nutrition", "alimentação");
  }

  if (has("weight") && temTempo) return make("measurement", "peso");

  return null;
}

/* ── Grupos musculares ────────────────────────────────────────────────────
   Do nome do exercício para o vocabulário do app. A ordem importa: "Crucifixo
   INVERTIDO" é ombro posterior, não peito, e cai na regra de invertido antes
   de chegar na de crucifixo. */

const MUSCLE_RULES: [MuscleGroup, RegExp][] = [
  /* Nomes de atividade em inglês entram aqui porque Strava, Garmin e Nike Run
     Club exportam o tipo no idioma do app, não no do usuário. */
  ["Cardio", /esteira|corrida|correr|caminhada|bicicleta|bike|eliptico|escada|remo_ergometrico|cardio|spinning|run|jog|ride|cycl|swim|walk|hike|rowing|elliptical|treadmill/],
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

/** Leitor de UMA coluna, resolvida por conceito. Guarda o NOME real da coluna
 *  porque é dele que sai a unidade ("weight_lb", "duration_seconds"). */
interface ColReader {
  /** Nome normalizado da coluna encontrada, "" quando o arquivo não a tem. */
  name: string;
  get(row: string[]): string | undefined;
}

function reader(headers: readonly string[], concept: Concept): ColReader {
  const name = findColumn(headers, concept);
  const idx = name ? headers.indexOf(name) : -1;
  return { name: name ?? "", get: (row) => (idx >= 0 ? row[idx] : undefined) };
}

/** Itera as linhas de dado (sem o cabeçalho) e devolve quantas eram. */
function readRows(
  text: string, detected: DetectedFormat, onRow: (row: string[]) => void,
): number {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""), detected.delimiter);
  for (let r = 1; r < rows.length; r++) onRow(rows[r]);
  return Math.max(0, rows.length - 1);
}

function parseSleep(text: string, detected: DetectedFormat) {
  const events: ParsedEvent[] = [];
  let skipped = 0;
  const H = detected.headers;
  const cEnd = reader(H, "end");
  const cStart = reader(H, "start");
  const cDate = reader(H, "date");
  const cAsleep = reader(H, "asleep");
  const cInBed = reader(H, "inBed");
  const cQuality = reader(H, "sleepQuality");

  const rows = readRows(text, detected, (row) => {
    const end = parseStamp(cEnd.get(row) ?? "");
    const start = parseStamp(cStart.get(row) ?? "");
    // Exports que só trazem a DATA da noite (Oura, Garmin) caem aqui.
    const date = parseStamp(cDate.get(row) ?? "");

    /* Ordem de preferência da duração: o que o app mediu dormindo, depois o
       tempo na cama, e só então a diferença entre deitar e levantar. Cada
       queda é pior que a anterior, mas todas são melhores que descartar a
       noite — e nenhuma inventa número. */
    let hours = parseDurationHours(cAsleep.get(row), cAsleep.name);
    if (hours === null) hours = parseDurationHours(cInBed.get(row), cInBed.name);
    if (hours === null && start && end) hours = minutesBetween(start, end) / 60;

    // O sono conta no dia em que a pessoa ACORDA — é assim que ela lê
    // ("dormi 6h essa noite") e é como os Indicadores agrupam.
    const when = end ?? date ?? start;
    if (!when || hours === null || hours <= 0 || hours > 24) { skipped++; return; }

    hours = Math.round(hours * 10) / 10;
    const quality = num(cQuality.get(row));

    events.push({
      kind: "sleep",
      pillar: "vitalidade",
      occurred_at: isoOf(when),
      day: dayOf(when),
      hours,
      summary: `Sono: ${String(hours).replace(".", ",")}h`
        + (quality !== null && quality > 0 && quality <= 100 ? ` · qualidade ${Math.round(quality)}%` : ""),
    });
  });

  return { events, rows, skipped };
}

function parseWorkout(text: string, detected: DetectedFormat) {
  interface Session {
    title: string; start: Stamp; end: Stamp | null;
    exercises: Set<string>; sets: number; minutes: number | null; km: number | null;
  }
  const sessions = new Map<string, Session>();
  let skipped = 0;
  const H = detected.headers;
  const cStart = reader(H, "start");
  const cDate = reader(H, "date");
  const cEnd = reader(H, "end");
  const cTitle = reader(H, "workoutTitle");
  const cExercise = reader(H, "exercise");
  const cType = reader(H, "activityType");
  const cDuration = reader(H, "duration");
  const cDistance = reader(H, "distance");

  const rows = readRows(text, detected, (row) => {
    const rawWhen = cStart.get(row) || cDate.get(row) || "";
    const start = parseStamp(rawWhen);
    if (!start) { skipped++; return; }

    /* O nome da atividade serve de título quando o arquivo não tem um: no
       Strava e no Garmin cada linha É uma atividade ("Corrida matinal"), e não
       existe cabeçalho de sessão como no Hevy. */
    const title = (cTitle.get(row) ?? "").trim() || (cType.get(row) ?? "").trim();
    // O que define o músculo: o exercício quando existe, senão o tipo de
    // atividade (uma corrida do Strava não tem coluna de exercício).
    const exercise = (cExercise.get(row) ?? "").trim() || (cType.get(row) ?? "").trim();

    /* Uma sessão = mesmo título + mesmo início. É assim que o Hevy e o Strong
       escrevem: uma linha por SÉRIE, repetindo o cabeçalho da sessão em todas.
       Para um arquivo de uma linha por atividade, cada linha já é uma sessão —
       a mesma chave serve nos dois casos. */
    const key = `${title}|${rawWhen}`;
    let session = sessions.get(key);
    if (!session) {
      session = {
        title: title || "Treino",
        start,
        end: parseStamp(cEnd.get(row) ?? ""),
        exercises: new Set(),
        sets: 0,
        minutes: parseDurationMinutes(cDuration.get(row), cDuration.name),
        km: null,
      };
      sessions.set(key, session);
    }
    if (exercise) session.exercises.add(exercise);
    session.sets++;
    const dist = num(cDistance.get(row));
    if (dist !== null && dist > 0) {
      // "distance_m" vem em metros; o resto do mundo exporta em km.
      session.km = (session.km ?? 0) + (/(^|_)m$|meter|metro/.test(cDistance.name) ? dist / 1000 : dist);
    }
  });

  const events: ParsedEvent[] = [];
  for (const s of sessions.values()) {
    const muscles = [...new Set([...s.exercises].flatMap(musclesForExercise))];
    const ordered = MUSCLE_GROUPS.filter((g) => muscles.includes(g));
    // Duração declarada no arquivo ganha da diferença entre início e fim: é a
    // medida do app, não a nossa conta.
    const duration = s.minutes ?? (s.end ? minutesBetween(s.start, s.end) : null);
    const min = duration !== null ? Math.round(duration) : null;

    events.push({
      kind: "workout",
      pillar: "vitalidade",
      occurred_at: isoOf(s.start),
      day: dayOf(s.start),
      description: s.title,
      ...(min && min > 0 && min < 600 ? { duration_min: min } : {}),
      ...(ordered.length ? { muscles: ordered } : {}),
      summary: `Treino: ${s.title}${ordered.length ? ` (${ordered.join(", ")})` : ""}`
        + (s.km && s.km > 0 ? ` · ${String(Math.round(s.km * 10) / 10).replace(".", ",")} km` : ""),
    });
  }

  return { events, rows, skipped };
}

function parseMeasurement(text: string, detected: DetectedFormat) {
  const events: ParsedEvent[] = [];
  let skipped = 0;
  const H = detected.headers;
  const cDate = reader(H, "date");
  const cStart = reader(H, "start");
  const cWeight = reader(H, "weight");
  const cFat = reader(H, "bodyFat");

  const rows = readRows(text, detected, (row) => {
    const when = parseStamp(cDate.get(row) || cStart.get(row) || "");
    const kg = parseWeightKg(cWeight.get(row), cWeight.name);
    // O mesmo arquivo traz linhas só de circunferência, sem peso: não são
    // erro, simplesmente não viram registro de peso.
    // A faixa vem de lib/bodyWeight: era escrita aqui à mão com fronteira
    // diferente da que a gravação usava, e 20,0 kg passava na revisão para ser
    // recusado no registro.
    if (!when || !isPlausibleBodyWeightKg(kg)) { skipped++; return; }

    /* O Withings exporta "Fat mass (kg)", não percentual. Ler 13,5 kg como
       "13,5% de gordura" seria inventar um número sobre o corpo da pessoa —
       então coluna de MASSA fica fora do resumo, em silêncio. */
    const fatIsMass = /(^|_)(mass|kg|lb|lbs)(_|$)/.test(cFat.name);
    const fat = fatIsMass ? null : num(cFat.get(row));
    events.push({
      kind: "weight",
      // `alimentacao`, não `vitalidade`: é o pilar que o resto do app usa para
      // peso (Alimentacao.tsx, Onboarding.tsx) e o que a regra do CAPTURE_TOOL
      // no backend determina. Divergir aqui faria o peso importado não aparecer
      // junto do peso registrado à mão, na aba Corpo.
      pillar: "alimentacao",
      occurred_at: isoOf(when),
      day: dayOf(when),
      kg,
      summary: `Peso: ${String(kg).replace(".", ",")} kg`
        // Balança que exporta gordura em FRAÇÃO (0,22) e não em porcentagem
        // existe; abaixo de 1 não é percentual e fica fora do resumo em vez de
        // aparecer como "0,2% de gordura".
        + (fat !== null && fat > 1 && fat < 80 ? ` · ${String(fat).replace(".", ",")}% de gordura` : ""),
    });
  });

  return { events, rows, skipped };
}

/* ── Alimentação ──────────────────────────────────────────────────────────
   O PROBLEMA QUE ESTE PARSER TEM DE RESOLVER
   Um total diário virando um evento `meal` mente duas vezes: infla a contagem
   de refeições do retrato ("30 refeições em 30 dias" para quem comeu 90) e
   alimenta o `meals_logged` da Fase 3 com um número que não é número de
   refeições.

   A saída não é escolher entre importar errado e não importar: é olhar o
   arquivo. O MyFitnessPal exporta uma linha POR REFEIÇÃO, com a coluna "Meal"
   (Breakfast/Lunch/Dinner/Snacks) — nesse caso cada linha é uma refeição de
   verdade e o problema simplesmente não existe. O Cronometer exporta o resumo
   do DIA, e aí o registro é marcado como `dia_inteiro`, com o resumo dizendo
   isso em palavras: o dado calórico entra (é real e é útil para a meta), e
   ninguém lê aquilo como se fosse um almoço. */

/** Refeição declarada no arquivo → vocabulário do app. Nome que não está
 *  nesta tabela NÃO vira meal_type: fica só na descrição, porque encaixar
 *  "Pre-workout" em "lanche" é adivinhar o que a pessoa quis dizer. */
const MEAL_TYPES: [RegExp, string][] = [
  [/^(breakfast|cafe_da_manha|cafe|desjejum|manha)$/, "cafe_da_manha"],
  [/^(lunch|almoco)$/, "almoco"],
  [/^(dinner|supper|jantar|janta|ceia)$/, "jantar"],
  [/^(snack|snacks|lanche|lanches|merenda)$/, "lanche"],
];

/** Marca de um registro que é o TOTAL do dia, não uma refeição. Não está no
 *  enum do app de propósito: o retrato cai em "refeição" para tipo que não
 *  conhece, e é a descrição ("Dia inteiro: ...") que conta a verdade. */
const WHOLE_DAY = "dia_inteiro";

function parseNutrition(text: string, detected: DetectedFormat) {
  const events: ParsedEvent[] = [];
  let skipped = 0;
  const H = detected.headers;
  const cDate = reader(H, "date");
  const cStart = reader(H, "start");
  const cMeal = reader(H, "mealName");
  const cKcal = reader(H, "calories");
  const cProtein = reader(H, "protein");
  const cCarbs = reader(H, "carbs");
  const cFat = reader(H, "fatG");

  const rows = readRows(text, detected, (row) => {
    const when = parseStamp(cDate.get(row) || cStart.get(row) || "");
    const kcal = num(cKcal.get(row));
    /* Caloria zero (ou ausente) não é refeição: é linha de total em branco, de
       dia não preenchido, ou rodapé de planilha. Registrar "0 kcal" faria a
       meta calórica do dia parecer cumprida sem a pessoa ter comido nada. */
    if (!when || kcal === null || kcal <= 0) { skipped++; return; }

    const rawMeal = normalizeHeader(cMeal.get(row) ?? "");
    const mapped = rawMeal ? MEAL_TYPES.find(([re]) => re.test(rawMeal))?.[1] : undefined;
    const isWholeDay = !rawMeal;

    const macro = (v: number | null) => (v !== null && v > 0 ? Math.round(v) : undefined);
    const protein = macro(num(cProtein.get(row)));
    const carbs = macro(num(cCarbs.get(row)));
    const fat = macro(num(cFat.get(row)));

    // Nome legível: o do arquivo quando existe, senão a marca do dia inteiro.
    const label = isWholeDay
      ? "Dia inteiro"
      : (mapped
        ? { cafe_da_manha: "Café da manhã", almoco: "Almoço", jantar: "Jantar", lanche: "Lanche" }[mapped]!
        : (cMeal.get(row) ?? "").trim());

    events.push({
      kind: "meal",
      pillar: "alimentacao",
      occurred_at: isoOf(when),
      day: dayOf(when),
      meal_type: isWholeDay ? WHOLE_DAY : mapped,
      description: `${label}: ${Math.round(kcal)} kcal`,
      calories: Math.round(kcal),
      ...(protein !== undefined ? { protein_g: protein } : {}),
      ...(carbs !== undefined ? { carbs_g: carbs } : {}),
      ...(fat !== undefined ? { fat_g: fat } : {}),
      /* Uma linha por refeição precisa de chave própria, senão as quatro
         refeições do dia colapsam em uma na deduplicação. Sem nome de
         refeição, o dia inteiro é UM registro e a chave é a do dia. */
      dedupSuffix: isWholeDay ? undefined : (mapped ?? rawMeal),
      summary: isWholeDay
        ? `Alimentação do dia inteiro: ${Math.round(kcal)} kcal`
          + (protein !== undefined ? ` · ${protein} g de proteína` : "")
        : `${label}: ${Math.round(kcal)} kcal`
          + (protein !== undefined ? ` · ${protein} g de proteína` : ""),
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
        : detected.format === "nutrition" ? parseNutrition(text, detected)
          : parseMeasurement(text, detected);

  // Deduplicação por tipo + dia: dois registros do mesmo tipo no mesmo dia
  // viram um. Vence o PRIMEIRO em ordem cronológica — regra simples e
  // previsível, que a interface consegue explicar em uma linha.
  const byDay = new Map<string, ImportedEvent>();
  let duplicates = 0;
  const chronological = [...parsed.events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  for (const ev of chronological) {
    // A chave da deduplicação É a chave de proveniência: a mesma regra que
    // colapsa dois registros do mesmo dia aqui é a que reconhece, no banco,
    // que este registro já veio deste arquivo antes.
    /* O sufixo só existe para refeições — os outros tipos continuam com
       `kind|dia`, e mexer nisso mudaria a chave de PROVENIÊNCIA de tudo que já
       foi importado, quebrando a idempotência das importações antigas. */
    const key = ev.dedupSuffix ? `${ev.kind}|${ev.day}|${ev.dedupSuffix}` : `${ev.kind}|${ev.day}`;
    if (byDay.has(key)) { duplicates++; continue; }
    const { dedupSuffix: _omitido, ...limpo } = ev;
    byDay.set(key, { ...limpo, record_key: key });
  }

  // Mais recentes primeiro, e o teto corta a cauda antiga.
  const all = [...byDay.values()].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const events = all.slice(0, MAX_IMPORT_EVENTS);
  const cut = all.slice(MAX_IMPORT_EVENTS);
  // O período cortado é o dos registros que NÃO entraram, para a tela poder
  // dizer o que ficou de fora em vez de só quantos.
  const cutDays = cut.map((e) => e.day).sort();

  const days = events.map((e) => e.day).sort();

  return {
    format: detected.format,
    sourceLabel: detected.sourceLabel,
    events,
    stats: {
      rows: parsed.rows,
      skipped: parsed.skipped,
      duplicates,
      truncated: cut.length,
      truncatedRange: cutDays.length
        ? { from: cutDays[0], to: cutDays[cutDays.length - 1] }
        : null,
    },
    range: days.length ? { from: days[0], to: days[days.length - 1] } : null,
  };
}

/** Rótulo humano do tipo importado, no plural certo. */
export function formatLabel(format: HealthCsvFormat, count: number): string {
  if (format === "sleep") return count === 1 ? "1 noite de sono" : `${count} noites de sono`;
  if (format === "workout") return count === 1 ? "1 treino" : `${count} treinos`;
  /* "registro de alimentação", e não "refeição": o mesmo formato cobre linha
     por refeição (MyFitnessPal) e total do dia (Cronometer), e chamar 120 dias
     de total de "120 refeições" seria o mesmo erro que este parser evita. */
  if (format === "nutrition") {
    return count === 1 ? "1 registro de alimentação" : `${count} registros de alimentação`;
  }
  return count === 1 ? "1 pesagem" : `${count} pesagens`;
}
