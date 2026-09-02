// ASCENDE — Proveniência: de onde cada registro veio, e o que aconteceu na
// importação que o trouxe.
//
// "Absorver" um arquivo não é anexá-lo: é receber, extrair, deduplicar,
// mostrar prévia, CONFIRMAR, persistir com origem e emitir recibo (plano
// refinado §4.1). Sem esta camada o app grava os eventos e esquece a origem —
// não dá para responder "quantas linhas entraram?", "já importei isto?" nem
// abrir depois o que foi feito.
//
// Duas regras de produto moram aqui:
// • O ARQUIVO BRUTO É DESCARTADO. Guardamos só o SHA-256 do conteúdo — o
//   bastante para reconhecer o mesmo arquivo, e nada além (§4.4).
// • Reimportar o mesmo arquivo não pode criar registro nem XP de novo. O
//   índice único (user_id, file_hash) e o marco por fonte cuidam disso; aqui
//   a garantia é `createSource` REAPROVEITAR a fonte existente em vez de
//   abrir uma segunda trilha para o mesmo arquivo.
//
// I/O mora aqui (mesmo padrão de captureEvents.ts e statementImport.ts);
// lógica pura de parsing continua em healthImport.ts.

import { supabase } from "@/integrations/supabase/client";
import { isDuplicateError } from "@/lib/dataSourcesPure";

// Reexporta as partes puras: quem consome esta camada não precisa saber que
// elas moram noutro arquivo (a separação existe só para o teste rodar sem
// puxar o cliente Supabase).
export {
  hashFile, fingerprintLargeFile, isDuplicateError, sourceKindLabel,
  buildReceiptSummary, importOutcome, markAlreadyImported, markAlreadyInHistory,
  importMilestoneLabel, importMilestoneSourceId, IMPORT_MILESTONE_PREFIX,
} from "@/lib/dataSourcesPure";
export type { HashInput, ImportCounts, ImportOutcome } from "@/lib/dataSourcesPure";

/* ── Tipos (contrato com a interface) ─────────────────────────────────────
   Os nomes dos campos são os MESMOS das colunas do banco, de propósito: uma
   camada de tradução a mais seria um lugar a mais para os dois lados
   discordarem em silêncio. */

/** Natureza da origem — não confundir com o FORMATO do arquivo (sono, treino,
 *  medidas): esse detalhe vive em `display_name` e `parser_version`. */
export type DataSourceKind =
  | "health_csv"          // CSV de app de saúde (Sleep Cycle, Hevy…)
  | "health_export"       // export completo do App Saúde do iPhone (zip/xml)
  | "financial_statement" // fatura, extrato, comprovante
  | "chat_attachment"     // arquivo enviado na conversa com o Conselheiro
  | "manual";             // origem declarada à mão

/** previewed: lida, ainda não confirmada · confirmed: gravada ·
 *  partial: gravada com parte rejeitada · failed: não deu para gravar ·
 *  deleted: a pessoa removeu a fonte (os registros continuam de pé). */
export type DataSourceStatus = "previewed" | "confirmed" | "partial" | "failed" | "deleted";

export interface DataSource {
  id: string;
  user_id: string;
  kind: DataSourceKind;
  /** Nome que a PESSOA reconhece ("sleepdata.csv"), não um id técnico. */
  display_name: string;
  file_hash: string | null;
  parser_version: string | null;
  /** "YYYY-MM-DD" (colunas `date`), ou null quando o período é desconhecido. */
  period_start: string | null;
  period_end: string | null;
  status: DataSourceStatus;
  /** ISO 8601 com fuso (timestamptz). */
  created_at: string;
  confirmed_at: string | null;
}

/** Aviso de importação: `message` já vem em português, pronto para a tela;
 *  `code` existe para a interface agrupar/iconizar sem reler o texto. */
export interface ImportWarning {
  code: string;
  message: string;
  count?: number;
}

export interface ImportReceipt {
  id: string;
  source_id: string;
  user_id: string;
  total_rows: number;
  accepted_rows: number;
  duplicate_rows: number;
  rejected_rows: number;
  warnings: ImportWarning[];
  /** Frase pronta em linguagem de usuário (a tela mostra sem traduzir). */
  summary: string | null;
  created_at: string;
}

/** O que a tela de Fontes consome: a fonte e o recibo MAIS RECENTE dela
 *  (reimportar o mesmo arquivo gera um recibo novo na mesma fonte). */
