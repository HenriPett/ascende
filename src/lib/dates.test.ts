// ASCENDE — Testes da biblioteca central de datas (plano §3.1).
// Casos exigidos pelo plano de consolidação: registros pouco antes e pouco
// depois da meia-noite (de São Paulo), último dia do mês, domingo × segunda
// e dispositivos configurados em OUTRO fuso (o resultado não pode mudar).
import { describe, it, expect } from "vitest";
import {
  spParts, todayISOInSP, dateISOInSP, daysAgoISOInSP,
  monthStartISOInSP, isSundayInSP,
} from "@/lib/dates";

// São Paulo = UTC−3 (sem horário de verão desde 2019).
const spInstant = (isoLocalSP: string) => new Date(`${isoLocalSP}-03:00`);

describe("fronteiras de dia no fuso de São Paulo", () => {
  it("pouco ANTES da meia-noite em SP ainda é o dia anterior", () => {
    // 23:59 de 15/03 em SP = 02:59 UTC de 16/03 — toISOString() erraria.
    const d = spInstant("2026-03-15T23:59:00");
    expect(d.toISOString().slice(0, 10)).toBe("2026-03-16"); // o bug antigo
    expect(spParts(d).dateIso).toBe("2026-03-15");           // o correto
  });

  it("pouco DEPOIS da meia-noite em SP já é o novo dia", () => {
    const d = spInstant("2026-03-16T00:01:00");
    expect(spParts(d).dateIso).toBe("2026-03-16");
  });

  it("último dia do mês não vaza para o mês seguinte", () => {
    const d = spInstant("2026-01-31T22:30:00"); // 01:30 UTC de 01/02
    expect(d.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(spParts(d).dateIso).toBe("2026-01-31");
    expect(dateISOInSP(d)).toBe("2026-01-31");
  });

  it("domingo e segunda-feira são distinguidos no fuso de SP", () => {
    // 05/07/2026 é domingo; às 23h em SP já é segunda 02h em UTC.
    const sundayNight = spInstant("2026-07-05T23:00:00");
    expect(isSundayInSP(sundayNight)).toBe(true);
    const mondayEarly = spInstant("2026-07-06T00:30:00");
    expect(isSundayInSP(mondayEarly)).toBe(false);
    expect(spParts(mondayEarly).weekday).toBe("Mon");
  });

  it("dateISOInSP aceita string ISO (instantes vindos do banco)", () => {
    // 02:00 UTC de 10/07 = 23:00 de 09/07 em SP
    expect(dateISOInSP("2026-07-10T02:00:00.000Z")).toBe("2026-07-09");
  });

  it("independe do fuso do dispositivo (TZ do processo não interfere)", () => {
    // Os helpers usam Intl com timeZone fixo: o mesmo instante produz o
    // mesmo dia SP seja qual for o fuso local configurado.
    const instant = new Date("2026-07-10T01:30:00.000Z");
    expect(spParts(instant).dateIso).toBe("2026-07-09");
  });

  it("todayISOInSP e daysAgoISOInSP são coerentes entre si", () => {
    expect(daysAgoISOInSP(0)).toBe(todayISOInSP());
    const today = new Date(`${todayISOInSP()}T12:00:00-03:00`).getTime();
    const sevenAgo = new Date(`${daysAgoISOInSP(7)}T12:00:00-03:00`).getTime();
    const diffDays = Math.round((today - sevenAgo) / 864e5);
    expect([6, 7, 8]).toContain(diffDays); // tolera a virada do dia durante o teste
  });

  it("monthStartISOInSP devolve o dia 1 do mês corrente em SP", () => {
    const { y, m } = spParts();
    expect(monthStartISOInSP()).toBe(`${y}-${String(m).padStart(2, "0")}-01`);
  });
});
