// ASCENDE — Briefing do dia / Retrospectiva de domingo
// Cache: 1 por usuário por dia (tabela briefings), com data no fuso de São Paulo.
// Plano gratuito: retrospectiva semanal (domingo). Ascende+: briefing diário.
// Roteamento de modelo: retratos curtos (pouco dado) usam o modelo econômico.
import {
  serviceClient, requireUser, assertRateLimit, buildSnapshot,
  MODEL_SMART, MODEL_FAST, corsFor, SAFETY_RULES,
} from "../_shared/lib.ts";
import { anthropicCall } from "../_shared/usage.ts";
import {
  getEntitlements, spParts, isSundayInSP, nextSpDayStartUtc,
} from "../_shared/entitlements.ts";

const RETRO_SYSTEM = `Você escreve a retrospectiva de domingo do Ascende — plataforma brasileira de qualidade de vida.
ESTILO: escreva como uma pessoa escreve. NUNCA use travessão ou meia-risca (— ou –); prefira vírgula, dois-pontos ou frases separadas.
Com base no retrato da pessoa (dados reais), escreva de 4 a 6 frases curtas em português do Brasil olhando para a SEMANA que passou:
1. O resumo honesto da semana, cruzando pilares quando os dados permitirem (o que andou, o que travou).
2. UMA vitória concreta da semana para reconhecer (meta batida, sequência, bom padrão), com o dado.
3. UMA coisa para ajustar na semana que começa, com o porquê nos dados.
4. Feche com uma frase de partida para a nova semana, curta e sem clichê.
Tom: caloroso, direto, sem falso entusiasmo, sem envergonhar. Sem listas, sem títulos, sem emoji — apenas o texto corrido.
Se houver poucos dados, dê boas-vindas e diga (em 1 frase) o que registrar para a próxima retrospectiva valer a pena.
HONESTIDADE SOBRE DADOS (inegociável): nunca afirme que a pessoa pulou, esqueceu ou deixou de preencher algo, e nunca cite etapas ou telas que você não viu no retrato: você não sabe o que o app perguntou a ela. Se um dado falta, ou trabalhe com o que existe, ou convide de forma neutra em 1 frase.
VALOR NO VALE (regra inegociável): se o retrato indicar SILÊNCIO ou RETORNO APÓS SILÊNCIO, a retrospectiva vira acolhida: não audite a semana vazia, não cite sequência perdida, não liste o que faltou. Diga que nada expirou e que o primeiro registro de volta vale por dez; proponha UM recomeço pequeno.
CRUZAMENTO DESDE O DIA 1: se houver ESTIMATIVAS declaradas (financeiras ou de vitalidade), cruze-as entre pilares mesmo sem registros, sempre citando que são estimativas ("pela sua estimativa de..."). Diga algo que nenhum app de nicho conseguiria dizer.
${SAFETY_RULES}`;

