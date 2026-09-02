// Módulo compartilhado das funções do Ascende
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicCall } from "./usage.ts";
import { spParts, spMonthStartUtc, spWeekStartUtc } from "./entitlements.ts";

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
 *
 * Endurecido (auditoria, achado 3):
 * • ATÔMICO — contagem e registro acontecem sob advisory lock no banco
 *   (reserve_fn_call), então N requisições simultâneas não passam mais juntas.
 * • FAIL-CLOSED — a versão anterior fazia `if (!error && count >= max)`: erro
 *   de banco liberava a chamada. Agora erro vira 503 e interrompe.
 */
export async function assertRateLimit(
  supabase: SupabaseClient, userId: string, fn: string, max: number, windowMin: number,
) {
  const { data, error } = await supabase.rpc("reserve_fn_call", {
    uid: userId, fn_name: fn, max_calls: max, window_min: windowMin,
  });
  if (error) {
    console.error("assertRateLimit", fn, error.message ?? error);
    throw new Response(JSON.stringify({
      error: "Não consegui validar sua solicitação agora. Tente novamente em instantes.",
      code: "RATE_CHECK_UNAVAILABLE",
    }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (data !== true) {
    throw new Response(JSON.stringify({
      error: "Muitas solicitações em pouco tempo. Respire e tente de novo em alguns minutos.",
    }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

/* ═══ MEMÓRIA CONTROLÁVEL (Fase 2) ═══════════════════════════════════════
   Antes, ai_memories era uma lista plana que só a IA escrevia e ninguém podia
   corrigir: o retrato lia tudo, sem filtro, sem saber o que a pessoa havia
   confirmado ou rejeitado. O contrato da fase separa três coisas que estavam
   juntas: se a memória VALE (status/validade), o quanto ela é CONFIÁVEL
   (confidence) e QUEM a afirmou (created_by).

   REGRA DE LEITURA (única, vale para todo lugar que lê memória):
     status <> 'rejeitada' AND status <> 'expirada'
     AND (valid_until is null OR valid_until > now())

   E memória confirmada PELA PESSOA vale mais que memória inferida pela IA:
   vai na frente do retrato e é marcada como tal, para o modelo não confundir
   o que ela afirmou com o que ele deduziu. */

export interface MemoryRow {
  id: string;
  content: string;
  category: string;
  status?: string | null;
  created_by?: string | null;
  confidence?: number | null;
  valid_until?: string | null;
}

/** A REGRA DE LEITURA, num único lugar testável. Vale para o retrato e para
 *  qualquer outro ponto que leia memória. */
export function isMemoryReadable(m: MemoryRow, now = new Date()): boolean {
  if (m.status === "rejeitada" || m.status === "expirada") return false;
  if (m.valid_until == null) return true;
  const until = new Date(String(m.valid_until)).getTime();
  // Data ilegível não pode esconder memória válida: na dúvida, ela vale.
  if (!Number.isFinite(until)) return true;
  return until > now.getTime();
}

/** Memória confirmada pela pessoa (ou escrita por ela). É intocável para a IA. */
export const isUserOwnedMemory = (m: MemoryRow) =>
  m.status === "confirmada" || m.created_by === "usuario";

/** A view já ordena por trust_rank (confirmada antes de ativa). Isto refina:
 *  memória que a PRÓPRIA PESSOA escreveu (created_by='usuario') é palavra dela
 *  também, mesmo com status 'ativa', e o trust_rank olha só o status. Ordenação
 *  estável, então a ordem da view é preservada dentro de cada grupo. */
const byUserFirst = (rows: MemoryRow[]) => [
  ...rows.filter(isUserOwnedMemory),
  ...rows.filter((m) => !isUserOwnedMemory(m)),
];

/* A migração da Fase 2 (colunas status/created_by/confidence/valid_until) é
   entregue à parte. Enquanto ela não estiver aplicada, o select das colunas
   novas falha — e memória sumindo do retrato seria uma regressão silenciosa
   pior que a ausência do filtro. Então: tenta o formato novo e, se o banco
   ainda não o tiver, cai no antigo. Sai quando a migração estiver em produção. */
const MEMORY_COLS_VIEW = "id,content,category,status,created_by,confidence,valid_until,trust_rank";
const MEMORY_COLS_TABLE = "id,content,category,status,created_by,confidence,valid_until";
const MEMORY_COLS_LEGACY = "id,content,category";

async function selectMemories(
  supabase: SupabaseClient, userId: string, limit: number,
): Promise<MemoryRow[]> {
  /* Fonte única: a view ai_memories_vigentes já aplica a REGRA DE LEITURA em
     SQL e traz trust_rank (0 = confirmada pela pessoa, 1 = resto). Reescrever
     o filtro aqui era a duplicação que a view existe para evitar — e deixa o
     `valid_until > now()` no banco, onde não depende de parse de data nem de
     interpolar timestamp na microssintaxe de filtro do PostgREST. */
  const view = await supabase.from("ai_memories_vigentes")
    .select(MEMORY_COLS_VIEW)
    .eq("user_id", userId)
    .order("trust_rank", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!view.error) return (view.data ?? []) as MemoryRow[];

  /* A migração da Fase 2 é entregue à parte. Enquanto a view não existir,
     degradamos em dois passos — e memória sumindo do retrato seria uma
     regressão pior que a ausência do filtro, então nunca falhamos para vazio
     enquanto houver como ler. Este bloco sai quando a migração estiver em
     produção. */
  console.error("memories: view vigentes indisponível, degradando", view.error.message ?? view.error);
  const table = await supabase.from("ai_memories")
    .select(MEMORY_COLS_TABLE)
    .eq("user_id", userId)
    .not("status", "in", '("rejeitada","expirada")')
    .order("created_at", { ascending: false }).limit(limit);
  if (!table.error) {
    // Sem a view, a validade volta a ser decidida aqui.
    return ((table.data ?? []) as MemoryRow[]).filter((m) => isMemoryReadable(m));
  }

  const legacy = await supabase.from("ai_memories")
    .select(MEMORY_COLS_LEGACY)
    .eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(limit);
  if (legacy.error) {
    console.error("memories: falha ao ler ai_memories", legacy.error.message ?? legacy.error);
    return [];
  }
  return (legacy.data ?? []) as MemoryRow[];
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

  const [{ data: profile }, { data: events }, { data: txs }, { data: habits }, xpTotalRes, { data: battles }, { data: bCheckins }, { data: plans }, memoriesRaw, { data: estimates }, { data: recurrings }] =
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
      selectMemories(supabase, userId, 50),
      supabase.from("category_estimates").select("category,amount").eq("user_id", userId),
      supabase.from("recurring_transactions").select("kind,amount,category,description,active")
        .eq("user_id", userId).eq("active", true),
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
  // Modularidade total (nível tracker): o que a pessoa ESCOLHEU não acompanhar.
  // Regra inegociável para quem lê este retrato (briefing, Conselheiro,
  // retrospectiva): nunca cobrar registro, sugerir meta ou propor hábito
  // dessas áreas — a escolha dela é parte do produto, não uma lacuna.
  const TRACKER_LABEL: Record<string, string> = {
    water: "água/hidratação", meals: "refeições e calorias", protein: "proteína",
    weight: "peso e corpo", sleep: "sono", naps: "sonecas", workouts: "treinos",
    mood: "humor", practice: "prática (espiritual/mente)", journal: "diário",
    gratitude: "gratidão", spend_limit: "teto de gasto diário",
  };
  const trackingPrefs = (p.tracking_prefs ?? {}) as Record<string, unknown>;
  const offTrackers = Object.keys(TRACKER_LABEL)
    .filter((k) => trackingPrefs[k] === false)
    .map((k) => TRACKER_LABEL[k]);
  if (offTrackers.length) {
    lines.push(
      `NÃO ACOMPANHA (escolha deliberada da pessoa em Ajustes): ${offTrackers.join(", ")}. ` +
      `NUNCA cobre registros, sugira metas, proponha hábitos ou lamente a falta de dados dessas áreas — a menos que a pessoa peça explicitamente. Isso não é lacuna, é escolha.`
    );
  }
  lines.push(`Nome: ${p.name || "não informado"}.`);
  // Contexto de onboarding: uma conta nova que acabou de montar o Blueprint
  // é MUITO diferente de uma conta antiga sem dados. Sem esta linha, o
  // briefing tratava um retrato recém-preenchido como abandono.
  if (p.blueprint_generated_at) {
    const genMs = new Date(String(p.blueprint_generated_at)).getTime();
    const hoursAgo = Number.isFinite(genMs) ? Math.floor((Date.now() - genMs) / 3_600_000) : null;
    lines.push(
      `ONBOARDING: a pessoa concluiu o onboarding completo e gerou o Blueprint da Subida` +
      (hoursAgo !== null && hoursAgo < 48 ? ` há ${hoursAgo < 1 ? "menos de uma hora" : `${hoursAgo}h`}` : "") +
      `. Os dados abaixo foram declarados por ela ali. Reconheça esse esforço quando fizer sentido e NUNCA sugira que ela "não preencheu" ou "pulou" o que aparece preenchido aqui.`
    );
  }
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
  if (p.est_food_spend) {
    lines.push(
      `ESTIMATIVA DECLARADA: gasta ~${BRL(Number(p.est_food_spend))}/mês com comida (mercado + fora de casa). ` +
      `É premissa, não registro — o real do mês substitui, nunca soma. É a base do "plano alimentar que cabe no bolso": qualquer plano alimentar deve caber nesse valor (ou declarar por que não cabe).`
    );
  }

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

  // Camada 2: fixos recorrentes (compromissos do mês, cadastrados uma vez)
  const recs = (recurrings ?? []) as { kind: string; amount: number; category: string; description: string | null }[];
  if (recs.length) {
    const recExp = recs.filter((r) => r.kind === "expense");
    const recInc = recs.filter((r) => r.kind === "income");
    if (recExp.length) {
      const recTotal = recExp.reduce((s, r) => s + Number(r.amount), 0);
      const recList = recExp.slice(0, 8)
        .map((r) => `${r.description || r.category} ${BRL(Number(r.amount))}`).join(", ");
      lines.push(`GASTOS FIXOS RECORRENTES: ${BRL(recTotal)}/mês comprometidos (${recList}). Já estão materializados nas saídas do mês.`);
    }
    if (recInc.length) {
      const incTotal = recInc.reduce((s, r) => s + Number(r.amount), 0);
      const incList = recInc.slice(0, 4)
        .map((r) => `${r.description || r.category} ${BRL(Number(r.amount))}`).join(", ");
      lines.push(`ENTRADAS FIXAS RECORRENTES: ${BRL(incTotal)}/mês (${incList}). Já materializadas nas entradas do mês — é a mesma renda da "renda mensal aproximada" acima, vista por outro caminho: NUNCA some as duas.`);
    }
  }

  // Camada 1: estimativas declaradas pela pessoa (Raio-X). São PREMISSAS,
  // não registros — o real do mês substitui a estimativa, nunca soma.
  const ests = (estimates ?? []) as { category: string; amount: number }[];
  if (ests.length) {
    const estList = ests.slice(0, 8).map((e) => `${e.category} ~${BRL(Number(e.amount))}/mês`).join(", ");
    lines.push(
      `ESTIMATIVAS DECLARADAS PELA PESSOA (não são registros): ${estList}. ` +
      `Use-as como premissas quando os registros reais do mês forem escassos, citando a origem ("com base na sua estimativa de mercado..."), em vez de dizer que faltam dados. ` +
      `Regra de composição por categoria: considere max(gasto real do mês, estimativa) — nunca some os dois. ` +
      `Para o "plano alimentar que cabe no bolso", a estimativa de Mercado/Alimentação fora é base suficiente para uma primeira versão com premissas declaradas.`
    );
  }
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
  } else {
    lines.push(
      "COMPROMISSOS DIÁRIOS (hábitos): nenhum ainda — de propósito, o Ascende não impõe lista pronta. " +
      "Se fizer sentido na conversa (a pessoa pedir rotina, ou você entregar um plano), proponha 1 a 3 " +
      "compromissos pequenos derivados da meta dela via propor_habitos."
    );
  }

  // Silêncio e retorno (plano de feedbacks, Sugestão 3): o retrato precisa
  // saber lidar com o vazio — é quando a pessoa mais precisa dele. Quem lê
  // este retrato (briefing, retrospectiva, Conselheiro) recebe a instrução
  // de acolher o retorno, nunca de cobrar.
  const lastEventAt = (events ?? [])[0]?.occurred_at ? new Date(String((events ?? [])[0].occurred_at)).getTime() : null;
  if (!lastEventAt) {
    lines.push(
      `SILÊNCIO: nenhum registro nos últimos 30 dias. Se houver histórico antigo, trate como um RETORNO: acolha sem cobrança, não cite sequência perdida nem liste o que "faltou". O primeiro registro de volta vale por dez — diga isso, e proponha UM passo pequeno.`
    );
  } else {
    const gapDays = Math.floor((Date.now() - lastEventAt) / 864e5);
    if (gapDays >= 7) {
      lines.push(
        `RETORNO APÓS SILÊNCIO: a pessoa ficou ${gapDays} dias sem registrar e está de volta agora. Acolha o retorno sem culpa e sem auditoria do período: nada aqui expirou (planos e compromissos continuam valendo). Não mencione sequência perdida. Proponha UM recomeço pequeno, partindo de onde ela parou.`
      );
    }
  }

  // Sono, humor, treinos, refeições, práticas — médias e últimos registros
  const kinds: Record<string, any[]> = {};
  for (const e of events ?? []) (kinds[e.kind] ??= []).push(e);

  if (scopes.vitalidade) {
  const sleeps = (kinds["sleep"] ?? []).map((e) => Number((e.payload as any)?.hours)).filter((n) => n > 0);
  if (sleeps.length) lines.push(`SONO NOTURNO: média de ${(sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(1)}h nos últimos ${sleeps.length} registros (sonecas contadas à parte).`);

  // Rotina de sono declarada (estilo iPhone) + adesão via check-in matinal.
  // É o cruzamento-assinatura da marca: noites fora da rotina × gasto por
  // impulso × humor — algo que nenhum app de nicho consegue dizer.
  const bt = String(p.sleep_bedtime ?? "").slice(0, 5);
  const wt = String(p.sleep_waketime ?? "").slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(bt) && /^\d{2}:\d{2}$/.test(wt) && trackingPrefs["sleep"] !== false) {
    const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const diffMin = ((toMin(wt) - toMin(bt)) + 1440) % 1440;
    if (diffMin > 0) {
      const hrs = Math.round((diffMin / 60) * 10) / 10;
      const withFlag = (kinds["sleep"] ?? []).filter((e) => typeof (e.payload as any)?.followed_schedule === "boolean");
      const followed = withFlag.filter((e) => (e.payload as any)?.followed_schedule === true).length;
      lines.push(
        `ROTINA DE SONO DECLARADA: dorme às ${bt}, acorda às ${wt} (~${hrs}h/noite).` +
        (withFlag.length
          ? ` Adesão (30d): seguiu a rotina em ${followed} de ${withFlag.length} noites com check-in.`
          : ` Ainda sem check-ins de rotina (o check-in matinal de 1 toque na tela Hoje alimenta a adesão).`) +
        ` Se a pessoa disser "dormi no horário"/"segui minha rotina", isso significa ${hrs}h de sono nesses horários.`
      );
    }
  }
  const naps = (kinds["nap"] ?? []).map((e) => Number((e.payload as any)?.hours)).filter((n) => n > 0);
  if (naps.length) lines.push(`SONECAS (30d): ${naps.length}, média de ${(naps.reduce((a, b) => a + b, 0) / naps.length).toFixed(1)}h cada.`);

  // Raio-X de Vitalidade (plano de feedbacks, Sug. 2 e 4): estimativas
  // declaradas pela pessoa. Mesma regra do Raio-X financeiro: PREMISSAS,
  // não registros — o real substitui a estimativa, nunca soma. Elas
  // permitem o primeiro cruzamento entre pilares já no dia 1.
  const estParts: string[] = [];
  const estW = Number(p.est_workouts_week);
  if (Number.isFinite(estW) && p.est_workouts_week != null) estParts.push(`treina ~${estW}x/semana`);
  const estS = Number(p.est_sleep_h);
  if (Number.isFinite(estS) && p.est_sleep_h != null && estS > 0) estParts.push(`dorme ~${estS}h/noite`);
  if (estParts.length) {
    lines.push(
      `ESTIMATIVAS DE VITALIDADE DECLARADAS PELA PESSOA (Raio-X, não são registros): ${estParts.join("; ")}. ` +
      `Use como premissas quando os registros reais forem escassos, citando a origem ("pela sua estimativa de X treinos por semana..."), em vez de dizer que faltam dados. ` +
      `Registro real do período substitui a estimativa, nunca soma. Combine com as estimativas financeiras quando fizer sentido (ex.: custo do mercado por semana de treino).`
    );
  }
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

    // Treinos de HOJE, carimbados (mesma correção das refeições): sem isso o
    // modelo sabe que existem N treinos no mês, mas não que um deles acabou de
    // acontecer — e responde "você ainda não treinou hoje" para quem treinou.
    const todayWorkouts = kinds["workout"]
      .filter((e) => spParts(new Date(e.occurred_at)).dateIso === todaySpIso)
      .map((e) => {
        const pl = (e.payload as any) ?? {};
        const p = spParts(new Date(e.occurred_at));
        const musc = Array.isArray(pl.muscles) && pl.muscles.length ? ` (${pl.muscles.join(", ")})` : "";
        const dur = Number(pl.duration_min) > 0 ? ` — ${Math.round(Number(pl.duration_min))} min` : "";
        return `[hoje ${p.timeHm}] ${pl.description ?? "treino"}${musc}${dur}`;
      });
    if (todayWorkouts.length) {
      lines.push(`TREINOS DE HOJE (já registrados por esta pessoa — trate como fato, não pergunte de novo): ${todayWorkouts.join("; ")}.`);
    }
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
    // Cada refeição vai CARIMBADA com dia, hora (SP) e tipo. Antes a lista era
    // só a descrição — o modelo recebia "pão com manteiga; pastéis; miojo" sem
    // uma única data e não tinha como saber que o primeiro item era o almoço de
    // HOJE e não uma refeição de três semanas atrás. Caso real (30/08): a pessoa
    // registrou o almoço e, 7 segundos depois, perguntou se ele cabia no plano;
    // o Conselheiro respondeu "não me contou o almoço ainda" e, pressionado,
    // inventou um café da manhã que nunca existiu. O dado estava no banco: o
    // que faltava era o carimbo de tempo.
    const MEAL_TYPE_LABEL: Record<string, string> = {
      cafe_da_manha: "café da manhã", almoco: "almoço", jantar: "jantar", lanche: "lanche",
    };
    const describeMeal = (e: typeof kinds["meal"][number]) => {
      const pl = (e.payload as any) ?? {};
      if (!pl.description) return null;
      const kcal = Number(pl.calories);
      const p = spParts(new Date(e.occurred_at));
      const dia = p.dateIso === todaySpIso ? "hoje" : p.dateIso;
      const tipo = MEAL_TYPE_LABEL[String(pl.meal_type ?? "")] ?? "refeição";
      return `[${dia} ${p.timeHm}] ${tipo}: ${pl.description}${kcal > 0 ? ` (~${Math.round(kcal)} kcal)` : ""}`;
    };
    const last = kinds["meal"].slice(0, 6).map(describeMeal).filter(Boolean).join("; ");
    // Bloco próprio para HOJE: é o recorte que quase toda pergunta do dia a dia
    // usa ("o que eu comi hoje?", "meu almoço está dentro do plano?").
    const todayMeals = kinds["meal"]
      .filter((e) => spParts(new Date(e.occurred_at)).dateIso === todaySpIso)
      .map(describeMeal).filter(Boolean);
    if (todayMeals.length) {
      lines.push(`REFEIÇÕES DE HOJE (já registradas por esta pessoa — trate como fato, não pergunte de novo): ${todayMeals.join("; ")}.`);
    }
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
    // occurred_at é um instante UTC: comparar `slice(0,10)` com a data de SP
    // jogava toda refeição registrada entre 21h e 23h59 para o dia seguinte
    // (o jantar sumia do "faltam X kcal"). Proteína, água e sono já usavam
    // spParts — agora as calorias também.
    const kcalToday = kinds["meal"]
      .filter((e) => spParts(new Date(e.occurred_at)).dateIso === todayIso)
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
  }

  // Metas dos demais pilares (gasto do dia, treinos na semana, sono).
  // Ficavam aninhadas no bloco de ALIMENTAÇÃO: quem não registrava refeição
  // há 30 dias — ou desligava o escopo de alimentação — perdia o teto de
  // gasto, a meta de treinos e a de sono em TODAS as superfícies de IA, e o
  // Conselheiro passava a tratá-las como "meta ainda sem valor". Agora cada
  // uma vive sob o escopo de privacidade do SEU pilar.
  if (scopes.prosperidade) {
    const spendLimit = Number(p.daily_spend_limit) || 0;
    if (spendLimit > 0) {
      // transactions.occurred_at é `date`: a string já é o dia civil, sem fuso.
      const spentToday = (txs ?? [])
        .filter((t: any) => t.kind === "expense" && String(t.occurred_at).slice(0, 10) === todaySpIso)
        .reduce((sum: number, t: any) => sum + Number(t.amount), 0);
      lines.push(`TETO DE GASTO DIÁRIO: ${BRL(spendLimit)}. Hoje: ${BRL(spentToday)} gastos` +
        (spentToday <= spendLimit ? ` (${BRL(spendLimit - spentToday)} disponíveis).` : ` (${BRL(spentToday - spendLimit)} acima do teto).`));
    }
  }
  if (scopes.vitalidade) {
    const wwGoal = Number(p.weekly_workouts_goal) || 0;
    if (wwGoal > 0) {
      // Segunda-feira 00:00 EM SÃO PAULO. Antes usava a hora local do runtime
      // (UTC no Deno), então a semana começava domingo às 21h.
      const weekStart = new Date(spWeekStartUtc());
      const workoutsWeek = (kinds["workout"] ?? []).filter((e) => new Date(e.occurred_at) >= weekStart).length;
      lines.push(`META DE TREINOS: ${wwGoal}/semana. Esta semana (desde segunda): ${workoutsWeek} treino(s)` +
        (workoutsWeek >= wwGoal ? " — meta da semana batida." : ` — faltam ${wwGoal - workoutsWeek}.`));
    }
    const sleepGoal = Number(p.sleep_goal_h) || 0;
    if (sleepGoal > 0) {
      const sleptToday = (kinds["sleep"] ?? [])
        .filter((e) => spParts(new Date(e.occurred_at)).dateIso === todaySpIso)
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
      `DADOS AINDA NÃO INFORMADOS: ${missing.join("; ")}. ` +
      `Para planos definitivos (alimentar, treino, financeiro), siga o protocolo de planos do seu prompt: peça o que falta antes de gerar. ` +
      `Onde preencher: idade, sexo, altura, atividade e restrições em Ajustes (seção "Sobre você"); peso na aba Alimentação; condições e medicamentos na Vitalidade. ` +
      `REGRA DE TOM (inegociável): NUNCA atribua causa à ausência de um dado. Você NÃO sabe se a pessoa pulou, esqueceu, recusou ou se o app nem perguntou. ` +
      `Nunca diga "você pulou", "você deixou em branco" ou "como você não preencheu": convide de forma neutra ("se quiser me contar X, eu ajusto") ou simplesmente trabalhe com o que existe. ` +
      `Também nunca invente o nome de uma tela ou etapa: cite apenas os lugares listados acima.`
    );
  }

  // Metas do app: o que está definido e o que é PROPOSTA à espera de 1 toque.
  // Sem isto, um retrato sem meta calórica levava a IA a inventar o motivo
  // ("você pulou essa etapa") para algo que o app nem pergunta: a meta nasce
  // de um plano, não de um campo de formulário.
  const goalState: string[] = [];
  if (!Number(p.calorie_goal_kcal)) goalState.push("meta calórica diária");
  if (!Number(p.protein_goal_g)) goalState.push("meta de proteína");
  if (!Number(p.weekly_workouts_goal)) goalState.push("meta de treinos por semana");
  if (!Number(p.sleep_goal_h)) goalState.push("meta de sono");
  if (!Number(p.daily_spend_limit)) goalState.push("teto de gasto diário");
  if (goalState.length) {
    lines.push(
      `METAS AINDA SEM VALOR: ${goalState.join(", ")}. ` +
      `IMPORTANTE: metas NÃO são perguntadas em nenhum formulário do app e a pessoa NUNCA "pulou" uma etapa de metas: elas nascem de um plano (do Conselheiro ou do Blueprint do onboarding) que a pessoa ativa, ou de um campo direto na tela do pilar. ` +
      `Se fizer sentido, ofereça calcular a meta a partir dos dados que você já tem, em vez de cobrar preenchimento.`
    );
  }

  // Memória do Conselheiro: nuances aprendidas em conversas anteriores
  const mems = byUserFirst((memoriesRaw ?? []) as MemoryRow[]);
  if (mems.length) {
    const confirmadas = mems.filter(isUserOwnedMemory).length;
    lines.push(
      `O QUE VOCÊ JÁ APRENDEU SOBRE A PESSOA em conversas anteriores (memórias — use com naturalidade para personalizar respostas e planos; NÃO recite a lista de volta nem soe como vigilância):` +
      (confirmadas
        ? ` As marcadas com CONFIRMADA foram revisadas ou corrigidas PELA PRÓPRIA PESSOA: são fato declarado por ela, não sua inferência. Valem mais que as demais, nunca as contradiga com base em dedução sua, e se algo no relato de hoje parecer conflitar, pergunte em vez de concluir.`
        : "")
    );
    for (const m of mems) {
      lines.push(`• [${m.category}]${isUserOwnedMemory(m) ? " CONFIRMADA:" : ""} ${m.content}`);
    }
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

/* Tetos da extração a partir de ARQUIVO (o Conselheiro aceita anexos).
   Um CSV de exportação de app pode ter centenas de linhas: 555 noites de sono
   viraram o caso real que expôs o bug. Extrair tudo seria um cartão de
   confirmação inutilizável e uma conta de IA desproporcional, então lemos um
   pedaço e dizemos a verdade sobre o resto — o caminho da massa é o importador
   da tela, não a conversa. */
export const EXTRACTION_MAX_EVENTS = 25;
export const ATTACHMENT_EXTRACT_MAX_CHARS = 8000;

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
            occurred_at: {
              type: "string",
              description:
                "Data do evento em YYYY-MM-DD, APENAS quando o relato ou o arquivo disserem explicitamente " +
                "a data ('ontem', 'dia 12', uma coluna de data no CSV). OMITA quando for do dia de hoje ou " +
                "quando não houver data explícita: o app usa o momento do registro. NUNCA invente a data.",
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
            followed_schedule: { type: "boolean", description: "APENAS para sleep: true quando a pessoa disser que SEGUIU a rotina/horários de sono dela ('dormi no horário', 'segui minha rotina de sono'). Nesse caso pode omitir hours: o app usa a duração da rotina declarada." },
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

export const CAPTURE_SYSTEM = `Você extrai eventos estruturados de relatos do dia a dia de brasileiros, para a plataforma Ascende. Sua ÚNICA tarefa é achar fatos relatados no texto — você NUNCA responde perguntas, NUNCA dá conselhos e NUNCA julga se a pergunta da pessoa é relevante. Isso é trabalho de outro sistema.

━━━ REGRA MAIS IMPORTANTE — LEIA PRIMEIRO ━━━
MENSAGENS QUASE SEMPRE MISTURAM PERGUNTA + RELATO. O caso mais comum de erro é a pessoa pedir um conselho contando o que já fez, na mesma frase — e o relato ser ignorado por parecer "só contexto da pergunta". NÃO caia nisso. Sua regra de ouro: leia a mensagem inteira, ache CADA trecho que descreve algo que JÁ ACONTECEU (mesmo que venha depois de uma pergunta, mesmo que sirva de contexto, mesmo que seja do mesmo dia/assunto da pergunta) e extraia CADA um como evento. A presença de uma pergunta NUNCA é motivo para devolver events vazio se também houver um relato — os dois podem, e devem, conviver na mesma resposta.
Exemplos (a pergunta em si nunca vira evento; o relato ao lado dela SEMPRE vira):
• "O que eu devo comer no jantar hoje? No almoço eu comi frango grelhado com arroz e salada" → 1 evento meal (o almoço).
• "Posso gastar mais esse mês? Paguei 45 no uber hoje" → 1 evento transaction (o gasto de uber).
• "Treino de pernas hoje é uma boa ideia? Ontem eu treinei costas por 40 minutos" → 1 evento workout (o treino de costas).
• "Por que eu acordo cansado? Dormi 5 horas essa noite" → 1 evento sleep (as 5 horas).
Só devolva events vazio quando a mensagem for SÓ pergunta/conversa, sem absolutamente nenhum relato do que aconteceu.

Demais regras:
• Extraia TODOS os eventos presentes no texto — um relato pode alimentar vários pilares de uma vez.
• Valores em reais: "47", "R$47", "quarenta e sete" → amount 47. Gastos são expense; salário/recebimentos são income.
• Sono NOTURNO ("dormi 5h", "dormi mal" → estime 5 e cite no summary que foi estimado) vira sleep. Se a pessoa disser que SEGUIU a rotina/horários dela ("dormi no horário", "segui minha rotina de sono", "dormi e acordei na hora certa"), emita sleep com followed_schedule: true e SEM hours (o app preenche com a duração da rotina declarada dela); summary: "Sono: rotina seguida". Se o retrato informar a rotina declarada, pode citar a duração no summary. Sonecas e cochilos ("tirei uma soneca", "cochilei 40 min", "dormi depois do almoço") viram nap com hours; NUNCA registre soneca como sleep — são coisas diferentes com pesos diferentes. Na dúvida entre noite e soneca, o horário e o contexto decidem (dormir "depois do almoço" é soneca).
• Menções a treino/exercício viram workout — SEMPRE preencha muscles inferindo os grupos do exercício (corrida → Pernas e Cardio; "treinei costas" → Costas). Inclua os grupos no summary. Ex.: "Treino de corrida (Pernas, Cardio)".
• Se a duração do treino for mencionada, preencha duration_min.
• Água bebida ("tomei 2L de água", "bebi 500ml") vira water com ml.
• Peso corporal ("me pesei, 78kg", "tô pesando 82") vira weight com kg.
• Refeições viram meal e SEMPRE recebem calories estimadas a partir da descrição (porções típicas brasileiras; melhor uma estimativa honesta do que nenhuma), preenchendo também protein_g/carbs_g/fat_g quando possível. Inclua as kcal no summary: "Almoço: arroz, feijão e frango (~650 kcal)". Quando o contexto disser qual refeição é (café da manhã, almoço, jantar, lanche/belisco), preencha meal_type e inclua no summary. Oração/meditação/culto/leitura espiritual viram practice.
• Estados emocionais ("tô ansioso", "dia ótimo") viram mood, usando a palavra do próprio usuário em mood_label.
• Se algo não se encaixar em nenhum tipo, use note.
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
            confidence: {
              type: "number",
              description: "De 0 a 1: o quanto você está seguro desta nuance. Use 0.9+ só quando a pessoa AFIRMOU literalmente; 0.5 a 0.7 quando você inferiu do contexto. Seja honesto: confiança baixa é informação útil, chute alto não.",
            },
            replaces_id: {
              type: "string",
              description: "APENAS se esta memória ATUALIZA ou CONTRADIZ uma memória existente: o id exato dela (da lista fornecida). NUNCA use o id de uma memória marcada como CONFIRMADA: essas foram revisadas pela própria pessoa e não podem ser substituídas por você.",
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
/** Registra de ONDE veio cada memória. Sem isto a pessoa não tem como saber
 *  por que a IA "sabe" algo sobre ela, que é o ponto da Fase 2. Best-effort:
 *  a memória já está gravada, perder a origem não pode derrubar o turno. */
export async function attachMemorySources(
  supabase: SupabaseClient, userId: string, memoryIds: string[],
  kind: "life_event" | "chat_message" | "data_source", refId: string | null,
): Promise<void> {
  if (!memoryIds.length || !refId) return;
  const rows = memoryIds.map((memory_id) => ({ memory_id, user_id: userId, kind, ref_id: refId }));
  const { error } = await supabase.from("memory_sources").insert(rows);
  if (!error) return;
  /* memory_sources tem índice único (memory_id, kind, ref_id): um insert em
     lote é tudo-ou-nada, então UMA origem já existente (reenvio da mesma
     requisição) derrubaria as outras junto. Cai para linha a linha. */
  for (const row of rows) {
    const one = await supabase.from("memory_sources").insert(row);
    if (one.error) console.error("memory_sources: falha ao registrar origem", one.error.message ?? one.error);
  }
}

/** Persiste memórias extraídas (dedupe, substituição e teto por plano).
 *  Fase 2: nasce created_by='ia' com a confiança declarada pelo modelo, e
 *  NUNCA sobrescreve o que a pessoa confirmou. */
async function persistMemories(
  supabase: SupabaseClient, userId: string,
  // deno-lint-ignore no-explicit-any
  raw: any[], known: MemoryRow[], memoryCap: number,
): Promise<{ id: string; content: string; category: string }[]> {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  const knownNorm = new Set(known.map((m) => norm(m.content)));
  const byId = new Map(known.map((m) => [m.id, m]));
  const learned: { id: string; content: string; category: string }[] = [];

  const clampConfidence = (v: unknown): number | null => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
  };

  for (const m of (raw ?? []).slice(0, MEMORY_MAX_PER_MESSAGE)) {
    const content = String(m?.content ?? "").trim().slice(0, 160);
    if (content.length < 3) continue;
    const category = MEMORY_CATEGORIES.includes(String(m?.category)) ? String(m.category) : "outro";
    const confidence = clampConfidence(m?.confidence);
    const n = norm(content);
    if (knownNorm.has(n)) continue;

    const target = typeof m?.replaces_id === "string" ? byId.get(m.replaces_id) : undefined;

    /* CRITÉRIO DE PRONTO DA FASE: a correção da pessoa sobrevive ao turno
       seguinte. O modelo é instruído a não substituir memória CONFIRMADA, mas
       instrução de prompt não é garantia — quem garante é este bloqueio. Sem
       ele, a extração da mensagem seguinte reescrevia a correção e a pessoa
       via a IA "esquecer" o que ela acabou de corrigir. */
    if (target && isUserOwnedMemory(target)) {
      console.warn("memories: substituição recusada (memória confirmada pela pessoa)", target.id);
      continue;
    }

    knownNorm.add(n);

    if (target) {
      const patch: Record<string, unknown> = {
        content, category, updated_at: new Date().toISOString(),
        created_by: "ia", status: "ativa", last_verified_at: new Date().toISOString(),
        ...(confidence === null ? {} : { confidence }),
      };
      let { error } = await supabase.from("ai_memories")
        .update(patch).eq("id", target.id).eq("user_id", userId);
      if (error) {
        // Migração da Fase 2 ainda não aplicada: grava o que o banco aceita.
        ({ error } = await supabase.from("ai_memories")
          .update({ content, category, updated_at: new Date().toISOString() })
          .eq("id", target.id).eq("user_id", userId));
      }
      if (error) console.error("memories: falha ao atualizar", error.message ?? error);
      else learned.push({ id: target.id, content, category });
      continue;
    }

    // Teto por plano: no limite, não cria memórias novas (as antigas ficam).
    if (known.length + learned.length >= memoryCap) continue;

    const row: Record<string, unknown> = {
      user_id: userId, content, category,
      created_by: "ia", status: "ativa",
      ...(confidence === null ? {} : { confidence }),
    };
    let ins = await supabase.from("ai_memories").insert(row).select("id").maybeSingle();
    if (ins.error) {
      ins = await supabase.from("ai_memories")
        .insert({ user_id: userId, content, category }).select("id").maybeSingle();
    }
    if (ins.error || !ins.data?.id) {
      console.error("memories: falha ao inserir", ins.error?.message ?? ins.error);
      continue;
    }
    learned.push({ id: String(ins.data.id), content, category });
  }

  if (learned.length) {
    const { count } = await supabase.from("ai_memories")
      .select("id", { count: "exact", head: true }).eq("user_id", userId);
    const excess = (count ?? 0) - memoryCap;
    if (excess > 0) {
      /* Despejo por teto NUNCA leva memória confirmada pela pessoa: ela
         revisou aquilo à mão, não pode perder por antiguidade. Se o banco
         ainda não tem as colunas, cai na regra antiga (só a mais velha). */
      let oldest = await supabase.from("ai_memories")
        .select("id").eq("user_id", userId)
        .neq("status", "confirmada").neq("created_by", "usuario")
        .order("created_at", { ascending: true }).limit(excess);
      if (oldest.error) {
        oldest = await supabase.from("ai_memories")
          .select("id").eq("user_id", userId)
          .order("created_at", { ascending: true }).limit(excess);
      }
      const ids = (oldest.data ?? []).map((o) => o.id);
      if (ids.length) await supabase.from("ai_memories").delete().in("id", ids);
    }
  }
  return learned;
}

/** Memórias que a IA vê ao extrair. Mesma REGRA DE LEITURA do retrato: uma
 *  memória rejeitada ou expirada não pode voltar à conversa por esta porta. */
async function loadKnownMemories(supabase: SupabaseClient, userId: string) {
  return byUserFirst(await selectMemories(supabase, userId, 80));
}

const memoriesBlock = (known: MemoryRow[]) =>
  known.length
    ? `MEMÓRIAS JÁ EXISTENTES (não repita; use replaces_id do item que for atualizado). As marcadas CONFIRMADA foram revisadas pela própria pessoa: NÃO as substitua nem as contradiga — se o relato de hoje conflitar com uma delas, ignore o conflito e não gere memória nova sobre o assunto.\n${
        known.map((m) => `- [id: ${m.id}]${isUserOwnedMemory(m) ? " CONFIRMADA:" : ""} ${m.content}`).join("\n")
      }`
    : "Ainda não há memórias sobre esta pessoa.";

/**
 * Aprende com a mensagem do usuário (memórias duráveis). Pula mensagens
 * triviais, respeita o teto de memórias do plano e registra o consumo em
 * ai_usage sob a feature informada. Nunca lança: falha devolve [].
 */
export async function learnFromMessage(
  supabase: SupabaseClient, userId: string, message: string,
  feature = "memorias", memoryCap = 150,
): Promise<{ id: string; content: string; category: string }[]> {
  try {
    const text = String(message ?? "").trim();
    if (isTrivialMessage(text)) return [];
    const known = await loadKnownMemories(supabase, userId);

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
      // Cópia com teto próprio: mutar o objeto do CAPTURE_TOOL afetaria também
      // a captura falada (capture e WhatsApp), que não precisa de teto.
      events: {
        ...((CAPTURE_TOOL.input_schema.properties as Record<string, Record<string, unknown>>).events),
        maxItems: EXTRACTION_MAX_EVENTS,
      },
      memories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "Nuance durável em UMA frase curta (máx. 160 caracteres), 3ª pessoa implícita." },
            category: { type: "string", enum: MEMORY_CATEGORIES },
            confidence: { type: "number", description: "De 0 a 1: o quanto você está seguro. 0.9+ só quando a pessoa afirmou literalmente." },
            replaces_id: { type: "string", description: "APENAS se atualiza/contradiz uma memória existente: o id exato dela. NUNCA o id de uma memória marcada como CONFIRMADA." },
          },
          required: ["content", "category"],
        },
      },
    },
    required: ["events", "memories"],
  },
};

/* Regras extras quando a extração vem de um ARQUIVO anexado (CSV, planilha,
   exportação de app, anotações). Sem elas o modelo trata uma tabela como
   "não é relato" e devolve events: [] — o CAPTURE_SYSTEM foi escrito para
   frases faladas, não para linhas de dado. */
const BULK_EXTRACTION_RULES = `
━━━ EXTRAÇÃO A PARTIR DE ARQUIVO ANEXADO ━━━
O conteúdo abaixo inclui um arquivo enviado pela pessoa. Aqui, tabela e CSV SÃO relato:
• Cada linha que descreva algo que JÁ aconteceu com ela (uma noite de sono, um treino, uma refeição, um peso, um gasto) é um evento registrável, mesmo sem nenhuma frase narrativa em volta.
• Cabeçalhos, totais, médias, metas, legendas e linhas vazias NÃO são eventos.
• Quando a linha tiver data, preencha occurred_at (YYYY-MM-DD) e comece o summary pela data ("12/03: 7h de sono"). Sem data explícita, omita occurred_at.
• TETO RÍGIDO: no máximo ${EXTRACTION_MAX_EVENTS} eventos nesta resposta. Se o arquivo tiver mais, extraia os ${EXTRACTION_MAX_EVENTS} MAIS RECENTES (datas mais novas primeiro) e ignore o resto — o app avisa a pessoa que sobrou dado, isso não é sua responsabilidade e não é motivo para resumir ou agrupar linhas.
• NUNCA invente linhas, datas ou valores que não estejam no arquivo, e nunca agregue várias linhas num evento só.`;

export async function extractEventsAndMemories(
  supabase: SupabaseClient, userId: string, text: string,
  feature: string, memoryCap = 150,
  opts: {
    reservationId?: number | null;
    /** A extração inclui conteúdo de arquivo: mais texto de entrada, mais
     *  tokens de saída e as regras de leitura de tabela acima. */
    bulk?: boolean;
    /** Blocos extras (ex.: um PDF) que entram na mensagem da extração. */
    // deno-lint-ignore no-explicit-any
    blocks?: any[];
  } = {},
  // deno-lint-ignore no-explicit-any
): Promise<{ ok: boolean; events: any[]; learned: { id: string; content: string; category: string }[]; capped: boolean }> {
  const bulk = opts.bulk === true;
  const blocks = opts.blocks ?? [];
  try {
    const t = String(text ?? "").trim();
    // Um anexo com dado dentro nunca é "trivial", mesmo que a frase digitada
    // seja só "segue" — antes essa checagem sozinha já matava a extração.
    if (!bulk && !blocks.length && isTrivialMessage(t)) {
      return { ok: true, events: [], learned: [], capped: false };
    }
    const known = await loadKnownMemories(supabase, userId);

    // Mensagens com "?" costumam misturar pergunta + relato — é o padrão em que
    // o modelo econômico mais falha em extrair o relato (achado de QA ao vivo:
    // o relato ao lado de uma pergunta do mesmo assunto/dia era silenciosamente
    // ignorado mesmo com regra explícita no prompt). Nesses casos, o modelo
    // inteligente é obrigatório — o custo extra é pequeno perto do dano de um
    // registro perdido silenciosamente.
    const hasQuestion = t.includes("?");

    // Com arquivo, o texto é maior e a saída também: 25 eventos estruturados
    // não cabem nos 1800 tokens que bastam para uma frase falada.
    const inputCap = bulk ? 4000 + ATTACHMENT_EXTRACT_MAX_CHARS : 4000;
    const userText =
      `${memoriesBlock(known)}\n\nRELATO DO USUÁRIO (se houver pergunta junto, ignore-a e extraia só o que foi relatado como já acontecido):\n${t.slice(0, inputCap)}`;

    const { res, data } = await anthropicCall(supabase, userId, feature, {
      model: hasQuestion ? MODEL_SMART : MODEL_FAST,
      max_tokens: bulk ? 8000 : 1800,
      system: `${CAPTURE_SYSTEM}${bulk ? `\n${BULK_EXTRACTION_RULES}` : ""}\n\n━━━ MEMÓRIA DE LONGO PRAZO ━━━\n${MEMORY_SYSTEM.split("Use SEMPRE a ferramenta")[0]}\nUse SEMPRE a ferramenta extrair_registros_e_memorias, preenchendo events E memories (vazios quando não houver).`,
      tools: [COMBINED_TOOL],
      tool_choice: { type: "tool", name: "extrair_registros_e_memorias" },
      messages: [{
        role: "user",
        content: blocks.length ? [...blocks, { type: "text", text: userText }] : userText,
      }],
    }, { reservationId: opts.reservationId ?? null });
    if (!res.ok || !data) return { ok: false, events: [], learned: [], capped: false };
    // deno-lint-ignore no-explicit-any
    const tu = ((data as any).content ?? []).find((b: any) => b.type === "tool_use");
    const rawEvents = Array.isArray(tu?.input?.events) ? tu.input.events : [];
    // Teto aplicado também aqui: o schema pede maxItems, mas quem garante é
    // o servidor (o modelo pode passar do teto e não é o usuário que paga).
    const events = rawEvents.slice(0, EXTRACTION_MAX_EVENTS);
    const rawMems = Array.isArray(tu?.input?.memories) ? tu.input.memories : [];
    const learned = await persistMemories(supabase, userId, rawMems, known, memoryCap);
    return { ok: true, events, learned, capped: rawEvents.length >= EXTRACTION_MAX_EVENTS };
  } catch (e) {
    console.error("extração combinada: erro inesperado", e);
    return { ok: false, events: [], learned: [], capped: false };
  }
}
/* ─── Extração de fatura/comprovante (compartilhada) ──────────────────────
   Antes vivia só em `import-statement`; com "fatura em toda IA", as TRÊS
   superfícies (import-statement, capture com imagem, ai-chat com imagem)
   usam o mesmo tool, o mesmo system e a mesma normalização — a lista chega
   ao app como PROPOSTA e a pessoa confirma em lote. A IA nunca grava sozinha. */

export const STATEMENT_CATEGORIES = [
  "Mercado", "Alimentação fora", "Transporte", "Moradia", "Saúde", "Lazer",
  "Educação", "Assinaturas", "Salário", "Extra", "Outros",
];

export const STATEMENT_MAX_ITEMS = 120;
export const STATEMENT_MAX_INSTALLMENTS = 24;   // expansão de parcelas: até 24x
export const STATEMENT_MAX_ITEMS_EXPANDED = 240;

/** Soma `delta` meses a uma data ISO, fixando o dia ao último dia do mês
 *  quando necessário (31/01 + 1 mês → 28/02). */
export function addMonthsClamp(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const idx = (m - 1) + delta;
  const ny = y + Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export const STATEMENT_TOOL = {
  name: "extrair_lancamentos",
  description:
    "Extrai os lançamentos de uma fatura de cartão, extrato bancário, comprovante ou print de transações. " +
    "Cada item vira uma PROPOSTA que o usuário confirma no app.",
  input_schema: {
    type: "object",
    properties: {
      is_statement: {
        type: "boolean",
        description: "true se o documento/imagem realmente contém transações financeiras (fatura, extrato, comprovante de Pix, print de compra, cupom); false caso contrário.",
      },
      statement_month: {
        type: "string",
        description: "Mês de referência do documento no formato YYYY-MM, se identificável.",
      },
      items: {
        type: "array",
        maxItems: STATEMENT_MAX_ITEMS,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["income", "expense"], description: "expense para compras/débitos/Pix enviado; income para créditos/estornos/salário/Pix recebido." },
            amount: { type: "number", description: "Valor em reais, sempre positivo." },
            category: { type: "string", enum: STATEMENT_CATEGORIES, description: "Melhor categoria para o lançamento." },
            description: { type: "string", description: "Descrição curta e legível, SEM o sufixo de parcela (limpe códigos, siglas e o 'i/N'). Ex.: 'Loja de Móveis', não 'LOJAMOVEIS*BR 3/10'." },
            occurred_at: { type: "string", description: "Data do lançamento em YYYY-MM-DD. Se o documento só tiver dia/mês, deduza o ano pelo mês de referência. Comprovante sem data legível: use a data de hoje informada no contexto." },
            installment_current: { type: "integer", description: "Se for compra parcelada (ex.: '3/10'), o número desta parcela (3). Omita se não for parcelado." },
            installment_total: { type: "integer", description: "Se for compra parcelada (ex.: '3/10'), o total de parcelas (10). Omita se não for parcelado." },
          },
          required: ["kind", "amount", "category", "description", "occurred_at"],
        },
      },
      note: {
        type: "string",
        description: "Observação curta ao usuário, se necessária. Ex.: 'Ignorei o pagamento da fatura anterior para não duplicar'. Vazio se não precisar.",
      },
    },
    required: ["is_statement", "items"],
  },
};

export const STATEMENT_SYSTEM = `Você é o extrator financeiro do Ascende, plataforma brasileira de qualidade de vida.
Você recebe UM documento ou imagem (fatura de cartão, extrato bancário, comprovante de Pix, print de compra, cupom fiscal) e extrai os lançamentos.

REGRAS:
• Cada linha de transação vira um item: tipo (expense/income), valor positivo em reais, categoria, descrição limpa e data.
• NÃO inclua: saldo, limite disponível, "pagamento recebido"/pagamento da fatura anterior, juros informativos sem lançamento, subtotais e totais. Só transações reais.
• Estorno/crédito na fatura = income. Pix RECEBIDO = income; Pix ENVIADO = expense.
• Comprovante avulso (Pix, compra, cupom) normalmente é UM único lançamento — não invente outros.
• PARCELAS: quando a linha indicar parcelamento (ex.: "Loja X 3/10"), o amount é o valor DA PARCELA (não o total da compra), a descrição vem limpa (sem o "3/10") e você preenche installment_current=3 e installment_total=10. O app gera as parcelas passadas e futuras a partir disso.
• Categorize com bom senso brasileiro: supermercado/hortifruti → Mercado; iFood/restaurante/lanchonete → Alimentação fora; Uber/99/combustível/estacionamento → Transporte; farmácia/consulta → Saúde; cinema/bar/viagem → Lazer; streaming/telefonia/apps → Assinaturas; luz/água/condomínio → Moradia; na dúvida → Outros.
• Datas em YYYY-MM-DD. Se o documento só mostra dia/mês, use o mês de referência para deduzir o ano. Comprovante sem data legível: use a data de hoje, se informada no contexto.
• Se a imagem NÃO contiver transações financeiras (ou estiver ilegível), retorne is_statement:false e items:[] — sem inventar.
• Nunca julgue os gastos da pessoa. Extraia com neutralidade.
• Responda SEMPRE usando a ferramenta extrair_lancamentos.`;

/** Valida os itens do tool e expande parcelas (passadas e futuras).
 *  Formato de saída = ProposedStatementTx do app (origin + installment). */
// deno-lint-ignore no-explicit-any
export function normalizeStatementItems(raw: unknown): any[] {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  // deno-lint-ignore no-explicit-any
  return (Array.isArray(raw) ? raw : []).slice(0, STATEMENT_MAX_ITEMS).flatMap((it: any) => {
    const amount = Number(it?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return [];
    const kind = it?.kind === "income" ? "income" : "expense";
    const category = STATEMENT_CATEGORIES.includes(it?.category) ? it.category : "Outros";
    const description = String(it?.description ?? category).slice(0, 100);
    const occurred_at = isoDate.test(String(it?.occurred_at ?? "")) ? String(it.occurred_at) : null;
    if (!occurred_at) return [];
    const base = { kind, amount: Math.round(amount * 100) / 100, category, description, occurred_at };

    // Compra parcelada: expande passadas e futuras a partir da parcela da
    // fatura (mesmo valor, meses vizinhos). O usuário confirma em lote e
    // o app desmarca automaticamente as que já existirem registradas.
    const cur = Number(it?.installment_current);
    const total = Number(it?.installment_total);
    const isInstallment = Number.isInteger(cur) && Number.isInteger(total) &&
      total >= 2 && total <= STATEMENT_MAX_INSTALLMENTS && cur >= 1 && cur <= total;
    if (!isInstallment) return [{ ...base, origin: "statement", installment: null }];

    const out: unknown[] = [];
    for (let k = 1; k <= total; k++) {
      out.push({
        ...base,
        description: `${description} · ${k}/${total}`,
        occurred_at: addMonthsClamp(occurred_at, k - cur),
        origin: k === cur ? "statement" : (k < cur ? "past" : "future"),
        installment: `${k}/${total}`,
      });
    }
    return out;
  }).slice(0, STATEMENT_MAX_ITEMS_EXPANDED);
}