/* ASCENDE — O catálogo do Social: a regra ética que tem de QUEBRAR quando
 * alguém a remove.
 *
 * O anexo do parecer do Fiel da Balança lista, como item 1 do que ele precisa
 * ver antes de assinar a implementação: "a função isShareable e seus testes
 * (N2, N3, N4, N5, N6), escritos como o lib/mokari.ts foi: regra ética como
 * função pura com teste que falha quando alguém a remove".
 *
 * Cada bloco abaixo corresponde a uma linha da LISTA NUNCA. Se um deles ficar
 * verde com a regra apagada, o teste não vale nada — então vários deles testam
 * a regra pela ESTRUTURA (allowlist, composição transitiva), não pela lista de
 * casos conhecidos, que é o que um "e se aparecer um kind novo num sábado"
 * sempre fura.
 */
import { describe, it, expect } from "vitest";
import {
  SHAREABLE_METRICS, SOCIAL_METRIC_KEYS, SHAREABLE_SIGNALS, FORBIDDEN_SIGNALS,
  isShareable, shareabilityOf, metricSignals, socialMetric, FORA_DO_CATALOGO,
  type SocialMetricKey, type MetricCatalog,
} from "@/lib/socialMetrics";

/** O catálogo real com UMA métrica adulterada. Existe para os testes do N6:
 *  eles rodam `isShareable` de verdade contra ele, e não uma reimplementação
 *  da regra — um teste que reimplementa a verificação testa a própria cópia. */
const estender = (
  key: SocialMetricKey, patch: Partial<{ signals: string[]; composedOf: string[] }>,
): MetricCatalog => ({
  ...SHAREABLE_METRICS,
  [key]: { ...SHAREABLE_METRICS[key], ...patch },
}) as unknown as MetricCatalog;

describe("o catálogo é o que o fundador aprovou — oito chaves, nem mais", () => {
  it("as SETE chaves, exatamente", () => {
    /* Lista escrita à mão de propósito, como FROZEN_LEGACY_PATHS em routes.ts:
       se fosse derivada do próprio objeto, acrescentar uma oitava passaria
       verde. Mexer aqui é uma decisão consciente que passa pela mesa. */
    expect(SOCIAL_METRIC_KEYS.sort()).toEqual([
      "agua_fechada", "dia_inteiro", "gratidao_registrada", "refeicao_registrada",
      "soneca_registrada", "sono_na_janela", "treino_registrado",
    ]);
  });

  it("toda métrica RECUSADA continua recusada, e com o argumento escrito", () => {
    /* O teste que impede a volta. Uma ausência não se defende sozinha: uma
       métrica que some sem deixar argumento volta em seis meses, proposta de
       boa-fé por quem leu o catálogo e achou que faltava uma.

       `sequencia_dias` é o caso vivo — saiu em 18/09/2026 porque sequência
       CONSECUTIVA é perfeição num produto que vende constância, e porque
       contradizia a sequência privada do app (que perdoa um dia) e o item 3
       da /recusas. Quem tentar recolocar bate neste teste e, ao ir ver por
       que ele existe, bate no argumento. */
    expect(Object.keys(FORA_DO_CATALOGO).length).toBeGreaterThanOrEqual(8);

    for (const [key, porque] of Object.entries(FORA_DO_CATALOGO)) {
      expect(SOCIAL_METRIC_KEYS, `${key} voltou ao catálogo sem tirar a linha de FORA_DO_CATALOGO`)
        .not.toContain(key);
      expect(isShareable(key), `${key} está recusada e mesmo assim passa em isShareable`)
        .toBe(false);
      // Motivo curto é motivo que ninguém consegue contestar depois — e
      // recusa que não se pode contestar é recusa que alguém desfaz.
      expect(porque.length, `${key} está na lista de recusadas sem argumento escrito`)
        .toBeGreaterThan(60);
    }
  });

  it("`sequencia_dias` especificamente, porque foi a última a sair", () => {
    expect(SOCIAL_METRIC_KEYS).not.toContain("sequencia_dias");
    expect(isShareable("sequencia_dias")).toBe(false);
    expect(FORA_DO_CATALOGO.sequencia_dias).toMatch(/constância|perfeição/i);
    // E o argumento cita a promessa pública que ela contradizia — sem isso o
    // motivo vira preferência de gosto.
    expect(FORA_DO_CATALOGO.sequencia_dias).toMatch(/recusas/i);
  });

  it("toda métrica declara o que o ZERO dela diz em voz alta", () => {
    /* O teste do zero é a régua do catálogo, e um campo obrigatório é o que
       obriga quem for acrescentar a nona a ESCREVER a frase e encará-la. */
    for (const key of SOCIAL_METRIC_KEYS) {
      const m = SHAREABLE_METRICS[key];
      expect(m.zeroReads.length, `${key} não diz o que o zero dela significa`)
        .toBeGreaterThan(3);
    }
  });

  it("toda métrica do catálogo é compartilhável — o catálogo não se contradiz", () => {
    for (const key of SOCIAL_METRIC_KEYS) {
      expect(shareabilityOf(key), `${key} está no catálogo e não passa em isShareable`)
        .toMatchObject({ ok: true });
    }
  });
});

