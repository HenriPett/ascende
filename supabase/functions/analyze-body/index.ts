// ASCEND — Foto de corpo inteiro → estimativa de composição corporal
// Recebe uma foto (base64) e devolve uma estimativa PROPOSTA de % de gordura
// (como FAIXA, nunca número falsamente preciso) e massa magra derivada do peso.
// O app mostra para o usuário confirmar antes de gravar — a IA nunca grava sozinha.
// A foto NÃO é armazenada: é analisada e descartada.
import {
  corsHeaders, serviceClient, requireUser,
  ANTHROPIC_URL, ANTHROPIC_VERSION, MODEL_SMART,
} from "../_shared/lib.ts";

const MAX_B64 = 7_000_000;
const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp"];

const TOOL = {
  name: "estimar_composicao",
  description:
    "Registra a estimativa visual de composição corporal da pessoa na foto. " +
    "A estimativa visual tem margem de erro grande (±4-6 pontos percentuais) — seja honesto sobre isso.",
  input_schema: {
    type: "object",
    properties: {
      valid: {
        type: "boolean",
        description:
          "true apenas se: a imagem mostra uma pessoa adulta, de corpo inteiro ou torso, " +
          "com vestimenta adequada para avaliação física (roupa de treino, praia ou similar) " +
          "e qualidade suficiente para estimar. false para: fotos sem pessoa, pessoas que " +
          "aparentem ser menores de idade, fotos íntimas/sexualizadas, ou qualidade insuficiente.",
      },
      reason: {
        type: "string",
        description:
          "Se valid=false, explique de forma gentil e neutra o motivo, em português. " +
          "Ex.: 'Preciso de uma foto de corpo inteiro com boa iluminação para estimar.'",
      },
      body_fat_low: {
        type: "number",
        description: "Limite inferior da faixa estimada de gordura corporal, em % (ex.: 18).",
      },
      body_fat_high: {
        type: "number",
        description: "Limite superior da faixa estimada de gordura corporal, em % (ex.: 24).",
      },
      note: {
        type: "string",
        description:
          "Observação curta, neutra e sem julgamento, se útil. Nunca comente estética, " +
          "atratividade ou use termos como 'acima do peso'. Deixe vazia se não for necessária.",
      },
    },
    required: ["valid"],
  },
};

const PROMPT = (weightKg?: number) =>
  `Estime a composição corporal da pessoa adulta nesta foto, de forma neutra e respeitosa, como um avaliador físico profissional faria.

Regras:
• Devolva o % de gordura como FAIXA (low/high) com amplitude de 5-8 pontos — estimativa visual não permite precisão maior.
• Linguagem neutra e técnica. Zero julgamento estético.
• Se a pessoa aparentar ser menor de idade, se a foto for íntima/sexualizada, se não houver pessoa, ou se a qualidade/enquadramento impedirem a análise: valid=false com um motivo gentil.
${weightKg ? `• Peso informado pelo usuário: ${weightKg} kg (use apenas como contexto).` : ""}

Use a ferramenta estimar_composicao.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    await requireUser(req, supabase);

    const { image, media_type, weight_kg } = await req.json();
    if (!image || typeof image !== "string" || image.length > MAX_B64) {
      return json({ error: "Imagem inválida ou grande demais." }, 400);
    }
    if (!ALLOWED_MEDIA.includes(media_type)) {
      return json({ error: "Formato de imagem não suportado." }, 400);
    }
    const weightKg = typeof weight_kg === "number" && weight_kg > 20 && weight_kg < 400 ? weight_kg : undefined;

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_SMART,
        max_tokens: 700,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "estimar_composicao" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type, data: image } },
            { type: "text", text: PROMPT(weightKg) },
          ],
        }],
      }),
    });
    if (!res.ok) {
      console.error("Anthropic error", res.status, await res.text());
      return json({ error: "A análise está indisponível agora. Tente de novo em instantes." }, 502);
    }

    const data = await res.json();
    const toolUse = (data.content ?? []).find((b: { type: string }) => b.type === "tool_use");
    const input = toolUse?.input as {
      valid?: boolean; reason?: string;
      body_fat_low?: number; body_fat_high?: number; note?: string;
    } | undefined;

    if (!input?.valid || input.body_fat_low == null || input.body_fat_high == null) {
      return json({ valid: false, reason: input?.reason ?? "Não consegui analisar essa foto." });
    }

    const low = Math.max(3, Math.round(input.body_fat_low));
    const high = Math.min(60, Math.max(low + 2, Math.round(input.body_fat_high)));
    const mid = Math.round((low + high) / 2);
    // Massa magra = peso × (1 − gordura). Só calculamos se o usuário registrou peso.
    const leanMassKg = weightKg ? Math.round(weightKg * (1 - mid / 100) * 10) / 10 : undefined;

    return json({
      valid: true,
      estimate: {
        body_fat_pct: mid,
        body_fat_range: `${low}–${high}%`,
        lean_mass_kg: leanMassKg,
        note: input.note || undefined,
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});