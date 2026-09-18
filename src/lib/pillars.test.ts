/* ASCENDE — Testes de `profiles.pillars`: a lista que decide QUE APP a pessoa vê.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * `activePillarSet` é a fonte única de verdade de Hoje, Pilares, Score,
 * Jornada, CaptureBar, Ajustes e do conjunto de trackers ativos. Ela tem um
 * fallback deliberado — lista vazia significa "todos ativos", porque nunca
 * escondemos o app inteiro por engano — e esse fallback é exatamente o que a
 * torna perigosa: NADA falha em voz alta quando ela erra. A pessoa só abre o
 * app e encontra telas que ela tinha pausado, ou não encontra as que tinha.
 *
 * A FUSÃO DE 17/09/2026 armou essa arapuca. `alimentacao` saiu de PILLARS, e
 * o filtro por id desconhecido passou a descartá-lo — então um perfil ainda
 * não migrado caía num de dois desfechos, ERRADOS EM DIREÇÕES OPOSTAS:
 *
 *   ["alimentacao"]         → lista vazia → fallback → os TRÊS pilares de volta
 *   ["alimentacao","mente"] → ["mente"]   → a Vitalidade dela desaparecia
 *
 * Achado de QA ao vivo, e é o risco nº 2 do levantamento. A correção é a mesma
 * doutrina já aplicada ao `ai_scopes`: enquanto existir perfil não migrado,
 * quem traduz o valor legado é o CLIENTE, na leitura — a migration é
 * otimização, não correção, e o código não pode depender dela ter rodado.
 *
 * Estes testes travam a tradução. Se alguém remover o alias "simplificando",
 * eles falham antes de a pessoa descobrir sozinha.
 */
import { describe, it, expect } from "vitest";
import {
  PILLARS, activePillarSet, isPillarActive, normalizePillars, pillarById,
  pillarMatchValues, type PillarId,
} from "@/lib/pillars";
import { activeTrackerSet } from "@/lib/trackers";

const TODOS = PILLARS.map((p) => p.id).sort();
const ordenado = (s: Set<PillarId>) => [...s].sort();

describe("perfil NÃO migrado: o apelido é traduzido antes do filtro", () => {
  it('["alimentacao"] devolve EXATAMENTE {vitalidade} — nunca os três', () => {
    /* O desfecho que o QA reproduziu: o filtro descartava o id, a lista ficava
       vazia, o fallback devolvia o app inteiro. Quem escolheu ter só o pilar
       do corpo recebia Prosperidade e Mente de volta, sem pedir e sem aviso. */
    expect(ordenado(activePillarSet(["alimentacao"]))).toEqual(["vitalidade"]);
    expect(ordenado(activePillarSet(["alimentacao"]))).not.toEqual(TODOS);
  });

  it('["alimentacao","mente"] devolve {vitalidade, mente} — ninguém perde pilar', () => {
    // O desfecho oposto, e igualmente errado: a lista não ficava vazia, então
    // o fallback não salvava, e a Vitalidade dela simplesmente sumia.
    expect(ordenado(activePillarSet(["alimentacao", "mente"])))
      .toEqual(["mente", "vitalidade"]);
  });

  it("quem já tinha os dois ids não ganha um pilar repetido", () => {
    // Perfil que teve Vitalidade e Alimentação ligadas antes da fusão.
    expect(normalizePillars(["vitalidade", "alimentacao"])).toEqual(["vitalidade"]);
    expect(ordenado(activePillarSet(["vitalidade", "alimentacao"]))).toEqual(["vitalidade"]);
  });

  it("isPillarActive herda a tradução", () => {
    expect(isPillarActive(["alimentacao"], "vitalidade")).toBe(true);
    expect(isPillarActive(["alimentacao"], "prosperidade")).toBe(false);
    expect(isPillarActive(["alimentacao"], "mente")).toBe(false);
  });

  it("os TRACKERS herdam a tradução (o pilar pausado pausa os trackers dele)", () => {
    /* activeTrackerSet compõe `pilarAtivo(t.pillar) && prefs[t.id] !== false`.
       Sem a tradução, este perfil recebia os 12 trackers de volta pelo
       fallback — inclusive os de Prosperidade e Mente, que ela pausou. */
    const ativos = activeTrackerSet({ pillars: ["alimentacao"] });
    expect(ativos.has("meals")).toBe(true);
    expect(ativos.has("sleep")).toBe(true);
    expect(ativos.has("spend_limit")).toBe(false);
    expect(ativos.has("mood")).toBe(false);
  });
});

describe("pillarById traduz o apelido — senão cinco telas degradam caladas", () => {
  /* O id chega do BANCO em cinco lugares: o hábito antigo na Hoje, no Chat e
     no Onboarding, e a proposta de evento na CaptureBar e na Landing. Todos
     usam `pillarById(...)?.algo`, então um `undefined` não derruba nada: só
     apaga a cor e troca o rótulo pelo id cru. Nenhum erra em voz alta, e é
     por isso que a tradução mora DENTRO da função, não em cada chamador. */
  it('pillarById("alimentacao") devolve a Vitalidade, não undefined', () => {
    expect(pillarById("alimentacao")?.id).toBe("vitalidade");
    expect(pillarById("alimentacao")?.name).toBe("Vitalidade");
    expect(pillarById("alimentacao")?.colorVar).toBe("--vitalidade");
  });

  it("id canônico continua respondendo, e lixo continua devolvendo undefined", () => {
    expect(pillarById("mente")?.id).toBe("mente");
    expect(pillarById("saude")).toBeUndefined();
    expect(pillarById("")).toBeUndefined();
  });
});

