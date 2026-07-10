// Módulo compartilhado das funções do Ascende
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicCall } from "./usage.ts";
import { spParts, spMonthStartUtc } from "./entitlements.ts";

// Defina o secret APP_ORIGIN para restringir quais sites chamam as funções pelo
// navegador. Aceita várias origens separadas por vírgula (ex.: produção + domínio
// próprio). Barras finais e espaços são normalizados automaticamente — o header
// Origin do navegador nunca tem barra no final. Sem o secret, fica aberto (dev).
const ALLOWED_ORIGINS = (Deno.env.get("APP_ORIGIN") ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const BASE_CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** Headers de CORS para ESTA requisição: reflete a origem se estiver na lista. */
export function corsFor(req: Request): Record<string, string> {
  if (!ALLOWED_ORIGINS.length) return { "Access-Control-Allow-Origin": "*", ...BASE_CORS };
  const origin = (req.headers.get("origin") ?? "").replace(/\/+$/, "");
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { "Access-Control-Allow-Origin": allow, ...BASE_CORS, Vary: "Origin" };
}

// Compatibilidade: headers estáticos (primeira origem da lista) para helpers sem acesso ao req.
export const corsHeaders: Record<string, string> = ALLOWED_ORIGINS.length
  ? { "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0], ...BASE_CORS, Vary: "Origin" }
  : { "Access-Control-Allow-Origin": "*", ...BASE_CORS };

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
    status: 401, headers: { ...corsFor(req), "Content-Type": "application/json" },
  });
  return data.user;
}

/**
 * Proteção de custo/abuso: no máximo `max` chamadas da função `fn` por usuário
 * na janela de `windowMin` minutos. Estourou, lança 429 com mensagem amigável.
 * Usa a tabela fn_calls (RLS sem policies: só o service role escreve/lê).
 */
