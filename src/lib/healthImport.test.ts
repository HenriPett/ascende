// ASCENDE — Testes da importação de CSV de apps de saúde.
// As amostras abaixo são LINHAS REAIS dos arquivos que o fundador exportou
// (Sleep Cycle, Hevy treinos e Hevy medidas), recortadas — inclusive o
// cabeçalho inteiro, que é o que o detector realmente vê.
import { describe, it, expect } from "vitest";
// A faixa de peso é importada, não recopiada: o teste tem de falhar se as
// constantes mudarem, e passar a valer o número novo sem edição manual.
import {
  isPlausibleBodyWeightKg, BODY_WEIGHT_MIN_KG, BODY_WEIGHT_MAX_KG,
} from "@/lib/bodyWeight";
import {
  parseHealthCsv, detectHealthCsv, detectDelimiter, parseCsv, parseStamp,
  musclesForExercise, formatLabel, MAX_IMPORT_EVENTS, PARSER_VERSION,
  parseWeightKg, parseDurationHours, parseDurationMinutes, SUPPORTED_SOURCES,
} from "@/lib/healthImport";

/* ── Amostras reais ───────────────────────────────────────────────────── */

const SLEEP_CSV = `Start;End;Sleep Quality;Regularity;Awake (seconds);Dream (seconds);Light (seconds);Deep (seconds);Mood;Heart rate (bpm);Steps;Alarm mode;Air Pressure (Pa);City;Movements per hour;Time in bed (seconds);Time asleep (seconds);Time before sleep (seconds);Window start;Window stop;Snore time (seconds);Weather temperature (°C);Weather type;Notes;Body temperature deviation (degrees Celsius);Ambient Noise (dB);Respiratory rate (breaths per minute);Coughs (per hour);Breathing disruptions (per hour)
2022-08-03 00:09:59;2022-08-03 08:15:39;83%;0%;6119.3;0.0;23020.3;0.0;Not set;0;0;Normal;101.1;;68.6;29139.7;23020.3;1165.6;2022-08-03 08:00:00;2022-08-03 08:30:00;1568.2;0.0;No weather;;;;;;
2022-08-03 23:50:22;2022-08-04 06:41:47;62%;84%;5430.8;0.0;19254.6;0.0;Not set;0;0;Normal;100.6;;69.1;24685.3;19254.6;1316.6;2022-08-04 08:00:00;2022-08-04 08:30:00;0.0;0.0;No weather;;;;;;
2024-10-30 21:45:43;2024-10-31 05:00:30;75%;0%;2000.0;0.0;24087.0;0.0;Not set;0;0;Normal;100.9;Jaraguá Do Sul;86.9;26087.0;24087.0;521.7;2024-10-31 05:00:00;2024-10-31 05:30:00;3986.4;20.0;Rain;;;49.2;13.8;0.1;8.2`;

