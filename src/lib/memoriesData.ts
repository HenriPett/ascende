// ASCENDE — Memória controlável: a camada de I/O (Fase 2).
//
// O que muda em relação à Fase 1 da memória: a pessoa deixa de ser
// espectadora. Ela confirma ("isso está certo"), corrige ("não é bem assim"),
// põe prazo ("isso vale só até dezembro") e rejeita ("nunca foi verdade") —
// e o Conselheiro obedece já no turno seguinte.
//
// Duas coisas moram fora daqui, de propósito:
// • o VOCABULÁRIO e a REGRA DE LEITURA estão em memories.ts, que é puro e não
//   importa o cliente do Supabase (mesmo arranjo de dataSources/dataSourcesPure:
//   é o que deixa a regra ser testada sem rede nem navegador);
// • quem ESCREVE memória automaticamente continua sendo a extração da IA em
//   supabase/functions/_shared/lib.ts. Aqui é o lado da pessoa.
//
// Cuidado que justifica metade deste arquivo: um UPDATE bloqueado por RLS não
// dá erro no PostgREST — ele casa com zero linhas e devolve sucesso. Por isso
// toda escrita aqui pede a linha de volta e RECLAMA se não vier nenhuma: sem
// isso, a tela diria "salvo" enquanto a correção não saiu do lugar.

import { supabase } from "@/integrations/supabase/client";
import {
  compareMemoriesForSnapshot, validateMemoryContent,
  type MemoryStatus, type MemorySensitivity, type MemoryCreatedBy, type MemorySourceKind,
} from "@/lib/memories";

export type { MemorySourceKind };

/* ── Tipos (contrato com a interface) ─────────────────────────────────────
   Campos com os mesmos nomes das colunas, como em dataSources.ts. */

export interface AiMemory {
  id: string;
  user_id: string;
  content: string;
  category: string;
  status: MemoryStatus;
  /** 0..1 — o quanto a IA se sente segura. Null quando ela não declarou. */
  confidence: number | null;
  /** ISO 8601 com fuso. */
  valid_from: string | null;
  /** Prazo da memória temporária. Null = não vence. */
  valid_until: string | null;
  last_verified_at: string | null;
  sensitivity: MemorySensitivity;
  created_by: MemoryCreatedBy;
  created_at: string;
  updated_at: string;
}

/** De onde a memória nasceu. `ref_id` aponta life_events, chat_messages ou
 *  data_sources conforme `kind` — é polimórfico, não tem FK. */
export interface MemorySource {
  id: string;
  memory_id: string;
  user_id: string;
  kind: MemorySourceKind;
  ref_id: string | null;
  created_at: string;
}

/**
 * Origem já traduzida para algo que a pessoa entende.
 *
 * A tabela guarda `kind` + `ref_id` e mais nada — uuid não é origem, é id. O
 * trecho é buscado na LEITURA, e não copiado para memory_sources, por dois
 * motivos: cópia envelhece (a pessoa edita a mensagem e a evidência mente), e
 * cópia sobrevive à exclusão (ela apaga a conversa e o trecho continua lá,
 * que é exatamente o que "apagar" deveria impedir).
 *
 * Quando o registro de origem não existe mais, `excerpt` volta null e o
 * cartão mostra só o rótulo e a data — menos, e verdadeiro.
 */
export interface MemorySourceResolved extends MemorySource {
  /** Trecho curto do que originou a memória (≤ 140 caracteres). */
  excerpt: string | null;
  /** Data do registro de origem; cai para `created_at` da própria origem. */
  occurred_at: string | null;
}

export interface MemoryWithSources extends AiMemory {
  sources: MemorySourceResolved[];
}

export interface NewMemorySource {
  memoryId: string;
  userId: string;
  kind: MemorySourceKind;
  refId?: string | null;
}

/* ── Leitura ────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function toMemory(row: Row): AiMemory {
  const confidence = row.confidence;
  return {
    id: str(row.id),
    user_id: str(row.user_id),
    content: str(row.content),
    category: str(row.category) || "outro",
    status: (str(row.status) || "ativa") as MemoryStatus,
    confidence: confidence === null || confidence === undefined ? null : Number(confidence),
    valid_from: strOrNull(row.valid_from),
    valid_until: strOrNull(row.valid_until),
    last_verified_at: strOrNull(row.last_verified_at),
    sensitivity: (str(row.sensitivity) || "normal") as MemorySensitivity,
    created_by: (str(row.created_by) || "ia") as MemoryCreatedBy,
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}

function toSource(row: Row): MemorySource {
  return {
    id: str(row.id),
    memory_id: str(row.memory_id),
    user_id: str(row.user_id),
    kind: str(row.kind) as MemorySourceKind,
    ref_id: strOrNull(row.ref_id),
    created_at: str(row.created_at),
  };
}

const SELECT_COLS =
  "id,user_id,content,category,status,confidence,valid_from,valid_until," +
  "last_verified_at,sensitivity,created_by,created_at,updated_at";

/**
 * As memórias da pessoa, cada uma com as origens que a produziram.
 *
 * Por padrão devolve só o que está VIGENTE — a mesma regra que o retrato do
 * Conselheiro usa, lida da view `ai_memories_vigentes` para o filtro existir
 * num lugar só. Com `includeInactive`, devolve tudo (a tela de memórias
 * precisa mostrar o que foi descartado para a pessoa poder voltar atrás).
 *
 * Ordem: confirmado pela pessoa primeiro, depois o mais recente — a palavra
 * dela na frente da suposição da IA.
 */
