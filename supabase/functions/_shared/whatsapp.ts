// ASCENDE — WhatsApp Cloud API (Meta), helpers compartilhados.
//
// Papel do canal (decisão de produto): o WhatsApp CHAMA a pessoa de volta
// para o app — ele não é um segundo app. Toda mensagem de saída é um convite
// curto com link; a captura inbound confirma por botão e aponta o painel.
//
// Custo (modelo por mensagem, jul/2025+): conversas iniciadas pelo USUÁRIO
// (captura + nossas respostas na janela de 24h) são a categoria de serviço;
// mensagens que NÓS iniciamos fora da janela usam templates UTILITY.
//
// Segredos necessários (supabase secrets set ...):
//   WHATSAPP_TOKEN            token permanente do app Meta
//   WHATSAPP_PHONE_NUMBER_ID  id do número no Cloud API
//   WHATSAPP_VERIFY_TOKEN     string sua, usada na verificação do webhook
//   WHATSAPP_APP_SECRET       App Secret (valida a assinatura HMAC do POST)
//   WHATSAPP_CRON_SECRET      segredo do agendador (whatsapp-notify)
//   APP_URL                   ex.: https://ascende.site (links de retorno)
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canonicalPillar } from "./lib.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

export function appUrl(): string {
  return (Deno.env.get("APP_URL") ?? "https://ascende.site").replace(/\/$/, "");
}

function phoneId(): string {
  return Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
}

async function waPost(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH}/${phoneId()}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("WHATSAPP_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    if (!res.ok) {
      console.error("whatsapp send", res.status, (await res.text()).slice(0, 400));
      return false;
    }
    return true;
  } catch (e) {
    console.error("whatsapp send", e);
    return false;
  }
}

/** Texto simples (válido dentro da janela de 24h iniciada pelo usuário). */
export function waSendText(to: string, body: string): Promise<boolean> {
  return waPost({ to, type: "text", text: { body: body.slice(0, 4000), preview_url: true } });
}

/** Mensagem com até 3 botões de resposta rápida (janela de 24h). */
export function waSendButtons(
  to: string, body: string, buttons: { id: string; title: string }[],
): Promise<boolean> {
  return waPost({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body.slice(0, 1024) },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

/** Template aprovado (única forma de INICIAR conversa fora da janela). */
export function waSendTemplate(
  to: string, name: string, lang: string, bodyParams: string[],
): Promise<boolean> {
  return waPost({
    to,
    type: "template",
    template: {
      name,
      language: { code: lang },
      components: bodyParams.length
        ? [{
            type: "body",
            parameters: bodyParams.map((t) => ({ type: "text", text: t.slice(0, 60) })),
          }]
        : [],
    },
  });
}

/** Valida a assinatura HMAC-SHA256 do webhook (X-Hub-Signature-256).
 *  FAIL-CLOSED: sem WHATSAPP_APP_SECRET nada é aceito. A versão anterior
 *  devolvia `true` quando o secret faltava e, como o webhook roda com
 *  verify_jwt = false, qualquer um podia forjar o `from` e se passar por
 *  outra pessoa (inclusive força-brutando o código de pareamento). */
export async function verifyWaSignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!secret) {
    console.error("WHATSAPP_APP_SECRET ausente — webhook do WhatsApp recusado (fail-closed)");
    return false;
  }
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7).toLowerCase();
  if (hex.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/* ─── Mídia recebida (áudio, imagem, documento) ─────────────────────────
   Fluxo do Cloud API: o webhook entrega só um media_id; o download são duas
   chamadas (GET /{id} → URL temporária → GET binário com o mesmo token). */

export type WaMedia = { bytes: Uint8Array; mime: string } | "too_big" | null;

export async function waDownloadMedia(mediaId: string, maxBytes: number): Promise<WaMedia> {
  try {
    const auth = { Authorization: `Bearer ${Deno.env.get("WHATSAPP_TOKEN")}` };
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: auth });
    if (!metaRes.ok) { console.error("wa media meta", metaRes.status); return null; }
    const meta = await metaRes.json();
    if (Number(meta?.file_size) > maxBytes) return "too_big";
    const binRes = await fetch(String(meta.url), { headers: auth });
    if (!binRes.ok) { console.error("wa media bin", binRes.status); return null; }
    const buf = new Uint8Array(await binRes.arrayBuffer());
    if (buf.length > maxBytes) return "too_big";
    return { bytes: buf, mime: String(meta.mime_type ?? "application/octet-stream").split(";")[0] };
  } catch (e) {
    console.error("wa media", e);
    return null;
  }
}