export interface DataSourceWithReceipt extends DataSource {
  receipt: ImportReceipt | null;
  /** A consulta de recibos FALHOU — `receipt: null` aqui não quer dizer "não
   *  há recibo", quer dizer "não consegui carregar". A diferença é a promessa
   *  inteira da Fase 1: negar doze recibos que existem no banco é pior do que
   *  dizer que a lista não carregou. */
  receiptUnavailable?: boolean;
}

export interface NewDataSource {
  userId: string;
  kind: DataSourceKind;
  displayName: string;
  /** SHA-256 hex do conteúdo (hashFile). Sem ele não há reconhecimento de
   *  reimportação — passe sempre que houver arquivo. */
  fileHash?: string | null;
  parserVersion?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export interface NewImportReceipt {
  sourceId: string;
  userId: string;
  totalRows: number;
  acceptedRows: number;
  duplicateRows: number;
  rejectedRows: number;
  warnings?: ImportWarning[];
  summary?: string | null;
}

/* ── Hash do arquivo ────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);

function toSource(row: Row): DataSource {
  return {
    id: str(row.id),
    user_id: str(row.user_id),
    kind: str(row.kind) as DataSourceKind,
    display_name: str(row.display_name),
    file_hash: strOrNull(row.file_hash),
    parser_version: strOrNull(row.parser_version),
    period_start: strOrNull(row.period_start),
    period_end: strOrNull(row.period_end),
    status: str(row.status) as DataSourceStatus,
    created_at: str(row.created_at),
    confirmed_at: strOrNull(row.confirmed_at),
  };
}

/** `warnings` é jsonb: aceita tanto a lista estruturada quanto uma lista de
 *  strings (recibos antigos ou escritos à mão) sem quebrar a tela. */
function toWarnings(value: unknown): ImportWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((w): ImportWarning[] => {
    if (typeof w === "string") return [{ code: "aviso", message: w }];
    if (w && typeof w === "object") {
      const o = w as Row;
      const message = str(o.message ?? o.text ?? "");
      if (!message) return [];
      return [{
        code: str(o.code ?? "aviso"),
        message,
        ...(o.count !== undefined ? { count: num(o.count) } : {}),
      }];
    }
    return [];
  });
}

function toReceipt(row: Row): ImportReceipt {
  return {
    id: str(row.id),
    source_id: str(row.source_id),
    user_id: str(row.user_id),
    total_rows: num(row.total_rows),
    accepted_rows: num(row.accepted_rows),
    duplicate_rows: num(row.duplicate_rows),
    rejected_rows: num(row.rejected_rows),
    warnings: toWarnings(row.warnings),
    summary: strOrNull(row.summary),
    created_at: str(row.created_at),
  };
}

/**
 * "Já importei este arquivo?" — a pergunta que se faz ANTES de importar.
 * Devolve a fonte existente (inclusive uma já excluída, com status
 * 'deleted') ou null. Em falha de rede devolve null e registra no console:
 * o índice único do banco continua sendo a garantia final.
 */
export async function findSourceByHash(userId: string, fileHash: string): Promise<DataSource | null> {
  if (!userId || !fileHash) return null;
  const { data, error } = await supabase.from("data_sources")
    .select("*").eq("user_id", userId).eq("file_hash", fileHash).maybeSingle();
  if (error) { console.error("findSourceByHash", error.message); return null; }
  return data ? toSource(data as Row) : null;
}

/**
 * Cria a fonte (status 'previewed') ou REAPROVEITA a que já existe para o
 * mesmo arquivo — é isto que impede o mesmo CSV de abrir duas trilhas.
 * Fonte antes excluída volta a valer (status 'previewed'), com o nome e o
 * período do arquivo que acabou de chegar.
 */
export async function createSource(input: NewDataSource): Promise<DataSource> {
  const fileHash = input.fileHash ?? null;
  if (fileHash) {
    const existing = await findSourceByHash(input.userId, fileHash);
    if (existing && existing.status !== "deleted") return existing;
    if (existing) {
      const { data, error } = await supabase.from("data_sources").update({
        status: "previewed",
        display_name: input.displayName,
        parser_version: input.parserVersion ?? existing.parser_version,
        period_start: input.periodStart ?? existing.period_start,
        period_end: input.periodEnd ?? existing.period_end,
        confirmed_at: null,
      }).eq("id", existing.id).select().single();
      if (error) throw error;
      return toSource(data as Row);
    }
  }

  const { data, error } = await supabase.from("data_sources").insert({
    user_id: input.userId,
    kind: input.kind,
    display_name: input.displayName,
    file_hash: fileHash,
    parser_version: input.parserVersion ?? null,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    status: "previewed",
  }).select().single();

  // 23505: outra aba/janela criou a mesma fonte no meio do caminho. Não é
  // erro para a pessoa — é a resposta certa, só chegou pelo outro lado.
  if (error) {
    if (error.code === "23505" && fileHash) {
      const raced = await findSourceByHash(input.userId, fileHash);
      if (raced) return raced;
    }
    throw error;
  }
  return toSource(data as Row);
}

