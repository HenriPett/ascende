// ASCENDE — Testes das chaves de registro da fatura.
//
// O que está em jogo: a chave é o que impede a MESMA fatura de virar
// lançamento em dobro — e, no outro extremo, é o que não pode colapsar duas
// compras iguais de verdade. Errar para qualquer lado mexe no dinheiro que a
// pessoa acha que tem.
import { describe, it, expect, vi, beforeEach } from "vitest";

/* O módulo cria o cliente do Supabase no topo (localStorage, .env). O dublê
   abaixo devolve o que o teste mandar — inclusive ERRO, que é o cenário do
   achado: a conferência de duplicatas falhando em silêncio. */
const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
  consultas: 0,
}));

vi.mock("@/integrations/supabase/client", () => {
  const result = () => {
    db.consultas++;
    return Promise.resolve(db.error ? { data: null, error: db.error } : { data: db.rows, error: null });
  };
  const chain = () => {
    const self = {
      select: () => self, eq: () => self, gte: () => self, lte: () => self,
      limit: () => result(),
    };
    return self;
  };
  return { supabase: { from: () => chain() } };
});

import {
  statementRecordKeys, findStatementDuplicates,
  StatementDuplicateCheckError, PARSER_VERSION,
} from "@/lib/statementImport";
import type { ProposedStatementTx } from "@/lib/prosperidade";

beforeEach(() => { db.rows = []; db.error = null; db.consultas = 0; });

const tx = (
  description: string, amount: number, occurred_at: string,
  kind: "income" | "expense" = "expense",
): ProposedStatementTx => ({ kind, amount, category: "Outros", description, occurred_at });

describe("statementRecordKeys", () => {
  it("devolve uma chave por item, alinhada por índice", () => {
    const list = [tx("Mercado", 120.5, "2026-08-03"), tx("Uber", 23, "2026-08-04")];
    const keys = statementRecordKeys(list);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toContain("mercado");
    expect(keys[1]).toContain("uber");
  });

  it("não depende da ordem em que os itens chegam", () => {
    const a = tx("Mercado", 120.5, "2026-08-03");
    const b = tx("Uber", 23, "2026-08-04");
    const c = tx("Farmácia", 89.9, "2026-08-05");
    const direta = statementRecordKeys([a, b, c]);
    const invertida = statementRecordKeys([c, b, a]);
    expect(invertida).toEqual([direta[2], direta[1], direta[0]]);
  });

  it("separa compras idênticas no mesmo dia em vez de colapsá-las", () => {
    // Dois cafés na mesma padaria no mesmo dia aconteceram os dois.
    const keys = statementRecordKeys([
      tx("Padaria", 12, "2026-08-03"),
      tx("Padaria", 12, "2026-08-03"),
      tx("Padaria", 12, "2026-08-03"),
    ]);
    expect(new Set(keys).size).toBe(3);
    expect(keys[1]).toMatch(/#2$/);
    expect(keys[2]).toMatch(/#3$/);
  });

  it("distingue o mesmo valor em DIAS diferentes (o mês não basta)", () => {
    const keys = statementRecordKeys([
      tx("Assinatura", 39.9, "2026-08-03"),
      tx("Assinatura", 39.9, "2026-08-17"),
    ]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("distingue entrada de saída, e valores diferentes", () => {
    const [saida, entrada] = statementRecordKeys([
      tx("Transferência", 100, "2026-08-03", "expense"),
      tx("Transferência", 100, "2026-08-03", "income"),
    ]);
    expect(saida).not.toBe(entrada);
    const [a, b] = statementRecordKeys([
      tx("Mercado", 120.5, "2026-08-03"),
      tx("Mercado", 120.51, "2026-08-03"),
    ]);
    expect(a).not.toBe(b);
  });

  it("ignora diferenças de caixa e espaço na descrição (o mesmo item é o mesmo)", () => {
    const [a] = statementRecordKeys([tx("  MERCADO   central ", 120.5, "2026-08-03")]);
    const [b] = statementRecordKeys([tx("mercado central", 120.5, "2026-08-03")]);
    expect(a).toBe(b);
  });

  it("é estável entre leituras do mesmo documento", () => {
    const doc = () => [
      tx("Mercado", 120.5, "2026-08-03"),
      tx("Padaria", 12, "2026-08-03"),
      tx("Padaria", 12, "2026-08-03"),
    ];
    expect(statementRecordKeys(doc())).toEqual(statementRecordKeys(doc()));
  });
});

describe("PARSER_VERSION", () => {
  it("identifica a regra que produziu os lançamentos", () => {
    expect(PARSER_VERSION).toBe("statement/1");
  });
});


describe("findStatementDuplicates", () => {
  const fatura: ProposedStatementTx[] = [
    { kind: "expense", amount: 120.5, category: "Mercado", description: "Mercado", occurred_at: "2026-08-03" },
    { kind: "expense", amount: 23, category: "Transporte", description: "Uber", occurred_at: "2026-08-04" },
  ];

  it("marca como duplicata o que já está registrado", async () => {
    db.rows = [{ kind: "expense", amount: 120.5, description: "Mercado", occurred_at: "2026-08-03" }];
    expect(await findStatementDuplicates("u1", fatura)).toEqual([true, false]);
  });

  it("ERRO DE CONSULTA LANÇA em vez de dizer 'nada duplicado'", async () => {
    // O cenário do achado: a consulta falha (rede instável, RLS, timeout) e a
    // versão antiga devolvia [false, false]. A tela lia isso como "pode marcar
    // tudo", a pessoa confirmava, e a fatura inteira entrava DE NOVO.
    db.error = { message: "network error" };
    await expect(findStatementDuplicates("u1", fatura)).rejects.toBeInstanceOf(StatementDuplicateCheckError);
    // E a mensagem é para a pessoa, não para o log.
    await expect(findStatementDuplicates("u1", fatura)).rejects.toThrow(/Tente de novo/);
  });

  it("lista vazia não consulta o banco", async () => {
    expect(await findStatementDuplicates("u1", [])).toEqual([]);
    expect(db.consultas).toBe(0);
  });
});

/* A partição do recibo (importOutcome) é a MESMA para fatura e arquivo de
   saúde, então os testes dela vivem em dataSources.test.ts, junto do resto
   da camada de proveniência. */
