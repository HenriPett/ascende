// ASCENDE — Testes da camada de proveniência (parte pura).
// O que tem I/O (createSource, listSourcesWithReceipts) é exercitado no teste
// de importação em lote, com um Postgres de mentira que respeita o índice
// único — é lá que mora o risco de verdade.
import { describe, it, expect, vi } from "vitest";
import { webcrypto } from "node:crypto";

// O Node 18 que roda os testes não expõe `crypto` como global; o navegador,
// onde este código de fato roda, expõe sempre (contexto seguro). O apoio é
// só do ambiente de teste — a implementação é a mesma WebCrypto.
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto as unknown as Crypto });
}

/* O módulo importa o cliente do Supabase no topo, e criar o cliente de
   verdade exige localStorage e as variáveis do .env. O dublê abaixo devolve o
   que o teste mandar — inclusive ERRO, que é o cenário de dois dos achados:
   a consulta de recibos falhando, e a de chaves parando no meio. */
const db = vi.hoisted(() => ({
  sources: [] as Record<string, unknown>[],
  sourcesError: null as { message: string } | null,
  receipts: [] as Record<string, unknown>[],
  receiptsError: null as { message: string } | null,
  /** Páginas que `range()` devolve, na ordem. */
  keyPages: [] as Record<string, unknown>[][],
  keyPageError: null as { message: string } | null,
  rangeCalls: [] as [number, number][],
}));

vi.mock("@/integrations/supabase/client", () => {
  const resultFor = (table: string, pageIndex: number) => {
    if (table === "data_sources") return { data: db.sources, error: db.sourcesError };
    if (table === "import_receipts") return { data: db.receipts, error: db.receiptsError };
    if (db.keyPageError && pageIndex > 0) return { data: null, error: db.keyPageError };
    return { data: db.keyPages[pageIndex] ?? [], error: null };
  };
  // A página é contada em `db`, e não na cadeia: `existingRecordKeys` monta
  // uma consulta NOVA a cada volta do laço, então um contador por cadeia
  // devolveria a primeira página para sempre.
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const m of ["select", "eq", "neq", "not", "in", "order", "limit"]) chain[m] = passthrough;
    chain.range = (from: number, to: number) => {
      db.rangeCalls.push([from, to]);
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve(resultFor(table, Math.max(0, db.rangeCalls.length - 1)));
    return chain;
  };
  return { supabase: { from: (table: string) => chainFor(table) } };
});

import { beforeEach } from "vitest";
import {
  listSourcesWithReceipts, existingRecordKeys,
  importOutcome, markAlreadyImported, markAlreadyInHistory,
  importMilestoneLabel, importMilestoneSourceId,
  hashFile, fingerprintLargeFile, buildReceiptSummary, sourceKindLabel, isDuplicateError,
} from "@/lib/dataSources";

