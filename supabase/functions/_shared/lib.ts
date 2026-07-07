// Módulo compartilhado das funções do Ascend
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const MODEL_SMART = "claude-sonnet-4-6";  // chat e briefing
export const MODEL_FAST = "claude-haiku-4-5";    // extração de eventos (captura)

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

/** Valida o JWT do usuário e retorna o user. Lança erro 401 se inválido. */
export async function requireUser(req: Request, supabase: SupabaseClient) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Response(JSON.stringify({ error: "Não autenticado" }), {
    status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  return data.user;
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Monta um retrato compacto do usuário cruzando todos os pilares.
 * É este texto que dá ao Conselheiro a visão completa da vida da pessoa.
 */
export async function buildSnapshot(supabase: SupabaseClient, userId: string): Promise<string> {
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const monthStart = new Date();
  monthStart.setDate(1);

  const [{ data: profile }, { data: events }, { data: txs }, { data: habits }, { data: xp }, { data: battles }, { data: bCheckins }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("life_events").select("pillar,kind,occurred_at,payload")
        .eq("user_id", userId).gte("occurred_at", since30)
        .order("occurred_at", { ascending: false }).limit(120),
      supabase.from("transactions").select("kind,amount,category")
        .eq("user_id", userId).gte("occurred_at", monthStart.toISOString().slice(0, 10)),
      supabase.from("habits").select("id,name,pillar").eq("user_id", userId).eq("active", true),
      supabase.from("xp_log").select("points").eq("user_id", userId),
      supabase.from("battles").select("id,name,triggers")
        .eq("user_id", userId).eq("active", true).eq("visible_to_ai", true),
      supabase.from("battle_checkins").select("battle_id,checkin_date,status,trigger_label")
        .eq("user_id", userId).gte("checkin_date", since30.slice(0, 10))
        .order("checkin_date", { ascending: false }),
    ]);

  const lines: string[] = [];
  const p = profile ?? {};
  lines.push(`Nome: ${p.name || "não informado"}.`);
  if (p.goal) lines.push(`Objetivo declarado: ${p.goal}.`);
  lines.push(`Pilares ativos: ${(p.pillars ?? []).join(", ") || "nenhum ainda"}.`);
  if (p.has_religion === false) {
    lines.push(`IMPORTANTE: a pessoa NÃO tem prática religiosa. O pilar dela é "Mente & Foco" — desenvolvimento mental (foco, clareza, meditação laica, leitura). Nunca use vocabulário espiritual ou religioso com ela.`);
  } else if (p.spirituality_label) {
    lines.push(`Prática espiritual (vocabulário escolhido pela pessoa): ${p.spirituality_label}.`);
  }
  const healthConds = Array.isArray(p.health_conditions)
    ? (p.health_conditions as unknown[]).map(String).filter(Boolean)
    : [];
  if (healthConds.length) {
    lines.push(
      `SAÚDE — condições informadas pela própria pessoa: ${healthConds.join("; ")}. ` +
      `Considere-as em TODA sugestão de alimentação, treino e rotina (adapte ou evite o que for inadequado à condição). ` +
      `Você não diagnostica nem trata: mudanças de medicação, dieta clínica ou treino pós-lesão devem ser validadas com o profissional de saúde dela.`
    );
  }
  if (p.monthly_income) lines.push(`Renda mensal aproximada: ${BRL(Number(p.monthly_income))}.`);
  if (p.monthly_budget) lines.push(`Orçamento mensal desejado: ${BRL(Number(p.monthly_budget))}.`);

  // Finanças do mês
  const income = (txs ?? []).filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expense = (txs ?? []).filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const byCat: Record<string, number> = {};
  for (const t of txs ?? []) if (t.kind === "expense") byCat[t.category] = (byCat[t.category] ?? 0) + Number(t.amount);
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, v]) => `${c} ${BRL(v)}`).join(", ");
  lines.push(`FINANÇAS (mês atual): entradas ${BRL(income)}, saídas ${BRL(expense)}, saldo ${BRL(income - expense)}.` +
    (topCats ? ` Maiores gastos: ${topCats}.` : ""));

  // Hábitos e consistência (últimos 30 dias)
  const habitDone = (events ?? []).filter((e) => e.kind === "habit_done");
  if ((habits ?? []).length) {
    const counts: Record<string, number> = {};
    for (const e of habitDone) {
      const n = (e.payload as any)?.habit_name ?? "hábito";
      counts[n] = (counts[n] ?? 0) + 1;
    }
    const resumo = (habits ?? []).map((h) => `${h.name}: ${counts[h.name] ?? 0}x/30d`).join(", ");
    lines.push(`HÁBITOS: ${resumo}.`);
  }

  // Sono, humor, treinos, refeições, práticas — médias e últimos registros
  const kinds: Record<string, any[]> = {};
  for (const e of events ?? []) (kinds[e.kind] ??= []).push(e);

  const sleeps = (kinds["sleep"] ?? []).map((e) => Number((e.payload as any)?.hours)).filter((n) => n > 0);
  if (sleeps.length) lines.push(`SONO: média de ${(sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(1)}h nos últimos ${sleeps.length} registros.`);

  const moods = (kinds["mood"] ?? []).slice(0, 10).map((e) => (e.payload as any)?.label ?? (e.payload as any)?.score).filter(Boolean);
  if (moods.length) lines.push(`HUMOR (mais recentes primeiro): ${moods.join(", ")}.`);

  if (kinds["workout"]?.length) {
    const mCount: Record<string, number> = {};
    for (const e of kinds["workout"]) {
      for (const m of ((e.payload as any)?.muscles ?? []) as string[]) mCount[m] = (mCount[m] ?? 0) + 1;
    }
    const dist = Object.entries(mCount).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}x`).join(", ");
    lines.push(`TREINOS nos últimos 30 dias: ${kinds["workout"].length}.` +
      (dist ? ` Grupos trabalhados: ${dist}.` : ""));
  }

  // Peso e composição corporal
  if (kinds["weight"]?.length) {
    const ws = kinds["weight"]
      .map((e) => ({ d: e.occurred_at.slice(0, 10), kg: Number((e.payload as any)?.kg) }))
      .filter((w) => w.kg > 0)
      .sort((a, b) => a.d.localeCompare(b.d));
    if (ws.length) {
      const latest = ws[ws.length - 1];
      const first = ws[0];
      const delta = latest.kg - first.kg;
      const goal = Number(p.weight_goal_kg) || 0;
      lines.push(
        `PESO: atual ${latest.kg} kg (registrado em ${latest.d}).` +
        (ws.length > 1 ? ` Variação em 30 dias: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} kg.` : "") +
        (goal ? ` Meta declarada: ${goal} kg.` : "")
      );
    }
  }
  if (kinds["body"]?.length) {
    const b = (kinds["body"][0].payload as any) ?? {};
    lines.push(
      `COMPOSIÇÃO CORPORAL (estimativa visual por foto, margem larga): ~${b.body_fat_pct}% de gordura` +
      (b.lean_mass_kg ? `, ~${b.lean_mass_kg} kg de massa magra` : "") + `.`
    );
  }

  if (kinds["practice"]?.length) lines.push(`PRÁTICA ESPIRITUAL/MENTE: ${kinds["practice"].length} registros em 30 dias.`);

  // Diário — pensamentos recentes (a pessoa sabe que o Conselheiro vê o que ela registra)
  if (kinds["journal"]?.length) {
    const trechos = kinds["journal"].slice(0, 3)
      .map((e) => String((e.payload as any)?.text ?? "").slice(0, 160)).filter(Boolean)
      .map((t) => `"${t}"`).join(" | ");
    lines.push(`DIÁRIO: ${kinds["journal"].length} entradas em 30 dias.` +
      (trechos ? ` Trechos recentes: ${trechos}.` : ""));
  }
  if (kinds["meal"]?.length) {
    const last = kinds["meal"].slice(0, 6).map((e) => {
      const pl = (e.payload as any) ?? {};
      const kcal = Number(pl.calories);
      return pl.description ? `${pl.description}${kcal > 0 ? ` (~${Math.round(kcal)} kcal)` : ""}` : null;
    }).filter(Boolean).join("; ");
    const kcalVals = kinds["meal"].map((e) => Number((e.payload as any)?.calories)).filter((n) => n > 0);
    const kcalInfo = kcalVals.length
      ? ` Calorias estimadas registradas em ${kcalVals.length} refeições (média ~${Math.round(kcalVals.reduce((a, b) => a + b, 0) / kcalVals.length)} kcal/refeição — estimativas por foto, aproximadas).`
      : "";
    lines.push(`ALIMENTAÇÃO: ${kinds["meal"].length} refeições registradas em 30 dias. Últimas: ${last}.${kcalInfo}`);
  }

  // Hidratação (água) — total de hoje e média diária dos últimos 7 dias
  if (kinds["water"]?.length) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const since7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const ml = (e: any) => Number((e.payload as any)?.ml) || 0;
    const todayMl = kinds["water"].filter((e) => e.occurred_at.slice(0, 10) === todayStr).reduce((s, e) => s + ml(e), 0);
    const last7 = kinds["water"].filter((e) => e.occurred_at.slice(0, 10) >= since7);
    const days7 = new Set(last7.map((e) => e.occurred_at.slice(0, 10))).size || 1;
    const avg7 = Math.round(last7.reduce((s, e) => s + ml(e), 0) / days7);
    const goal = Number(p.water_goal_ml) || 0;
    lines.push(
      `HIDRATAÇÃO: hoje ${(todayMl / 1000).toFixed(1)}L${goal ? ` de uma meta de ${(goal / 1000).toFixed(1)}L` : ""}; ` +
      `média de ~${(avg7 / 1000).toFixed(1)}L/dia nos últimos 7 dias.`
    );
  }
  if (kinds["gratitude"]?.length) {
    const g = kinds["gratitude"].slice(0, 3).map((e) => (e.payload as any)?.text).filter(Boolean).join(" | ");
    if (g) lines.push(`GRATIDÃO recente: ${g}.`);
  }

  const totalXp = (xp ?? []).reduce((s, r) => s + r.points, 0);
  lines.push(`PROGRESSO: ${totalXp} XP acumulado (nível ${Math.floor(Math.sqrt(totalXp / 50)) + 1}).`);

  // Batalhas (somente as que a pessoa autorizou a IA a ver)
  for (const b of battles ?? []) {
    const cks = (bCheckins ?? []).filter((c) => c.battle_id === b.id);
    if (!cks.length) {
      lines.push(`BATALHA "${b.name}": recém-criada, sem check-ins ainda. Gatilhos mapeados: ${(b.triggers ?? []).join(", ") || "nenhum"}.`);
      continue;
    }
    const cleanTotal = cks.filter((c) => c.status !== "relapsed").length;
    const relapses = cks.filter((c) => c.status === "relapsed");
    const resisted = cks.filter((c) => c.status === "resisted").length;
    // streak atual: dias consecutivos sem recaída a partir do check-in mais recente
    let streak = 0;
    for (const c of cks) { if (c.status === "relapsed") break; streak++; }
    const relTriggers = relapses.map((c) => c.trigger_label).filter(Boolean).slice(0, 5).join(", ");
    lines.push(
      `BATALHA "${b.name}" (30d): sequência atual ${streak} dias sem recaída, ${cleanTotal} dias limpos no total, ` +
      `${resisted}x resistiu à vontade, ${relapses.length} recaídas` +
      (relTriggers ? ` (gatilhos das recaídas: ${relTriggers})` : "") +
      `. Últimos check-ins (recentes primeiro): ${cks.slice(0, 7).map((c) => c.status).join(", ")}.`
    );
  }

  return lines.join("\n");
}

/** Regras de segurança compartilhadas por todas as funções de IA. */
export const SAFETY_RULES = `
━━━ LIMITES INEGOCIÁVEIS ━━━
• Você NÃO é médico, nutricionista clínico, psicólogo nem consultor de investimentos. Nunca diagnostique doenças, nunca prescreva medicamentos ou dietas para condições clínicas, nunca substitua terapia.
• NUNCA recomende produtos de investimento específicos (CDB, Tesouro, ações, fundos, cripto etc.), corretoras ou projeções de rentabilidade — restrição regulatória. Explique conceitos em termos gerais apenas.
• Se a pessoa relatar sintomas de doença, oriente a procurar um médico. Se relatar sofrimento emocional intenso ou pensamentos de se machucar, acolha com seriedade e oriente a buscar ajuda profissional imediatamente — no Brasil, o CVV atende 24h pelo telefone 188.
• Sobre espiritualidade: acompanhe a prática que A PESSOA definiu, no vocabulário dela. Nunca sugira, compare ou julgue crenças.
• Nunca envergonhe a pessoa por uma semana ruim. Recaída é o caso normal. Sempre ofereça um próximo passo pequeno e possível.
━━━ BATALHAS (lutas pessoais: pornografia, redes sociais, cigarro, apostas etc.) ━━━
• Recaída se acolhe, nunca se julga. O dado importante da recaída é o gatilho — ajude a pessoa a enxergar o padrão (ex.: recaídas em noites de sono ruim, em dias de humor baixo, em madrugadas). Reforce que os dias limpos acumulados não se perdem.
• Ao notar padrão severo em batalhas de álcool, drogas ou apostas (recaídas quase diárias, sinais de abstinência física, dívidas ou perdas relevantes), diga com clareza e carinho que isso merece acompanhamento profissional e aponte caminhos concretos no Brasil: CAPS (unidades públicas de saúde mental), Alcoólicos Anônimos, Narcóticos Anônimos, Jogadores Anônimos. O Ascend é apoio, não tratamento.
• NUNCA trate comida como inimigo nem incentive "batalha contra comer". Se a pessoa enquadrar alimentação como guerra/restrição, redirecione com gentileza para hábitos positivos no pilar Alimentação (ex.: "fazer uma refeição de verdade") — guerra contra comida alimenta compulsão. Sinais de transtorno alimentar merecem indicação de profissional.`;
/* ─── Captura conversacional (compartilhada entre `capture` e `ai-chat`) ───
   Texto livre → eventos estruturados PROPOSTOS. O app sempre pede confirmação
   do usuário antes de gravar — a IA nunca grava sozinha. */

export const MUSCLE_GROUPS = ["Peito", "Costas", "Pernas", "Ombros", "Braços", "Core", "Cardio"];

export const CAPTURE_TOOL = {
  name: "registrar_eventos",
  description: "Registra os eventos de vida extraídos do relato do usuário.",
  input_schema: {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["transaction", "sleep", "workout", "meal", "water", "weight", "mood", "gratitude", "practice", "note"],
              description: "Tipo do evento.",
            },
            pillar: {
              type: "string",
              enum: ["prosperidade", "vitalidade", "alimentacao", "mente"],
              description:
                "Pilar: transaction→prosperidade; sleep/workout→vitalidade; " +
                "meal/water/weight→alimentacao; mood/gratitude/practice→mente.",
            },
            summary: { type: "string", description: "Resumo curto em português para o usuário confirmar. Ex.: 'Gasto de R$ 47 em Mercado' ou 'Treino de costas'." },
            amount: { type: "number", description: "Valor em reais (apenas para transaction)." },
            tx_kind: { type: "string", enum: ["income", "expense"], description: "Entrada ou saída (apenas para transaction)." },
            category: { type: "string", description: "Categoria da transação. Ex.: Mercado, Transporte, Lazer, Salário." },
            hours: { type: "number", description: "Horas de sono (apenas para sleep)." },
            description: { type: "string", description: "Descrição livre (refeição, treino, nota...)." },
            muscles: {
              type: "array",
              items: { type: "string", enum: MUSCLE_GROUPS },
              description:
                "APENAS para workout: grupos musculares trabalhados, SEMPRE inferidos do exercício. " +
                "Ex.: corrida/caminhada/pedal → ['Pernas','Cardio']; supino/flexão → ['Peito','Braços']; " +
                "puxada/remada → ['Costas','Braços']; agachamento/leg → ['Pernas']; natação → ['Costas','Ombros','Cardio']; " +
                "abdominal/prancha → ['Core']. Se o usuário disser o grupo ('treinei costas'), use-o diretamente.",
            },
            ml: { type: "number", description: "Mililitros de água (apenas para water). Ex.: 'bebi 2L' → 2000." },
            kg: { type: "number", description: "Peso corporal em kg (apenas para weight). Ex.: 'tô pesando 82' → 82." },
            mood_label: { type: "string", description: "Palavra do próprio usuário para o humor. Ex.: ansioso, animado, cansado." },
            mood_score: { type: "number", description: "Humor de 1 (péssimo) a 5 (ótimo), inferido do relato." },
          },
          required: ["kind", "pillar", "summary"],
        },
      },
    },
    required: ["events"],
  },
};

export const CAPTURE_SYSTEM = `Você extrai eventos estruturados de relatos do dia a dia de brasileiros, para a plataforma Ascend.
Regras:
• Extraia TODOS os eventos presentes no texto — um relato pode alimentar vários pilares de uma vez.
• Valores em reais: "47", "R$47", "quarenta e sete" → amount 47. Gastos são expense; salário/recebimentos são income.
• Sono mencionado ("dormi 5h", "dormi mal" → estime 5 e cite no summary que foi estimado) vira evento sleep.
• Menções a treino/exercício viram workout — SEMPRE preencha muscles inferindo os grupos do exercício (corrida → Pernas e Cardio; "treinei costas" → Costas). Inclua os grupos no summary. Ex.: "Treino de corrida (Pernas, Cardio)".
• Água bebida ("tomei 2L de água", "bebi 500ml") vira water com ml.
• Peso corporal ("me pesei, 78kg", "tô pesando 82") vira weight com kg.
• Refeições viram meal. Oração/meditação/culto/leitura espiritual viram practice.
• Estados emocionais ("tô ansioso", "dia ótimo") viram mood, usando a palavra do próprio usuário em mood_label.
• Se algo não se encaixar em nenhum tipo, use note.
• Se o texto não contiver nenhum evento registrável — perguntas, pedidos de conselho, conversa — retorne events: [].
• Só extraia o que a pessoa RELATOU ter acontecido. Planos e intenções ("vou treinar amanhã") não são eventos. Nunca invente eventos.
Use SEMPRE a ferramenta registrar_eventos.`;