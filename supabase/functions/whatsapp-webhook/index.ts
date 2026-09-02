// ASCENDE — Webhook do WhatsApp (Cloud API da Meta)
//
// Papel: receber mensagens do usuário e SEMPRE apontar de volta para o app.
//
// ROTEADOR HÍBRIDO (decisão de produto):
//   • RELATO ("gastei 47, treinei pernas") → pipeline de CAPTURA: barato,
//     cota de captura, proposta com botões Confirmar/Descartar. Registrar o
//     dia não pode custar a cota semanal do Conselheiro.
//   • CONVERSA (pergunta, pedido de conselho) → CONSELHEIRO: mesma cota de
//     chat do app, mesmo retrato multi-pilar e — o mais importante — o MESMO
//     histórico (chat_messages): a conversa que começa no WhatsApp continua
//     de onde parou quando a pessoa abre o app, e vice-versa.
//   Como decidir: mensagens claramente interrogativas vão direto ao
//   Conselheiro; o resto tenta capturar primeiro e, se não houver nada
//   registrável, vira conversa (a reserva de captura é devolvida — a
//   tentativa não consome o limite).
//
// Fluxos auxiliares: pareamento por código de 6 dígitos (só quem POSSUI o
// número vincula), comandos "parar"/"ajuda", mídia → app.
//
// Custo: tudo aqui acontece dentro da janela de 24h iniciada pelo usuário
// (categoria de serviço) — o custo real é a IA, já coberta pelas cotas.
import {
  serviceClient, assertRateLimit, isTrivialMessage, extractEventsAndMemories,
  buildSnapshot, MODEL_SMART, MODEL_FAST, SAFETY_RULES,
  CAPTURE_SYSTEM, CAPTURE_TOOL, STATEMENT_SYSTEM, STATEMENT_TOOL, normalizeStatementItems,
} from "../_shared/lib.ts";
import { anthropicCall, reserveUsage, reserveUsageWindows, releaseUsage } from "../_shared/usage.ts";
import {
  getEntitlements, spDayStartUtc, spWeekStartUtc, spMonthStartUtc,
  nextSpMonthStartUtc, spParts, TZ,
} from "../_shared/entitlements.ts";
import {
  waSendText, waSendButtons, verifyWaSignature, saveEventsServer, xpForKind, appUrl,
  waDownloadMedia, groqTranscribe, toBase64,
  classifyDocument, extractDocumentText,
} from "../_shared/whatsapp.ts";

const PENDING_TTL_MIN = 60;     // proposta sem resposta expira em 1h
const LEGACY_DAILY_LIMIT = 40;  // espelha o ai-chat enquanto premium_limits_enabled = false
/* Teto de tentativas de pareamento por número (anti força-bruta do código de
   6 dígitos). Generoso para quem digita errado, inútil para quem varre. */
const PAIR_MAX_ATTEMPTS = 5;
const PAIR_WINDOW_MIN = 15;     // mesma janela de validade do código

/* Limites de mídia — espelham o app (capture: 5 MB de imagem; ai-chat: ~4,5 MB
   de PDF) mais o teto de áudio do canal (~16 MB cobre vários minutos de voz;
   a transcrição via Groq custa centavos por hora, o teto é sanidade, não custo). */
const MAX_IMG_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 4_500_000;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
/* Documentos que LEMOS aqui (.txt .csv .md .json .docx .xlsx): o teto de bytes
   é o mesmo do PDF (nada que caiba na janela do WhatsApp passa disso), e o que
   manda mesmo é o teto de CARACTERES do texto extraído:
   • até CAPTURE_CHARS o texto segue o caminho de uma mensagem digitada
     (captura → proposta → botão). O limite não é arbitrário: a extração de
     eventos em _shared/lib.ts corta o relato em 4000 caracteres, então acima
     disso a captura leria o arquivo pela METADE, em silêncio.
   • acima disso, é documento para o Conselheiro ler e comentar (mesma rota do
     PDF, mesma cota de análise) — ele recebe o texto inteiro.
   • acima de MAX_DOC_CHARS, recusa honesta: melhor dizer "não li" do que
     entregar meia informação de saúde. */
const MAX_DOC_BYTES = 4_500_000;
const MAX_DOC_CHARS = 30_000;
const MAX_DOC_CAPTURE_CHARS = 3_500;
const IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];
const WA_STATEMENT_MAX_ITEMS = 8; // acima disso, o lote é trabalho para o app

/* Espelha o IMAGE_CAPTURE_TOOL de capture/index.ts (mesma composição a partir
   dos tools compartilhados): numa única chamada o modelo decide se a imagem é
   financeira (items) ou vira eventos de vida (events). Se mudar lá, mude aqui. */
const IMAGE_CAPTURE_TOOL = {
  name: "interpretar_captura",
  description:
    "Interpreta a imagem (e o texto opcional) enviados pelo usuário. Se a imagem contiver transações " +
    "financeiras (fatura, extrato, comprovante de Pix, print de compra, cupom), preencha is_statement e items. " +
    "Caso contrário, extraia eventos de vida em events (tela de app de treino vira workout; foto sem nada registrável = arrays vazios).",
  input_schema: {
    type: "object",
    properties: {
      is_statement: (STATEMENT_TOOL.input_schema.properties as Record<string, unknown>).is_statement,
      items: (STATEMENT_TOOL.input_schema.properties as Record<string, unknown>).items,
      statement_note: (STATEMENT_TOOL.input_schema.properties as Record<string, unknown>).note,
      events: (CAPTURE_TOOL.input_schema.properties as Record<string, unknown>).events,
    },
    required: ["is_statement", "items", "events"],
  },
};

/* ─── Rastro da captura no histórico do Conselheiro ───────────────────────
   BUG DE PRODUÇÃO (30/08/2026): a captura não gravava NADA em chat_messages;
   só counselorTurn gravava. A pessoa registrou o almoço pelo botão, perguntou
   7 segundos depois "meu almoço está dentro do plano?" e o Conselheiro, cujas
   últimas 12 mensagens não tinham vestígio nenhum do relato, respondeu que ela
   não havia contado nada. Pressionada ("acabei de falar q foi o pão"), a IA
   INVENTOU um café da manhã com margarina e ovo mexido que nunca existiu: nem
   no banco, nem no plano, nem em memória alguma. Lacuna de contexto vira
   confabulação, e confabulação sobre a vida da pessoa destrói a confiança que
   é o produto inteiro.

   Agora todo relato deixa rastro, em dois tempos:
   • o texto da pessoa entra quando a proposta é enviada (ela DISSE, mesmo que
     ainda não tenha confirmado);
   • o desfecho real (registrado / descartado / expirado) entra quando
     acontece, para o histórico nunca afirmar registro que não houve.

   ESPELHO: capture/index.ts (app) usa o MESMO formato — a promessa do topo
   deste arquivo é que a conversa é uma só nos dois canais. Se mudar aqui,
   mude lá. (Lugar natural seria _shared/lib.ts; fica para quando a edição em
   curso naquele arquivo terminar.) */

