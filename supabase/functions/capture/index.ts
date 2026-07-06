// ASCENDE — Captura conversacional
// Recebe texto livre ("gastei 47 no mercado, treinei, dormi 5h, tô ansioso")
// e devolve eventos estruturados PROPOSTOS. O app mostra para o usuário
// confirmar antes de gravar — a IA nunca grava sozinha.
import {
  corsHeaders, serviceClient, requireUser,
  ANTHROPIC_URL, ANTHROPIC_VERSION, MODEL_FAST,
} from "../_shared/lib.ts";

const TOOL = {
  name: "registrar_eventos",
  description: "Registra os eventos de vida extraídos do relato do usuário.",
  input_schema: {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["transaction", "sleep", "workout", "meal", "mood", "gratitude", "practice", "note"],
              description: "Tipo do evento.",
            },
            pillar: {
              type: "string",
              enum: ["prosperidade", "vitalidade", "alimentacao", "mente"],
              description: "Pilar: transaction→prosperidade; sleep/workout→vitalidade; meal→alimentacao; mood/gratitude/practice→mente.",
            },
            summary: { type: "string", description: "Resumo curto em português para o usuário confirmar. Ex.: 'Gasto de R$ 47 em Mercado'." },
            amount: { type: "number", description: "Valor em reais (apenas para transaction)." },
            tx_kind: { type: "string", enum: ["income", "expense"], description: "Entrada ou saída (apenas para transaction)." },
            category: { type: "string", description: "Categoria da transação. Ex.: Mercado, Transporte, Lazer, Salário." },
            hours: { type: "number", description: "Horas de sono (apenas para sleep)." },
            description: { type: "string", description: "Descrição livre (refeição, treino, nota...)." },
            mood_label: { type: "string", description: "Palavra do próprio usuário para o humor. Ex.: ansioso, animado, cansado." },
            mood_score: { type: "number", description: "Humor de 1 (péssimo) a 5 (ótimo), inferido do relato." },
          },
          required: ["kind", "pillar", "summary"],
        },
      },
    },
    required: ["events"],
  },
};

const SYSTEM = `Você extrai eventos estruturados de relatos do dia a dia de brasileiros, para a plataforma Ascende.
Regras:
• Extraia TODOS os eventos presentes no texto — um relato pode alimentar vários pilares de uma vez.
• Valores em reais: "47", "R$47", "quarenta e sete" → amount 47. Gastos são expense; salário/recebimentos são income.
• Sono mencionado ("dormi 5h", "dormi mal" → estime 5 e cite no summary que foi estimado) vira evento sleep.
• Menções a treino/exercício viram workout. Refeições viram meal. Oração/meditação/culto/leitura espiritual viram practice.
• Estados emocionais ("tô ansioso", "dia ótimo") viram mood, usando a palavra do próprio usuário em mood_label.
• Se algo não se encaixar em nenhum tipo, use note.
• Se o texto não contiver nenhum evento registrável, retorne events: [].
• Nunca invente eventos que não estão no texto.
Use SEMPRE a ferramenta registrar_eventos.`;

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
        system: SYSTEM,
        tools: [TOOL],
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
