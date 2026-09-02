// ASCENDE — A regra 2 ("nunca pune") provada na GEOMETRIA.
//
// O cálculo do Forge garante que nenhum ESTADO é negativo. Este arquivo cuida
// do outro lado, que nenhum teste de cálculo alcança: a regra pode morrer no
// DESENHO mesmo com o código impecável. Uma folha girada 20° para baixo lê
// como murchar, e murchar é exatamente a punição que a regra proíbe — a pessoa
// não lê o enum, lê a imagem.
import { describe, it, expect } from "vitest";
import { MOKARI_STATES, type MokariStage, type PillarAffinity } from "@/lib/mokari";
import {
  STAGE_ANCHORS, STATE_STYLE, capacity, leafSlotsFor, fruitSlotsFor,
  flowerSlotsFor, leafTip, leafAngle, leafSide, AXIS_X,
  shouldShowBuds, budSlot, BUD_STROKE,
} from "@/lib/mokariLayers";

const STAGES: MokariStage[] = [1, 2, 3, 4];

describe("regra 2 — nenhum estado pode fazer o Mokari murchar", () => {
  it("a ponta da folha NUNCA desce, em nenhum estado, de nenhum lado", () => {
    for (const state of MOKARI_STATES) {
      const { leafTowardStem, label } = STATE_STYLE[state];
      for (const stage of STAGES) {
        for (const slot of STAGE_ANCHORS[stage].leafSlots) {
          const tip = leafTip(slot, leafTowardStem);
          expect(
            tip.y,
            `estado "${label}", estágio ${stage}, folha em (${slot.x},${slot.y}): ponta desceu`,
          ).toBeLessThanOrEqual(slot.y);
        }
      }
    }
  });

  it("recolher aproxima a folha do caule, dos dois lados", () => {
    const direita = { x: AXIS_X + 20, y: 60 };
    const esquerda = { x: AXIS_X - 20, y: 60 };
    expect(leafSide(direita)).toBe(1);
    expect(leafSide(esquerda)).toBe(-1);

    // "em descanso" recolhe: a ponta fica MAIS ALTA que em repouso, nunca
    // mais baixa, e mais perto do eixo na horizontal.
    const repouso = STATE_STYLE.atento.leafTowardStem;
    const descanso = STATE_STYLE.descanso.leafTowardStem;
    for (const slot of [direita, esquerda]) {
      const a = leafTip(slot, repouso);
      const b = leafTip(slot, descanso);
      expect(b.y).toBeLessThan(a.y);
      expect(Math.abs(b.x - AXIS_X)).toBeLessThan(Math.abs(a.x - AXIS_X));
    }
  });

  it("nenhum estado apaga o desenho: todos têm brilho", () => {
    for (const state of MOKARI_STATES) {
      expect(STATE_STYLE[state].glow, `estado ${state} sem luz`).toBeGreaterThan(0);
    }
  });

  it("nenhum estado tem como ESMAECER o que a pessoa construiu", () => {
    /* A trava é semântica, não a lista de chaves: o Prisma acrescentou
       `markOpacityBonus` (+0.10 no estado "curioso") e a versão anterior deste
       teste teria reprovado uma mudança correta.
       O que importa é a direção: opacidade de marca de pilar só SOMA. Nenhum
       campo pode existir para baixá-la, e nenhum valor pode ser negativo. */
    for (const state of MOKARI_STATES) {
      const style = STATE_STYLE[state];
      expect(style.markOpacityBonus, `${state} esmaece as marcas`).toBeGreaterThanOrEqual(0);
      expect(Object.keys(style)).not.toContain("leafOpacity");
      expect(Object.keys(style)).not.toContain("markOpacity");
      // A copa pode abrir, nunca encolher.
      expect(style.canopyScaleX, `${state} encolhe a copa`).toBeGreaterThanOrEqual(1);
    }
  });

  it("o ângulo da folha nunca cai na metade de baixo do círculo", () => {
    // Em SVG o y cresce para baixo: seno positivo = apontando para baixo.
    for (const state of MOKARI_STATES) {
      for (const stage of STAGES) {
        for (const slot of STAGE_ANCHORS[stage].leafSlots) {
          const rad = (leafAngle(slot, STATE_STYLE[state].leafTowardStem) * Math.PI) / 180;
          expect(Math.sin(rad)).toBeLessThanOrEqual(0.001);
        }
      }
    }
  });
});

