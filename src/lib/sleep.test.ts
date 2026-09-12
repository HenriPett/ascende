// ASCENDE — A rotina de sono e O DIA DE UM REGISTRO DE SONO.
//
// A segunda parte é a que protege um bug de produção: o registro existia e a
// interface dizia que não. A regra ("o dia de um sono é o dia em que a pessoa
// ACORDOU") está escrita por extenso em sleep.ts; aqui ela é executada.
import { describe, it, expect } from "vitest";
import {
  sleepWindowHours, sleepWakeDay, SLEEP_MORNING_UNTIL_H, parseTimeToMinutes,
} from "@/lib/sleep";

describe("sleepWindowHours", () => {
  it("trata a virada da meia-noite", () => {
    expect(sleepWindowHours("23:00", "06:30")).toBe(7.5);
    expect(sleepWindowHours("01:00", "09:00")).toBe(8);
  });

  it("horários iguais ou inválidos não viram duração", () => {
    expect(sleepWindowHours("23:00", "23:00")).toBeNull();
    expect(sleepWindowHours(null, "06:30")).toBeNull();
    expect(parseTimeToMinutes("25:00")).toBeNull();
  });
});

describe("sleepWakeDay · a noite atravessa a virada", () => {
  const HOJE = "2026-09-12";
  const ONTEM = "2026-09-11";

  it("de manhã, a noite chamada de 'ontem' é a que acabou agora: hoje", () => {
    // É o caso do relato real: às 7h da manhã, "ontem dormi 6h" nomeia a
    // noite pelo dia em que a pessoa foi DEITAR. Ela acordou hoje.
    for (const h of [0, 6, 7, 11]) {
      expect(sleepWakeDay(ONTEM, HOJE, h), `${h}h`).toBe(HOJE);
    }
  });

  it("a partir do meio-dia, 'ontem' é ontem", () => {
    // Aqui as duas leituras deixam de colapsar: "ontem dormi mal" pode ser a
    // noite retrasada. Mexer na data seria trocar um chute por outro.
    for (const h of [SLEEP_MORNING_UNTIL_H, 13, 20, 23]) {
      expect(sleepWakeDay(ONTEM, HOJE, h), `${h}h`).toBe(ONTEM);
    }
  });

  it("só 'ontem' se move — hoje e anteontem ficam onde estão", () => {
    expect(sleepWakeDay(HOJE, HOJE, 7)).toBe(HOJE);
    expect(sleepWakeDay("2026-09-10", HOJE, 7)).toBe("2026-09-10");
    expect(sleepWakeDay("2026-08-12", HOJE, 7)).toBe("2026-08-12");
  });

  it("a fronteira do meio-dia é exatamente a do convite matinal", () => {
    // SleepCheckin some às 12h em SP (`hourInSP() < 12`). Se as duas
    // fronteiras andarem separadas, volta a existir uma hora do dia em que a
    // tela pergunta por uma noite que a gravação mandou para outro dia.
    expect(SLEEP_MORNING_UNTIL_H).toBe(12);
    expect(sleepWakeDay(ONTEM, HOJE, SLEEP_MORNING_UNTIL_H - 1)).toBe(HOJE);
    expect(sleepWakeDay(ONTEM, HOJE, SLEEP_MORNING_UNTIL_H)).toBe(ONTEM);
  });

  it("atravessa mês, ano e 29 de fevereiro sem escorregar", () => {
    expect(sleepWakeDay("2026-08-31", "2026-09-01", 6)).toBe("2026-09-01");
    expect(sleepWakeDay("2025-12-31", "2026-01-01", 6)).toBe("2026-01-01");
    expect(sleepWakeDay("2024-02-29", "2024-03-01", 6)).toBe("2024-03-01");
    expect(sleepWakeDay("2026-02-28", "2026-03-01", 6)).toBe("2026-03-01");
  });
});
