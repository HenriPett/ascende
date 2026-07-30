// ASCENDE — Blueprint da Subida (onboarding estendido, Emenda 4)
// UMA chamada do modelo inteligente por conta (cortesia, qualquer plano):
// a partir do retrato recém-preenchido no onboarding, gera um plano composto
// PROPOSTO — alimentar (que cabe no gasto declarado com comida), treino,
// metas (kcal, proteína, água, sono, teto) e 2–3 compromissos diários.
//
// Regras inegociáveis:
// • TUDO chega como proposta: o app mostra cards desmarcáveis e a pessoa
//   escolhe o que ativar — a IA nunca grava sozinha, nem no onboarding.
// • Unicidade no servidor: claim_blueprint() marca blueprint_generated_at
//   atomicamente (duas requisições simultâneas não passam juntas). Se a
//   geração FALHAR depois do claim, o carimbo é devolvido — tentativa
//   fracassada nunca consome a cortesia (plano §3.4).
// • Kill-switch: flags.onboarding_blueprint_enabled (app_settings) — o app
//   cai no blueprint local (TMB), sem quebrar.
import {
  serviceClient, requireUser, assertRateLimit, corsFor, buildSnapshot,
  MODEL_SMART, SAFETY_RULES,
} from "../_shared/lib.ts";
import { anthropicCall } from "../_shared/usage.ts";
import { getFlags } from "../_shared/entitlements.ts";

const VALID_PILLARS = ["prosperidade", "vitalidade", "alimentacao", "mente"];

const BLUEPRINT_TOOL = {
  name: "gerar_blueprint",
  description:
    "Gera o Blueprint da Subida: um plano composto de boas-vindas, 100% baseado nos dados que a pessoa " +
    "declarou no onboarding. Tudo é PROPOSTA que ela confirma no app.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Título curto e pessoal do blueprint. Ex.: 'Blueprint da Subida: massa magra dentro do orçamento'." },
      content_markdown: {
        type: "string",
        description:
          "O plano composto COMPLETO em markdown, autossuficiente, seguindo o formato do app: " +
          "comece com '## Resumo' (3 a 5 bullets com os números-chave), depois seções '## Alimentação' " +
          "(estrutura de refeições com faixas de kcal e custo estimado dentro do gasto declarado com comida, " +
          "usando alimentos brasileiros baratos: ovo, frango, arroz, feijão, banana), '## Treino' (estrutura " +
          "semanal realista para o nível declarado), '## Sono' (a rotina declarada e por que ela sustenta o resto), " +
          "'## Bolso' (como o plano cabe na renda/orçamento declarados), use tabelas quando ajudar, " +
          "termine com '---' e '## Observações'. Se blocos foram pulados, comece com a seção '## Premissas que assumi'. " +
          "NUNCA use travessão ou meia-risca no texto.",
      },
      daily_calories_kcal: { type: "number", description: "Meta calórica diária proposta (kcal), coerente com TMB/objetivo. OBRIGATÓRIA." },
      daily_protein_g: { type: "number", description: "Meta diária de proteína (g), se fizer sentido para o objetivo." },
      weekly_workouts: { type: "number", description: "Treinos por semana propostos, realistas para o nível e a rotina declarados." },
      sleep_hours_target: { type: "number", description: "Horas de sono por noite. Se a pessoa declarou rotina de sono, use a duração DELA (não invente outra)." },
      daily_spend_limit: { type: "number", description: "Teto de gasto diário em reais, derivado do orçamento mensal declarado, se houver. Omita se não houver dado financeiro." },
      water_goal_ml: { type: "number", description: "Meta diária de água em ml (ex.: 2500), se fizer sentido propor." },
      habits: {
        type: "array", maxItems: 3,
        description: "2 a 3 compromissos diários PEQUENOS derivados da meta declarada (nunca lista genérica). Cada um com o porquê ligado à meta DELA.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Nome curto do compromisso. Ex.: 'Marmita 4x na semana'." },
            pillar: { type: "string", enum: VALID_PILLARS },
            why: { type: "string", description: "Por que ESTE compromisso serve a meta declarada, em 1 frase." },
          },
          required: ["name", "pillar"],
        },
      },
      assumptions: {
        type: "array", items: { type: "string" },
        description: "Premissas assumidas para os blocos que a pessoa pulou (1 frase cada). Vazio se nada foi assumido.",
      },
    },
    required: ["title", "content_markdown", "daily_calories_kcal", "habits", "assumptions"],
  },
};

