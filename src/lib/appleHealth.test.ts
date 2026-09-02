// ASCENDE — Testes do parser do App Saúde.
//
// As amostras são trechos REAIS do export do fundador (com os atributos longos
// preservados: é o `device` cheio de sinais que quebra scanner ingênuo),
// recortadas para caber aqui. O arquivo de verdade tem 876 MB e NUNCA entra em
// teste — o que se testa aqui é a regra, não o tamanho.
import { describe, it, expect } from "vitest";
import {
  parseAppleHealthXml, createAppleHealthScanner, parseAppleStamp,
  looksLikeAppleHealth, appleHealthLabel, PARSER_VERSION,
} from "@/lib/appleHealth";

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout)*)>
]>
<HealthData locale="pt_BR">
 <ExportDate value="2026-08-30 09:12:00 -0300"/>`;

const DEVICE = `device="&lt;&lt;HKDevice: 0xd41996ee0&gt;, name:iPhone, manufacturer:Apple, model:iPhone, hardware:iPhone7,2, software:10.0.2&gt;"`;

const sleep = (start: string, end: string, value: string) =>
  ` <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Relógio" ${DEVICE} startDate="${start}" endDate="${end}" value="HKCategoryValueSleepAnalysis${value}"/>`;

const weight = (at: string, kg: string) =>
  ` <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Saúde" unit="kg" startDate="${at}" endDate="${at}" value="${kg}"/>`;

const workout = (type: string, start: string, end: string, min: string) =>
  ` <Workout workoutActivityType="HKWorkoutActivityType${type}" duration="${min}" durationUnit="min" sourceName="Apple Watch" ${DEVICE} startDate="${start}" endDate="${end}">\n  <WorkoutEvent type="HKWorkoutEventTypePause" date="${start}"/>\n </Workout>`;

const wrap = (...lines: string[]) => `${HEAD}\n${lines.join("\n")}\n</HealthData>`;

describe("parseAppleStamp", () => {
  it("respeita o offset do próprio registro", () => {
    const sp = parseAppleStamp("2024-03-22 15:50:31 -0300")!;
    const eu = parseAppleStamp("2024-03-22 15:50:31 +0200")!;
    // Mesmo relógio de parede, DIA igual — é o dia da vida da pessoa.
    expect(sp.day).toBe("2024-03-22");
    expect(eu.day).toBe("2024-03-22");
    // Mas instantes diferentes: cinco horas separam os dois fusos.
    expect(sp.epochMs - eu.epochMs).toBe(5 * 3600_000);
  });

  it("devolve null para carimbo que não dá para ler", () => {
    expect(parseAppleStamp("ontem à noite")).toBeNull();
    expect(parseAppleStamp("")).toBeNull();
  });
});

describe("reconhecimento do arquivo", () => {
  it("aceita o export e recusa outro XML qualquer", () => {
    expect(looksLikeAppleHealth(HEAD)).toBe(true);
    expect(looksLikeAppleHealth("<?xml version='1.0'?><rss><channel/></rss>")).toBe(false);
    expect(parseAppleHealthXml("<rss><channel/></rss>")).toBeNull();
  });
});

