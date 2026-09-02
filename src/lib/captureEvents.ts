import { supabase } from "@/integrations/supabase/client";
import { todayISO } from "@/lib/format";
import { existingRecordKeys, isDuplicateError } from "@/lib/dataSources";

/** Evento PROPOSTO pela IA (capture / ai-chat). Só vira registro após o usuário confirmar. */
export interface ProposedEvent {
  kind: string;
  pillar: string;
  summary: string;
  amount?: number;
  tx_kind?: "income" | "expense";
  category?: string;
  hours?: number;
  description?: string;
  meal_type?: string;
  duration_min?: number;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  muscles?: string[];
  ml?: number;
  kg?: number;
  mood_label?: string;
  mood_score?: number;
  /** sleep: a pessoa disse que seguiu a rotina declarada ("dormi no horário"). */
  followed_schedule?: boolean;
  /** Instante REAL do registro, com fuso ("2022-08-03T08:15:39-03:00").
   *  Ausente = agora, que é o caso de tudo que vem da captura por texto.
   *  A importação de CSV histórico depende disto: sem a data verdadeira, 555
   *  noites de sono cairiam todas no dia de hoje. */
  occurred_at?: string;
  /** Chave estável do registro dentro da FONTE que o trouxe
   *  ("sleep|2022-08-03"). Só a importação preenche: é o par
   *  (data_source_id, source_record_key) que o índice único de life_events
   *  usa para reimportar sem duplicar. Quem vem da captura por texto não tem
   *  arquivo nenhum, e fica sem chave mesmo. */
  record_key?: string;
}

/** Contexto opcional da rotina de sono (para preencher horas quando a
 *  pessoa só disse "segui minha rotina"). Vem do perfil, via lib/sleep. */
export interface SleepScheduleCtx {
  hours: number;
  bedtime?: string;
  waketime?: string;
}

/** Grava os eventos confirmados pelo usuário. Lança erro se algum insert falhar. */
export async function saveProposedEvents(
  userId: string, events: ProposedEvent[], sleepSchedule?: SleepScheduleCtx | null,
): Promise<void> {
  for (const ev of events) {
    if (ev.kind === "transaction" && ev.amount && ev.amount > 0) {
      // Transações vão para a tabela própria (o banco cria o evento na linha do tempo)
      const { error } = await supabase.from("transactions").insert({
        user_id: userId,
        kind: ev.tx_kind ?? "expense",
        amount: ev.amount,
        category: ev.category ?? "Outros",
        description: ev.description ?? ev.summary,
        occurred_at: ev.occurred_at?.slice(0, 10) ?? todayISO(),
        source: "capture",
      });
      if (error) throw error;
    } else {
      const { error } = await supabase.from("life_events").insert(
        lifeEventRow(userId, ev, "chat_capture", sleepSchedule),
      );
      if (error) throw error;
    }
  }
}

/** Monta o payload de um life_event. Fonte única de verdade, compartilhada
 *  pelo insert unitário da captura e pelo insert em lote da importação. */
function buildEventPayload(ev: ProposedEvent, sleepSchedule?: SleepScheduleCtx | null) {
  const payload: Record<string, unknown> = {};
  if (ev.hours) payload.hours = ev.hours;
  // "Segui minha rotina de sono": a IA não sabe as horas — o app preenche
  // com a duração da rotina declarada no perfil (Feature A).
  if (ev.kind === "sleep" && typeof ev.followed_schedule === "boolean") {
    payload.followed_schedule = ev.followed_schedule;
    if (!ev.hours && ev.followed_schedule && sleepSchedule?.hours) {
      payload.hours = sleepSchedule.hours;
      if (sleepSchedule.bedtime) payload.bedtime = sleepSchedule.bedtime;
      if (sleepSchedule.waketime) payload.waketime = sleepSchedule.waketime;
    }
  }
  if (ev.description) payload.description = ev.description;
  if (ev.muscles?.length) payload.muscles = ev.muscles;
  if (ev.meal_type) payload.meal_type = ev.meal_type;
  if (ev.calories && ev.calories > 0) payload.calories = Math.round(ev.calories);
  if (ev.protein_g && ev.protein_g > 0) payload.protein_g = Math.round(ev.protein_g);
  if (ev.carbs_g && ev.carbs_g > 0) payload.carbs_g = Math.round(ev.carbs_g);
  if (ev.fat_g && ev.fat_g > 0) payload.fat_g = Math.round(ev.fat_g);
  if (ev.duration_min && ev.duration_min > 0) payload.duration_min = Math.round(ev.duration_min);
  if (ev.ml && ev.ml > 0) payload.ml = Math.round(ev.ml);
  if (ev.kg && ev.kg > 20 && ev.kg < 400) payload.kg = ev.kg;
  if (ev.mood_label) payload.label = ev.mood_label;
  if (ev.mood_score) payload.score = ev.mood_score;
  if (ev.kind === "gratitude" && ev.description) payload.text = ev.description;
  payload.summary = ev.summary;
  return payload;
}