export async function listMemoriesWithSources(
  userId: string, opts: { includeInactive?: boolean; limit?: number } = {},
): Promise<MemoryWithSources[]> {
  if (!userId) return [];
  const limit = opts.limit ?? 200;

  // A view carrega a regra de leitura (e o trust_rank que põe o confirmado na
  // frente); a tabela crua é só para quando a tela quer mostrar o descartado.
  const query = opts.includeInactive
    ? supabase.from("ai_memories").select(SELECT_COLS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
    : supabase.from("ai_memories_vigentes").select(`${SELECT_COLS},trust_rank`)
        .eq("user_id", userId)
        .order("trust_rank", { ascending: true })
        .order("created_at", { ascending: false });

  const { data, error } = await query.limit(limit);
  if (error) { console.error("listMemoriesWithSources", error.message); return []; }

  const memories = (data ?? []).map((r) => toMemory(r as Row));
  // A view já vem ordenada; a lista completa é ordenada aqui, com a MESMA
  // regra (compareMemoriesForSnapshot, em memories.ts).
  if (opts.includeInactive) memories.sort(compareMemoriesForSnapshot);
  if (!memories.length) return [];

  const { data: sourceRows, error: sErr } = await supabase.from("memory_sources")
    .select("*").in("memory_id", memories.map((m) => m.id))
    .order("created_at", { ascending: false });
  if (sErr) console.error("listMemoriesWithSources origens", sErr.message);

  const sources = await resolveMemorySources((sourceRows ?? []).map((r) => toSource(r as Row)));

  const byMemory = new Map<string, MemorySourceResolved[]>();
  for (const source of sources) {
    const list = byMemory.get(source.memory_id);
    if (list) list.push(source);
    else byMemory.set(source.memory_id, [source]);
  }
  return memories.map((m) => ({ ...m, sources: byMemory.get(m.id) ?? [] }));
}

const EXCERPT_MAX = 140;

const excerpt = (text: unknown): string | null => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > EXCERPT_MAX ? `${t.slice(0, EXCERPT_MAX - 1)}…` : t;
};

/**
 * Traduz `kind` + `ref_id` em trecho e data, com UMA consulta por tipo (não
 * uma por origem). O que não for encontrado — registro apagado, ref_id nulo —
 * volta com `excerpt: null`, e a tela mostra só o rótulo e a data.
 *
 * Nunca lança: origem serve para EXPLICAR, e falhar em explicar não pode
 * derrubar a lista de memórias.
 */
