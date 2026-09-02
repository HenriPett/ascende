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

/* Identidade de arquivo GRANDE, sem carregá-lo na memória.

   `hashFile` faz `arrayBuffer()` do conteúdo inteiro. Serve para um CSV de
   150 KB e para uma fatura em PDF; num export do App Saúde de 876 MB derruba
   a aba — o buffer todo na memória e o `crypto.subtle.digest` copiando de
   novo em seguida. E `digest` não tem API incremental, então não existe jeito
   de hashear o conteúdo inteiro em pedaços sem trazer uma implementação de
   SHA-256 para dentro do bundle.

   A pergunta que o hash responde aqui não é de segurança, é de IDENTIDADE:
   "já importei este arquivo antes?". Para isso, nome + tamanho + o primeiro e
   o último megabyte bastam: dois exports diferentes do App Saúde divergem no
   tamanho na primeira linha nova de dado, e miolo idêntico com pontas
   idênticas E tamanho idêntico é coincidência que não acontece na prática.

   O que NÃO entra, de propósito: `lastModified`. Baixar o mesmo export duas
   vezes do iPhone muda a data do arquivo sem mudar o conteúdo — incluí-la
   faria o app abrir uma fonte nova e PARAR de reconhecer a reimportação, que
   é exatamente o que esta função existe para permitir.

   É uma IMPRESSÃO DIGITAL, não hash de conteúdo. Não use para afirmar que
   dois arquivos são iguais; use para reconhecer o mesmo arquivo de novo. */
const FINGERPRINT_EDGE = 1024 * 1024;

