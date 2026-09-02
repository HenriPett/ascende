import { describe, it, expect } from "vitest";
import { computeBattleStats, isFoodBattle, type BattleCheckin, type CheckinStatus } from "./battles";

/* ASCENDE — a regra que este arquivo existe para TRAVAR.
 *
 * /recusas e a landing prometem, em público: "Nunca usaremos sequência que
 * pune sua semana ruim." Até esta rodada a Batalha quebrava a sequência em
 * qualquer dia sem check-in — ausência e recaída davam no mesmo. A promessa
 * era, portanto, falsa justamente no pilar mais sensível do app.
 *
 * Quem for "simplificar" computeBattleStats de volta para um número só vai
 * reprovar aqui, e é para isso que estes testes existem. */

const dia = (iso: string, status: CheckinStatus): BattleCheckin => ({
  id: iso, battle_id: "b1", checkin_date: iso, status, trigger_label: null, note: null,
});

/** Data fixa em todos os testes: nenhum resultado pode depender do relógio. */
const HOJE = new Date("2026-09-20T00:00:00");
/** ISO de N dias antes de HOJE. */
const atras = (n: number) => {
  const d = new Date(HOJE);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

describe("ausência NUNCA é recaída", () => {
  it("dez dias limpos seguidos de cinco dias de silêncio continuam contando desde o início", () => {
    // Check-ins do dia 20 ao dia 11 atrás; nada nos últimos cinco dias.
    const checkins = [10, 9, 8, 7, 6].map((n) => dia(atras(n), "clean"));
    const s = computeBattleStats(checkins, HOJE);

    // A métrica principal ignora o silêncio: conta desde o primeiro check-in.
    expect(s.daysSinceRelapse).toBe(10);
    expect(s.cleanSince).toBe("start");
    // E a tela consegue ser honesta sobre o que não sabe.
    expect(s.checkinGapDays).toBe(6);
  });

  it("o marco NÃO volta ao começo por causa de silêncio (era o bug)", () => {
    // 40 dias desde o primeiro check-in, mas o último foi há 5 dias.
    const checkins = [40, 39, 38, 6].map((n) => dia(atras(n), "clean"));
    const s = computeBattleStats(checkins, HOJE);

    expect(s.daysSinceRelapse).toBe(40);
    // Com a regra antiga o próximo marco seria 3 (currentStreak zerado).
    expect(s.nextMilestone).toBe(90);
    // A sequência de check-ins realmente quebrou — e continua dizendo a verdade.
    expect(s.currentStreak).toBe(0);
  });

  it("só a recaída reinicia a contagem principal", () => {
    const checkins = [
      dia(atras(30), "clean"),
      dia(atras(20), "relapsed"),
      dia(atras(19), "clean"),
      dia(atras(1), "clean"),
    ];
    const s = computeBattleStats(checkins, HOJE);

    expect(s.daysSinceRelapse).toBe(20);
    expect(s.cleanSince).toBe("relapse");
    expect(s.nextMilestone).toBe(30);
  });

  it("quem nunca recaiu não recebe uma frase que afirma uma recaída", () => {
    const s = computeBattleStats([dia(atras(3), "clean")], HOJE);
    expect(s.cleanSince).toBe("start");
    expect(s.daysSinceRelapse).toBe(3);
  });

  it("batalha sem nenhum check-in não inventa número", () => {
    const s = computeBattleStats([], HOJE);
    expect(s.daysSinceRelapse).toBeNull();
    expect(s.cleanSince).toBeNull();
    expect(s.checkinGapDays).toBe(0);
    expect(s.nextMilestone).toBe(3);
  });

  it("relógio adiantado não produz dias negativos na tela", () => {
    // Check-in com data no futuro (aparelho com a data errada).
    const futuro = new Date(HOJE);
    futuro.setDate(futuro.getDate() + 2);
    const s = computeBattleStats([dia(futuro.toISOString().slice(0, 10), "clean")], HOJE);
    expect(s.daysSinceRelapse).toBe(0);
    expect(s.checkinGapDays).toBe(0);
  });
});

describe("o que já era verdade e continua", () => {
  it("dias limpos acumulados nunca diminuem por causa de uma recaída", () => {
    const checkins = [
      dia(atras(5), "clean"),
      dia(atras(4), "resisted"),
      dia(atras(3), "relapsed"),
      dia(atras(2), "clean"),
    ];
    const s = computeBattleStats(checkins, HOJE);
    // 3 dos 4 não foram recaída — o acumulado conta todos eles.
    expect(s.totalClean).toBe(3);
    expect(s.relapses).toBe(1);
    expect(s.resisted).toBe(1);
  });

  it("o recorde guarda a melhor corrida mesmo depois de uma recaída", () => {
    const checkins = [
      ...[10, 9, 8, 7].map((n) => dia(atras(n), "clean")),
      dia(atras(6), "relapsed"),
      dia(atras(5), "clean"),
    ];
    const s = computeBattleStats(checkins, HOJE);
    expect(s.record).toBeGreaterThanOrEqual(4);
  });

  it("o app continua recusando transformar comida em batalha", () => {
    expect(isFoodBattle("comer besteira")).toBe(true);
    expect(isFoodBattle("açúcar")).toBe(true);
    expect(isFoodBattle("Apostas")).toBe(false);
  });
});
