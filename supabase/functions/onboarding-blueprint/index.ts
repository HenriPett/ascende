// ASCENDE — Blueprint da Subida (onboarding estendido, Emenda 4)
// UMA chamada do modelo inteligente por conta (cortesia, qualquer plano):
// a partir do retrato recém-preenchido no onboarding, gera um plano composto
// PROPOSTO — alimentar (que cabe no gasto declarado com comida), treino,
// metas (kcal, proteína, água, sono, teto) e 2–3 compromissos diários.
//
// Regras inegociáveis:
// • TUDO chega como proposta: o app mostra cards desmarcáveis e a pessoa
//   escolhe o que ativar — a IA nunca grava sozinha, nem no onboarding.
// • A PROPOSTA FICA GUARDADA (migração 20261013120000): ela é gravada em
//   `blueprint_proposals` ANTES de a resposta sair. Quem recarrega, fecha a
//   aba ou volta outro dia recebe a MESMA proposta, sem chamar o modelo de
//   novo. Antes ela vivia só no corpo da resposta, e a cortesia ia embora
//   junto com a aba.
// • Unicidade no servidor: `claim_blueprint_generation` reivindica
//   atomicamente (duas abas não geram duas vezes; uma geração que morreu no
//   meio pode ser reivindicada de novo depois de 3 minutos) e continua
//   carimbando `blueprint_generated_at`. Se a geração FALHAR, linha e carimbo
//   voltam juntos — tentativa fracassada nunca consome a cortesia (plano §3.4).
// • Kill-switch: flags.onboarding_blueprint_enabled (app_settings) — barra só
//   a geração NOVA; quem já tem proposta guardada retoma mesmo assim.
// • A decisão de cada chamada mora em decide.ts (testada com `deno test`).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  serviceClient, requireUser, assertRateLimit, corsFor, buildSnapshot,
  MODEL_SMART, SAFETY_RULES, canonicalPillarId, VALID_PILLARS,
} from "../_shared/lib.ts";
import { anthropicCall } from "../_shared/usage.ts";
import { getEntitlements, getFlags } from "../_shared/entitlements.ts";
import {
  atender, GERACAO_VELHA_SEGUNDOS,
  type Dependencias, type Linha, type Reivindicacao,
} from "./decide.ts";


const BLUEPRINT_TOOL = {
  name: "gerar_blueprint",
  description:
    "Gera o Blueprint da Subida: um plano composto de boas-vindas, 100% baseado nos dados que a pessoa " +
    "declarou no onboarding. Tudo é PROPOSTA que ela confirma no app.",
  input_schema: {
    type: "object",
    properties: {
      overview: {
        type: "string",
        description:
          "2 a 4 frases apresentando o conjunto do blueprint para a pessoa (o fio que liga os planos). " +
          "Sem títulos, sem listas, sem travessão.",
      },
      plans: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        description:
          "Os planos SEPARADOS do blueprint, um por área. Gere um para cada área que os dados sustentam: " +
          "alimentar (sempre, quando houver qualquer dado de corpo ou de gasto com comida), treino (quando " +
          "houver nível de atividade ou meta física), rotina (quando houver rotina de sono declarada; é o " +
          "plano que amarra sono, horários e compromissos) e financeiro (quando houver renda, orçamento ou " +
          "gasto com comida declarados). NUNCA junte áreas diferentes num único plano: cada um vive sozinho " +
          "na tela Meus planos e precisa ser autossuficiente.",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string", enum: ["alimentar", "treino", "financeiro", "rotina"],
              description: "Área do plano. Um plano por área, sem repetir.",
            },
            pillar: { type: "string", enum: VALID_PILLARS, description: "Pilar do plano: alimentar→vitalidade; treino→vitalidade; financeiro→prosperidade; rotina→vitalidade ou mente." },
            title: { type: "string", description: "Título curto e pessoal, específico DESTA área. Ex.: 'Alimentação para massa magra com R$ 800/mês'." },
            content_markdown: {
              type: "string",
              description:
                "O plano COMPLETO desta área em markdown, autossuficiente, no formato obrigatório do app: " +
                "comece com '## Resumo' (3 a 5 bullets com os números-chave desta área), depois as seções " +
                "'## ...' e '### ...' que a área pedir, tabelas quando ajudarem, termine com '---' e " +
                "'## Observações'. Se você assumiu algum padrão por falta de dado, declare em '## Premissas que assumi' " +
                "logo depois do Resumo. " +
                "No plano alimentar: estrutura de refeições com faixas de kcal, proteína e CUSTO estimado, " +
                "cabendo no gasto com comida declarado, com alimentos brasileiros acessíveis (ovo, frango, arroz, " +
                "feijão, banana). No de treino: estrutura semanal realista para o nível declarado. No de rotina: " +
                "os horários de sono declarados e como o dia se organiza em volta deles. No financeiro: como o plano " +
                "cabe na renda e no orçamento declarados. NUNCA use travessão ou meia-risca no texto.",
            },
          },
          required: ["kind", "pillar", "title", "content_markdown"],
        },
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
    required: ["overview", "plans", "daily_calories_kcal", "habits", "assumptions"],
  },
};