describe("contar por pilar é tolerante ao valor legado", () => {
  /* O MESMO bug em três lugares diferentes, e todos do mesmo tipo: comparar
     `linha.pillar === p.id` conta a menos para quem mais registrou, enquanto
     o backfill não rodar e enquanto houver instância velha da função no ar
     escrevendo `alimentacao`. Não falha em voz alta: só devolve um número
     menor do que a verdade. */
  const linhas = [
    { pillar: "vitalidade" }, { pillar: "vitalidade" },
    { pillar: "alimentacao" },          // linha antiga, ainda não migrada
    { pillar: "prosperidade" },
  ];

  it("pillarMatchValues casa os dois ids do pilar fundido, e só dele", () => {
    expect(pillarMatchValues("vitalidade").sort()).toEqual(["alimentacao", "vitalidade"]);
    expect(pillarMatchValues("prosperidade")).toEqual(["prosperidade"]);
    expect(pillarMatchValues("mente")).toEqual(["mente"]);
  });

  it("a contagem tolerante enxerga a linha antiga; a intolerante a perde", () => {
    const tolerante = linhas.filter((e) => pillarMatchValues("vitalidade").includes(e.pillar));
    const intolerante = linhas.filter((e) => e.pillar === "vitalidade");
    expect(tolerante).toHaveLength(3);
    expect(intolerante).toHaveLength(2);   // o número que a tela mostrava
  });

  it("agrupar por pilar canônico junta a linha antiga no balde certo", () => {
    // É o que usePillarActivityQuery faz: sem a tradução, `alimentacao` cai
    // num balde que nenhum consumidor lê, porque as telas pedem counts[p.id].
    const c: Record<string, number> = {};
    for (const e of linhas) {
      const id = pillarById(e.pillar)?.id ?? e.pillar;
      c[id] = (c[id] ?? 0) + 1;
    }
    expect(c).toEqual({ vitalidade: 3, prosperidade: 1 });
  });
});

describe("o fallback continua existindo — e continua certo", () => {
  it("sem perfil (carregando) considera tudo ativo", () => {
    expect(ordenado(activePillarSet(undefined))).toEqual(TODOS);
    expect(ordenado(activePillarSet(null))).toEqual(TODOS);
  });

  it("lista VAZIA de verdade continua significando 'todos'", () => {
    // A correção não podia virar "esconder o app quando a lista some": o
    // fallback protege a conta nova, que nasce com `pillars: '{}'`.
    expect(ordenado(activePillarSet([]))).toEqual(TODOS);
  });

  it("uma lista só de lixo cai no fallback, não num app vazio", () => {
    expect(ordenado(activePillarSet(["saude", "financas"]))).toEqual(TODOS);
  });
});

describe("normalizePillars é o que a ESCRITA deve gravar", () => {
  /* A tela que monta o estado dos interruptores a partir da lista CRUA mostra
     Vitalidade desligada para quem a tem ligada — e grava de volta um array em
     que ela nunca esteve. É o mesmo padrão do vazamento do ai_scopes, com
     pilar no lugar de escopo: a pessoa mexe na tela e a consequência é perder
     o que ela tinha. Quem grava passa por aqui primeiro. */
  it("resolve o apelido, descarta o desconhecido e não repete", () => {
    expect(normalizePillars(["alimentacao", "vitalidade", "saude", "mente"]))
      .toEqual(["vitalidade", "mente"]);
  });

  it("a ordem é a de PILLARS, não a de chegada — o array fica estável", () => {
    // Ajustes compara `[...pillars].sort().join("|")` para saber se "mudou?".
    // Ordem instável faria a tela anunciar mudança que não houve.
    expect(normalizePillars(["mente", "alimentacao"])).toEqual(["vitalidade", "mente"]);
    expect(normalizePillars(["alimentacao", "mente"])).toEqual(["vitalidade", "mente"]);
  });

  it("é idempotente: normalizar o que já é canônico não muda nada", () => {
    for (const lista of [[], ["mente"], ["prosperidade", "vitalidade", "mente"]]) {
      expect(normalizePillars(normalizePillars(lista))).toEqual(normalizePillars(lista));
    }
  });

  it("NUNCA transforma uma lista não vazia em lista vazia", () => {
    /* A condição inegociável, e o motivo de ela estar num teste próprio: lista
       não vazia que vira vazia é a porta de entrada do fallback, e o fallback
       aqui devolveria o app inteiro para quem escolheu parte dele. O único
       id legado que existe traduz para um pilar real — se alguém acrescentar
       um apelido que NÃO traduz, este teste não pega; o de cima, sim. */
    expect(normalizePillars(["alimentacao"]).length).toBeGreaterThan(0);
  });
});
