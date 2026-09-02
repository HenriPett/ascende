/* ASCENDE — A LINHA DE FOCO DO CABEÇALHO DA HOJE.
 *
 * O QUE ESTAVA ERRADO
 * A linha era `DAILY_FOCUS[new Date().getDay()]`, sem nenhuma condição. Numa
 * quinta-feira, quem registrou o gasto do dia às 9h reabria o app às 20h e
 * continuava lendo "Conte um gasto de hoje — o retrato do seu mês fica mais
 * nítido a cada real". A instrução mais visível da tela pedia algo que já
 * tinha sido feito.
 *
 * Um gatilho que erra o estado não é neutro: ele ensina a pessoa a não ler
 * aquela linha, e ela é o único lugar do cabeçalho que pode carregar direção.
 * É o "Timely" do EAST — gatilho certo, momento errado, valor zero.
 *
 * A ORDEM É A MESMA DAS ZONAS
 * "o que PERECE hoje > o que ela PROMETEU > o que já aconteceu". É a ordem que
 * HOJE_ZONES já usa (Hoje.tsx), e repeti-la aqui é de propósito: a linha de
 * texto e os cartões abaixo dela não podem discordar sobre o que é urgente.
 *
 * A ÚLTIMA FRASE É A RÉGUA DA CASA DITA EM VOZ ALTA
 * "Dia registrado. Pode fechar o app — a subida é lá fora." É PRINCIPIOS.md
 * ("o Ascende ganha dinheiro quando a vida do usuário melhora, nunca quando
 * ele fica mais tempo no app") escrito no lugar onde custa engajamento. É
 * exatamente por isso que ela pertence ali. Quem for trocá-la por um convite
 * a continuar navegando está trocando a régua, não a redação.
 *
 * Módulo PURO: sem relógio próprio, sem I/O. O dia da semana entra por
 * parâmetro, como em lib/insights.ts, para o teste não depender de quando roda.
 */

/** Sugestão local do dia (custo zero, determinística por dia da semana):
 *  quando o briefing com IA não está disponível, o card muda de assunto em
 *  vez de mostrar cadeado (análise UX P0.1). */
export const DAILY_FOCUS = [
  "Domingo é dia da sua retrospectiva — ela nasce do que você registrou na semana.",
  "Uma frase na captura abaixo registra o dia inteiro: gasto, treino, sono, humor.",
  "Foto do prato → calorias na hora. O registro mais rápido do app.",
  "Água e humor em 1 toque, logo abaixo. Dez segundos e o dia está vivo.",
  "Conte um gasto de hoje — o retrato do seu mês fica mais nítido a cada real.",
  "Marque um compromisso de hoje como feito: é isso que constrói a sequência.",
  "Semana fechando: cada registro de hoje aparece na retrospectiva de domingo.",
];

export interface FocusState {
  /** Quantos registros a pessoa já colocou hoje. */
  eventsToday: number;
  /** Compromissos diários ainda não marcados hoje. */
  pendingHabits: number;
  /** O convite matinal de sono está de pé (ele perece ao meio-dia). */
  sleepPending: boolean;
  /** Dia da semana, 0 = domingo (o mesmo índice de `Date#getDay`). */
  weekday: number;
}

/**
 * A frase do cabeçalho, para o estado real do dia.
 *
 * Sem nenhum registro, a sugestão do dia da semana continua valendo: é convite,
 * e convite para quem ainda não começou está certo. Depois do primeiro
 * registro, a linha passa a apontar para o que ainda PERECE — e, quando não
 * há mais nada pendente, ela devolve a tarde para a pessoa.
 */
export function focusLine({
  eventsToday, pendingHabits, sleepPending, weekday,
}: FocusState): string {
  if (eventsToday === 0) return DAILY_FOCUS[weekday] ?? DAILY_FOCUS[0];
  if (sleepPending) return "Falta confirmar como foi a sua noite — um toque, aqui embaixo.";
  if (pendingHabits > 0) {
    return pendingHabits === 1
      ? "Falta um compromisso de hoje."
      : `Faltam ${pendingHabits} compromissos de hoje.`;
  }
  return "Dia registrado. Pode fechar o app — a subida é lá fora.";
}
