// ASCENDE — Testes da calibração do fechamento do mês (achado #20).
//
// `buildCalibration` não tinha teste nenhum, e a regra que ela aplica decide
// se o "sobra para viver" da pessoa fica honesto ou pessimista por um mês
// inteiro. O cenário que motivou a correção está no primeiro `it`: estimativa
// de R$ 500 em Lazer, gasto real R$ 0, e a única tela que existe para
// perguntar "sua estimativa bateu?" não perguntava nada.
import { describe, it, expect } from "vitest";
import { buildCalibration, type CategoryEstimate } from "@/lib/prosperidade";

const est = (category: string, amount: number): CategoryEstimate =>
  ({ id: `e-${category}`, category, amount });

describe("buildCalibration · gasto real zero (achado #20)", () => {
  it("o cenário da nota: R$ 500 estimados, R$ 0 gastos, sugere ZERAR", () => {
    const rows = buildCalibration({}, [est("Lazer", 500)]);
    expect(rows).toEqual([
      { category: "Lazer", estimated: 500, real: 0, suggestion: 0 },
    ]);
  });

  it("categoria ausente do mapa e categoria com 0 explícito são o mesmo caso", () => {
    const ausente = buildCalibration({}, [est("Lazer", 500)]);
    const explicito = buildCalibration({ Lazer: 0 }, [est("Lazer", 500)]);
    expect(explicito).toEqual(ausente);
  });

  it("estimativa pequena esquecida NÃO gera linha (piso absoluto de R$ 30)", () => {
    expect(buildCalibration({}, [est("Lazer", 5)])).toEqual([]);
    expect(buildCalibration({}, [est("Lazer", 29.99)])).toEqual([]);
    expect(buildCalibration({}, [est("Lazer", 30)])).toHaveLength(1);
  });

  it("respeita um piso customizado", () => {
    expect(buildCalibration({}, [est("Lazer", 100)], 200)).toEqual([]);
    expect(buildCalibration({}, [est("Lazer", 300)], 200)).toHaveLength(1);
  });

  it("gasto real negativo (dado sujo) é tratado como zero, não some", () => {
    const rows = buildCalibration({ Lazer: -50 }, [est("Lazer", 500)]);
    expect(rows).toEqual([{ category: "Lazer", estimated: 500, real: 0, suggestion: 0 }]);
  });

  it("a maior distorção aparece primeiro, misturando zero e não-zero", () => {
    const rows = buildCalibration(
      { Mercado: 900, Transporte: 0, Lazer: 0 },
      [est("Mercado", 500), est("Transporte", 200), est("Lazer", 600)],
    );
    expect(rows.map((r) => r.category)).toEqual(["Lazer", "Mercado", "Transporte"]);
  });
});

describe("buildCalibration · comportamento que já existia (não pode mudar)", () => {
  it("sugere o real arredondado a R$ 10 quando houve gasto", () => {
    const rows = buildCalibration({ Mercado: 913 }, [est("Mercado", 500)]);
    expect(rows).toEqual([
      { category: "Mercado", estimated: 500, real: 913, suggestion: 910 },
    ]);
  });

  it("diferença pequena em valor absoluto não vira cobrança", () => {
    expect(buildCalibration({ Mercado: 520 }, [est("Mercado", 500)])).toEqual([]);
  });

  it("diferença grande em valor mas pequena em proporção também não", () => {
    // R$ 200 de diferença sobre R$ 2.000 estimados = 10%, abaixo dos 15%.
    expect(buildCalibration({ Mercado: 2200 }, [est("Mercado", 2000)])).toEqual([]);
  });

  it("gasto acima da estimativa entra igual (a calibração vale nos dois sentidos)", () => {
    const rows = buildCalibration({ Lazer: 400 }, [est("Lazer", 100)]);
    expect(rows[0]).toMatchObject({ estimated: 100, real: 400, suggestion: 400 });
  });

  it("a sugestão nunca desce abaixo de R$ 10 quando houve gasto real", () => {
    const rows = buildCalibration({ Lazer: 3 }, [est("Lazer", 100)]);
    expect(rows[0].suggestion).toBe(10);
  });

  it("categoria gasta sem estimativa declarada não entra", () => {
    expect(buildCalibration({ Saude: 800 }, [])).toEqual([]);
  });

  it("sem estimativa nenhuma, nada a calibrar", () => {
    expect(buildCalibration({ Mercado: 900 }, [])).toEqual([]);
  });
});
