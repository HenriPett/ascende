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
}

/** Grava os eventos confirmados pelo usuário. Lança erro se algum insert falhar. */
export async function saveProposedEvents(userId: string, events: ProposedEvent[]): Promise<void> {
  for (const ev of events) {
    if (ev.kind === "transaction" && ev.amount && ev.amount > 0) {
      // Transações vão para a tabela própria (o banco cria o evento na linha do tempo)
      const { error } = await supabase.from("transactions").insert({
        user_id: userId,
        kind: ev.tx_kind ?? "expense",
        amount: ev.amount,
        category: ev.category ?? "Outros",
        description: ev.description ?? ev.summary,
        occurred_at: todayISO(),
        source: "capture",
      });
      if (error) throw error;
    } else {
      const payload: Record<string, unknown> = {};
      if (ev.hours) payload.hours = ev.hours;
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
      const { error } = await supabase.from("life_events").insert({
        user_id: userId,
        pillar: ev.pillar,
        kind: ev.kind,
        payload,
        source: "chat_capture",
      });
      if (error) throw error;
    }
  }
}