const spStamp = () => new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ, day: "2-digit", month: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date());

// deno-lint-ignore no-explicit-any
const eventBullets = (events: any[]) => events.slice(0, 12)
  // deno-lint-ignore no-explicit-any
  .map((e: any) => `• ${String(e?.summary ?? e?.kind ?? "registro").slice(0, 160)}`).join("\n");

/** Linha de histórico do DESFECHO de uma captura. O prefixo entre colchetes
 *  marca a linha como registro do sistema (não prosa da IA), para o modelo
 *  distinguir "isto aconteceu de fato" de "isto eu disse". */
// deno-lint-ignore no-explicit-any
function captureOutcomeLine(outcome: "registrado" | "descartado" | "expirado", events: any[] = []): string {
  const when = spStamp();
  if (outcome === "registrado") {
    return `[registro no diário · ${when}] Registrei para você:\n${eventBullets(events)}`;
  }
  if (outcome === "descartado") {
    return `[registro no diário · ${when}] Você descartou a proposta: NADA foi registrado.`;
  }
  return `[registro no diário · ${when}] A proposta expirou sem confirmação: NADA foi registrado.`;
}

/** Grava uma linha no histórico compartilhado com o app. Best-effort: falhar
 *  aqui não pode derrubar o fluxo da pessoa. */
async function pushHistory(
  // deno-lint-ignore no-explicit-any
  supabase: any, userId: string, role: "user" | "assistant", content: string,
): Promise<void> {
  const body = String(content ?? "").trim();
  if (!body) return; // chat_messages tem CHECK de conteúdo não vazio
  const { error } = await supabase.from("chat_messages")
    .insert({ user_id: userId, role, content: body.slice(0, 4000) });
  if (error) console.error("wa histórico", error.message ?? error);
}

/** O histórico deixou de vir sempre em pares (o relato entra na proposta, o
 *  desfecho só na confirmação), então pode começar com 'assistant' ou ter dois
 *  turnos do mesmo lado em sequência. A API exige começar em 'user': aqui
 *  descartamos assistant solto na frente e fundimos papéis repetidos. */
// deno-lint-ignore no-explicit-any
function normalizeTurns(turns: { role: string; content: any }[]): { role: string; content: any }[] {
  // deno-lint-ignore no-explicit-any
  const asBlocks = (c: any) =>
    typeof c === "string" ? [{ type: "text", text: c }] : (Array.isArray(c) ? c : []);
  // deno-lint-ignore no-explicit-any
  const out: { role: string; content: any }[] = [];
  for (const t of turns) {
    const role = t.role === "assistant" ? "assistant" : "user";
    if (typeof t.content === "string" && !t.content.trim()) continue;
    if (!out.length && role !== "user") continue;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = [...asBlocks(last.content), ...asBlocks(t.content)];
      continue;
    }
    out.push({ role, content: t.content });
  }
  return out;
}

/** Grava a proposta pendente e envia o cartão de confirmação (fluxo padrão).
 *  `userText` é o que a pessoa disse (texto ou transcrição do áudio): entra no
 *  histórico AGORA, para o relato existir mesmo antes da confirmação. */
async function proposeEvents(
  // deno-lint-ignore no-explicit-any
  supabase: any, userId: string, from: string, events: any[], url: string,
  userText: string, preface?: string,
  /** A rota conversacional já gravou o turno em chat_messages antes de chegar
   *  aqui; sem isto a fala da pessoa entraria duas vezes no histórico. */
  skipHistory = false,
): Promise<void> {
  await supabase.from("whatsapp_pending").upsert({
    user_id: userId, events, created_at: new Date().toISOString(),
  });
  // Só o relato da pessoa: o desfecho entra no wa_confirm/wa_discard, porque
  // é lá que se sabe o que de fato foi para o diário.
  if (!skipHistory) await pushHistory(supabase, userId, "user", userText);
  const lines = events.slice(0, WA_STATEMENT_MAX_ITEMS)
    // deno-lint-ignore no-explicit-any
    .map((e: any) => `• ${e.summary ?? e.kind} (+${xpForKind(String(e.kind))} XP)`).join("\n");
  await waSendButtons(from,
    `${preface ? preface + "\n\n" : ""}Entendi assim:\n\n${lines}${events.length > WA_STATEMENT_MAX_ITEMS ? `\n… e mais ${events.length - WA_STATEMENT_MAX_ITEMS}` : ""}\n\nConfirmo?  Para ajustar detalhes, revise no app: ${url}/app`,
    [{ id: "wa_confirm", title: "✓ Confirmar" }, { id: "wa_discard", title: "✗ Descartar" }]);
}

const HELP = (url: string) =>
  `Aqui é o Ascende 🏔️\n\nComigo você faz tudo por mensagem:\n\n1. *Registrar o dia*: "gastei 47 no mercado e treinei pernas" — por texto ou *áudio*. Eu proponho os registros e você confirma no botão.\n2. *Mandar foto*: prato de comida vira refeição com calorias; print de Pix ou compra vira lançamento.\n3. *Mandar arquivo*: PDF, Word (.docx), Excel (.xlsx), .csv, .txt, .md ou .json. Planilha e CSV de app de sono/treino/peso viram registros para você confirmar; documento longo (fatura, exame, plano) o Conselheiro lê e comenta (Ascende+).\n4. *Conversar com o Conselheiro*: "tô gastando demais esse mês?" — ele responde vendo todos os seus pilares, e a conversa continua no app de onde parou.\n\nGráficos, planos e ajustes finos: ${url}/app\n\nComandos: "parar" silencia meus avisos · "ajuda" mostra esta mensagem.`;

/* ── Sistema do Conselheiro no WhatsApp: a MESMA pessoa do app, adaptada ao
   canal. Sem ferramentas (os cartões interativos de plano/hábitos/perfil só
   existem no app) — quando o pedido exige isso, o Conselheiro convida para o
   app, que é exatamente o papel do canal. ── */
