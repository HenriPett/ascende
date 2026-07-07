// ASCEND — Conselheiro (chat de IA com visão de todos os pilares)
import {
  corsHeaders, serviceClient, requireUser, buildSnapshot,
  ANTHROPIC_URL, ANTHROPIC_VERSION, MODEL_SMART, MODEL_FAST, SAFETY_RULES,
  CAPTURE_TOOL, CAPTURE_SYSTEM,
} from "../_shared/lib.ts";

const DAILY_LIMIT = 40;

const SYSTEM = `Você é o Conselheiro do Ascend, uma plataforma brasileira de qualidade de vida. Você é a única IA que enxerga TODAS as áreas da vida da pessoa ao mesmo tempo: finanças, corpo, alimentação, mente e espírito. Seu papel é ajudá-la a subir de nível na vida real.

━━━ COMO VOCÊ RESPONDE ━━━
• Português do Brasil, tom caloroso e direto, sem jargão. Máximo 4 parágrafos curtos.
• SEMPRE cruze pilares quando fizer sentido: um plano alimentar deve caber no orçamento; uma meta financeira deve considerar o momento emocional; um plano de treino deve respeitar o sono. Esse cruzamento é o seu superpoder — use os dados do retrato abaixo.
• Toda sugestão vem com o porquê nos dados ("sugiro X porque seu sono caiu e seu gasto com lazer está em 80% do planejado").
• Quando montar planos (alimentar, financeiro, de treino), ofereça versões em faixas de custo quando houver orçamento envolvido, com valores estimados em reais.
• Termine com UM próximo passo pequeno e concreto.
• Se faltar dado importante, diga o que registrar para você ajudar melhor.
${SAFETY_RULES}

━━━ RETRATO ATUAL DA PESSOA (dados reais da plataforma) ━━━
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);
    const { message, attachments } = await req.json();
    if (!message || typeof message !== "string" || message.length > 4000) {
      return json({ error: "Mensagem inválida." }, 400);
    }

    // ── Anexos (fotos, PDFs e documentos de texto) ──
    type Att = { name?: string; kind?: string; media_type?: string; data?: string; text?: string };
    const MAX_ATTACHMENTS = 4;
    const MAX_IMG_B64 = 7_000_000;   // ~5 MB de imagem
    const MAX_PDF_B64 = 6_000_000;   // ~4,5 MB de PDF
    const MAX_TEXT_CHARS = 20_000;
    const IMG_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    const atts: Att[] = Array.isArray(attachments) ? attachments.slice(0, MAX_ATTACHMENTS) : [];
    // deno-lint-ignore no-explicit-any
    const contentBlocks: any[] = [];
    const attNames: string[] = [];
    for (const a of atts) {
      const name = String(a?.name ?? "arquivo").slice(0, 120);
      if (a?.kind === "image" && typeof a.data === "string" && a.data.length <= MAX_IMG_B64
        && IMG_TYPES.includes(String(a.media_type))) {
        contentBlocks.push({ type: "image", source: { type: "base64", media_type: a.media_type, data: a.data } });
        attNames.push(name);
      } else if (a?.kind === "pdf" && typeof a.data === "string" && a.data.length <= MAX_PDF_B64) {
        contentBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
        attNames.push(name);
      } else if (a?.kind === "text" && typeof a.text === "string") {
        contentBlocks.push({ type: "text", text: `[Conteúdo do arquivo "${name}" enviado pelo usuário]\n\n${a.text.slice(0, MAX_TEXT_CHARS)}` });
        attNames.push(name);
      } else {
        return json({ error: `Anexo inválido ou grande demais: ${name}.` }, 400);
      }
    }

    // Limite diário
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const { count } = await supabase.from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("role", "user")
      .gte("created_at", dayStart.toISOString());
    if ((count ?? 0) >= DAILY_LIMIT) {
      return json({ error: `Você atingiu o limite de ${DAILY_LIMIT} mensagens por dia. Amanhã o Conselheiro estará aqui de novo.` }, 429);
    }

    // Contexto: retrato multi-pilar + histórico recente
    const [snapshot, { data: history }] = await Promise.all([
      buildSnapshot(supabase, user.id),
      supabase.from("chat_messages").select("role,content")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(12),
    ]);
    const messages = (history ?? []).reverse().map((m) => ({ role: m.role, content: m.content }));
    messages.push({
      role: "user",
      content: contentBlocks.length
        ? [...contentBlocks, { type: "text", text: message }]
        : message,
    });

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_SMART,
        max_tokens: 1200,
        system: SYSTEM + snapshot,
        messages,
      }),
    });

    // Em paralelo: extrai eventos registráveis da mensagem ("treinei costas",
    // "gastei 30 no almoço", "bebi 2L de água"...). São PROPOSTAS — o app pede
    // confirmação antes de gravar. Falha aqui nunca derruba a resposta do chat.
    const capturePromise: Promise<unknown[]> = (async () => {
      try {
        const r = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL_FAST,
            max_tokens: 1500,
            system: CAPTURE_SYSTEM,
            tools: [CAPTURE_TOOL],
            tool_choice: { type: "tool", name: "registrar_eventos" },
            messages: [{ role: "user", content: message }],
          }),
        });
        if (!r.ok) return [];
        const d = await r.json();
        // deno-lint-ignore no-explicit-any
        const tu = (d.content ?? []).find((b: any) => b.type === "tool_use");
        return Array.isArray(tu?.input?.events) ? tu.input.events : [];
      } catch {
        return [];
      }
    })();
    if (!res.ok) {
      console.error("Anthropic error", res.status, await res.text());
      return json({ error: "O Conselheiro está indisponível agora. Tente de novo em instantes." }, 502);
    }
    const data = await res.json();
    const reply = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();

    await supabase.from("chat_messages").insert([
      { user_id: user.id, role: "user", content: attNames.length ? `${message}\n📎 ${attNames.join(", ")}` : message },
      { user_id: user.id, role: "assistant", content: reply },
    ]);

    const captured = await capturePromise;
    return json({ reply, captured });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});