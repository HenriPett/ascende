// ASCENDE — Geometria das camadas do Mokari (puro, testável, sem React).
//
// 26 peças cobrem 4 × 3⁴ × 5 × 5 = 8.100 combinações porque nada é desenhado
// para uma combinação: as marcas de pilar se posicionam por ÂNCORAS que a peça
// de corpo publica. Trocar o estágio move tudo junto, sem uma coordenada
// sequer escrita duas vezes.
//
// A geometria mora aqui, e não no componente, por um motivo que vale mais que
// organização: assim a REGRA 2 ("nunca pune") deixa de ser cuidado visual e
// passa a ser propriedade verificável. O teste prova que nenhum estado aponta
// folha para baixo nem apaga o desenho — ver mokariLayers.test.ts.

import type { MokariStage, MokariState, PillarAffinity } from "@/lib/mokari";
import type { PillarId } from "@/lib/pillars";

export interface Point { x: number; y: number }

/** Referenciais fixos do viewBox 0 0 240 150. */
export const VIEWBOX = "0 0 240 150";
export const GROUND_Y = 120;
export const AXIS_X = 120;

/** Pontos que uma peça de CORPO publica para as marcas de pilar usarem. */
export interface StageAnchors {
  /** Ordenados: o nível N usa os N primeiros (limitado pela capacidade). */
  leafSlots: Point[];
  fruitSlots: Point[];
  rootOrigin: Point;
  auraCenter: Point;
  auraRadius: number;
  /** Origem das partículas do estado. */
  tipPoint: Point;
  /** Inclinação própria do estágio, em graus. */
  lean: number;
}

const p = (x: number, y: number): Point => ({ x, y });

/** Pontos na borda de uma elipse, no sentido horário a partir de `fromDeg`. */
function onEllipse(cx: number, cy: number, rx: number, ry: number, n: number, fromDeg = 180): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = ((fromDeg + (360 / n) * i) * Math.PI) / 180;
    return p(
      Math.round((cx + rx * Math.cos(a)) * 10) / 10,
      Math.round((cy + ry * Math.sin(a)) * 10) / 10,
    );
  });
}

export const STAGE_ANCHORS: Record<MokariStage, StageAnchors> = {
  1: {
    leafSlots: [p(110, 88), p(130, 88), p(120, 84)],
    fruitSlots: [p(116, 98)],
    rootOrigin: p(120, 120), auraCenter: p(120, 96), auraRadius: 20,
    tipPoint: p(120, 86), lean: 0,
  },
  2: {
    leafSlots: [p(104, 62), p(136, 64), p(120, 74), p(112, 72), p(128, 74), p(120, 60)],
    fruitSlots: [p(114, 88), p(126, 86), p(120, 78)],
    rootOrigin: p(120, 120), auraCenter: p(120, 74), auraRadius: 28,
    tipPoint: p(120, 58), lean: 0,
  },
  3: {
    leafSlots: onEllipse(114, 50, 32, 21, 9),
    fruitSlots: [p(100, 62), p(122, 58), p(140, 56), p(112, 48), p(132, 40), p(96, 48)],
    rootOrigin: p(120, 120), auraCenter: p(120, 50), auraRadius: 40,
    tipPoint: p(120, 28), lean: 0,
  },
  4: {
    leafSlots: onEllipse(120, 44, 36, 24, 12),
    fruitSlots: [
      p(104, 56), p(126, 52), p(142, 50), p(112, 40),
      p(132, 34), p(98, 44), p(120, 24), p(136, 62),
    ],
    rootOrigin: p(120, 120), auraCenter: p(120, 44), auraRadius: 48,
    tipPoint: p(120, 14), lean: -2,
  },
};

/** Quantas marcas cada nível de pilar PEDE. Nível 0 não desenha nada. */
const LEAVES_BY_LEVEL: Record<PillarAffinity, number> = { 0: 0, 1: 2, 2: 5, 3: 9 };
const FRUITS_BY_LEVEL: Record<PillarAffinity, number> = { 0: 0, 1: 1, 2: 3, 3: 6 };
const FLOWERS_BY_LEVEL: Record<PillarAffinity, number> = { 0: 0, 1: 2, 2: 5, 3: 5 };

/**
 * REGRA DE CAPACIDADE: o nível pede N, o estágio limita.
 * Alimentação nível 3 num Broto mostra 3 folhas, não 9 — o corpo carrega o que
 * cabe nele, e cresce junto. É honesto, e é o que impede o desenho de virar
 * colagem de medalhas em cima de um caule de 30px.
 */