const WORKOUT_CSV = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Quarta, ombros e braços","26 Ago 2026, 17:51","26 Ago 2026, 18:35","","Desenvolvimento de Ombros (Máquina de Discos)",,"",0,"normal",20,12,,,
"Quarta, ombros e braços","26 Ago 2026, 17:51","26 Ago 2026, 18:35","","Desenvolvimento de Ombros (Máquina de Discos)",,"",1,"normal",40,12,,,
"Quarta, ombros e braços","26 Ago 2026, 17:51","26 Ago 2026, 18:35","","Rosca Direta (Halter)",,"",0,"normal",14,10,,,
"Terça, costas dominantes","25 Ago 2026, 18:19","25 Ago 2026, 19:09","","Puxada Alta (Máquina)",,"",0,"normal",50,12,,,
"Terça, costas dominantes","25 Ago 2026, 18:19","25 Ago 2026, 19:09","","Remada Baixa Iso-Lateral",,"",1,"normal",60,10,,,`;

const MEASUREMENT_CSV = `"date","weight_kg","fat_percent","neck_cm","shoulder_cm","chest_cm","left_bicep_cm","right_bicep_cm","left_forearm_cm","right_forearm_cm","abdomen_cm","waist_cm","hips_cm","left_thigh_cm","right_thigh_cm","left_calf_cm","right_calf_cm"
"10 Set 2025, 00:00",117.9,,,,,,,,,,,,,,,
"11 Set 2025, 00:00",117,,,,,,,,,,,,,,,
"12 Set 2025, 00:00",116.5,,,,,,,,,,,,,,,`;

/* ── CSV cru ──────────────────────────────────────────────────────────── */

describe("parseCsv e detectDelimiter", () => {
  it("detecta ponto e vírgula (Sleep Cycle) e vírgula (Hevy)", () => {
    expect(detectDelimiter(SLEEP_CSV.split("\n")[0])).toBe(";");
    expect(detectDelimiter(WORKOUT_CSV.split("\n")[0])).toBe(",");
  });

  it("não confunde vírgula DENTRO de aspas com separador", () => {
    // "Quarta, ombros e braços" é UM campo, não dois.
    const rows = parseCsv(WORKOUT_CSV, ",");
    expect(rows[1][0]).toBe("Quarta, ombros e braços");
    expect(rows[1][4]).toBe("Desenvolvimento de Ombros (Máquina de Discos)");
  });

  it("entende aspas escapadas por duplicação", () => {
    expect(parseCsv('a,b\n"diz ""oi""",2', ",")[1][0]).toBe('diz "oi"');
  });

  it("ignora linhas em branco", () => {
    expect(parseCsv("a,b\n1,2\n\n\n3,4\n", ",")).toHaveLength(3);
  });
});

/* ── Datas ────────────────────────────────────────────────────────────── */

describe("parseStamp", () => {
  it("ISO do Sleep Cycle", () => {
    expect(parseStamp("2022-08-03 08:15:39")).toEqual({ y: 2022, mo: 8, d: 3, h: 8, mi: 15, s: 39 });
  });

  it("pt-BR abreviado do Hevy", () => {
    expect(parseStamp("26 Ago 2026, 17:51")).toEqual({ y: 2026, mo: 8, d: 26, h: 17, mi: 51, s: 0 });
    expect(parseStamp("10 Set 2025, 00:00")).toEqual({ y: 2025, mo: 9, d: 10, h: 0, mi: 0, s: 0 });
    expect(parseStamp("27 Fev 2026, 08:00")?.mo).toBe(2);
    expect(parseStamp("01 Mai 2026, 08:00")?.mo).toBe(5);
    expect(parseStamp("15 Dez 2025, 08:00")?.mo).toBe(12);
  });

  it("aceita o mesmo export em inglês", () => {
    expect(parseStamp("26 Aug 2026, 17:51")?.mo).toBe(8);
    expect(parseStamp("10 Sep 2025, 00:00")?.mo).toBe(9);
  });

  it("aceita dd/mm/aaaa", () => {
    expect(parseStamp("03/08/2022 08:15")).toEqual({ y: 2022, mo: 8, d: 3, h: 8, mi: 15, s: 0 });
  });

  it("recusa lixo e datas impossíveis", () => {
    expect(parseStamp("")).toBeNull();
    expect(parseStamp("ontem de manhã")).toBeNull();
    expect(parseStamp("2022-13-45 08:00:00")).toBeNull();
    expect(parseStamp("26 Xyz 2026, 17:51")).toBeNull();
  });
});

/* ── Detecção de formato ──────────────────────────────────────────────── */

describe("detectHealthCsv", () => {
  it("reconhece os três formatos reais", () => {
    expect(detectHealthCsv(SLEEP_CSV)?.format).toBe("sleep");
    expect(detectHealthCsv(WORKOUT_CSV)?.format).toBe("workout");
    expect(detectHealthCsv(MEASUREMENT_CSV)?.format).toBe("measurement");
  });

  it("não confunde treino com peso, embora os dois tenham weight_kg", () => {
    // No treino, weight_kg é a carga da série; na medida, é a pessoa.
    expect(detectHealthCsv(WORKOUT_CSV)?.format).toBe("workout");
  });

  it("tolera colunas fora de ordem e sem aspas", () => {
    const fora = "start_time,exercise_title,title,reps,weight_kg\n26 Ago 2026 17:51,Supino (Barra),Peito,10,60";
    expect(detectHealthCsv(fora)?.format).toBe("workout");
  });

  it("tolera BOM no começo do arquivo", () => {
    expect(detectHealthCsv("﻿" + MEASUREMENT_CSV)?.format).toBe("measurement");
  });

  it("devolve null para formato desconhecido — nunca finge que entendeu", () => {
    expect(detectHealthCsv("nome,idade\nAna,30")).toBeNull();
    expect(detectHealthCsv("isto nao e um csv")).toBeNull();
    expect(detectHealthCsv("")).toBeNull();
    expect(parseHealthCsv("extrato,valor\nMercado,32.50")).toBeNull();
  });
});

/* ── Sono ─────────────────────────────────────────────────────────────── */

describe("importação de sono (Sleep Cycle)", () => {
  const result = parseHealthCsv(SLEEP_CSV)!;

  it("converte 'Time asleep (seconds)' em horas", () => {
    // 23020.3s = 6,394h -> 6,4h
    const noite = result.events.find((e) => e.day === "2022-08-03")!;
    expect(noite.hours).toBe(6.4);
    expect(noite.kind).toBe("sleep");
    expect(noite.pillar).toBe("vitalidade");
  });

  it("atribui a noite ao dia em que a pessoa ACORDA", () => {
    // Deitou 03/08 23:50, acordou 04/08 06:41 -> conta no dia 04.
    expect(result.events.some((e) => e.day === "2022-08-04")).toBe(true);
    expect(result.events.find((e) => e.day === "2022-08-04")!.hours).toBe(5.3);
  });

  it("usa fuso explícito, não o do computador que rodou", () => {
    expect(result.events.find((e) => e.day === "2022-08-03")!.occurred_at)
      .toBe("2022-08-03T08:15:39-03:00");
  });

  it("põe a qualidade no resumo quando existe", () => {
    expect(result.events.find((e) => e.day === "2022-08-03")!.summary).toBe("Sono: 6,4h · qualidade 83%");
  });

  it("mais recentes primeiro, e informa o intervalo coberto", () => {
    expect(result.events[0].day).toBe("2024-10-31");
    expect(result.range).toEqual({ from: "2022-08-03", to: "2024-10-31" });
    expect(result.stats).toEqual({ rows: 3, skipped: 0, duplicates: 0, truncated: 0, truncatedRange: null });
  });

  it("descarta noites sem duração aproveitável", () => {
    const ruim = SLEEP_CSV.split("\n").slice(0, 2).join("\n")
      + "\n2022-08-05 00:00:00;;0%;0%;0;0;0;0;Not set;0;0;Normal;0;;0;0;0;0;;;0;0;No weather;;;;;;";
    const r = parseHealthCsv(ruim)!;
    expect(r.events).toHaveLength(1);
    expect(r.stats.skipped).toBe(1);
  });
});

/* ── Treino ───────────────────────────────────────────────────────────── */

describe("importação de treino (Hevy)", () => {
  const result = parseHealthCsv(WORKOUT_CSV)!;

  it("agrupa as séries por sessão (título + início)", () => {
    // 5 linhas de série -> 2 sessões.
    expect(result.stats.rows).toBe(5);
    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.description)).toEqual([
      "Quarta, ombros e braços", "Terça, costas dominantes",
    ]);
  });

  it("calcula a duração a partir de início e fim", () => {
    expect(result.events[0].duration_min).toBe(44); // 17:51 -> 18:35
    expect(result.events[1].duration_min).toBe(50); // 18:19 -> 19:09
  });

  it("infere os grupos musculares do nome do exercício", () => {
    expect(result.events[0].muscles).toEqual(["Ombros", "Braços"]);
    expect(result.events[1].muscles).toEqual(["Costas"]);
  });

  it("usa o vocabulário de grupos da tela Vitalidade", () => {
    expect(musclesForExercise("Supino (Barra)")).toEqual(["Peito"]);
    expect(musclesForExercise("Agachamento (Barra)")).toEqual(["Pernas"]);
    expect(musclesForExercise("Puxada Alta na Polia (Máquina)")).toEqual(["Costas"]);
    expect(musclesForExercise("Elevação Lateral (Halter)")).toEqual(["Ombros"]);
    expect(musclesForExercise("Rosca Bíceps (Barra EZ)")).toEqual(["Braços"]);
    expect(musclesForExercise("Abdominal Em L")).toEqual(["Core"]);
    expect(musclesForExercise("Esteira")).toEqual(["Cardio"]);
  });

  it("crucifixo INVERTIDO é ombro posterior, não peito", () => {
    expect(musclesForExercise("Crucifixo Invertido (Máquina)")).toEqual(["Ombros"]);
    expect(musclesForExercise("Aberturas Invertidas De Ombro Posterior (Na Máquina)")).toEqual(["Ombros"]);
    expect(musclesForExercise("Crucifixo na Máquina")).toEqual(["Peito"]);
  });

  it("levantamento terra conta costas E pernas, na ordem do vocabulário do app", () => {
    expect(musclesForExercise("Levantamento Terra Romeno (Barra)")).toEqual(["Costas", "Pernas"]);
  });

  it("não chuta grupo para exercício que não reconhece", () => {
    expect(musclesForExercise("Exercício Inventado XYZ")).toEqual([]);
  });
});

/* ── Peso ─────────────────────────────────────────────────────────────── */

describe("importação de peso (Hevy medidas)", () => {
  const result = parseHealthCsv(MEASUREMENT_CSV)!;

  it("lê o peso e a data de cada pesagem", () => {
    expect(result.events).toHaveLength(3);
    expect(result.events[0]).toMatchObject({
      kind: "weight", pillar: "vitalidade", day: "2025-09-12", kg: 116.5,
      summary: "Peso: 116,5 kg",
    });
  });

  it("ignora linhas de circunferência sem peso, sem tratá-las como erro do arquivo", () => {
    const semPeso = MEASUREMENT_CSV + '\n"13 Set 2025, 00:00",,,38,,,,,,,,,,,,,';
    const r = parseHealthCsv(semPeso)!;
    expect(r.events).toHaveLength(3);
    expect(r.stats.skipped).toBe(1);
  });

  it("recusa peso fisicamente implausível", () => {
    const absurdo = MEASUREMENT_CSV + '\n"14 Set 2025, 00:00",999,,,,,,,,,,,,,,,';
    expect(parseHealthCsv(absurdo)!.events).toHaveLength(3);
  });
});

/* ── Deduplicação e teto ──────────────────────────────────────────────── */

describe("deduplicação por tipo + dia", () => {
  it("dois registros do mesmo tipo no mesmo dia viram um, e o fato é contado", () => {
    const doisNoDia = MEASUREMENT_CSV + '\n"12 Set 2025, 20:00",115.9,,,,,,,,,,,,,,,';
    const r = parseHealthCsv(doisNoDia)!;
    expect(r.events).toHaveLength(3);
    expect(r.stats.duplicates).toBe(1);
    // Vence o primeiro do dia em ordem cronológica.
    expect(r.events.find((e) => e.day === "2025-09-12")!.kg).toBe(116.5);
  });
});

describe("teto por importação", () => {
  it("corta a cauda mais ANTIGA e informa quanto cortou", () => {
    const header = MEASUREMENT_CSV.split("\n")[0];
    const linhas = Array.from({ length: MAX_IMPORT_EVENTS + 25 }, (_, i) => {
      const dia = new Date(Date.UTC(2020, 0, 1 + i));
      const iso = dia.toISOString().slice(0, 10);
      return `"${iso}",90.${i % 10},,,,,,,,,,,,,,,`;
    });
    const r = parseHealthCsv([header, ...linhas].join("\n"))!;
    expect(r.events).toHaveLength(MAX_IMPORT_EVENTS);
    expect(r.stats.truncated).toBe(25);
    // O que sobrou é o mais recente.
    expect(r.events[0].day > r.events[r.events.length - 1].day).toBe(true);

    /* E o aviso tem de poder dizer QUAL período ficou de fora, não só quantos
       registros: são os 25 primeiros dias do arquivo, a ponta antiga. */
    expect(r.stats.truncatedRange).toEqual({ from: "2020-01-01", to: "2020-01-25" });

    /* Contíguo ao que entrou, sem buraco no meio: se o corte não fosse na
       ponta antiga, o histórico da pessoa teria um vão inexplicável. */
    const cortadoAte = new Date(`${r.stats.truncatedRange!.to}T00:00:00Z`).getTime();
    const entrouDe = new Date(`${r.range!.from}T00:00:00Z`).getTime();
    expect(entrouDe - cortadoAte).toBe(86_400_000);
  });

  it("cabe um histórico de dez anos de todos os tipos, todo dia", () => {
    // A deduplicação é um registro por TIPO e por DIA: 4 tipos × 366 × 10 anos
    // é a fronteira do que pode existir. O teto tem de estar acima dela.
    expect(MAX_IMPORT_EVENTS).toBeGreaterThanOrEqual(4 * 366 * 10);
    // E o export real de dez anos de iPhone deu ~2.000 eventos: com este teto
    // o corte deixa de acontecer no caso real, em vez de acontecer calado.
    expect(MAX_IMPORT_EVENTS).toBeGreaterThan(1998);
  });

  it("sem corte, o período cortado é null (não é uma faixa vazia)", () => {
    const r = parseHealthCsv(SLEEP_CSV)!;
    expect(r.stats.truncated).toBe(0);
    expect(r.stats.truncatedRange).toBeNull();
  });
});

describe("formatLabel", () => {
  it("plural certo em pt-BR", () => {
    expect(formatLabel("sleep", 1)).toBe("1 noite de sono");
    expect(formatLabel("sleep", 555)).toBe("555 noites de sono");
    expect(formatLabel("workout", 1)).toBe("1 treino");
    expect(formatLabel("workout", 77)).toBe("77 treinos");
    expect(formatLabel("measurement", 1)).toBe("1 pesagem");
    expect(formatLabel("measurement", 20)).toBe("20 pesagens");
  });
});

/* ── Chave de proveniência ────────────────────────────────────────────────
   É ela que, junto com a fonte, faz reimportar o mesmo arquivo não duplicar
   nada. Duas exigências: ser a MESMA a cada leitura do mesmo arquivo, e ser
   única dentro do resultado. */

describe("record_key", () => {
  it("é a mesma a cada leitura do mesmo arquivo", () => {
    const a = parseHealthCsv(SLEEP_CSV)!;
    const b = parseHealthCsv(SLEEP_CSV)!;
    expect(a.events.map((e) => e.record_key)).toEqual(b.events.map((e) => e.record_key));
  });

  it("usa a mesma regra da deduplicação: tipo e dia", () => {
    const r = parseHealthCsv(SLEEP_CSV)!;
    for (const ev of r.events) expect(ev.record_key).toBe(`${ev.kind}|${ev.day}`);
  });

  it("é única dentro do resultado, nos três formatos", () => {
    for (const csv of [SLEEP_CSV, WORKOUT_CSV, MEASUREMENT_CSV]) {
      const r = parseHealthCsv(csv)!;
      const keys = r.events.map((e) => e.record_key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("não muda quando o arquivo GANHA linhas novas (importação incremental)", () => {
    const antes = parseHealthCsv(MEASUREMENT_CSV)!;
    const depois = parseHealthCsv(`${MEASUREMENT_CSV}\n"13 Set 2025, 00:00",116.1,,,,,,,,,,,,,,,`)!;
    const novas = depois.events.map((e) => e.record_key);
    for (const ev of antes.events) expect(novas).toContain(ev.record_key);
  });
});

describe("PARSER_VERSION", () => {
  it("identifica a regra que produziu os eventos", () => {
    expect(PARSER_VERSION).toBe("health-csv/2");
  });
});

/* ═══ OUTROS APPS ═════════════════════════════════════════════════════════
   Cabeçalhos dos exports mais comuns do mercado. O detector não conhece marca
   nenhuma: ele reconhece CONCEITOS de coluna, então cada amostra abaixo prova
   que a tabela de sinônimos cobre aquele arquivo — não que existe um parser
   dedicado a ele. */

const FITBIT_SLEEP = `Start Time,End Time,Minutes Asleep,Minutes Awake,Number of Awakenings,Time in Bed,Minutes REM Sleep,Minutes Light Sleep,Minutes Deep Sleep
2024-03-21 23:42:00,2024-03-22 07:11:00,398,51,18,449,74,240,84`;

const WHOOP_SLEEP = `Cycle start time,Cycle end time,Sleep onset,Wake onset,Sleep performance %,Asleep duration (min),In bed duration (min),Sleep efficiency %
2024-03-21 22:58:00,2024-03-22 07:02:00,2024-03-21 23:10:00,2024-03-22 07:00:00,88,441,484,92`;

const OURA_SLEEP = `date,Sleep Score,Total Sleep Duration,Total Bedtime,Awake Time,REM Sleep Duration,Deep Sleep Duration,Sleep Efficiency
2024-03-22,79,26520,29400,2880,5400,4980,90`;

const AUTOSLEEP = `fromDate,toDate,inBed,awake,sleep,quality,deep
2024-03-21 23:30:00,2024-03-22 06:45:00,7:15:00,0:32:00,6:43:00,85,1:20:00`;

const STRONG_WORKOUT = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes
2024-03-22 18:10:00,Peito e tríceps,65,Supino Reto com Barra,1,60,10,,,
2024-03-22 18:10:00,Peito e tríceps,65,Supino Reto com Barra,2,70,8,,,
2024-03-22 18:10:00,Peito e tríceps,65,Tríceps na Corda,1,25,12,,,`;

