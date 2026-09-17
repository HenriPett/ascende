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
  STAGE_ANCHORS, STATE_STYLE, leafSlotsFor, fruitSlotsFor,
  flowerSlotsFor, rootPathsFor, markScale, leafTip, leafAngle, leafSide, AXIS_X, GROUND_Y,
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

/* A REGRA DE CAPACIDADE FOI REMOVIDA — e estes testes contam por quê.

   Ela limitava as marcas ao tamanho do array de âncoras do estágio. Medido, o
   efeito era este: no Broto (3 âncoras de folha, 1 de fruto, 1 de flor), ir do
   PRIMEIRO ao QUADRAGÉSIMO registro de um pilar mudava uma folha — e nada nos
   frutos e nas flores. O eixo inteiro da afinidade ficava anulado justamente
   para quem usa pouco e passa semanas no estágio 1.

   Agora os slots são gerados sem limite. O que a capacidade protegia de
   verdade — o desenho não virar mancha — passou a ser protegido por
   `markScale`, que encolhe a marca distante em vez de não desenhá-la. */
describe("os slots não terminam mais", () => {
  it("atende qualquer número de marcas, em qualquer estágio", () => {
    for (const stage of STAGES) {
      for (const n of [1, 5, 12, 30, 80, 200]) {
        expect(leafSlotsFor(stage, n)).toHaveLength(n);
        expect(fruitSlotsFor(stage, n)).toHaveLength(n);
        expect(flowerSlotsFor(stage, n)).toHaveLength(n);
        expect(rootPathsFor(stage, n)).toHaveLength(n);
      }
    }
  });

  it("a composição desenhada à mão continua vindo primeiro", () => {
    // O desenho de quem está começando tem que ser EXATAMENTE o de antes: as
    // âncoras à mão são a arte, a geração é só o que vem depois delas.
    for (const stage of STAGES) {
      const base = STAGE_ANCHORS[stage].leafSlots;
      expect(leafSlotsFor(stage, base.length).slice(0, base.length)).toEqual([...base]);
      expect(leafSlotsFor(stage, base.length + 10).slice(0, base.length)).toEqual([...base]);
    }
  });

  it("marca gerada nunca nasce em cima de uma âncora à mão", () => {
    for (const stage of STAGES) {
      const todos = leafSlotsFor(stage, 40);
      for (let i = 0; i < todos.length; i++) {
        for (let j = i + 1; j < todos.length; j++) {
          expect(Math.hypot(todos[i].x - todos[j].x, todos[i].y - todos[j].y))
            .toBeGreaterThan(0.5);
        }
      }
    }
  });

  it("a marca distante encolhe, mas nunca some", () => {
    // É o que substituiu a capacidade: densidade que continua legível.
    expect(markScale(0, 3)).toBe(1);
    expect(markScale(2, 3)).toBe(1);
    let anterior = 1;
    for (let i = 3; i < 400; i++) {
      const e = markScale(i, 3);
      expect(e).toBeLessThanOrEqual(anterior);
      expect(e).toBeGreaterThanOrEqual(0.62);
      anterior = e;
    }
  });

  /* O QA visual pegou isto na primeira versão da geração: as raízes somavam
     11 unidades de comprimento a cada nova, sem limite. Com 800 registros já
     furavam a base do quadro; com 20.000 iam de x=−160 a x=+403 num quadro de
     0 a 240 — mais da metade desenhada fora, virando dois riscos cortados na
     borda. A copa nunca teve esse problema porque `markScale` a segura.
     Crescimento sem teto precisa de um freio de ENQUADRAMENTO, e este teste é
     o freio. */
  it("a raiz nunca sai do quadro — COM a rotação do estágio por cima", () => {
    /* O `lean` é a lacuna que a primeira versão deste teste tinha e que o QA
       visual pegou olhando a tela: o componente gira o conjunto inteiro pelo
       lean do estágio (−2° na Árvore em flor) DEPOIS que a geometria é
       calculada. Medindo só a geometria pura, o teste passava e a raiz
       cruzava a borda de baixo mesmo assim. Quem valida enquadramento tem que
       validar o que é DESENHADO, não o que é calculado. */
    const num = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (const stage of STAGES) {
      const o = STAGE_ANCHORS[stage].rootOrigin;
      const a = (STAGE_ANCHORS[stage].lean * Math.PI) / 180;
      for (const n of [1, 8, 40, 200, 2000]) {
        for (const d of rootPathsFor(stage, n)) {
          const v = num(d);                       // M x,y Q mx,my fx,fy
          for (let i = 0; i < v.length; i += 2) {
            // Mesma rotação do componente, em torno da origem das raízes.
            const dx = v[i] - o.x, dy = v[i + 1] - o.y;
            const x = o.x + dx * Math.cos(a) - dy * Math.sin(a);
            const y = o.y + dx * Math.sin(a) + dy * Math.cos(a);
            expect(x, `x fora do quadro (${n} raízes, estágio ${stage})`).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(240);
            expect(y, `y fora do quadro (${n} raízes, estágio ${stage})`).toBeLessThanOrEqual(150);
          }
        }
      }
    }
  });

  it("o leque de raízes SUBDIVIDE em vez de esticar — senão para de crescer", () => {
    /* O outro achado do QA: com o alcance convergindo, a 19ª raiz e a 50ª
       terminavam no mesmo lugar e as imagens de 800 e 20.000 registros ficavam
       idênticas — a camada de Vitalidade voltava a "evoluo e ele continua
       igual". Estas duas propriedades são o que impede isso de voltar. */
    const ponta = (d: string) => d.split(" ").pop()!;
    const distintas = (n: number) => new Set(rootPathsFor(4, n).map(ponta)).size;

    // 1. Toda raiz tem ponta própria: nenhuma desenhada em cima de outra.
    for (const n of [12, 20, 50, 120]) expect(distintas(n)).toBe(n);

    // 2. A largura do leque CONVERGE — é o que mantém tudo no quadro. Ela
    //    ainda abre um pouco entre 20 e 120 raízes (a sequência leva um tempo
    //    para alcançar os extremos do intervalo), e depois para de vez.
    const largura = (n: number) => {
      const xs = rootPathsFor(4, n).map((d) => Number(ponta(d).split(",")[0]));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(largura(500) - largura(120)).toBeLessThanOrEqual(2);
    expect(largura(5000)).toBeLessThan(150);   // e nunca estoura o quadro

    // 3. O que continua crescendo é a DENSIDADE: mais raízes no mesmo leque.
    //    É esta a diferença entre densificar e esticar.
    expect(distintas(500) / largura(500)).toBeGreaterThan(distintas(20) / largura(20));
  });

  it("e nenhuma raiz SOBE — raiz que sobe não é raiz", () => {
    const num = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (const stage of STAGES) {
      for (const d of rootPathsFor(stage, 60)) {
        const v = num(d);
        for (let i = 1; i < v.length; i += 2) expect(v[i]).toBeGreaterThanOrEqual(GROUND_Y);
      }
    }
  });

  it("raízes distantes não viram cópias umas das outras", () => {
    // O alcance converge de propósito (senão sai do quadro). Sem o desvio por
    // índice, as raízes do mesmo lado ficariam sobrepostas no limite.
    const fins = rootPathsFor(4, 40).map((d) => d.split(" ").pop()!);
    expect(new Set(fins).size).toBe(fins.length);
  });

  it("zero marca não desenha nada", () => {
    for (const stage of STAGES) {
      expect(leafSlotsFor(stage, 0)).toEqual([]);
      expect(fruitSlotsFor(stage, 0)).toEqual([]);
      expect(flowerSlotsFor(stage, 0)).toEqual([]);
      expect(rootPathsFor(stage, 0)).toEqual([]);
    }
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
  it("as primeiras usam os slots de índice ímpar", () => {
    for (const stage of STAGES) {
      const impares = STAGE_ANCHORS[stage].leafSlots.filter((_, i) => i % 2 === 1);
      for (const flor of flowerSlotsFor(stage, impares.length)) {
        expect(impares).toContainEqual(flor);
      }
    }
  });

  it("e as GERADAS desviam das folhas", () => {
    /* As âncoras à mão de flor SÃO slots ímpares de folha — nessa faixa as
       duas peças sempre conviveram, por composição, e é isso que dá a flor
       nascendo no ramo. O que não podia acontecer é a geração continuar
       empilhando depois que a composição acaba: aí não é desenho, é acidente.
       Por isso o teste olha só o que passou das âncoras. */
    for (const stage of STAGES) {
      const base = STAGE_ANCHORS[stage].leafSlots.filter((_, i) => i % 2 === 1).length;
      const folhas = leafSlotsFor(stage, 24);
      const geradas = flowerSlotsFor(stage, 24).slice(base);
      for (const f of geradas) {
        const perto = folhas.find((l) => Math.hypot(l.x - f.x, l.y - f.y) < 3);
        expect(perto, `flor gerada em cima de folha no estágio ${stage}`).toBeUndefined();
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