describe("sono", () => {
  it("soma os trechos da MESMA noite, inclusive o que termina antes da meia-noite", () => {
    // Caso real do arquivo do fundador: a noite começa às 23h21 do dia 29 e
    // termina às 6h20 do dia 30. Sem a regra de noite, viraria "0,2h no dia 29".
    const r = parseAppleHealthXml(wrap(
      sleep("2019-04-29 23:21:16 -0300", "2019-04-29 23:30:12 -0300", "AsleepCore"),
      sleep("2019-04-30 00:29:12 -0300", "2019-04-30 03:00:00 -0300", "AsleepDeep"),
      sleep("2019-04-30 03:00:00 -0300", "2019-04-30 06:20:18 -0300", "AsleepREM"),
    ))!;
    expect(r.events).toHaveLength(1);
    const noite = r.events[0];
    expect(noite.day).toBe("2019-04-30");
    expect(noite.kind).toBe("sleep");
    expect(noite.hours).toBe(6);   // 8min + 2h31 + 3h20 ≈ 6,0h
    expect(noite.record_key).toBe("sleep|2019-04-30");
  });

  it("ignora InBed quando existe sono de verdade na noite", () => {
    const r = parseAppleHealthXml(wrap(
      sleep("2024-05-01 23:00:00 -0300", "2024-05-02 07:00:00 -0300", "InBed"),
      sleep("2024-05-02 00:00:00 -0300", "2024-05-02 06:00:00 -0300", "AsleepCore"),
    ))!;
    expect(r.events[0].hours).toBe(6);           // as 6h de sono, não as 8h na cama
    expect(r.events[0].summary).not.toContain("cama");
  });

  it("usa InBed como último recurso, e avisa no resumo", () => {
    const r = parseAppleHealthXml(wrap(
      sleep("2024-05-01 23:00:00 -0300", "2024-05-02 07:00:00 -0300", "InBed"),
    ))!;
    expect(r.events[0].hours).toBe(8);
    expect(r.events[0].summary).toContain("tempo na cama");
  });
});

describe("peso e gordura", () => {
  it("junta a gordura do mesmo dia no resumo e mantém uma pesagem por dia", () => {
    const r = parseAppleHealthXml(wrap(
      weight("2026-08-10 07:00:00 -0300", "101.5"),
      weight("2026-08-10 21:00:00 -0300", "102.4"),   // segunda do dia: duplicata
      ` <Record type="HKQuantityTypeIdentifierBodyFatPercentage" unit="%" sourceName="Balança" startDate="2026-08-10 07:00:01 -0300" endDate="2026-08-10 07:00:01 -0300" value="0.284"/>`,
    ))!;
    expect(r.events).toHaveLength(1);
    expect(r.events[0].kind).toBe("weight");
    expect(r.events[0].pillar).toBe("alimentacao");  // o pilar que o app usa para peso
    expect(r.events[0].kg).toBe(101.5);              // a da manhã
    expect(r.events[0].summary).toBe("Peso: 101,5 kg · 28,4% de gordura");
    expect(r.stats.duplicates).toBe(1);
  });

  it("descarta peso fora da faixa humana", () => {
    const r = parseAppleHealthXml(wrap(weight("2026-08-10 07:00:00 -0300", "0")))!;
    expect(r.events).toHaveLength(0);
    expect(r.stats.skipped).toBe(1);
  });
});

describe("treino", () => {
  it("agrupa as sessões do dia, traduz o tipo e marca Cardio", () => {
    const r = parseAppleHealthXml(wrap(
      workout("Running", "2026-08-12 06:00:00 -0300", "2026-08-12 06:40:00 -0300", "40.2"),
      workout("TraditionalStrengthTraining", "2026-08-12 18:00:00 -0300", "2026-08-12 19:00:00 -0300", "60"),
    ))!;
    expect(r.events).toHaveLength(1);
    const treino = r.events[0];
    expect(treino.kind).toBe("workout");
    expect(treino.duration_min).toBe(100);
    expect(treino.description).toBe("Corrida, Musculação");
    expect(treino.muscles).toEqual(["Cardio"]);
    expect(treino.summary).toBe("2 treinos: Corrida, Musculação · 100 min");
  });

  it("não conta WorkoutEvent/WorkoutRoute como treino", () => {
    // O <Workout> da amostra tem um <WorkoutEvent> dentro. Se o scanner
    // contasse os filhos, um treino viraria dois.
    const r = parseAppleHealthXml(wrap(
      workout("Walking", "2026-08-13 10:00:00 -0300", "2026-08-13 10:16:00 -0300", "16"),
    ))!;
    expect(r.events[0].summary).toBe("Treino: Caminhada · 16 min");
  });

  it("tipo desconhecido vira 'Atividade física' em vez de nome técnico", () => {
    const r = parseAppleHealthXml(wrap(
      workout("Archery", "2026-08-14 10:00:00 -0300", "2026-08-14 10:30:00 -0300", "30"),
    ))!;
    expect(r.events[0].description).toBe("Atividade física");
    expect(r.events[0].muscles).toBeUndefined();
  });
});