async function setStatus(
  sourceId: string, status: DataSourceStatus, extra: Row = {},
): Promise<DataSource | null> {
  const { data, error } = await supabase.from("data_sources")
    .update({ status, ...extra }).eq("id", sourceId).select().maybeSingle();
  if (error) { console.error("setStatus", status, error.message); return null; }
  return data ? toSource(data as Row) : null;
}

/** Tudo que era para entrar entrou. */
export const confirmSource = (sourceId: string): Promise<DataSource | null> =>
  setStatus(sourceId, "confirmed", { confirmed_at: new Date().toISOString() });

/** Parte entrou, parte não. O recibo diz quanto de cada — e é por isso que
 *  'partial' não é falha: o que entrou está no histórico e vale. */
export const markSourcePartial = (sourceId: string): Promise<DataSource | null> =>
  setStatus(sourceId, "partial", { confirmed_at: new Date().toISOString() });

/** Nada entrou. Mantemos a fonte assim mesmo: "tentei e não deu" é
 *  informação, e sumir com a tentativa é o que faz a pessoa desconfiar. */
export const markSourceFailed = (sourceId: string): Promise<DataSource | null> =>
  setStatus(sourceId, "failed");

/**
 * Exclusão da fonte: marca como 'deleted' e some da lista. Os registros já
 * confirmados NÃO são apagados (§4.4) — a pessoa viveu aquelas noites de
 * sono, e apagar o histórico dela porque o arquivo saiu de cena seria o
 * oposto do que esta camada existe para fazer.
 */
export async function deleteSource(sourceId: string): Promise<void> {
  const { error } = await supabase.from("data_sources")
    .update({ status: "deleted" }).eq("id", sourceId);
  if (error) throw error;
}

/** Recibo mais recente de uma fonte (reimportação gera outro na mesma fonte). */
export async function getReceipt(sourceId: string): Promise<ImportReceipt | null> {
  const { data, error } = await supabase.from("import_receipts")
    .select("*").eq("source_id", sourceId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error("getReceipt", error.message); return null; }
  return data ? toReceipt(data as Row) : null;
}

export async function createReceipt(input: NewImportReceipt): Promise<ImportReceipt | null> {
  const { data, error } = await supabase.from("import_receipts").insert({
    source_id: input.sourceId,
    user_id: input.userId,
    total_rows: input.totalRows,
    accepted_rows: input.acceptedRows,
    duplicate_rows: input.duplicateRows,
    rejected_rows: input.rejectedRows,
    warnings: input.warnings ?? [],
    summary: input.summary ?? null,
  }).select().single();
  // O recibo não pode derrubar uma importação que JÁ gravou: perder o recibo
  // é ruim, perder a gravação seria pior. O chamador segue e avisa.
  if (error) { console.error("createReceipt", error.message); return null; }
  return toReceipt(data as Row);
}

/**
 * O que a tela de Fontes e importações consome: fontes da pessoa (exceto as
 * excluídas), mais recentes primeiro, cada uma com seu recibo mais novo.
 */
export async function listSourcesWithReceipts(
  userId: string, limit = 50,
): Promise<DataSourceWithReceipt[]> {
  if (!userId) return [];
  const { data, error } = await supabase.from("data_sources")
    .select("*").eq("user_id", userId).neq("status", "deleted")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) { console.error("listSourcesWithReceipts", error.message); return []; }

  const sources = (data ?? []).map((r) => toSource(r as Row));
  if (!sources.length) return [];

  const { data: receiptRows, error: rErr } = await supabase.from("import_receipts")
    .select("*").in("source_id", sources.map((s) => s.id))
    .order("created_at", { ascending: false });
  if (rErr) {
    // NÃO devolvemos `receipt: null` calado: a tela mostraria "sem recibo" em
    // toda fonte, e a pessoa leria que a trilha que prometemos nunca existiu.
    console.error("listSourcesWithReceipts recibos", rErr.message);
    return sources.map((s) => ({ ...s, receipt: null, receiptUnavailable: true }));
  }

  // Vem em ordem decrescente: o primeiro de cada fonte é o mais recente.
  const latest = new Map<string, ImportReceipt>();
  for (const row of receiptRows ?? []) {
    const receipt = toReceipt(row as Row);
    if (!latest.has(receipt.source_id)) latest.set(receipt.source_id, receipt);
  }
  return sources.map((s) => ({ ...s, receipt: latest.get(s.id) ?? null }));
}

