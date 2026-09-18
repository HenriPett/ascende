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
  extractEventsAndMemories, SAFETY_RULES, attachMemorySources, nowInSpForPrompt,
  MODEL_FAST, CAPTURE_TOOL, CAPTURE_SYSTEM,
  STATEMENT_TOOL, STATEMENT_SYSTEM, normalizeStatementItems, withCanonicalPillar,
} from "../_shared/lib.ts";
import { anthropicCall, reserveUsage, releaseUsage } from "../_shared/usage.ts";
import { getEntitlements, spDayStartUtc, nextSpDayStartUtc, limitResponse, spParts, TZ } from "../_shared/entitlements.ts";
// deno-lint-ignore no-explicit-any
type AnyEvent = Record<string, any>;

const MAX_IMG_B64 = 7_000_000;   // ~5 MB de imagem
const IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Guarda-corpo de custo: um print com MUITOS itens é uma fatura completa —
// o caminho certo é a importação (que tem contrato de cota próprio e
// deduplicação melhor). Acima do limite, devolvemos o convite, não a lista.
const STATEMENT_REDIRECT_ITEMS = 25;

/* ─── Rastro da captura no histórico do Conselheiro ───────────────────────
   ESPELHO de whatsapp-webhook/index.ts (se mudar lá, mude aqui). Mesmo bug,
   mesmo formato: registrar pela tela Hoje não deixava vestígio em
   chat_messages, então o Conselheiro do app também ficava cego para o que a
   pessoa acabara de registrar e, pressionado, podia inventar o detalhe que
   faltava. A promessa do produto é que a conversa é UMA só (app e WhatsApp),
   então o rastro precisa ser o mesmo nos dois canais.

   Diferença honesta entre os canais: no WhatsApp o servidor confirma e sabe o
   que foi para o diário; aqui a confirmação acontece no cliente (a pessoa
   desmarca o que não quer), então a linha diz o que foi PROPOSTO e aponta o
   retrato como fonte do que de fato entrou. Nunca escrevemos "registrei" para
   algo que ainda pode ser desmarcado. */
const spStamp = () => new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ, day: "2-digit", month: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date());

const eventBullets = (events: AnyEvent[]) => events.slice(0, 12)
  .map((e) => `• ${String(e?.summary ?? e?.kind ?? "registro").slice(0, 160)}`).join("\n");

/** Grava o relato da pessoa e o que foi proposto no histórico compartilhado
 *  com o Conselheiro. Best-effort: falhar aqui não pode derrubar a captura. */
async function pushCaptureHistory(
  // deno-lint-ignore no-explicit-any
  supabase: any, userId: string, userText: string, events: AnyEvent[],
): Promise<string | null> {
  try {
    const relato = String(userText ?? "").trim();
    if (!relato || !events.length) return null; // sem relato ou sem nada registrável, não há o que lembrar
    const { data, error } = await supabase.from("chat_messages").insert([
      { user_id: userId, role: "user", content: relato.slice(0, 4000) },
      {
        user_id: userId, role: "assistant",
        content: `[registro no diário · ${spStamp()}] A partir do que você contou, propus na tela Hoje:\n${eventBullets(events)}\n(O que você confirmou aparece no retrato.)`.slice(0, 4000),
      },
    ]).select("id,role");
    if (error) { console.error("captura: histórico", error.message ?? error); return null; }
    // deno-lint-ignore no-explicit-any
    return (data ?? []).find((m: any) => m.role === "user")?.id ?? null;
  } catch (e) {
    console.error("captura: histórico", e);
    return null;
  }
}

/* ─── Aderência ao plano ativo ────────────────────────────────────────────
   Quando o relato traz refeição ou treino e a pessoa TEM um plano ativo
   daquela área, um comentário curto fecha o ciclo: o plano deixa de ser um
   documento parado em "Meus planos" e passa a conversar com o dia.

   Três decisões que valem registro:
   • NÃO consome cota nova (nenhum reserveUsage): é valor agregado sobre uma
     captura que a pessoa já pagou, não uma feature cobrável à parte. A
     chamada continua aparecendo em ai_usage sob 'capture-aderencia' para o
     custo permanecer auditável.
   • É BEST-EFFORT: qualquer falha vira null e a captura segue intacta. O
     comentário é um bônus; perder o registro do dia por causa dele seria
     trocar o essencial pelo acessório.
   • O horário em São Paulo entra no prompt porque é ele que dá sentido à
     comparação: "almocei pão com salame" às 12h30 conversa com o almoço do
     plano, a mesma frase às 23h conversa com outra coisa. */
