// ASCENDE — Testes da gravação em lote com proveniência.
//
// O critério de aceite que este arquivo protege (§4.4): reimportar o mesmo
// arquivo NÃO cria eventos novos, não falha na cara da pessoa, e o que já
// estava lá é CONTADO como duplicata para aparecer no recibo.
//
// O dublê do Supabase abaixo imita o que importa do Postgres de verdade: o
// índice único parcial (user_id, data_source_id, source_record_key) e o fato
// de um insert em lote ser UMA transação — uma linha repetida derruba as 100.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { lifeEventRow, saveImportedEvents, type ProposedEvent } from "@/lib/captureEvents";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  /** Simula a consulta de chaves existentes falhando (rede, RLS, timeout). */
  failKeyLookup: false,
  /** Simula um erro que NÃO é duplicata: tem de estourar para cima. */
  failInsert: false,
}));

vi.mock("@/integrations/supabase/client", () => {
  const uniqueKey = (r: Row): string | null =>
    r.data_source_id && r.source_record_key
      ? `${r.user_id}|${r.data_source_id}|${r.source_record_key}`
      : null;

  const insert = (payload: Row | Row[]) => {
    const rows = Array.isArray(payload) ? payload : [payload];
    if (state.failInsert) {
      return Promise.resolve({ data: null, error: { code: "XX000", message: "banco fora do ar" } });
    }
    const staged = new Set<string>();
    for (const r of rows) {
      const k = uniqueKey(r);
      if (!k) continue;
      if (staged.has(k) || state.rows.some((x) => uniqueKey(x) === k)) {
        // Uma violação aborta o lote inteiro, como no Postgres.
        return Promise.resolve({
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        });
      }
      staged.add(k);
    }
    state.rows.push(...rows);
    return Promise.resolve({ data: null, error: null });
  };

  return {
    supabase: {
      from: () => ({
        insert,
        select: () => {
          const filters: Row = {};
          const chain = {
            eq: (col: string, val: unknown) => { filters[col] = val; return chain; },
            not: () => chain,
            limit: () => Promise.resolve(
              state.failKeyLookup
                ? { data: null, error: { code: "XX000", message: "sem rede" } }
                : {
                    data: state.rows
                      .filter((r) => Object.entries(filters).every(([c, v]) => r[c] === v))
                      .filter((r) => r.source_record_key != null)
                      .map((r) => ({ source_record_key: r.source_record_key })),
                    error: null,
                  },
            ),
          };
          return chain;
        },
      }),
    },
  };
});

const USER = "user-1";
const SOURCE = "source-1";

/** Eventos como o healthImport entrega: com dia, instante e chave estável. */
const sleepNights = (days: string[]): ProposedEvent[] => days.map((day) => ({
  kind: "sleep",
  pillar: "vitalidade",
  summary: `Sono de ${day}`,
  hours: 7.5,
  occurred_at: `${day}T08:00:00-03:00`,
  record_key: `sleep|${day}`,
}));

const DAYS = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];

beforeEach(() => {
  state.rows = [];
  state.failKeyLookup = false;
  state.failInsert = false;
});

describe("lifeEventRow", () => {
  const ev: ProposedEvent = {
    kind: "sleep", pillar: "vitalidade", summary: "Sono", hours: 7,
    occurred_at: "2026-08-01T08:00:00-03:00", record_key: "sleep|2026-08-01",
  };

  it("grava fonte e chave quando as duas existem", () => {
    const row = lifeEventRow(USER, ev, "import", null, SOURCE) as Row;
    expect(row.data_source_id).toBe(SOURCE);
    expect(row.source_record_key).toBe("sleep|2026-08-01");
    expect(row.source).toBe("import");
    expect(row.occurred_at).toBe("2026-08-01T08:00:00-03:00");
  });

  it("mantém o vínculo com o arquivo mesmo sem chave de registro", () => {
    const row = lifeEventRow(USER, { ...ev, record_key: undefined }, "import", null, SOURCE) as Row;
    expect(row.data_source_id).toBe(SOURCE);
    expect("source_record_key" in row).toBe(false);
  });

  it("não inventa proveniência para a captura por texto", () => {
    const row = lifeEventRow(USER, ev, "chat_capture") as Row;
    expect("data_source_id" in row).toBe(false);
    expect("source_record_key" in row).toBe(false);
  });
});

