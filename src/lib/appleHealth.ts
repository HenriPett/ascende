// ASCENDE — Importação do App Saúde do iPhone: o parsing (puro, sem I/O).
//
// POR QUE UM SCANNER DE TEXTO, E NÃO UM PARSER DE XML
// O export real do fundador tem 876 MB num único `exportar.xml`. `DOMParser`
// carrega a árvore inteira na memória e mata a aba; `readAsText` nem chega a
// entregar a string. A única forma que funciona é ler em PEDAÇOS e nunca
// guardar mais do que o pedaço atual — que é exatamente o que este arquivo
// faz. Ele recebe texto aos pedaços, varre `<Record>` e `<Workout>` por
// índice, e guarda apenas TOTAIS POR DIA. Um export de dez anos vira uns
// poucos milhares de entradas de mapa, não milhões de nós.
//
// O que este módulo NÃO faz: abrir zip, ler arquivo, tocar em rede. Isso é do
// appleHealthZip.ts. Aqui é tudo determinístico e testável com uma string.
//
// COMPATIBILIDADE COM O QUE JÁ EXISTE
// O resultado tem o MESMO formato de `ImportResult` (healthImport.ts), com uma
// diferença declarada: `format: "apple_health"`. Um export do App Saúde traz
// sono, peso, treino e água de uma vez, então não cabe em "sleep" | "workout"
// | "measurement" — e fingir que cabe faria a tela dizer "1 noite de sono"
// para um arquivo com dez anos de tudo.

import type { ImportedEvent, ImportResult, MuscleGroup } from "@/lib/healthImport";
import { MAX_IMPORT_EVENTS } from "@/lib/healthImport";

/** Versão da REGRA que produziu estes eventos (data_sources.parser_version).
 *  Própria, e não a do CSV: são leituras diferentes do mesmo tipo de dado. */
export const PARSER_VERSION = "apple-health-xml/1";

/** Fuso do app. Fixo, como em healthImport.ts: o instante é gravado com o
 *  relógio de parede do próprio registro e carimbado -03:00, para o DIA never
 *  escorregar quando o banco reler em São Paulo. */
const APP_UTC_OFFSET = "-03:00";

export const APPLE_HEALTH_SOURCE_LABEL = "App Saúde (iPhone)";

/** O export traz várias coisas ao mesmo tempo, então o formato é um só e
 *  diferente dos três do CSV. A tela precisa saber ler este valor. */
export type AppleHealthFormat = "apple_health";

/** Mesmo shape de ImportResult, com o formato novo. Union em vez de mudança
 *  no tipo original: healthImport.ts é de outro dono e não deve mudar por
 *  causa desta importação. */
export type AppleHealthResult = Omit<ImportResult, "format"> & { format: AppleHealthFormat };

/* ── Tempo ────────────────────────────────────────────────────────────────
   Os carimbos vêm como "2024-03-22 15:50:31 -0300" — data, hora e o offset em
   que a pessoa estava. O offset importa para saber em que DIA aquilo caiu na
   vida dela (viajou para a Europa, o dia é o de lá), e é por isso que lemos o
   relógio de parede do próprio registro em vez de converter para UTC. */

interface Stamp {
  day: string;   // "2024-03-22" no relógio local do registro
  hour: number;
  minute: number;
  second: number;
  /** Minutos desde a meia-noite local — usado para agrupar noite. */
  minutesOfDay: number;
  /** Instante absoluto em ms, para medir duração entre dois carimbos. */
  epochMs: number;
}

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\s*([+-])(\d{2}):?(\d{2}))?/;

