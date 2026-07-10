// ASCENDE — Conselheiro (chat de IA com visão de todos os pilares)
import {
  corsFor, serviceClient, requireUser, assertRateLimit, buildSnapshot,
  MODEL_SMART, MODEL_FAST, SAFETY_RULES, extractEventsAndMemories,
} from "../_shared/lib.ts";
import { anthropicCall, countUsage } from "../_shared/usage.ts";
import {
  getEntitlements, limitResponse,
  spDayStartUtc, spWeekStartUtc, spMonthStartUtc,
  nextSpDayStartUtc, nextSpWeekStartUtc, nextSpMonthStartUtc,
} from "../_shared/entitlements.ts";

const LEGACY_DAILY_LIMIT = 40; // vigente enquanto premium_limits_enabled = false

const SYSTEM = `Você é o Conselheiro do Ascende, uma plataforma brasileira de qualidade de vida. Você é a única IA que enxerga TODAS as áreas da vida da pessoa ao mesmo tempo: finanças, corpo, alimentação, mente e espírito. Seu papel é ajudá-la a subir de nível na vida real.

━━━ COMO VOCÊ RESPONDE ━━━
• Português do Brasil, tom caloroso e direto, sem jargão. Máximo 4 parágrafos curtos.
• SEMPRE cruze pilares quando fizer sentido: um plano alimentar deve caber no orçamento; uma meta financeira deve considerar o momento emocional; um plano de treino deve respeitar o sono. Esse cruzamento é o seu superpoder — use os dados do retrato abaixo.
• Toda sugestão vem com o porquê nos dados ("sugiro X porque seu sono caiu e seu gasto com lazer está em 80% do planejado").
• Quando montar planos (alimentar, financeiro, de treino), ofereça versões em faixas de custo quando houver orçamento envolvido, com valores estimados em reais.
• Termine com UM próximo passo pequeno e concreto.
• Se faltar dado importante, diga o que registrar para você ajudar melhor.
• ESTILO: escreva como uma pessoa escreve, não como IA. NUNCA use travessão ou meia-risca (— ou –) na resposta; no lugar, use vírgula, dois-pontos, parênteses ou comece outra frase. Evite também fórmulas prontas como "Vamos lá!", "Com certeza!" ou fechos genéricos.

━━━ SUA MEMÓRIA ━━━
Você aprende sobre a pessoa a cada conversa: o retrato abaixo inclui memórias de conversas anteriores (preferências, rotina, contexto de vida, jeito de ser). Use-as ATIVAMENTE para personalizar respostas e planos: se ela não gosta de um exercício, não o sugira; se trabalha à noite, os horários sugeridos respeitam isso; se pediu respostas diretas, seja direto. Referencie o que já sabe com naturalidade, como um amigo que lembra ("como você prefere treinar de manhã..."), sem recitar listas, sem soar como vigilância e sem repetir na mesma conversa que "guardou" algo.

━━━ PONDERE ANTES DE RESPONDER ━━━
Antes de qualquer resposta personalizada (recomendação, análise, decisão sobre a vida da pessoa), avalie em silêncio: "tenho as informações para uma resposta de QUALIDADE, específica para ESTA pessoa, ou vou entregar algo genérico?". Se faltarem dados essenciais, NÃO responda genericamente: faça até 3 perguntas objetivas, ou aponte o que registrar no app, e pare por aí. Uma resposta curta que pede o dado certo vale mais que uma resposta longa e rasa.
Proporcionalidade: perguntas factuais ("quantas calorias tem um ovo?") e conversas leves respondem direto, sem burocracia. Quanto mais a resposta depende do contexto da pessoa e quanto maior o custo de errar (saúde, dinheiro, rotina), mais rigorosa a checagem antes de responder.

━━━ PROTOCOLO DE PLANOS DEFINITIVOS ━━━
Plano definitivo = plano alimentar/dieta, plano de treino, orçamento/plano financeiro ou rotina estruturada que a pessoa vai seguir por dias ou semanas. Para esses, a regra muda: profundidade exige dados.

DADOS OBRIGATÓRIOS por tipo (verifique no retrato e na conversa):
• Plano alimentar: idade, sexo, altura, peso atual, objetivo (do retrato ou da conversa), nível de atividade, restrições alimentares e condições de saúde (se existirem, considere; se as listas estiverem vazias, confirme na conversa que não há).
• Plano de treino: idade, nível de atividade, objetivo, condições de saúde/lesões, dias disponíveis por semana (pergunte se não souber).
• Plano financeiro/orçamento: renda mensal, teto de gastos desejado, objetivo.

REGRAS:
1. Se QUALQUER dado obrigatório estiver ausente, NÃO gere o plano completo. Responda curto: diga em uma frase por que precisa dos dados, liste o que falta e onde preencher (idade, sexo, altura, atividade e restrições em Ajustes na seção "Sobre você"; peso na aba Alimentação; condições e medicamentos na Vitalidade; renda e teto em Ajustes). A pessoa também pode responder direto na conversa: aceite e use.
2. Só gere o plano completo quando tiver tudo. Aí sim vá fundo: quantidades, horários, valores em reais, alternativas econômicas, adaptações às condições de saúde e medicamentos do retrato.
3. Exceção: se a pessoa disser explicitamente para gerar mesmo sem os dados, gere uma versão provisória começando com a seção "Premissas que assumi" listando cada suposição.
4. Ao entregar um plano completo (caso 2 ou 3), ALÉM do texto da resposta, chame a ferramenta registrar_plano com o plano em markdown. O app oferece à pessoa salvar o plano na área "Meus planos". Não diga que "salvou": diga que o plano está pronto para ser salvo.
   FORMATO OBRIGATÓRIO do content_markdown (padrão visual do app):
   • Comece com "## Resumo": 3 a 6 bullets com objetivo e números-chave (calorias/macros diários, orçamento mensal, frequência semanal).
   • Depois, seções "## ..." por tema; dentro, "### ..." para subdivisões (cada refeição, cada dia de treino, cada categoria de gasto).
   • Itens com quantidades SEMPRE em bullets: "- Arroz branco: 150g (195 kcal)".
   • Use tabelas markdown (| Coluna | Coluna |) para comparar valores: macros por refeição, treino por dia, orçamento por categoria.
   • Separe grandes blocos com uma linha "---".
   • Termine com "## Observações": adaptações às condições de saúde, avisos e quando revisar o plano.
   • METAS DO PLANO (o app as aplica ao salvar e a pessoa acompanha na tela Hoje — NUNCA as omita):
     plano alimentar → daily_calories_kcal é OBRIGATÓRIO (e daily_protein_g quando o plano definir proteína);
     plano de treino → weekly_workouts é OBRIGATÓRIO (e sleep_hours_target se o plano tratar de sono);
     plano financeiro → daily_spend_limit quando o plano definir teto diário de gastos.
5. Perguntas pontuais ("quantas calorias tem ovo?", "treino de peito é bom 2x por semana?") NÃO são planos definitivos: responda normalmente, sem exigir dados.
6. AJUSTES: se a pessoa comentar ou pedir mudanças em um plano recém-entregue ("não gosto de agachamento", "troca o frango do jantar", "diminui o valor de lazer"), acolha o comentário, refaça o que for preciso e chame registrar_plano DE NOVO com o plano COMPLETO revisado (mesmo título, salvo se a mudança justificar renomear). Nunca registre só a diferença: o plano registrado deve ser sempre autossuficiente. Na resposta em texto, resuma apenas o que mudou.

━━━ PROPONDO GUARDAR DADOS QUE A PESSOA INFORMA NA CONVERSA ━━━
Quando a pessoa informar dados de perfil na conversa (idade ou ano de nascimento, sexo, altura, nível de atividade, restrições alimentares, meta de peso, CONDIÇÕES DE SAÚDE que ela tenha, ou MEDICAMENTOS que ela use), chame a ferramenta atualizar_perfil NA MESMA resposta. IMPORTANTE: a ferramenta gera uma PROPOSTA — nada é salvo sem a pessoa confirmar num cartão que o app mostra. Ex.: "sou diabético" → add_health_conditions: ["diabetes"]; "tomo losartana todo dia" → add_medications: ["losartana"]. Ao propor guardar condição ou medicamento, seja acolhedor e lembre em UMA frase que você considera isso nas sugestões mas não substitui o acompanhamento de quem prescreve; NUNCA sugira iniciar, parar ou mudar dose de medicamento. Se ela der a idade, calcule o ano de nascimento a partir do ano atual. Mencione em UMA frase que sugeriu salvar isso no perfil (nunca diga que "salvou"). O peso ATUAL não vai no perfil: ele vira registro na linha do tempo (o app cuida disso automaticamente).
${SAFETY_RULES}

━━━ RETRATO ATUAL DA PESSOA (dados reais da plataforma) ━━━
`;

