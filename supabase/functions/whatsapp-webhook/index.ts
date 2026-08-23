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
} from "../_shared/lib.ts";
import { anthropicCall, reserveUsage, releaseUsage } from "../_shared/usage.ts";
import {
  getEntitlements, spDayStartUtc, spWeekStartUtc, spMonthStartUtc,
} from "../_shared/entitlements.ts";
import {
  waSendText, waSendButtons, verifyWaSignature, saveEventsServer, xpForKind, appUrl,
} from "../_shared/whatsapp.ts";

const PENDING_TTL_MIN = 60;     // proposta sem resposta expira em 1h
const LEGACY_DAILY_LIMIT = 40;  // espelha o ai-chat enquanto premium_limits_enabled = false

const HELP = (url: string) =>
  `Aqui é o Ascende 🏔️\n\nComigo você faz duas coisas por aqui:\n\n1. *Registrar o dia*: "gastei 47 no mercado e treinei pernas" — eu proponho os registros e você confirma no botão.\n2. *Conversar com o Conselheiro*: "tô gastando demais esse mês?" — ele responde vendo todos os seus pilares, e a conversa continua no app de onde parou.\n\nGráficos, planos e ajustes finos: ${url}/app\n\nComandos: "parar" silencia meus avisos · "ajuda" mostra esta mensagem.`;

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

/** Espelho fiel dos limites do Conselheiro no ai-chat (mesma tabela, mesmas
 *  janelas SP). Retorna null se pode falar, ou a mensagem de limite. */
async function chatLimitMessage(
  // deno-lint-ignore no-explicit-any
  supabase: any, userId: string, ent: Awaited<ReturnType<typeof getEntitlements>>, url: string,
): Promise<string | null> {
  const countChat = async (sinceIso: string) => {
    const { count } = await supabase.from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("role", "user").gte("created_at", sinceIso);
    return count ?? 0;
  };
  const upsell = ent.plan === "free" ? `\n\nNo Ascende+ são 15 mensagens por dia: ${url}/app/assinatura` : "";
  if (ent.flags.premium_limits_enabled) {
    const L = ent.limits;
    if (L.chat_daily !== null && (await countChat(spDayStartUtc())) >= L.chat_daily) {
      return `Você usou as ${L.chat_daily} mensagens de hoje com o Conselheiro. Amanhã ele volta — e registrar o dia por aqui continua funcionando normalmente.${upsell}`;
    }
    if (L.chat_weekly !== null && (await countChat(spWeekStartUtc())) >= L.chat_weekly) {
      return `Você usou as ${L.chat_weekly} mensagens desta semana com o Conselheiro. Registrar o dia por aqui continua funcionando normalmente.${upsell}`;
    }
    if (L.chat_monthly !== null && (await countChat(spMonthStartUtc())) >= L.chat_monthly) {
      return `Você usou as ${L.chat_monthly} mensagens deste mês com o Conselheiro.${upsell}`;
    }
    return null;
  }
  if ((await countChat(spDayStartUtc())) >= LEGACY_DAILY_LIMIT) {
    return `Você atingiu o limite de ${LEGACY_DAILY_LIMIT} mensagens por dia com o Conselheiro. Amanhã ele estará aqui de novo.`;
  }
  return null;
}

/** Conversa com o Conselheiro: mesma cota, mesmo retrato e MESMO histórico
 *  do app (chat_messages) — a conversa continua nos dois lugares. */
