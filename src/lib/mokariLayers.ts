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

/* ═══ OS SLOTS DEIXARAM DE SER UMA LISTA FINITA ══════════════════════════
   Antes havia uma REGRA DE CAPACIDADE: o nível pedia N marcas e o estágio
   limitava pelo tamanho do array de âncoras. A intenção era boa ("o corpo
   carrega o que cabe nele"), mas medida ela apagava o outro eixo inteiro: no
   Broto, que tem 3 âncoras de folha, 1 de fruto e 1 de flor, ir do PRIMEIRO
   ao QUADRAGÉSIMO registro de um pilar mudava UMA folha — e nada nos frutos e
   nas flores. Quem usa pouco fica semanas no estágio 1; era exatamente quem
   mais precisava ver que estava avançando, e era quem não via nada.

   Agora a densidade é contínua e sem teto (mokariDensity.ts), então a lista
   de âncoras não pode mais ser o limite. A composição desenhada à mão CONTINUA
   VALENDO — ela é sempre usada primeiro, então o desenho de quem está no
   começo é exatamente o de antes. O que passa dela é gerado em anéis ao redor
   da copa, e é essa geração que faz o crescimento não ter fim.

   O anel expande devagar (12% de raio por volta) e gira meio passo a cada
   volta, para as marcas novas caírem entre as antigas em vez de em cima. */

/** Distribui `n` pontos em anéis ao redor de um centro, sem limite superior. */
export function ringSlots(center: Point, radius: number, n: number, fromDeg = 200): Point[] {
  const out: Point[] = [];
  let ring = 0;
  while (out.length < n) {
    const cap = 6 + ring * 2;              // o anel de fora cabe mais
    const r = radius * (1 + ring * 0.12);
    const giro = fromDeg + ring * (180 / cap);  // meio passo: não empilha
    for (const pt of onEllipse(center.x, center.y, r, r * 0.66, cap, giro)) {
      if (out.length >= n) break;
      out.push(pt);
    }
    ring++;
    if (ring > 60) break;                  // cinta de segurança, nunca atingida
  }
  return out;
}

/**
 * Marca distante do centro desenha MENOR.
 *
 * Crescimento sem teto tem um preço óbvio: com anos de uso um pilar chega a
 * dezenas de marcas, e dezenas de marcas do mesmo tamanho viram mancha. O
 * encolhimento é o que deixa a copa continuar lendo como copa — a silhueta
 * ganha densidade em vez de virar borrão, e a marca antiga continua sendo a
 * maior, que é a leitura certa: o que veio primeiro sustenta o resto.
 *
 * Piso de 0,62: abaixo disso a marca deixa de ser reconhecível, e uma marca
 * que não se vê é o mesmo que não tê-la desenhado.
 */
export const markScale = (index: number, base: number): number =>
  index < base ? 1 : Math.max(0.62, 1 - (index - base) * 0.018);

/** Distância mínima entre duas marcas para elas lerem como duas. */
const APART = 3.2;

/**
 * A composição à mão primeiro; o excedente, gerado.
 *
 * Gera com FOLGA e filtra depois. A primeira versão gerava exatamente `n`
 * candidatos, filtrava as colisões e devolvia menos marcas do que o pilar
 * havia conquistado — um crescimento que some ao ser desenhado é pior que
 * crescimento nenhum, porque a pessoa vê o número subir e a árvore não.
 *
 * `avoid` é o que impede as flores de nascerem em cima das folhas depois que
 * a composição à mão acaba: a regra de "índice ímpar" só existia enquanto os
 * slots eram uma lista fixa.
 */
function slotsFor(
  base: readonly Point[], center: Point, radius: number,
  n: number, fromDeg: number, avoid: readonly Point[] = [],
): Point[] {
  if (n <= base.length) return base.slice(0, Math.max(0, n));
  const out: Point[] = [...base];
  const longe = (g: Point) =>
    !out.some((b) => Math.hypot(b.x - g.x, b.y - g.y) < APART) &&
    !avoid.some((b) => Math.hypot(b.x - g.x, b.y - g.y) < APART);
  for (const cand of ringSlots(center, radius, n * 3 + 36, fromDeg)) {
    if (out.length >= n) break;
    if (longe(cand)) out.push(cand);
  }
  return out.slice(0, n);
}

export const leafSlotsFor = (stage: MokariStage, n: number): Point[] => {
  const a = STAGE_ANCHORS[stage];
  return slotsFor(a.leafSlots, a.auraCenter, a.auraRadius * 0.8, n, 200);
};

export const fruitSlotsFor = (stage: MokariStage, n: number): Point[] => {
  const a = STAGE_ANCHORS[stage];
  return slotsFor(a.fruitSlots, a.auraCenter, a.auraRadius * 0.62, n, 20);
};

/** Flores nascem nos slots ÍMPARES de folha para não empilhar sobre elas, e
 *  depois em anel próprio, desviando das folhas que já estão lá. */