const STRAVA_ACTIVITIES = `Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Calories
1234567890,"Mar 22, 2024, 3:50:31 PM",Corrida vespertina,Run,2712,7.42,540
1234567891,"Mar 24, 2024, 8:05:00 AM",Pedal de domingo,Ride,5400,32.1,880`;

const GARMIN_ACTIVITIES = `Activity Type,Date,Favorite,Title,Distance,Calories,Time,Avg HR
Running,2024-03-22 06:12:00,false,Corrida matinal,8.05,612,00:45:12,148
Strength Training,2024-03-23 19:00:00,false,Musculação,0.00,320,01:02:00,110`;

const WITHINGS_WEIGHT = `Date,Weight (kg),Fat mass (kg),Bone mass (kg),Muscle mass (kg),Hydration (kg),Comments
2024-03-22T07:12:00-03:00,96.4,18.2,3.4,71.2,52.1,`;

const RENPHO_WEIGHT = `Date,Weight(lb),BMI,Body Fat(%),Muscle Mass(lb)
2024-03-22 07:15:00,212.5,29.4,24.8,148.2`;

const FITBIT_BODY = `Date,Weight,BMI,Fat
2024-03-22,96.4,29.1,24.3`;

describe("sono de outros apps", () => {
  it("Fitbit: 'Minutes Asleep' vira horas", () => {
    const r = parseHealthCsv(FITBIT_SLEEP)!;
    expect(r.format).toBe("sleep");
    expect(r.events[0].hours).toBe(6.6); // 398 min
    expect(r.events[0].day).toBe("2024-03-22"); // dia em que acordou
  });

  it("Whoop: 'Asleep duration (min)' vira horas", () => {
    const r = parseHealthCsv(WHOOP_SLEEP)!;
    expect(r.format).toBe("sleep");
    expect(r.events[0].hours).toBe(7.4); // 441 min
  });

  it("Oura: duração em SEGUNDOS e só a data da noite", () => {
    const r = parseHealthCsv(OURA_SLEEP)!;
    expect(r.format).toBe("sleep");
    expect(r.events[0].hours).toBe(7.4); // 26520 s
    expect(r.events[0].day).toBe("2024-03-22");
  });

  it("AutoSleep: duração em hh:mm:ss", () => {
    const r = parseHealthCsv(AUTOSLEEP)!;
    expect(r.format).toBe("sleep");
    expect(r.events[0].hours).toBe(6.7); // 6:43:00
    expect(r.events[0].summary).toContain("qualidade 85%");
  });

  it("prefere a duração DORMIDA à do tempo na cama", () => {
    // Fitbit traz as duas: 398 dormidas e 449 na cama. A noite vale 6,6h.
    expect(parseHealthCsv(FITBIT_SLEEP)!.events[0].hours).toBe(6.6);
  });

  it("o rótulo não atribui app quando o cabeçalho não permite afirmar", () => {
    expect(parseHealthCsv(FITBIT_SLEEP)!.sourceLabel).toBe("sono (formato genérico)");
    // O Sleep Cycle TEM assinatura própria e é nomeado.
    expect(parseHealthCsv(SLEEP_CSV)!.sourceLabel).toBe("sono (Sleep Cycle)");
  });
});

