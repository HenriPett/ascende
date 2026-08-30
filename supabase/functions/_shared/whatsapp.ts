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
//   APP_URL                   ex.: https://ascende.app (links de retorno)
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v21.0";

export function appUrl(): string {
  return (Deno.env.get("APP_URL") ?? "https://ascende.app").replace(/\/$/, "");
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
    if (!ev || typeof ev.kind !== "string" || typeof ev.pillar !== "string") continue;
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
    const evDay = String(ev.occurred_at ?? "").slice(0, 10);
    const retroDay = /^\d{4}-\d{2}-\d{2}$/.test(evDay) && evDay < todayIso ? evDay : null;
    const { error } = await supabase.from("life_events").insert({
      user_id: userId, pillar: ev.pillar, kind: ev.kind, payload, source: "whatsapp",
      ...(retroDay ? { occurred_at: `${retroDay}T12:00:00-03:00` } : {}),
    });
    if (error) { console.error("wa save event", error.message); continue; }
    saved++; xp += xpForKind(ev.kind);
  }
  return { saved, xp };
}