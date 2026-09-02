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
import {
  lifeEventRow, saveImportedEvents, saveProposedEvents,
  discardedValueWarnings, transactionRefusal, type ProposedEvent,
  checkCaptureDate, CAPTURE_MAX_PAST_DAYS, eventHasOwnSubstance,
} from "@/lib/captureEvents";
import { todayISOInSP } from "@/lib/dates";
import { BODY_WEIGHT_RANGE_LABEL } from "@/lib/bodyWeight";

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

  /* `__table` é acrescentado pelo dublê, não pelo código sob teste: a captura
     grava em DUAS tabelas (transactions e life_events) e as asserções de #9
     precisam saber em qual a linha caiu. Os testes antigos olham campos da
     própria linha e não são afetados por um campo extra. */
  const insert = (table: string) => (payload: Row | Row[]) => {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ __table: table, ...r }));
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
      from: (table: string) => ({
        insert: insert(table),
        /* `existingRecordKeys` PAGINA (dataSources.ts): .order().range(), e não
           mais .limit(). O dublê acompanha a cadeia real — ordenado por
           `source_record_key` e servido em faixas —, porque um dublê que
           aceita uma chamada que o Postgres não recebe deixa de provar algo. */
        select: () => {
          const filters: Row = {};
          const page = () => state.rows
            .filter((r) => Object.entries(filters).every(([c, v]) => r[c] === v))
            .filter((r) => r.source_record_key != null)
            .map((r) => ({ source_record_key: String(r.source_record_key) }))
            .sort((a, b) => a.source_record_key.localeCompare(b.source_record_key));
          const chain = {
            eq: (col: string, val: unknown) => { filters[col] = val; return chain; },
            not: () => chain,
            order: () => chain,
            range: (from: number, to: number) => Promise.resolve(
              state.failKeyLookup
                ? { data: null, error: { code: "XX000", message: "sem rede" } }
                : { data: page().slice(from, to + 1), error: null },
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

/* ─── Achado #19: barra de progresso quando tudo era duplicata ─────────── */
describe("saveImportedEvents · progresso sem nada a gravar", () => {
  it("avisa o progresso mesmo quando todas as linhas eram duplicata", async () => {
    await saveImportedEvents(USER, sleepNights(DAYS), undefined, { dataSourceId: SOURCE });
    const seen: [number, number][] = [];
    const r = await saveImportedEvents(
      USER, sleepNights(DAYS), (done, total) => seen.push([done, total]), { dataSourceId: SOURCE },
    );
    expect(r).toEqual({ total: 5, accepted: 0, duplicates: 5 });
    // Antes o laco nao rodava e `seen` ficava vazio: a barra parava em 0%.
    expect(seen).toEqual([[1, 1]]);
    // Nunca (0, 0): o chamador faz done/total e um total zero daria NaN.
    expect(seen.every(([, total]) => total > 0)).toBe(true);
  });
});

/* ─── Achado #9: lancamento financeiro sem valor ────────────────────────── */
describe("transactionRefusal", () => {
  const tx = (extra: Partial<ProposedEvent> = {}): ProposedEvent => ({
    kind: "transaction", pillar: "prosperidade", summary: "Mercado", ...extra,
  });

  it("recusa valor zero", () => {
    expect(transactionRefusal(tx({ amount: 0 }))).toContain("precisa de um valor");
  });

  it("recusa valor ausente", () => {
    expect(transactionRefusal(tx())).toContain("precisa de um valor");
  });

  it("recusa valor negativo e valor ilegivel", () => {
    expect(transactionRefusal(tx({ amount: -47 }))).not.toBeNull();
    expect(transactionRefusal(tx({ amount: Number.NaN }))).not.toBeNull();
  });

  it("cita o resumo da proposta, para a pessoa saber QUAL foi recusada", () => {
    expect(transactionRefusal(tx({ summary: "Mercado", amount: 0 }))).toContain('"Mercado"');
  });

  it("nao mexe em lancamento valido nem em evento que nao e transacao", () => {
    expect(transactionRefusal(tx({ amount: 47 }))).toBeNull();
    expect(transactionRefusal({ kind: "sleep", pillar: "vitalidade", summary: "Sono" })).toBeNull();
  });
});

describe("saveProposedEvents · transacao sem valor", () => {
  it("o cenario da nota: amount 0 NAO vira evento fantasma na linha do tempo", async () => {
    const r = await saveProposedEvents(USER, [
      { kind: "transaction", pillar: "prosperidade", summary: "Mercado", amount: 0 },
    ]);
    expect(r.saved).toBe(0);
    // Antes caia no `else` e nascia um life_events kind:"transaction" sem
    // valor: aparecia na linha do tempo, pagava XP, e o mes nao se movia.
    expect(state.rows).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("Mercado");
  });

  it("recusar uma proposta nao derruba as outras do mesmo lote", async () => {
    const r = await saveProposedEvents(USER, [
      { kind: "transaction", pillar: "prosperidade", summary: "Sem valor" },
      { kind: "sleep", pillar: "vitalidade", summary: "Sono", hours: 7 },
      { kind: "transaction", pillar: "prosperidade", summary: "Mercado", amount: 47 },
    ]);
    expect(r.saved).toBe(2);
    expect(r.warnings).toHaveLength(1);
    expect(state.rows.map((row) => row.__table)).toEqual(["life_events", "transactions"]);
  });

  it("lancamento valido continua indo para transactions, nao para life_events", async () => {
    const r = await saveProposedEvents(USER, [
      { kind: "transaction", pillar: "prosperidade", summary: "Mercado", amount: 47, category: "Mercado" },
    ]);
    expect(r).toMatchObject({ saved: 1, warnings: [] });
    expect(r.savedEvents.map((e) => e.summary)).toEqual(["Mercado"]);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].__table).toBe("transactions");
    expect(state.rows[0].amount).toBe(47);
    expect(state.rows[0].source).toBe("capture");
  });
});

/* ─── Achado #21: data do lancamento vinda em UTC ───────────────────────── */
describe("saveProposedEvents · data do lancamento", () => {
  const gasto = (occurred_at?: string): ProposedEvent => ({
    kind: "transaction", pillar: "prosperidade", summary: "Mercado", amount: 47, occurred_at,
  });

  it("carimbo em UTC nao empurra o gasto para o dia seguinte", async () => {
    // 22:15 de 03/08 em SP chega como 01:15 de 04/08 em UTC. O `slice(0, 10)`
    // dava "2026-08-04"; o dia que a pessoa viveu e 03.
    await saveProposedEvents(USER, [gasto("2026-08-04T01:15:39Z")]);
    expect(state.rows[0].occurred_at).toBe("2026-08-03");
  });

  it("virada de MES em UTC nao joga o gasto no mes errado", async () => {
    // 01/09 00:30 UTC = 31/08 21:30 em SP: o gasto e de agosto.
    await saveProposedEvents(USER, [gasto("2026-09-01T00:30:00Z")]);
    expect(state.rows[0].occurred_at).toBe("2026-08-31");
  });

  it("carimbo com o offset prometido continua igual ao que era antes", async () => {
    await saveProposedEvents(USER, [gasto("2026-08-03T22:15:39-03:00")]);
    expect(state.rows[0].occurred_at).toBe("2026-08-03");
  });

  it("sem carimbo nenhum e hoje — o caminho da captura por texto comum", async () => {
    await saveProposedEvents(USER, [gasto(undefined)]);
    expect(state.rows.map((r) => r.occurred_at)).toEqual([todayISOInSP()]);
  });

  it("carimbo ILEGIVEL e recusado, nao datado como hoje no chute", async () => {
    /* Mudanca de comportamento consciente: datar como hoje um carimbo que
       nao deu para ler e inventar a data da pessoa. Recusar diz a verdade. */
    const r = await saveProposedEvents(USER, [gasto("nem data")]);
    expect(r.saved).toBe(0);
    expect(state.rows).toHaveLength(0);
    expect(r.warnings[0]).toContain("não consegui entender a data");
  });
});

/* ─── Achado #10: valor fora de faixa descartado em silencio ────────────── */
describe("discardedValueWarnings", () => {
  const ev = (extra: Partial<ProposedEvent>): ProposedEvent => ({
    kind: "weight", pillar: "alimentacao", summary: "Peso", ...extra,
  });

  it("o cenario da nota: 18kg fora da faixa vira aviso, com o numero e a faixa", () => {
    const [aviso] = discardedValueWarnings(ev({ kg: 18 }));
    expect(aviso).toContain("18");
    expect(aviso).toContain("de 20 a 400 kg");
    expect(aviso).toContain("Não registrei o peso");
  });

  it("peso dentro da faixa nao gera aviso nenhum", () => {
    expect(discardedValueWarnings(ev({ kg: 78 }))).toEqual([]);
  });

  it("20 e 400 sao ACEITOS: a faixa e inclusiva nos dois lados", () => {
    /* Mudou de exclusivo para inclusivo (lib/bodyWeight). O motivo esta na
       propria mensagem: ela promete "de 20 a 400 kg", e "de 20 a 400" inclui
       20 e 400 em portugues — recusar 20,0 citando essa faixa era o app se
       contradizendo na mesma frase. */
    expect(discardedValueWarnings(ev({ kg: 20 }))).toEqual([]);
    expect(discardedValueWarnings(ev({ kg: 400 }))).toEqual([]);
    expect(discardedValueWarnings(ev({ kg: 20.1 }))).toEqual([]);
    expect(discardedValueWarnings(ev({ kg: 399.9 }))).toEqual([]);
  });

  it("fora da faixa continua recusado: erro de unidade e lixo de coluna", () => {
    // O que a faixa existe para barrar: gramas na coluna de kg, e lixo.
    expect(discardedValueWarnings(ev({ kg: 19.9 }))).toHaveLength(1);
    expect(discardedValueWarnings(ev({ kg: 400.1 }))).toHaveLength(1);
    expect(discardedValueWarnings(ev({ kg: 0.3 }))).toHaveLength(1);
    expect(discardedValueWarnings(ev({ kg: 78000 }))).toHaveLength(1);
  });

  it("a mensagem cita a faixa vinda das constantes, nao uma string solta", () => {
    const [aviso] = discardedValueWarnings(ev({ kg: 19.9 }));
    expect(aviso).toContain(BODY_WEIGHT_RANGE_LABEL);
  });

  it("valor ausente nao e recusa (a proposta simplesmente nao trouxe)", () => {
    expect(discardedValueWarnings(ev({}))).toEqual([]);
  });

  it("nutriente, duracao, agua e humor zerados tambem sao avisados", () => {
    expect(discardedValueWarnings({
      kind: "meal", pillar: "alimentacao", summary: "Almoco",
      calories: 0, protein_g: 0, duration_min: 0, ml: 0, mood_score: 0,
    })).toHaveLength(5);
  });

  it("avisa um por valor recusado, nao um por evento", () => {
    expect(discardedValueWarnings(ev({ kg: 5, calories: -1 }))).toHaveLength(2);
  });
});

describe("saveProposedEvents · valor recusado", () => {
  it("o valor recusado NAO entra, e o registro tambem nao quando era tudo", async () => {
    /* Este teste dizia o contrario ("o evento ainda entra, o resumo vale") e
       era eu preservando o comportamento de entao. Estava errado: o resumo
       "Me pesei: 18kg" NAO vale sozinho — ele afirma um numero que o payload
       recusou, e foi assim que o app disse "nao registrei o peso" e "Peso:
       18 kg · +3 XP" na mesma respiracao. Sem o kg, a pesagem nao e um
       registro sobre o corpo da pessoa: e uma frase. */
    const r = await saveProposedEvents(USER, [
      { kind: "weight", pillar: "alimentacao", summary: "Me pesei: 18kg", kg: 18 },
    ]);
    expect(r.saved).toBe(0);
    expect(state.rows).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("18");
  });

  it("caminho feliz nao produz aviso nenhum", async () => {
    const r = await saveProposedEvents(USER, [
      { kind: "weight", pillar: "alimentacao", summary: "Me pesei: 78kg", kg: 78 },
    ]);
    expect(r).toMatchObject({ saved: 1, warnings: [] });
  });
});

/* ─── ACHADO ALTA Nº 1 (Sentinela): data no passado ─────────────────────────
   Reproduzido em producao: "ontem gastei 22 no posto de gasolina" gravou
   occurred_at = 2024-12-20 (621 dias errados), disse "registrei" e pagou XP.
   O modelo resolve "ontem" contra o "hoje" que ELE acha que e. Estes testes
   fixam as duas metades do conserto: o dia CERTO e gravado, e o dia absurdo
   e RECUSADO sem gravar nada. */
const HOJE = "2026-09-02";  // o dia da reproducao do Sentinela

describe("checkCaptureDate", () => {
  it("ONTEM (o cenario que quebrou) e aceito e vira meio-dia no fuso do app", () => {
    const c = checkCaptureDate("2026-09-01", HOJE);
    expect(c.reason).toBeNull();
    expect(c.dateISO).toBe("2026-09-01");
    // Meio-dia, e nao meia-noite UTC: crua, "2026-09-01" viraria 21:00 de
    // 31/08 em Sao Paulo, e o sono de ontem nasceria anteontem.
    expect(c.instant).toBe("2026-09-01T12:00:00-03:00");
  });

  it("a data exata do bug (2024-12-20) e RECUSADA, com o motivo em numeros", () => {
    const c = checkCaptureDate("2024-12-20", HOJE);
    expect(c.dateISO).toBeNull();
    expect(c.instant).toBeNull();
    expect(c.reason).toContain("2024-12-20");
    expect(c.reason).toContain("621 dias no passado");
  });

  it("recusa as outras quatro datas reproduzidas em producao", () => {
    for (const d of ["2024-12-18", "2024-12-27", "2024-12-28", "2025-07-13"]) {
      expect(checkCaptureDate(d, HOJE).reason, d).not.toBeNull();
    }
  });

  it("hoje e sempre aceito, com e sem carimbo", () => {
    expect(checkCaptureDate(HOJE, HOJE).dateISO).toBe(HOJE);
    expect(checkCaptureDate(undefined, HOJE)).toEqual(
      { reason: null, dateISO: HOJE, instant: null },
    );
  });

  it("data no futuro e recusada (captura nao registra o que nao aconteceu)", () => {
    expect(checkCaptureDate("2026-09-03", HOJE).reason).toContain("futuro");
  });

  it("a fronteira e exatamente CAPTURE_MAX_PAST_DAYS", () => {
    const diasAtras = (n: number) => {
      const t = Date.UTC(2026, 8, 2) - n * 86_400_000;
      return new Date(t).toISOString().slice(0, 10);
    };
    expect(checkCaptureDate(diasAtras(CAPTURE_MAX_PAST_DAYS), HOJE).reason).toBeNull();
    expect(checkCaptureDate(diasAtras(CAPTURE_MAX_PAST_DAYS + 1), HOJE).reason).not.toBeNull();
  });

  it("carimbo COM hora e respeitado, e o dia sai pelo fuso do app", () => {
    // 22:00 de 01/09 em SP chega como 01:00 de 02/09 em UTC.
    const c = checkCaptureDate("2026-09-02T01:00:00Z", HOJE);
    expect(c.dateISO).toBe("2026-09-01");
    expect(c.instant).toBe("2026-09-02T01:00:00Z");
  });
});

describe("saveProposedEvents · o cenario exato do Sentinela", () => {
  /* A frase que quebrou tudo: gasto E sono, os dois com data de ontem. */
  const ontem = (): ProposedEvent[] => [
    {
      kind: "transaction", pillar: "prosperidade", amount: 22, category: "Transporte",
      summary: "Gasto de R$ 22 no posto de gasolina", occurred_at: "2026-09-01",
    },
    {
      kind: "sleep", pillar: "vitalidade", hours: 5,
      summary: "Sono: 5 horas (ontem)", occurred_at: "2026-09-01",
    },
  ];

  it("gasto de ONTEM grava no dia de ontem, em transactions", async () => {
    const r = await saveProposedEvents(USER, [ontem()[0]], null, HOJE);
    expect(r.saved).toBe(1);
    expect(r.warnings).toEqual([]);
    const tx = state.rows.find((x) => x.__table === "transactions");
    // Era aqui que aparecia "2024-12-20".
    expect(tx?.occurred_at).toBe("2026-09-01");
  });

  it("sono de ONTEM grava no dia de ontem, e nao anteontem", async () => {
    await saveProposedEvents(USER, [ontem()[1]], null, HOJE);
    const ev = state.rows.find((x) => x.__table === "life_events");
    expect(ev?.occurred_at).toBe("2026-09-01T12:00:00-03:00");
    // Meia-noite UTC cairia em 31/08 no fuso do app: o bug irmao deste.
    expect(String(ev?.occurred_at)).not.toBe("2026-09-01");
  });

  it("gasto + sono na mesma frase entram os DOIS, no dia certo", async () => {
    const r = await saveProposedEvents(USER, ontem(), null, HOJE);
    expect(r.saved).toBe(2);
    expect(r.savedEvents).toHaveLength(2);
    expect(state.rows.map((x) => x.__table).sort()).toEqual(["life_events", "transactions"]);
  });

  it("data absurda: NADA gravado, motivo na mao da tela, e ZERO XP a anunciar", async () => {
    const r = await saveProposedEvents(
      USER,
      ontem().map((e) => ({ ...e, occurred_at: "2024-12-20" })),
      null, HOJE,
    );
    expect(r.saved).toBe(0);
    expect(r.savedEvents).toEqual([]);   // e daqui que a tela soma o XP
    expect(state.rows).toHaveLength(0);  // nada entrou, nem gasto nem sono
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain("posto de gasolina");
    expect(r.warnings[0]).toContain("2024-12-20");
    expect(r.warnings[1]).toContain("Sono");
  });

  it("uma data ruim nao leva as boas com ela", async () => {
    const r = await saveProposedEvents(USER, [
      { ...ontem()[0], occurred_at: "2024-12-20" },
      ontem()[1],
    ], null, HOJE);
    expect(r.saved).toBe(1);
    expect(r.savedEvents[0].kind).toBe("sleep");
    expect(r.warnings).toHaveLength(1);
  });

  it("importacao NAO passa pela checagem: arquivo de 2023 e legitimo", async () => {
    // A data da importacao vem do arquivo, nao de um modelo. O export de sono
    // de 2023 na conta de teste e dado real da pessoa e tem de entrar.
    const r = await saveImportedEvents(USER, sleepNights(["2023-01-16", "2023-01-17"]),
      undefined, { dataSourceId: SOURCE });
    expect(r).toEqual({ total: 2, accepted: 2, duplicates: 0 });
    expect(state.rows).toHaveLength(2);
  });
});

describe("saveProposedEvents · pesagem de exatamente 20,0 kg (bug da fronteira)", () => {
  it("o valor que o cartao mostrou e o valor que o payload guarda", async () => {
    /* O bug fechado: 20,0 kg aparecia no cartao de revisao, a pessoa
       confirmava, e a gravacao respondia que 20 kg esta fora do aceito —
       contradicao na MESMA tela. Agora entra, e entra COM o numero. */
    const r = await saveProposedEvents(USER, [
      { kind: "weight", pillar: "alimentacao", summary: "Me pesei: 20kg", kg: 20 },
    ]);
    expect(r.saved).toBe(1);
    expect(r.warnings).toEqual([]);
    expect((state.rows[0].payload as Row).kg).toBe(20);
  });

  it("400,0 kg tambem entra com o numero", async () => {
    const r = await saveProposedEvents(USER, [
      { kind: "weight", pillar: "alimentacao", summary: "Me pesei: 400kg", kg: 400 },
    ]);
    expect(r.warnings).toEqual([]);
    expect((state.rows[0].payload as Row).kg).toBe(400);
  });

  it("18 kg: NADA gravado, um aviso so, e zero XP a anunciar", async () => {
    /* Contradicao que o Sentinela pegou em producao: vinham DOIS toasts —
       "Nao registrei o peso: 18 kg esta fora do que eu aceito" e, na linha
       seguinte, "Peso: 18 kg · +3 XP" — e o XP subia de verdade (706 -> 709)
       enquanto o peso nao aparecia em Corpo. O aviso e a cobranca de XP na
       mesma respiracao. Agora vale a regua da transacao sem valor. */
    const r = await saveProposedEvents(USER, [
      { kind: "weight", pillar: "alimentacao", summary: "Me pesei: 18kg", kg: 18 },
    ]);
    expect(r.saved).toBe(0);
    expect(r.savedEvents).toEqual([]);   // e daqui que a tela soma o XP
    expect(state.rows).toHaveLength(0);  // nada entrou em life_events
    expect(r.warnings).toHaveLength(1);  // UM aviso, nao dois
    expect(r.warnings[0]).toContain("18 kg");
    expect(r.warnings[0]).toContain(BODY_WEIGHT_RANGE_LABEL);
    expect(r.warnings[0]).toContain("único dado desse registro");
  });
});

/* ─── A REGUA: valor recusado derruba o registro so quando era tudo ─────── */
describe("eventHasOwnSubstance", () => {
  it("pesagem e so o numero: sem kg valido, nao sobra substancia", () => {
    expect(eventHasOwnSubstance(
      { kind: "weight", pillar: "alimentacao", summary: "Me pesei: 18kg", kg: 18 },
    )).toBe(false);
  });

  it("com kg valido, sobra substancia", () => {
    expect(eventHasOwnSubstance(
      { kind: "weight", pillar: "alimentacao", summary: "Me pesei: 78kg", kg: 78 },
    )).toBe(true);
  });

  it("refeicao com descricao tem substancia mesmo com caloria absurda", () => {
    expect(eventHasOwnSubstance({
      kind: "meal", pillar: "alimentacao", summary: "Almocei frango (~-5 kcal)",
      description: "200g de frango no almoco", calories: -5,
    })).toBe(true);
  });

  it("agua e humor sem rotulo tambem sao so o numero", () => {
    expect(eventHasOwnSubstance(
      { kind: "water", pillar: "alimentacao", summary: "Bebi agua", ml: 0 },
    )).toBe(false);
    expect(eventHasOwnSubstance(
      { kind: "mood", pillar: "mente", summary: "Humor", mood_score: 0 },
    )).toBe(false);
  });

  it("humor COM rotulo tem substancia: a palavra dela vale sem a nota", () => {
    expect(eventHasOwnSubstance({
      kind: "mood", pillar: "mente", summary: "Dia ansioso",
      mood_label: "ansioso", mood_score: 0,
    })).toBe(true);
  });
});

describe("saveProposedEvents · a fronteira do peso, ponta a ponta", () => {
  const pesagem = (kg: number): ProposedEvent[] => [
    { kind: "weight", pillar: "alimentacao", summary: `Peso: ${kg} kg`, kg },
  ];

  it("20 kg exatos: GRAVA, com o numero, e sem aviso nenhum", async () => {
    const r = await saveProposedEvents(USER, pesagem(20));
    expect(r.saved).toBe(1);
    expect(r.warnings).toEqual([]);
    expect((state.rows[0].payload as Row).kg).toBe(20);
  });

  it("400 kg exatos: idem", async () => {
    const r = await saveProposedEvents(USER, pesagem(400));
    expect(r.warnings).toEqual([]);
    expect((state.rows[0].payload as Row).kg).toBe(400);
  });

  it("19,9 kg: recusado, nada gravado", async () => {
    const r = await saveProposedEvents(USER, pesagem(19.9));
    expect(r.saved).toBe(0);
    expect(state.rows).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
  });

  it("o caso LEGITIMO: refeicao com caloria absurda entra sem a caloria", async () => {
    const r = await saveProposedEvents(USER, [{
      kind: "meal", pillar: "alimentacao", summary: "Almocei 200g de frango",
      description: "200g de frango no almoco", meal_type: "almoco", calories: -5,
    }]);
    expect(r.saved).toBe(1);
    const payload = state.rows[0].payload as Row;
    expect(payload.description).toBe("200g de frango no almoco");
    expect(payload.calories).toBeUndefined();   // a caloria ruim ficou fora
    expect(r.warnings).toHaveLength(1);         // e a pessoa sabe disso
    expect(r.warnings[0]).toContain("as calorias");
  });

  it("uma pesagem ruim no lote nao leva os outros registros com ela", async () => {
    const r = await saveProposedEvents(USER, [
      ...pesagem(18),
      { kind: "sleep", pillar: "vitalidade", summary: "Dormi 7h", hours: 7 },
    ]);
    expect(r.saved).toBe(1);
    expect(r.savedEvents[0].kind).toBe("sleep");
    expect(state.rows).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
  });
});