/** Linha pronta para insert em `life_events`. Ponto ÚNICO de montagem: a
 *  captura unitária e a importação em lote passam as duas por aqui.
 *
 *  `dataSourceId` é o ARQUIVO de onde o registro veio (data_sources), e não
 *  se confunde com as colunas `source_table`/`source_id` da tabela, que
 *  apontam o REGISTRO de origem de eventos derivados (a transação que gerou
 *  o evento). Nomes diferentes, conceitos diferentes. */
export function lifeEventRow(
  userId: string, ev: ProposedEvent, source: string,
  sleepSchedule?: SleepScheduleCtx | null, dataSourceId?: string | null,
) {
  return {
    user_id: userId,
    pillar: ev.pillar,
    kind: ev.kind,
    payload: buildEventPayload(ev, sleepSchedule),
    source,
    // Só enviamos quando existe: sem a chave, o banco usa `now()`.
    ...(ev.occurred_at ? { occurred_at: ev.occurred_at } : {}),
    // A fonte entra mesmo sem chave de registro (a trilha "veio deste
    // arquivo" vale por si); a chave, essa só faz sentido com a fonte, que é
    // como o índice único parcial do banco a enxerga.
    ...(dataSourceId ? { data_source_id: dataSourceId } : {}),
    ...(dataSourceId && ev.record_key ? { source_record_key: ev.record_key } : {}),
  };
}

/** Resultado de uma importação em lote — vira o recibo (import_receipts). */
export interface ImportSaveResult {
  /** Eventos elegíveis recebidos (transações não entram por aqui). */
  total: number;
  /** Gravados agora. */
  accepted: number;
  /** Ignorados por já terem vindo desta mesma fonte antes. */
  duplicates: number;
}

/**
 * Grava eventos IMPORTADOS de arquivo, em lote.
 *
 * Diferente de `saveProposedEvents`, que insere um por vez porque a captura
 * propõe dois ou três: aqui são centenas, e 555 requisições sequenciais
 * levariam minutos. Cada pedaço é UM insert com N linhas, e `onProgress`
 * alimenta a barra para a espera ser legível.
 *
 * `source: "import"` distingue estes registros dos feitos à mão — é por ele
 * que o backend pode isentá-los de XP (importar não é viver).
 *
 * IDEMPOTÊNCIA: com `dataSourceId`, reimportar o mesmo arquivo não cria nada
 * de novo e não falha — o que já estava lá é CONTADO como duplicata e vai
 * para o recibo. Uma linha repetida nunca derruba a importação inteira.
 */
export async function saveImportedEvents(
  userId: string,
  events: ProposedEvent[],
  onProgress?: (done: number, total: number) => void,
  opts: { dataSourceId?: string | null; chunkSize?: number } = {},
): Promise<ImportSaveResult> {
  const { dataSourceId = null, chunkSize = 100 } = opts;

  // Importação de arquivo não cria lançamento financeiro — esse caminho tem
  // tela própria (Importar fatura, em Prosperidade).
  const candidates = events.filter((ev) => ev.kind !== "transaction");
  const total = candidates.length;
  let duplicates = 0;
  let accepted = 0;

  let pending = candidates;
  if (dataSourceId) {
    const already = await existingRecordKeys("life_events", userId, dataSourceId);
    if (already.size) {
      pending = candidates.filter((ev) => {
        if (ev.record_key && already.has(ev.record_key)) { duplicates++; return false; }
        return true;
      });
    }
  }

  const rows = pending.map((ev) => lifeEventRow(userId, ev, "import", null, dataSourceId));
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from("life_events").insert(chunk);
    if (error) {
      if (!isDuplicateError(error)) throw error;
      // O insert do lote é uma transação só: uma duplicata derruba as 100.
      // Reenviamos linha a linha para separar o que entra do que já existia
      // (acontece quando a mesma importação roda duas vezes em paralelo, ou
      // quando a consulta de chaves acima falhou).
      for (const row of chunk) {
        const { error: rowErr } = await supabase.from("life_events").insert(row);
        if (!rowErr) { accepted++; continue; }
        if (isDuplicateError(rowErr)) { duplicates++; continue; }
        throw rowErr;
      }
    } else {
      accepted += chunk.length;
    }
    onProgress?.(Math.min(i + chunkSize, rows.length), rows.length);
  }

  return { total, accepted, duplicates };
}