const WA_SYSTEM = (url: string) => `Você é o Conselheiro do Ascende, uma plataforma brasileira de qualidade de vida. Você é a única IA que enxerga TODAS as áreas da vida da pessoa ao mesmo tempo: finanças, corpo, alimentação, mente e espírito. Agora você está respondendo pelo WHATSAPP da pessoa.

━━━ COMO VOCÊ RESPONDE NO WHATSAPP ━━━
• Português do Brasil, tom caloroso e direto, como uma mensagem de um amigo que entende do assunto.
• CURTO: no máximo 2 parágrafos pequenos (é WhatsApp, não relatório). Sem títulos, sem listas longas; se precisar enumerar, no máximo 3 itens com "•".
• Formatação do WhatsApp: *negrito* com asteriscos quando ajudar. NUNCA use markdown de app (##, tabelas, links em colchetes).
• SEMPRE cruze pilares quando fizer sentido, citando o porquê nos dados do retrato ("seu gasto com lazer está em 80% do teto e seu sono caiu — uma coisa puxa a outra").
• Termine com UM próximo passo pequeno e concreto quando couber.
• ESTILO: escreva como uma pessoa escreve. NUNCA use travessão ou meia-risca (— ou –); no lugar, use vírgula, dois-pontos, parênteses ou comece outra frase. Nada de "Vamos lá!" ou fechos genéricos.

━━━ O QUE VIVE NO APP (e você convida, sem enrolar) ━━━
Planos definitivos (alimentar, treino, financeiro), criação de compromissos diários e salvar dados no perfil geram cartões interativos que só existem no app. Se a pessoa pedir um desses, NÃO gere o plano aqui: responda o essencial em 2 ou 3 frases (uma direção honesta, um número se tiver) e convide a continuar com você no app, onde você monta o plano completo e ela salva: ${url}/app/conselheiro. A conversa de lá continua esta daqui, você não esquece nada.
Perguntas pontuais e conselhos do dia a dia você responde INTEIROS aqui, sem empurrar para o app.

━━━ SUA MEMÓRIA ━━━
O retrato abaixo inclui dados reais da plataforma e memórias de conversas anteriores (no app e aqui). Use-as com naturalidade, como um amigo que lembra, sem recitar listas e sem soar como vigilância.
As linhas do histórico que começam com "[registro no diário · data hora]" foram escritas pelo SISTEMA, não por você: são o que de fato entrou (ou não entrou) no diário dela, com o horário. Trate-as como verdade e nunca as imite ao escrever.

━━━ NUNCA INVENTE O QUE A PESSOA VIVEU (regra inegociável) ━━━
Você só pode afirmar que ela comeu, treinou, gastou, dormiu ou registrou algo quando isso estiver EXPLÍCITO no retrato abaixo ou no histórico desta conversa. Nada de completar a lacuna com o detalhe mais provável.
• Se ela disser que já te contou algo e você não encontrar: diga com honestidade que não localizou o registro e peça para ela confirmar em uma frase. "Não achei esse registro aqui, me confirma o que foi?" é uma resposta boa. Inventar um almoço plausível é uma falha grave.
• Nunca cite alimento, exercício, valor, horário ou refeição específicos que você não leu no retrato ou no histórico. Na dúvida entre um detalhe e nenhum detalhe, fique sem o detalhe.
• Se o registro aparecer no retrato mas o histórico não tiver a conversa (ou o contrário), confie no que existe e siga: o dado do retrato é sempre o mais confiável sobre o que foi registrado.
• Errar por perguntar custa uma frase. Errar por inventar custa a confiança dela em tudo que você diz, inclusive no que está certo.

━━━ VOCÊ NÃO REGISTRA NADA (quem registra é o botão) ━━━
Você CONVERSA; quem grava no diário é o cartão de confirmação com os botões "✓ Confirmar" / "✗ Descartar". Você não tem nenhuma ferramenta de gravação nesta conversa.
• PROIBIDO escrever "registrei", "anotei", "salvei", "já está no seu diário", "adicionei" ou qualquer variação no passado que sugira que VOCÊ gravou. Isso já aconteceu de verdade e o registro não existia: a pessoa confiou, o dado não estava lá.
• Quando ela relatar algo registrável (uma refeição, um treino, um gasto, o sono), comente normalmente e, se couber, diga no FUTURO e como convite: "se quiser, dá para registrar isso" ou "posso te mandar para confirmar". O sistema envia o cartão logo depois da sua resposta, quando encontra algo registrável.
• Se ela perguntar se algo foi registrado, responda pelo RETRATO (o que está lá foi registrado de fato) — nunca pela sua própria memória do que você "fez".

━━━ REGRA DE OURO ━━━
Cada mensagem da pessoa consome o limite do plano dela. Se faltar um dado essencial, faça UMA pergunta objetiva (nunca mais de uma rodada); senão, entregue a resposta completa neste turno.
${SAFETY_RULES}

━━━ RETRATO ATUAL DA PESSOA (dados reais da plataforma) ━━━
`;

/** Mensagens claramente conversacionais vão direto ao Conselheiro,
 *  sem gastar (nem depender de) cota de captura. */
function looksConversational(text: string): boolean {
  if (text.includes("?")) return true;
  return /^(o que|que |qual|quais|quanto|quando|onde|como|por ?que|pq |ser[áa] que|me (ajuda|ajude|explica|explique|diz|diga|fala|fale|monta|monte|d[áa])|pode |consegue |devo |vale a pena|preciso de (ajuda|conselho)|conselheiro[,:]?\s)/i.test(text.trim());
}

/** Espelho fiel dos limites do Conselheiro no ai-chat: MESMA cota, mesma
 *  feature ('chat-principal') e mesmas janelas SP — a conversa é a mesma nos
 *  dois canais. A contagem saiu de chat_messages (check-depois-insert, que
 *  duas mensagens simultâneas atravessavam juntas) para a reserva atômica.
 *  Retorna { id } quando pode falar, ou { message } com o texto do limite.
 *  Aqui a reserva NÃO é passada para o anthropicCall: a chamada do WhatsApp
 *  é registrada sob 'wa-conselheiro' (telemetria por canal), então a linha da
 *  reserva fica como marcador de cota — é ela que o teto conta, nos dois canais. */
