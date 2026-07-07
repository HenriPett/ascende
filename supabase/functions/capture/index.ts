// ASCEND — Captura conversacional
// Recebe texto livre ("gastei 47 no mercado, treinei, dormi 5h, tô ansioso")
// e devolve eventos estruturados PROPOSTOS. O app mostra para o usuário
// confirmar antes de gravar — a IA nunca grava sozinha.
import {
  corsHeaders, serviceClient, requireUser,
  ANTHROPIC_URL, ANTHROPIC_VERSION, MODEL_FAST,
  CAPTURE_TOOL, CAPTURE_SYSTEM,
} from "../_shared/lib.ts";



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    await requireUser(req, supabase);
    const { text } = await req.json();
    if (!text || typeof text !== "string" || text.length > 2000) {
      return json({ error: "Texto inválido." }, 400);
    }

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
    const toolUse = (data.content ?? []).find((b: any) => b.type === "tool_use");
    const events = toolUse?.input?.events ?? [];
    return json({ events });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});