describe("hashFile", () => {
  // Vetores conhecidos do SHA-256: se algum dia a implementação mudar, é
  // aqui que se vê que ela mudou — e hash diferente significa "arquivo
  // diferente", ou seja, reimportação duplicando tudo.
  it("bate com os vetores conhecidos do SHA-256", async () => {
    expect(await hashFile("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await hashFile("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("é o mesmo para o mesmo conteúdo, venha como texto, bytes ou Blob", async () => {
    const text = "date,weight_kg\n2026-09-01,101.5\n";
    const bytes = new TextEncoder().encode(text);
    const viaText = await hashFile(text);
    expect(await hashFile(bytes)).toBe(viaText);
    expect(await hashFile(bytes.buffer)).toBe(viaText);
    expect(await hashFile(new Blob([text]))).toBe(viaText);
  });

  it("muda com qualquer alteração do conteúdo", async () => {
    expect(await hashFile("101.5")).not.toBe(await hashFile("101.6"));
    expect(await hashFile("a\n")).not.toBe(await hashFile("a"));
  });
});

describe("buildReceiptSummary", () => {
  it("conta só o que aconteceu", () => {
    expect(buildReceiptSummary({ acceptedRows: 3, duplicateRows: 0, rejectedRows: 0 }))
      .toBe("3 registros no seu histórico.");
    expect(buildReceiptSummary({ acceptedRows: 1, duplicateRows: 0, rejectedRows: 0 }))
      .toBe("1 registro no seu histórico.");
  });

  it("usa o rótulo do formato quando existe", () => {
    expect(buildReceiptSummary({
      acceptedRows: 555, duplicateRows: 12, rejectedRows: 3,
      acceptedLabel: "555 noites de sono",
    })).toBe("555 noites de sono no seu histórico · 12 já estavam registrados · 3 não entraram.");
  });

  // Regressão: a frase é GRAVADA e relida meses depois, então não pode
  // afirmar uma causa que ela não conhece. `rejectedRows` reúne linha
  // ilegível (CSV) e item desmarcado pela pessoa (fatura) — dizer "não deu
  // para ler" sobre um lançamento que ela simplesmente não quis é falso.
  it("não inventa o motivo do que ficou de fora", () => {
    const frase = buildReceiptSummary({ acceptedRows: 5, duplicateRows: 0, rejectedRows: 3 });
    expect(frase).toBe("5 registros no seu histórico · 3 não entraram.");
    expect(frase).not.toMatch(/ler|ileg|descart|recus/i);
  });

  it("diz na cara quando nada entrou (reimportação do mesmo arquivo)", () => {
    expect(buildReceiptSummary({ acceptedRows: 0, duplicateRows: 40, rejectedRows: 0 }))
      .toBe("Nada novo entrou · 40 já estavam registrados.");
  });

  it("usa singular em cada linha do resumo", () => {
    expect(buildReceiptSummary({ acceptedRows: 2, duplicateRows: 1, rejectedRows: 1 }))
      .toBe("2 registros no seu histórico · 1 já estava registrado · 1 não entrou.");
  });
});

describe("importOutcome — a partição do recibo fecha", () => {
  it("as 30 noites que a pessoa desmarcou não somem do recibo", () => {
    // Cenário do achado: CSV com 100 noites, 0 ilegíveis, 0 duplicatas, a
    // pessoa desmarca 30 e importa 70. Antes: total=100, aceitos=70,
    // duplicados=0, rejeitados=0 — e 70+0+0 ≠ 100. Seis meses depois, "onde
    // foram as 30?" não tinha resposta.
    const r = importOutcome({ acceptedRows: 70, duplicateRows: 0, discardedRows: 30 });
    expect(r.rejectedRows).toBe(30);
    expect(r.totalRows).toBe(100);
    expect(70 + 0 + r.rejectedRows).toBe(r.totalRows);
    // E desmarcar não é defeito do arquivo: a fonte fica completa.
    expect(r.status).toBe("confirmed");
  });

  it("total e aceitos ficam na MESMA unidade no caso de treino", () => {
    // 1.500 linhas de exercício viram 40 sessões. O recibo antigo gravava
    // total=1.500 com aceitos=40, e lido depois parecia que 1.460 registros
    // evaporaram numa importação que deu certo. A contagem de linhas cruas
    // vai para os avisos; a partição conta REGISTROS.
    const r = importOutcome({ acceptedRows: 40, duplicateRows: 0, discardedRows: 0 });
    expect(r.totalRows).toBe(40);
  });

  it("linha ilegível marca partial — e continua fora da partição", () => {
    const r = importOutcome({
      acceptedRows: 8, duplicateRows: 0, discardedRows: 0, unreadableLines: 2,
    });
    expect(r.status).toBe("partial");
    // As 2 linhas ilegíveis não viraram registro, então não entram na conta.
    expect(r.totalRows).toBe(8);
    expect(r.rejectedRows).toBe(0);
  });

  it("desmarcar as 11 parcelas futuras não deixa a fonte incompleta", () => {
    const r = importOutcome({ acceptedRows: 1, duplicateRows: 0, discardedRows: 11 });
    expect(r.status).toBe("confirmed");
    expect(r.totalRows).toBe(12);
  });

  it("duplicado entra na conta e a soma continua fechando", () => {
    const r = importOutcome({ acceptedRows: 5, duplicateRows: 3, discardedRows: 4 });
    expect(r.totalRows).toBe(12);
    expect(5 + 3 + r.rejectedRows).toBe(r.totalRows);
  });
});

describe("sourceKindLabel", () => {
  it("traduz os quatro tipos de origem", () => {
    expect(sourceKindLabel("health_csv")).toBe("Arquivo de saúde");
    expect(sourceKindLabel("health_export")).toBe("Exportação do App Saúde");
    expect(sourceKindLabel("financial_statement")).toBe("Fatura ou extrato");
    expect(sourceKindLabel("chat_attachment")).toBe("Anexo do Conselheiro");
    expect(sourceKindLabel("manual")).toBe("Registro manual");
  });
});

describe("isDuplicateError", () => {
  it("reconhece só a violação de unicidade", () => {
    expect(isDuplicateError({ code: "23505", message: "duplicate key" })).toBe(true);
    expect(isDuplicateError({ code: "23503", message: "foreign key" })).toBe(false);
    expect(isDuplicateError(new Error("rede caiu"))).toBe(false);
    expect(isDuplicateError(null)).toBe(false);
    expect(isDuplicateError(undefined)).toBe(false);
  });
});

describe("fingerprintLargeFile — identidade sem carregar o arquivo", () => {
  /* Por que existe: o export do App Saúde chega com centenas de MB, e
     `hashFile` faz arrayBuffer() do conteúdo inteiro. O que precisamos aqui é
     reconhecer o MESMO arquivo de novo, não provar igualdade de conteúdo. */
  const arquivo = (nome: string, conteudo: string) =>
    Object.assign(new Blob([conteudo]), { name: nome }) as Blob & { name: string };

  it("o mesmo arquivo devolve sempre a mesma impressão", async () => {
    const a = await fingerprintLargeFile(arquivo("exportar.zip", "x".repeat(5000)));
    const b = await fingerprintLargeFile(arquivo("exportar.zip", "x".repeat(5000)));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tamanho diferente muda a impressão", async () => {
    // Um export novo do iPhone tem mais dado, logo mais bytes: precisa ser
    // reconhecido como arquivo DIFERENTE, e não reaproveitar a fonte antiga.
    const a = await fingerprintLargeFile(arquivo("exportar.zip", "x".repeat(5000)));
    const b = await fingerprintLargeFile(arquivo("exportar.zip", "x".repeat(5001)));
    expect(a).not.toBe(b);
  });

  it("nome diferente muda a impressão", async () => {
    const a = await fingerprintLargeFile(arquivo("exportar.zip", "abc"));
    const b = await fingerprintLargeFile(arquivo("export.zip", "abc"));
    expect(a).not.toBe(b);
  });

  it("conteúdo diferente do mesmo tamanho muda a impressão (arquivo pequeno)", async () => {
    // Abaixo de 1 MB as duas pontas cobrem o arquivo todo, então a impressão
    // é sensível ao conteúdo inteiro.
    const a = await fingerprintLargeFile(arquivo("a.zip", "abcdef"));
    const b = await fingerprintLargeFile(arquivo("a.zip", "abcdeg"));
    expect(a).not.toBe(b);
  });

  it("não é o mesmo valor que hashFile: são perguntas diferentes", async () => {
    const conteudo = "conteudo qualquer";
    const impressao = await fingerprintLargeFile(arquivo("a.zip", conteudo));
    expect(impressao).not.toBe(await hashFile(conteudo));
  });
});


beforeEach(() => {
  db.sources = []; db.sourcesError = null;
  db.receipts = []; db.receiptsError = null;
  db.keyPages = []; db.keyPageError = null; db.rangeCalls = [];
});

describe("listSourcesWithReceipts — falha de recibo não vira 'sem recibo'", () => {
  const fonte = {
    id: "s1", user_id: "u1", kind: "health_csv", display_name: "sleepdata.csv",
    status: "confirmed", created_at: "2026-08-01T10:00:00Z", updated_at: null,
  };

  it("quando a consulta de recibos FALHA, a tela sabe que não carregou", async () => {
    // O achado: o erro só era logado, e toda fonte voltava com receipt null.
    // A tela de Fontes então negava doze recibos que existem no banco — a
    // negação exata da promessa da Fase 1.
    db.sources = [fonte];
    db.receiptsError = { message: "network error" };
    const r = await listSourcesWithReceipts("u1");
    expect(r).toHaveLength(1);
    expect(r[0].receipt).toBeNull();
    expect(r[0].receiptUnavailable).toBe(true);
  });

  it("quando carrega, 'sem recibo' quer dizer sem recibo mesmo", async () => {
    db.sources = [fonte];
    db.receipts = [];
    const r = await listSourcesWithReceipts("u1");
    expect(r[0].receipt).toBeNull();
    expect(r[0].receiptUnavailable).toBeUndefined();
  });

  it("anexa o recibo mais recente de cada fonte", async () => {
    db.sources = [fonte];
    db.receipts = [
      { id: "r2", source_id: "s1", user_id: "u1", total_rows: 10, accepted_rows: 10,
        duplicate_rows: 0, rejected_rows: 0, warnings: [], summary: "novo",
        created_at: "2026-08-02T10:00:00Z" },
      { id: "r1", source_id: "s1", user_id: "u1", total_rows: 5, accepted_rows: 5,
        duplicate_rows: 0, rejected_rows: 0, warnings: [], summary: "antigo",
        created_at: "2026-08-01T10:00:00Z" },
    ];
    const r = await listSourcesWithReceipts("u1");
    expect(r[0].receipt?.summary).toBe("novo");
    expect(r[0].receiptUnavailable).toBeUndefined();
  });
});

describe("existingRecordKeys — pagina em vez de parar no teto", () => {
  const pagina = (prefixo: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ source_record_key: `${prefixo}|${i}` }));

  it("junta todas as páginas até vir uma incompleta", async () => {
    // O achado: `.limit(5000)` sem paginação. Numa fonte com mais chaves que
    // isso, o pré-filtro ficava incompleto, o insert em lote batia no índice
    // único e o fallback virava UMA REQUISIÇÃO POR LINHA.
    db.keyPages = [pagina("a", 1000), pagina("b", 1000), pagina("c", 7)];
    const keys = await existingRecordKeys("life_events", "u1", "src1");
    expect(keys.size).toBe(2007);
    expect(db.rangeCalls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("página cheia exata continua pedindo a próxima", async () => {
    db.keyPages = [pagina("a", 1000), []];
    const keys = await existingRecordKeys("life_events", "u1", "src1");
    expect(keys.size).toBe(1000);
    expect(db.rangeCalls).toHaveLength(2);
  });

  it("erro no meio devolve o que já juntou, sem laço infinito", async () => {
    db.keyPages = [pagina("a", 1000)];
    db.keyPageError = { message: "timeout" };
    const keys = await existingRecordKeys("transactions", "u1", "src1");
    expect(keys.size).toBe(1000);
    expect(db.rangeCalls).toHaveLength(2);
  });
});


describe("markAlreadyImported — revisão e gravação não podem discordar", () => {
  const evento = (kind: string, day: string) => ({ kind, day, record_key: `${kind}|${day}` });

  it("reimportar o MESMO arquivo marca tudo como já gravado", () => {
    // O bug: a revisão oferecia "1.010 novos" comparando por (tipo|dia) contra
    // uma consulta truncada pelo servidor; a gravação comparava por chave na
    // fonte, via que tudo existia e gravava ZERO — sem erro e sem aviso.
    const eventos = [evento("sleep", "2026-08-01"), evento("workout", "2026-08-01")];
    const gravadas = new Set(eventos.map((e) => e.record_key));
    expect(markAlreadyImported(eventos, gravadas)).toEqual([true, true]);
  });

  it("o que a fonte ainda não gravou continua novo", () => {
    const eventos = [evento("sleep", "2026-08-01"), evento("sleep", "2026-08-02")];
    const gravadas = new Set(["sleep|2026-08-01"]);
    expect(markAlreadyImported(eventos, gravadas)).toEqual([true, false]);
  });

  it("a marcação concorda EXATAMENTE com o que a gravação vai pular", () => {
    // A gravação filtra por `record_key in jaGravadas`. Se a revisão usar a
    // mesma chave, os dois conjuntos são complementares por construção: o que
    // a tela oferece é o que o banco aceita.
    const eventos = Array.from({ length: 50 }, (_, i) =>
      evento(i % 2 ? "sleep" : "workout", `2026-08-${String((i % 28) + 1).padStart(2, "0")}`));
    const gravadas = new Set(eventos.filter((_, i) => i % 3 === 0).map((e) => e.record_key));
    const marcados = markAlreadyImported(eventos, gravadas);
    const oferecidos = eventos.filter((_, i) => !marcados[i]);
    const aceitosPelaGravacao = oferecidos.filter((e) => !gravadas.has(e.record_key));
    expect(aceitosPelaGravacao).toHaveLength(oferecidos.length);
    expect(oferecidos.length).toBeGreaterThan(0);
  });

  it("evento sem chave nunca é dado como já gravado", () => {
    expect(markAlreadyImported([{ record_key: undefined }], new Set(["x"]))).toEqual([false]);
  });
});


describe("markAlreadyInHistory — o caminho SEM fonte anterior", () => {
  /* Este é o caminho que o QA não conseguiu exercitar em tela: a exclusão de
     fonte é lógica (a linha fica com status 'deleted' e o mesmo file_hash),
     então o app reconhece o arquivo mesmo depois de excluída — e usa a regra
     da fonte, não esta. Aqui ela fica coberta por teste. */
  const ev = (kind: string, day: string) => ({ kind, day });

  it("marca o que já existe no histórico, por tipo e dia", () => {
    const eventos = [ev("sleep", "2026-08-01"), ev("workout", "2026-08-01"), ev("sleep", "2026-08-02")];
    const noHistorico = new Set(["sleep|2026-08-01", "workout|2026-08-01"]);
    expect(markAlreadyInHistory(eventos, noHistorico)).toEqual([true, true, false]);
  });

  it("o mesmo dia com TIPO diferente não é duplicata", () => {
    // Registrar o peso não torna a noite de sono daquele dia já existente.
    expect(markAlreadyInHistory([ev("sleep", "2026-08-01")], new Set(["weight|2026-08-01"])))
      .toEqual([false]);
  });

  it("histórico vazio deixa tudo como novo", () => {
    expect(markAlreadyInHistory([ev("sleep", "2026-08-01")], new Set())).toEqual([false]);
  });
});

describe("importMilestone — o extrato de XP não mostra uuid", () => {
  const razao = "Importação concluída: 9be6808c-2bfb-428c-a8f9-a62fcfddc10c";

  it("troca o uuid pelo nome do arquivo", () => {
    expect(importMilestoneLabel(razao, "exportar.zip")).toBe("Importação concluída: exportar.zip");
  });

  it("sem o nome, some com o uuid em vez de exibi-lo", () => {
    // "+15 XP · Importação concluída: 9be6808c-…" não diz nada para quem lê,
    // e ainda parece defeito na tela.
    expect(importMilestoneLabel(razao, null)).toBe("Importação concluída");
    expect(importMilestoneLabel(razao)).not.toContain("9be6808c");
  });

  it("não mexe em razão que não é marco de importação", () => {
    expect(importMilestoneLabel("Hábito concluído", "x")).toBe("Hábito concluído");
    expect(importMilestoneSourceId("Hábito concluído")).toBeNull();
    expect(importMilestoneSourceId("Importação concluída: nao-e-uuid")).toBeNull();
  });

  it("extrai o id para a tela poder buscar o nome", () => {
    expect(importMilestoneSourceId(razao)).toBe("9be6808c-2bfb-428c-a8f9-a62fcfddc10c");
  });
});
