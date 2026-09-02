// ASCENDE — Proveniência: as partes PURAS (sem I/O, testáveis isoladamente).
//
// Separado de dataSources.ts porque aquele módulo importa o cliente Supabase,
// e importar o cliente num teste puxa `localStorage` — indisponível no
// ambiente Node do Vitest. Mesmo padrão do resto do repositório: lógica pura
// em src/lib, testada sem tocar em rede nem em navegador
// (ver prosperidade.ts, planSections.ts, healthImport.ts).
//
// dataSources.ts reexporta tudo daqui, então quem consome não precisa saber
// que existem dois arquivos.

import type { DataSourceKind } from "@/lib/dataSources";

export type HashInput = string | ArrayBuffer | ArrayBufferView | Blob;

/**
 * SHA-256 do conteúdo, em hex. É a identidade do arquivo sem guardar o
 * arquivo: o mesmo conteúdo dá sempre o mesmo hash, conteúdo diferente dá
 * hash diferente, e do hash não se volta ao conteúdo.
 *
 * CUIDADO com a representação: hashear o TEXTO decodificado e hashear os
 * BYTES do mesmo arquivo dá resultados diferentes. Cada fluxo escolhe uma e
 * mantém (o de saúde já lê o CSV como texto; a fatura lê bytes).
 */
export async function hashFile(input: HashInput): Promise<string> {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Blob
        ? new Uint8Array(await input.arrayBuffer())
        : input instanceof ArrayBuffer
          ? new Uint8Array(input)
          // `as ArrayBuffer`: o TS admite SharedArrayBuffer aqui, que não
          // existe neste app (nem em Worker compartilhado, nem em WASM).
          : new Uint8Array(input.buffer as ArrayBuffer, input.byteOffset, input.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── Leitura ────────────────────────────────────────────────────────────── */

export const isDuplicateError = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

/* ── Texto pronto para a tela ───────────────────────────────────────────── */

/** Rótulo do tipo de fonte em português. */

export function sourceKindLabel(kind: DataSourceKind): string {
  if (kind === "health_csv") return "Arquivo de saúde";
  if (kind === "financial_statement") return "Fatura ou extrato";
  if (kind === "chat_attachment") return "Anexo do Conselheiro";
  return "Registro manual";
}

/**
 * Frase do recibo, em linguagem de usuário. Nasce aqui (e não na tela) para
 * ser gravada em `import_receipts.summary`: assim o que a pessoa lê hoje é
 * exatamente o que ela vai reler daqui a seis meses, mesmo que a interface
 * mude.
 */
export function buildReceiptSummary(counts: {
  acceptedRows: number; duplicateRows: number;
  /** Tudo que ficou de fora sem ser duplicata, por qualquer motivo: linha
   *  ilegível no CSV, parcela futura, item que a pessoa desmarcou na
   *  revisão. A frase NÃO tenta adivinhar a causa — dizer "não deu para ler"
   *  sobre um lançamento que a pessoa simplesmente não quis é mentira, e
   *  mentira gravada, na frase que ela vai reler daqui a seis meses. */
  rejectedRows: number;
  /** Rótulo do que entrou, no plural certo: "555 noites de sono". Quando
   *  ausente, a frase usa "registros". */
  acceptedLabel?: string;
}): string {
  const { acceptedRows, duplicateRows, rejectedRows, acceptedLabel } = counts;
  const entered = acceptedLabel
    ?? `${acceptedRows} ${acceptedRows === 1 ? "registro" : "registros"}`;
  const parts = [acceptedRows > 0 ? `${entered} no seu histórico` : "Nada novo entrou"];
  if (duplicateRows > 0) {
    parts.push(duplicateRows === 1
      ? "1 já estava registrado"
      : `${duplicateRows} já estavam registrados`);
  }
  if (rejectedRows > 0) {
    parts.push(rejectedRows === 1 ? "1 não entrou" : `${rejectedRows} não entraram`);
  }
  return parts.join(" · ") + ".";
}
