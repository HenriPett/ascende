// ASCEND — Briefing do dia
// Gera um resumo curto e acolhedor cruzando todos os pilares.
// Cache: 1 por usuário por dia (tabela briefings).
import {
  corsHeaders, serviceClient, requireUser, assertRateLimit, buildSnapshot,
  ANTHROPIC_URL, ANTHROPIC_VERSION, MODEL_SMART, corsFor, SAFETY_RULES,
} from "../_shared/lib.ts";

// Domingo (fuso de São Paulo) = retrospectiva da semana em vez do briefing do dia
function isSundayInSaoPaulo(): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" })
    .format(new Date());
  return wd === "Sun";
}

const RETRO_SYSTEM = `Você escreve a retrospectiva de domingo do Ascend — plataforma brasileira de qualidade de vida.
ESTILO: escreva como uma pessoa escreve. NUNCA use travessão ou meia-risca (— ou –); prefira vírgula, dois-pontos ou frases separadas.
Com base no retrato da pessoa (dados reais), escreva de 4 a 6 frases curtas em português do Brasil olhando para a SEMANA que passou:
1. O resumo honesto da semana, cruzando pilares quando os dados permitirem (o que andou, o que travou).
2. UMA vitória concreta da semana para reconhecer (meta batida, sequência, bom padrão), com o dado.
3. UMA coisa para ajustar na semana que começa, com o porquê nos dados.
4. Feche com uma frase de partida para a nova semana, curta e sem clichê.
Tom: caloroso, direto, sem falso entusiasmo, sem envergonhar. Sem listas, sem títulos, sem emoji — apenas o texto corrido.
Se houver poucos dados, dê boas-vindas e diga (em 1 frase) o que registrar para a próxima retrospectiva valer a pena.
${SAFETY_RULES}

━━━ RETRATO ATUAL DA PESSOA ━━━
`;

const SYSTEM = `Você escreve o briefing matinal do Ascend — plataforma brasileira de qualidade de vida.
ESTILO: escreva como uma pessoa escreve. NUNCA use travessão ou meia-risca (— ou –); prefira vírgula, dois-pontos ou frases separadas.
Com base no retrato da pessoa (dados reais), escreva de 3 a 5 frases curtas em português do Brasil:
1. Como a vida dela está neste momento, cruzando pilares (finanças × sono × hábitos × humor) quando os dados permitirem.
2. UMA coisa que merece atenção hoje, com o porquê nos dados.
3. UMA sugestão pequena e possível para hoje.
Tom: caloroso, direto, sem falso entusiasmo, sem envergonhar. Sem listas, sem títulos, sem emoji — apenas o texto corrido.
Se houver poucos dados, dê boas-vindas e diga (em 1 frase) o que registrar hoje para o briefing de amanhã ficar mais inteligente.
${SAFETY_RULES}

━━━ RETRATO ATUAL DA PESSOA ━━━
`;

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);
    await assertRateLimit(supabase, user.id, "briefing", 20, 60);

    const today = new Date().toISOString().slice(0, 10);
    const { data: cached } = await supabase.from("briefings")
      .select("content").eq("user_id", user.id).eq("brief_date", today).maybeSingle();
    if (cached?.content) return json({ briefing: cached.content, cached: true });

    const snapshot = await buildSnapshot(supabase, user.id);

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_SMART,
        max_tokens: 400,
        system: (isSundayInSaoPaulo() ? RETRO_SYSTEM : SYSTEM) + snapshot,
        messages: [{ role: "user", content: `Escreva o briefing de hoje (${today}).` }],
      }),
    });
    if (!res.ok) {
      console.error("Anthropic error", res.status, await res.text());
      return json({ error: "Briefing indisponível agora." }, 502);
    }
    const data = await res.json();
    const briefing = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();

    await supabase.from("briefings").upsert(
      { user_id: user.id, brief_date: today, content: briefing },
      { onConflict: "user_id,brief_date" }
    );

    return json({ briefing, cached: false });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});