const SYSTEM = `Você escreve o briefing matinal do Ascende — plataforma brasileira de qualidade de vida.
ESTILO: escreva como uma pessoa escreve. NUNCA use travessão ou meia-risca (— ou –); prefira vírgula, dois-pontos ou frases separadas.
Com base no retrato da pessoa (dados reais), escreva de 3 a 5 frases curtas em português do Brasil:
1. Como a vida dela está neste momento, cruzando pilares (finanças × sono × hábitos × humor) quando os dados permitirem.
2. UMA coisa que merece atenção hoje, com o porquê nos dados.
3. UMA sugestão pequena e possível para hoje.
Tom: caloroso, direto, sem falso entusiasmo, sem envergonhar. Sem listas, sem títulos, sem emoji — apenas o texto corrido.
Se houver poucos dados, dê boas-vindas e diga (em 1 frase) o que registrar hoje para o briefing de amanhã ficar mais inteligente.
HONESTIDADE SOBRE DADOS (inegociável): nunca afirme que a pessoa pulou, esqueceu ou deixou de preencher algo, e nunca cite etapas ou telas que você não viu no retrato: você não sabe o que o app perguntou a ela. Se um dado falta, ou trabalhe com o que existe, ou convide de forma neutra em 1 frase.
VALOR NO VALE (regra inegociável): se o retrato indicar SILÊNCIO ou RETORNO APÓS SILÊNCIO, o briefing vira acolhida: não audite o período vazio, não cite sequência perdida, não liste o que faltou. Diga que nada expirou e que o primeiro registro de volta vale por dez; proponha UM passo pequeno.
CRUZAMENTO DESDE O DIA 1: se houver ESTIMATIVAS declaradas (financeiras ou de vitalidade), cruze-as entre pilares mesmo sem registros, sempre citando que são estimativas ("pela sua estimativa de..."). O objetivo é dizer, já no primeiro briefing, algo que nenhum app de nicho conseguiria dizer.
${SAFETY_RULES}`;

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);
    await assertRateLimit(supabase, user.id, "briefing", 20, 60);

    const today = spParts().dateIso; // data no fuso de São Paulo (era UTC: corrigido)
    const sunday = isSundayInSP();

    // Primeiro Amanhecer (análise UX P0.1): nas primeiras 72h de conta o
    // briefing diário é por nossa conta, em qualquer plano — o dia 1 nunca
    // abre com cadeado, e os dias 2–3 ganham motivo de retorno. Custo: uma
    // chamada Haiku/dia por usuário novo (o roteador abaixo usa MODEL_FAST
    // para retratos curtos, que é o caso de contas novas).
    const createdAt = new Date(user.created_at ?? 0).getTime();
    const firstDawn = Number.isFinite(createdAt) && createdAt > 0 &&
      Date.now() - createdAt <= 72 * 3600 * 1000;

    const ent = await getEntitlements(supabase, user.id);
    const freeWeekday = ent.flags.premium_limits_enabled && !ent.limits.briefing_daily && !sunday;
    // Cortesia: gratuito, dia de semana, dentro das 72h — o app mostra
    // "por nossa conta" e prepara a transição honesta do dia 4.
    const courtesy = freeWeekday && firstDawn;

    const { data: cached } = await supabase.from("briefings")
      .select("content").eq("user_id", user.id).eq("brief_date", today).maybeSingle();
    if (cached?.content) return json({ briefing: cached.content, cached: true, courtesy });

    // Plano gratuito após o Primeiro Amanhecer: briefing diário é do
    // Ascende+; a retrospectiva de domingo é de todos. A mensagem é de
    // transição, não de cadeado — e o app troca o card por conteúdo local.
    if (freeWeekday && !firstDawn) {
      return json({
        briefing: null, locked: true, feature: "briefing",
        reason: "Foi bom te acompanhar de manhã nos seus primeiros dias. O briefing diário vive no Ascende+ — e a sua retrospectiva gratuita continua chegando todo domingo.",
        reset_at: nextSpDayStartUtc(), upgrade_available: true,
      });
    }

    const snapshot = await buildSnapshot(supabase, user.id);
    // Roteamento: retrato curto (pouca vida registrada) não precisa do modelo caro
    const model = snapshot.length < 900 ? MODEL_FAST : MODEL_SMART;

    const { res, data } = await anthropicCall(supabase, user.id, sunday ? "retrospectiva" : "briefing", {
      model,
      max_tokens: 400,
      system: [
        { type: "text", text: sunday ? RETRO_SYSTEM : SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: `━━━ RETRATO ATUAL DA PESSOA ━━━\n${snapshot}` },
      ],
      messages: [{ role: "user", content: `Escreva o ${sunday ? "retrospectiva da semana" : "briefing"} de hoje (${today}).` }],
    });
    if (!res.ok || !data) return json({ error: "Briefing indisponível agora." }, 502);

    // deno-lint-ignore no-explicit-any
    const briefing = ((data as any).content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();

    await supabase.from("briefings").upsert(
      { user_id: user.id, brief_date: today, content: briefing },
      { onConflict: "user_id,brief_date" }
    );
    return json({ briefing, cached: false, courtesy });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});