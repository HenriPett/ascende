import { describe, it, expect } from "vitest";
import {
  marksOf, snapshotOf, changesSince, readSnapshot, writeSnapshot, type StorageLike,
} from "./mokariChange";
import { computeMokariFromTotals } from "./mokari";

/** A entrada é por ÓRGÃO, que é a unidade do desenho desde que Vitalidade
 *  passou a desenhar duas peças. O piso por pilar fica em zero aqui de
 *  propósito: quem o testa é mokari.test.ts, e misturar as duas coisas faria
 *  este arquivo falhar por um motivo que não é o dele. */
const mokari = (porOrgao: Record<string, number>, stage = 1, dias = 0) =>
  computeMokariFromTotals({
    xpTotal: stage === 1 ? 0 : stage === 2 ? 200 : stage === 3 ? 1000 : 3000,
    pillarCounts: {},
    eventsTotal: Object.values(porOrgao).reduce((a, b) => a + b, 0),
    journeyStart: dias ? "2026-01-01T12:00:00Z" : null,
    recentEvents: [],
    organTotals: {
      raizPorKind: porOrgao.raiz ?? 0, raizPorPilar: 0,
      folhaPorKind: porOrgao.folha ?? 0, folhaPorPilar: 0,
      fruto: porOrgao.fruto ?? 0, flor: porOrgao.flor ?? 0,
    },
  }, dias ? new Date(Date.UTC(2026, 0, 1 + dias)).toISOString().slice(0, 10) : "2026-01-01");

const LABEL_EST = (s: number) => ["", "Broto", "Muda", "Árvore", "Árvore em flor"][s];
const LABEL_AMB = (e: number) => ["", "Primeira luz", "Encosta", "Entre as nuvens", "Mar de nuvens", "Céu aberto"][e];
const diff = (a: ReturnType<typeof snapshotOf> | null, b: ReturnType<typeof snapshotOf>) =>
  changesSince(a, b, LABEL_EST, LABEL_AMB);

describe("cada ÓRGÃO é contado pela marca que ele DESENHA", () => {
  it("a flor conta flores, não a soma de tudo", () => {
    // Somar as quatro contas para todo órgão faria o aviso disparar por uma
    // mudança que não está na tela — e um aviso que não corresponde ao
    // desenho ensina a pessoa a não acreditar no aviso.
    const marcas = marksOf(mokari({ folha: 40 }));
    expect(marcas.folha).toBeGreaterThan(0);
    expect(marcas.flor).toBe(0);
    expect(marcas.fruto).toBe(0);
    expect(marcas.raiz).toBe(0);
  });

  it("são QUATRO chaves de órgão, e nenhuma de pilar", () => {
    /* A chave era o id do pilar. Mantê-la assim depois da fusão daria a
       Vitalidade uma marca só para DUAS peças desenhadas — e aí "Vitalidade
       cresceu" voltaria a poder aparecer por uma mudança que não está em
       lugar nenhum da tela. */
    const marcas = marksOf(mokari({ raiz: 5, folha: 5, fruto: 5, flor: 5 }));
    expect(Object.keys(marcas).sort()).toEqual(["flor", "folha", "fruto", "raiz"]);
  });

  it("raiz e folha são INDEPENDENTES, mesmo vindo do mesmo pilar", () => {
    // O invariante que sobreviveu à fusão: cada órgão tem UMA fonte, e nenhuma
    // fonte alimenta dois órgãos. Comida que crescesse raiz seria a mesma
    // refeição desenhada duas vezes.
    const so = marksOf(mokari({ folha: 60 }));
    expect(so.folha).toBeGreaterThan(0);
    expect(so.raiz).toBe(0);
  });
});

describe("o aviso só fala de GANHO", () => {
  it("anuncia o estágio novo, o céu novo e o pilar que cresceu", () => {
    const antes = snapshotOf(mokari({ folha: 1 }, 1));
    const depois = snapshotOf(mokari({ folha: 60 }, 2, 40));
    const frases = diff(antes, depois);
    expect(frases.some((f) => f.includes("Muda"))).toBe(true);
    expect(frases.some((f) => f.includes("folhas"))).toBe(true);
    // E fala do que a pessoa VÊ, não do vocabulário interno.
    expect(frases.some((f) => /pilar|vitalidade|alimenta/i.test(f))).toBe(false);
  });

  it("NUNCA diz que alguém perdeu algo — nem com dado corrompido", () => {
    /* A regra 1 do Mokari vale também para a FRASE. Se a referência guardada
       estiver adiante do estado atual (conta trocada, storage de outra pessoa,
       relógio maluco), a diferença é descartada em silêncio. Nada aqui tem
       como anunciar uma regressão. */
    const alto = snapshotOf(mokari({ folha: 500, fruto: 500, flor: 500, raiz: 500 }, 4, 200));
    const baixo = snapshotOf(mokari({ folha: 1, fruto: 1, flor: 1, raiz: 1 }, 1));
    expect(diff(alto, baixo)).toEqual([]);
  });

  it("sem referência anterior, não há novidade nenhuma", () => {
    // Primeira visita ou aparelho novo: comparar contra o vazio anunciaria a
    // história inteira como se tivesse acontecido agora.
    const agora = snapshotOf(mokari({ folha: 200, fruto: 200, flor: 200, raiz: 200 }, 4, 300));
    expect(diff(null, agora)).toEqual([]);
  });

  it("nada mudou, nada a dizer", () => {
    const m = snapshotOf(mokari({ folha: 12, fruto: 3, flor: 0, raiz: 7 }, 2, 15));
    expect(diff(m, m)).toEqual([]);
  });

  it("o ESTADO recente não dispara aviso — ele oscila sem ninguém evoluir", () => {
    /* "Você evoluiu" por causa de um dia de descanso seria mentira, e é por
       isso que o estado não entra no retrato guardado. */
    const base = mokari({ folha: 10, fruto: 10, flor: 10, raiz: 10 }, 2, 10);
    const a = snapshotOf({ ...base, state: "movimento" });
    const b = snapshotOf({ ...base, state: "descanso" });
    expect(diff(a, b)).toEqual([]);
  });
});

