import { supabase } from "@/integrations/supabase/client";
import { todayISO } from "@/lib/format";

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

/** Linha pronta para insert em `life_events`. */
function lifeEventRow(
  userId: string, ev: ProposedEvent, source: string, sleepSchedule?: SleepScheduleCtx | null,
) {
  return {
    user_id: userId,
    pillar: ev.pillar,
    kind: ev.kind,
    payload: buildEventPayload(ev, sleepSchedule),
    source,
    // Só enviamos quando existe: sem a chave, o banco usa `now()`.
    ...(ev.occurred_at ? { occurred_at: ev.occurred_at } : {}),
  };
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
 */
export async function saveImportedEvents(
  userId: string,
  events: ProposedEvent[],
  onProgress?: (done: number, total: number) => void,
  chunkSize = 100,
): Promise<void> {
  // Importação de arquivo não cria lançamento financeiro — esse caminho tem
  // tela própria (Importar fatura, em Prosperidade).
  const rows = events
    .filter((ev) => ev.kind !== "transaction")
    .map((ev) => lifeEventRow(userId, ev, "import"));

  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await supabase.from("life_events").insert(rows.slice(i, i + chunkSize));
    if (error) throw error;
    onProgress?.(Math.min(i + chunkSize, rows.length), rows.length);
  }
}