export function capacity(asked: number, slots: readonly Point[]): number {
  return Math.max(0, Math.min(asked, slots.length));
}

export const leafSlotsFor = (stage: MokariStage, level: PillarAffinity): Point[] =>
  STAGE_ANCHORS[stage].leafSlots.slice(0, capacity(LEAVES_BY_LEVEL[level], STAGE_ANCHORS[stage].leafSlots));

export const fruitSlotsFor = (stage: MokariStage, level: PillarAffinity): Point[] =>
  STAGE_ANCHORS[stage].fruitSlots.slice(0, capacity(FRUITS_BY_LEVEL[level], STAGE_ANCHORS[stage].fruitSlots));

/** Flores usam os slots de índice ÍMPAR para não empilhar sobre as folhas. */
export function flowerSlotsFor(stage: MokariStage, level: PillarAffinity): Point[] {
  const odd = STAGE_ANCHORS[stage].leafSlots.filter((_, i) => i % 2 === 1);
  return odd.slice(0, capacity(FLOWERS_BY_LEVEL[level], odd));
}

/* ═══ Estados ═════════════════════════════════════════════════════════════
   A única camada que pode DESCER, porque descreve o agora e não o
   conquistado. Nenhum dos cinco é negativo, e todos são distinguíveis SEM
   animação — quem pediu movimento reduzido tem que conseguir ler a diferença.

   Note o que NÃO existe nesta interface: opacidade de folha. É de propósito.
   Sem o campo, nenhum estado tem como apagar o desenho — a regra 2 fica
   impossível de quebrar por descuido, não só proibida. */
export interface StateStyle {
  label: string;
  /** Graus de rotação da folha SEMPRE EM DIREÇÃO AO CAULE. Positivo = mais
   *  recolhida. Nunca vira rotação para baixo: ver leafTip(). */
  leafTowardStem: number;
  /** Inclinação do conjunto, em graus. Negativo = para a luz. */
  lean: number;
  /** Força do brilho (var --mokari-glow). Nenhum estado pode ser 0: um
   *  Mokari sem luz leria como desligado. */
  glow: number;
  /** Multiplicador de auraRadius para o halo. 0 = sem halo. */
  halo: number;
  particles: number;
  /** Abertura horizontal da copa. 1 = neutro. */
  canopyScaleX: number;
  /** Acréscimo de opacidade em TODAS as marcas de pilar. Só soma, nunca
   *  subtrai — o teste trava isso em >= 0, para nenhum estado ter como
   *  esmaecer o que a pessoa construiu. */
  markOpacityBonus: number;
}

export const STATE_STYLE: Record<MokariState, StateStyle> = {
  // 5+ dias ativos na janela de 7.
  movimento: {
    label: "Em movimento", leafTowardStem: -8, lean: 0, glow: 1, halo: 0,
    particles: 3, canopyScaleX: 1, markOpacityBonus: 0,
  },
  /* 3+ PILARES distintos na janela — é AMPLITUDE, não direção. A primeira
     versão inclinava o conjunto "para a luz", o que dizia a coisa errada: o
     cálculo mede largura de vida, não foco. Então a copa ABRE e todas as
     marcas de pilar ganham opacidade: a luz se espalha em vez de concentrar,
     que é o que "você foi largo" parece. */
  curioso: {
    label: "Curioso", leafTowardStem: 0, lean: 0, glow: 0.75, halo: 0,
    particles: 1, canopyScaleX: 1.04, markOpacityBonus: 0.1,
  },
  // 3-4 dias ativos.
  atento: {
    label: "Atento", leafTowardStem: 0, lean: 0, glow: 0.6, halo: 0,
    particles: 0, canopyScaleX: 1, markOpacityBonus: 0,
  },
  // 1-2 dias ativos.
  sereno: {
    label: "Sereno", leafTowardStem: 0, lean: 0, glow: 0.5, halo: 1.4,
    particles: 0, canopyScaleX: 1, markOpacityBonus: 0,
  },
  /* Nenhum registro na janela. TRAVA: "recolhidas" é girada EM DIREÇÃO AO
     CAULE com a ponta PARA CIMA. Nunca para baixo, nunca com opacidade menor,
     nunca cinza. Folha apontando para baixo lê como murchar, e murchar é a
     punição que a regra 2 proíbe — a regra morreria no desenho mesmo com o
     código impecável.
     E o piso ser DESCANSO, não problema, é a mesma coisa que o produto já
     ensina em texto: um dia de descanso por semana não quebra a sequência. */
  descanso: {
    label: "Em descanso", leafTowardStem: 20, lean: 0, glow: 0.45, halo: 0.9,
    particles: 0, canopyScaleX: 1, markOpacityBonus: 0,
  },
};

