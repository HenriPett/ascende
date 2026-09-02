// ASCENDE — Testes do leitor de zip do App Saúde.
//
// Os zips aqui são montados no próprio teste (fflate), então são pequenos e
// determinísticos. O arquivo real de 39 MB nunca entra em teste: o que se
// testa é a REGRA, não o tamanho.
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readAppleHealthFile, readAppleHealthInThread } from "@/lib/appleHealthZip";

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT HealthData (ExportDate,Me,(Record|Workout)*)>
]>
<HealthData locale="pt_BR">`;

const sono = (dia: string) =>
  ` <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Relógio" startDate="${dia} 23:00:00 -0300" endDate="${dia} 23:30:00 -0300" value="HKCategoryValueSleepAnalysisAsleepCore"/>`;

const peso = (dia: string, kg: string) =>
  ` <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Saúde" unit="kg" startDate="${dia} 07:00:00 -0300" endDate="${dia} 07:00:00 -0300" value="${kg}"/>`;

const xml = (...linhas: string[]) => `${HEAD}\n${linhas.join("\n")}\n</HealthData>`;

/** Blob a partir do zip, do jeito que o navegador entrega o File. */
const zipBlob = (files: Record<string, string>) =>
  new Blob([zipSync(Object.fromEntries(
    Object.entries(files).map(([nome, conteudo]) => [nome, strToU8(conteudo)]),
  )) as unknown as BlobPart]);

describe("readAppleHealthFile — uma entrada de XML por vez", () => {
  it("lê SÓ o primeiro exportar.xml quando o zip traz dois", async () => {
    /* O risco: `onfile` ligava o inflate em TODA entrada que casasse com o
       nome, e o TextDecoder e o scanner são compartilhados. Dois fluxos
       intercalados no mesmo decodificador partem uma tag no meio e o registro
       sai com dado do outro arquivo. Melhor ler um inteiro. */
    const blob = zipBlob({
      "apple_health_export/exportar.xml": xml(sono("2026-08-01")),
      "apple_health_export/copia/export.xml": xml(peso("2026-08-02", "80")),
    });
    const outcome = await readAppleHealthFile(blob);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    // Só o sono do primeiro arquivo. Se o segundo tivesse entrado, haveria
    // também um evento de peso.
    expect(outcome.result.events.map((e) => e.kind)).toEqual(["sleep"]);
  });

  it("as rotas .gpx não são abertas nem atrapalham", async () => {
    const blob = zipBlob({
      "apple_health_export/workout-routes/rota1.gpx": "<gpx><trk/></gpx>",
      "apple_health_export/exportar.xml": xml(sono("2026-08-01"), peso("2026-08-01", "80")),
      "apple_health_export/workout-routes/rota2.gpx": "<gpx><trk/></gpx>",
    });
    const outcome = await readAppleHealthFile(blob);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.result.events).toHaveLength(2);
  });
});

describe("readAppleHealthFile — vazio não é desconhecido", () => {
  it("export legítimo SEM registro devolve 'vazio'", async () => {
    // Export interrompido no iPhone: o formato está certo, o conteúdo não veio.
    // Dizer "não reconheci o formato" aqui manda a pessoa procurar defeito no
    // arquivo errado.
    const blob = zipBlob({ "apple_health_export/exportar.xml": xml() });
    expect((await readAppleHealthFile(blob)).status).toBe("vazio");
  });

  it("zip sem exportar.xml devolve 'desconhecido'", async () => {
    const blob = zipBlob({ "fotos/gato.txt": "miau" });
    expect((await readAppleHealthFile(blob)).status).toBe("desconhecido");
  });

  it("export com registros devolve 'ok'", async () => {
    const blob = zipBlob({ "apple_health_export/exportar.xml": xml(sono("2026-08-01")) });
    const outcome = await readAppleHealthFile(blob);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.result.format).toBe("apple_health");
    expect(outcome.result.events).toHaveLength(1);
  });
});


describe("worker e fallback", () => {
  /* A tela chama `readAppleHealthFile`, que roda a leitura num Worker — é o
     que impede a thread principal de congelar por 16 s com o arquivo real.
     Aqui, em Node, não existe `Worker` global, então o mesmo caminho cai no
     fallback em thread. Este teste tranca as duas pontas: o fallback existe e
     entrega o MESMO resultado que a leitura direta. */
  it("sem Worker no ambiente, lê na thread e entrega o mesmo resultado", async () => {
    expect(typeof (globalThis as { Worker?: unknown }).Worker).not.toBe("function");
    const arquivo = () => zipBlob({
      "apple_health_export/exportar.xml": xml(sono("2026-08-01"), peso("2026-08-01", "80")),
    });
    const viaEntrada = await readAppleHealthFile(arquivo());
    const emThread = await readAppleHealthInThread(arquivo());
    expect(viaEntrada.status).toBe("ok");
    expect(viaEntrada).toEqual(emThread);
  });

  it("cancelar antes de começar não lê nada", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(readAppleHealthFile(
      zipBlob({ "apple_health_export/exportar.xml": xml(sono("2026-08-01")) }),
      { signal: ctrl.signal },
    )).rejects.toThrow(/cancelada/i);
  });
});