/** Base64 em blocos (evita estourar a pilha com arquivos grandes). */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Transcrição de áudio via Groq (whisper-large-v3-turbo, PT-BR).
 *  Segredo: GROQ_API_KEY. Retorna null em falha (o chamador avisa o usuário). */
export async function groqTranscribe(bytes: Uint8Array, mime: string): Promise<string | null> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) { console.error("GROQ_API_KEY ausente — áudio não transcrito"); return null; }
  try {
    const fd = new FormData();
    const ext = mime.includes("mpeg") ? "mp3" : mime.includes("mp4") ? "m4a" : "ogg";
    fd.append("file", new Blob([bytes.slice().buffer], { type: mime }), `audio.${ext}`);
    fd.append("model", "whisper-large-v3-turbo");
    fd.append("language", "pt");
    fd.append("temperature", "0");
    fd.append("response_format", "json");
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd,
    });
    if (!res.ok) { console.error("groq", res.status, (await res.text()).slice(0, 300)); return null; }
    const j = await res.json();
    const text = typeof j?.text === "string" ? j.text.trim() : "";
    return text || null;
  } catch (e) {
    console.error("groq", e);
    return null;
  }
}

/* ─── Documentos: extração de texto DETERMINÍSTICA (sem IA) ──────────────
   Por que sem IA: CSV de app de sono, .txt, .docx de plano alimentar e
   planilha são formatos ESTRUTURADOS. Ler byte a byte é mais barato, mais
   rápido e — o que importa de verdade em dado de saúde — não inventa. A IA
   só entra depois, no MESMO pipeline de captura do texto digitado, que
   termina no botão de confirmação (a IA nunca grava sozinha, PRINCIPIOS.md).

   O que é lido aqui e o que é recusado:
   • texto puro (.txt .md .csv .tsv .json .log) → decodifica UTF-8;
   • .docx / .xlsx (OOXML = ZIP + XML) → descompacta com DecompressionStream
     e extrai o texto dos XMLs conhecidos;
   • .doc / .xls / .ppt e afins (binário proprietário) → RECUSA explícita.
     Ler esses formatos direito exige um parser de OLE Compound File; ler
     "mais ou menos" produziria lixo com pedaços de texto no meio, e lixo
     virando registro de saúde é pior que arquivo nenhum.
   • PDF continua indo inteiro para o Conselheiro (o modelo lê PDF nativo). */

export type DocKind = "pdf" | "text" | "docx" | "xlsx" | "legacy" | "unsupported";

const EXT_KIND: Record<string, DocKind> = {
  pdf: "pdf",
  txt: "text", text: "text", md: "text", markdown: "text", csv: "text",
  tsv: "text", json: "text", log: "text",
  docx: "docx", docm: "docx",
  xlsx: "xlsx", xlsm: "xlsx",
  doc: "legacy", xls: "legacy", ppt: "legacy", pps: "legacy", rtf: "legacy",
  odt: "legacy", ods: "legacy", pages: "legacy", numbers: "legacy",
};

const MIME_KIND: Record<string, DocKind> = {
  "application/pdf": "pdf",
  "text/plain": "text", "text/markdown": "text", "text/csv": "text",
  "text/comma-separated-values": "text", "text/tab-separated-values": "text",
  "application/json": "text", "text/json": "text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/msword": "legacy", "application/vnd.ms-excel": "legacy",
  "application/vnd.ms-powerpoint": "legacy", "application/rtf": "legacy",
};

/** A EXTENSÃO manda, o mime é só desempate: o WhatsApp entrega .csv ora como
 *  text/csv, ora como application/vnd.ms-excel (que aqui significaria "recusa
 *  formato antigo") — o nome do arquivo é o sinal confiável. */