const SAVE_PLAN_TOOL = {
  name: "registrar_plano",
  description:
    "Registra um plano definitivo completo (alimentar, treino, financeiro, rotina) que você acabou de montar na resposta. " +
    "Chame APENAS quando entregar um plano completo. O conteúdo deve ser o plano inteiro em markdown, autossuficiente (sem depender do resto da conversa).",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Título curto do plano. Ex.: 'Plano alimentar para ganho de massa'." },
      kind: { type: "string", enum: ["alimentar", "treino", "financeiro", "rotina", "outro"] },
      pillar: { type: "string", enum: ["prosperidade", "vitalidade", "alimentacao", "mente"], description: "Pilar principal do plano." },
      content_markdown: { type: "string", description: "O plano COMPLETO em markdown: seções, quantidades, horários, valores. Autossuficiente." },
      daily_calories_kcal: { type: "number", description: "OBRIGATÓRIO em planos alimentares: a meta calórica diária do plano. O app aplica como meta acompanhada na tela Hoje." },
      daily_protein_g: { type: "number", description: "Meta diária de proteína em gramas (obrigatória em planos alimentares que a definem)." },
      weekly_workouts: { type: "number", description: "OBRIGATÓRIO em planos de treino: quantos treinos por semana o plano prevê." },
      sleep_hours_target: { type: "number", description: "Se o plano define meta de horas de sono por noite, informe-a." },
      daily_spend_limit: { type: "number", description: "Em planos financeiros: teto de gasto DIÁRIO em reais, se o plano definir um." },
    },
    required: ["title", "kind", "content_markdown"],
  },
};

