import { describe, it, expect } from "vitest";
import {
  marksOf, snapshotOf, changesSince, readSnapshot, writeSnapshot, type StorageLike,
} from "./mokariChange";
import { computeMokariFromTotals } from "./mokari";

const mokari = (por: Record<string, number>, stage = 1, dias = 0) =>
  computeMokariFromTotals({
    xpTotal: stage === 1 ? 0 : stage === 2 ? 200 : stage === 3 ? 1000 : 3000,
    pillarCounts: por,
    eventsTotal: Object.values(por).reduce((a, b) => a + b, 0),
    journeyStart: dias ? "2026-01-01T12:00:00Z" : null,
    recentEvents: [],
  }, dias ? new Date(Date.UTC(2026, 0, 1 + dias)).toISOString().slice(0, 10) : "2026-01-01");

const LABEL_EST = (s: number) => ["", "Broto", "Muda", "Árvore", "Árvore em flor"][s];
const LABEL_AMB = (e: number) => ["", "Primeira luz", "Encosta", "Entre as nuvens", "Mar de nuvens", "Céu aberto"][e];
const diff = (a: ReturnType<typeof snapshotOf> | null, b: ReturnType<typeof snapshotOf>) =>
  changesSince(a, b, LABEL_EST, LABEL_AMB);

describe("cada pilar é contado pela marca que ele DESENHA", () => {
  it("Mente conta flores, não a soma de tudo", () => {
    // Somar as quatro contas para todo pilar faria o aviso disparar por uma
    // mudança que não está na tela — e um aviso que não corresponde ao
    // desenho ensina a pessoa a não acreditar no aviso.
    const m = mokari({ alimentacao: 40, prosperidade: 0, mente: 0, vitalidade: 0 });
    const marcas = marksOf(m);
    expect(marcas.alimentacao).toBeGreaterThan(0);
    expect(marcas.mente).toBe(0);
    expect(marcas.prosperidade).toBe(0);
    expect(marcas.vitalidade).toBe(0);
  });
});

describe("o aviso só fala de GANHO", () => {
  it("anuncia o estágio novo, o céu novo e o pilar que cresceu", () => {
    const antes = snapshotOf(mokari({ alimentacao: 1, prosperidade: 0, mente: 0, vitalidade: 0 }, 1));
    const depois = snapshotOf(mokari({ alimentacao: 60, prosperidade: 0, mente: 0, vitalidade: 0 }, 2, 40));
    const frases = diff(antes, depois);
    expect(frases.some((f) => f.includes("Muda"))).toBe(true);
    expect(frases.some((f) => f.includes("Alimentação"))).toBe(true);
  });

  it("NUNCA diz que alguém perdeu algo — nem com dado corrompido", () => {
    /* A regra 1 do Mokari vale também para a FRASE. Se a referência guardada
       estiver adiante do estado atual (conta trocada, storage de outra pessoa,
       relógio maluco), a diferença é descartada em silêncio. Nada aqui tem
       como anunciar uma regressão. */
    const alto = snapshotOf(mokari({ alimentacao: 500, prosperidade: 500, mente: 500, vitalidade: 500 }, 4, 200));
    const baixo = snapshotOf(mokari({ alimentacao: 1, prosperidade: 1, mente: 1, vitalidade: 1 }, 1));
    expect(diff(alto, baixo)).toEqual([]);
  });

  it("sem referência anterior, não há novidade nenhuma", () => {
    // Primeira visita ou aparelho novo: comparar contra o vazio anunciaria a
    // história inteira como se tivesse acontecido agora.
    const agora = snapshotOf(mokari({ alimentacao: 200, prosperidade: 200, mente: 200, vitalidade: 200 }, 4, 300));
    expect(diff(null, agora)).toEqual([]);
  });

  it("nada mudou, nada a dizer", () => {
    const m = snapshotOf(mokari({ alimentacao: 12, prosperidade: 3, mente: 0, vitalidade: 7 }, 2, 15));
    expect(diff(m, m)).toEqual([]);
  });

  it("o ESTADO recente não dispara aviso — ele oscila sem ninguém evoluir", () => {
    /* "Você evoluiu" por causa de um dia de descanso seria mentira, e é por
       isso que o estado não entra no retrato guardado. */
    const base = mokari({ alimentacao: 10, prosperidade: 10, mente: 10, vitalidade: 10 }, 2, 10);
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
    const snap = snapshotOf(mokari({ alimentacao: 5, prosperidade: 0, mente: 0, vitalidade: 0 }, 1));
    writeSnapshot("u1", snap, store);
    expect(readSnapshot("u1", store)).toEqual(snap);
  });

  it("cada conta tem a sua — o Mokari de um não vira aviso do outro", () => {
    const store = fake();
    writeSnapshot("u1", snapshotOf(mokari({ alimentacao: 50, prosperidade: 0, mente: 0, vitalidade: 0 }, 3)), store);
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
    expect(() => writeSnapshot("u1", snapshotOf(mokari({ alimentacao: 1 }, 1)), explode)).not.toThrow();
  });

  it("sem armazenamento nenhum (SSR) também não quebra", () => {
    expect(readSnapshot("u1", null)).toBeNull();
    expect(() => writeSnapshot("u1", snapshotOf(mokari({ alimentacao: 1 }, 1)), null)).not.toThrow();
  });
});
