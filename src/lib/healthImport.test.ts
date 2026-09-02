// ASCENDE — Testes da importação de CSV de apps de saúde.
// As amostras abaixo são LINHAS REAIS dos arquivos que o fundador exportou
// (Sleep Cycle, Hevy treinos e Hevy medidas), recortadas — inclusive o
// cabeçalho inteiro, que é o que o detector realmente vê.
import { describe, it, expect } from "vitest";
import {
  parseHealthCsv, detectHealthCsv, detectDelimiter, parseCsv, parseStamp,
  musclesForExercise, formatLabel, MAX_IMPORT_EVENTS, PARSER_VERSION,
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
    expect(result.stats).toEqual({ rows: 3, skipped: 0, duplicates: 0, truncated: 0 });
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
      kind: "weight", pillar: "alimentacao", day: "2025-09-12", kg: 116.5,
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
    expect(PARSER_VERSION).toBe("health-csv/1");
  });
});
