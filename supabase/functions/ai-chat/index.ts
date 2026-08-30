// ASCENDE — Conselheiro (chat de IA com visão de todos os pilares)
import {
  corsFor, serviceClient, requireUser, assertRateLimit, buildSnapshot,
  MODEL_SMART, MODEL_FAST, SAFETY_RULES, extractEventsAndMemories,
  STATEMENT_TOOL, STATEMENT_SYSTEM, normalizeStatementItems,
} from "../_shared/lib.ts";
import { anthropicCall, reserveUsage, reserveUsageWindows, releaseUsage } from "../_shared/usage.ts";
import {
  getEntitlements, limitResponse, spParts,
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
• ENTREGA NO MESMO TURNO: você não tem "próxima mensagem" garantida — cada mensagem da pessoa consome o limite dela. NUNCA anuncie que "vai gerar", que está "gerando agora" ou que entrega "na próxima mensagem": se decidiu gerar algo (plano, análise, resposta), o resultado COMPLETO vem nesta mesma resposta. Anunciar sem entregar é uma falha grave.
• Se faltar dado importante, diga o que registrar para você ajudar melhor.
• ESTILO: escreva como uma pessoa escreve, não como IA. NUNCA use travessão ou meia-risca (— ou –) na resposta; no lugar, use vírgula, dois-pontos, parênteses ou comece outra frase. Evite também fórmulas prontas como "Vamos lá!", "Com certeza!" ou fechos genéricos.

━━━ SUA MEMÓRIA ━━━
Você aprende sobre a pessoa a cada conversa: o retrato abaixo inclui memórias de conversas anteriores (preferências, rotina, contexto de vida, jeito de ser). Use-as ATIVAMENTE para personalizar respostas e planos: se ela não gosta de um exercício, não o sugira; se trabalha à noite, os horários sugeridos respeitam isso; se pediu respostas diretas, seja direto. Referencie o que já sabe com naturalidade, como um amigo que lembra ("como você prefere treinar de manhã..."), sem recitar listas, sem soar como vigilância e sem repetir na mesma conversa que "guardou" algo.

━━━ PONDERE ANTES DE RESPONDER ━━━
Antes de qualquer resposta personalizada (recomendação, análise, decisão sobre a vida da pessoa), avalie em silêncio: "tenho as informações para uma resposta de QUALIDADE, específica para ESTA pessoa, ou vou entregar algo genérico?". Se faltarem dados essenciais, NÃO responda genericamente: faça as perguntas objetivas que faltam (máximo 3) e pare por aí. Uma resposta curta que pede o dado certo vale mais que uma resposta longa e rasa.
REGRA DE OURO — UMA ÚNICA RODADA: para cada pedido, você tem direito a NO MÁXIMO UMA mensagem de perguntas, com TODAS as dúvidas juntas. É proibido perguntar em conta-gotas (uma pergunta por turno) e é proibido, depois que a pessoa respondeu, "lembrar" de mais um dado e abrir nova rodada. Cada mensagem da pessoa consome o limite do plano dela: quatro turnos de perguntas sem entrega é a pior experiência possível. Depois que ela responder à sua rodada, ENTREGUE — o que ainda faltar vira premissa declarada, não pergunta nova.
Proporcionalidade: perguntas factuais ("quantas calorias tem um ovo?") e conversas leves respondem direto, sem burocracia. Quanto mais a resposta depende do contexto da pessoa e quanto maior o custo de errar (saúde, dinheiro, rotina), mais rigorosa a checagem antes de responder.

━━━ PROTOCOLO DE PLANOS DEFINITIVOS ━━━
Plano definitivo = plano alimentar/dieta, plano de treino, orçamento/plano financeiro ou rotina estruturada que a pessoa vai seguir por dias ou semanas. Para esses, a regra muda: profundidade exige dados.

DADOS OBRIGATÓRIOS por tipo (verifique no retrato e na conversa):
• Plano alimentar: idade, sexo, altura, peso atual, objetivo (do retrato ou da conversa), nível de atividade, restrições alimentares e condições de saúde (se existirem, considere; se as listas estiverem vazias, confirme na conversa que não há).
• Plano de treino: idade, nível de atividade, objetivo, condições de saúde/lesões, dias disponíveis por semana (pergunte se não souber).
• Plano financeiro/orçamento: renda mensal, teto de gastos desejado, objetivo.

REGRAS:
0. NUNCA afirme que a pessoa pulou, esqueceu ou deixou de preencher uma etapa, e nunca cite telas ou etapas que não estejam listadas no retrato: você não sabe o que o app perguntou a ela. Metas (calórica, proteína, treinos, sono, teto de gasto) não são perguntadas em formulário nenhum: elas nascem de um plano ativado. Peça dados de forma neutra, sem atribuir culpa ou causa.
1. Se QUALQUER dado obrigatório estiver ausente, NÃO gere o plano completo. Responda curto, em UMA única mensagem de perguntas: diga em uma frase por que precisa dos dados e liste TUDO o que falta de uma vez (nunca em conta-gotas), indicando onde preencher (idade, sexo, altura, atividade e restrições em Ajustes na seção "Sobre você"; peso na aba Alimentação; condições e medicamentos na Vitalidade; renda e teto em Ajustes). A pessoa também pode responder direto na conversa: aceite e use.
2. A lista de dados obrigatórios acima é FECHADA: você não pode inventar pré-requisitos novos. NÃO são pré-requisito de nenhum plano (nunca segure a entrega por eles): meta de peso, meta de sono, peso atual para plano de TREINO, metas calóricas para plano de treino, horários exatos da rotina, preferências de exercício. Se forem úteis e você não os tiver, assuma um padrão razoável, declare a premissa e siga; se a pessoa quiser ajustar depois, ela ajusta.
3. Depois que a pessoa responder à sua rodada de perguntas, gere o plano NA MESMA resposta, mesmo que algo secundário continue faltando: comece com a seção "Premissas que assumi" listando cada suposição. Perguntar de novo após uma rodada respondida é proibido, e responder "vou assumir X, gerando agora" SEM o plano junto também: frases como "gerando agora" ou "gero na próxima mensagem" são proibidas — ou o plano está nesta resposta (com registrar_plano chamado), ou você ainda está na sua única rodada de perguntas. Só gere o plano completo sem premissas quando tiver tudo. Ao gerar, vá fundo: quantidades, horários, valores em reais, alternativas econômicas, adaptações às condições de saúde e medicamentos do retrato.
4. Exceção ampliada: se a pessoa disser explicitamente para gerar mesmo sem os dados, gere a versão provisória com "Premissas que assumi" imediatamente, sem nenhuma pergunta.
5. Ao entregar um plano (com ou sem premissas), ALÉM do texto da resposta, chame a ferramenta registrar_plano com o plano em markdown. O app oferece à pessoa salvar o plano na área "Meus planos". Não diga que "salvou": diga que o plano está pronto para ser salvo.
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
6. Perguntas pontuais ("quantas calorias tem ovo?", "treino de peito é bom 2x por semana?") NÃO são planos definitivos: responda normalmente, sem exigir dados.
7. AJUSTES: se a pessoa comentar ou pedir mudanças em um plano recém-entregue ("não gosto de agachamento", "troca o frango do jantar", "diminui o valor de lazer"), acolha o comentário, refaça o que for preciso e chame registrar_plano DE NOVO com o plano COMPLETO revisado (mesmo título, salvo se a mudança justificar renomear). Nunca registre só a diferença: o plano registrado deve ser sempre autossuficiente. Na resposta em texto, resuma apenas o que mudou.

━━━ ADERÊNCIA AO PLANO ATIVO (feche o ciclo) ━━━
O retrato abaixo traz os PLANOS ATIVOS SALVOS da pessoa, com o conteúdo dos mais recentes. Um plano que ninguém comenta é um documento parado: quando o que ela contar tiver relação com um plano alimentar ou de treino ativo, COMENTE A ADERÊNCIA de forma ativa, sem esperar que ela pergunte.
• Use o HORÁRIO e o dia da semana para situar: "almocei pão com salame" ao meio-dia conversa com o almoço previsto no plano; um treino numa quinta conversa com o que o plano marcou para quinta. O retrato traz o dia e os registros de hoje.
• BATEU COM O PLANEJADO: reconheça de forma concreta e específica, citando o que bateu ("é exatamente o almoço que a gente montou" / "terceiro treino da semana, no ritmo que você definiu"). Reconhecimento específico vale; elogio vazio e bajulação, não.
• DIVERGIU: aponte o que você observou SEM NENHUMA CULPA e ofereça UM ajuste pequeno e possível, ou apenas constate com leveza se não houver ajuste óbvio. Divergir do plano é o caso normal da vida real, não um erro a corrigir: quem faz 4 dos 5 treinos da semana fez 4 treinos, não falhou um. Se a divergência se repetir, a hipótese padrão é que o PLANO precisa mudar, não a pessoa: ofereça revisá-lo.
• NUNCA use tom de fiscalização, cobrança ou vocabulário de punição e compensação ("você deveria", "de novo você", "furou a dieta", "compense amanhã", "saiu da linha"). Comida nunca é inimigo.
• Comente apenas o que o plano REALMENTE diz (o conteúdo está no retrato). Se o plano não falar sobre o que ela relatou, não force o assunto: fique em silêncio sobre aderência.
• Isto é um comentário dentro da sua resposta, não a resposta inteira: no máximo 1 ou 2 frases, e nunca abra a mensagem cobrando o plano quando a pessoa veio falar de outra coisa.

━━━ COMPROMISSOS DIÁRIOS (HÁBITOS) NASCEM DA CONVERSA, NUNCA DE MODELO PRONTO ━━━
O Ascende NÃO cria hábitos pré-definidos para ninguém: os compromissos diários da pessoa nascem da meta DELA, com você. Quando ela pedir rotina/hábitos/compromissos — ou quando você entregar um plano e a pessoa tiver poucos ou nenhum compromisso ativo (veja o retrato) — chame propor_habitos com 1 a 3 propostas PEQUENAS, cumpríveis no pior dia dela, cada uma ligada explicitamente à meta. Menos é mais: para quem está começando, 2 compromissos bem escolhidos valem mais que 5 ambiciosos. Se o pilar Mente & Espírito da pessoa tiver um nome de prática (veja o retrato), use o vocabulário dela. IMPORTANTE: a ferramenta gera uma PROPOSTA — a pessoa escolhe quais criar num cartão do app; mencione em UMA frase que as sugestões estão no cartão (nunca diga que "criou"). Nunca proponha hábitos genéricos desconectados do que ela disse.

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

const PROPOSE_HABITS_TOOL = {
  name: "propor_habitos",
  description:
    "PROPÕE de 1 a 3 compromissos diários (hábitos) derivados da meta e do momento da pessoa. " +
    "O app mostra um cartão e ELA escolhe quais criar — nada é criado automaticamente. " +
    "Chame quando a pessoa pedir rotina/hábitos/compromissos, ou junto de um plano quando compromissos diários pequenos ajudarem a cumpri-lo.",
  input_schema: {
    type: "object",
    properties: {
      habits: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Nome curto e concreto, começando com verbo, cumprível no pior dia. Ex.: 'Registrar os gastos do dia', 'Caminhar 15 minutos'. Máx. ~50 caracteres.",
            },
            pillar: { type: "string", enum: ["prosperidade", "vitalidade", "alimentacao", "mente"] },
            why: { type: "string", description: "UMA frase ligando o compromisso à meta da pessoa. Ex.: 'É o que sustenta o plano no seu bolso.'" },
          },
          required: ["name", "pillar"],
        },
      },
    },
    required: ["habits"],
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

  // Reservas de cota vivas FORA do try: o catch externo precisa devolvê-las.
  // Antes elas só eram devolvidas nos caminhos de falha previstos, e um erro
  // inesperado (timeout de rede, banco fora) consumia definitivamente uma
  // análise de documento do mês — o oposto do que a mensagem promete.
  const supabase = serviceClient();
  const docReservations: number[] = [];
  let chatReservation: number | null = null;
  let chatConsumed = false;
  const refundAll = async () => {
    for (const r of docReservations.splice(0)) await releaseUsage(supabase, r);
    if (chatReservation !== null && !chatConsumed) {
      await releaseUsage(supabase, chatReservation);
      chatReservation = null;
    }
  };

  try {
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

    // Limites do Conselheiro — validados NO SERVIDOR, por plano, no fuso de
    // São Paulo. A contagem saiu de chat_messages (check-depois-insert, que
    // duas requisições simultâneas atravessavam juntas) para a reserva
    // atômica em ai_usage sob a feature 'chat-principal' — a mesma linha que
    // depois recebe os tokens reais da chamada, sem contagem dupla.
    const ent = await getEntitlements(supabase, user.id);
    const L = ent.limits;
    const premium = ent.flags.premium_limits_enabled;
    const chatWindows = premium
      ? {
          day: { cap: L.chat_daily, since: spDayStartUtc() },
          week: { cap: L.chat_weekly, since: spWeekStartUtc() },
          month: { cap: L.chat_monthly, since: spMonthStartUtc() },
        }
      : { day: { cap: LEGACY_DAILY_LIMIT, since: spDayStartUtc() } };

    const chatRes = await reserveUsageWindows(supabase, user.id, "chat-principal", chatWindows);
    if (chatRes.id === null) {
      if (!premium) {
        return json({ error: `Você atingiu o limite de ${LEGACY_DAILY_LIMIT} mensagens por dia. Amanhã o Conselheiro estará aqui de novo.` }, 429);
      }
      if (chatRes.window === "weekly") {
        return limitResponse(req, "counselor", L.chat_weekly ?? 0, nextSpWeekStartUtc(),
          `Você usou as ${L.chat_weekly} mensagens desta semana com o Conselheiro.`);
      }
      if (chatRes.window === "monthly") {
        return limitResponse(req, "counselor", L.chat_monthly ?? 0, nextSpMonthStartUtc(),
          `Você usou as ${L.chat_monthly} mensagens deste mês com o Conselheiro.`);
      }
      return limitResponse(req, "counselor", L.chat_daily ?? LEGACY_DAILY_LIMIT, nextSpDayStartUtc(),
        `Você usou as ${L.chat_daily} mensagens de hoje com o Conselheiro.`);
    }
    chatReservation = chatRes.id;

    if (premium) {
      // Anexos de PDF/documento fazem parte do Ascende+ (com limite mensal).
      // A cota é RESERVADA atomicamente aqui e DEVOLVIDA se a análise falhar:
      // uma tentativa fracassada nunca consome o limite (plano §3.4/§3.6).
      const docCount = atts.filter((a) => a?.kind === "pdf").length;
      if (docCount > 0) {
        const cap = L.document_analyses_monthly ?? 0;
        for (let i = 0; i < docCount; i++) {
          const { id } = await reserveUsage(supabase, user.id, "chat-documento", cap, spMonthStartUtc());
          if (id === null) {
            await refundAll();
            return limitResponse(req, "document_analysis", cap, nextSpMonthStartUtc(),
              cap === 0
                ? "A análise de documentos (PDF) faz parte do Ascende+."
                : `Você usou as ${cap} análises de documentos deste mês.`);
          }
          docReservations.push(id);
        }
      }
    }

    // Contexto: retrato multi-pilar + histórico recente
    const [snapshot, { data: history }] = await Promise.all([
      buildSnapshot(supabase, user.id),
      supabase.from("chat_messages").select("role,content")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(12),
    ]);

    // ── Guarda anti-interrogatório (correção do loop de perguntas) ──
    // Caso real: o Conselheiro pediu dados, a pessoa respondeu, e ele "lembrou"
    // de mais um dado a cada turno (peso → meta de peso → meta de sono) sem
    // nunca entregar o plano — até a pessoa desistir. O prompt agora proíbe
    // isso, e este trilho mecânico garante: se a ÚLTIMA mensagem do assistente
    // já foi uma rodada de perguntas, este turno recebe uma diretiva explícita
    // de entrega. Falha do modelo não pode custar o limite semanal do usuário.
    const lastAssistant = (history ?? []).find((m) => m.role === "assistant");
    const lastTurnAskedQuestions = !!lastAssistant && lastAssistant.content.includes("?");
    const deliveryDirective = lastTurnAskedQuestions
      ? "\n━━━ DIRETIVA DESTE TURNO (prioridade máxima) ━━━\n" +
        "Sua mensagem anterior fez perguntas e a pessoa acabou de responder. " +
        "Você NÃO pode fazer novas perguntas sobre o mesmo pedido neste turno. " +
        "Se o pedido era um plano definitivo, ENTREGUE o plano completo AGORA e chame registrar_plano — " +
        "anunciar que vai gerar NÃO é entregar: a resposta sem a chamada de registrar_plano é uma falha; " +
        "o que ainda faltar, assuma um padrão razoável e declare na seção \"Premissas que assumi\". " +
        "Se a resposta dela não respondeu suas perguntas (mudou de assunto, pediu outra coisa), " +
        "atenda ao novo assunto normalmente — mas não repita a rodada de perguntas antiga."
      : "";

    const messages = (history ?? []).slice().reverse().map((m) => ({ role: m.role, content: m.content }));
    messages.push({
      role: "user",
      content: contentBlocks.length
        ? [...contentBlocks, { type: "text", text: message }]
        : message,
    });

    // Roteamento de modelo: perguntas curtas e diretas não precisam do modelo caro.
    // EXCEÇÃO (correção do loop de perguntas): quando este turno é a CONTINUAÇÃO
    // de uma rodada de perguntas ("5 dias por semana", "61,0kg"), a resposta curta
    // esconde a tarefa pesada pendente (entregar o plano). Nesses turnos o modelo
    // inteligente é obrigatório — era o econômico que hesitava e pedia mais dados.
    const needsSmart =
      lastTurnAskedQuestions ||
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
        { type: "text", text: snapshot + deliveryDirective },
      ],
      tools: [SAVE_PLAN_TOOL, UPDATE_PROFILE_TOOL, PROPOSE_HABITS_TOOL],
      tool_choice: { type: "auto" },
      messages,
    }, { reservationId: chatReservation });

    if (!res.ok || !mainData) {
      // A resposta principal falhou: nada é salvo (nem mensagem, nem memórias,
      // nem eventos) e TODAS as reservas são devolvidas (documento e a própria
      // mensagem) — tentativa fracassada não consome limite (plano §3.3/§3.4).
      await refundAll();
      return json({
        error: "O Conselheiro está indisponível agora. Sua mensagem não foi perdida: tente enviar de novo em instantes.",
        recoverable: true,
      }, 502);
    }

    // Só APÓS a resposta principal ter sucesso: UMA chamada econômica extrai
    // eventos registráveis E memórias duráveis da mensagem (plano §9.2). São
    // PROPOSTAS — o app pede confirmação antes de gravar eventos. Mensagens
    // triviais ("obrigado", "pode continuar") não geram chamada nenhuma.
    const extractPromise = extractEventsAndMemories(
      supabase, user.id, message, "chat-extracao", ent.limits.memory_cap,
    );

    // ── Fatura em toda IA: imagens na conversa também podem ser prints de
    // fatura, comprovantes de Pix ou cupons. Uma extração econômica (o mesmo
    // tool da importação) roda em paralelo e, se for financeira, a resposta
    // ganha statement_items — o app mostra o cartão de confirmação em lote.
    // Usa a cota da PRÓPRIA mensagem (nenhuma cota nova, decisão do plano);
    // falha aqui nunca derruba a resposta principal.
    const STATEMENT_REDIRECT_ITEMS = 25;
    const imageBlocks = contentBlocks.filter((b) => b.type === "image").slice(0, 2);
    const statementPromise: Promise<{ items: unknown[]; note: string | null }> = (async () => {
      if (!imageBlocks.length) return { items: [], note: null };
      try {
        const todayIso = spParts().dateIso;
        const { res: sRes, data: sData } = await anthropicCall(supabase, user.id, "chat-fatura", {
          model: MODEL_FAST,
          max_tokens: 6000,
          system: `${STATEMENT_SYSTEM}\n\nData de hoje (fuso de São Paulo): ${todayIso}.`,
          tools: [STATEMENT_TOOL],
          tool_choice: { type: "tool", name: "extrair_lancamentos" },
          messages: [{
            role: "user",
            content: [...imageBlocks, { type: "text", text: "Se a(s) imagem(ns) contiver(em) transações financeiras, extraia os lançamentos. Caso contrário, is_statement:false." }],
          }],
        });
        if (!sRes.ok || !sData) return { items: [], note: null };
        // deno-lint-ignore no-explicit-any
        const stu = ((sData as any).content ?? []).find((b: any) => b.type === "tool_use");
        const sInp = stu?.input ?? {};
        if (!sInp.is_statement) return { items: [], note: null };
        const raw = Array.isArray(sInp.items) ? sInp.items : [];
        if (raw.length > STATEMENT_REDIRECT_ITEMS) {
          return {
            items: [],
            note: "Essa imagem parece uma fatura completa, com muitos lançamentos. O melhor caminho é a importação de fatura (em Prosperidade): ela expande parcelas e evita duplicatas com mais precisão.",
          };
        }
        return {
          items: normalizeStatementItems(raw),
          note: sInp.note ? String(sInp.note).slice(0, 240) : null,
        };
      } catch (e) {
        console.error("chat-fatura", e);
        return { items: [], note: null };
      }
    })();
    // deno-lint-ignore no-explicit-any
    const blocks = ((mainData as any).content ?? []) as any[];
    let reply = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

    // Plano proposto pelo modelo (o app pede confirmação antes de salvar)
    type Plan = { title: string; kind: string; pillar: string | null; content: string; daily_calories_kcal: number | null; daily_protein_g: number | null; weekly_workouts: number | null; sleep_hours_target: number | null; daily_spend_limit: number | null };
    let plan: Plan | null = null;
    const inRange = (v: unknown, lo: number, hi: number) => {
      const n = Number(v);
      return n >= lo && n <= hi ? Math.round(n * 10) / 10 : null;
    };
    // deno-lint-ignore no-explicit-any
    const normalizePlanInput = (inp: any): Plan | null => {
      if (!inp?.title || !inp?.content_markdown) return null;
      return {
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
    };
    // Rede de segurança: se o modelo esqueceu a meta esperada pelo tipo,
    // uma extração rápida lê o próprio texto do plano. Falha aqui não derruba nada.
    const fillMissingGoals = async (p: Plan) => {
      const needsKcal = p.kind === "alimentar" && !p.daily_calories_kcal;
      const needsWorkouts = p.kind === "treino" && !p.weekly_workouts;
      if (!needsKcal && !needsWorkouts) return;
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
              messages: [{ role: "user", content: `Extraia as metas deste plano:\n\n${p.content.slice(0, 6000)}` }],
          });
          if (r.ok && gd) {
            // deno-lint-ignore no-explicit-any
            const tu = ((gd as any).content ?? []).find((b: any) => b.type === "tool_use");
            const gi = tu?.input ?? {};
            p.daily_calories_kcal = p.daily_calories_kcal ?? inRange(gi.daily_calories_kcal, 800, 8000);
            p.daily_protein_g = p.daily_protein_g ?? inRange(gi.daily_protein_g, 20, 400);
            p.weekly_workouts = p.weekly_workouts ?? inRange(gi.weekly_workouts, 1, 14);
            p.sleep_hours_target = p.sleep_hours_target ?? inRange(gi.sleep_hours_target, 4, 12);
            p.daily_spend_limit = p.daily_spend_limit ?? inRange(gi.daily_spend_limit, 1, 100000);
          }
        } catch { /* segue sem metas extras */ }
    };

    const planBlock = blocks.find((b) => b.type === "tool_use" && b.name === "registrar_plano");
    plan = normalizePlanInput(planBlock?.input);
    if (plan) {
      await fillMissingGoals(plan);
      if (!reply) {
        // O modelo usou só a ferramenta: gera uma confirmação curta em vez de
        // salvar um balão vazio (plano §3.3).
        reply = `Seu plano "${plan.title}" está pronto. Veja o cartão abaixo para revisar, pedir ajustes ou salvar em Meus planos.`;
      }
    }

    // ── Rede de segurança: prometeu plano mas NÃO chamou registrar_plano ──
    // Caso real: "Vou assumir recomposição... Gerando agora." e o turno acabou
    // sem plano — a pessoa pagou uma mensagem por um anúncio. Detecta a
    // promessa e força a geração AINDA NESTE request, com tool_choice
    // obrigatório em registrar_plano. Falha aqui não derruba a resposta:
    // no pior caso a promessa vira um aviso honesto de como obter o plano.
    const promisedPlan = !plan && !reply.trim().endsWith("?") &&
      /\b(gerando( o plano)?( agora)?|vou (montar|gerar|criar)|montando (o |seu )?plano|(gero|monto|crio|entrego) [^.!?]{0,40}?(plano|treino|dieta|or[çc]amento)|pr[óo]xima mensagem)\b/i.test(reply);
    if (promisedPlan) {
      try {
        const { res: r2, data: d2 } = await anthropicCall(supabase, user.id, "chat-plano-forcado", {
          model: MODEL_SMART,
          max_tokens: 4000,
          system: [
            { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
            { type: "text", text: snapshot },
          ],
          tools: [SAVE_PLAN_TOOL],
          tool_choice: { type: "tool", name: "registrar_plano" },
          messages: [
            ...messages,
            { role: "assistant", content: reply },
            {
              role: "user",
              content: 'Gere AGORA o plano completo que você acabou de prometer, chamando registrar_plano com o content_markdown completo e autossuficiente, no formato obrigatório do app. Se algum dado secundário estiver faltando, comece com a seção "Premissas que assumi". Não faça nenhuma pergunta.',
            },
          ],
        });
        if (r2.ok && d2) {
          // deno-lint-ignore no-explicit-any
          const tu2 = ((d2 as any).content ?? []).find((b: any) => b.type === "tool_use" && b.name === "registrar_plano");
          const forced = normalizePlanInput(tu2?.input);
          if (forced) {
            plan = forced;
            await fillMissingGoals(plan);
            reply = `${reply}\n\nPronto: o plano completo está no cartão abaixo. Revise, peça ajustes ou salve em Meus planos.`;
          }
        }
      } catch (e) {
        console.error("chat-plano-forcado", e);
      }
      if (!plan) {
        // A geração forçada também falhou: melhor um aviso honesto no
        // histórico do que uma promessa vazia.
        reply = `${reply}\n\nNão consegui concluir a geração do plano agora. Me peça de novo com "gere o plano" que eu entrego direto, sem novas perguntas.`;
      }
    }

    // Compromissos diários propostos: cartão de escolha no app, nada é
    // criado automaticamente. Hábito imposto é a "régua genérica" que o
    // posicionamento condena — aqui eles nascem da meta da pessoa.
    const VALID_PILLARS = ["prosperidade", "vitalidade", "alimentacao", "mente"];
    const habitsBlock = blocks.find((b) => b.type === "tool_use" && b.name === "propor_habitos");
    // deno-lint-ignore no-explicit-any
    const rawHabits = (habitsBlock?.input as any)?.habits;
    const seenNames = new Set<string>();
    // deno-lint-ignore no-explicit-any
    const habitProposal = (Array.isArray(rawHabits) ? rawHabits : []).flatMap((h: any) => {
      const name = String(h?.name ?? "").trim().slice(0, 60);
      const pillar = VALID_PILLARS.includes(h?.pillar) ? String(h.pillar) : null;
      const key = name.toLowerCase();
      if (name.length < 3 || !pillar || seenNames.has(key)) return [];
      seenNames.add(key);
      return [{ name, pillar, why: h?.why ? String(h.why).slice(0, 140) : null }];
    }).slice(0, 3);

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

    // Nunca salvar mensagem do assistente sem conteúdo (plano §3.3):
    // • ferramenta usada sem texto → confirmação curta;
    // • nem texto nem ação → erro recuperável, nada é gravado.
    if (!reply && profileSuggestion) {
      reply = "Anotei! Veja o cartão abaixo para confirmar o que quer guardar no seu perfil.";
    }
    if (!reply && habitProposal.length) {
      reply = "Pensei em compromissos diários a partir da sua meta — escolha no cartão abaixo quais fazem sentido para você.";
    }
    if (!reply.trim()) {
      await refundAll();
      return json({
        error: "O Conselheiro não conseguiu formular uma resposta agora. Tente reformular ou enviar de novo.",
        recoverable: true,
      }, 502);
    }

    const { error: insertErr } = await supabase.from("chat_messages").insert([
      { user_id: user.id, role: "user", content: attNames.length ? `${message}\n📎 ${attNames.join(", ")}` : message },
      { user_id: user.id, role: "assistant", content: reply },
    ]);
    if (insertErr) console.error("chat_messages insert", insertErr);
    chatConsumed = true; // daqui pra frente a mensagem foi entregue: cota é devida

    const [{ events: captured, learned }, statement] = await Promise.all([extractPromise, statementPromise]);
    return json({
      reply, captured, plan, profile_suggestion: profileSuggestion, learned,
      habit_proposal: habitProposal.length ? habitProposal : null,
      statement_items: statement.items.length ? statement.items : null,
      statement_note: statement.note,
    });
  } catch (e) {
    // Erro inesperado (rede, banco): devolve o que foi reservado antes de sair.
    await refundAll().catch((err) => console.error("refundAll", err));
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});