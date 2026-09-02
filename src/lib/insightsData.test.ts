// ASCENDE — Testes da camada de dados da pergunta "isso te ajudou?" (achado #11).
//
// Dois cenários, e os dois são de FALHA — é neles que a garantia da Fase 6
// morria:
//
// 1. `listInsightFeedback` devolvia `[]` no erro. A query resolvia com
//    sucesso, o chamador lia "nunca perguntamos nada" e a pergunta reaparecia
//    para quem já tinha respondido. Agora ela LANÇA, e o chamador tem como
//    escolher o silêncio.
// 2. `answerInsight` fazia UPDATE sem `answer is null`, então a resposta que
//    voltava por causa de (1) sobrescrevia a original e movia `answered_at`.
//    A medida 4 perdia o único dado que vale: o que a pessoa achou do card na
//    primeira vez que o viu.
//
// O dublê imita o que importa do Postgres aqui: o índice único (user_id, kind)
// e o fato de um UPDATE com filtro que não casa NÃO ser erro — é zero linha.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { listInsightFeedback, answerInsight } from "@/lib/insightsData";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  /** A consulta da lista falha (rede, RLS, timeout). */
  failList: false,
}));

vi.mock("@/integrations/supabase/client", () => {
  const matches = (r: Row, filters: Row, answerIsNull: boolean) =>
    Object.entries(filters).every(([c, v]) => r[c] === v)
    && (!answerIsNull || r.answer == null);

  const from = () => ({
    select: () => {
      const filters: Row = {};
      const chain = {
        eq: (col: string, val: unknown) => { filters[col] = val; return chain; },
        maybeSingle: () => {
          const found = state.rows.find((r) => matches(r, filters, false));
          return Promise.resolve({ data: found ?? null, error: null });
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (state.failList) {
            return Promise.resolve({ data: null, error: { message: "sem rede" } }).then(resolve);
          }
          return Promise.resolve({
            data: state.rows.filter((r) => matches(r, filters, false)),
            error: null,
          }).then(resolve);
        },
      };
      return chain;
    },
    update: (patch: Row) => {
      const filters: Row = {};
      let answerIsNull = false;
      const chain = {
        eq: (col: string, val: unknown) => { filters[col] = val; return chain; },
        is: (col: string, val: unknown) => {
          if (col === "answer" && val === null) answerIsNull = true;
          return chain;
        },
        select: () => chain,
        maybeSingle: () => {
          const found = state.rows.find((r) => matches(r, filters, answerIsNull));
          // Filtro que não casa devolve ZERO linha, não erro — é o que faz o
          // chamador precisar distinguir "já respondida" de "não existe".
          if (!found) return Promise.resolve({ data: null, error: null });
          Object.assign(found, patch);
          return Promise.resolve({ data: found, error: null });
        },
      };
      return chain;
    },
    insert: (row: Row) => {
      const chain = {
        select: () => chain,
        maybeSingle: () => {
          const clash = state.rows.some(
            (r) => r.user_id === row.user_id && r.kind === row.kind,
          );
          if (clash) {
            return Promise.resolve({
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            });
          }
          const created = { id: `fb-${state.rows.length + 1}`, asked_at: "2026-09-01T10:00:00Z", ...row };
          state.rows.push(created);
          return Promise.resolve({ data: created, error: null });
        },
      };
      return chain;
    },
  });

  return { supabase: { from } };
});

const USER = "user-1";

/** Uma pergunta já anotada na tela, ainda sem resposta. */
const asked = (kind: string, extra: Row = {}) => ({
  id: `fb-${kind}`,
  user_id: USER,
  kind,
  answer: null,
  asked_at: "2026-09-01T10:00:00Z",
  answered_at: null,
  insight_id: null,
  asked_status: "tendencia",
  ...extra,
});

beforeEach(() => {
  state.rows = [];
  state.failList = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listInsightFeedback", () => {
  it("devolve o que já foi perguntado", async () => {
    state.rows = [asked("sono_gasto_seguinte"), asked("treino_sono", { answer: "sim" })];
    const out = await listInsightFeedback(USER);
    expect(out.map((f) => f.kind)).toEqual(["sono_gasto_seguinte", "treino_sono"]);
    expect(out[1].answer).toBe("sim");
  });

  it("LANÇA em falha, em vez de fingir que nada foi perguntado", async () => {
    state.rows = [asked("sono_gasto_seguinte", { answer: "nao" })];
    state.failList = true;
    // Era aqui que a garantia caía: antes isto resolvia com [].
    await expect(listInsightFeedback(USER)).rejects.toMatchObject({ message: "sem rede" });
  });

  it("sem usuário devolve vazio sem ir ao banco (não é falha, é ausência)", async () => {
    await expect(listInsightFeedback("")).resolves.toEqual([]);
  });
});

describe("answerInsight", () => {
  it("guarda a resposta na linha da pergunta, preservando asked_at", async () => {
    state.rows = [asked("treino_sono")];
    const out = await answerInsight(USER, "treino_sono", "sim");
    expect(out?.answer).toBe("sim");
    expect(out?.asked_at).toBe("2026-09-01T10:00:00Z");
    expect(out?.answered_at).not.toBeNull();
    expect(state.rows).toHaveLength(1);
  });

  it("o cenário da nota: a segunda resposta NÃO sobrescreve a primeira", async () => {
    state.rows = [asked("sono_gasto_seguinte", {
      answer: "nao", answered_at: "2026-09-02T08:00:00Z",
    })];

    // A pergunta reapareceu (lista de perguntadas veio vazia por falha) e a
    // pessoa respondeu de novo, agora "sim".
    const out = await answerInsight(USER, "sono_gasto_seguinte", "sim");

    // Vale a primeira: nem a resposta nem o instante se movem.
    expect(out?.answer).toBe("nao");
    expect(out?.answered_at).toBe("2026-09-02T08:00:00Z");
    expect(state.rows[0].answer).toBe("nao");
    expect(state.rows[0].answered_at).toBe("2026-09-02T08:00:00Z");
  });

  it("não duplica linha ao reencontrar uma pergunta já respondida", async () => {
    state.rows = [asked("treino_sono", { answer: "sim", answered_at: "2026-09-02T08:00:00Z" })];
    await answerInsight(USER, "treino_sono", "nao");
    // Sem o reencontro, o fallback inserira e levaria 23505 na cara da pessoa.
    expect(state.rows).toHaveLength(1);
  });

  it("cria a linha quando a anotação da pergunta não chegou ao banco", async () => {
    const out = await answerInsight(USER, "refeicao_gasto_comida", "sim");
    expect(out?.answer).toBe("sim");
    expect(state.rows).toHaveLength(1);
  });

  it("a linha criada nasce com asked_status, senão a medida 4 não a vê", async () => {
    // A view da Fase 6 filtra `asked_status = 'tendencia'`: sem a coluna, a
    // resposta ficaria guardada e invisível para a medida que ela alimenta.
    await answerInsight(USER, "refeicao_gasto_comida", "sim");
    expect(state.rows[0].asked_status).toBe("tendencia");
  });

  it("responder uma análise não mexe na resposta de outra", async () => {
    state.rows = [
      asked("sono_gasto_seguinte", { answer: "nao" }),
      asked("treino_sono"),
    ];
    await answerInsight(USER, "treino_sono", "sim");
    expect(state.rows[0].answer).toBe("nao");
    expect(state.rows[1].answer).toBe("sim");
  });
});