describe("N2/N3/N4/N5 — o que NUNCA sai daqui", () => {
  /* A lista abaixo é de CASOS, e casos não provam regra: ela existe para que a
     recusa apareça nomeada no relatório de teste. Quem prova a regra é o bloco
     "allowlist", logo abaixo. */
  const proibidos: [string, string][] = [
    ["transaction", "N2 — dinheiro, nem derivado nem agregado"],
    ["spend_limit", "N2 — 'cumpriu o teto hoje: sim/não' JÁ É dado financeiro"],
    ["budget", "N2 — orçamento"],
    ["weight", "N4 — peso"],
    ["body", "N4 — composição corporal"],
    ["mood", "N5 — humor"],
    ["journal", "N5 — diário"],
    ["practice", "N5 — prática espiritual (LGPD art. 5º, II)"],
    ["battle_checkin", "N3 — batalhas, em forma nenhuma"],
    ["battle_streak", "N3 — nem dias limpos, nem marco de 30 dias"],
  ];

  it.each(proibidos)("nenhuma métrica consome `%s` (%s)", (signal) => {
    for (const key of SOCIAL_METRIC_KEYS) {
      expect(metricSignals(key), `${key} consome ${signal}`).not.toContain(signal);
    }
  });

  it("cada sinal recusado tem a frase do zero dele escrita", () => {
    // Recusa sem motivo escrito vira recusa que alguém desfaz achando que foi
    // arbitrária.
    for (const [signal] of proibidos) {
      expect(FORBIDDEN_SIGNALS[signal]?.length ?? 0).toBeGreaterThan(3);
    }
  });
});

describe("ALLOWLIST, nunca denylist — é aqui que a regra é provada", () => {
  it("um sinal que ninguém previu NÃO é compartilhável", () => {
    /* A prova de que a regra não é a lista de proibidos. Um `kind` novo que
       apareça amanhã não tem para onde ir; uma denylist ("todos menos
       transaction") nasceria aberta para ele. */
    const inventado = "kind_que_ninguem_previu";
    expect(FORBIDDEN_SIGNALS[inventado]).toBeUndefined();   // não está proibido
    expect(isShareable(inventado)).toBe(false);             // e mesmo assim não passa
  });

  it("apagar a denylist inteira não abre nada", () => {
    // Se FORBIDDEN_SIGNALS decidisse alguma coisa, este teste ficaria vermelho.
    // Ele existe para provar que aquele mapa só EXPLICA.
    for (const signal of Object.keys(FORBIDDEN_SIGNALS)) {
      expect(SHAREABLE_SIGNALS).not.toContain(signal);
    }
  });

  it("métrica desconhecida é recusada com o motivo, não com um crash", () => {
    expect(shareabilityOf("constancia_geral"))
      .toEqual({ ok: false, reason: "desconhecida", offending: "constancia_geral" });
  });
});