describe("treino de outros apps", () => {
  it("Strong: agrupa séries e lê a duração em minutos", () => {
    const r = parseHealthCsv(STRONG_WORKOUT)!;
    expect(r.format).toBe("workout");
    expect(r.events).toHaveLength(1);
    expect(r.events[0].duration_min).toBe(65);
    expect(r.events[0].muscles).toEqual(["Peito", "Braços"]);
  });

  it("Strava: uma linha por atividade, data 'Mar 22, 2024, 3:50:31 PM'", () => {
    const r = parseHealthCsv(STRAVA_ACTIVITIES)!;
    expect(r.format).toBe("workout");
    expect(r.events).toHaveLength(2);
    const corrida = r.events.find((e) => e.day === "2024-03-22")!;
    expect(corrida.occurred_at).toBe("2024-03-22T15:50:31-03:00"); // PM
    expect(corrida.duration_min).toBe(45); // 2712 s
    expect(corrida.muscles).toContain("Cardio");
    expect(corrida.summary).toContain("7,4 km");
  });

  it("Garmin: duração 'Time' em hh:mm:ss e tipo em inglês", () => {
    const r = parseHealthCsv(GARMIN_ACTIVITIES)!;
    expect(r.format).toBe("workout");
    const corrida = r.events.find((e) => e.day === "2024-03-22")!;
    expect(corrida.duration_min).toBe(45); // 00:45:12
    expect(corrida.muscles).toContain("Cardio");
    // "Strength Training" é genérico: o módulo NÃO chuta grupo muscular.
    const forca = r.events.find((e) => e.day === "2024-03-23")!;
    expect(forca.muscles).toBeUndefined();
  });

  it("calorias de atividade não fazem um treino virar refeição", () => {
    // Strava e Garmin trazem "Calories". Sem a precedência de treino, um
    // arquivo de corrida entraria como comida.
    expect(parseHealthCsv(STRAVA_ACTIVITIES)!.format).toBe("workout");
    expect(parseHealthCsv(GARMIN_ACTIVITIES)!.format).toBe("workout");
  });
});