const SYSTEM = `Você monta o Blueprint da Subida do Ascende, plataforma brasileira de qualidade de vida ("o único app que vê a sua vida inteira").
A pessoa ACABOU de responder o onboarding: o retrato abaixo é tudo que ela declarou. Sua tarefa é transformar essas respostas no primeiro plano composto dela, entregue no minuto 1 — a prova de que cada resposta valeu a pena.
ESTILO: escreva como uma pessoa escreve, em português do Brasil. NUNCA use travessão ou meia-risca (— ou –) no texto que você escreve para a pessoa; prefira vírgula, dois-pontos ou frases separadas. (Estas instruções usam travessão; a proibição vale para a sua saída, não para o que você lê aqui.) Tom caloroso e direto, sem falso entusiasmo.
REGRAS:
• PLANOS SEPARADOS: gere de 2 a 4 planos, UM POR ÁREA (alimentar, treino, rotina, financeiro). Cada plano é autossuficiente e vive sozinho na tela "Meus planos" da pessoa. NUNCA entregue um único plano de "rotina" com alimentação e treino dentro dele: para a pessoa, isso parece que os outros planos não existem.
• NÃO gere plano de uma área que os dados não sustentam (sem nenhum dado financeiro, não invente plano financeiro). Melhor 2 planos honestos que 4 genéricos.
• Se o retrato tiver a linha "NÃO ACOMPANHA", NÃO proponha metas nem planos daquelas áreas: a pessoa desligou de propósito.
• Baseie TUDO nos dados declarados. O que faltar, assuma um padrão razoável e DECLARE em assumptions e na seção "Premissas que assumi" do markdown. Nunca finja precisão que os dados não sustentam.
• O plano alimentar DEVE caber no gasto mensal com comida declarado (ou na renda/orçamento, se só eles existirem). Estime o custo e mostre a conta. Alimentos brasileiros acessíveis. Respeite TODAS as restrições alimentares e condições de saúde declaradas.
• O treino deve ser realista para o nível de atividade declarado: quem está sedentário começa pequeno (caminhada, 2x/semana), não com 5 treinos.
• Se houver rotina de sono declarada, sleep_hours_target é a duração DELA e a seção de sono ancora nos horários dela.
• Compromissos diários: 2 a 3, pequenos demais para falhar, derivados da META declarada, cada um com o porquê. Nunca lista genérica ("beba água, durma bem").
• Números redondos e honestos. Metas de kcal entre 1200 e 4500, salvo caso claramente justificado pelos dados declarados.
• Tudo aqui é PROPOSTA: o app mostra para a pessoa escolher o que ativar. Escreva sabendo disso.
• Responda SEMPRE usando a ferramenta gerar_blueprint.
${SAFETY_RULES}`;

/** O Blueprint validado: é ISTO que fica guardado em
 *  `blueprint_proposals.proposal`, e é daqui que `activate_blueprint` tira o
 *  texto dos planos, os hábitos e os números das metas. */
type Blueprint = {
  overview: string;
  plans: { kind: string; pillar: string | null; title: string; content_markdown: string }[];
  daily_calories_kcal: number | null;
  daily_protein_g: number | null;
  weekly_workouts: number | null;
  sleep_hours_target: number | null;
  daily_spend_limit: number | null;
  water_goal_ml: number | null;
  habits: { name: string; pillar: string; why: string | null }[];
  assumptions: string[];
};

/** Chama o modelo e valida a resposta. `null` = falha recuperável (resposta
 *  ruim, cortada no teto, sem planos válidos): quem chama devolve a cortesia.
 *  Erro de rede/servidor sobe como exceção, e também devolve a cortesia. */
