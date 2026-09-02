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

// O módulo importa o cliente do Supabase no topo, e criar o cliente de
// verdade exige localStorage e as variáveis do .env — nada disso interessa
// para as funções puras testadas aqui.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { hashFile, buildReceiptSummary, sourceKindLabel, isDuplicateError } from "@/lib/dataSources";

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

describe("sourceKindLabel", () => {
  it("traduz os quatro tipos de origem", () => {
    expect(sourceKindLabel("health_csv")).toBe("Arquivo de saúde");
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