describe("peso de outros apps", () => {
  it("Withings: fuso explícito no arquivo e assinatura própria", () => {
    const r = parseHealthCsv(WITHINGS_WEIGHT)!;
    expect(r.format).toBe("measurement");
    expect(r.sourceLabel).toBe("peso (Withings)");
    expect(r.events[0].kg).toBe(96.4);
  });

  it("Withings: 'Fat mass (kg)' NÃO é lido como percentual de gordura", () => {
    // 18,2 kg de gordura virando "18,2% de gordura" seria inventar um número
    // sobre o corpo da pessoa.
    expect(parseHealthCsv(WITHINGS_WEIGHT)!.events[0].summary).not.toContain("%");
  });

  /* ─── A fronteira da faixa de peso ────────────────────────────────── */

  it("20,0 kg e 400,0 kg PASSAM: a fronteira é inclusiva nos dois lados", () => {
    // A contradição que este teste fecha: o parser aceitava a borda e a
    // gravação recusava, então 20,0 kg aparecia no cartão de revisão e o
    // registro respondia "está fora do que eu aceito (de 20 a 400 kg)" —
    // recusando na segunda tela o valor que ele mesmo mostrou na primeira.
    // A faixa agora vem de lib/bodyWeight, uma só, inclusiva.
    const borda = `Date,Weight (kg)\n2026-05-10,${BODY_WEIGHT_MIN_KG}.0\n2026-05-11,${BODY_WEIGHT_MAX_KG}.0`;
    const r = parseHealthCsv(borda)!;
    // A ordem é do registro mais RECENTE para o mais antigo (o 400 é do dia 11).
    expect(r.events.map((e) => e.kg)).toEqual([BODY_WEIGHT_MAX_KG, BODY_WEIGHT_MIN_KG]);
    expect(r.stats.skipped).toBe(0);
    // E o outro lado da mesma regra concorda, valor por valor.
    expect(isPlausibleBodyWeightKg(BODY_WEIGHT_MIN_KG)).toBe(true);
    expect(isPlausibleBodyWeightKg(BODY_WEIGHT_MAX_KG)).toBe(true);
  });

  it("fora da faixa continua descartado, e em silêncio", () => {
    // O que a faixa existe para barrar: erro de unidade (gramas na coluna de
    // kg) e lixo de coluna. Vira linha pulada, não erro na cara da pessoa.
    const lixo = "Date,Weight (kg)\n2026-05-10,19.9\n2026-05-11,400.1\n2026-05-12,3500\n2026-05-13,96.4";
    const r = parseHealthCsv(lixo)!;
    expect(r.events.map((e) => e.kg)).toEqual([96.4]);
    expect(r.stats.skipped).toBe(3);
    expect(isPlausibleBodyWeightKg(19.9)).toBe(false);
    expect(isPlausibleBodyWeightKg(400.1)).toBe(false);
    expect(isPlausibleBodyWeightKg(Number.NaN)).toBe(false);
    expect(isPlausibleBodyWeightKg(null)).toBe(false);
  });

  it("Renpho: peso em LIBRAS é convertido", () => {
    const r = parseHealthCsv(RENPHO_WEIGHT)!;
    expect(r.events[0].kg).toBe(96.4); // 212,5 lb
    expect(r.events[0].summary).toContain("24,8% de gordura");
  });

  it("Fitbit body.csv: peso sem unidade no nome é lido como kg", () => {
    const r = parseHealthCsv(FITBIT_BODY)!;
    expect(r.events[0].kg).toBe(96.4);
    expect(r.events[0].summary).toContain("24,3% de gordura");
  });
});