async function gerarBlueprint(supabase: SupabaseClient, userId: string): Promise<Blueprint | null> {
  const snapshot = await buildSnapshot(supabase, userId);
  const { res, data } = await anthropicCall(supabase, userId, "onboarding-blueprint", {
    model: MODEL_SMART,
    /* O TETO DE SAÍDA FOI DIMENSIONADO PARA UM PLANO, E HOJE SE PEDEM
       QUATRO. Os 4.000 nasceram quando o Blueprint era um plano só
       (`required: ["title", "content_markdown", ...]`). Depois a
       ferramenta passou a pedir de 2 a 4 planos SEPARADOS, cada um
       completo — "## Resumo", seções, tabelas, "## Observações" — e o
       teto não subiu junto.

       Quando a resposta bate no teto, a API não devolve erro: devolve
       200 com `stop_reason: "max_tokens"` e o JSON da ferramenta pela
       metade. Aí `plans` não passa na validação (conteúdo truncado cai
       no `content.length < 80`), o servidor estorna a cortesia e
       responde 502 — e a pessoa, no fim do onboarding, vê um consolo no
       lugar do plano. Como quatro planos ricos às vezes cabem em 4.000 e
       às vezes não, a falha é INTERMITENTE, que é a pior forma de ela
       existir: não dá para reproduzir sob demanda e parece "azar".

       TETO NÃO É COBRANÇA. Só se paga o que o modelo de fato escreve —
       subir o limite não encarece nada por si, apenas para de cortar o
       que já estava sendo gerado (e pago). O custo real desta rota é o
       que ela sempre foi; o que muda é a resposta chegar inteira. */
    max_tokens: 16000,
    /* SEM cache_control aqui, de propósito — não reponha.
       Escrever cache custa 1,25x a entrada e ler custa 0,1x. Nos dados
       reais de produção esta rota escrevia 70,2% da entrada e lia 0%:
       custo relativo 117,6 contra 100 de não cachear nada — a rota MAIS
       CARA do produto por causa do cache, 17,6% acima de não ter cache.
       E é estrutural, não afinável: o TTL do cache da Anthropic é de 5
       minutos e o Blueprint roda UMA vez na vida de cada conta. Não existe
       segunda chamada para ler o que a primeira escreveu. */
    system: [
      { type: "text", text: SYSTEM },
      { type: "text", text: `━━━ RETRATO DECLARADO NO ONBOARDING ━━━\n${snapshot}` },
    ],
    tools: [BLUEPRINT_TOOL],
    tool_choice: { type: "tool", name: "gerar_blueprint" },
    messages: [{
      role: "user",
      content: "Gere agora o Blueprint da Subida completo a partir do meu retrato, chamando gerar_blueprint.",
    }],
  });

  if (!res.ok || !data) return null;

  /* Bater no teto de saída é um 200, não um erro — e sem este log a
     falha fica invisível: `logUsage` grava ok=true e ninguém consegue
     distinguir "o modelo respondeu mal" de "a resposta foi cortada".
     Foi exatamente essa cegueira que deixou o Blueprint sumir sem
     deixar rastro. */
  // deno-lint-ignore no-explicit-any
  const stop = (data as any)?.stop_reason;
  if (stop === "max_tokens") {
    console.error("onboarding-blueprint: resposta cortada no teto de saída", {
      user: userId,
      // deno-lint-ignore no-explicit-any
      output_tokens: (data as any)?.usage?.output_tokens ?? null,
    });
  }

  // deno-lint-ignore no-explicit-any
  const tu = ((data as any).content ?? []).find((b: any) => b.type === "tool_use");
  const inp = tu?.input;
  const rawPlans = Array.isArray(inp?.plans) ? inp.plans : [];
  if (!rawPlans.length) return null;

  const inRange = (v: unknown, lo: number, hi: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : null;
  };
  const seen = new Set<string>();
  // deno-lint-ignore no-explicit-any
  const habits = (Array.isArray(inp.habits) ? inp.habits : []).flatMap((h: any) => {
    const name = String(h?.name ?? "").trim().slice(0, 60);
    const pillar = canonicalPillarId(h?.pillar);
    const key = name.toLowerCase();
    if (name.length < 3 || !pillar || seen.has(key)) return [];
    seen.add(key);
    return [{ name, pillar, why: h?.why ? String(h.why).slice(0, 140) : null }];
  }).slice(0, 3);

  // Planos SEPARADOS, um por área (alimentar, treino, rotina, financeiro):
  // cada um vira uma linha própria em "Meus planos". Um plano composto
  // fazia a pessoa achar que só existia o de rotina.
  const VALID_KINDS = ["alimentar", "treino", "financeiro", "rotina"];
  const seenKinds = new Set<string>();
  // deno-lint-ignore no-explicit-any
  const plans = rawPlans.flatMap((pl: any) => {
    const kind = VALID_KINDS.includes(pl?.kind) ? String(pl.kind) : null;
    const title = String(pl?.title ?? "").trim().slice(0, 120);
    const content = String(pl?.content_markdown ?? "").trim();
    if (!kind || seenKinds.has(kind) || title.length < 3 || content.length < 80) return [];
    seenKinds.add(kind);
    return [{
      kind,
      pillar: canonicalPillarId(pl?.pillar),
      title,
      content_markdown: content.slice(0, 20000),
    }];
  }).slice(0, 4);
  if (!plans.length) return null;

  return {
    overview: String(inp.overview ?? "").slice(0, 800),
    plans,
    daily_calories_kcal: inRange(inp.daily_calories_kcal, 800, 8000),
    daily_protein_g: inRange(inp.daily_protein_g, 20, 400),
    weekly_workouts: inRange(inp.weekly_workouts, 1, 14),
    sleep_hours_target: inRange(inp.sleep_hours_target, 4, 12),
    daily_spend_limit: inRange(inp.daily_spend_limit, 1, 100000),
    water_goal_ml: inRange(inp.water_goal_ml, 500, 6000),
    habits,
    assumptions: (Array.isArray(inp.assumptions) ? inp.assumptions : [])
      .map((a: unknown) => String(a).slice(0, 160)).filter(Boolean).slice(0, 8),
  } as Blueprint;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);
    await assertRateLimit(supabase, user.id, "onboarding-blueprint", 5, 60);

    /* O FLUXO MORA EM decide.ts, com cada peça do mundo injetada. Aqui só se
       ligam as peças ao Supabase e ao modelo. Por quê: a regra "quem já tem
       proposta não chama o modelo de novo" só se prova com um modelo falso que
       conta chamadas (decide.test.ts) — e para isso o fluxo não pode importar
       o modelo, tem de recebê-lo. */
    const deps: Dependencias<Blueprint> = {
      agora: () => Date.now(),
      lerLinha: async () => {
        const { data, error } = await supabase.from("blueprint_proposals")
          .select("status,proposal,choices,generation_started_at,activation_result")
          .eq("user_id", user.id).maybeSingle();
        if (error) throw error;
        return (data as Linha | null) ?? null;
      },
      carimboLegado: async () => {
        const { data, error } = await supabase.from("profiles")
          .select("blueprint_generated_at").eq("user_id", user.id).maybeSingle();
        if (error) throw error;
        return (data?.blueprint_generated_at as string | null) ?? null;
      },
      geracaoLigada: async () => (await getFlags(supabase)).onboarding_blueprint_enabled,
      // Atômica no banco: duas abas chegando juntas, uma ganha e a outra
      // recebe "generating" (migração 20261013120000).
      reivindicar: async () => {
        const { data, error } = await supabase.rpc("claim_blueprint_generation", {
          uid: user.id, p_stale_after_seconds: GERACAO_VELHA_SEGUNDOS,
        });
        if (error) throw error;
        const r = data as { outcome: Reivindicacao; token: string | null };
        return { resultado: r.outcome, token: r.token ?? null };
      },
      gerar: () => gerarBlueprint(supabase, user.id),
      maxPlanosAtivos: async () => (await getEntitlements(supabase, user.id)).limits.max_active_plans,
      gravarPronta: async (bp, escolhas, token) => {
        // Só a geração DESTE token vira pronta: nunca sobrescreve a proposta
        // que outra chamada entregou, nem a geração nova que reivindicou
        // depois. `.select()` porque o update do supabase-js com 0 linhas não
        // dá erro — e 0 linhas é exatamente o caso que precisa ser visto.
        const { data, error } = await supabase.from("blueprint_proposals")
          .update({ status: "ready", proposal: bp, choices: escolhas, generated_at: new Date().toISOString() })
          .eq("user_id", user.id).eq("status", "generating").eq("generation_token", token)
          .select("user_id");
        if (error) throw error;
        return (data ?? []).length > 0;
      },
      // A linha `generating` some e a cortesia volta NA MESMA TRANSAÇÃO:
      // tentativa fracassada nunca consome o limite (plano §3.4).
      liberar: async (token) => {
        const { error } = await supabase.rpc("release_blueprint_generation", { uid: user.id, p_token: token });
        if (error) console.error("release_blueprint_generation", error);
      },
      // O rastro é para medir; um evento perdido não pode custar à pessoa a
      // resposta. Erro aqui é só log.
      evento: async (kind, detail) => {
        // `resumed` passa pelo MESMO teto de 30 minutos da RPC que a tela
        // chama ao hidratar (blueprint_register_resumed): a retomada pela
        // função e a retomada pela leitura direta contam no mesmo relógio.
        const { error } = kind === "resumed"
          ? await supabase.rpc("blueprint_register_resumed", { uid: user.id })
          : await supabase.from("blueprint_events").insert({ user_id: user.id, kind, detail: detail ?? null });
        if (error) console.error("blueprint_events", kind, error);
      },
    };

    const r = await atender(deps);
    return json(r.body, r.status);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Algo falhou do nosso lado. Tente de novo em instantes; se continuar, mande um feedback pelos Ajustes." }, 500);
  }
});