async function counselorTurn(
  // deno-lint-ignore no-explicit-any
  supabase: any, userId: string, ent: Awaited<ReturnType<typeof getEntitlements>>,
  from: string, text: string, url: string,
): Promise<void> {
  const limitMsg = await chatLimitMessage(supabase, userId, ent, url);
  if (limitMsg) { await waSendText(from, limitMsg); return; }

  const [snapshot, { data: history }] = await Promise.all([
    buildSnapshot(supabase, userId),
    supabase.from("chat_messages").select("role,content")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(12),
  ]);
  const messages = (history ?? []).slice().reverse()
    // deno-lint-ignore no-explicit-any
    .map((m: any) => ({ role: m.role, content: m.content }));
  messages.push({ role: "user", content: text });

  // Mesmo roteamento de modelo do ai-chat: pergunta curta não paga modelo caro.
  const needsSmart =
    text.length > 160 ||
    /plano|dieta|treino|or[çc]ament|financ|analis|relat[óo]rio|semana|m[êe]s|como (estou|est[áa]|anda)|minha vida|meta|estrat[ée]gia|cruz|compar/i.test(text);
  const model = ent.flags.model_routing_enabled && !needsSmart ? MODEL_FAST : MODEL_SMART;

  const { res, data } = await anthropicCall(supabase, userId, "wa-conselheiro", {
    model,
    max_tokens: 1000,
    system: [
      { type: "text", text: WA_SYSTEM(url), cache_control: { type: "ephemeral" } },
      { type: "text", text: snapshot },
    ],
    messages,
  });
  if (!res.ok || !data) {
    await waSendText(from, "O Conselheiro está indisponível agora. Sua mensagem não contou no limite: tente de novo em instantes.");
    return;
  }
  // deno-lint-ignore no-explicit-any
  const reply = (((data as any).content ?? []) as any[])
    .filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!reply) {
    await waSendText(from, "O Conselheiro não conseguiu formular uma resposta agora. Tente reformular ou enviar de novo (não contou no limite).");
    return;
  }

  // Persistência ANTES do envio: é ela que conta a cota (mesma regra do app)
  // e que faz a conversa aparecer no app.
  const { error: insertErr } = await supabase.from("chat_messages").insert([
    { user_id: userId, role: "user", content: text },
    { user_id: userId, role: "assistant", content: reply },
  ]);
  if (insertErr) console.error("wa chat_messages insert", insertErr.message);

  await waSendText(from, reply.slice(0, 3900));

  // Memórias duráveis também nascem da conversa de WhatsApp (mesma extração
  // econômica do app; eventos aqui são ignorados — relato tem o fluxo próprio).
  try {
    await extractEventsAndMemories(supabase, userId, text, "chat-extracao", ent.limits.memory_cap);
  } catch (e) {
    console.error("wa chat-extracao", e);
  }
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
        await waSendText(from, "Descartei, nada foi gravado. Quando quiser, é só mandar outra frase. 👍");
        return new Response("ok", { status: 200 });
      }
      if (btn === "wa_confirm") {
        const expired = Date.now() - new Date(String(pending.created_at)).getTime() > PENDING_TTL_MIN * 60_000;
        if (expired) {
          await waSendText(from, "Essa proposta já tinha expirado (1h). Me manda a frase de novo que eu refaço na hora.");
          return new Response("ok", { status: 200 });
        }
        const { data: prof } = await supabase.from("profiles")
          .select("sleep_goal_h").eq("user_id", link.user_id).maybeSingle();
        const events = Array.isArray(pending.events) ? pending.events : [];
        const { saved, xp } = await saveEventsServer(supabase, link.user_id, events, prof?.sleep_goal_h ?? null);
        await waSendText(from,
          saved > 0
            ? `Registrado ✓ ${saved} ${saved === 1 ? "item" : "itens"} · +${xp} XP na sua subida.\n\nVeja seu dia completo no painel: ${url}/app`
            : `Não consegui gravar desta vez. Tente pelo app: ${url}/app`);
        return new Response("ok", { status: 200 });
      }
      return new Response("ok", { status: 200 });
    }

    // ── Mídia (v1: redireciona para o app, onde a análise já existe) ──
    if (msg.type === "image" || msg.type === "audio" || msg.type === "document") {
      await waSendText(from, `Por aqui eu entendo texto por enquanto. Fotos de prato, prints de fatura e áudio já funcionam no app: ${url}/app`);
      return new Response("ok", { status: 200 });
    }
    if (msg.type !== "text") return new Response("ok", { status: 200 });

    const text = String(msg.text?.body ?? "").trim();
    if (!text) return new Response("ok", { status: 200 });

    // ── Pareamento por código de 6 dígitos ──
    if (/^\d{6}$/.test(text)) {
      const { data: pairing } = await supabase.from("whatsapp_links")
        .select("user_id").eq("pairing_code", text)
        .gt("pairing_expires_at", new Date().toISOString()).maybeSingle();
      if (!pairing) {
        await waSendText(from, "Esse código não confere ou expirou. Gere um novo em Ajustes → WhatsApp no app e me mande em até 15 minutos.");
        return new Response("ok", { status: 200 });
      }
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
    if (/^(parar|sair|stop|cancelar)$/i.test(text)) {
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

    await assertRateLimit(supabase, link.user_id, "whatsapp", 40, 5);
    if (text.length > 2000) {
      await waSendText(from, "Essa mensagem ficou grande demais. Me manda em partes menores, ou continue no app.");
      return new Response("ok", { status: 200 });
    }
    if (isTrivialMessage(text)) {
      await waSendText(from, HELP(url));
      return new Response("ok", { status: 200 });
    }

    const ent = await getEntitlements(supabase, link.user_id);

    // ── ROTA 1: claramente conversa → Conselheiro (cota de chat) ──
    if (looksConversational(text)) {
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
        // Proposta pendente (1 por usuário; a nova substitui a anterior)
        await supabase.from("whatsapp_pending").upsert({
          user_id: link.user_id, events, created_at: new Date().toISOString(),
        });
        const lines = events.slice(0, 8)
          // deno-lint-ignore no-explicit-any
          .map((e: any) => `• ${e.summary ?? e.kind} (+${xpForKind(String(e.kind))} XP)`).join("\n");
        await waSendButtons(from,
          `Entendi assim:\n\n${lines}${events.length > 8 ? `\n… e mais ${events.length - 8}` : ""}\n\nConfirmo?  Para ajustar detalhes, revise no app: ${url}/app`,
          [{ id: "wa_confirm", title: "✓ Confirmar" }, { id: "wa_discard", title: "✗ Descartar" }]);
        return new Response("ok", { status: 200 });
      }
      // Nada registrável: a tentativa NÃO consome o limite de captura —
      // a mensagem era conversa, e conversa é com o Conselheiro.
      await releaseUsage(supabase, reservationId);
      await counselorTurn(supabase, link.user_id, ent, from, text, url);
      return new Response("ok", { status: 200 });
    }

    // ── Captura esgotada: o Conselheiro continua disponível ──
    await waSendText(from,
      `Você usou as ${ent.limits.capture_daily} capturas inteligentes de hoje — o limite renova amanhã, e registros manuais continuam ilimitados no app: ${url}/app${ent.plan === "free" ? `\n\nNo Ascende+ são 30 por dia: ${url}/app/assinatura` : ""}\n\n(Perguntas para o Conselheiro continuam funcionando por aqui normalmente.)`);
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("whatsapp-webhook", e);
    return new Response("ok", { status: 200 });
  }
});