export async function resolveMemorySources(list: MemorySource[]): Promise<MemorySourceResolved[]> {
  const idsOf = (kind: MemorySourceKind) =>
    [...new Set(list.filter((s) => s.kind === kind && s.ref_id).map((s) => s.ref_id as string))];

  const chatIds = idsOf("chat_message");
  const eventIds = idsOf("life_event");
  const fileIds = idsOf("data_source");

  const detail = new Map<string, { excerpt: string | null; occurred_at: string | null }>();
  const put = (kind: string, id: string, e: string | null, when: string | null) =>
    detail.set(`${kind}|${id}`, { excerpt: e, occurred_at: when });

  try {
    const [chats, events, files] = await Promise.all([
      chatIds.length
        ? supabase.from("chat_messages").select("id,content,created_at").in("id", chatIds)
        : Promise.resolve({ data: [], error: null }),
      eventIds.length
        ? supabase.from("life_events").select("id,payload,occurred_at").in("id", eventIds)
        : Promise.resolve({ data: [], error: null }),
      fileIds.length
        ? supabase.from("data_sources").select("id,display_name,created_at").in("id", fileIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const row of (chats.data ?? []) as Row[]) {
      put("chat_message", str(row.id), excerpt(row.content), strOrNull(row.created_at));
    }
    for (const row of (events.data ?? []) as Row[]) {
      const payload = (row.payload ?? {}) as Row;
      put("life_event", str(row.id),
        excerpt(payload.summary ?? payload.description), strOrNull(row.occurred_at));
    }
    for (const row of (files.data ?? []) as Row[]) {
      put("data_source", str(row.id), excerpt(row.display_name), strOrNull(row.created_at));
    }
  } catch (e) {
    console.error("resolveMemorySources", e);
  }

  return list.map((s) => {
    const found = s.ref_id ? detail.get(`${s.kind}|${s.ref_id}`) : undefined;
    return {
      ...s,
      excerpt: found?.excerpt ?? null,
      occurred_at: found?.occurred_at ?? s.created_at,
    };
  });
}

/* ── Escrita ────────────────────────────────────────────────────────────── */

/**
 * Update com prova de que aconteceu.
 *
 * `.select().maybeSingle()` depois do update é o ponto inteiro: se o RLS
 * barrar (memória de outra conta) ou o id não existir, o PostgREST devolve
 * sucesso com zero linhas, e sem esta checagem a tela comemoraria uma
 * correção que nunca foi gravada.
 */
async function patchMemory(memoryId: string, patch: Row): Promise<AiMemory> {
  const { data, error } = await supabase.from("ai_memories")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", memoryId)
    .select(SELECT_COLS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Memória não encontrada (ou sem permissão para alterar).");
  return toMemory(data as unknown as Row);
}

/** "Isso está certo." A memória passa a valer mais que as deduzidas e sobe no
 *  retrato; `last_verified_at` marca quando ela foi checada por gente. */
export function confirmMemory(memoryId: string): Promise<AiMemory> {
  return patchMemory(memoryId, {
    status: "confirmada",
    last_verified_at: new Date().toISOString(),
  });
}

/**
 * "Não é bem assim." Corrigir é a forma mais forte de confirmar: a memória
 * fica com o texto da PESSOA e entra como 'confirmada', porque no turno
 * seguinte o Conselheiro precisa tratar isso como a verdade dela, não como
 * mais um palpite. A autoria (`created_by`) não muda — quem deduziu primeiro
 * continua tendo deduzido.
 */
export async function updateMemoryContent(memoryId: string, content: string): Promise<AiMemory> {
  const check = validateMemoryContent(content);
  if (!check.ok) throw new Error(check.error ?? "Conteúdo inválido.");
  return patchMemory(memoryId, {
    content: check.content,
    status: "confirmada",
    last_verified_at: new Date().toISOString(),
  });
}

/**
 * "Isso vale só até…". Prazo é o que impede a memória de virar assombração:
 * "está de dieta para o casamento de dezembro" não pode ser citado em março.
 * `validUntil` null tira o prazo (volta a valer sem data de fim).
 *
 * Uma memória temporária que já nasceu vencida seria só confusão, então o
 * prazo no passado é recusado aqui, antes do banco.
 */
export function setMemoryValidity(
  memoryId: string, validUntil: string | Date | null,
): Promise<AiMemory> {
  const iso = validUntil instanceof Date ? validUntil.toISOString() : validUntil;
  if (iso) {
    const until = Date.parse(iso);
    if (Number.isNaN(until)) throw new Error("Data de validade inválida.");
    if (until <= Date.now()) throw new Error("Escolha uma data futura para o prazo.");
  }
  return patchMemory(memoryId, { valid_until: iso });
}

/**
 * "Nunca foi verdade." Marca como rejeitada em vez de APAGAR, e a diferença
 * importa: a linha rejeitada é o que permite (na Fase 3) a extração não
 * reaprender amanhã exatamente o que a pessoa acabou de negar. Apagar deixaria
 * o caminho livre para a IA repetir o erro.
 */
export function rejectMemory(memoryId: string): Promise<AiMemory> {
  return patchMemory(memoryId, {
    status: "rejeitada",
    last_verified_at: new Date().toISOString(),
  });
}

/** Volta uma memória rejeitada (ou vencida) para o jogo. Existe porque o
 *  botão de descartar precisa ter desfazer: errar de clique não pode custar
 *  uma memória. */
export function reactivateMemory(memoryId: string): Promise<AiMemory> {
  return patchMemory(memoryId, {
    status: "ativa",
    valid_until: null,
    last_verified_at: new Date().toISOString(),
  });
}

/**
 * Registra de onde a memória veio (evento, mensagem ou arquivo). Melhor
 * esforço: a origem é para explicar, e falhar em explicar não pode desfazer o
 * que já foi aprendido. Repetir a mesma origem não duplica (índice único).
 */
export async function createMemorySource(input: NewMemorySource): Promise<MemorySource | null> {
  const { data, error } = await supabase.from("memory_sources").insert({
    memory_id: input.memoryId,
    user_id: input.userId,
    kind: input.kind,
    ref_id: input.refId ?? null,
  }).select().maybeSingle();
  if (error) {
    // 23505: esta origem já estava registrada. Não é erro, é a resposta.
    if ((error as { code?: string }).code !== "23505") {
      console.error("createMemorySource", error.message);
    }
    return null;
  }
  return data ? toSource(data as Row) : null;
}

/**
 * Apaga de vez. Existe porque é direito da pessoa (e a tela de Ajustes já
 * oferecia), mas REJEITAR costuma ser melhor: a linha rejeitada é o que
 * permite a IA não reaprender amanhã exatamente o que ela acabou de negar.
 * Apagar deixa o caminho livre para o mesmo erro voltar.
 *
 * As origens (memory_sources) somem junto, por cascade.
 */
export async function deleteMemory(memoryId: string): Promise<void> {
  const { error } = await supabase.from("ai_memories").delete().eq("id", memoryId);
  if (error) throw error;
}