export async function fingerprintLargeFile(file: File | Blob): Promise<string> {
  const name = "name" in file ? file.name : "";
  const size = file.size;
  const head = new Uint8Array(await file.slice(0, FINGERPRINT_EDGE).arrayBuffer());
  const tail = new Uint8Array(
    await file.slice(Math.max(0, size - FINGERPRINT_EDGE)).arrayBuffer(),
  );
  const meta = new TextEncoder().encode(`${name}|${size}|`);
  const bytes = new Uint8Array(meta.length + head.length + tail.length);
  bytes.set(meta, 0);
  bytes.set(head, meta.length);
  bytes.set(tail, meta.length + head.length);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const isDuplicateError = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

/* ── Texto pronto para a tela ───────────────────────────────────────────── */

/** Rótulo do tipo de fonte em português. */

export function sourceKindLabel(kind: DataSourceKind): string {
  if (kind === "health_csv") return "Arquivo de saúde";
  if (kind === "health_export") return "Exportação do App Saúde";
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
/* ── O marco de importação no extrato de XP ───────────────────────────────
   A função do banco grava a razão como "Importação concluída: <uuid>", e o
   uuid é parte da IDENTIDADE do marco (é por ele que a concessão é idempotente
   — mudar o formato faria a mesma importação pagar XP de novo). Então o
   conserto é na EXIBIÇÃO: o extrato mostra o nome do arquivo, não o uuid. */

export const IMPORT_MILESTONE_PREFIX = "Importação concluída: ";

/** O id da fonte dentro da razão do xp_log, ou null se não for um marco. */
export function importMilestoneSourceId(reason: string): string | null {
  if (!reason.startsWith(IMPORT_MILESTONE_PREFIX)) return null;
  const id = reason.slice(IMPORT_MILESTONE_PREFIX.length).trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * A linha do extrato, em linguagem de gente.
 *
 * Sem o nome do arquivo (fonte apagada, consulta que falhou), devolve
 * "Importação concluída" — sem o uuid. Um identificador técnico no extrato não
 * diz nada para quem lê e ainda parece defeito.
 */
export function importMilestoneLabel(reason: string, displayName?: string | null): string {
  if (!importMilestoneSourceId(reason)) return reason;
  return displayName ? `Importação concluída: ${displayName}` : "Importação concluída";
}

/**
 * Quais destes registros a FONTE já gravou.
 *
 * Existe para a revisão e a gravação não discordarem. Elas discordaram: a
 * revisão comparava por (tipo|dia) contra uma consulta de histórico que o
 * servidor truncava, e oferecia 1.010 registros "novos"; a gravação comparava
 * por `source_record_key` na fonte, sabia que todos já existiam e gravava
 * ZERO — sem erro, sem aviso. A tela prometia o que não ia cumprir.
 *
 * Agora as duas perguntam a mesma coisa, com a mesma chave.
 */
export function markAlreadyImported<T extends { record_key?: string }>(
  events: readonly T[], storedKeys: ReadonlySet<string>,
): boolean[] {
  return events.map((ev) => (ev.record_key ? storedKeys.has(ev.record_key) : false));
}

/**
 * Quais destes registros já existem no HISTÓRICO, por tipo e dia.
 *
 * É o caminho de quando NÃO há fonte anterior: o arquivo é novo para nós, mas
 * a pessoa pode ter registrado aquela noite à mão ou por outro app. Aqui a
 * chave é (tipo|dia), e não a chave da fonte — porque não existe fonte para
 * perguntar.
 *
 * `dayOf` entra por parâmetro para esta função não saber o que é fuso: quem
 * chama traduz o `occurred_at` do banco para o dia em São Paulo.
 */
export function markAlreadyInHistory<T extends { kind: string; day: string }>(
  events: readonly T[], storedDayKeys: ReadonlySet<string>,
): boolean[] {
  return events.map((ev) => storedDayKeys.has(`${ev.kind}|${ev.day}`));
}

/* ── A PARTIÇÃO DO RECIBO ─────────────────────────────────────────────────
   Uma conta que precisa fechar, e uma unidade que precisa ser a mesma dos
   dois lados. Vive aqui porque os DOIS fluxos de importação (arquivo de saúde
   e fatura) têm de contar do mesmo jeito — quando cada tela fazia a própria
   conta, uma esquecia o que a pessoa desmarcou e a outra misturava linha de
   CSV com registro gravado. */

export interface ImportCounts {
  /** Registros gravados agora. */
  acceptedRows: number;
  /** Já estavam no histórico: vieram deste arquivo antes, o arquivo repetia,
   *  ou a pessoa desmarcou porque a tela avisou que já existia. */
  duplicateRows: number;
  /** A pessoa desmarcou de propósito: parcela futura, noite que ela não quer,
   *  compra de outra pessoa. É ESCOLHA, e some do recibo se ninguém contar. */
  discardedRows: number;
  /** Linhas do arquivo que não deram para ler.
   *
   *  FICAM FORA DA PARTIÇÃO de propósito: elas nunca viraram registro, e somá-las
   *  a uma conta feita em registros mistura unidades — foi assim que um CSV de
   *  treino gerou recibo com "1.500 lidas, 40 aceitas", parecendo que 1.460
   *  evaporaram, quando na verdade 1.500 LINHAS viraram 40 SESSÕES.
   *  Elas aparecem nos avisos do recibo, e é só isto que marca 'partial'. */
  unreadableLines?: number;
}

export interface ImportOutcome {
  /** 'partial' quer dizer UMA coisa: o arquivo tinha linha que não deu para
   *  ler. Desmarcar não é defeito do documento, é a revisão funcionando. */
  status: "confirmed" | "partial";
  /** O que ficou de fora sem ser duplicata. */
  rejectedRows: number;
  /** aceitos + duplicados + rejeitados. Sempre fecha, por construção. */
  totalRows: number;
}

/**
 * Fecha a conta do recibo na unidade dos REGISTROS reconhecidos.
 *
 * O que esta função existe para impedir: um recibo em que
 * `aceitos + duplicados + rejeitados ≠ total`. Seis meses depois, a pergunta
 * "onde foram as 30 noites que eu desmarquei?" precisa ter resposta, e a
 * resposta é uma linha do recibo — não a memória de quem importou.
 */
export function importOutcome(counts: ImportCounts): ImportOutcome {
  const accepted = Math.max(0, counts.acceptedRows);
  const duplicates = Math.max(0, counts.duplicateRows);
  const rejectedRows = Math.max(0, counts.discardedRows);
  return {
    status: (counts.unreadableLines ?? 0) > 0 ? "partial" : "confirmed",
    rejectedRows,
    totalRows: accepted + duplicates + rejectedRows,
  };
}

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