describe("unidades", () => {
  it("peso: só converte quando a COLUNA diz libra", () => {
    expect(parseWeightKg("212.5", "weight_lb")).toBe(96.4);
    expect(parseWeightKg("212.5", "weight_lbs")).toBe(96.4);
    expect(parseWeightKg("212.5", "peso_libras")).toBe(96.4);
    // Sem dizer, é kg: adivinhar por magnitude trocaria 95 kg por 43 kg.
    expect(parseWeightKg("96.4", "weight")).toBe(96.4);
    expect(parseWeightKg("96,4", "weight_kg")).toBe(96.4);
    expect(parseWeightKg("", "weight_kg")).toBeNull();
    expect(parseWeightKg("abc", "weight_kg")).toBeNull();
  });

  it("sono: segundos, minutos, horas decimais e hh:mm", () => {
    expect(parseDurationHours("26520", "total_sleep_duration_seconds")).toBeCloseTo(7.37, 2);
    expect(parseDurationHours("441", "asleep_duration_min")).toBeCloseTo(7.35, 2);
    expect(parseDurationHours("7.5", "sleep_hours")).toBe(7.5);
    expect(parseDurationHours("6:43:00", "sleep")).toBeCloseTo(6.72, 2);
    expect(parseDurationHours("7:30", "sleep")).toBe(7.5);
  });

  it("sono sem unidade no nome: a magnitude decide, com limites escritos", () => {
    expect(parseDurationHours("7.5", "sleep")).toBe(7.5);      // <= 24 é hora
    expect(parseDurationHours("450", "sleep")).toBe(7.5);      // <= 1440 é minuto
    expect(parseDurationHours("27000", "sleep")).toBe(7.5);    // acima é segundo
  });

  it("treino: hh:mm:ss, unidade no nome e magnitude", () => {
    expect(parseDurationMinutes("00:45:12", "time")).toBeCloseTo(45.2, 1);
    expect(parseDurationMinutes("2712", "elapsed_time_seconds")).toBeCloseTo(45.2, 1);
    expect(parseDurationMinutes("65", "duration")).toBe(65);   // <= 600 é minuto
    expect(parseDurationMinutes("1.5", "duration")).toBe(90);  // <= 12 é hora
  });
});