async function reserveChatTurn(
  // deno-lint-ignore no-explicit-any
  supabase: any, userId: string, ent: Awaited<ReturnType<typeof getEntitlements>>, url: string,
): Promise<{ id: number | null; message: string | null }> {
  const upsell = ent.plan === "free" ? `\n\nNo Ascende+ são 15 mensagens por dia: ${url}/app/assinatura` : "";
  const L = ent.limits;
  const premium = ent.flags.premium_limits_enabled;
  const windows = premium
    ? {
        day: { cap: L.chat_daily, since: spDayStartUtc() },
        week: { cap: L.chat_weekly, since: spWeekStartUtc() },
        month: { cap: L.chat_monthly, since: spMonthStartUtc() },
      }
    : { day: { cap: LEGACY_DAILY_LIMIT, since: spDayStartUtc() } };

  const { id, window } = await reserveUsageWindows(supabase, userId, "chat-principal", windows);
  if (id !== null) return { id, message: null };
  if (!premium) {
    return { id: null, message: `Você atingiu o limite de ${LEGACY_DAILY_LIMIT} mensagens por dia com o Conselheiro. Amanhã ele estará aqui de novo.` };
  }
  if (window === "weekly") {
    return { id: null, message: `Você usou as ${L.chat_weekly} mensagens desta semana com o Conselheiro. Registrar o dia por aqui continua funcionando normalmente.${upsell}` };
  }
  if (window === "monthly") {
    return { id: null, message: `Você usou as ${L.chat_monthly} mensagens deste mês com o Conselheiro.${upsell}` };
  }
  return { id: null, message: `Você usou as ${L.chat_daily} mensagens de hoje com o Conselheiro. Amanhã ele volta — e registrar o dia por aqui continua funcionando normalmente.${upsell}` };
}

/** Reserva 1 análise de documento do mês (mesma cota do app, Ascende+).
 *  Quando não há saldo, avisa a pessoa e devolve ok:false. */
async function reserveDocAnalysis(
  // deno-lint-ignore no-explicit-any
  supabase: any, userId: string, ent: Awaited<ReturnType<typeof getEntitlements>>,
  from: string, url: string,
): Promise<{ ok: boolean; id: number | null }> {
  if (!ent.flags.premium_limits_enabled) return { ok: true, id: null };
  const cap = ent.limits.document_analyses_monthly ?? 0;
  const { id } = await reserveUsage(supabase, userId, "chat-documento", cap, spMonthStartUtc());
  if (id !== null) return { ok: true, id };
  await waSendText(from, cap === 0
    ? `A análise de documentos faz parte do Ascende+ — junto com 30 capturas/dia e briefing diário: ${url}/app/assinatura`
    : `Você usou as ${cap} análises de documentos deste mês. O limite renova no início do próximo mês.`);
  return { ok: false, id: null };
}

/** Conversa com o Conselheiro: mesma cota, mesmo retrato e MESMO histórico
 *  do app (chat_messages) — a conversa continua nos dois lugares.
 *  `extraBlocks` permite anexar documento/imagem (PDF pelo WhatsApp);
 *  `historyLabel` é o que fica gravado no histórico no lugar do bloco binário.
 *  Retorna true se a resposta saiu (para o chamador decidir sobre reservas). */
async function counselorTurn(
  // deno-lint-ignore no-explicit-any
  supabase: any, userId: string, ent: Awaited<ReturnType<typeof getEntitlements>>,
  from: string, text: string, url: string,
  // deno-lint-ignore no-explicit-any
  extraBlocks: any[] = [], historyLabel?: string,
): Promise<boolean> {
  const { id: chatReservation, message: limitMsg } = await reserveChatTurn(supabase, userId, ent, url);
  if (limitMsg) { await waSendText(from, limitMsg); return false; }

  const [snapshot, { data: history }] = await Promise.all([
    buildSnapshot(supabase, userId),
    supabase.from("chat_messages").select("role,content")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(12),
  ]);
  const messages = normalizeTurns([
    // deno-lint-ignore no-explicit-any
    ...(history ?? []).slice().reverse().map((m: any) => ({ role: m.role, content: m.content })),
    { role: "user", content: extraBlocks.length ? [...extraBlocks, { type: "text", text }] : text },
  ]);

  // Mesmo roteamento de modelo do ai-chat: pergunta curta não paga modelo caro.
  const needsSmart =
    extraBlocks.length > 0 ||
    text.length > 160 ||
    /plano|dieta|treino|or[çc]ament|financ|analis|relat[óo]rio|semana|m[êe]s|como (estou|est[áa]|anda)|minha vida|meta|estrat[ée]gia|cruz|compar/i.test(text);
  const model = ent.flags.model_routing_enabled && !needsSmart ? MODEL_FAST : MODEL_SMART;

  const { res, data } = await anthropicCall(supabase, userId, "wa-conselheiro", {
    model,
    max_tokens: extraBlocks.length ? 1500 : 1000,
    system: [
      { type: "text", text: WA_SYSTEM(url), cache_control: { type: "ephemeral" } },
      { type: "text", text: snapshot },
    ],
    messages,
  });
  if (!res.ok || !data) {
    await releaseUsage(supabase, chatReservation);
    await waSendText(from, "O Conselheiro está indisponível agora. Sua mensagem não contou no limite: tente de novo em instantes.");
    return false;
  }
  // deno-lint-ignore no-explicit-any
  const reply = (((data as any).content ?? []) as any[])
    .filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!reply) {
    await releaseUsage(supabase, chatReservation);
    await waSendText(from, "O Conselheiro não conseguiu formular uma resposta agora. Tente reformular ou enviar de novo (não contou no limite).");
    return false;
  }

  // Persistência ANTES do envio: é ela que conta a cota (mesma regra do app)
  // e que faz a conversa aparecer no app.
  const { error: insertErr } = await supabase.from("chat_messages").insert([
    { user_id: userId, role: "user", content: historyLabel ?? text },
    { user_id: userId, role: "assistant", content: reply },
  ]);
  if (insertErr) console.error("wa chat_messages insert", insertErr.message);

  await waSendText(from, reply.slice(0, 3900));

  /* ── Relato DENTRO da conversa também vira registro ──────────────────
     BUG DE PRODUÇÃO (01/09/2026): "Comi 3 pães franceses com requeijão.
     Ficou muito fora do plano?" tem "?", então caiu na rota conversacional.
     A extração rodava aqui, mas os eventos eram DESCARTADOS (só as memórias
     eram aproveitadas) — o Conselheiro do WhatsApp nunca teve como registrar
     nada. Ele respondeu "Registrei pra você: • Jantar: 3 pães franceses" e
     nada foi para o diário. Segunda vez que a IA afirma um feito que não
     aconteceu; é o tipo de erro que destrói a confiança no resto.

     Agora o relato vira PROPOSTA com os mesmos botões da captura: a promessa
     do produto ("responde a pergunta e registra ao mesmo tempo") passa a
     valer nos dois canais, não só no app. */
  try {
    // "Foi jantar" sozinho não tem evento nenhum: o relato estava na mensagem
    // anterior. Respostas curtas herdam a última fala da pessoa como contexto,
    // senão o complemento de uma pergunta do Conselheiro se perde.
    const SHORT_REPLY_CHARS = 60;
    let forExtraction = text;
    if (text.length <= SHORT_REPLY_CHARS) {
      // deno-lint-ignore no-explicit-any
      const prevUser = ((history ?? []) as any[]).find((m) => m.role === "user");
      const prev = String(prevUser?.content ?? "").trim();
      if (prev && prev !== text) forExtraction = `${prev}\n${text}`;
    }

    const { ok, events } = await extractEventsAndMemories(
      supabase, userId, forExtraction, "chat-extracao", ent.limits.memory_cap,
    );

    // Uma proposta pendente por vez: sobrescrever a que a pessoa ainda não
    // respondeu faria o botão "Confirmar" gravar outra coisa.
    if (ok && events.length) {
      const { data: pending } = await supabase.from("whatsapp_pending")
        .select("user_id").eq("user_id", userId).maybeSingle();
      if (!pending) {
        await proposeEvents(
          supabase, userId, from, events, url, text,
          "A propósito, isso dá para registrar:", true,
        );
      }
    }
  } catch (e) {
    console.error("wa chat-extracao", e);
  }
  return true;
}