/* Página da consulta de chaves. O PostgREST tem teto próprio de linhas por
   resposta (`max-rows`), então pedir "tudo" não traz tudo: é preciso paginar
   com `range` até vir uma página incompleta. */
const KEYS_PAGE = 1000;
/* Teto de sanidade. MAX_IMPORT_EVENTS é 1.000 por importação, então 50 mil
   chaves cobrem dezenas de reimportações da mesma fonte com folga. */
const KEYS_MAX = 50_000;

/**
 * Chaves de registro que ESTA fonte já gravou. Consultar antes de inserir é
 * o que evita reenviar centenas de linhas para o banco recusar uma a uma —
 * o índice único continua sendo a garantia, isto é só o caminho barato.
 *
 * PAGINA de propósito. A versão anterior pedia `.limit(5000)` e parava ali:
 * numa fonte com mais chaves que isso, o pré-filtro ficava incompleto, o
 * insert em lote batia no índice único e o fallback caía para UMA REQUISIÇÃO
 * POR LINHA. Com o export do App Saúde (muito mais registros que um CSV),
 * isso deixou de ser hipótese.
 *
 * Em falha devolve o que já juntou: pior caso, o insert descobre as
 * duplicatas pelo caminho de exceção, que o chamador já sabe tratar.
 */
export async function existingRecordKeys(
  table: "life_events" | "transactions", userId: string, dataSourceId: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let from = 0; from < KEYS_MAX; from += KEYS_PAGE) {
    const { data, error } = await supabase.from(table)
      .select("source_record_key")
      .eq("user_id", userId).eq("data_source_id", dataSourceId)
      .not("source_record_key", "is", null)
      .order("source_record_key", { ascending: true })
      .range(from, from + KEYS_PAGE - 1);
    if (error) { console.error("existingRecordKeys", table, error.message); break; }
    const rows = data ?? [];
    for (const r of rows) keys.add(str((r as Row).source_record_key));
    // Página incompleta = acabou. É o único jeito de saber, já que o
    // PostgREST pode cortar a resposta antes do tamanho pedido.
    if (rows.length < KEYS_PAGE) break;
  }
  return keys;
}

/**
 * Marco de +15 XP por importação concluída — o ÚNICO XP que importar gera.
 * Organizar a própria história merece reconhecimento; o TAMANHO do arquivo,
 * não (PRINCIPIOS.md): são 15 pontos por fonte, nunca por linha.
 *
 * Idempotente: chamar de novo para a mesma fonte devolve false e não concede
 * nada. Sem `sourceId`, vale a regra antiga de um marco por mês — é o que
 * sobra quando não existe arquivo com identidade (foto, print no chat).
 *
 * Devolve true só quando o XP foi concedido AGORA, para a tela saber se fala
 * em XP ou fica quieta.
 */
export async function awardImportMilestone(sourceId?: string | null): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "award_import_milestone", sourceId ? { p_source_id: sourceId } : {},
  );
  if (error) { console.error("awardImportMilestone", error.message); return false; }
  return data === true;
}


/**
 * Nome legível de cada fonte, por id. Serve ao extrato de XP: a razão gravada
 * pelo banco carrega o uuid da fonte, e é aqui que ele vira "exportar.zip".
 *
 * Em falha devolve mapa vazio — o extrato então mostra "Importação concluída"
 * sem o nome, que é pior que o nome e muito melhor que um uuid na cara.
 */
export async function sourceNamesByIds(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map();
  const { data, error } = await supabase.from("data_sources")
    .select("id,display_name").in("id", unicos);
  if (error) { console.error("sourceNamesByIds", error.message); return new Map(); }
  return new Map((data ?? []).map((r) => [str((r as Row).id), str((r as Row).display_name)]));
}