describe("datas com fuso e epoch", () => {
  it("ISO com offset é convertido para o fuso do app", () => {
    // 15:50:31Z é 12:50:31 em São Paulo. Ler como 15:50 local jogaria o
    // registro três horas adiante e chegaria a mudar o dia de uma noite.
    expect(parseStamp("2024-03-22T15:50:31Z")).toEqual(
      { y: 2024, mo: 3, d: 22, h: 12, mi: 50, s: 31 });
    expect(parseStamp("2024-03-22T15:50:31-03:00")).toEqual(
      { y: 2024, mo: 3, d: 22, h: 15, mi: 50, s: 31 });
    expect(parseStamp("2024-03-22T00:30:00+02:00")).toEqual(
      { y: 2024, mo: 3, d: 21, h: 19, mi: 30, s: 0 });
  });

  it("epoch em segundos e milissegundos", () => {
    expect(parseStamp("1711122631")).toEqual(
      { y: 2024, mo: 3, d: 22, h: 12, mi: 50, s: 31 });
    expect(parseStamp("1711122631000")).toEqual(
      { y: 2024, mo: 3, d: 22, h: 12, mi: 50, s: 31 });
  });

  it("número de outro comprimento NÃO é tratado como epoch", () => {
    // 20240322 parece data compacta; adivinhar seria inventar a data.
    expect(parseStamp("20240322")).toBeNull();
    expect(parseStamp("171112")).toBeNull();
  });

  it("mês por nome primeiro, com AM/PM", () => {
    expect(parseStamp("Mar 22, 2024, 3:50:31 PM")).toEqual(
      { y: 2024, mo: 3, d: 22, h: 15, mi: 50, s: 31 });
    expect(parseStamp("Mar 22, 2024, 12:05:00 AM")).toEqual(
      { y: 2024, mo: 3, d: 22, h: 0, mi: 5, s: 0 });
  });
});

describe("recusa honesta", () => {
  it("arquivo PARECIDO com sono mas sem duração nem fim não é reconhecido", () => {
    const quase = `Start,Sleep Notes\n2024-03-22 23:00:00,dormi mal`;
    expect(detectHealthCsv(quase)).toBeNull();
    expect(parseHealthCsv(quase)).toBeNull();
  });

  it("arquivo com peso mas SEM nenhuma data não é reconhecido", () => {
    const semData = `Weight (kg),BMI\n96.4,29.1`;
    expect(detectHealthCsv(semData)).toBeNull();
  });

  it("linhas com data ilegível são contadas como descartadas, não inventadas", () => {
    const ruim = `Date,Weight (kg)\nanteontem,96.4\n2024-03-22,95.0`;
    const r = parseHealthCsv(ruim)!;
    expect(r.events).toHaveLength(1);
    expect(r.stats.skipped).toBe(1);
  });

  it("gordura em fração (0,24) não vira '0,2% de gordura'", () => {
    const fracao = `Date,Weight,Body Fat(%)\n2024-03-22,96.4,0.24`;
    expect(parseHealthCsv(fracao)!.events[0].summary).not.toContain("%");
  });
});

describe("SUPPORTED_SOURCES", () => {
  it("cobre os quatro conceitos que a importação lê hoje", () => {
    expect(SUPPORTED_SOURCES.length).toBeGreaterThanOrEqual(3);
    for (const s of SUPPORTED_SOURCES) {
      expect(s.app.length).toBeGreaterThan(0);
      expect(s.brings.length).toBeGreaterThan(0);
    }
  });
});

/* ═══ ALIMENTAÇÃO ═════════════════════════════════════════════════════════
   Duas formas de export, e a diferença entre elas é o ponto: o MyFitnessPal
   escreve uma linha POR REFEIÇÃO (coluna "Meal"), o Cronometer escreve o
   resumo do DIA. Tratar as duas igual faria o total do dia se passar por uma
   refeição. */

const MFP_NUTRITION = `Date,Meal,Calories,Fat (g),Saturated Fat,Cholesterol,Sodium (mg),Carbohydrates (g),Fiber,Sugar,Protein (g)
2024-03-22,Breakfast,412,14,4,180,320,38,5,12,26
2024-03-22,Lunch,735,22,6,95,890,72,9,8,48
2024-03-22,Dinner,610,19,5,110,760,58,7,6,41
2024-03-22,Snacks,243,11,2,15,180,26,3,14,9
2024-03-23,Breakfast,398,12,3,170,300,40,5,11,25`;

const CRONOMETER_DAILY = `Date,Energy (kcal),Alcohol (g),Caffeine (mg),Carbs (g),Fat (g),Protein (g),Fiber (g)
2024-03-22,2087,0,95,214,66,131,28
2024-03-23,1954,0,80,198,61,124,31`;