export function parseAppleStamp(raw: string): Stamp | null {
  const m = STAMP_RE.exec(String(raw ?? "").trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = m;
  const offsetMin = sign ? (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om)) : 0;
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return {
    day: `${y}-${mo}-${d}`,
    hour: Number(h),
    minute: Number(mi),
    second: Number(s),
    minutesOfDay: Number(h) * 60 + Number(mi),
    // O relógio de parede menos o offset dá o instante real.
    epochMs: utcMs - offsetMin * 60_000,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (t: Stamp) => `${t.day}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}${APP_UTC_OFFSET}`;

/** Meio-dia como âncora quando só temos o dia (agregados de sono, água). */
const isoNoon = (day: string) => `${day}T12:00:00${APP_UTC_OFFSET}`;

const addDay = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

/**
 * A que NOITE pertence um trecho de sono que terminou neste carimbo.
 *
 * O App Saúde quebra uma noite em vários trechos, e os que terminam ANTES da
 * meia-noite (23:30, por exemplo) pertencem à noite que vai desaguar no dia
 * seguinte. Sem esta regra, uma noite vira dois registros: nove minutos no dia
 * 29 e seis horas no dia 30 — e a pessoa veria "você dormiu 0,2h" numa noite
 * em que dormiu sete.
 *
 * O corte é meio-dia, a mesma convenção do resto do app: sono é contado no dia
 * em que a pessoa ACORDA (healthImport.ts faz igual com o Sleep Cycle).
 */
const nightOf = (end: Stamp): string => (end.minutesOfDay < 12 * 60 ? end.day : addDay(end.day));

/* ── Tipos de treino ──────────────────────────────────────────────────────
   Nome em português porque é o que a pessoa lê no cartão de revisão. Fora
   desta lista, cai em "Atividade física" — melhor genérico e honesto do que
   inventar tradução para uma modalidade que não conhecemos. */

const WORKOUT_LABEL: Record<string, string> = {
  Running: "Corrida",
  Walking: "Caminhada",
  Cycling: "Ciclismo",
  Swimming: "Natação",
  TraditionalStrengthTraining: "Musculação",
  FunctionalStrengthTraining: "Treino funcional",
  HighIntensityIntervalTraining: "HIIT",
  CoreTraining: "Core",
  Yoga: "Yoga",
  Pilates: "Pilates",
  Elliptical: "Elíptico",
  Rowing: "Remo",
  Hiking: "Trilha",
  Dance: "Dança",
  Soccer: "Futebol",
  Basketball: "Basquete",
  Tennis: "Tênis",
  Boxing: "Boxe",
  StairClimbing: "Escada",
  StairClimbingMachine: "Escada",
  MixedCardio: "Cardio",
  CrossTraining: "Cross training",
  Cooldown: "Desaquecimento",
  PreparationAndRecovery: "Alongamento",
  Flexibility: "Alongamento",
};

/** Modalidades que o app entende como Cardio no mapa de equilíbrio. As de
 *  força ficam SEM grupo: o export não diz o que foi treinado, e chutar
 *  "Peito" num dia de perna estragaria o mapa. */
const CARDIO_TYPES = new Set([
  "Running", "Walking", "Cycling", "Swimming", "Rowing", "Elliptical",
  "Hiking", "StairClimbing", "StairClimbingMachine", "MixedCardio",
  "HighIntensityIntervalTraining", "Dance", "Soccer", "Basketball", "Tennis",
]);

const workoutShort = (activityType: string): string =>
  activityType.replace(/^HKWorkoutActivityType/, "");

/* ── Varredura ────────────────────────────────────────────────────────────
   Um `<Record .../>` cortado no meio do pedaço é o caso que quebra scanner
   ingênuo: guardamos a cauda incompleta e a colamos no pedaço seguinte.

   `findTagEnd` respeita aspas em vez de procurar o primeiro `>`: o atributo
   `device` do Apple Health carrega texto com sinais dentro, e um `>` solto ali
   truncaria a tag no lugar errado. */

function findTagEnd(buf: string, from: number): number {
  let quote = "";
  for (let i = from; i < buf.length; i++) {
    const c = buf[i];
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ">") return i;
  }
  return -1;
}

/** Valor de um atributo dentro de uma tag já delimitada. */
function attr(tag: string, name: string): string | null {
  const key = ` ${name}="`;
  const at = tag.indexOf(key);
  if (at < 0) return null;
  const start = at + key.length;
  const end = tag.indexOf('"', start);
  return end < 0 ? null : tag.slice(start, end);
}

/** Entidades XML que aparecem nos atributos que a gente usa. */
const unescapeXml = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/* ── Acumuladores ─────────────────────────────────────────────────────────
   Só totais por DIA. É isto que mantém a memória constante: 10 anos de export
   viram ~3.650 entradas por métrica, não milhões de registros. */

interface SleepNight { asleepMs: number; inBedMs: number; lastEnd: Stamp | null }
interface WorkoutDay { minutes: number; count: number; types: Map<string, number> }

export interface AppleHealthScanner {
  /** Alimenta o scanner com mais texto do XML. */
  push(chunk: string): void;
  /** Fecha a leitura e devolve o resultado pronto para a revisão em lote. */
  finish(): AppleHealthResult;
}

export function createAppleHealthScanner(): AppleHealthScanner {
  let tail = "";
  let rows = 0;      // registros DE INTERESSE lidos
  let skipped = 0;   // registros de interesse que não deram para ler
  let duplicates = 0;

  const sleep = new Map<string, SleepNight>();
  const weight = new Map<string, { kg: number; at: Stamp }>();
  const fat = new Map<string, number>();
  const workouts = new Map<string, WorkoutDay>();
  const water = new Map<string, number>();

  function handleRecord(tag: string): void {
    const type = attr(tag, "type");
    if (!type) return;

    if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
      rows++;
      const start = parseAppleStamp(attr(tag, "startDate") ?? "");
      const end = parseAppleStamp(attr(tag, "endDate") ?? "");
      const value = attr(tag, "value") ?? "";
      if (!start || !end || end.epochMs <= start.epochMs) { skipped++; return; }
      const night = nightOf(end);
      const cur = sleep.get(night) ?? { asleepMs: 0, inBedMs: 0, lastEnd: null };
      const ms = end.epochMs - start.epochMs;
      // "Asleep" cobre AsleepCore, AsleepDeep, AsleepREM e o antigo
      // AsleepUnspecified. "InBed" é tempo na cama, que inclui rolar acordado:
      // só vale quando não há nenhuma medida de sono de verdade naquela noite.
      if (/Asleep/i.test(value)) cur.asleepMs += ms;
      else if (/InBed/i.test(value)) cur.inBedMs += ms;
      else if (/Awake/i.test(value)) {
        // Trecho ACORDADO no meio da noite. É lido e ignorado de propósito, e
        // NÃO conta como descartado: no export real são 14.545 desses, e
        // chamá-los de "linhas que não deram para ler" faria o recibo da
        // importação mentir sobre um dado que está perfeitamente legível.
        return;
      } else { skipped++; return; }
      if (!cur.lastEnd || end.epochMs > cur.lastEnd.epochMs) cur.lastEnd = end;
      sleep.set(night, cur);
      return;
    }

    if (type === "HKQuantityTypeIdentifierBodyMass") {
      rows++;
      const at = parseAppleStamp(attr(tag, "startDate") ?? "");
      const kg = Number(attr(tag, "value"));
      if (!at || !(kg > 20 && kg < 400)) { skipped++; return; }
      // Primeira pesagem do dia vence — é a da manhã, a que a pessoa usa como
      // referência. Mesma regra de "um registro por tipo e por dia" do CSV.
      if (weight.has(at.day)) { duplicates++; return; }
      weight.set(at.day, { kg, at });
      return;
    }

    if (type === "HKQuantityTypeIdentifierBodyFatPercentage") {
      rows++;
      const at = parseAppleStamp(attr(tag, "startDate") ?? "");
      const raw = Number(attr(tag, "value"));
      if (!at || !(raw > 0)) { skipped++; return; }
      // O App Saúde grava fração (0,23 = 23%); alguns apps gravam já em %.
      const pct = raw <= 1 ? raw * 100 : raw;
      if (!fat.has(at.day) && pct > 1 && pct < 75) fat.set(at.day, pct);
      return;
    }

    if (type === "HKQuantityTypeIdentifierDietaryWater") {
      rows++;
      const at = parseAppleStamp(attr(tag, "startDate") ?? "");
      const value = Number(attr(tag, "value"));
      const unit = (attr(tag, "unit") ?? "mL").toLowerCase();
      if (!at || !(value > 0)) { skipped++; return; }
      // Litro aparece em export de app de terceiro; o resto já vem em mL.
      const ml = unit === "l" ? value * 1000 : value;
      water.set(at.day, (water.get(at.day) ?? 0) + ml);
      return;
    }
  }

  function handleWorkout(tag: string): void {
    rows++;
    const start = parseAppleStamp(attr(tag, "startDate") ?? "");
    const end = parseAppleStamp(attr(tag, "endDate") ?? "");
    if (!start) { skipped++; return; }
    const declared = Number(attr(tag, "duration"));
    const unit = (attr(tag, "durationUnit") ?? "min").toLowerCase();
    let minutes = Number.isFinite(declared) && declared > 0
      ? (unit === "s" || unit === "sec" ? declared / 60 : declared)
      : 0;
    // Sem duração declarada, a diferença entre início e fim resolve.
    if (!minutes && end && end.epochMs > start.epochMs) {
      minutes = (end.epochMs - start.epochMs) / 60_000;
    }
    if (!(minutes > 0) || minutes > 24 * 60) { skipped++; return; }

    const short = workoutShort(unescapeXml(attr(tag, "workoutActivityType") ?? ""));
    const day = workouts.get(start.day) ?? { minutes: 0, count: 0, types: new Map() };
    day.minutes += minutes;
    day.count += 1;
    day.types.set(short, (day.types.get(short) ?? 0) + 1);
    workouts.set(start.day, day);
  }

  function push(chunk: string): void {
    const buf = tail + chunk;
    let i = 0;
    let consumed = 0;
    for (;;) {
      const at = buf.indexOf("<", i);
      if (at < 0) { consumed = buf.length; break; }
      const isRecord = buf.startsWith("<Record", at);
      // O espaço depois do nome importa: `<WorkoutEvent`, `<WorkoutRoute` e
      // `<WorkoutStatistics` são FILHOS de um treino. Contá-los como treino
      // multiplicaria por cinco o número de sessões da pessoa.
      const isWorkout = buf.startsWith("<Workout", at) && /\s/.test(buf[at + 8] ?? "");
      if (!isRecord && !isWorkout) {
        // Perto do fim do pedaço pode estar um "<Wor..." partido: guarda para
        // colar no pedaço seguinte em vez de decidir com meia tag.
        if (buf.length - at < 16) { consumed = at; break; }
        i = at + 1;
        continue;
      }
      const end = findTagEnd(buf, at);
      if (end < 0) { consumed = at; break; }  // tag cortada: espera o próximo pedaço
      const tag = buf.slice(at, end + 1);
      if (isRecord) handleRecord(tag); else handleWorkout(tag);
      i = end + 1;
      consumed = i;
    }
    // A cauda guardada é limitada pelo tamanho de UMA tag; o atributo `device`
    // do Apple Health é o maior deles e não passa de alguns KB.
    tail = buf.slice(consumed);
  }

  function finish(): AppleHealthResult {
    const events: Omit<ImportedEvent, "record_key">[] = [];

    for (const [night, n] of sleep) {
      // InBed é último recurso: só quando a noite inteira não tem medida de
      // sono. Misturar os dois somaria tempo acordado como se fosse sono.
      const ms = n.asleepMs > 0 ? n.asleepMs : n.inBedMs;
      const hours = Math.round((ms / 3_600_000) * 10) / 10;
      if (!(hours > 0) || hours > 24) continue;
      events.push({
        kind: "sleep", pillar: "vitalidade",
        occurred_at: n.lastEnd ? isoOf(n.lastEnd) : isoNoon(night),
        day: night, hours,
        summary: `Sono: ${String(hours).replace(".", ",")}h`
          + (n.asleepMs > 0 ? "" : " (tempo na cama)"),
      });
    }

    for (const [day, w] of weight) {
      const kg = Math.round(w.kg * 10) / 10;
      const pct = fat.get(day);
      events.push({
        // `alimentacao` e não `vitalidade`: é o pilar que o resto do app usa
        // para peso (ver o mesmo comentário em healthImport.ts), e divergir
        // faria o peso importado não aparecer junto do registrado à mão.
        kind: "weight", pillar: "alimentacao",
        occurred_at: isoOf(w.at), day, kg,
        summary: `Peso: ${String(kg).replace(".", ",")} kg`
          + (pct ? ` · ${String(Math.round(pct * 10) / 10).replace(".", ",")}% de gordura` : ""),
      });
    }

    for (const [day, w] of workouts) {
      const minutes = Math.round(w.minutes);
      if (!(minutes > 0)) continue;
      const names = [...w.types.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([t]) => WORKOUT_LABEL[t] ?? "Atividade física");
      const muscles = [...w.types.keys()].some((t) => CARDIO_TYPES.has(t))
        ? (["Cardio"] as MuscleGroup[])
        : undefined;
      const label = [...new Set(names)].slice(0, 3).join(", ");
      events.push({
        kind: "workout", pillar: "vitalidade",
        occurred_at: isoNoon(day), day,
        duration_min: minutes,
        description: label,
        ...(muscles ? { muscles } : {}),
        summary: `${w.count > 1 ? `${w.count} treinos` : "Treino"}: ${label} · ${minutes} min`,
      });
    }

    for (const [day, ml] of water) {
      const total = Math.round(ml);
      if (!(total > 0)) continue;
      events.push({
        kind: "water", pillar: "alimentacao",
        occurred_at: isoNoon(day), day, ml: total,
        summary: `Água: ${total} ml`,
      });
    }

    // Um registro por tipo e por dia — a chave é a mesma do CSV, e é ela que
    // torna reimportar o mesmo arquivo idempotente no banco.
    const withKeys: ImportedEvent[] = events.map((e) => ({ ...e, record_key: `${e.kind}|${e.day}` }));

    // Mais recentes primeiro, e o teto corta a cauda antiga. Desempate pelo
    // record_key para a ordem não depender da ordem de inserção nos mapas.
    withKeys.sort((a, b) =>
      b.occurred_at.localeCompare(a.occurred_at) || a.record_key.localeCompare(b.record_key));
    const kept = withKeys.slice(0, MAX_IMPORT_EVENTS);
    const days = kept.map((e) => e.day).sort();

    return {
      format: "apple_health",
      sourceLabel: APPLE_HEALTH_SOURCE_LABEL,
      events: kept,
      stats: {
        rows,
        skipped,
        duplicates,
        truncated: withKeys.length - kept.length,
      },
      range: days.length ? { from: days[0], to: days[days.length - 1] } : null,
    };
  }

  return { push, finish };
}

