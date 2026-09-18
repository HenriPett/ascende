// ASCENDE — Registro único das chaves de cache do React Query.
//
// Havia 26 chamadas de `qc.invalidateQueries()` sem chave espalhadas pelo
// app. Sem chave, o React Query refaz TODAS as consultas em cache: a pessoa
// confirma um registro e o app inteiro recarrega, no 4G, para atualizar dois
// números. As listas abaixo dizem o que cada tipo de gravação realmente
// invalida — perfil, conversa do Conselheiro, planos, briefing e link do
// WhatsApp não mudam ao registrar um copo de água, e agora ficam quietos.
//
// Nasceu dentro de CaptureBar.tsx porque src/lib estava fora do escopo da
// tarefa que o criou. Registro de chaves de cache não é assunto de um
// componente de captura: mora aqui.
//
// PENDENTE: os pontos ainda não migrados para invalidação dirigida —
// Prosperidade, Vitalidade, Mente, Batalhas, Chat, Onboarding,
// StatementReview e BattleCheckin continuam invalidando tudo.
//
// CONTRATO COM A TELA, e ele é frágil de propósito: as strings abaixo são
// `as const`, não símbolos. Renomear a `queryKey` de uma tela NÃO gera erro
// aqui — a invalidação simplesmente para de casar, em silêncio, e a pessoa
// registra sono, o toast diz "registrado" e a tela não muda.
// A fusão de 17/09/2026 (alimentacao absorvido por vitalidade) NÃO mexeu em
// nenhuma destas chaves, e é isso que se espera: a tela fundida continua
// usando `["vitalidade", user.id]` e as chaves de dado que já existiam
// (`meals`, `water-today`, `weights`, `sleep-today`). Quem mexer nelas mexe
// aqui no mesmo commit.

import type { QueryClient } from "@tanstack/react-query";

/** O que muda a cada registro, seja ele qual for: XP, progresso do dia,
 *  indicadores e os cartões de retorno/sequência da tela Hoje. */
const DAILY_KEYS = [
  "day-progress", "xp", "score-data", "pillar-activity", "active-streak",
  "first-steps", "retro-preview", "return-gap", "return-standing",
  "wa-hoje-has-events",
] as const;

/** Lançamento financeiro (transactions). */
export const FINANCE_KEYS = [
  ...DAILY_KEYS, "transactions-6m", "category-estimates", "recurring-transactions",
] as const;

/** Registro de sono (life_events kind=sleep|nap). */
export const SLEEP_KEYS = [...DAILY_KEYS, "sleep-today", "vitalidade"] as const;

/** Registro de vida genérico — a captura pode produzir qualquer tipo. */
export const LIFE_DATA_KEYS = [
  ...DAILY_KEYS, "habits-today", "water-today", "sleep-today", "meals",
  "mind-events", "vitalidade", "weights", "transactions-6m",
  "category-estimates", "recurring-transactions", "battles-today", "battles",
] as const;

export function invalidateKeys(qc: QueryClient, keys: readonly string[]) {
  for (const key of keys) qc.invalidateQueries({ queryKey: [key] });
}