describe("importação de alimentação", () => {
  it("MyFitnessPal: uma linha por refeição vira uma refeição, com meal_type", () => {
    const r = parseHealthCsv(MFP_NUTRITION)!;
    expect(r.format).toBe("nutrition");
    // Quatro refeições do dia 22 + uma do dia 23 = 5 registros, NÃO 2.
    expect(r.events).toHaveLength(5);
    expect(r.stats.duplicates).toBe(0);

    const tipos = r.events.filter((e) => e.day === "2024-03-22").map((e) => e.meal_type).sort();
    expect(tipos).toEqual(["almoco", "cafe_da_manha", "jantar", "lanche"]);
  });

  it("MyFitnessPal: calorias e macros por refeição", () => {
    const almoco = parseHealthCsv(MFP_NUTRITION)!.events.find((e) => e.meal_type === "almoco")!;
    expect(almoco.calories).toBe(735);
    expect(almoco.protein_g).toBe(48);
    expect(almoco.carbs_g).toBe(72);
    expect(almoco.fat_g).toBe(22);
    expect(almoco.summary).toBe("Almoço: 735 kcal · 48 g de proteína");
  });

  it("MyFitnessPal: as refeições do mesmo dia NÃO colapsam na deduplicação", () => {
    // Sem chave por refeição, as quatro do dia 22 viravam uma e três seriam
    // contadas como duplicadas — a pessoa perderia 1.588 kcal do próprio dia.
    const r = parseHealthCsv(MFP_NUTRITION)!;
    const chaves = r.events.map((e) => e.record_key).sort();
    expect(new Set(chaves).size).toBe(5);
    expect(chaves).toContain("meal|2024-03-22|almoco");
    expect(chaves).toContain("meal|2024-03-22|lanche");
  });

  it("Cronometer: total do DIA se declara como dia inteiro, não como refeição", () => {
    const r = parseHealthCsv(CRONOMETER_DAILY)!;
    expect(r.format).toBe("nutrition");
    expect(r.events).toHaveLength(2);
    const dia22 = r.events.find((e) => e.day === "2024-03-22")!;
    expect(dia22.calories).toBe(2087);   // "Energy (kcal)"
    expect(dia22.protein_g).toBe(131);
    // A honestidade mora aqui: quem ler isto não confunde com um almoço.
    expect(dia22.meal_type).toBe("dia_inteiro");
    expect(dia22.summary).toBe("Alimentação do dia inteiro: 2087 kcal · 131 g de proteína");
    expect(dia22.description).toBe("Dia inteiro: 2087 kcal");
    expect(dia22.record_key).toBe("meal|2024-03-22");
  });

  it("nome de refeição fora do vocabulário do app não vira meal_type inventado", () => {
    // "Pre-workout" não é café, almoço, jantar nem lanche. Encaixar à força
    // seria adivinhar o que a pessoa quis dizer — o nome fica na descrição.
    const csv = `Date,Meal,Calories,Protein (g)\n2024-03-22,Pre-workout,180,20`;
    const ev = parseHealthCsv(csv)!.events[0];
    expect(ev.meal_type).toBeUndefined();
    expect(ev.description).toBe("Pre-workout: 180 kcal");
    expect(ev.record_key).toBe("meal|2024-03-22|pre_workout");
  });

  it("o rótulo diz 'registro de alimentação', não 'refeição'", () => {
    // Chamar 120 dias de total de "120 refeições" é o erro que este formato
    // existe para não cometer.
    expect(formatLabel("nutrition", 1)).toBe("1 registro de alimentação");
    expect(formatLabel("nutrition", 120)).toBe("120 registros de alimentação");
  });

  it("o rótulo da fonte é honesto (não atribui app sem assinatura)", () => {
    expect(parseHealthCsv(MFP_NUTRITION)!.sourceLabel).toBe("alimentação (formato genérico)");
  });
});

describe("alimentação: recusas honestas", () => {
  it("arquivo com calorias mas SEM nenhum macro não é alimentação", () => {
    // É o caso do Strava e do Garmin: eles exportam "Calories" de atividade.
    // Ler isso como comida inventaria uma refeição que não houve.
    const atividade = `Date,Activity Name,Calories\n2024-03-22,Corrida,540`;
    const r = parseHealthCsv(atividade);
    expect(r?.format).not.toBe("nutrition");
  });

  it("o export do Strava continua sendo treino, e não comida", () => {
    expect(parseHealthCsv(STRAVA_ACTIVITIES)!.format).toBe("workout");
    expect(parseHealthCsv(GARMIN_ACTIVITIES)!.format).toBe("workout");
  });

  it("arquivo com macros mas SEM calorias não é reconhecido", () => {
    const semKcal = `Date,Protein (g),Carbs (g)\n2024-03-22,131,214`;
    expect(detectHealthCsv(semKcal)).toBeNull();
    expect(parseHealthCsv(semKcal)).toBeNull();
  });

  it("linha com caloria zerada é descartada, não registrada como 0 kcal", () => {
    // Rodapé de planilha e dia não preenchido vêm assim. Registrar 0 kcal
    // faria a meta calórica do dia parecer cumprida sem ninguém ter comido.
    const csv = `Date,Meal,Calories,Protein (g)\n2024-03-22,Breakfast,0,0\n2024-03-22,Lunch,735,48`;
    const r = parseHealthCsv(csv)!;
    expect(r.events).toHaveLength(1);
    expect(r.stats.skipped).toBe(1);
  });

  it("macro faltando não impede o registro, só não é inventado", () => {
    const csv = `Date,Meal,Calories,Protein (g),Carbs (g),Fat (g)\n2024-03-22,Lunch,735,,72,`;
    const ev = parseHealthCsv(csv)!.events[0];
    expect(ev.calories).toBe(735);
    expect(ev.carbs_g).toBe(72);
    expect(ev.protein_g).toBeUndefined();
    expect(ev.fat_g).toBeUndefined();
    expect(ev.summary).toBe("Almoço: 735 kcal");
  });

  it("data ilegível é descartada, e o arquivo segue", () => {
    const csv = `Date,Meal,Calories,Protein (g)\nontem,Lunch,700,40\n2024-03-22,Lunch,735,48`;
    const r = parseHealthCsv(csv)!;
    expect(r.events).toHaveLength(1);
    expect(r.stats.skipped).toBe(1);
  });

  it("peso não é confundido com alimentação (o Fitbit body.csv tem 'Fat')", () => {
    expect(parseHealthCsv(FITBIT_BODY)!.format).toBe("measurement");
  });
});
