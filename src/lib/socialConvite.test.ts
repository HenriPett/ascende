/* ASCENDE — O convite tem de sobreviver ao cadastro.
 *
 * O bug (QA, rodada 4): quem abre o link sem ter conta é mandado para o
 * onboarding, e o `?convite=` morre no `<Navigate replace />`. Era o caminho
 * de aquisição inteiro do Social caindo num buraco — e não aparecia em teste
 * nenhum, porque cada pedaço do caminho funcionava sozinho.
 *
 * O que estes testes travam é justamente o AMBIENTE HOSTIL, que é onde um
 * conserto desses costuma quebrar: armazenamento bloqueado, JSON corrompido,
 * código vencido, código de mentira.
 */
import { describe, it, expect } from "vitest";
import {
  guardarConvite, convitePendente, limparConvite, codigoDaBusca, codigoPlausivel,
  CHAVE_DO_CONVITE, VALIDADE_MS, type ArmazenamentoLike,
} from "@/lib/socialConvite";

const CODIGO = "A1B2C3D4E5F60718293A";
const T0 = Date.parse("2026-09-18T12:00:00Z");

/** Um armazenamento de mentira, com a opção de ser hostil. */
function fakeStore(opcoes?: { lancaAoLer?: boolean; lancaAoEscrever?: boolean }): ArmazenamentoLike {
  const mapa = new Map<string, string>();
  return {
    getItem: (k) => { if (opcoes?.lancaAoLer) throw new Error("bloqueado"); return mapa.get(k) ?? null; },
    setItem: (k, v) => { if (opcoes?.lancaAoEscrever) throw new Error("bloqueado"); mapa.set(k, v); },
    removeItem: (k) => { mapa.delete(k); },
  };
}

describe("o convite atravessa o cadastro", () => {
  it("guarda e devolve o código", () => {
    const store = fakeStore();
    expect(guardarConvite(CODIGO, T0, store)).toBe(true);
    expect(convitePendente(T0 + 60_000, store)).toBe(CODIGO);
  });

  it("sobrevive a dias de onboarding abandonado", () => {
    const store = fakeStore();
    guardarConvite(CODIGO, T0, store);
    expect(convitePendente(T0 + 3 * 864e5, store)).toBe(CODIGO);
  });

  it("some sozinho depois dos sete dias — o prazo do banco", () => {
    /* Passado o prazo o código está morto com certeza. Segurá-lo seria
       sequestrar a tela de alguém semanas depois por causa de um link que já
       não existe. */
    const store = fakeStore();
    guardarConvite(CODIGO, T0, store);
    expect(convitePendente(T0 + VALIDADE_MS + 1, store)).toBeNull();
    // e sai do armazenamento, não fica ocupando lugar
    expect(store.getItem(CHAVE_DO_CONVITE)).toBeNull();
  });

  it("relógio andando para trás não ressuscita convite", () => {
    const store = fakeStore();
    guardarConvite(CODIGO, T0, store);
    expect(convitePendente(T0 - 864e5, store)).toBeNull();
  });

  it("consumir é definitivo: a folha não reabre sozinha na próxima volta", () => {
    const store = fakeStore();
    guardarConvite(CODIGO, T0, store);
    limparConvite(store);
    expect(convitePendente(T0, store)).toBeNull();
  });

  it("reabrir o mesmo link não renova o prazo", () => {
    /* Senão um link morto se mantém vivo na tela para sempre, bastando a
       pessoa abrir de novo. */
    const store = fakeStore();
    guardarConvite(CODIGO, T0, store);
    guardarConvite(CODIGO, T0 + 6 * 864e5, store);
    expect(convitePendente(T0 + VALIDADE_MS + 1, store)).toBeNull();
  });

  it("um convite NOVO substitui o antigo", () => {
    const store = fakeStore();
    const outro = "FFEEDDCCBBAA99887766";
    guardarConvite(CODIGO, T0, store);
    guardarConvite(outro, T0 + 1000, store);
    expect(convitePendente(T0 + 2000, store)).toBe(outro);
  });
});

describe("o ambiente hostil não derruba o cadastro de ninguém", () => {
  it("sem armazenamento, tudo devolve o silêncio — nada lança", () => {
    expect(guardarConvite(CODIGO, T0, null)).toBe(false);
    expect(convitePendente(T0, null)).toBeNull();
    expect(() => limparConvite(null)).not.toThrow();
  });

  it("armazenamento que LANÇA ao escrever não quebra a tela", () => {
    const store = fakeStore({ lancaAoEscrever: true });
    expect(guardarConvite(CODIGO, T0, store)).toBe(false);
  });

  it("armazenamento que LANÇA ao ler devolve 'não há convite'", () => {
    const store = fakeStore({ lancaAoLer: true });
    expect(convitePendente(T0, store)).toBeNull();
  });

  it("JSON corrompido vira 'não há convite', e é limpo", () => {
    const store = fakeStore();
    store.setItem(CHAVE_DO_CONVITE, "{isso não é json");
    expect(convitePendente(T0, store)).toBeNull();
    expect(store.getItem(CHAVE_DO_CONVITE)).toBeNull();
  });

  it("formato de uma versão anterior é descartado, não carregado para sempre", () => {
    const store = fakeStore();
    store.setItem(CHAVE_DO_CONVITE, JSON.stringify({ code: CODIGO }));
    expect(convitePendente(T0, store)).toBeNull();
    expect(store.getItem(CHAVE_DO_CONVITE)).toBeNull();
  });
});

describe("só entra o que tem cara de código", () => {
  it("o código emitido tem 20 hex maiúsculos", () => {
    expect(codigoPlausivel(CODIGO)).toBe(true);
    expect(codigoPlausivel(CODIGO.toLowerCase())).toBe(true);
  });

  it("lixo não vira estado persistente", () => {
    const store = fakeStore();
    for (const ruim of ["", "   ", "abc", "<script>", CODIGO + "Z", "?convite=" + CODIGO]) {
      expect(guardarConvite(ruim, T0, store), ruim).toBe(false);
    }
    expect(convitePendente(T0, store)).toBeNull();
  });
});

describe("o código na URL", () => {
  it("sai da query, com ou sem outros parâmetros", () => {
    expect(codigoDaBusca(`?convite=${CODIGO}`)).toBe(CODIGO);
    expect(codigoDaBusca(`?g=abc&convite=${CODIGO}&x=1`)).toBe(CODIGO);
  });

  it("sem convite na URL, não há código", () => {
    expect(codigoDaBusca("")).toBeNull();
    expect(codigoDaBusca("?g=abc")).toBeNull();
    expect(codigoDaBusca("?convite=")).toBeNull();
  });
});
