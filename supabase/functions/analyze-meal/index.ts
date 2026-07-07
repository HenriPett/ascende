// ASCEND — Foto da refeição → estimativa de calorias
// Recebe uma foto (base64) e devolve uma estimativa PROPOSTA de calorias e
// macronutrientes. O app mostra para o usuário confirmar/ajustar antes de gravar —
// a IA nunca grava sozinha. Estimativa é aproximada e informativa, nunca prescrição.
import {
  corsHeaders, serviceClient, requireUser, assertRateLimit,
  ANTHROPIC_URL, ANTHROPIC_VERSION, MODEL_SMART,
} from "../_shared/lib.ts";

// ~7 MB de base64 ≈ 5 MB de imagem. O app já reduz a foto antes de enviar.
const MAX_B64 = 7_000_000;
const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const TOOL = {
  name: "estimar_refeicao",
  description:
    "Registra a estimativa nutricional da refeição identificada na foto. " +
    "Valores são aproximações honestas, nunca números falsamente precisos.",
  input_schema: {
    type: "object",
    properties: {
      is_food: {
        type: "boolean",
        description: "true se a imagem realmente mostra comida ou bebida; false caso contrário.",
      },
      description: {
        type: "string",
        description: "Descrição curta da refeição em português. Ex.: 'Prato com frango grelhado, arroz e salada'.",
      },
      items: {
        type: "array",
        items: { type: "string" },
        description: "Lista dos alimentos identificados. Ex.: ['frango grelhado', 'arroz branco', 'salada de folhas'].",
      },
      calories: {
        type: "number",
        description: "Estimativa de calorias totais (kcal) da porção visível no prato.",
      },
      protein_g: { type: "number", description: "Proteínas estimadas em gramas." },
      carbs_g: { type: "number", description: "Carboidratos estimados em gramas." },
      fat_g: { type: "number", description: "Gorduras estimadas em gramas." },
      confidence: {
        type: "string",
        enum: ["baixa", "media", "alta"],
        description: "Sua confiança na estimativa. Use 'baixa' quando o ângulo/porção forem difíceis de julgar.",
      },
      note: {
        type: "string",
        description: "Observação curta e útil ao usuário, se houver. Ex.: 'Não dá pra ver se o arroz tem óleo — estimei sem'. Deixe vazio se não for necessário.",
      },
    },
    required: ["is_food", "description", "calories", "confidence"],
  },
};

const SYSTEM = `Você é um assistente de estimativa nutricional do Ascend, plataforma brasileira de qualidade de vida.
Você recebe UMA foto de refeição e/ou uma descrição em texto, e estima calorias e macronutrientes da porção.

REGRAS:
• A estimativa é uma APROXIMAÇÃO informativa para ajudar a pessoa a ter noção — nunca um número clínico exato. Prefira faixas mentais e um valor central razoável; não invente precisão que a foto não permite (por isso existe o campo confidence).
• Considere porções típicas do Brasil (prato feito, marmita, pão francês, etc.).
• Se a imagem NÃO for comida/bebida (ou, sem imagem, se a descrição não for de comida/bebida), retorne is_food:false e calories:0, sem inventar.
• Sem foto, estime pela descrição assumindo porções típicas brasileiras; a confiança tende a ser "baixa" ou "media".
• Nunca julgue ou envergonhe a pessoa pela escolha alimentar. Nada de "isso é ruim/proibido". Comida não é inimigo. Apenas descreva e estime com neutralidade.
• Você não é nutricionista clínico e não trata condições de saúde. Não prescreva dietas nem faça recomendações médicas.
• Responda SEMPRE usando a ferramenta estimar_refeicao.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);
    await assertRateLimit(supabase, user.id, "analyze-meal", 20, 10);

    const { image, media_type, note } = await req.json();
    const hasImage = typeof image === "string" && image.length > 0;
    const noteText = typeof note === "string" ? note.trim().slice(0, 300) : "";
    if (!hasImage && !noteText) {
      return json({ error: "Envie uma foto ou descreva a refeição." }, 400);
    }
    if (hasImage && image.length > MAX_B64) {
      return json({ error: "Imagem muito grande. Tire a foto novamente." }, 413);
    }
    const mediaType = ALLOWED_MEDIA.includes(media_type) ? media_type : "image/jpeg";

    const userText = hasImage
      ? (noteText
          ? `Contexto do usuário sobre a refeição: "${noteText}". Estime a partir da foto.`
          : "Estime as calorias e os macronutrientes desta refeição a partir da foto.")
      : `Sem foto. Estime calorias e macronutrientes a partir desta descrição da refeição: "${noteText}".`;

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_SMART,
        max_tokens: 1000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "estimar_refeicao" },
        messages: [{
          role: "user",
          content: hasImage
            ? [
                { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
                { type: "text", text: userText },
              ]
            : userText,
        }],
      }),
    });

    if (!res.ok) {
      console.error("Anthropic error", res.status, await res.text());
      return json({ error: "Não consegui analisar a foto agora. Tente de novo." }, 502);
    }

    const data = await res.json();
    const toolUse = (data.content ?? []).find((b: any) => b.type === "tool_use");
    const r = toolUse?.input;
    if (!r) return json({ error: "Não consegui interpretar a foto." }, 502);

    if (!r.is_food) {
      return json({ estimate: null, is_food: false });
    }

    // Normaliza e arredonda para não devolver falsa precisão.
    const round = (n: unknown) => (typeof n === "number" && n > 0 ? Math.round(n) : undefined);
    const estimate = {
      description: String(r.description ?? "Refeição").slice(0, 200),
      items: Array.isArray(r.items) ? r.items.slice(0, 12).map((i: unknown) => String(i)) : [],
      calories: round(r.calories) ?? 0,
      protein_g: round(r.protein_g),
      carbs_g: round(r.carbs_g),
      fat_g: round(r.fat_g),
      confidence: ["baixa", "media", "alta"].includes(r.confidence) ? r.confidence : "media",
      note: r.note ? String(r.note).slice(0, 240) : undefined,
    };

    return json({ estimate, is_food: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});