export function classifyDocument(mime: string, filename: string): DocKind {
  const ext = (filename.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? "").toLowerCase();
  if (ext && EXT_KIND[ext]) return EXT_KIND[ext];
  const m = String(mime ?? "").split(";")[0].trim().toLowerCase();
  if (MIME_KIND[m]) return MIME_KIND[m];
  if (m.startsWith("text/")) return "text";
  return "unsupported";
}

/* Teto do que descompactamos de dentro de um OOXML. Um .xlsx de 4 MB pode
   expandir para gigabytes (zip bomb); o teto é a defesa, já que o webhook
   roda sem autenticação de origem além da assinatura da Meta. */
const UNZIP_MAX_BYTES = 12 * 1024 * 1024;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

type ZipEntry = { method: number; compSize: number; rawSize: number; localOffset: number };

/** Índice do diretório central do ZIP (nome → entrada). null se não for ZIP. */
function zipIndex(buf: Uint8Array): Map<string, ZipEntry> | null {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 66_000); // 64 KB de comentário + cabeçalho
  for (let i = buf.length - 22; i >= floor; i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = u16(buf, eocd + 10);
  let off = u32(buf, eocd + 16);
  const dec = new TextDecoder();
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || u32(buf, off) !== 0x02014b50) break;
    const nameLen = u16(buf, off + 28);
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen));
    out.set(name, {
      method: u16(buf, off + 10),
      compSize: u32(buf, off + 20),
      rawSize: u32(buf, off + 24),
      localOffset: u32(buf, off + 42),
    });
    off += 46 + nameLen + u16(buf, off + 30) + u16(buf, off + 32); // + extra + comentário
  }
  return out.size ? out : null;
}

/** Conteúdo de uma entrada como texto UTF-8 (stored ou deflate). */
async function zipReadText(buf: Uint8Array, e: ZipEntry | undefined): Promise<string | null> {
  if (!e || e.rawSize > UNZIP_MAX_BYTES) return null;
  const lo = e.localOffset;
  if (lo + 30 > buf.length || u32(buf, lo) !== 0x04034b50) return null;
  const start = lo + 30 + u16(buf, lo + 26) + u16(buf, lo + 28);
  const data = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) return null; // bzip2/lzma em OOXML: não acontece na prática
  try {
    const stream = new Blob([data.slice().buffer])
      .stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const reader = stream.getReader();
    const dec = new TextDecoder("utf-8");
    let text = "", total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > UNZIP_MAX_BYTES) { await reader.cancel(); return null; } // rawSize mentiu
      text += dec.decode(value, { stream: true });
    }
    return text + dec.decode();
  } catch (err) {
    console.error("unzip", err);
    return null;
  }
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Texto de word/document.xml. Só <w:t> entra: <w:delText> (texto DELETADO em
 *  controle de alterações) e <w:instrText> (código de campo) ficam de fora —
 *  incluí-los faria a IA ler o que a pessoa apagou. Parágrafo/quebra viram
 *  linha; célula de tabela vira tabulação (a tabela continua legível). */
function docxText(xml: string, maxChars: number): { text: string; truncated: boolean } {
  const re =
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*>|<w:br\b[^>]*>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;
  const parts: string[] = [];
  let len = 0, truncated = false, m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const piece = m[1] !== undefined
      ? xmlUnescape(m[1])
      : m[0].startsWith("<w:tab") || m[0] === "</w:tc>" ? "\t" : "\n";
    parts.push(piece);
    len += piece.length;
    if (len > maxChars) { truncated = true; break; }
  }
  return { text: parts.join(""), truncated };
}

/* ── .xlsx ──────────────────────────────────────────────────────────────
   O risco real da planilha não é o ZIP: é a DATA. O Excel guarda
   "10/09/2025" como o número 45910, e quem lê a célula sem consultar o
   estilo entrega "45910" para a IA — que então registra um peso na data
   errada. Por isso lemos xl/styles.xml e convertemos as células com formato
   de data (e respeitamos o sistema 1904 dos Excel antigos de Mac). */

const BUILTIN_DATE_FMTS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

/** Formato customizado é data quando sobra y/m/d/h/s fora de literais e de
 *  seções entre colchetes (cor, locale, [h] de horas decorridas). */
const isDateFormatCode = (code: string) =>
  /[ymdhs]/i.test(code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, ""));