export function flowerSlotsFor(stage: MokariStage, n: number): Point[] {
  const a = STAGE_ANCHORS[stage];
  const odd = a.leafSlots.filter((_, i) => i % 2 === 1);
  return slotsFor(odd, a.auraCenter, a.auraRadius * 0.95, n, 110, leafSlotsFor(stage, n));
}

/* ═══ RAÍZES ═════════════════════════════════════════════════════════════
   Eram sete traçados à mão; viraram geração, porque a Vitalidade também
   deixou de ter teto. Chegaram aqui por duas correções do QA visual, e a
   segunda é a que importa entender.

   PRIMEIRA: o alcance somava 11 unidades por raiz, sem limite. Com 20.000
   registros as raízes iam de x=−160 a x=+403 num quadro de 0 a 240 — metade
   desenhada fora, virando dois riscos cortados na borda.

   SEGUNDA, e é a armadilha: a correção óbvia (fazer o alcance CONVERGIR)
   trocou um defeito pelo outro. Com o alcance saturando, a 19ª raiz e a 50ª
   terminavam praticamente no mesmo lugar — 30 das 50 desenhadas por cima de
   outra, e as imagens de 800 e de 20.000 registros ficavam idênticas. Ou
   seja: a camada de Vitalidade voltava a "evoluo e ele continua igual", que é
   exatamente a queixa que esta mudança inteira existe para resolver.

   A SAÍDA É A MESMA DA COPA: não crescer para FORA, crescer em DENSIDADE. As
   folhas ganham anéis novos e se espalham entre as antigas; as raízes agora
   fazem o mesmo num leque. Cada raiz nova cai num ângulo e num comprimento
   que SUBDIVIDEM o que já existe, em vez de irem mais longe — então o leque
   fica visivelmente mais cheio para sempre, e nada nunca sai do quadro.

   As duas sequências abaixo são de baixa discrepância (parte fracionária dos
   múltiplos de dois irracionais). Elas são determinísticas — o mesmo Mokari
   desenhado duas vezes é o mesmo desenho, que é a regra de pureza do módulo —
   e têm a propriedade que um sorteio não teria: cada novo termo cai no maior
   vão que ainda existe, nunca em cima de um anterior.

   O ESPAÇO ABAIXO DO CHÃO É POUCO E ISSO MANDA NA FORMA. Entre a linha do
   chão (y=120) e a borda (y=150) cabem 30 unidades, e o componente ainda gira
   o conjunto pelo `lean` do estágio (−2° na Árvore em flor), que empurra a
   ponta de um dos lados para baixo DEPOIS desta conta. Por isso o leque é
   raso: os ângulos vão de 4° a 21°, não até a vertical. Raiz funda não cabe —
   e raiz cortada na borda é pior que raiz curta. */

/** Sequências de baixa discrepância: ângulo e comprimento, independentes. */
const PHI = 0.6180339887;
const PLASTIC = 0.7548776662;

/** Limites do leque, escolhidos para caber COM a rotação do estágio por cima:
 *  o ponto mais fundo dá y ≈ 144, e 2° de giro a ~68 de distância acrescentam
 *  no máximo ~2,4 — sobra margem até os 150 da borda. */
const ROOT_LEN_MIN = 24;
const ROOT_LEN_MAX = 68;
const ROOT_ANG_MIN = 4;
const ROOT_ANG_MAX = 21;

export function rootPathsFor(stage: MokariStage, n: number): string[] {
  const o = STAGE_ANCHORS[stage].rootOrigin;
  return Array.from({ length: Math.max(0, n) }, (_, i) => {
    const lado = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);                       // índice dentro do lado
    const tAng = (k * PHI) % 1;
    const tLen = (k * PLASTIC) % 1;
    const ang = ((ROOT_ANG_MIN + (ROOT_ANG_MAX - ROOT_ANG_MIN) * tAng) * Math.PI) / 180;
    const len = ROOT_LEN_MIN + (ROOT_LEN_MAX - ROOT_LEN_MIN) * tLen;
    const fim = { x: o.x + lado * len * Math.cos(ang), y: o.y + len * Math.sin(ang) };
    // Controle puxado para dentro: a raiz sai do tronco quase reta e abre.
    const meio = { x: o.x + lado * len * 0.45, y: o.y + len * Math.sin(ang) * 0.35 };
    return `M${o.x},${o.y} Q${meio.x.toFixed(1)},${meio.y.toFixed(1)} ${fim.x.toFixed(1)},${fim.y.toFixed(1)}`;
  });
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
   registra Prosperidade vê frutos e não faz ideia de que os outros pilares
   existem no Mokari; e no dia em que registrar sono, a raiz aparecendo vira
   mágica inexplicável em vez de continuidade.

   Gema é o ponto de onde o crescimento sai. Ela não está vazia — está antes. */

/** Onde a gema de cada pilar nasce: a PRIMEIRA âncora daquele pilar.
 *  Vitalidade nasce na raiz — desde a fusão ela desenha raiz E folha, e a raiz
 *  é a peça que está lá desde o estágio 1. */
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
 * Com tudo em zero, o broto sozinho já diz "começando"; um punhado de gemas
 * cinzentas num broto lê como caixinhas vazias para preencher — exatamente a
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
