// ASCENDE — Foto de corpo inteiro → estimativa de composição corporal
// Recebe uma foto (base64) e devolve uma estimativa PROPOSTA de % de gordura
// (como FAIXA, nunca número falsamente preciso) e massa magra derivada do peso.
// O app mostra para o usuário confirmar antes de gravar — a IA nunca grava sozinha.
// A foto NÃO é armazenada: é analisada e descartada.
import {
  serviceClient, requireUser, assertRateLimit, corsFor, MODEL_SMART,
} from "../_shared/lib.ts";
import { anthropicCall, countUsage } from "../_shared/usage.ts";
import { getEntitlements, getFlags, spMonthStartUtc, nextSpMonthStartUtc, limitResponse } from "../_shared/entitlements.ts";

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
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);

    // ── FUNÇÃO SUSPENSA (plano de consolidação, Etapa 4.1) ─────────
    // A estimativa de composição corporal por foto foi retirada da interface
    // até existir uma metodologia honesta (faixas + peso/altura/sexo/evolução,
    // nunca um ponto médio de aparência clínica). Reative via app_settings:
    // flags.body_photo_enabled = true.
    const flags = await getFlags(supabase);
    if (!flags.body_photo_enabled) {
      return json({
        error: "A estimativa de composição corporal por foto está temporariamente suspensa enquanto revisamos a metodologia. Continue registrando seu peso na aba Alimentação.",
        code: "FEATURE_SUSPENDED",
      }, 403);
    }

    await assertRateLimit(supabase, user.id, "analyze-body", 20, 10);

    // Limite mensal por plano (validado no servidor)
    const ent = await getEntitlements(supabase, user.id);
    if (ent.flags.premium_limits_enabled && ent.limits.body_photos_monthly !== null) {
      const used = await countUsage(supabase, user.id, ["analyze-body"], spMonthStartUtc());
      if (used >= (ent.limits.body_photos_monthly ?? 0)) {
        return limitResponse(req, "analyze-body", ent.limits.body_photos_monthly ?? 0, nextSpMonthStartUtc(),
          `Você usou as ${ent.limits.body_photos_monthly} análises de composição corporal deste mês.`);
      }
    }

    const { image, media_type, weight_kg } = await req.json();
    if (!image || typeof image !== "string" || image.length > MAX_B64) {
      return json({ error: "Imagem inválida ou grande demais." }, 400);
    }
    if (!ALLOWED_MEDIA.includes(media_type)) {
      return json({ error: "Formato de imagem não suportado." }, 400);
    }
    const weightKg = typeof weight_kg === "number" && weight_kg > 20 && weight_kg < 400 ? weight_kg : undefined;

    const { res, data } = await anthropicCall(supabase, user.id, "analyze-body", {
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
      });
    if (!res.ok || !data) {
      return json({ error: "A análise está indisponível agora. Tente de novo em instantes." }, 502);
    }

    // deno-lint-ignore no-explicit-any
    const toolUse = ((data as any).content ?? []).find((b: { type: string }) => b.type === "tool_use");
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