/** styles.xml → para cada índice de cellXfs, se aquele estilo é de data. */
function xlsxDateStyles(stylesXml: string): boolean[] {
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    custom.set(Number(m[1]), xmlUnescape(m[2]));
  }
  const block = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const out: boolean[] = [];
  for (const xf of block.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(xf[0].match(/numFmtId="(\d+)"/)?.[1] ?? "0");
    out.push(BUILTIN_DATE_FMTS.has(id) || isDateFormatCode(custom.get(id) ?? ""));
  }
  return out;
}

/** Número de série do Excel → "AAAA-MM-DD" (com hora quando houver). */
function excelSerialToText(serial: number, date1904: boolean): string {
  if (!isFinite(serial) || serial < 0 || serial > 2_958_465) return String(serial);
  // Âncora 1899-12-30 absorve o bug do ano bissexto de 1900 a partir do dia 60;
  // abaixo dele o Excel conta um dia fantasma, corrigido aqui.
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const corr = !date1904 && serial < 60 ? 86_400_000 : 0;
  const d = new Date(base + Math.round(serial * 86_400) * 1000 + corr);
  const iso = d.toISOString();
  const frac = serial - Math.floor(serial);
  return frac > 1e-6 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

function xlsxSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
    let s = "";
    for (const t of si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += xmlUnescape(t[1]);
    out.push(s);
  }
  return out;
}

/** "AB12" → 27 (índice 0). Preserva colunas vazias no meio da linha. */
function colIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function xlsxSheetRows(
  xml: string, shared: string[], dateStyles: boolean[], date1904: boolean, maxChars: number,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let len = 0;
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], inner = c[2] ?? "";
      const type = attrs.match(/\st="([^"]*)"/)?.[1] ?? "n";
      const raw = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? "";
      let val: string;
      if (type === "s") {
        val = shared[Number(raw)] ?? "";
      } else if (type === "inlineStr") {
        val = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
          .map((t) => xmlUnescape(t[1])).join("");
      } else if (type === "b") {
        val = raw === "1" ? "VERDADEIRO" : "FALSO";
      } else if (type === "str" || type === "e") {
        val = xmlUnescape(raw);
      } else {
        const styleIdx = Number(attrs.match(/\ss="(\d+)"/)?.[1] ?? "-1");
        val = raw && dateStyles[styleIdx] ? excelSerialToText(Number(raw), date1904) : xmlUnescape(raw);
      }
      val = val.replace(/[\t\r\n]+/g, " ").trim();
      const at = colIndex(attrs.match(/\sr="([A-Z]+\d+)"/)?.[1] ?? "");
      if (at >= 0) { while (cells.length < at) cells.push(""); cells[at] = val; }
      else cells.push(val);
    }
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (!cells.length) continue;
    const line = cells.join("\t");
    lines.push(line);
    len += line.length + 1;
    if (len > maxChars) return { lines, truncated: true };
  }
  return { lines, truncated: false };
}

async function xlsxText(
  buf: Uint8Array, zip: Map<string, ZipEntry>, maxChars: number,
): Promise<{ text: string; truncated: boolean } | null> {
  const [workbook, rels, sharedXml, stylesXml] = await Promise.all([
    zipReadText(buf, zip.get("xl/workbook.xml")),
    zipReadText(buf, zip.get("xl/_rels/workbook.xml.rels")),
    zipReadText(buf, zip.get("xl/sharedStrings.xml")),
    zipReadText(buf, zip.get("xl/styles.xml")),
  ]);
  const shared = sharedXml ? xlsxSharedStrings(sharedXml) : [];
  const dateStyles = stylesXml ? xlsxDateStyles(stylesXml) : [];
  const date1904 = /date1904="(1|true)"/.test(workbook ?? "");

  // Nome da aba → arquivo, via rels. Sem rels, cai para a ordem dos arquivos.
  const target = new Map<string, string>();
  for (const r of (rels ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = r[0].match(/Id="([^"]+)"/)?.[1];
    const to = r[0].match(/Target="([^"]+)"/)?.[1];
    if (id && to) target.set(id, `xl/${to.replace(/^\/?(xl\/)?/, "")}`);
  }
  let sheets = [...(workbook ?? "").matchAll(/<sheet\b[^>]*>/g)].map((s) => ({
    name: xmlUnescape(s[0].match(/name="([^"]*)"/)?.[1] ?? ""),
    path: target.get(s[0].match(/r:id="([^"]+)"/)?.[1] ?? "") ?? "",
  })).filter((s) => zip.has(s.path));
  if (!sheets.length) {
    sheets = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort().map((path) => ({ name: "", path }));
  }
  if (!sheets.length) return null;

  const out: string[] = [];
  let budget = maxChars, truncated = false;
  for (const sheet of sheets) {
    const xml = await zipReadText(buf, zip.get(sheet.path));
    if (!xml) continue;
    const { lines, truncated: cut } = xlsxSheetRows(xml, shared, dateStyles, date1904, budget);
    if (cut) truncated = true;
    if (!lines.length) continue;
    const head = sheets.length > 1 || sheet.name ? `Planilha "${sheet.name || sheet.path}":\n` : "";
    const chunk = head + lines.join("\n");
    out.push(chunk);
    budget -= chunk.length;
    if (budget <= 0) { truncated = true; break; }
  }
  if (!out.length) return null;
  return { text: out.join("\n\n"), truncated };
}