describe("saveImportedEvents", () => {
  it("grava tudo na primeira importação, com origem", async () => {
    const r = await saveImportedEvents(USER, sleepNights(DAYS), undefined, { dataSourceId: SOURCE });
    expect(r).toEqual({ total: 5, accepted: 5, duplicates: 0 });
    expect(state.rows).toHaveLength(5);
    expect(state.rows.every((row) => row.data_source_id === SOURCE)).toBe(true);
    expect(state.rows.map((row) => row.source_record_key)).toEqual(DAYS.map((d) => `sleep|${d}`));
  });

  it("reimportar o MESMO arquivo não cria nada e conta tudo como duplicata", async () => {
    await saveImportedEvents(USER, sleepNights(DAYS), undefined, { dataSourceId: SOURCE });
    const again = await saveImportedEvents(USER, sleepNights(DAYS), undefined, { dataSourceId: SOURCE });
    expect(again).toEqual({ total: 5, accepted: 0, duplicates: 5 });
    expect(state.rows).toHaveLength(5); // nada foi duplicado
  });

  it("importar o arquivo atualizado grava só as linhas novas", async () => {
    await saveImportedEvents(USER, sleepNights(DAYS), undefined, { dataSourceId: SOURCE });
    const updated = sleepNights([...DAYS, "2026-08-06", "2026-08-07"]);
    const r = await saveImportedEvents(USER, updated, undefined, { dataSourceId: SOURCE });
    expect(r).toEqual({ total: 7, accepted: 2, duplicates: 5 });
    expect(state.rows).toHaveLength(7);
  });

  it("sem a consulta de chaves, a duplicata é resolvida pelo erro do banco", async () => {
    await saveImportedEvents(USER, sleepNights(DAYS), undefined, { dataSourceId: SOURCE });
    // A consulta prévia falha: o lote inteiro é reenviado, leva 23505, e o
    // reenvio linha a linha separa o que entra do que já existia.
    state.failKeyLookup = true;
    const r = await saveImportedEvents(
      USER, sleepNights([...DAYS, "2026-08-06"]), undefined, { dataSourceId: SOURCE },
    );
    expect(r).toEqual({ total: 6, accepted: 1, duplicates: 5 });
    expect(state.rows).toHaveLength(6);
  });

  it("uma duplicata no meio não impede as outras linhas do lote", async () => {
    // Chunk pequeno para o lote conter duplicata e novidade ao mesmo tempo.
    await saveImportedEvents(USER, sleepNights(["2026-08-03"]), undefined, { dataSourceId: SOURCE });
    state.failKeyLookup = true;
    const r = await saveImportedEvents(USER, sleepNights(DAYS), undefined, {
      dataSourceId: SOURCE, chunkSize: 5,
    });
    expect(r).toEqual({ total: 5, accepted: 4, duplicates: 1 });
    expect(state.rows).toHaveLength(5);
  });

  it("erro que não é duplicata estoura para cima (nada de falha silenciosa)", async () => {
    state.failInsert = true;
    await expect(
      saveImportedEvents(USER, sleepNights(DAYS), undefined, { dataSourceId: SOURCE }),
    ).rejects.toMatchObject({ code: "XX000" });
  });

  it("sem fonte, grava como antes e não escreve colunas de proveniência", async () => {
    const r = await saveImportedEvents(USER, sleepNights(DAYS));
    expect(r).toEqual({ total: 5, accepted: 5, duplicates: 0 });
    expect(state.rows.every((row) => !("data_source_id" in row))).toBe(true);
  });

  it("não grava transação por aqui (fatura tem tela própria)", async () => {
    const events: ProposedEvent[] = [
      ...sleepNights(["2026-08-01"]),
      { kind: "transaction", pillar: "prosperidade", summary: "Mercado", amount: 47 },
    ];
    const r = await saveImportedEvents(USER, events, undefined, { dataSourceId: SOURCE });
    expect(r).toEqual({ total: 1, accepted: 1, duplicates: 0 });
    expect(state.rows).toHaveLength(1);
  });

  it("informa o progresso em cima do que vai ser gravado", async () => {
    const seen: [number, number][] = [];
    await saveImportedEvents(USER, sleepNights(DAYS), (done, total) => seen.push([done, total]), {
      dataSourceId: SOURCE, chunkSize: 2,
    });
    expect(seen).toEqual([[2, 5], [4, 5], [5, 5]]);
  });
});