const SYSTEM = `Você monta o Blueprint da Subida do Ascende, plataforma brasileira de qualidade de vida ("o único app que vê a sua vida inteira").
A pessoa ACABOU de responder o onboarding: o retrato abaixo é tudo que ela declarou. Sua tarefa é transformar essas respostas no primeiro plano composto dela, entregue no minuto 1 — a prova de que cada resposta valeu a pena.
ESTILO: escreva como uma pessoa escreve, em português do Brasil. NUNCA use travessão ou meia-risca (— ou –); prefira vírgula, dois-pontos ou frases separadas. Tom caloroso e direto, sem falso entusiasmo.
REGRAS:
• Baseie TUDO nos dados declarados. O que faltar, assuma um padrão razoável e DECLARE em assumptions e na seção "Premissas que assumi" do markdown. Nunca finja precisão que os dados não sustentam.
• O plano alimentar DEVE caber no gasto mensal com comida declarado (ou na renda/orçamento, se só eles existirem). Estime o custo e mostre a conta. Alimentos brasileiros acessíveis. Respeite TODAS as restrições alimentares e condições de saúde declaradas.
• O treino deve ser realista para o nível de atividade declarado: quem está sedentário começa pequeno (caminhada, 2x/semana), não com 5 treinos.
• Se houver rotina de sono declarada, sleep_hours_target é a duração DELA e a seção de sono ancora nos horários dela.
• Compromissos diários: 2 a 3, pequenos demais para falhar, derivados da META declarada, cada um com o porquê. Nunca lista genérica ("beba água, durma bem").
• Números redondos e honestos. Metas de kcal entre 1200 e 4500 salvo caso claro.
• Tudo aqui é PROPOSTA: o app mostra para a pessoa escolher o que ativar. Escreva sabendo disso.
• Responda SEMPRE usando a ferramenta gerar_blueprint.
${SAFETY_RULES}`;

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);
    await assertRateLimit(supabase, user.id, "onboarding-blueprint", 5, 60);

    const flags = await getFlags(supabase);
    if (!flags.onboarding_blueprint_enabled) {
      return json({ error: "O Blueprint com IA está temporariamente indisponível.", disabled: true }, 503);
    }

    // Cortesia ÚNICA por conta, reivindicada atomicamente ANTES da chamada
    // (duas requisições simultâneas não geram dois blueprints).
    const { data: claimed, error: claimErr } = await supabase.rpc("claim_blueprint", { uid: user.id });
    if (claimErr) { console.error("claim_blueprint", claimErr); return json({ error: "Erro interno." }, 500); }
    if (!claimed) {
      return json({ error: "Seu Blueprint de boas-vindas já foi gerado. Para novos planos, converse com o Conselheiro.", already: true }, 409);
    }

    // Se a geração falhar daqui em diante, devolvemos a cortesia:
    // tentativa fracassada nunca consome o limite (plano §3.4).
    const refund = async () => {
      await supabase.from("profiles")
        .update({ blueprint_generated_at: null })
        .eq("user_id", user.id);
    };

    try {
      const snapshot = await buildSnapshot(supabase, user.id);
      const { res, data } = await anthropicCall(supabase, user.id, "onboarding-blueprint", {
        model: MODEL_SMART,
        max_tokens: 4000,
        system: [
          { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
          { type: "text", text: `━━━ RETRATO DECLARADO NO ONBOARDING ━━━\n${snapshot}` },
        ],
        tools: [BLUEPRINT_TOOL],
        tool_choice: { type: "tool", name: "gerar_blueprint" },
        messages: [{
          role: "user",
          content: "Gere agora o Blueprint da Subida completo a partir do meu retrato, chamando gerar_blueprint.",
        }],
      });

      if (!res.ok || !data) {
        await refund();
        return json({ error: "Não consegui montar seu Blueprint agora. Tente de novo em instantes — a cortesia não foi consumida.", recoverable: true }, 502);
      }

      // deno-lint-ignore no-explicit-any
      const tu = ((data as any).content ?? []).find((b: any) => b.type === "tool_use");
      const inp = tu?.input;
      if (!inp?.title || !inp?.content_markdown) {
        await refund();
        return json({ error: "Não consegui montar seu Blueprint agora. Tente de novo em instantes — a cortesia não foi consumida.", recoverable: true }, 502);
      }

      const inRange = (v: unknown, lo: number, hi: number) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : null;
      };
      const seen = new Set<string>();
      // deno-lint-ignore no-explicit-any
      const habits = (Array.isArray(inp.habits) ? inp.habits : []).flatMap((h: any) => {
        const name = String(h?.name ?? "").trim().slice(0, 60);
        const pillar = VALID_PILLARS.includes(h?.pillar) ? String(h.pillar) : null;
        const key = name.toLowerCase();
        if (name.length < 3 || !pillar || seen.has(key)) return [];
        seen.add(key);
        return [{ name, pillar, why: h?.why ? String(h.why).slice(0, 140) : null }];
      }).slice(0, 3);

      return json({
        blueprint: {
          title: String(inp.title).slice(0, 120),
          content_markdown: String(inp.content_markdown).slice(0, 20000),
          daily_calories_kcal: inRange(inp.daily_calories_kcal, 800, 8000),
          daily_protein_g: inRange(inp.daily_protein_g, 20, 400),
          weekly_workouts: inRange(inp.weekly_workouts, 1, 14),
          sleep_hours_target: inRange(inp.sleep_hours_target, 4, 12),
          daily_spend_limit: inRange(inp.daily_spend_limit, 1, 100000),
          water_goal_ml: inRange(inp.water_goal_ml, 500, 6000),
          habits,
          assumptions: (Array.isArray(inp.assumptions) ? inp.assumptions : [])
            .map((a: unknown) => String(a).slice(0, 160)).filter(Boolean).slice(0, 8),
        },
      });
    } catch (e) {
      await refund();
      throw e;
    }
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});