describe("N6 — número COMPOSTO cai junto com o pior insumo dele", () => {
  it("`dia_inteiro` resolve até as folhas, e todas passam", () => {
    expect(metricSignals("dia_inteiro")?.sort())
      .toEqual(["meal", "sleep", "water", "workout"]);
  });

  it("composta DE composta resolve até as folhas, em profundidade", () => {
    /* O catálogo real tem um nível só de composição desde que `sequencia_dias`
       saiu. A travessia em profundidade continua testada — no catálogo
       injetável — porque a hora em que alguém acrescentar o segundo nível não
       pode ser a hora de descobrir que ela não funcionava. */
    const comDoisNiveis = {
      ...SHAREABLE_METRICS,
      semana_inteira: {
        key: "semana_inteira", label: "Semanas inteiras",
        zeroReads: "não fechou nenhuma semana",
        signals: [], composedOf: ["dia_inteiro"],
      },
    } as unknown as MetricCatalog;

    expect(metricSignals("semana_inteira", comDoisNiveis)?.sort())
      .toEqual(["meal", "sleep", "water", "workout"]);
    expect(isShareable("semana_inteira", comDoisNiveis)).toBe(true);
  });

  it("A REGRESSÃO QUE ESTE ARQUIVO EXISTE PARA PEGAR: insumo novo numa composta", () => {
    /* O cenário 1 do parecer, e ele é concreto: ela entra num grupo de colegas
       de academia e liga "constância", achando que é treino. Se o cálculo
       agregar ingenuamente prática espiritual e check-in de batalha, uma semana
       de recaída na batalha "Apostas" faz a constância cair — e a queda é
       visível. Um colega pergunta "o que houve naquela semana?". O Ascende
       acabou de entregar uma recaída em jogo para um grupo de trabalho.

       Aqui alguém "melhora" o dia inteiro acrescentando humor à conta. Repare
       que quem roda é a FUNÇÃO DE VERDADE, contra um catálogo adulterado — um
       teste que reimplementasse a verificação estaria testando a cópia dele. */
    const adulterado = estender("dia_inteiro", { signals: ["mood"] });

    expect(isShareable("dia_inteiro", adulterado), "humor entrou num número composto e passou")
      .toBe(false);
    expect(shareabilityOf("dia_inteiro", adulterado)).toMatchObject({
      reason: "insumo-proibido", offending: "mood",
      zeroReads: "parou de conseguir se olhar",
    });
  });

  it("e cai junto TUDO que é composto daquela métrica, um nível acima", () => {
    /* O que torna o N6 difícil de cumprir na mão: a métrica de cima não
       menciona batalha em lugar nenhum — ela só é composta de `dia_inteiro`.
       Quem adulterou a folha nem passou perto dela. */
    const adulterado = {
      ...estender("dia_inteiro", { signals: ["battle_checkin"] }),
      semana_inteira: {
        key: "semana_inteira", label: "Semanas inteiras", zeroReads: "não fechou semana",
        signals: [], composedOf: ["dia_inteiro"],
      },
    } as unknown as MetricCatalog;
    expect(isShareable("semana_inteira", adulterado)).toBe(false);
    expect(shareabilityOf("semana_inteira", adulterado))
      .toMatchObject({ reason: "insumo-proibido", offending: "battle_checkin" });
  });

  it("insumo novo que É da allowlist continua passando — a regra não é 'nada muda'", () => {
    // O teste tem de pegar o insumo PROIBIDO, não qualquer mudança. Senão ele
    // vira um cadeado no catálogo, e um cadeado que atrapalha alguém remove.
    const adulterado = estender("dia_inteiro", { signals: ["gratitude"] });
    expect(isShareable("dia_inteiro", adulterado)).toBe(true);
  });

  it("composição circular não vira 'sem insumo' — que passaria por vacuidade", () => {
    /* `[].every(...)` é `true`. Uma métrica que se compõe de si mesma resolve
       para lista vazia e entraria como compartilhável sem insumo nenhum — o
       jeito mais silencioso de furar a regra, porque não sobra insumo proibido
       nenhum para o teste apontar. */
    const circular = estender("dia_inteiro", { signals: [], composedOf: ["dia_inteiro"] });
    expect(metricSignals("dia_inteiro", circular)).toBeNull();
    expect(shareabilityOf("dia_inteiro", circular))
      .toMatchObject({ reason: "composicao-circular" });
    expect(isShareable("dia_inteiro", circular)).toBe(false);
  });

  it("métrica sem insumo declarado é indefinida, e indefinida não se compartilha", () => {
    const oca = estender("treino_registrado", { signals: [], composedOf: [] });
    expect(isShareable("treino_registrado", oca)).toBe(false);
    expect(shareabilityOf("treino_registrado", oca))
      .toMatchObject({ reason: "insumo-proibido" });
  });
});

describe("a recusa sai com a frase do zero junto", () => {
  it("dizer 'não' sem dizer por quê é como a regra é desfeita depois", () => {
    const v = shareabilityOf("humor_registrado");
    expect(v.ok).toBe(false);
    // Não está no catálogo, então nem chega a olhar insumo — mas o motivo vem.
    expect(v).toMatchObject({ reason: "desconhecida" });
    // E a frase do zero do humor está escrita em algum lugar do módulo.
    expect(FORBIDDEN_SIGNALS.mood).toContain("parou de conseguir se olhar");
  });
});
