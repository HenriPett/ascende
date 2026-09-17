import { describe, it, expect } from "vitest";
import {
  markDensity, leafCount, fruitCount, flowerCount, rootCount,
  legacyLevel, marksToGo, nextMarkAt,
  LEGACY_LEAVES, LEGACY_FRUITS, LEGACY_FLOWERS, LEGACY_ROOTS,
} from "./mokariDensity";

/* ─────────────────────────────────────────────────────────────────
   A QUEIXA QUE ORIGINOU ESTE ARQUIVO

   "É bonito, mas não vi diferença nenhuma nas evoluções. Como se eu
   evoluísse e o Mokari continuasse igual."

   A causa foi medida: a afinidade saturava em 40 registros por pilar
   (~dia 40 de uso regular) e o estágio em 3.000 XP (~dia 112). Passado
   isso, NADA mudava o desenho — nunca mais. Numa simulação de 180 dias, o
   desenho mudava em doze, com um vão de 68 dias sem mudança nenhuma.

   Estes testes travam as três propriedades da correção. A terceira é a
   mais importante: ela é a regra 1 do Mokari ("nunca regride") aplicada à
   própria troca de fórmula.
────────────────────────────────────────────────────────────────── */

describe("1. a curva NÃO SATURA", () => {
  it("para qualquer contagem existe uma maior que desenha mais", () => {
    for (const n of [1, 40, 100, 1_000, 10_000, 100_000]) {
      expect(markDensity(nextMarkAt(n))).toBeGreaterThan(markDensity(n));
    }
  });

  it("o veterano de três anos continua crescendo", () => {
    // O caso que o modelo antigo não tinha: no dia 1.095, com 2 registros
    // por dia num pilar, ainda falta pouco para a próxima marca.
    const tresAnos = 2 * 1095;
    expect(markDensity(tresAnos + 400)).toBeGreaterThan(markDensity(tresAnos));
  });

  it("nunca devolve infinito nem NaN, por pior que seja a entrada", () => {
    for (const lixo of [NaN, Infinity, -Infinity, -5, 0]) {
      const d = markDensity(lixo as number);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("2. a curva DESACELERA — sem virar matagal", () => {
  it("é monótona: registrar nunca tira uma marca", () => {
    let anterior = 0;
    for (let n = 0; n <= 5000; n++) {
      const d = markDensity(n);
      expect(d).toBeGreaterThanOrEqual(anterior);
      anterior = d;
    }
  });

  it("o ganho por registro cai — o começo é generoso, o fim não explode", () => {
    const ganho = (de: number, ate: number) => (markDensity(ate) - markDensity(de)) / (ate - de);
    expect(ganho(1, 50)).toBeGreaterThan(ganho(50, 500));
    expect(ganho(50, 500)).toBeGreaterThan(ganho(500, 5000));
  });

  it("dez anos de uso pesado ainda cabem numa árvore, não num borrão", () => {
    // 6 registros/dia no MESMO pilar por 10 anos. O encolhimento da marca
    // distante (markScale) é quem segura a legibilidade daqui para cima.
    expect(markDensity(6 * 365 * 10)).toBeLessThan(90);
  });
});

describe("3. NUNCA DÁ MENOS QUE A TABELA ANTIGA — a regra 1 sobrevive à troca de fórmula", () => {
  /* Esta é a prova que substitui guardar o estado anterior de cada pessoa.
     Se a curva nova é >= a antiga em TODA contagem, então ninguém pode ver
     o Mokari diminuir por causa da migração — não porque gravamos o que
     ele era, mas porque diminuir é impossível. */
  it("folha, fruto, flor e raiz: nenhuma regressão em 20 mil contagens", () => {
    const falhas: string[] = [];
    for (let n = 0; n <= 20_000; n++) {
      const lv = legacyLevel(n);
      if (leafCount(n) < LEGACY_LEAVES[lv]) falhas.push(`folha n=${n}`);
      if (fruitCount(n) < LEGACY_FRUITS[lv]) falhas.push(`fruto n=${n}`);
      if (flowerCount(n) < LEGACY_FLOWERS[lv]) falhas.push(`flor n=${n}`);
      if (rootCount(n) < LEGACY_ROOTS[lv]) falhas.push(`raiz n=${n}`);
    }
    expect(falhas.slice(0, 5)).toEqual([]);
  });

  it("nas bordas exatas dos degraus antigos, que é onde dói", () => {
    for (const n of [0, 1, 9, 10, 39, 40, 41]) {
      const lv = legacyLevel(n);
      expect(leafCount(n), `folha em ${n}`).toBeGreaterThanOrEqual(LEGACY_LEAVES[lv]);
      expect(fruitCount(n), `fruto em ${n}`).toBeGreaterThanOrEqual(LEGACY_FRUITS[lv]);
      expect(flowerCount(n), `flor em ${n}`).toBeGreaterThanOrEqual(LEGACY_FLOWERS[lv]);
      expect(rootCount(n), `raiz em ${n}`).toBeGreaterThanOrEqual(LEGACY_ROOTS[lv]);
    }
  });

  it("zero continua sendo zero: a gema é outra peça", () => {
    // Afinidade 0 tem desenho próprio ("ainda não", nunca "faltou"). Se a
    // densidade desenhasse algo em zero, a gema perderia o sentido.
    expect(leafCount(0)).toBe(0);
    expect(fruitCount(0)).toBe(0);
    expect(flowerCount(0)).toBe(0);
    expect(rootCount(0)).toBe(0);
  });
});

describe("quanto falta — a distância que a tela mostra", () => {
  it("é sempre pelo menos 1, e leva mesmo à próxima marca", () => {
    for (const n of [0, 1, 7, 40, 250, 3000]) {
      const faltam = marksToGo(n);
      expect(faltam).toBeGreaterThanOrEqual(1);
      expect(markDensity(n + faltam)).toBeGreaterThan(markDensity(n));
      // E nem um a menos: a frase não pode prometer antes da hora.
      expect(markDensity(n + faltam - 1)).toBe(markDensity(n));
    }
  });

  it("no começo a próxima marca está perto — é quando a pessoa mais duvida", () => {
    expect(marksToGo(1)).toBeLessThanOrEqual(3);
    expect(marksToGo(5)).toBeLessThanOrEqual(5);
  });
});
