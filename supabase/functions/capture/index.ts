// ASCENDE — Captura conversacional
// Texto livre → eventos estruturados PROPOSTOS + memórias duráveis, em UMA
// única chamada de IA (modelo econômico). O app pede confirmação antes de
// gravar qualquer evento — a IA nunca grava sozinha.
// Limite diário por plano validado NO SERVIDOR (free: 3/dia; Ascende+: 30/dia).
//
// Fatura em toda IA: a captura também aceita UMA imagem (print de fatura,
// comprovante de Pix, cupom, tela de treino). Uma única chamada multimodal
// decide: imagem financeira → lançamentos propostos (statement_items, mesma
// revisão em lote da importação); qualquer outra imagem → eventos normais.
// A imagem usa a MESMA cota da captura (nenhuma cota nova) e é processada e
// descartada — nada fica armazenado (página /recusas).
import {
  serviceClient, requireUser, assertRateLimit, corsFor, isTrivialMessage,
  extractEventsAndMemories,
  MODEL_FAST, CAPTURE_TOOL, CAPTURE_SYSTEM,
  STATEMENT_TOOL, STATEMENT_SYSTEM, normalizeStatementItems,
} from "../_shared/lib.ts";
import { anthropicCall, reserveUsage, releaseUsage } from "../_shared/usage.ts";
import { getEntitlements, spDayStartUtc, nextSpDayStartUtc, limitResponse, spParts } from "../_shared/entitlements.ts";

const MAX_IMG_B64 = 7_000_000;   // ~5 MB de imagem
const IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Guarda-corpo de custo: um print com MUITOS itens é uma fatura completa —
// o caminho certo é a importação (que tem contrato de cota próprio e
// deduplicação melhor). Acima do limite, devolvemos o convite, não a lista.
const STATEMENT_REDIRECT_ITEMS = 25;

/* Tool combinado da captura com imagem: numa única chamada o modelo decide
   se a imagem é financeira (items) ou vira eventos de vida (events). */
