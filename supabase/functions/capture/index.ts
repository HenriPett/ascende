// ASCEND — Captura conversacional
// Recebe texto livre ("gastei 47 no mercado, treinei, dormi 5h, tô ansioso")
// e devolve eventos estruturados PROPOSTOS. O app mostra para o usuário
// confirmar antes de gravar — a IA nunca grava sozinha.
// Em paralelo, a memória de longo prazo aprende nuances duráveis do relato
// ("não gosto de treinar à noite", "trabalho em escala") e devolve o que
// aprendeu em `learned`, para o app mostrar ao usuário.
import {
  corsHeaders, serviceClient, requireUser, assertRateLimit,
  ANTHROPIC_URL, ANTHROPIC_VERSION, MODEL_FAST, corsFor,
  CAPTURE_TOOL, CAPTURE_SYSTEM, learnFromMessage,
} from "../_shared/lib.ts";



Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);
    await assertRateLimit(supabase, user.id, "capture", 80, 5);
    const { text } = await req.json();
    if (!text || typeof text !== "string" || text.length > 2000) {
      return json({ error: "Texto inválido." }, 400);
    }

    // Aprendizado em paralelo com a extração de eventos (nunca derruba a captura)
    const learnPromise = learnFromMessage(supabase, user.id, text);

    const res = await fetch(ANTHROPIC_URL, {
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
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!res.ok) {
      console.error("Anthropic error", res.status, await res.text());
      return json({ error: "Não consegui interpretar agora. Tente de novo." }, 502);
    }
    const data = await res.json();
    // deno-lint-ignore no-explicit-any
    const toolUse = (data.content ?? []).find((b: any) => b.type === "tool_use");
    const events = toolUse?.input?.events ?? [];
    const learned = await learnPromise;
    return json({ events, learned });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});