const ADHERENCE_MAX_PLAN_CHARS = 3000;
const ADHERENCE_MAX_EVENTS = 6;
/** kind do evento → kind do plano que fala sobre ele. */
const PLAN_KIND_FOR_EVENT: Record<string, string> = { meal: "alimentar", workout: "treino" };

const ADHERENCE_TOOL = {
  name: "comentar_aderencia",
  description:
    "Devolve o comentário curto sobre a aderência do que a pessoa acabou de relatar ao plano ativo dela. " +
    "Devolva string vazia quando não houver nada honesto e útil a dizer.",
  input_schema: {
    type: "object",
    properties: {
      comentario: {
        type: "string",
        description:
          "1 a 2 frases curtas em português do Brasil, no máximo 240 caracteres. " +
          "String VAZIA quando o plano não falar sobre o que foi relatado, quando o horário não permitir " +
          "concluir nada, ou quando o comentário seria genérico.",
      },
    },
    required: ["comentario"],
  },
};

const ADHERENCE_SYSTEM = `Você é o Conselheiro do Ascende, plataforma brasileira de qualidade de vida. A pessoa acabou de relatar algo do dia dela na captura rápida, e ela tem um plano ATIVO salvo. Sua única tarefa: comentar, em 1 ou 2 frases, como o que ela relatou conversa com esse plano.

COMO COMENTAR:
• Bateu com o planejado: reconheça de forma concreta e específica, citando o que bateu ("é exatamente o almoço do seu plano" / "terceiro treino da semana, no ritmo que você definiu"). Nada de elogio vazio ou bajulação.
• Divergiu: diga o que você observou, SEM NENHUMA CULPA, e ofereça UM ajuste pequeno e possível — ou apenas constate com leveza, se não houver ajuste óbvio. Divergir do plano é o caso normal da vida real, não um erro a ser corrigido.
• Use o HORÁRIO para situar o comentário (a refeição do plano para aquele horário, o dia da semana previsto para treino). Se o horário não permitir concluir nada, prefira a string vazia.

LIMITES INEGOCIÁVEIS DESTE COMENTÁRIO:
• NUNCA envergonhe, culpe, repreenda ou use tom de fiscalização. Nada de "você deveria", "era para você ter", "de novo você". O plano serve a pessoa; a pessoa não serve o plano.
• NUNCA trate comida como inimigo, nem use vocabulário de punição, compensação ou restrição ("compense amanhã", "queime isso", "saiu da linha", "furou a dieta").
• NUNCA invente o que está no plano: comente apenas o que o trecho abaixo realmente diz. Se o plano não falar sobre o que foi relatado, devolva string vazia.
• Não repita de volta o que a pessoa disse, não dê aula de nutrição nem de treino, não faça perguntas.
• ESTILO: escreva como uma pessoa escreve. NUNCA use travessão ou meia-risca (— ou –) no comentário que a pessoa vai ler: use vírgula, dois-pontos, parênteses ou outra frase. (Estas instruções usam travessão; a proibição vale para a sua saída.) Nada de "Vamos lá!", "Parabéns!" solto ou fechos genéricos.
• Máximo 240 caracteres. Melhor a string vazia do que um comentário genérico.
${SAFETY_RULES}
Responda SEMPRE usando a ferramenta comentar_aderencia.`;