/** Texto de um documento estruturado. `null` = não deu para abrir (protegido
 *  por senha, corrompido, formato inesperado); `truncated` = passou do teto,
 *  e o chamador PRECISA recusar em vez de registrar meia informação. */
export async function extractDocumentText(
  kind: DocKind, bytes: Uint8Array, maxChars: number,
): Promise<{ text: string; truncated: boolean } | null> {
  try {
    if (kind === "text") {
      // Decodificação tolerante (UTF-8, não fatal): export de app às vezes traz
      // um byte solto, e perder o arquivo inteiro por isso seria pior.
      const raw = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
      // Sanidade: arquivo BINÁRIO com nome de texto (renomeado, ou mime errado
      // de quem enviou) vira mojibake. Entregar mojibake para a IA é convidar
      // invenção — melhor recusar e pedir o arquivo certo.
      const noise = (raw.match(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
      if (raw.length && noise / raw.length > 0.02) return null;
      const text = raw.replace(/\r\n/g, "\n").trim();
      return { text: text.slice(0, maxChars), truncated: text.length > maxChars };
    }
    if (kind === "docx" || kind === "xlsx") {
      const zip = zipIndex(bytes);
      if (!zip) return null;
      if (kind === "xlsx") return await xlsxText(bytes, zip, maxChars);
      const xml = await zipReadText(bytes, zip.get("word/document.xml"));
      if (!xml) return null;
      const { text, truncated } = docxText(xml, maxChars);
      const clean = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return { text: clean.slice(0, maxChars), truncated: truncated || clean.length > maxChars };
    }
    return null;
  } catch (e) {
    console.error("extractDocumentText", e);
    return null;
  }
}

/* ─── Contexto herdado por resposta curta (rota conversacional) ──────────

   "Foi jantar" sozinho não tem evento nenhum: o relato estava na mensagem
   anterior. Por isso uma resposta curta herda a última fala da pessoa antes
   de ir para a extração — senão o complemento de uma pergunta do Conselheiro
   se perde.

   BUG DE PRODUÇÃO: a heurística não olhava o que aconteceu ENTRE as duas
   falas. Quem descartava a proposta ("✗ Descartar") via o MESMO item voltar a
   cada mensagem curta seguinte: o relato antigo era herdado de novo,
   re-extraído de novo, re-proposto de novo. O `if (!pending)` do webhook só
   protege proposta VIVA; assim que ela é resolvida, o laço recomeça — e um
   "não" da pessoa que volta como pergunta é exatamente o que corrói a
   confiança no canal.

   A fronteira já existia no histórico: todo desfecho de captura (registrado,
   descartado, expirado) grava uma linha de assistant começando por
   CAPTURE_OUTCOME_PREFIX. Tudo que vem ANTES dela já teve seu destino
   decidido e não pode ser ressuscitado. Então a varredura para ali. */

/** A proposta guardada em whatsapp_pending já venceu?
 *
 * Pura (o agora entra por parâmetro) porque é ela que decide se o relato
 * antigo morre: um erro aqui é um item ressuscitando ou um "Confirmar"
 * gravando coisa velha, e os dois são o tipo de defeito que só aparece em
 * produção. `createdAt` ilegível conta como VENCIDA: uma pendente que
 * ninguém consegue datar não pode bloquear proposta nova para sempre. */
export function isPendingExpired(createdAt: unknown, nowMs: number, ttlMin: number): boolean {
  const t = new Date(String(createdAt ?? "")).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t > ttlMin * 60_000;
}

/** Prefixo das linhas de DESFECHO de captura no histórico — escritas por
 *  `captureOutcomeLine` (whatsapp-webhook) e por `capture`. Mora aqui porque
 *  é a FRONTEIRA que `textForExtraction` respeita: quem mudar o formato lá
 *  tem de mudar esta constante junto, ou o laço do bug volta em silêncio. */
export const CAPTURE_OUTCOME_PREFIX = "[registro no diário · ";

/** Até quantos caracteres uma mensagem conta como "resposta curta" — o único
 *  caso em que faz sentido herdar contexto. Frase inteira se explica sozinha. */
export const SHORT_REPLY_CHARS = 60;

/** Uma linha do histórico compartilhado (chat_messages). */
export interface HistoryTurn { role: string; content: string }

/**
 * O texto que vai para a extração: a mensagem, sozinha ou precedida da fala
 * anterior da pessoa quando ela é curta o bastante para ser um complemento.
 *
 * `history` vem em ordem DECRESCENTE (mais recente primeiro), como o webhook
 * lê de chat_messages, e NÃO inclui a mensagem atual.
 *
 * Função pura, sem relógio e sem banco, porque é ela que carrega a regra: o
 * teste que prova que o item descartado não volta é um teste de unidade.
 */
export function textForExtraction(
  text: string, history: readonly HistoryTurn[] = [],
): string {
  if (text.length > SHORT_REPLY_CHARS) return text;
  for (const turn of history) {
    // Desfecho de captura: daqui para trás está tudo resolvido. Para.
    if (turn?.role === "assistant" && String(turn.content ?? "").startsWith(CAPTURE_OUTCOME_PREFIX)) {
      return text;
    }
    if (turn?.role !== "user") continue;
    const prev = String(turn.content ?? "").trim();
    // Repetir a mesma frase não acrescenta contexto, só duplica o relato.
    return prev && prev !== text ? `${prev}\n${text}` : text;
  }
  return text;
}

/* ─── Gravação de eventos confirmados (versão servidor) ──────────────────
   Espelha src/lib/captureEvents.ts (saveProposedEvents): se mudar lá, mude
   aqui. Transações vão para `transactions` (o banco cria o evento derivado);
   o resto vira `life_events`. */

// deno-lint-ignore no-explicit-any
type AnyEvent = Record<string, any>;

/** XP por kind — espelha o gatilho award_xp_for_event do setup.sql. */
const XP_BY_KIND: Record<string, number> = {
  habit_done: 10, workout: 8, practice: 8, mood: 5, sleep: 5, nap: 2,
  meal: 4, water: 2, journal: 6, weight: 3, body: 4, gratitude: 5, transaction: 2,
};
export const xpForKind = (kind: string) => XP_BY_KIND[kind] ?? 3;

export async function saveEventsServer(
  supabase: SupabaseClient, userId: string, events: AnyEvent[],
  sleepHoursFallback?: number | null,
): Promise<{ saved: number; xp: number }> {
  let saved = 0, xp = 0;
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  for (const ev of events) {
    /* A guarda exige `kind`, e SÓ `kind`. Ela também exigia `pillar`, e isso
       virou uma armadilha no dia em que o campo saiu do CAPTURE_TOOL: o
       caminho de imagem do WhatsApp passou a entregar eventos sem ele, e cada
       um era descartado aqui — em silêncio, depois de a pessoa já ter lido
       "Li a foto" e confirmado. Pilar não é mais dado de entrada: é derivado
       do `kind`, logo abaixo. Exigir o que o código calcula é pedir para
       perder captura. */
    if (!ev || typeof ev.kind !== "string") continue;
    if (ev.kind === "transaction" && Number(ev.amount) > 0) {
      const occurred = /^\d{4}-\d{2}-\d{2}$/.test(String(ev.occurred_at ?? "")) &&
          String(ev.occurred_at) <= todayIso
        ? String(ev.occurred_at)
        : todayIso; // itens de fatura trazem a própria data; relato usa hoje
      const { error } = await supabase.from("transactions").insert({
        user_id: userId,
        kind: ev.tx_kind === "income" ? "income" : "expense",
        amount: Number(ev.amount),
        category: ev.category ?? "Outros",
        description: ev.description ?? ev.summary ?? null,
        occurred_at: occurred,
        source: "capture",
      });
      if (error) { console.error("wa save tx", error.message); continue; }
      saved++; xp += xpForKind("transaction");
      continue;
    }
    const payload: Record<string, unknown> = {};
    if (ev.hours) payload.hours = ev.hours;
    if (ev.kind === "sleep" && typeof ev.followed_schedule === "boolean") {
      payload.followed_schedule = ev.followed_schedule;
      if (!ev.hours && ev.followed_schedule && sleepHoursFallback) payload.hours = sleepHoursFallback;
    }
    if (ev.description) payload.description = ev.description;
    if (Array.isArray(ev.muscles) && ev.muscles.length) payload.muscles = ev.muscles;
    if (ev.meal_type) payload.meal_type = ev.meal_type;
    if (Number(ev.calories) > 0) payload.calories = Math.round(ev.calories);
    if (Number(ev.protein_g) > 0) payload.protein_g = Math.round(ev.protein_g);
    if (Number(ev.carbs_g) > 0) payload.carbs_g = Math.round(ev.carbs_g);
    if (Number(ev.fat_g) > 0) payload.fat_g = Math.round(ev.fat_g);
    if (Number(ev.duration_min) > 0) payload.duration_min = Math.round(ev.duration_min);
    if (Number(ev.ml) > 0) payload.ml = Math.round(ev.ml);
    if (Number(ev.kg) > 20 && Number(ev.kg) < 400) payload.kg = ev.kg;
    if (ev.mood_label) payload.label = ev.mood_label;
    if (ev.mood_score) payload.score = ev.mood_score;
    if (ev.kind === "gratitude" && ev.description) payload.text = ev.description;
    payload.summary = ev.summary ?? "";
    // Registro retroativo ("ontem eu almocei..."): o ramo de transaction acima
    // já respeitava a data do evento, mas life_events caía sempre no default
    // now() do banco, então "ontem" virava hoje.
    // Só sobrescrevemos quando a data vem no evento E é anterior a hoje: para
    // o dia corrente o instante REAL do registro vale mais (é ele que situa a
    // refeição no retrato, e é o que a aderência ao plano usa). Data futura é
    // ignorada pelo mesmo motivo que no ramo de transaction.
    // Meio-dia como âncora: sem hora informada, qualquer horário dentro do dia
    // serve, e 12:00 nunca escorrega para o dia vizinho ao ser lido em SP
    // (o Brasil não usa mais horário de verão desde 2019).
    // O dia do evento chega JÁ RESOLVIDO da extração (inclusive a regra do sono,
    // em _shared/lib.ts): o gravador escreve o que a pessoa confirmou, nada mais.
    const evDay = String(ev.occurred_at ?? "").slice(0, 10);
    const retroDay = /^\d{4}-\d{2}-\d{2}$/.test(evDay) && evDay < todayIso ? evDay : null;
    /* O pilar é derivado AQUI, e não confiado ao que veio na proposta: no
       WhatsApp a proposta fica guardada entre uma mensagem e outra, então ela
       pode ter sido escrita por uma instância anterior ao deploy e só ser
       confirmada depois dele. É o mesmo cinto de `lifeEventRow` no cliente. */
    const { error } = await supabase.from("life_events").insert({
      user_id: userId, pillar: canonicalPillar(String(ev.kind ?? ""), ev.pillar),
      kind: ev.kind, payload, source: "whatsapp",
      ...(retroDay ? { occurred_at: `${retroDay}T12:00:00-03:00` } : {}),
    });
    if (error) { console.error("wa save event", error.message); continue; }
    saved++; xp += xpForKind(ev.kind);
  }
  return { saved, xp };
}