describe("capacidade — o corpo carrega o que cabe nele", () => {
  it("nível 3 num Broto mostra 3 folhas, não 9", () => {
    expect(leafSlotsFor(1, 3)).toHaveLength(3);
    expect(leafSlotsFor(2, 3)).toHaveLength(6);
    expect(leafSlotsFor(3, 3)).toHaveLength(9);
    expect(leafSlotsFor(4, 3)).toHaveLength(9);
  });

  it("nunca pede mais marcas do que o estágio tem âncoras", () => {
    for (const stage of STAGES) {
      for (const level of [0, 1, 2, 3] as PillarAffinity[]) {
        expect(leafSlotsFor(stage, level).length)
          .toBeLessThanOrEqual(STAGE_ANCHORS[stage].leafSlots.length);
        expect(fruitSlotsFor(stage, level).length)
          .toBeLessThanOrEqual(STAGE_ANCHORS[stage].fruitSlots.length);
      }
    }
  });

  it("nível 0 não desenha nada", () => {
    for (const stage of STAGES) {
      expect(leafSlotsFor(stage, 0)).toEqual([]);
      expect(fruitSlotsFor(stage, 0)).toEqual([]);
      expect(flowerSlotsFor(stage, 0)).toEqual([]);
    }
  });

  it("capacity nunca devolve negativo", () => {
    expect(capacity(-5, [])).toBe(0);
    expect(capacity(3, [])).toBe(0);
  });
});

describe("os estágios crescem em capacidade", () => {
  it("mais folhas e mais frutos a cada estágio", () => {
    const folhas = STAGES.map((s) => STAGE_ANCHORS[s].leafSlots.length);
    const frutos = STAGES.map((s) => STAGE_ANCHORS[s].fruitSlots.length);
    expect(folhas).toEqual([3, 6, 9, 12]);
    expect(frutos).toEqual([1, 3, 6, 8]);
    for (let i = 1; i < folhas.length; i++) {
      expect(folhas[i]).toBeGreaterThan(folhas[i - 1]);
      expect(frutos[i]).toBeGreaterThan(frutos[i - 1]);
    }
  });

  it("a aura cresce e a ponta sobe junto com o estágio", () => {
    for (let i = 1; i < STAGES.length; i++) {
      const antes = STAGE_ANCHORS[STAGES[i - 1]];
      const agora = STAGE_ANCHORS[STAGES[i]];
      expect(agora.auraRadius).toBeGreaterThan(antes.auraRadius);
      expect(agora.tipPoint.y).toBeLessThan(antes.tipPoint.y);
    }
  });
});

describe("as flores não empilham sobre as folhas", () => {
  it("usam só slots de índice ímpar", () => {
    for (const stage of STAGES) {
      const impares = STAGE_ANCHORS[stage].leafSlots.filter((_, i) => i % 2 === 1);
      for (const flor of flowerSlotsFor(stage, 3)) {
        expect(impares).toContainEqual(flor);
      }
    }
  });
});

describe("idempotência da geometria", () => {
  it("a mesma entrada devolve a mesma coisa (nada de relógio nem aleatório)", () => {
    for (const stage of STAGES) {
      expect(leafSlotsFor(stage, 2)).toEqual(leafSlotsFor(stage, 2));
      expect(leafTip({ x: 130, y: 60 }, 20)).toEqual(leafTip({ x: 130, y: 60 }, 20));
    }
  });
});

describe("a gema (afinidade 0) é \"ainda não\", nunca \"faltou\"", () => {
  it("não aparece quando NENHUM pilar começou", () => {
    // Quatro gemas cinzentas num broto leem como quatro caixinhas vazias para
    // preencher. Com tudo em zero, o broto sozinho já diz "começando".
    expect(shouldShowBuds({
      prosperidade: 0, vitalidade: 0, alimentacao: 0, mente: 0,
    })).toBe(false);
  });

  it("aparece assim que ALGUM outro pilar tem marca", () => {
    expect(shouldShowBuds({
      prosperidade: 1, vitalidade: 0, alimentacao: 0, mente: 0,
    })).toBe(true);
  });

  it("a cor é neutra, jamais a do pilar", () => {
    // Se a gema já viesse colorida, começar a registrar não mudaria nada.
    expect(BUD_STROKE).toContain("--muted-foreground");
    for (const v of ["--prosperidade", "--vitalidade", "--alimentacao", "--mente"]) {
      expect(BUD_STROKE).not.toContain(v);
    }
  });

  it("nasce numa âncora real de cada estágio", () => {
    for (const stage of STAGES) {
      for (const pillar of ["prosperidade", "vitalidade", "alimentacao", "mente"] as const) {
        const slot = budSlot(pillar, stage);
        expect(Number.isFinite(slot.x) && Number.isFinite(slot.y)).toBe(true);
      }
    }
  });
});