/** Comentário de aderência ao plano ativo. Best-effort: null em qualquer falha. */
async function planAdherenceComment(
  // deno-lint-ignore no-explicit-any
  supabase: any, userId: string, events: AnyEvent[],
): Promise<string | null> {
  try {
    const wanted = [...new Set(
      events.map((ev) => PLAN_KIND_FOR_EVENT[String(ev?.kind ?? "")]).filter(Boolean),
    )];
    if (!wanted.length) return null;

    const { data: plans, error } = await supabase.from("plans")
      .select("kind,title,content,created_at")
      .eq("user_id", userId).eq("status", "ativo")
      .in("kind", wanted)
      .order("created_at", { ascending: false });
    if (error) { console.error("aderência: falha ao ler planos", error.message ?? error); return null; }

    // O plano ATIVO mais recente de cada área (a lista já vem ordenada).
    const byKind = new Map<string, { kind: string; title: string; content: string }>();
    for (const p of plans ?? []) if (!byKind.has(p.kind)) byKind.set(p.kind, p);
    if (!byKind.size) return null;

    // Só os eventos que têm plano correspondente entram no prompt.
    const relevant = events
      .filter((ev) => byKind.has(PLAN_KIND_FOR_EVENT[String(ev?.kind ?? "")] ?? ""))
      .slice(0, ADHERENCE_MAX_EVENTS);
    if (!relevant.length) return null;

    const planBlocks = [...byKind.values()].map((p) =>
      `━━━ PLANO ATIVO (${p.kind}): "${String(p.title).slice(0, 120)}" ━━━\n` +
      `${String(p.content).slice(0, ADHERENCE_MAX_PLAN_CHARS)}`
    ).join("\n\n");

    const eventLines = relevant
      .map((ev) => `• [${ev.kind}] ${String(ev.summary ?? ev.description ?? "").slice(0, 200)}`)
      .join("\n");

    const { res, data } = await anthropicCall(supabase, userId, "capture-aderencia", {
      model: MODEL_FAST,
      max_tokens: 300,
      system: ADHERENCE_SYSTEM,
      tools: [ADHERENCE_TOOL],
      tool_choice: { type: "tool", name: "comentar_aderencia" },
      messages: [{
        role: "user",
        content: `${nowInSpForPrompt()}\n\n${planBlocks}\n\n━━━ O QUE A PESSOA ACABOU DE RELATAR ━━━\n${eventLines}\n\nComente a aderência em 1 ou 2 frases, ou devolva string vazia.`,
      }],
    });
    if (!res.ok || !data) return null;

    // deno-lint-ignore no-explicit-any
    const tu = ((data as any).content ?? []).find((b: any) => b.type === "tool_use");
    const comment = String(tu?.input?.comentario ?? "").trim();
    return comment ? comment.slice(0, 240) : null;
  } catch (e) {
    // Bônus nunca derruba a captura.
    console.error("aderência: erro inesperado", e);
    return null;
  }
}

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
      return json({ error: "Não consegui ler o texto. Escreva o que você quer registrar, em até 2000 caracteres." }, 400);
    }
    const hasImage = typeof image === "string" && image.length > 0;
    if (hasImage && (image.length > MAX_IMG_B64 || !IMG_TYPES.includes(String(media_type)))) {
      return json({ error: "Imagem inválida ou grande demais (até ~5 MB, JPG/PNG/WebP)." }, 400);
    }

    // Mensagens sem conteúdo registrável não consomem cota nem chamada de IA
    if (!hasImage && isTrivialMessage(text)) return json({ events: [], learned: [], commentary: null });

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
            events: [], learned: [], commentary: null, statement_items: [],
            statement_note:
              "Essa imagem parece uma fatura completa, com muitos lançamentos. O melhor caminho é a " +
              "importação de fatura (em Prosperidade): ela expande parcelas e evita duplicatas com mais precisão.",
          });
        }
        const items = normalizeStatementItems(rawItems);
        if (items.length) {
          return json({
            events: [], learned: [], commentary: null,
            statement_items: items,
            statement_note: inp.statement_note ? String(inp.statement_note).slice(0, 240) : null,
          });
        }
      }
      // Caminho de IMAGEM: não passa por extractEventsAndMemories, então o
      // pilar canônico é aplicado aqui (o outro ponto de estrangulamento).
      const events = withCanonicalPillar(Array.isArray(inp.events) ? inp.events : []);
      await pushCaptureHistory(supabase, user.id, text, events);
      // Foto de prato vira meal e print de treino vira workout: o comentário
      // de aderência vale aqui exatamente como no caminho de texto.
      const commentary = await planAdherenceComment(supabase, user.id, events);
      return json({ events, learned: [], commentary });
    }

    // ── Caminho original (texto): eventos + memórias em UMA chamada ──
    const { ok, events, learned } = await extractEventsAndMemories(
      supabase, user.id, text, "capture", ent.limits.memory_cap, { reservationId },
    );
    if (!ok) {
      await refund();
      return json({ error: "Não consegui interpretar agora. Tente de novo em instantes — a tentativa não contou no seu limite." }, 502);
    }
    const msgId = await pushCaptureHistory(supabase, user.id, text, events);
    // Origem das memórias deste relato (Fase 2).
    await attachMemorySources(supabase, user.id, learned.map((m) => m.id), "chat_message", msgId);
    const commentary = await planAdherenceComment(supabase, user.id, events);
    return json({ events, learned, commentary });
  } catch (e) {
    // Erro inesperado: devolve a reserva antes de sair.
    await refund().catch((err) => console.error("refund", err));
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Algo falhou do nosso lado. Tente de novo em instantes; se continuar, mande um feedback pelos Ajustes." }, 500);
  }
});