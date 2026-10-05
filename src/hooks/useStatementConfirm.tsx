import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { ProposedStatementTx } from "@/lib/prosperidade";
import { PARSER_VERSION, statementRecordKeys } from "@/lib/statementImport";
import {
  awardImportMilestone, buildReceiptSummary, createReceipt, createSource,
  confirmSource, importOutcome, markSourcePartial, existingRecordKeys, isDuplicateError,
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
  /** Lidos mas que ficaram de fora, sem distinguir o motivo. Continua aceito
   *  para não quebrar quem já chama assim, e é lido como DESMARCADO: acusar a
   *  fonte de incompleta sem prova de linha ilegível é o defeito que
   *  `unreadableRows` veio corrigir. */
  rejectedRows?: number;
  /** Linhas que o documento trouxe e NÃO deu para ler. Ficam FORA da
   *  partição do recibo (nunca viraram lançamento) e são a única coisa que
   *  marca a fonte como 'partial' — problema nosso, não escolha dela. */
  unreadableRows?: number;
  /** Desmarcados de propósito na revisão (parcela futura, compra que ela não
   *  quer registrar). Caminho saudável: não deixa a fonte incompleta. */
  discardedRows?: number;
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
      // ── 1. A fonte. SEM ELA NÃO GRAVAMOS — e isso é uma mudança
      //    deliberada em relação ao que este arquivo fazia antes.
      //
      //    O índice único que protege o dinheiro de entrar duas vezes é
      //    PARCIAL: só vale quando `data_source_id` E `source_record_key`
      //    existem na linha. Gravar "só o lançamento, sem a trilha" desligava
      //    a proteção exatamente no caminho de erro — e é aí que a pessoa
      //    tenta de novo. Duas tentativas viravam gasto em dobro no histórico
      //    dela, sem nada para desfazer.
      //
      //    Entre perder uma tentativa de importação (ela reenvia, e o hash
      //    reconhece o mesmo arquivo) e duplicar dinheiro no histórico, a
      //    escolha não é difícil.
      let source: DataSource;
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
        toast.error("Não consegui abrir a trilha deste arquivo, então não gravei nada. Tente de novo.", { id: "fatura-gravar" });
        return null;
      }

      // ── 2. As linhas, com a chave estável de cada uma dentro do documento.
      const keys = statementRecordKeys(selected);
      // As duas colunas de proveniência SEMPRE juntas: é o par que o índice
      // único parcial enxerga. Uma sem a outra não protege nada.
      let rows = selected.map((it, i) => ({
        user_id: user.id,
        kind: it.kind,
        amount: it.amount,
        category: it.category,
        description: it.description,
        occurred_at: it.occurred_at,
        source: "import",
        data_source_id: source.id,
        source_record_key: keys[i],
      }));

      let duplicates = 0;
      const already = await existingRecordKeys("transactions", user.id, source.id);
      if (already.size) {
        rows = rows.filter((r) => {
          if (already.has(String(r.source_record_key))) { duplicates++; return false; }
          return true;
        });
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
      //    `rejectedRows` legado (sem motivo declarado) conta como DESMARCADO:
      //    é o caso comum, e chamar de ilegível o que a pessoa escolheu deixar
      //    de fora acusaria o documento de um defeito que ele não tem.
      const duplicateRows = duplicates + (ctx?.duplicateRows ?? 0);
      const outcome = importOutcome({
        acceptedRows: accepted,
        duplicateRows,
        discardedRows: ctx?.discardedRows ?? ctx?.rejectedRows ?? 0,
        unreadableLines: ctx?.unreadableRows ?? 0,
      });
      const summary = buildReceiptSummary({
        acceptedRows: accepted,
        duplicateRows,
        rejectedRows: outcome.rejectedRows,
        acceptedLabel: `${accepted} ${accepted === 1 ? "lançamento" : "lançamentos"}`,
      });
      await createReceipt({
        sourceId: source.id,
        userId: user.id,
        totalRows: outcome.totalRows,
        acceptedRows: accepted,
        duplicateRows,
        rejectedRows: outcome.rejectedRows,
        warnings: ctx?.warnings ?? [],
        summary,
      });
      // 'partial' agora quer dizer UMA coisa: o documento tinha linha que não
      // deu para ler. Parcela futura desmarcada é a pessoa usando a revisão
      // como ela deve ser usada, e não deixa a fonte marcada como incompleta.
      await (outcome.status === "partial"
        ? markSourcePartial(source.id)
        : confirmSource(source.id));

      // ── 5. O marco, só quando algo novo entrou de fato.
      //    COM hash: uma vez por FONTE — reimportar o mesmo documento
      //    reencontra a mesma fonte e não premia de novo (§4.4).
      //    SEM hash (foto no chat, print na CaptureBar): não há identidade de
      //    arquivo para reconhecer, então cada envio abriria uma fonte nova e
      //    +15 XP a cada vez. Aí vale a regra antiga, de um marco por mês.
      const awarded = accepted > 0
        && await awardImportMilestone(source.file_hash ? source.id : null);

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
      // Gravou: o erro de uma tentativa anterior (trilha ou linhas) não vale mais.
      toast.dismiss("fatura-gravar");
      qc.invalidateQueries();
      return { accepted, duplicates, source, awarded };
    } catch (e) {
      console.error("confirmar lançamentos", e);
      toast.error("Não consegui gravar os lançamentos. Tente de novo.", { id: "fatura-gravar" });
      return null;
    } finally {
      setSaving(false);
    }
  }, [user, qc]);

  return { confirm, saving };
}
