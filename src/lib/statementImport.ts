// ASCENDE — Deduplicação de lançamentos vindos de fatura, print ou comprovante.
//
// Consulta o banco (mesmo padrão de captureEvents.ts: lib com I/O), e por isso
// mora aqui e não em prosperidade.ts, que é lógica pura.

import { supabase } from "@/integrations/supabase/client";
import type { ProposedStatementTx } from "@/lib/prosperidade";

/** Versão da regra que produz estes lançamentos, gravada na fonte
 *  (data_sources.parser_version). */
export const PARSER_VERSION = "statement/1";

/** Chave de deduplicação: mesmo tipo, valor, mês e descrição normalizada. */
const txKey = (t: { kind: string; amount: number; occurred_at: string; description: string | null }) =>
  `${t.kind}|${Number(t.amount).toFixed(2)}|${t.occurred_at.slice(0, 7)}|${(t.description ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;

/**
 * Chave estável de cada lançamento DENTRO da fatura, alinhada por índice com
 * a lista recebida. É o que torna reimportar o mesmo documento idempotente
 * (índice único em transactions).
 *
 * Duas diferenças em relação a `txKey`, e as duas importam:
 * • usa o DIA, não o mês: dentro de um arquivo, dois lançamentos iguais em
 *   dias diferentes são coisas diferentes;
 * • lançamentos genuinamente idênticos (dois cafés na mesma padaria no mesmo
 *   dia) ganham um sufixo #2, #3… Colapsá-los seria apagar uma compra que
 *   existiu — o erro mais caro possível numa importação financeira.
 *
 * A ordem da lista NÃO influencia o resultado: as chaves são numeradas sobre
 * uma cópia ordenada, então o mesmo conjunto de itens gera sempre as mesmas
 * chaves, mesmo que a leitura do documento devolva tudo em outra ordem.
 */
export function statementRecordKeys(list: ProposedStatementTx[]): string[] {
  const base = (t: ProposedStatementTx) =>
    `${t.kind}|${Number(t.amount).toFixed(2)}|${t.occurred_at}|${(t.description ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;

  const order = list.map((tx, index) => ({ tx, index }))
    .sort((a, b) => base(a.tx).localeCompare(base(b.tx)) || a.index - b.index);

  const seen = new Map<string, number>();
  const keys: string[] = new Array(list.length);
  for (const { tx, index } of order) {
    const k = base(tx);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    keys[index] = n === 1 ? k : `${k}#${n}`;
  }
  return keys;
}

/** A conferência de duplicatas não pôde ser feita. É erro de propósito: as
 *  três telas que chamam `findStatementDuplicates` já envolvem a chamada em
 *  try/catch e mostram recusa, então lançar PARA o fluxo antes da revisão. */
export class StatementDuplicateCheckError extends Error {
  constructor(cause?: string) {
    super("Não consegui conferir o que já está registrado. Tente de novo em instantes.");
    this.name = "StatementDuplicateCheckError";
    if (cause) console.error("findStatementDuplicates", cause);
  }
}

/**
 * Marca como duplicata o que já existe registrado no período dos itens.
 *
 * FALHA AQUI NÃO PODE VIRAR SILÊNCIO. A versão anterior ignorava o erro da
 * consulta e devolvia "nada duplicado" — que a tela lê como "pode marcar
 * tudo". Numa rede instável, a fatura inteira vinha pré-marcada para
 * reimportação, e a pessoa confirmava em cima de lançamentos que já estavam
 * lá. Sem conferência não há revisão honesta: melhor recusar e pedir de novo
 * do que oferecer uma lista com cara de conferida.
 */
export async function findStatementDuplicates(
  userId: string, list: ProposedStatementTx[],
): Promise<boolean[]> {
  if (!list.length) return [];
  const dates = list.map((i) => i.occurred_at).sort();
  const { data: existing, error } = await supabase.from("transactions")
    .select("kind,amount,description,occurred_at")
    .eq("user_id", userId)
    .gte("occurred_at", dates[0]).lte("occurred_at", dates[dates.length - 1])
    .limit(2000);
  if (error) throw new StatementDuplicateCheckError(error.message);
  const seen = new Set((existing ?? []).map(txKey));
  return list.map((it) => seen.has(txKey(it)));
}

/* O desfecho da importação (o que ficou de fora, e se a fonte é 'partial')
   mora em dataSourcesPure.ts: `importOutcome`. É a MESMA conta para a fatura
   e para o arquivo de saúde — quando cada tela tinha a sua, uma esquecia o
   que a pessoa desmarcou e a outra misturava linha de CSV com registro. */