/**
 * Atalho para texto que já cabe na memória (testes, XML pequeno solto).
 * `null` quando não parece um export do App Saúde — fingir que importou é o
 * defeito que este módulo existe para não repetir.
 */
export function parseAppleHealthXml(text: string): AppleHealthResult | null {
  if (!looksLikeAppleHealth(text)) return null;
  const scanner = createAppleHealthScanner();
  scanner.push(text);
  return scanner.finish();
}

/**
 * Reconhece o export pelo cabeçalho, sem depender do nome do arquivo.
 *
 * CUIDADO com a janela: o arquivo real abre com um DTD de vários KB
 * (`<!DOCTYPE HealthData [ <!ELEMENT ...`) e só DEPOIS vem o elemento
 * `<HealthData>`. Procurar por `<HealthData` nos primeiros 4 KB devolvia
 * "não reconhecido" para o export legítimo do fundador — por isso o teste
 * aceita o nome no DOCTYPE também, e quem chama usa uma janela generosa.
 */
export function looksLikeAppleHealth(head: string): boolean {
  return /(<|DOCTYPE\s+)HealthData/i.test(head)
    || /HKQuantityTypeIdentifier|HKCategoryTypeIdentifier|HKWorkoutActivityType/.test(head);
}

/** Rótulo humano do que foi lido, no plural certo. */
export function appleHealthLabel(events: { kind: string }[]): string {
  const count = (k: string) => events.filter((e) => e.kind === k).length;
  const parts: string[] = [];
  const sleep = count("sleep");
  const weight = count("weight");
  const workout = count("workout");
  const water = count("water");
  if (sleep) parts.push(sleep === 1 ? "1 noite de sono" : `${sleep} noites de sono`);
  if (workout) parts.push(workout === 1 ? "1 dia de treino" : `${workout} dias de treino`);
  if (weight) parts.push(weight === 1 ? "1 pesagem" : `${weight} pesagens`);
  if (water) parts.push(water === 1 ? "1 dia de hidratação" : `${water} dias de hidratação`);
  if (!parts.length) return "nenhum registro";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}
