// ASCENDE — Webhook do WhatsApp (Cloud API da Meta)
//
// Papel: receber mensagens do usuário e SEMPRE apontar de volta para o app.
// Fluxos:
//   1. Pareamento: a pessoa manda o código de 6 dígitos gerado em Ajustes;
//      só quem possui o número consegue vinculá-lo (o cliente nunca grava phone).
//   2. Captura: frase livre → MESMO pipeline da captura do app (mesma cota
//      diária, mesma reserva atômica, mesma extração). A IA nunca grava
//      sozinha: a proposta volta com botões Confirmar/Descartar.
//   3. Comandos: "parar" silencia os envios; "ajuda" explica.
//
// Custo: tudo aqui acontece dentro da janela de 24h iniciada pelo usuário
// (categoria de serviço) — o custo real é a IA, já coberta pela cota do plano.
import {
  serviceClient, assertRateLimit, isTrivialMessage, extractEventsAndMemories,
} from "../_shared/lib.ts";
import { reserveUsage, releaseUsage } from "../_shared/usage.ts";
import {
  getEntitlements, spDayStartUtc, nextSpDayStartUtc,
} from "../_shared/entitlements.ts";
import {
  waSendText, waSendButtons, verifyWaSignature, saveEventsServer, xpForKind, appUrl,
} from "../_shared/whatsapp.ts";

const PENDING_TTL_MIN = 60; // proposta sem resposta expira em 1h

const HELP = (url: string) =>
  `Aqui é o Ascende 🏔️\n\nMe conte seu dia numa frase ("gastei 47 no mercado e treinei pernas") que eu transformo em registros — você confirma no botão.\n\nPara ajustar detalhes, ver gráficos e falar com o Conselheiro, é no app: ${url}/app\n\nComandos: "parar" silencia meus avisos · "ajuda" mostra esta mensagem.`;

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

    // ── Botões (Confirmar / Descartar proposta) ──
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
        `Pronto${first ? `, ${first}` : ""}! WhatsApp conectado ao seu Ascende ✓\n\nAgora é só me contar o dia numa frase:\n• "Gastei 47 no mercado e treinei pernas"\n• "Dormi 6h, tô meio cansado"\n\nEu proponho os registros e você confirma no botão. O painel completo continua no app: ${url}/app`);
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
      await waSendText(from, "Combinado: não vou mais te chamar por aqui. Você ainda pode me mandar frases quando quiser, e religa os avisos em Ajustes → WhatsApp no app.");
      return new Response("ok", { status: 200 });
    }
    if (/^(ajuda|help|\?)$/i.test(text)) {
      await waSendText(from, HELP(url));
      return new Response("ok", { status: 200 });
    }

    // ── Captura: mesmo pipeline, mesma cota do app ──
    await assertRateLimit(supabase, link.user_id, "whatsapp", 40, 5);
    if (text.length > 2000) {
      await waSendText(from, "Essa mensagem ficou grande demais para uma captura. Me manda em frases menores, ou registre no app.");
      return new Response("ok", { status: 200 });
    }
    if (isTrivialMessage(text)) {
      await waSendText(from, HELP(url));
      return new Response("ok", { status: 200 });
    }

    const ent = await getEntitlements(supabase, link.user_id);
    let reservationId: number | null = null;
    if (ent.flags.premium_limits_enabled && ent.limits.capture_daily !== null) {
      const { id } = await reserveUsage(supabase, link.user_id, "capture", ent.limits.capture_daily, spDayStartUtc());
      if (id === null) {
        await waSendText(from,
          `Você usou as ${ent.limits.capture_daily} capturas inteligentes de hoje — o limite renova amanhã. Registros manuais continuam ilimitados no app: ${url}/app${ent.plan === "free" ? `\n\nNo Ascende+ são 30 capturas por dia: ${url}/app/assinatura` : ""}`);
        return new Response("ok", { status: 200 });
      }
      reservationId = id;
    }

    const { ok, events } = await extractEventsAndMemories(
      supabase, link.user_id, text, "capture", ent.limits.memory_cap, { reservationId },
    );
    if (!ok) {
      await releaseUsage(supabase, reservationId);
      await waSendText(from, "Não consegui interpretar agora (a tentativa não contou no seu limite). Tenta de novo em instantes?");
      return new Response("ok", { status: 200 });
    }
    if (!events.length) {
      await waSendText(from, `Não encontrei nada registrável nessa frase. Exemplos que funcionam:\n• "Gastei 32 no almoço fora"\n• "Corri 5km e bebi 2L de água"\n\nPapo mais longo é com o Conselheiro, no app: ${url}/app/conselheiro`);
      return new Response("ok", { status: 200 });
    }

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
  } catch (e) {
    console.error("whatsapp-webhook", e);
    return new Response("ok", { status: 200 });
  }
});