const UPDATE_PROFILE_TOOL = {
  name: "atualizar_perfil",
  description:
    "PROPÕE guardar no perfil dados que a pessoa informou explicitamente nesta conversa (o app pede confirmação dela antes de salvar). " +
    "Preencha APENAS os campos que ela informou agora. Nunca invente ou deduza sem a pessoa ter dito.",
  input_schema: {
    type: "object",
    properties: {
      birth_year: { type: "integer", description: "Ano de nascimento. Se a pessoa deu a idade, calcule: ano atual menos a idade." },
      sex: { type: "string", enum: ["feminino", "masculino"] },
      height_cm: { type: "number", description: "Altura em centímetros. '1,83m' vira 183." },
      activity_level: { type: "string", enum: ["sedentario", "leve", "moderado", "intenso"] },
      add_dietary_restrictions: {
        type: "array", items: { type: "string" },
        description: "Restrições alimentares mencionadas, para ADICIONAR às existentes. Ex.: ['sem lactose']. Se a pessoa disse que não tem nenhuma, não envie este campo.",
      },
      add_health_conditions: {
        type: "array", items: { type: "string" },
        description: "Condições de saúde, alergias ou lesões que a pessoa mencionou ter, para ADICIONAR às existentes. Ex.: ['diabetes tipo 2', 'hérnia de disco']. Só o que ela declarou explicitamente sobre si mesma.",
      },
      add_medications: {
        type: "array", items: { type: "string" },
        description: "Medicamentos que a pessoa disse USAR, para ADICIONAR aos existentes. Ex.: ['losartana', 'metformina']. Apenas uso relatado pela própria pessoa; nunca sugira, prescreva ou deduza medicação.",
      },
      weight_goal_kg: { type: "number", description: "Meta de peso em kg, se a pessoa declarou uma." },
      calorie_goal_kcal: { type: "number", description: "Meta calórica diária em kcal, se a pessoa declarou uma ('minha meta é 3000 kcal por dia')." },
      protein_goal_g: { type: "number", description: "Meta diária de proteína em gramas, se a pessoa declarou uma." },
      daily_spend_limit: { type: "number", description: "Teto de gasto diário em reais, se a pessoa declarou um ('quero gastar no máximo 80 por dia')." },
      weekly_workouts_goal: { type: "number", description: "Meta de treinos por semana, se a pessoa declarou uma." },
      sleep_goal_h: { type: "number", description: "Meta de horas de sono por noite, se a pessoa declarou uma." },
    },
  },
};

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);
    await assertRateLimit(supabase, user.id, "ai-chat", 60, 5);
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

    // Limites do Conselheiro — validados NO SERVIDOR, por plano, no fuso de São Paulo
    const ent = await getEntitlements(supabase, user.id);
    const countChat = async (sinceIso: string) => {
      const { count } = await supabase.from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id).eq("role", "user").gte("created_at", sinceIso);
      return count ?? 0;
    };
    if (ent.flags.premium_limits_enabled) {
      const L = ent.limits;
      if (L.chat_daily !== null && (await countChat(spDayStartUtc())) >= L.chat_daily) {
        return limitResponse(req, "counselor", L.chat_daily, nextSpDayStartUtc(),
          `Você usou as ${L.chat_daily} mensagens de hoje com o Conselheiro.`);
      }
      if (L.chat_weekly !== null && (await countChat(spWeekStartUtc())) >= L.chat_weekly) {
        return limitResponse(req, "counselor", L.chat_weekly, nextSpWeekStartUtc(),
          `Você usou as ${L.chat_weekly} mensagens desta semana com o Conselheiro.`);
      }
      if (L.chat_monthly !== null && (await countChat(spMonthStartUtc())) >= L.chat_monthly) {
        return limitResponse(req, "counselor", L.chat_monthly, nextSpMonthStartUtc(),
          `Você usou as ${L.chat_monthly} mensagens deste mês com o Conselheiro.`);
      }
      // Anexos de PDF/documento fazem parte do Ascende+ (com limite mensal)
      const docCount = atts.filter((a) => a?.kind === "pdf").length;
      if (docCount > 0) {
        const cap = L.document_analyses_monthly ?? 0;
        const used = await countUsage(supabase, user.id, ["chat-documento"], spMonthStartUtc());
        if (used + docCount > cap) {
          return limitResponse(req, "document_analysis", cap, nextSpMonthStartUtc(),
            cap === 0
              ? "A análise de documentos (PDF) faz parte do Ascende+."
              : `Você usou as ${cap} análises de documentos deste mês.`);
        }
        // registra o consumo dos documentos desta mensagem
        for (let i = 0; i < docCount; i++) {
          await supabase.from("ai_usage").insert({
            user_id: user.id, feature: "chat-documento", model: MODEL_SMART, success: true,
          });
        }
      }
    } else if ((await countChat(spDayStartUtc())) >= LEGACY_DAILY_LIMIT) {
      return json({ error: `Você atingiu o limite de ${LEGACY_DAILY_LIMIT} mensagens por dia. Amanhã o Conselheiro estará aqui de novo.` }, 429);
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

    // Roteamento de modelo: perguntas curtas e diretas não precisam do modelo caro.
    const needsSmart =
      contentBlocks.length > 0 ||
      message.length > 160 ||
      /plano|dieta|treino|or[çc]ament|financ|analis|relat[óo]rio|semana|m[êe]s|como (estou|est[áa]|anda)|minha vida|meta|estrat[ée]gia|cruz|compar/i.test(message);
    const model = ent.flags.model_routing_enabled && !needsSmart ? MODEL_FAST : MODEL_SMART;

    const { res, data: mainData } = await anthropicCall(supabase, user.id, "chat-principal", {
      model,
      max_tokens: 3000,
      // Cache de prompt: as regras (estáveis) ficam em bloco cacheado;
      // o retrato (variável) fica fora do cache.
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: snapshot },
      ],
      tools: [SAVE_PLAN_TOOL, UPDATE_PROFILE_TOOL],
      tool_choice: { type: "auto" },
      messages,
    });

    // Em paralelo: UMA chamada econômica extrai eventos registráveis E memórias
    // duráveis da mensagem (eram duas chamadas; plano §9.2). São PROPOSTAS — o
    // app pede confirmação antes de gravar eventos. Mensagens triviais
    // ("obrigado", "pode continuar") não geram chamada nenhuma.
    const extractPromise = extractEventsAndMemories(
      supabase, user.id, message, "chat-extracao", ent.limits.memory_cap,
    );

    if (!res.ok || !mainData) {
      return json({ error: "O Conselheiro está indisponível agora. Tente de novo em instantes." }, 502);
    }
    // deno-lint-ignore no-explicit-any
    const blocks = ((mainData as any).content ?? []) as any[];
    let reply = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

    // Plano proposto pelo modelo (o app pede confirmação antes de salvar)
    let plan: { title: string; kind: string; pillar: string | null; content: string; daily_calories_kcal: number | null; daily_protein_g: number | null; weekly_workouts: number | null; sleep_hours_target: number | null; daily_spend_limit: number | null } | null = null;
    const planBlock = blocks.find((b) => b.type === "tool_use" && b.name === "registrar_plano");
    if (planBlock?.input?.title && planBlock?.input?.content_markdown) {
      const inp = planBlock.input;
      const inRange = (v: unknown, lo: number, hi: number) => {
        const n = Number(v);
        return n >= lo && n <= hi ? Math.round(n * 10) / 10 : null;
      };
      plan = {
        title: String(inp.title).slice(0, 120),
        kind: ["alimentar", "treino", "financeiro", "rotina", "outro"].includes(inp.kind) ? inp.kind : "outro",
        pillar: ["prosperidade", "vitalidade", "alimentacao", "mente"].includes(inp.pillar) ? inp.pillar : null,
        content: String(inp.content_markdown).slice(0, 20000),
        daily_calories_kcal: inRange(inp.daily_calories_kcal, 800, 8000),
        daily_protein_g: inRange(inp.daily_protein_g, 20, 400),
        weekly_workouts: inRange(inp.weekly_workouts, 1, 14),
        sleep_hours_target: inRange(inp.sleep_hours_target, 4, 12),
        daily_spend_limit: inRange(inp.daily_spend_limit, 1, 100000),
      };

      // Rede de segurança: se o modelo esqueceu a meta esperada pelo tipo,
      // uma extração rápida lê o próprio texto do plano. Falha aqui não derruba nada.
      const needsKcal = plan.kind === "alimentar" && !plan.daily_calories_kcal;
      const needsWorkouts = plan.kind === "treino" && !plan.weekly_workouts;
      if (needsKcal || needsWorkouts) {
        try {
          const { res: r, data: gd } = await anthropicCall(supabase, user.id, "chat-metas", {
              model: MODEL_FAST,
              max_tokens: 300,
              tools: [{
                name: "extrair_metas",
                description: "Extrai as metas numéricas definidas neste plano.",
                input_schema: {
                  type: "object",
                  properties: {
                    daily_calories_kcal: { type: "number", description: "Meta calórica diária definida no plano, se houver." },
                    daily_protein_g: { type: "number", description: "Meta diária de proteína (g), se houver." },
                    weekly_workouts: { type: "number", description: "Treinos por semana previstos no plano, se houver." },
                    sleep_hours_target: { type: "number", description: "Meta de horas de sono por noite, se houver." },
                    daily_spend_limit: { type: "number", description: "Teto de gasto diário em reais, se houver." },
                  },
                },
              }],
              tool_choice: { type: "tool", name: "extrair_metas" },
              messages: [{ role: "user", content: `Extraia as metas deste plano:\n\n${plan.content.slice(0, 6000)}` }],
          });
          if (r.ok && gd) {
            // deno-lint-ignore no-explicit-any
            const tu = ((gd as any).content ?? []).find((b: any) => b.type === "tool_use");
            const gi = tu?.input ?? {};
            plan.daily_calories_kcal = plan.daily_calories_kcal ?? inRange(gi.daily_calories_kcal, 800, 8000);
            plan.daily_protein_g = plan.daily_protein_g ?? inRange(gi.daily_protein_g, 20, 400);
            plan.weekly_workouts = plan.weekly_workouts ?? inRange(gi.weekly_workouts, 1, 14);
            plan.sleep_hours_target = plan.sleep_hours_target ?? inRange(gi.sleep_hours_target, 4, 12);
            plan.daily_spend_limit = plan.daily_spend_limit ?? inRange(gi.daily_spend_limit, 1, 100000);
          }
        } catch { /* segue sem metas extras */ }
      }
      if (!reply) reply = plan.content; // segurança: nunca responder vazio
    }

    // Dados de perfil informados na conversa: viram uma PROPOSTA que o app
    // mostra para a pessoa confirmar. Nada é gravado automaticamente (plano §7).
    const suggestedLabels: string[] = [];
    const patch: Record<string, unknown> = {};
    const merge: Record<string, string[]> = {};
    const profBlock = blocks.find((b) => b.type === "tool_use" && b.name === "atualizar_perfil");
    if (profBlock?.input && typeof profBlock.input === "object") {
      const inp = profBlock.input as Record<string, unknown>;
      const yearNow = new Date().getFullYear();
      const by = Number(inp.birth_year);
      if (by > 1900 && by <= yearNow) { patch.birth_year = Math.round(by); suggestedLabels.push("ano de nascimento"); }
      if (inp.sex === "feminino" || inp.sex === "masculino") { patch.sex = inp.sex; suggestedLabels.push("sexo"); }
      const h = Number(inp.height_cm);
      if (h > 80 && h < 250) { patch.height_cm = Math.round(h * 10) / 10; suggestedLabels.push("altura"); }
      if (["sedentario", "leve", "moderado", "intenso"].includes(String(inp.activity_level))) {
        patch.activity_level = inp.activity_level; suggestedLabels.push("nível de atividade");
      }
      const wg = Number(inp.weight_goal_kg);
      if (wg > 20 && wg < 400) { patch.weight_goal_kg = wg; suggestedLabels.push("meta de peso"); }
      const cg = Number(inp.calorie_goal_kcal);
      if (cg >= 800 && cg <= 8000) { patch.calorie_goal_kcal = Math.round(cg); suggestedLabels.push("meta calórica diária"); }
      const pg = Number(inp.protein_goal_g);
      if (pg >= 20 && pg <= 400) { patch.protein_goal_g = Math.round(pg); suggestedLabels.push("meta de proteína"); }
      const dsl = Number(inp.daily_spend_limit);
      if (dsl >= 1 && dsl <= 100000) { patch.daily_spend_limit = dsl; suggestedLabels.push("teto de gasto diário"); }
      const ww = Number(inp.weekly_workouts_goal);
      if (ww >= 1 && ww <= 14) { patch.weekly_workouts_goal = Math.round(ww); suggestedLabels.push("meta de treinos por semana"); }
      const sg = Number(inp.sleep_goal_h);
      if (sg >= 4 && sg <= 12) { patch.sleep_goal_h = sg; suggestedLabels.push("meta de sono"); }
      const cleanList = (v: unknown, label: string, key: string) => {
        if (!Array.isArray(v) || !v.length) return;
        const items = (v as unknown[]).map((r) => String(r).trim().slice(0, 80)).filter(Boolean).slice(0, 20);
        if (items.length) { merge[key] = items; suggestedLabels.push(label); }
      };
      cleanList(inp.add_dietary_restrictions, "restrições alimentares", "dietary_restrictions");
      cleanList(inp.add_health_conditions, "condições de saúde", "health_conditions");
      cleanList(inp.add_medications, "medicamentos", "medications");
    }
    const profileSuggestion = suggestedLabels.length ? { patch, merge, labels: suggestedLabels } : null;

    await supabase.from("chat_messages").insert([
      { user_id: user.id, role: "user", content: attNames.length ? `${message}\n📎 ${attNames.join(", ")}` : message },
      { user_id: user.id, role: "assistant", content: reply },
    ]);

    const { events: captured, learned } = await extractPromise;
    return json({ reply, captured, plan, profile_suggestion: profileSuggestion, learned });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});