// ASCENDE — Deduplicação de lançamentos vindos de fatura, print ou comprovante.
//
// Consulta o banco (mesmo padrão de captureEvents.ts: lib com I/O), e por isso
// mora aqui e não em prosperidade.ts, que é lógica pura.

import { supabase } from "@/integrations/supabase/client";
import type { ProposedStatementTx } from "@/lib/prosperidade";

/** Chave de deduplicação: mesmo tipo, valor, mês e descrição normalizada. */
const txKey = (t: { kind: string; amount: number; occurred_at: string; description: string | null }) =>
  `${t.kind}|${Number(t.amount).toFixed(2)}|${t.occurred_at.slice(0, 7)}|${(t.description ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;

/** Marca como duplicata o que já existe registrado no período dos itens. */
export async function findStatementDuplicates(
  userId: string, list: ProposedStatementTx[],
): Promise<boolean[]> {
  if (!list.length) return [];
  const dates = list.map((i) => i.occurred_at).sort();
  const { data: existing } = await supabase.from("transactions")
    .select("kind,amount,description,occurred_at")
    .eq("user_id", userId)
    .gte("occurred_at", dates[0]).lte("occurred_at", dates[dates.length - 1])
    .limit(2000);
  const seen = new Set((existing ?? []).map(txKey));
  return list.map((it) => seen.has(txKey(it)));
}
