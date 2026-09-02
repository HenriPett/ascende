import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { ProposedStatementTx } from "@/lib/prosperidade";
import { PARSER_VERSION, statementRecordKeys } from "@/lib/statementImport";
import {
  awardImportMilestone, buildReceiptSummary, createReceipt, createSource,
  confirmSource, markSourcePartial, existingRecordKeys, isDuplicateError,
  type DataSource, type ImportWarning,
} from "@/lib/dataSources";

/** O que a tela sabe sobre o documento e a camada de dados não tem como
 *  descobrir sozinha. Tudo opcional: sem contexto a gravação continua
 *  funcionando, só com uma trilha mais pobre. */
export interface StatementConfirmCtx {
  /** Nome que a pessoa reconhece ("fatura-agosto.pdf"). */
  displayName?: string;
  /** SHA-256 do arquivo (hashFile). É o que reconhece a reimportação: sem
   *  ele, o mesmo documento vira uma fonte nova a cada envio. */
  fileHash?: string | null;
  /** Lançamentos LIDOS do documento, incluindo os que a pessoa desmarcou. */
  totalRows?: number;
  /** Desmarcados por já estarem registrados (findStatementDuplicates). */
  duplicateRows?: number;
  /** Lidos mas descartados na revisão (parcela futura, linha ilegível). */
  rejectedRows?: number;
  warnings?: ImportWarning[];
}

export interface StatementConfirmResult {
  /** Gravados agora. */
  accepted: number;
  /** Ignorados por já terem vindo deste mesmo documento antes. */
  duplicates: number;
  /** A fonte criada (ou reaproveitada), para a tela abrir o recibo. */
  source: DataSource | null;
  /** O marco de +15 XP foi concedido nesta confirmação? */
  awarded: boolean;
}

/** Grava os lançamentos confirmados (source='import') com PROVENIÊNCIA —
 *  fonte, chave de registro e recibo — e tenta o marco de importação
 *  (+15 XP, uma vez por fonte: a ação real foi UMA, trazer o documento).
 *
 *  Reimportar o mesmo documento não duplica nem premia de novo: a fonte é a
 *  mesma (reconhecida pelo hash), as chaves de registro são as mesmas, e o
 *  índice único de `transactions` recusa o que já entrou — recusa que aqui
 *  vira número no recibo, não erro na cara da pessoa.
 *
 *  Compartilhado pelas três superfícies que revisam lançamentos: o diálogo de
 *  importação (Prosperidade), o Conselheiro (Chat) e a CaptureBar. */
export function useStatementConfirm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const confirm = useCallback(async (
    selected: ProposedStatementTx[], ctx?: StatementConfirmCtx,
  ): Promise<StatementConfirmResult | null> => {
    if (!user || !selected.length) return null;
    setSaving(true);
    try {
      // ── 1. A fonte. Falhar aqui NÃO pode impedir a gravação: perder a
      //    trilha é ruim, perder o lançamento da pessoa é pior. Seguimos sem
      //    proveniência e o recibo simplesmente não nasce.
      let source: DataSource | null = null;
      try {
        const days = selected.map((t) => t.occurred_at).filter(Boolean).sort();
        source = await createSource({
          userId: user.id,
          kind: "financial_statement",
          displayName: ctx?.displayName
            ?? `Lançamentos importados em ${new Date().toLocaleDateString("pt-BR")}`,
          fileHash: ctx?.fileHash ?? null,
          parserVersion: PARSER_VERSION,
          periodStart: days[0] ?? null,
          periodEnd: days[days.length - 1] ?? null,
        });
      } catch (e) {
        console.error("fonte da fatura", e);
      }

      // ── 2. As linhas, com a chave estável de cada uma dentro do documento.
      const keys = statementRecordKeys(selected);
      let rows = selected.map((it, i) => ({
        user_id: user.id,
        kind: it.kind,
        amount: it.amount,
        category: it.category,
        description: it.description,
        occurred_at: it.occurred_at,
        source: "import",
        ...(source ? { data_source_id: source.id, source_record_key: keys[i] } : {}),
      }));

      let duplicates = 0;
      if (source) {
        const already = await existingRecordKeys("transactions", user.id, source.id);
        if (already.size) {
          rows = rows.filter((r) => {
            if (already.has(String(r.source_record_key))) { duplicates++; return false; }
            return true;
          });
        }
      }

      // ── 3. Gravação. Uma duplicata derruba o insert do lote inteiro (é uma
      //    transação só), então nesse caso reenviamos uma a uma para separar
      //    o que entra do que já existia.
      let accepted = 0;
      if (rows.length) {
        const { error } = await supabase.from("transactions").insert(rows);
        if (error) {
          if (!isDuplicateError(error)) throw error;
          for (const row of rows) {
            const { error: rowErr } = await supabase.from("transactions").insert(row);
            if (!rowErr) { accepted++; continue; }
            if (isDuplicateError(rowErr)) { duplicates++; continue; }
            throw rowErr;
          }
        } else {
          accepted = rows.length;
        }
      }

      // ── 4. O recibo: o que entrou, o que já estava lá, o que ficou de fora.
      const duplicateRows = duplicates + (ctx?.duplicateRows ?? 0);
      const rejectedRows = ctx?.rejectedRows ?? 0;
      const summary = buildReceiptSummary({
        acceptedRows: accepted,
        duplicateRows,
        rejectedRows,
        acceptedLabel: `${accepted} ${accepted === 1 ? "lançamento" : "lançamentos"}`,
      });
      if (source) {
        await createReceipt({
          sourceId: source.id,
          userId: user.id,
          totalRows: ctx?.totalRows ?? (accepted + duplicateRows + rejectedRows),
          acceptedRows: accepted,
          duplicateRows,
          rejectedRows,
          warnings: ctx?.warnings ?? [],
          summary,
        });
        // Parcial quando parte do documento ficou de fora — o que entrou vale
        // e está no histórico; a fonte só não pode se dizer completa.
        await (rejectedRows > 0 ? markSourcePartial(source.id) : confirmSource(source.id));
      }

      // ── 5. O marco, só quando algo novo entrou de fato.
      //    COM hash: uma vez por FONTE — reimportar o mesmo documento
      //    reencontra a mesma fonte e não premia de novo (§4.4).
      //    SEM hash (foto no chat, print na CaptureBar): não há identidade de
      //    arquivo para reconhecer, então cada envio abriria uma fonte nova e
      //    +15 XP a cada vez. Aí vale a regra antiga, de um marco por mês.
      const awarded = accepted > 0
        && await awardImportMilestone(source?.file_hash ? source.id : null);

      if (accepted > 0) {
        // O marco agora vale para qualquer importação, não só para fatura do
        // mês: a frase acompanha ("mês mapeado" mentiria num extrato avulso).
        toast.success(awarded
          ? `${summary.replace(/\.$/, "")} · +15 XP por trazer o documento`
          : summary);
      } else {
        toast.info(duplicateRows > 0
          ? "Esses lançamentos já estavam registrados. Nada foi duplicado."
          : "Nada novo para registrar.");
      }
      qc.invalidateQueries();
      return { accepted, duplicates, source, awarded };
    } catch (e) {
      console.error("confirmar lançamentos", e);
      toast.error("Não consegui gravar os lançamentos. Tente de novo.");
      return null;
    } finally {
      setSaving(false);
    }
  }, [user, qc]);

  return { confirm, saving };
}