describe("água", () => {
  it("soma os copos do dia", () => {
    const r = parseAppleHealthXml(wrap(
      ` <Record type="HKQuantityTypeIdentifierDietaryWater" unit="mL" sourceName="Diário de água" startDate="2024-07-11 09:15:18 -0300" endDate="2024-07-11 09:15:18 -0300" value="300"/>`,
      ` <Record type="HKQuantityTypeIdentifierDietaryWater" unit="mL" sourceName="Diário de água" startDate="2024-07-11 15:00:00 -0300" endDate="2024-07-11 15:00:00 -0300" value="500"/>`,
    ))!;
    expect(r.events).toHaveLength(1);
    expect(r.events[0].kind).toBe("water");
    expect(r.events[0].ml).toBe(800);
  });
});

describe("streaming por pedaços", () => {
  const XML = wrap(
    sleep("2026-08-01 23:00:00 -0300", "2026-08-02 06:00:00 -0300", "AsleepCore"),
    weight("2026-08-02 07:00:00 -0300", "99.9"),
    workout("Cycling", "2026-08-02 17:00:00 -0300", "2026-08-02 18:00:00 -0300", "60"),
  );

  it("dá o MESMO resultado cortando o arquivo em qualquer lugar", () => {
    const inteiro = parseAppleHealthXml(XML)!;
    // Corta de 1 em 1 byte, de 7 em 7, de 13 em 13: em algum desses cortes uma
    // tag fica partida no meio de um atributo, que é o caso que interessa.
    for (const size of [1, 7, 13, 64, 999]) {
      const scanner = createAppleHealthScanner();
      for (let i = 0; i < XML.length; i += size) scanner.push(XML.slice(i, i + size));
      const pedacos = scanner.finish();
      expect(pedacos.events).toEqual(inteiro.events);
      expect(pedacos.stats).toEqual(inteiro.stats);
    }
  });

  it("ler duas vezes produz exatamente as mesmas chaves", () => {
    const a = parseAppleHealthXml(XML)!;
    const b = parseAppleHealthXml(XML)!;
    expect(a.events.map((e) => e.record_key)).toEqual(b.events.map((e) => e.record_key));
  });
});

describe("resultado", () => {
  it("traz formato, período e rótulo prontos para a revisão", () => {
    const r = parseAppleHealthXml(wrap(
      sleep("2026-08-01 23:00:00 -0300", "2026-08-02 06:00:00 -0300", "AsleepCore"),
      weight("2026-07-15 07:00:00 -0300", "99.9"),
      workout("Yoga", "2026-08-05 07:00:00 -0300", "2026-08-05 08:00:00 -0300", "60"),
    ))!;
    expect(r.format).toBe("apple_health");
    expect(r.sourceLabel).toBe("App Saúde (iPhone)");
    expect(r.range).toEqual({ from: "2026-07-15", to: "2026-08-05" });
    // Mais recentes primeiro: é o que a revisão em lote mostra no topo.
    expect(r.events.map((e) => e.day)).toEqual(["2026-08-05", "2026-08-02", "2026-07-15"]);
    expect(appleHealthLabel(r.events)).toBe("1 noite de sono, 1 dia de treino e 1 pesagem");
  });

  it("arquivo sem nada que a gente saiba ler devolve zero eventos, não erro", () => {
    const r = parseAppleHealthXml(wrap(
      ` <Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2026-08-01 10:00:00 -0300" endDate="2026-08-01 10:10:00 -0300" value="1200"/>`,
    ))!;
    expect(r.events).toHaveLength(0);
    expect(r.range).toBeNull();
  });

  it("a versão do parser é própria e estável", () => {
    expect(PARSER_VERSION).toBe("apple-health-xml/1");
  });
});