/* ═══ A gema: afinidade 0 ═══════════════════════════════════════════════
   O 0 não é ausência de peça, é uma peça própria — a 27ª. Sem ela, quem só
   registra Prosperidade vê frutos e não faz ideia de que os outros três
   pilares existem no Mokari; e no dia em que registrar sono, a raiz aparecendo
   vira mágica inexplicável em vez de continuidade.

   Gema é o ponto de onde o crescimento sai. Ela não está vazia — está antes. */

/** Onde a gema de cada pilar nasce: a PRIMEIRA âncora daquele pilar. */
export function budSlot(pillar: PillarId, stage: MokariStage): Point {
  const a = STAGE_ANCHORS[stage];
  if (pillar === "vitalidade") return p(a.rootOrigin.x - 10, a.rootOrigin.y + 6);
  if (pillar === "prosperidade") return a.fruitSlots[0];
  if (pillar === "mente") return a.leafSlots[1] ?? a.leafSlots[0];
  return a.leafSlots[0];
}

/**
 * A gema só aparece se ALGUM OUTRO pilar já tiver marca.
 *
 * Com tudo em zero, o broto sozinho já diz "começando"; quatro gemas cinzentas
 * num broto leem como quatro caixinhas vazias para preencher — exatamente a
 * lista de tarefas que a regra 2 proíbe. É a diferença entre "ainda não" e
 * "você falhou aqui", e é ela que separa um espelho de um boleto.
 */
export function shouldShowBuds(affinity: Record<PillarId, PillarAffinity>): boolean {
  return Object.values(affinity).some((level) => level >= 1);
}

/** Cor da gema: SEMPRE neutra, jamais a do pilar. A cor do pilar é o que
 *  aparece quando a pessoa começa — se a gema já viesse colorida, começar não
 *  mudaria nada. */
export const BUD_STROKE = "hsl(var(--muted-foreground) / 0.35)";

export const LEAF_LENGTH = 7;

/** De que lado do eixo a folha está. 0 (no eixo) conta como direita. */
export const leafSide = (slot: Point): 1 | -1 => (slot.x < AXIS_X ? -1 : 1);

/**
 * Ângulo da folha, em graus de tela (0 = para a direita, cresce no sentido
 * horário porque em SVG o y cresce para baixo).
 *
 * A folha nasce apontando PARA FORA E PARA CIMA, e `towardStem` a traz na
 * direção do caule — o que, dos dois lados, significa subir a ponta. É aqui
 * que a regra 2 fica geométrica em vez de ser cuidado: não existe caminho
 * neste código que faça a ponta descer.
 */
export function leafAngle(slot: Point, towardStem: number): number {
  const side = leafSide(slot);
  // -20° = para fora e para cima. Recolher aproxima de -90° (vertical).
  return side === 1 ? -20 - towardStem : 180 + 20 + towardStem;
}

/** A ponta da folha, para o teste poder afirmar que ela nunca desce. */
export function leafTip(slot: Point, towardStem: number, length = LEAF_LENGTH): Point {
  const a = (leafAngle(slot, towardStem) * Math.PI) / 180;
  return {
    x: Math.round((slot.x + length * Math.cos(a)) * 100) / 100,
    y: Math.round((slot.y + length * Math.sin(a)) * 100) / 100,
  };
}

/* ═══ Ambiente ════════════════════════════════════════════════════════════
   A única camada que conta TEMPO, e é deliberado: o tempo passa para quem
   registra e para quem não registra. É a parte do quadro que nunca pode
   parecer mérito nem cobrança. */
export const ENVIRONMENT_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Primeira luz",
  2: "Encosta",
  3: "Entre as nuvens",
  4: "Mar de nuvens",
  5: "Céu aberto",
};

export const STAGE_LABEL: Record<MokariStage, string> = {
  1: "Broto",
  2: "Muda",
  3: "Árvore",
  4: "Árvore em flor",
};