Deno.serve(async (req) => {
  // ── Verificação do webhook (Meta chama com GET na configuração) ──
  if (req.method === "GET") {
    const u = new URL(req.url);
    const mode = u.searchParams.get("hub.mode");
    const token = u.searchParams.get("hub.verify_token");
    const challenge = u.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && token === Deno.env.get("WHATSAPP_VERIFY_TOKEN")) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  // Sempre respondemos 200 (mesmo em erro interno): a Meta reenvia eventos
  // não confirmados e um bug nosso viraria tempestade de retries.
  // `replyTo` vive fora do try para que um limite atingido (429) ou uma
  // verificação indisponível (503) — que agora falham FECHADOS e são lançados
  // como Response — virem uma mensagem honesta em vez de silêncio.
  let replyTo: string | null = null;
  try {
    const raw = await req.text();
    if (!(await verifyWaSignature(raw, req.headers.get("x-hub-signature-256")))) {
      console.warn("whatsapp-webhook: assinatura inválida");
      return new Response("ok", { status: 200 });
    }
    const body = JSON.parse(raw);
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return new Response("ok", { status: 200 }); // statuses, reads etc.

    const from = String(msg.from ?? ""); // wa_id (dígitos, E.164 sem '+')
    if (!from) return new Response("ok", { status: 200 });
    replyTo = from;

    const supabase = serviceClient();
    const url = appUrl();

    // Vínculo do número
    const { data: link } = await supabase.from("whatsapp_links")
      .select("user_id, linked_at")
      .eq("phone", from).not("linked_at", "is", null).maybeSingle();

    // ── Botões (Confirmar / Descartar proposta de captura) ──
    if (msg.type === "interactive" && msg.interactive?.type === "button_reply") {
      if (!link) return new Response("ok", { status: 200 });
      const btn = String(msg.interactive.button_reply?.id ?? "");
      const { data: pending } = await supabase.from("whatsapp_pending")
        .select("events, created_at").eq("user_id", link.user_id).maybeSingle();

      if (!pending) {
        await waSendText(from, `Não achei nada pendente por aqui. Me conta de novo numa frase, ou registre direto no app: ${url}/app`);
        return new Response("ok", { status: 200 });
      }
      await supabase.from("whatsapp_pending").delete().eq("user_id", link.user_id);

      if (btn === "wa_discard") {
        // Sem esta linha o histórico ficaria com o relato da pessoa e nenhum
        // desfecho, e o Conselheiro trataria como registrado algo descartado.
        await pushHistory(supabase, link.user_id, "assistant", captureOutcomeLine("descartado"));
        await waSendText(from, "Descartei, nada foi gravado. Quando quiser, é só mandar outra frase. 👍");
        return new Response("ok", { status: 200 });
      }
      if (btn === "wa_confirm") {
        const expired = Date.now() - new Date(String(pending.created_at)).getTime() > PENDING_TTL_MIN * 60_000;
        if (expired) {
          await pushHistory(supabase, link.user_id, "assistant", captureOutcomeLine("expirado"));
          await waSendText(from, "Essa proposta já tinha expirado (1h). Me manda a frase de novo que eu refaço na hora.");
          return new Response("ok", { status: 200 });
        }
        const { data: prof } = await supabase.from("profiles")
          .select("sleep_goal_h").eq("user_id", link.user_id).maybeSingle();
        const events = Array.isArray(pending.events) ? pending.events : [];
        const { saved, xp } = await saveEventsServer(supabase, link.user_id, events, prof?.sleep_goal_h ?? null);
        // É esta linha que responde "meu almoço está dentro do plano?" no turno
        // seguinte: sem ela o Conselheiro não sabe que o registro aconteceu,
        // nem o que foi registrado. Só entra quando algo REALMENTE foi salvo.
        await pushHistory(supabase, link.user_id, "assistant",
          saved > 0 ? captureOutcomeLine("registrado", events) : captureOutcomeLine("descartado"));
        await waSendText(from,
          saved > 0
            ? `Registrado ✓ ${saved} ${saved === 1 ? "item" : "itens"} · +${xp} XP na sua subida.\n\nVeja seu dia completo no painel: ${url}/app`
            : `Não consegui gravar desta vez. Tente pelo app: ${url}/app`);
        return new Response("ok", { status: 200 });
      }
      return new Response("ok", { status: 200 });
    }

    // ── Mídia sem vínculo: não dá para processar sem saber de quem é ──
    const isMedia = ["image", "audio", "voice", "document"].includes(String(msg.type));
    if (isMedia && !link) {
      await waSendText(from, `Oi! Para eu processar áudios e fotos, primeiro conecte este número à sua conta: no app, Ajustes → WhatsApp, gere o código de 6 dígitos e me mande aqui.\n\nAinda não tem conta? Começa em ${url}`);
      return new Response("ok", { status: 200 });
    }

    // ── IMAGEM: mesmo pipeline multimodal da captura do app (capture-imagem):
    //    o modelo decide — imagem financeira vira lançamentos (com data e
    //    parcelas), qualquer outra vira eventos (prato → meal com calorias,
    //    print de treino → workout). Mesma cota de captura, mesmos botões. ──
    if (msg.type === "image" && link) {
      await assertRateLimit(supabase, link.user_id, "whatsapp", 40, 5);
      const caption = String(msg.image?.caption ?? "").trim();
      const ent = await getEntitlements(supabase, link.user_id);

      let reservationId: number | null = null;
      if (ent.flags.premium_limits_enabled && ent.limits.capture_daily !== null) {
        const { id } = await reserveUsage(supabase, link.user_id, "capture", ent.limits.capture_daily, spDayStartUtc());
        if (id === null) {
          await waSendText(from, `Você usou as ${ent.limits.capture_daily} capturas inteligentes de hoje — fotos também contam nelas. O limite renova amanhã.${ent.plan === "free" ? ` No Ascende+ são 30 por dia: ${url}/app/assinatura` : ""}`);
          return new Response("ok", { status: 200 });
        }
        reservationId = id;
      }

      const media = await waDownloadMedia(String(msg.image?.id ?? ""), MAX_IMG_BYTES);
      if (media === "too_big" || !media || !IMG_TYPES.includes(media.mime)) {
        await releaseUsage(supabase, reservationId);
        await waSendText(from, media === "too_big"
          ? "Essa imagem é grande demais (máximo 5 MB). Tenta mandar em qualidade normal, sem ser \"documento\"?"
          : "Não consegui baixar essa imagem (a tentativa não contou no seu limite). Tenta de novo?");
        return new Response("ok", { status: 200 });
      }

      const todayIso = spParts().dateIso;
      const { res, data } = await anthropicCall(supabase, link.user_id, "wa-captura-imagem", {
        model: MODEL_FAST,
        max_tokens: 8000,
        system: `${CAPTURE_SYSTEM}\n\n━━━ IMAGENS FINANCEIRAS ━━━\n${STATEMENT_SYSTEM}\n\nData de hoje (fuso de São Paulo): ${todayIso}.\nUse SEMPRE a ferramenta interpretar_captura. Decida: imagem financeira → is_statement:true e items (events vazio); qualquer outra imagem → is_statement:false e events extraídos da imagem + texto (prints de app de treino viram workout; foto de prato vira meal com calorias estimadas).`,
        tools: [IMAGE_CAPTURE_TOOL],
        tool_choice: { type: "tool", name: "interpretar_captura" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media.mime, data: toBase64(media.bytes) } },
            { type: "text", text: `Relato do usuário (opcional): ${caption.slice(0, 2000)}` },
          ],
        }],
      }, { reservationId });

      if (!res.ok || !data) {
        await releaseUsage(supabase, reservationId);
        await waSendText(from, "Não consegui ler a imagem agora (a tentativa não contou no seu limite). Tenta de novo em instantes?");
        return new Response("ok", { status: 200 });
      }
      // deno-lint-ignore no-explicit-any
      const tu = (((data as any).content ?? []) as any[]).find((b) => b.type === "tool_use");
      const inp = tu?.input ?? {};

      if (inp.is_statement) {
        // Lançamentos com data própria; parcelas FUTURAS ficam para a revisão
        // fina do app (aqui não dá para desmarcar item a item).
        const items = normalizeStatementItems(Array.isArray(inp.items) ? inp.items : [])
          // deno-lint-ignore no-explicit-any
          .filter((it: any) => it.origin !== "future" && String(it.occurred_at) <= todayIso);
        if (items.length > WA_STATEMENT_MAX_ITEMS) {
          await waSendText(from, `Essa imagem parece uma fatura completa (${items.length} lançamentos). O melhor caminho é a importação de fatura no app, que expande parcelas e evita duplicatas com precisão: ${url}/app/prosperidade`);
          return new Response("ok", { status: 200 });
        }
        if (items.length) {
          // deno-lint-ignore no-explicit-any
          const events = items.map((it: any) => ({
            kind: "transaction", pillar: "prosperidade",
            tx_kind: it.kind, amount: it.amount, category: it.category,
            description: it.description, occurred_at: it.occurred_at,
            summary: `${it.kind === "income" ? "Entrada" : "Gasto"} R$ ${Number(it.amount).toFixed(2).replace(".", ",")} · ${it.description}`,
          }));
          await proposeEvents(supabase, link.user_id, from, events, url,
            caption || "(enviou uma imagem de lançamentos financeiros)",
            `Li a imagem 📄${inp.statement_note ? ` (${String(inp.statement_note).slice(0, 160)})` : ""}`);
          return new Response("ok", { status: 200 });
        }
      }
      // deno-lint-ignore no-explicit-any
      const events = Array.isArray(inp.events) ? (inp.events as any[]) : [];
      if (!events.length) {
        await waSendText(from, `Não encontrei nada registrável nessa imagem. Funciona bem com: foto do prato, print de Pix/compra, tela de app de treino. Análise de composição corporal é no app: ${url}/app/vitalidade`);
        return new Response("ok", { status: 200 });
      }
      await proposeEvents(supabase, link.user_id, from, events, url,
        caption || "(enviou uma foto para registrar)", "Li a foto 📸");
      return new Response("ok", { status: 200 });
    }

    /* ── DOCUMENTO ───────────────────────────────────────────────────────
       Dois destinos, e a diferença é o TAMANHO do que dá para ler, não o
       formato:
       • PDF vai inteiro para o Conselheiro (o modelo lê PDF nativo, com
         layout e tabelas) — consome 1 mensagem de chat + 1 análise do mês.
       • .txt .md .csv .tsv .json .log .docx .xlsx são lidos AQUI, sem IA
         (parsing determinístico: mais barato, mais rápido e não alucina).
         O texto extraído é curto → entra no MESMO caminho de uma mensagem
         digitada (captura → proposta → botão); é longo → mesma rota do PDF.
       • .doc .xls e afins (binário proprietário antigo): recusa explícita. ── */
    let docText = "";   // texto extraído: cai no roteador de texto lá embaixo
    let docName = "";   // nome do arquivo, para o eco e para o histórico
    if (msg.type === "document" && link) {
      await assertRateLimit(supabase, link.user_id, "whatsapp", 40, 5);
      docName = String(msg.document?.filename ?? "documento").slice(0, 120);
      const kind = classifyDocument(String(msg.document?.mime_type ?? ""), docName);
      const caption = String(msg.document?.caption ?? "").trim();

      if (kind === "legacy" || kind === "unsupported") {
        // Recusa honesta: ler .doc/.xls "mais ou menos" produziria lixo, e
        // lixo virando registro de saúde é pior que arquivo nenhum.
        await waSendText(from, kind === "legacy"
          ? `Esse é um formato antigo (.doc, .xls, .ppt e parentes) que eu não consigo abrir por aqui sem risco de ler errado — e prefiro te dizer isso a inventar o conteúdo.\n\nSalve como *.docx*, *.xlsx*, *.csv*, *.txt* ou *PDF* e me manda de novo.`
          : `Não sei ler esse tipo de arquivo por aqui. Eu leio: *PDF*, *Word (.docx)*, *Excel (.xlsx)*, *.csv*, *.txt*, *.md*, *.json* e *.log*.\n\nSe for foto de algo, me manda como imagem mesmo que eu leio.`);
        return new Response("ok", { status: 200 });
      }

      const ent = await getEntitlements(supabase, link.user_id);

      if (kind === "pdf") {
        const { ok, id: docReservation } = await reserveDocAnalysis(supabase, link.user_id, ent, from, url);
        if (!ok) return new Response("ok", { status: 200 });
        const media = await waDownloadMedia(String(msg.document?.id ?? ""), MAX_PDF_BYTES);
        if (media === "too_big" || !media) {
          await releaseUsage(supabase, docReservation);
          await waSendText(from, media === "too_big"
            ? "Esse PDF é grande demais para o WhatsApp (máximo ~4 MB). No app o Conselheiro aceita arquivos maiores."
            : "Não consegui baixar o documento (não contou no seu limite). Tenta de novo?");
          return new Response("ok", { status: 200 });
        }
        const ask = caption || "Analise este documento considerando meus dados e me diga o que importa.";
        const okTurn = await counselorTurn(
          supabase, link.user_id, ent, from, ask, url,
          [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(media.bytes) } }],
          `${ask}\n📎 ${docName}`,
        );
        if (!okTurn) await releaseUsage(supabase, docReservation); // falha não consome análise
        return new Response("ok", { status: 200 });
      }

      // ── Formatos que lemos aqui: baixar e extrair, sem gastar cota nenhuma
      //    (só o que virar captura ou conversa é que custa). ──
      const media = await waDownloadMedia(String(msg.document?.id ?? ""), MAX_DOC_BYTES);
      if (media === "too_big" || !media) {
        await waSendText(from, media === "too_big"
          ? "Esse arquivo é grande demais para o WhatsApp (máximo ~4 MB). Manda só a parte que importa, ou use o app."
          : "Não consegui baixar esse arquivo. Tenta mandar de novo?");
        return new Response("ok", { status: 200 });
      }
      const extracted = await extractDocumentText(kind, media.bytes, MAX_DOC_CHARS);
      if (!extracted) {
        await waSendText(from, `Não consegui abrir esse arquivo (pode estar protegido por senha, corrompido, ou não ser mesmo um ${kind === "xlsx" ? "Excel" : kind === "docx" ? "Word" : "arquivo de texto"}). Se der, exporte como *.csv* ou *PDF* e me manda de novo.`);
        return new Response("ok", { status: 200 });
      }
      const content = extracted.text.trim();
      if (!content) {
        await waSendText(from, "Esse arquivo não tem texto que eu consiga ler (deve ser só imagem por dentro). Se for um documento escaneado, me manda como *PDF* ou como *foto* que eu leio.");
        return new Response("ok", { status: 200 });
      }
      if (extracted.truncated) {
        // Passou do teto: parar aqui é a escolha certa. Ler o começo e calar
        // sobre o resto é como a IA registra dado errado com cara de certo.
        await waSendText(from, `Esse arquivo tem texto demais para eu ler inteiro pelo WhatsApp, e ler só o começo seria pior que não ler: eu te daria meia informação com cara de completa.\n\nMe manda um trecho menor (um mês, uma aba), ou envie o arquivo no Conselheiro do app, que aceita arquivos maiores: ${url}/app/conselheiro`);
        return new Response("ok", { status: 200 });
      }

      if (content.length > MAX_DOC_CAPTURE_CHARS) {
        // Documento longo (plano alimentar, relatório): é leitura, não relato.
        // Mesma rota do PDF — inclusive a mesma cota de análise.
        const { ok, id: docReservation } = await reserveDocAnalysis(supabase, link.user_id, ent, from, url);
        if (!ok) return new Response("ok", { status: 200 });
        const ask = caption || "Analise este documento considerando meus dados e me diga o que importa.";
        const okTurn = await counselorTurn(
          supabase, link.user_id, ent, from,
          `${ask}\n\n━━━ CONTEÚDO DE "${docName}" (extraído do arquivo, texto puro) ━━━\n${content}`,
          url, [], `${ask}\n📎 ${docName}`,
        );
        if (!okTurn) await releaseUsage(supabase, docReservation);
        return new Response("ok", { status: 200 });
      }

      // Curto: segue exatamente o caminho de uma mensagem de texto (sem
      // `return` — o roteador lá embaixo decide captura ou Conselheiro).
      docText = `${caption ? caption.slice(0, 300) + "\n\n" : ""}Conteúdo do arquivo "${docName}":\n${content}`;
    }

    // ── ÁUDIO: transcreve (Groq) e entra no MESMO roteador do texto —
    //    relato vira captura com botões, pergunta vai ao Conselheiro. ──
    let text = "";
    let transcribed = false;
    const fromDoc = docText.length > 0;
    if (fromDoc) {
      text = docText; // arquivo já lido acima: daqui para baixo é texto comum
    } else if ((msg.type === "audio" || msg.type === "voice") && link) {
      const audioId = String(msg.audio?.id ?? msg.voice?.id ?? "");
      const media = await waDownloadMedia(audioId, MAX_AUDIO_BYTES);
      if (media === "too_big" || !media) {
        await waSendText(from, media === "too_big"
          ? "Esse áudio ficou grande demais. Me manda em áudios de até uns 5 minutos?"
          : "Não consegui baixar o áudio. Tenta mandar de novo?");
        return new Response("ok", { status: 200 });
      }
      const transcript = await groqTranscribe(media.bytes, media.mime);
      if (!transcript) {
        await waSendText(from, "Não consegui entender esse áudio (pode ter ficado sem fala clara). Tenta de novo, ou me manda por texto?");
        return new Response("ok", { status: 200 });
      }
      text = transcript.slice(0, 2000);
      transcribed = true;
    } else if (msg.type === "text") {
      text = String(msg.text?.body ?? "").trim();
    } else {
      return new Response("ok", { status: 200 }); // sticker, localização etc.
    }
    if (!text) return new Response("ok", { status: 200 });

    // ── Pareamento por código de 6 dígitos (só texto digitado) ──
    if (!transcribed && /^\d{6}$/.test(text)) {
      // Teto de tentativas POR NÚMERO: 6 dígitos são força-brutáveis, e
      // acertar um código vincula o número à conta alheia. O teto é atômico
      // (advisory lock no banco) e fail-closed: erro de banco não libera.
      const { data: mayTry, error: attemptErr } = await supabase.rpc("wa_pair_attempt", {
        p_phone: from, max_attempts: PAIR_MAX_ATTEMPTS, window_min: PAIR_WINDOW_MIN,
      });
      if (attemptErr) {
        console.error("wa_pair_attempt", attemptErr.message ?? attemptErr);
        await waSendText(from, "Não consegui validar seu código agora. Tente de novo em instantes.");
        return new Response("ok", { status: 200 });
      }
      if (mayTry !== true) {
        await waSendText(from, `Muitas tentativas de código em pouco tempo. Aguarde ${PAIR_WINDOW_MIN} minutos, gere um código novo em Ajustes → WhatsApp e tente outra vez.`);
        return new Response("ok", { status: 200 });
      }
      const { data: pairing } = await supabase.from("whatsapp_links")
        .select("user_id").eq("pairing_code", text)
        .gt("pairing_expires_at", new Date().toISOString())
        .limit(1).maybeSingle();
      if (!pairing) {
        await waSendText(from, "Esse código não confere ou expirou. Gere um novo em Ajustes → WhatsApp no app e me mande em até 15 minutos.");
        return new Response("ok", { status: 200 });
      }
      // Acertou: o histórico de tentativas daquele número não precisa mais existir.
      await supabase.rpc("wa_pair_clear", { p_phone: from });
      // Número já vinculado a OUTRA conta: solta o vínculo antigo (o número
      // pertence a quem o possui agora).
      await supabase.from("whatsapp_links").update({ phone: null, linked_at: null })
        .eq("phone", from).neq("user_id", pairing.user_id);
      await supabase.from("whatsapp_links").update({
        phone: from, linked_at: new Date().toISOString(),
        pairing_code: null, pairing_expires_at: null,
      }).eq("user_id", pairing.user_id);
      const { data: prof } = await supabase.from("profiles")
        .select("name").eq("user_id", pairing.user_id).maybeSingle();
      const first = (prof?.name ?? "").split(" ")[0];
      await waSendText(from,
        `Pronto${first ? `, ${first}` : ""}! WhatsApp conectado ao seu Ascende ✓\n\nAgora você pode:\n• *Registrar o dia*: "gastei 47 no mercado e treinei pernas" (eu proponho, você confirma no botão)\n• *Falar com o Conselheiro*: "tô gastando demais esse mês?" (ele vê todos os seus pilares, e a conversa continua no app)\n\nSeu painel completo: ${url}/app`);
      return new Response("ok", { status: 200 });
    }

    // ── Número não vinculado ──
    if (!link) {
      await waSendText(from, `Oi! Aqui é o Ascende. Para conectar este número à sua conta, abra o app em Ajustes → WhatsApp, gere seu código de 6 dígitos e me mande ele aqui.\n\nAinda não tem conta? Começa em ${url}`);
      return new Response("ok", { status: 200 });
    }

    // ── Comandos ──
    if (!transcribed && /^(parar|sair|stop|cancelar)$/i.test(text)) {
      await supabase.from("whatsapp_links").update({
        notify_retro: false, notify_briefing: false, notify_return: false,
      }).eq("user_id", link.user_id);
      await waSendText(from, "Combinado: não vou mais te chamar por aqui. Você ainda pode me mandar frases e falar com o Conselheiro quando quiser, e religa os avisos em Ajustes → WhatsApp no app.");
      return new Response("ok", { status: 200 });
    }
    if (/^(ajuda|help|\?)$/i.test(text)) {
      await waSendText(from, HELP(url));
      return new Response("ok", { status: 200 });
    }

    if (!fromDoc) await assertRateLimit(supabase, link.user_id, "whatsapp", 40, 5); // documento já contou
    if (!fromDoc && text.length > 2000) {
      await waSendText(from, "Essa mensagem ficou grande demais. Me manda em partes menores, ou continue no app.");
      return new Response("ok", { status: 200 });
    }
    if (isTrivialMessage(text)) {
      await waSendText(from, HELP(url));
      return new Response("ok", { status: 200 });
    }

    const ent = await getEntitlements(supabase, link.user_id);

    // Eco do que eu entendi ANTES de propor qualquer coisa: a transcrição do
    // áudio (honestidade com o STT) ou o arquivo que foi lido (honestidade
    // sobre a fonte do registro).
    const preface = transcribed
      ? `🎙 _"${text.slice(0, 180)}${text.length > 180 ? "…" : ""}"_`
      : fromDoc
        ? `📎 _Li o arquivo "${docName}"._`
        : undefined;

    // ── ROTA 1: claramente conversa → Conselheiro (cota de chat) ──
    //    Arquivo nunca entra por aqui: uma planilha cheia de "?" não é
    //    pergunta. Ele tenta captura e, se não houver nada registrável, o
    //    fallback da ROTA 2 leva o conteúdo ao Conselheiro do mesmo jeito.
    if (!fromDoc && looksConversational(text)) {
      if (preface) await waSendText(from, preface);
      await counselorTurn(supabase, link.user_id, ent, from, text, url);
      return new Response("ok", { status: 200 });
    }

    // ── ROTA 2: tenta capturar (cota de captura) ──
    let reservationId: number | null = null;
    let captureExhausted = false;
    if (ent.flags.premium_limits_enabled && ent.limits.capture_daily !== null) {
      const { id } = await reserveUsage(supabase, link.user_id, "capture", ent.limits.capture_daily, spDayStartUtc());
      if (id === null) captureExhausted = true;
      else reservationId = id;
    }

    if (!captureExhausted) {
      const { ok, events } = await extractEventsAndMemories(
        supabase, link.user_id, text, "capture", ent.limits.memory_cap, { reservationId },
      );
      if (!ok) {
        await releaseUsage(supabase, reservationId);
        await waSendText(from, "Não consegui interpretar agora (a tentativa não contou no seu limite). Tenta de novo em instantes?");
        return new Response("ok", { status: 200 });
      }
      if (events.length) {
        await proposeEvents(supabase, link.user_id, from, events, url, text, preface);
        return new Response("ok", { status: 200 });
      }
      // Nada registrável: a tentativa NÃO consome o limite de captura —
      // a mensagem era conversa, e conversa é com o Conselheiro.
      await releaseUsage(supabase, reservationId);
      if (preface) await waSendText(from, preface);
      await counselorTurn(supabase, link.user_id, ent, from, text, url);
      return new Response("ok", { status: 200 });
    }

    // ── Captura esgotada: o Conselheiro continua disponível ──
    await waSendText(from,
      `Você usou as ${ent.limits.capture_daily} capturas inteligentes de hoje — o limite renova amanhã, e registros manuais continuam ilimitados no app: ${url}/app${ent.plan === "free" ? `\n\nNo Ascende+ são 30 por dia: ${url}/app/assinatura` : ""}\n\n(Perguntas para o Conselheiro continuam funcionando por aqui normalmente.)`);
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("whatsapp-webhook", e);
    if (replyTo) {
      const tooMany = e instanceof Response && e.status === 429;
      await waSendText(replyTo, tooMany
        ? "Muitas mensagens em pouco tempo por aqui. Respire e me chame de novo em alguns minutos."
        : "Deu um problema do meu lado agora. Tenta de novo em instantes?").catch(() => {});
    }
    return new Response("ok", { status: 200 });
  }
});