describe("a memória local nunca derruba a tela", () => {
  /** Um armazenamento de mentira, porque o real não existe em teste de função
   *  pura — e porque os casos que interessam aqui são os que o real não deixa
   *  reproduzir sob demanda. */
  const fake = (): StorageLike & { mapa: Map<string, string> } => {
    const mapa = new Map<string, string>();
    return { mapa, getItem: (k) => mapa.get(k) ?? null, setItem: (k, v) => { mapa.set(k, v); } };
  };

  it("guarda e lê o retrato", () => {
    const store = fake();
    const snap = snapshotOf(mokari({ folha: 5 }, 1));
    writeSnapshot("u1", snap, store);
    expect(readSnapshot("u1", store)).toEqual(snap);
  });

  it("cada conta tem a sua — o Mokari de um não vira aviso do outro", () => {
    const store = fake();
    writeSnapshot("u1", snapshotOf(mokari({ folha: 50 }, 3)), store);
    expect(readSnapshot("u2", store)).toBeNull();
  });

  it("JSON corrompido devolve null em vez de explodir", () => {
    const store = fake();
    store.mapa.set("ascende-mokari-visto-u1", "{isto não é json");
    expect(readSnapshot("u1", store)).toBeNull();
  });

  it("armazenamento bloqueado (aba anônima) não quebra nada", () => {
    // O caso real: `localStorage` LANÇA em vez de devolver vazio. Um Mokari
    // que não desenha por causa de uma aba anônima seria o pior desfecho.
    const explode: StorageLike = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
    };
    expect(() => readSnapshot("u1", explode)).not.toThrow();
    expect(readSnapshot("u1", explode)).toBeNull();
    expect(() => writeSnapshot("u1", snapshotOf(mokari({ folha: 1 }, 1)), explode)).not.toThrow();
  });

  it("o retrato guardado ANTES da fusão não vira 'você evoluiu' do nada", () => {
    /* O CASO QUE ESTE TESTE EXISTE PARA PEGAR, e ele é silencioso:
       o armazenamento local guarda `marks` chaveado pelos ids de PILAR, que é
       o que o código da época conhecia. Lido pelo código novo, nenhuma das
       quatro chaves de órgão casa — todas comparam contra 0, e a pessoa que
       não fez NADA abre a Jornada e é informada de que as quatro peças
       cresceram hoje. Aviso falso é a única coisa que este arquivo não pode
       produzir: ele ensina a pessoa a não acreditar no aviso. */
    const store = fake();
    const atual = mokari({ raiz: 40, folha: 40, fruto: 40, flor: 40 }, 3, 60);
    const marcasDeHoje = marksOf(atual);
    store.mapa.set("ascende-mokari-visto-u1", JSON.stringify({
      stage: 3, environment: 4,
      marks: {
        vitalidade: marcasDeHoje.raiz, alimentacao: marcasDeHoje.folha,
        prosperidade: marcasDeHoje.fruto, mente: marcasDeHoje.flor,
      },
    }));
    const anterior = readSnapshot("u1", store);
    expect(anterior).not.toBeNull();
    expect(diff(anterior, snapshotOf(atual))).toEqual([]);
  });

  it("e o retrato antigo continua reportando o ganho DE VERDADE", () => {
    // A tradução não pode custar o aviso verdadeiro: quem cresceu desde a
    // última visita continua sendo avisado.
    const store = fake();
    store.mapa.set("ascende-mokari-visto-u1", JSON.stringify({
      stage: 3, environment: 4,
      marks: { vitalidade: 1, alimentacao: 1, prosperidade: 1, mente: 1 },
    }));
    const frases = diff(readSnapshot("u1", store), snapshotOf(mokari({ raiz: 300 }, 3, 60)));
    expect(frases).toEqual(["Suas raízes cresceram"]);
  });

  it("sem armazenamento nenhum (SSR) também não quebra", () => {
    expect(readSnapshot("u1", null)).toBeNull();
    expect(() => writeSnapshot("u1", snapshotOf(mokari({ folha: 1 }, 1)), null)).not.toThrow();
  });
});