const IMAGE_CAPTURE_TOOL = {
  name: "interpretar_captura",
  description:
    "Interpreta a imagem (e o texto opcional) enviados pelo usuário. Se a imagem contiver transações " +
    "financeiras (fatura, extrato, comprovante de Pix, print de compra, cupom), preencha is_statement e items. " +
    "Caso contrário, extraia eventos de vida em events (tela de app de treino vira workout; foto sem nada registrável = arrays vazios).",
  input_schema: {
    type: "object",
    properties: {
      is_statement: (STATEMENT_TOOL.input_schema.properties as Record<string, unknown>).is_statement,
      items: (STATEMENT_TOOL.input_schema.properties as Record<string, unknown>).items,
      statement_note: (STATEMENT_TOOL.input_schema.properties as Record<string, unknown>).note,
      events: (CAPTURE_TOOL.input_schema.properties as Record<string, unknown>).events,
    },
    required: ["is_statement", "items", "events"],
  },
};

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  // A reserva vive FORA do try: o catch externo precisa devolvê-la. Antes,
  // um erro inesperado (rede, banco) consumia definitivamente uma captura do
  // dia — o oposto do que a mensagem de erro promete ao usuário.
  const supabase = serviceClient();
  let reservationId: number | null = null;
  const refund = async () => {
    if (reservationId === null) return;
    await releaseUsage(supabase, reservationId);
    reservationId = null;
  };

  try {
    const user = await requireUser(req, supabase);
    await assertRateLimit(supabase, user.id, "capture", 80, 5); // anti-abuso (independe de plano)

    const { text, image, media_type } = await req.json();
    if (!text || typeof text !== "string" || text.length > 2000) {
      return json({ error: "Texto inválido." }, 400);
    }
    const hasImage = typeof image === "string" && image.length > 0;
    if (hasImage && (image.length > MAX_IMG_B64 || !IMG_TYPES.includes(String(media_type)))) {
      return json({ error: "Imagem inválida ou grande demais (até ~5 MB, JPG/PNG/WebP)." }, 400);
    }

    // Mensagens sem conteúdo registrável não consomem cota nem chamada de IA
    if (!hasImage && isTrivialMessage(text)) return json({ events: [], learned: [] });

    // Limite do plano (validado no servidor; frontend só exibe).
    // A cota é RESERVADA atomicamente ANTES da chamada (duas requisições
    // simultâneas não passam juntas) e DEVOLVIDA se a extração falhar —
    // tentativa fracassada não consome limite (plano §3.4/§3.6).
    // Imagem usa a MESMA cota da captura: é só outra forma da mesma frase.
    const ent = await getEntitlements(supabase, user.id);
    if (ent.flags.premium_limits_enabled && ent.limits.capture_daily !== null) {
      const { id } = await reserveUsage(supabase, user.id, "capture", ent.limits.capture_daily, spDayStartUtc());
      if (id === null) {
        return limitResponse(req, "capture", ent.limits.capture_daily, nextSpDayStartUtc(),
          `Você usou as ${ent.limits.capture_daily} capturas inteligentes de hoje. Registros manuais continuam ilimitados.`);
      }
      reservationId = id;
    }

    // ── Caminho com imagem: uma chamada multimodal decide o destino ──
    if (hasImage) {
      const todayIso = spParts().dateIso;
      const { res, data } = await anthropicCall(supabase, user.id, "capture-imagem", {
        model: MODEL_FAST,
        max_tokens: 8000,
        system: `${CAPTURE_SYSTEM}\n\n━━━ IMAGENS FINANCEIRAS ━━━\n${STATEMENT_SYSTEM}\n\nData de hoje (fuso de São Paulo): ${todayIso}.\nUse SEMPRE a ferramenta interpretar_captura. Decida: imagem financeira → is_statement:true e items (events vazio); qualquer outra imagem → is_statement:false e events extraídos da imagem + texto (prints de app de treino viram workout; foto de prato vira meal com calorias estimadas).`,
        tools: [IMAGE_CAPTURE_TOOL],
        tool_choice: { type: "tool", name: "interpretar_captura" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type, data: image } },
            { type: "text", text: `Relato do usuário (opcional): ${text.slice(0, 2000)}` },
          ],
        }],
      }, { reservationId });

      if (!res.ok || !data) {
        await refund();
        return json({ error: "Não consegui ler a imagem agora. Tente de novo em instantes — a tentativa não contou no seu limite." }, 502);
      }
      // deno-lint-ignore no-explicit-any
      const tu = ((data as any).content ?? []).find((b: any) => b.type === "tool_use");
      const inp = tu?.input ?? {};
      if (inp.is_statement) {
        const rawItems = Array.isArray(inp.items) ? inp.items : [];
        if (rawItems.length > STATEMENT_REDIRECT_ITEMS) {
          return json({
            events: [], learned: [], statement_items: [],
            statement_note:
              "Essa imagem parece uma fatura completa, com muitos lançamentos. O melhor caminho é a " +
              "importação de fatura (em Prosperidade): ela expande parcelas e evita duplicatas com mais precisão.",
          });
        }
        const items = normalizeStatementItems(rawItems);
        if (items.length) {
          return json({
            events: [], learned: [],
            statement_items: items,
            statement_note: inp.statement_note ? String(inp.statement_note).slice(0, 240) : null,
          });
        }
      }
      const events = Array.isArray(inp.events) ? inp.events : [];
      return json({ events, learned: [] });
    }

    // ── Caminho original (texto): eventos + memórias em UMA chamada ──
    const { ok, events, learned } = await extractEventsAndMemories(
      supabase, user.id, text, "capture", ent.limits.memory_cap, { reservationId },
    );
    if (!ok) {
      await refund();
      return json({ error: "Não consegui interpretar agora. Tente de novo em instantes — a tentativa não contou no seu limite." }, 502);
    }
    return json({ events, learned });
  } catch (e) {
    // Erro inesperado: devolve a reserva antes de sair.
    await refund().catch((err) => console.error("refund", err));
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});