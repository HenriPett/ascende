import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { ProposedStatementTx } from "@/lib/prosperidade";

/** Grava os lançamentos confirmados (source='import') e tenta o marco
 *  "mês mapeado" (+15 XP, 1x/mês — a ação real foi UMA: trazer o documento).
 *
 *  Compartilhado pelas três superfícies que revisam lançamentos: o diálogo de
 *  importação (Prosperidade), o Conselheiro (Chat) e a CaptureBar. */
export function useStatementConfirm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const confirm = useCallback(async (selected: ProposedStatementTx[]): Promise<boolean> => {
    if (!user || !selected.length) return false;
    setSaving(true);
    try {
      const { error } = await supabase.from("transactions").insert(
        selected.map((it) => ({
          user_id: user.id,
          kind: it.kind,
          amount: it.amount,
          category: it.category,
          description: it.description,
          occurred_at: it.occurred_at,
          source: "import",
        }))
      );
      if (error) throw error;
      const { data: awarded } = await supabase.rpc("award_import_milestone");
      toast.success(
        awarded
          ? `${selected.length} lançamento${selected.length > 1 ? "s" : ""} registrado${selected.length > 1 ? "s" : ""}. Mês mapeado: +15 XP`
          : `${selected.length} lançamento${selected.length > 1 ? "s" : ""} registrado${selected.length > 1 ? "s" : ""}.`
      );
      qc.invalidateQueries();
      return true;
    } catch {
      toast.error("Não consegui gravar os lançamentos. Tente de novo.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [user, qc]);

  return { confirm, saving };
}
