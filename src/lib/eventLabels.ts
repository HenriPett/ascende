// ASCENDE — Tradução centralizada dos tipos internos de evento (plano §5.2).
// Nenhum nome interno (habit_done, battle_checkin, water...) deve chegar à
// interface: use eventLabel()/kindLabel() na linha do tempo, relatórios,
// Indicadores, Mente e Conselheiro.

export const KIND_LABEL: Record<string, string> = {
  habit_done: "Hábito concluído",
  battle_checkin: "Check-in de batalha",
  transaction: "Lançamento financeiro",
  workout: "Treino registrado",
  practice: "Prática registrada",
  mood: "Humor registrado",
  sleep: "Sono registrado",
  nap: "Soneca registrada",
  meal: "Refeição registrada",
  water: "Hidratação registrada",
  journal: "Entrada no diário",
  weight: "Peso registrado",
  body: "Composição corporal registrada",
  gratitude: "Gratidão registrada",
  note: "Anotação",
};

/** Rótulo legível para um tipo interno de evento. Nunca devolve o código cru. */
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "Registro";
}

/**
 * Melhor rótulo para um evento: usa o texto/summary do payload quando existe
 * e cai para a tradução do tipo — nunca para o nome interno.
 */
export function eventLabel(
  kind: string,
  payload?: { text?: string; summary?: string; description?: string } | null,
): string {
  return payload?.text ?? payload?.summary ?? payload?.description ?? kindLabel(kind);
}
