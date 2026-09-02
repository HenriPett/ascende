// ASCENDE — Testes da contagem de dias no fuso do app (achado #8).
//
// Os cenários abaixo são os da nota `achados-compass`, com as entradas
// concretas que estavam escritas lá. O que eles protegem não é a função em si:
// é o fato de `slice(0, 10)` sobre um timestamptz COLAPSAR dias vizinhos e
// derrubar os indicadores de quem registra à noite.
import { describe, it, expect } from "vitest";
import { localDay, distinctLocalDays } from "@/lib/localDays";

describe("localDay", () => {
  it("usa o dia de São Paulo, não o dia UTC do carimbo", () => {
    // 22:00 de 13/08 em SP = 01:00 de 14/08 em UTC.
    expect(localDay("2026-08-14T01:00:00Z")).toBe("2026-08-13");
  });

  it("respeita o offset quando ele vem no carimbo", () => {
    expect(localDay("2026-08-13T22:00:00-03:00")).toBe("2026-08-13");
  });

  it("é idêntico ao corte ingênuo no meio do dia (onde o bug não aparece)", () => {
    expect(localDay("2026-08-13T15:00:00Z")).toBe("2026-08-13");
  });

  it("carimbo ilegível não vira dia inventado", () => {
    expect(localDay("nem data")).toBeNull();
    expect(localDay("")).toBeNull();
    expect(localDay(null)).toBeNull();
    expect(localDay(undefined)).toBeNull();
  });
});

describe("distinctLocalDays", () => {
  it("o cenário da nota: jantar 22h + almoço do dia seguinte são DOIS dias", () => {
    // Era exatamente aqui que o `slice(0, 10)` colapsava: os dois carimbos
    // caem em "2026-08-14" em UTC, e a contagem devolvia 1.
    const jantarTerca = "2026-08-14T01:00:00Z";   // 13/08 22:00 em SP
    const almocoQuarta = "2026-08-14T15:00:00Z";  // 14/08 12:00 em SP
    expect(distinctLocalDays([jantarTerca, almocoQuarta])).toBe(2);
    // A contagem antiga, para deixar o contraste no teste:
    expect(new Set([jantarTerca, almocoQuarta].map((s) => s.slice(0, 10))).size).toBe(1);
  });

  it("14 dias do padrão alternado contam 14, e o corte ingênuo dava 7", () => {
    /* O número da nota ("~7 dias em vez de 14, score 50 em vez de 100") vem
       deste padrão: UMA refeição por dia, alternando jantar tarde e almoço no
       dia seguinte. É o par do teste acima repetido sete vezes.

       Precisão que vale registrar, porque eu mesmo fui impreciso na nota ao
       dizer "quem janta tarde": jantar tarde TODOS os dias apenas DESLOCA a
       contagem (14 dias viram 14 dias, um dia à frente) — ver o teste
       seguinte. O que divide por dois é a alternância, porque é ela que faz
       dois dias vividos caírem no mesmo dia UTC. */
    const isos: string[] = [];
    for (let k = 0; k < 7; k++) {
      const utc = String(2 + 2 * k).padStart(2, "0");
      isos.push(`2026-08-${utc}T01:00:00Z`);  // jantar 22h SP do dia anterior
      isos.push(`2026-08-${utc}T15:00:00Z`);  // almoço 12h SP deste dia
    }
    expect(distinctLocalDays(isos)).toBe(14);
    expect(new Set(isos.map((s) => s.slice(0, 10))).size).toBe(7);
  });

  it("jantar tarde todos os dias DESLOCA a contagem, e o dia certo é o de SP", () => {
    // 14 jantares às 22h de 01/08 a 14/08. O total não muda; o intervalo, sim.
    const isos = Array.from({ length: 14 }, (_, i) =>
      `2026-08-${String(i + 2).padStart(2, "0")}T01:00:00Z`);
    expect(distinctLocalDays(isos)).toBe(14);
    expect(localDay(isos[0])).toBe("2026-08-01");   // e não "2026-08-02"
    expect(localDay(isos[13])).toBe("2026-08-14");  // e não "2026-08-15"
  });

  it("o mesmo dia registrado várias vezes conta uma vez", () => {
    expect(distinctLocalDays([
      "2026-08-13T12:00:00Z", "2026-08-13T18:00:00Z", "2026-08-13T21:00:00Z",
    ])).toBe(1);
  });

  it("lista vazia é zero dia, não erro", () => {
    expect(distinctLocalDays([])).toBe(0);
  });

  it("carimbo ilegível não engorda a contagem", () => {
    expect(distinctLocalDays(["2026-08-13T15:00:00Z", "lixo", null, undefined])).toBe(1);
  });

  it("virada de mês e de ano ficam no dia certo de SP", () => {
    // 01/09 00:30 UTC = 31/08 21:30 em SP: o registro pertence a AGOSTO.
    expect(localDay("2026-09-01T00:30:00Z")).toBe("2026-08-31");
    expect(localDay("2027-01-01T02:00:00Z")).toBe("2026-12-31");
  });
});