export async function assertRateLimit(
  supabase: SupabaseClient, userId: string, fn: string, max: number, windowMin: number,
) {
  const since = new Date(Date.now() - windowMin * 60_000).toISOString();
  const { count, error } = await supabase.from("fn_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("fn", fn).gte("called_at", since);
  if (!error && (count ?? 0) >= max) {
    throw new Response(JSON.stringify({
      error: "Muitas solicitações em pouco tempo. Respire e tente de novo em alguns minutos.",
    }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  // Registra a chamada e faz uma limpeza barata do que passou de 1 dia
  await supabase.from("fn_calls").insert({ user_id: userId, fn });
  await supabase.from("fn_calls").delete()
    .eq("user_id", userId).eq("fn", fn)
    .lt("called_at", new Date(Date.now() - 864e5).toISOString());
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Monta um retrato compacto do usuário cruzando todos os pilares.
 * É este texto que dá ao Conselheiro a visão completa da vida da pessoa.
 */
export async function buildSnapshot(supabase: SupabaseClient, userId: string): Promise<string> {
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  // Fronteiras de dia/mês SEMPRE no fuso de São Paulo (plano §5.4)
  const todaySpIso = spParts().dateIso;
  const monthStartSpIso = spMonthStartUtc().slice(0, 10);

  const [{ data: profile }, { data: events }, { data: txs }, { data: habits }, xpTotalRes, { data: battles }, { data: bCheckins }, { data: plans }, { data: memories }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("life_events").select("pillar,kind,occurred_at,payload")
        .eq("user_id", userId).gte("occurred_at", since30)
        .order("occurred_at", { ascending: false }).limit(120),
      supabase.from("transactions").select("kind,amount,category,occurred_at")
        .eq("user_id", userId).gte("occurred_at", monthStartSpIso),
      supabase.from("habits").select("id,name,pillar").eq("user_id", userId).eq("active", true),
      supabase.rpc("xp_total", { uid: userId }),
      supabase.from("battles").select("id,name,triggers")
        .eq("user_id", userId).eq("active", true).eq("visible_to_ai", true),
      supabase.from("battle_checkins").select("battle_id,checkin_date,status,trigger_label")
        .eq("user_id", userId).gte("checkin_date", since30.slice(0, 10))
        .order("checkin_date", { ascending: false }),
      supabase.from("plans").select("title,kind,content,created_at")
        .eq("user_id", userId).eq("status", "ativo")
        .order("created_at", { ascending: false }).limit(3),
      supabase.from("ai_memories").select("content,category")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    ]);

  const lines: string[] = [];
  const p = profile ?? {};
  // Escopos de privacidade: quais áreas a pessoa autorizou o Conselheiro a analisar.
  const rawScopes = (p.ai_scopes ?? {}) as Record<string, unknown>;
  const scopes = {
    prosperidade: rawScopes.prosperidade !== false,
    vitalidade: rawScopes.vitalidade !== false,
    alimentacao: rawScopes.alimentacao !== false,
    mente: rawScopes.mente !== false,
    diario: rawScopes.diario !== false,
  };
  const disabled = Object.entries(scopes).filter(([, v]) => !v).map(([k]) => k);
  if (disabled.length) {
    lines.push(`PRIVACIDADE: a pessoa desativou a análise das áreas: ${disabled.join(", ")}. Esses dados foram omitidos deste retrato de propósito. Não especule sobre eles nem peça para reativar.`);
  }
  lines.push(`Nome: ${p.name || "não informado"}.`);
  if (p.goal) lines.push(`Objetivo declarado: ${p.goal}.`);
  lines.push(`Pilares ativos: ${(p.pillars ?? []).join(", ") || "nenhum ainda"}.`);

  // Dados pessoais (base de qualquer plano personalizado)
  const personal: string[] = [];
  const missing: string[] = [];
  if (p.birth_year && Number(p.birth_year) > 1900) {
    personal.push(`idade ~${new Date().getFullYear() - Number(p.birth_year)} anos`);
  } else missing.push("idade (ano de nascimento)");
  if (p.sex) personal.push(`sexo ${p.sex}`); else missing.push("sexo");
  if (p.height_cm && Number(p.height_cm) > 80) {
    personal.push(`altura ${Number(p.height_cm)} cm`);
  } else missing.push("altura");
  if (p.activity_level) personal.push(`nível de atividade ${p.activity_level}`);
  else missing.push("nível de atividade");
  const restrictions = Array.isArray(p.dietary_restrictions)
    ? (p.dietary_restrictions as unknown[]).map(String).filter(Boolean)
    : [];
  if (restrictions.length) personal.push(`restrições alimentares: ${restrictions.join(", ")}`);
  if (personal.length) lines.push(`Dados pessoais: ${personal.join("; ")}.`);
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
  const meds = Array.isArray(p.medications)
    ? (p.medications as unknown[]).map(String).filter(Boolean)
    : [];
  if (meds.length) {
    lines.push(
      `MEDICAMENTOS EM USO (informados pela pessoa): ${meds.join("; ")}. ` +
      `Considere possíveis implicações práticas (horários, alimentação, treino), mas NUNCA sugira alterar dose, trocar, iniciar ou parar medicamento: isso é exclusivo do prescritor. Em dúvida sobre interações, orientar a conversar com médico ou farmacêutico.`
    );
  }
  if (p.monthly_income) lines.push(`Renda mensal aproximada: ${BRL(Number(p.monthly_income))}.`);
  if (p.monthly_budget) lines.push(`Orçamento mensal desejado: ${BRL(Number(p.monthly_budget))}.`);

  // Finanças do mês
  if (scopes.prosperidade) {
  const income = (txs ?? []).filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expense = (txs ?? []).filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const byCat: Record<string, number> = {};
  for (const t of txs ?? []) if (t.kind === "expense") byCat[t.category] = (byCat[t.category] ?? 0) + Number(t.amount);
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, v]) => `${c} ${BRL(v)}`).join(", ");
  lines.push(`FINANÇAS (mês atual): entradas ${BRL(income)}, saídas ${BRL(expense)}, saldo ${BRL(income - expense)}.` +
    (topCats ? ` Maiores gastos: ${topCats}.` : ""));
  }

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

  if (scopes.vitalidade) {
  const sleeps = (kinds["sleep"] ?? []).map((e) => Number((e.payload as any)?.hours)).filter((n) => n > 0);
  if (sleeps.length) lines.push(`SONO NOTURNO: média de ${(sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(1)}h nos últimos ${sleeps.length} registros (sonecas contadas à parte).`);
  const naps = (kinds["nap"] ?? []).map((e) => Number((e.payload as any)?.hours)).filter((n) => n > 0);
  if (naps.length) lines.push(`SONECAS (30d): ${naps.length}, média de ${(naps.reduce((a, b) => a + b, 0) / naps.length).toFixed(1)}h cada.`);
  }

  if (scopes.mente) {
  const moods = (kinds["mood"] ?? []).slice(0, 10).map((e) => (e.payload as any)?.label ?? (e.payload as any)?.score).filter(Boolean);
  if (moods.length) lines.push(`HUMOR (mais recentes primeiro): ${moods.join(", ")}.`);
  }

  if (scopes.vitalidade && kinds["workout"]?.length) {
    const mCount: Record<string, number> = {};
    for (const e of kinds["workout"]) {
      for (const m of ((e.payload as any)?.muscles ?? []) as string[]) mCount[m] = (mCount[m] ?? 0) + 1;
    }
    const dist = Object.entries(mCount).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}x`).join(", ");
    const durations = kinds["workout"].map((e) => Number((e.payload as any)?.duration_min)).filter((n) => n > 0);
    const durInfo = durations.length
      ? ` Duração informada em ${durations.length} treinos (média ${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)} min).`
      : "";
    lines.push(`TREINOS nos últimos 30 dias: ${kinds["workout"].length}.` +
      (dist ? ` Grupos trabalhados: ${dist}.` : "") + durInfo);
  }

  // Peso e composição corporal
  if (scopes.alimentacao && kinds["weight"]?.length) {
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
  if (scopes.alimentacao && kinds["body"]?.length) {
    const b = (kinds["body"][0].payload as any) ?? {};
    lines.push(
      `COMPOSIÇÃO CORPORAL (estimativa visual por foto, margem larga): ~${b.body_fat_pct}% de gordura` +
      (b.lean_mass_kg ? `, ~${b.lean_mass_kg} kg de massa magra` : "") + `.`
    );
  }

  if (scopes.mente && kinds["practice"]?.length) lines.push(`PRÁTICA ESPIRITUAL/MENTE: ${kinds["practice"].length} registros em 30 dias.`);

  // Diário — pensamentos recentes (a pessoa sabe que o Conselheiro vê o que ela registra)
  if (scopes.diario && kinds["journal"]?.length) {
    const trechos = kinds["journal"].slice(0, 3)
      .map((e) => String((e.payload as any)?.text ?? "").slice(0, 160)).filter(Boolean)
      .map((t) => `"${t}"`).join(" | ");
    lines.push(`DIÁRIO: ${kinds["journal"].length} entradas em 30 dias.` +
      (trechos ? ` Trechos recentes: ${trechos}.` : ""));
  }
  if (scopes.alimentacao && kinds["meal"]?.length) {
    const last = kinds["meal"].slice(0, 6).map((e) => {
      const pl = (e.payload as any) ?? {};
      const kcal = Number(pl.calories);
      return pl.description ? `${pl.description}${kcal > 0 ? ` (~${Math.round(kcal)} kcal)` : ""}` : null;
    }).filter(Boolean).join("; ");
    const kcalVals = kinds["meal"].map((e) => Number((e.payload as any)?.calories)).filter((n) => n > 0);
    const kcalInfo = kcalVals.length
      ? ` Calorias estimadas registradas em ${kcalVals.length} refeições (média ~${Math.round(kcalVals.reduce((a, b) => a + b, 0) / kcalVals.length)} kcal/refeição — estimativas por foto, aproximadas).`
      : "";
    const typeCount: Record<string, number> = {};
    const TYPE_LABEL: Record<string, string> = { cafe_da_manha: "café da manhã", almoco: "almoço", jantar: "jantar", lanche: "lanche" };
    for (const e of kinds["meal"]) {
      const t = String((e.payload as any)?.meal_type ?? "");
      if (TYPE_LABEL[t]) typeCount[t] = (typeCount[t] ?? 0) + 1;
    }
    const typeInfo = Object.keys(typeCount).length
      ? ` Distribuição conhecida: ${Object.entries(typeCount).map(([t, n]) => `${TYPE_LABEL[t]} ${n}x`).join(", ")} (lanches não são refeições principais — considere isso ao avaliar a rotina).`
      : "";
    lines.push(`ALIMENTAÇÃO: ${kinds["meal"].length} refeições registradas em 30 dias. Últimas: ${last}.${kcalInfo}${typeInfo}`);

    // Meta calórica do dia (o Conselheiro deve saber quanto falta HOJE — em SP)
    const todayIso = todaySpIso;
    const kcalToday = kinds["meal"]
      .filter((e) => e.occurred_at.slice(0, 10) === todayIso)
      .reduce((sum, e) => sum + (Number((e.payload as any)?.calories) || 0), 0);
    const kcalGoal = Number(p.calorie_goal_kcal) || 0;
    if (kcalGoal > 0) {
      const diff = kcalGoal - kcalToday;
      lines.push(`META CALÓRICA DIÁRIA: ${kcalGoal} kcal. Hoje: ${Math.round(kcalToday)} kcal consumidas` +
        (diff > 0 ? `, faltam ${Math.round(diff)} kcal.` : `, meta do dia alcançada${diff < 0 ? ` (${Math.round(-diff)} kcal acima)` : ""}.`));
    } else if (kcalToday > 0) {
      lines.push(`CALORIAS HOJE: ${Math.round(kcalToday)} kcal registradas (sem meta diária definida — a pessoa pode definir na aba Alimentação ou você pode salvar via atualizar_perfil se ela declarar uma).`);
    }
    const protGoal = Number(p.protein_goal_g) || 0;
    if (protGoal > 0) {
      const protToday = kinds["meal"]
        .filter((e) => spParts(new Date(e.occurred_at)).dateIso === todayIso)
        .reduce((sum, e) => sum + (Number((e.payload as any)?.protein_g) || 0), 0);
      lines.push(`META DE PROTEÍNA DIÁRIA: ${protGoal} g. Hoje: ${Math.round(protToday)} g.`);
    }

    // Metas dos demais pilares (gasto do dia, treinos na semana, sono)
    const spendLimit = Number(p.daily_spend_limit) || 0;
    if (spendLimit > 0) {
      const spentToday = (txs ?? [])
        .filter((t: any) => t.kind === "expense" && String(t.occurred_at).slice(0, 10) === todayIso)
        .reduce((sum: number, t: any) => sum + Number(t.amount), 0);
      lines.push(`TETO DE GASTO DIÁRIO: ${BRL(spendLimit)}. Hoje: ${BRL(spentToday)} gastos` +
        (spentToday <= spendLimit ? ` (${BRL(spendLimit - spentToday)} disponíveis).` : ` (${BRL(spentToday - spendLimit)} acima do teto).`));
    }
    const wwGoal = Number(p.weekly_workouts_goal) || 0;
    if (wwGoal > 0) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // segunda-feira
      weekStart.setHours(0, 0, 0, 0);
      const workoutsWeek = (kinds["workout"] ?? []).filter((e) => new Date(e.occurred_at) >= weekStart).length;
      lines.push(`META DE TREINOS: ${wwGoal}/semana. Esta semana (desde segunda): ${workoutsWeek} treino(s)` +
        (workoutsWeek >= wwGoal ? " — meta da semana batida." : ` — faltam ${wwGoal - workoutsWeek}.`));
    }
    const sleepGoal = Number(p.sleep_goal_h) || 0;
    if (sleepGoal > 0) {
      const sleptToday = (kinds["sleep"] ?? [])
        .filter((e) => spParts(new Date(e.occurred_at)).dateIso === todayIso)
        .map((e) => Number((e.payload as any)?.hours) || 0)[0] ?? null;
      lines.push(`META DE SONO: ${sleepGoal}h/noite.` +
        (sleptToday !== null ? ` Última noite: ${sleptToday}h.` : " Sono de hoje ainda não registrado."));
    }
  }

  // Hidratação (água) — total de hoje e média diária dos últimos 7 dias
  if (scopes.alimentacao && kinds["water"]?.length) {
    const todayStr = todaySpIso;
    const since7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const ml = (e: any) => Number((e.payload as any)?.ml) || 0;
    const todayMl = kinds["water"].filter((e) => spParts(new Date(e.occurred_at)).dateIso === todayStr).reduce((s, e) => s + ml(e), 0);
    const last7 = kinds["water"].filter((e) => e.occurred_at.slice(0, 10) >= since7);
    const days7 = new Set(last7.map((e) => e.occurred_at.slice(0, 10))).size || 1;
    const avg7 = Math.round(last7.reduce((s, e) => s + ml(e), 0) / days7);
    const goal = Number(p.water_goal_ml) || 0;
    lines.push(
      `HIDRATAÇÃO: hoje ${(todayMl / 1000).toFixed(1)}L${goal ? ` de uma meta de ${(goal / 1000).toFixed(1)}L` : ""}; ` +
      `média de ~${(avg7 / 1000).toFixed(1)}L/dia nos últimos 7 dias.`
    );
  }
  if (scopes.mente && kinds["gratitude"]?.length) {
    const g = kinds["gratitude"].slice(0, 3).map((e) => (e.payload as any)?.text).filter(Boolean).join(" | ");
    if (g) lines.push(`GRATIDÃO recente: ${g}.`);
  }

  const totalXp = Number((xpTotalRes as { data?: unknown })?.data ?? 0);
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

    if (!kinds["weight"]?.length) missing.push("peso atual (registrar na aba Alimentação)");

  if (missing.length) {
    lines.push(
      `DADOS IMPORTANTES AINDA NÃO PREENCHIDOS: ${missing.join("; ")}. ` +
      `Para planos definitivos (alimentar, treino, financeiro), siga o protocolo de planos do seu prompt: peça o que falta antes de gerar. ` +
      `Onde preencher: idade, sexo, altura, atividade e restrições em Ajustes (seção "Sobre você"); peso na aba Alimentação; condições e medicamentos na Vitalidade.`
    );
  }

  // Memória do Conselheiro: nuances aprendidas em conversas anteriores
  const mems = (memories ?? []) as { content: string; category: string }[];
  if (mems.length) {
    lines.push(
      `O QUE VOCÊ JÁ APRENDEU SOBRE A PESSOA em conversas anteriores (memórias — use com naturalidade para personalizar respostas e planos; NÃO recite a lista de volta nem soe como vigilância):`
    );
    for (const m of mems) lines.push(`• [${m.category}] ${m.content}`);
  }

  // Planos ativos (entregas anteriores do Conselheiro que a pessoa salvou)
  const activePlans = (plans ?? []) as { title: string; kind: string; content: string; created_at: string }[];
  if (activePlans.length) {
    lines.push(`PLANOS ATIVOS SALVOS (acompanhe a adesão e mantenha coerência com eles):`);
    activePlans.forEach((pl, i) => {
      const when = String(pl.created_at).slice(0, 10);
      if (i < 2) {
        lines.push(`• "${pl.title}" (${pl.kind}, criado em ${when}): ${pl.content.slice(0, 600)}${pl.content.length > 600 ? "…" : ""}`);
      } else {
        lines.push(`• "${pl.title}" (${pl.kind}, criado em ${when}).`);
      }
    });
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
• Ao notar padrão severo em batalhas de álcool, drogas ou apostas (recaídas quase diárias, sinais de abstinência física, dívidas ou perdas relevantes), diga com clareza e carinho que isso merece acompanhamento profissional e aponte caminhos concretos no Brasil: CAPS (unidades públicas de saúde mental), Alcoólicos Anônimos, Narcóticos Anônimos, Jogadores Anônimos. O Ascende é apoio, não tratamento.
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
              enum: ["transaction", "sleep", "nap", "workout", "meal", "water", "weight", "mood", "gratitude", "practice", "note"],
              description: "Tipo do evento.",
            },
            pillar: {
              type: "string",
              enum: ["prosperidade", "vitalidade", "alimentacao", "mente"],
              description:
                "Pilar: transaction→prosperidade; sleep/nap/workout→vitalidade; " +
                "meal/water/weight→alimentacao; mood/gratitude/practice→mente.",
            },
            summary: { type: "string", description: "Resumo curto em português para o usuário confirmar. Ex.: 'Gasto de R$ 47 em Mercado' ou 'Treino de costas'." },
            amount: { type: "number", description: "Valor em reais (apenas para transaction)." },
            tx_kind: { type: "string", enum: ["income", "expense"], description: "Entrada ou saída (apenas para transaction)." },
            category: { type: "string", description: "Categoria da transação. Ex.: Mercado, Transporte, Lazer, Salário." },
            hours: { type: "number", description: "Horas dormidas (para sleep e nap). '40 minutos' vira 0.7." },
            calories: { type: "number", description: "APENAS para meal: estimativa de calorias da refeição descrita. SEMPRE estime, assumindo porções típicas brasileiras." },
            protein_g: { type: "number", description: "APENAS para meal: proteína estimada em gramas, quando possível." },
            carbs_g: { type: "number", description: "APENAS para meal: carboidratos estimados em gramas, quando possível." },
            fat_g: { type: "number", description: "APENAS para meal: gorduras estimadas em gramas, quando possível." },
            meal_type: {
              type: "string", enum: ["cafe_da_manha", "almoco", "jantar", "lanche"],
              description: "APENAS para meal: tipo da refeição, inferido do que a pessoa disse ('no almoço...', 'de manhã comi...', 'beliscei...'). Omita se não der para saber.",
            },
            duration_min: { type: "number", description: "APENAS para workout: duração em minutos, se mencionada ('corri 40 min' → 40)." },
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

export const CAPTURE_SYSTEM = `Você extrai eventos estruturados de relatos do dia a dia de brasileiros, para a plataforma Ascende.
Regras:
• Extraia TODOS os eventos presentes no texto — um relato pode alimentar vários pilares de uma vez.
• Valores em reais: "47", "R$47", "quarenta e sete" → amount 47. Gastos são expense; salário/recebimentos são income.
• Sono NOTURNO ("dormi 5h", "dormi mal" → estime 5 e cite no summary que foi estimado) vira sleep. Sonecas e cochilos ("tirei uma soneca", "cochilei 40 min", "dormi depois do almoço") viram nap com hours; NUNCA registre soneca como sleep — são coisas diferentes com pesos diferentes. Na dúvida entre noite e soneca, o horário e o contexto decidem (dormir "depois do almoço" é soneca).
• Menções a treino/exercício viram workout — SEMPRE preencha muscles inferindo os grupos do exercício (corrida → Pernas e Cardio; "treinei costas" → Costas). Inclua os grupos no summary. Ex.: "Treino de corrida (Pernas, Cardio)".
• Se a duração do treino for mencionada, preencha duration_min.
• Água bebida ("tomei 2L de água", "bebi 500ml") vira water com ml.
• Peso corporal ("me pesei, 78kg", "tô pesando 82") vira weight com kg.
• Refeições viram meal e SEMPRE recebem calories estimadas a partir da descrição (porções típicas brasileiras; melhor uma estimativa honesta do que nenhuma), preenchendo também protein_g/carbs_g/fat_g quando possível. Inclua as kcal no summary: "Almoço: arroz, feijão e frango (~650 kcal)". Quando o contexto disser qual refeição é (café da manhã, almoço, jantar, lanche/belisco), preencha meal_type e inclua no summary. Oração/meditação/culto/leitura espiritual viram practice.
• Estados emocionais ("tô ansioso", "dia ótimo") viram mood, usando a palavra do próprio usuário em mood_label.
• Se algo não se encaixar em nenhum tipo, use note.
• Se o texto não contiver nenhum evento registrável — perguntas, pedidos de conselho, conversa — retorne events: [].
• Só extraia o que a pessoa RELATOU ter acontecido. Planos e intenções ("vou treinar amanhã") não são eventos. Nunca invente eventos.
Use SEMPRE a ferramenta registrar_eventos.`;
/* ─── Memória do Conselheiro (compartilhada entre `ai-chat` e `capture`) ───
   A cada mensagem do usuário, um modelo rápido extrai NUANCES DURÁVEIS sobre
   a pessoa (preferências, rotina, contexto, motivações, jeito de ser) e as
   grava em ai_memories. É isso que faz a IA "aprender" de verdade a cada
   conversa: as memórias entram no retrato (buildSnapshot) de todas as
   funções de IA. O app mostra ao usuário o que foi aprendido em cada
   mensagem, e ele pode ver e apagar tudo em Ajustes. */

export const MEMORY_CATEGORIES = ["preferencia", "rotina", "contexto", "motivacao", "personalidade", "outro"];
const MEMORY_MAX_PER_USER = 150;
const MEMORY_MAX_PER_MESSAGE = 3;

const MEMORY_TOOL = {
  name: "guardar_memorias",
  description: "Guarda nuances duráveis aprendidas sobre a pessoa nesta mensagem. Retorne memories: [] quando não houver nada durável.",
  input_schema: {
    type: "object",
    properties: {
      memories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "A nuance, em UMA frase curta em português, na 3ª pessoa implícita. Ex.: 'Não gosta de agachamento', 'Trabalha em turno noturno', 'Prefere respostas diretas e curtas'. Máx. 160 caracteres.",
            },
            category: {
              type: "string",
              enum: MEMORY_CATEGORIES,
              description: "preferencia (gostos e aversões) | rotina (horários, hábitos de vida) | contexto (família, trabalho, moradia) | motivacao (o que move a pessoa) | personalidade (jeito de ser e de se comunicar) | outro.",
            },
            replaces_id: {
              type: "string",
              description: "APENAS se esta memória ATUALIZA ou CONTRADIZ uma memória existente: o id exato dela (da lista fornecida). A antiga será substituída.",
            },
          },
          required: ["content", "category"],
        },
      },
    },
    required: ["memories"],
  },
};

const MEMORY_SYSTEM = `Você é a memória de longo prazo do Ascende, uma plataforma brasileira de qualidade de vida. Sua única tarefa: ler UMA mensagem do usuário e decidir se ela revela algo DURÁVEL sobre quem ele é — algo que continuará verdadeiro daqui a semanas e tornará as próximas conversas mais pessoais.

GUARDE (exemplos):
• Preferências e aversões estáveis: "odeio brócolis", "não gosto de academia lotada", "prefiro treinar de manhã".
• Rotina e estrutura de vida: "trabalho em escala 12x36", "acordo às 5h", "só cozinho no domingo".
• Contexto de vida: "tenho dois filhos pequenos", "moro sozinho", "sou autônomo", "cuido da minha mãe".
• Motivações e valores declarados: "quero ter energia para brincar com meus filhos".
• Jeito de ser/comunicar declarado: "vai direto ao ponto comigo", "gosto de entender o porquê das coisas".

NÃO GUARDE:
• Eventos pontuais do dia (gastos, treinos, refeições, sono, humor de hoje) — outro sistema cuida disso.
• Dados de perfil estruturado (idade, sexo, altura, peso, restrições alimentares, condições de saúde, medicamentos, renda, metas numéricas) — outro sistema cuida disso.
• Deduções sensíveis não declaradas (religião, orientação sexual, política, diagnósticos). Só o que a pessoa DISSE sobre si.
• Julgamentos de valor sobre a pessoa. Descreva, nunca avalie.
• Nada que a pessoa pediu para esquecer ou que soe como segredo dito de passagem sobre TERCEIROS.

REGRAS:
• Só o explícito ou claramente implicado pela PRÓPRIA pessoa na mensagem.
• Máximo ${MEMORY_MAX_PER_MESSAGE} memórias por mensagem; a maioria das mensagens não gera NENHUMA (retorne memories: []). Perguntas genéricas, pedidos de informação e relatos puramente factuais do dia raramente geram memória.
• Não repita nem parafraseie memórias que já existem na lista fornecida. Se a mensagem ATUALIZA ou CONTRADIZ uma existente ("voltei a gostar de correr"), envie a nova com replaces_id apontando para a antiga.
• Cada memória: uma frase autossuficiente, curta, sem "O usuário" no início ("Não gosta de agachamento", não "O usuário não gosta de agachamento").
Use SEMPRE a ferramenta guardar_memorias.`;

/* ─── Mensagens triviais: não gastam chamadas de captura/memória ─── */
const TRIVIAL_PATTERNS = [
  /^(obrigad[oa]s?|valeu|vlw|blz|beleza|ok(ay)?|t[áa] bom|show|top|legal|perfeito|entendi|sim|n[ãa]o|talvez)[.!\s]*$/i,
  /^(pode continuar|continua|continue|prossiga|segue|manda|vai)[.!\s]*$/i,
  /^(explique? (de novo|novamente|melhor)|repete|repita|como assim|n[ãa]o entendi)[.!?\s]*$/i,
  /^(oi+|ol[áa]|bom dia|boa tarde|boa noite|e a[íi]|hey|opa|fala)[.!,\s]*$/i,
  /^(quantas? calorias? tem|o que [ée]|qual [ée] a diferen[çc]a)/i,
];
export function isTrivialMessage(text: string): boolean {
  const t = String(text ?? "").trim();
  if (t.length < 8) return true;
  if (t.length <= 120 && TRIVIAL_PATTERNS.some((re) => re.test(t))) return true;
  return false;
}

/** Persiste memórias extraídas (dedupe, substituição e teto por plano). */
async function persistMemories(
  supabase: SupabaseClient, userId: string,
  // deno-lint-ignore no-explicit-any
  raw: any[], known: { id: string; content: string }[], memoryCap: number,
): Promise<{ content: string; category: string }[]> {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  const knownNorm = new Set(known.map((m) => norm(m.content)));
  const knownIds = new Set(known.map((m) => m.id));
  const learned: { content: string; category: string }[] = [];

  for (const m of (raw ?? []).slice(0, MEMORY_MAX_PER_MESSAGE)) {
    const content = String(m?.content ?? "").trim().slice(0, 160);
    if (content.length < 3) continue;
    const category = MEMORY_CATEGORIES.includes(String(m?.category)) ? String(m.category) : "outro";
    const n = norm(content);
    if (knownNorm.has(n)) continue;
    knownNorm.add(n);

    const replacesId = typeof m?.replaces_id === "string" && knownIds.has(m.replaces_id) ? m.replaces_id : null;
    if (replacesId) {
      const { error } = await supabase.from("ai_memories")
        .update({ content, category, updated_at: new Date().toISOString() })
        .eq("id", replacesId).eq("user_id", userId);
      if (error) console.error("memories: falha ao atualizar", error.message ?? error);
      else learned.push({ content, category });
    } else {
      // Teto por plano: no limite, não cria memórias novas (as antigas ficam).
      if (known.length + learned.length >= memoryCap) continue;
      const { error } = await supabase.from("ai_memories")
        .insert({ user_id: userId, content, category });
      if (error) console.error("memories: falha ao inserir", error.message ?? error);
      else learned.push({ content, category });
    }
  }

  if (learned.length) {
    const { count } = await supabase.from("ai_memories")
      .select("id", { count: "exact", head: true }).eq("user_id", userId);
    const excess = (count ?? 0) - memoryCap;
    if (excess > 0) {
      const { data: oldest } = await supabase.from("ai_memories")
        .select("id").eq("user_id", userId)
        .order("created_at", { ascending: true }).limit(excess);
      const ids = (oldest ?? []).map((o) => o.id);
      if (ids.length) await supabase.from("ai_memories").delete().in("id", ids);
    }
  }
  return learned;
}

async function loadKnownMemories(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from("ai_memories")
    .select("id,content").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(80);
  if (error) {
    console.error("memories: falha ao ler ai_memories", error.message ?? error);
    return null;
  }
  return (data ?? []) as { id: string; content: string }[];
}

const memoriesBlock = (known: { id: string; content: string }[]) =>
  known.length
    ? `MEMÓRIAS JÁ EXISTENTES (não repita; use replaces_id do item que for atualizado):\n${known.map((m) => `- [id: ${m.id}] ${m.content}`).join("\n")}`
    : "Ainda não há memórias sobre esta pessoa.";

/**
 * Aprende com a mensagem do usuário (memórias duráveis). Pula mensagens
 * triviais, respeita o teto de memórias do plano e registra o consumo em
 * ai_usage sob a feature informada. Nunca lança: falha devolve [].
 */
export async function learnFromMessage(
  supabase: SupabaseClient, userId: string, message: string,
  feature = "memorias", memoryCap = 150,
): Promise<{ content: string; category: string }[]> {
  try {
    const text = String(message ?? "").trim();
    if (isTrivialMessage(text)) return [];
    const known = await loadKnownMemories(supabase, userId);
    if (known === null) return [];

    const { res, data } = await anthropicCall(supabase, userId, feature, {
      model: MODEL_FAST,
      max_tokens: 700,
      system: MEMORY_SYSTEM,
      tools: [MEMORY_TOOL],
      tool_choice: { type: "tool", name: "guardar_memorias" },
      messages: [{
        role: "user",
        content: `${memoriesBlock(known)}\n\nMENSAGEM DO USUÁRIO:\n${text.slice(0, 4000)}`,
      }],
    });
    if (!res.ok || !data) return [];
    // deno-lint-ignore no-explicit-any
    const tu = ((data as any).content ?? []).find((b: any) => b.type === "tool_use");
    const raw = Array.isArray(tu?.input?.memories) ? tu.input.memories : [];
    return await persistMemories(supabase, userId, raw, known, memoryCap);
  } catch (e) {
    console.error("memories: erro inesperado", e);
    return [];
  }
}

/* ─── Extração COMBINADA: eventos + memórias em UMA chamada ───────
   Reduz chamadas secundárias (plano, seção 9.2). Usada por `capture`
   e `ai-chat`. Mensagens triviais não geram chamada nenhuma. */

const COMBINED_TOOL = {
  name: "extrair_registros_e_memorias",
  description: "Extrai do relato do usuário: (a) eventos de vida registráveis e (b) nuances duráveis para a memória. Retorne arrays vazios quando não houver nada.",
  input_schema: {
    type: "object",
    properties: {
      events: (CAPTURE_TOOL.input_schema.properties as Record<string, unknown>).events,
      memories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "Nuance durável em UMA frase curta (máx. 160 caracteres), 3ª pessoa implícita." },
            category: { type: "string", enum: MEMORY_CATEGORIES },
            replaces_id: { type: "string", description: "APENAS se atualiza/contradiz uma memória existente: o id exato dela." },
          },
          required: ["content", "category"],
        },
      },
    },
    required: ["events", "memories"],
  },
};

export async function extractEventsAndMemories(
  supabase: SupabaseClient, userId: string, text: string,
  feature: string, memoryCap = 150,
  opts: { reservationId?: number | null } = {},
  // deno-lint-ignore no-explicit-any
): Promise<{ ok: boolean; events: any[]; learned: { content: string; category: string }[] }> {
  try {
    const t = String(text ?? "").trim();
    if (isTrivialMessage(t)) return { ok: true, events: [], learned: [] };
    const known = (await loadKnownMemories(supabase, userId)) ?? [];

    const { res, data } = await anthropicCall(supabase, userId, feature, {
      model: MODEL_FAST,
      max_tokens: 1800,
      system: `${CAPTURE_SYSTEM}\n\n━━━ MEMÓRIA DE LONGO PRAZO ━━━\n${MEMORY_SYSTEM.split("Use SEMPRE a ferramenta")[0]}\nUse SEMPRE a ferramenta extrair_registros_e_memorias, preenchendo events E memories (vazios quando não houver).`,
      tools: [COMBINED_TOOL],
      tool_choice: { type: "tool", name: "extrair_registros_e_memorias" },
      messages: [{
        role: "user",
        content: `${memoriesBlock(known)}\n\nRELATO DO USUÁRIO:\n${t.slice(0, 4000)}`,
      }],
    }, { reservationId: opts.reservationId ?? null });
    if (!res.ok || !data) return { ok: false, events: [], learned: [] };
    // deno-lint-ignore no-explicit-any
    const tu = ((data as any).content ?? []).find((b: any) => b.type === "tool_use");
    const events = Array.isArray(tu?.input?.events) ? tu.input.events : [];
    const rawMems = Array.isArray(tu?.input?.memories) ? tu.input.memories : [];
    const learned = await persistMemories(supabase, userId, rawMems, known, memoryCap);
    return { ok: true, events, learned };
  } catch (e) {
    console.error("extração combinada: erro inesperado", e);
    return { ok: false, events: [], learned: [] };
  }
}