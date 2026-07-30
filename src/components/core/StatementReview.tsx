// Revisão de lançamentos propostos (fatura, print, comprovante) — o miolo
// que antes vivia dentro de ImportStatement e agora é compartilhado pelas
// TRÊS superfícies onde a pessoa fala com a IA: o diálogo de importação
// (Prosperidade), o Conselheiro (Chat) e a CaptureBar (Hoje/Onboarding).
// Mesma UX nos três lugares: lista com checkboxes, badges de parcela,
// duplicatas desmarcadas por padrão, confirmação em lote. A IA propõe,
// a pessoa confirma — nada é gravado sozinho.
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { brl } from "@/lib/format";
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

/** Grava os lançamentos confirmados (source='import') e tenta o marco
 *  "mês mapeado" (+15 XP, 1x/mês — a ação real foi UMA: trazer o documento). */
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

export default function StatementReview({
  items, checked, dup, note, saving,
  onToggle, onToggleAll, onCancel, onConfirm,
  cancelLabel = "Cancelar",
}: {
  items: ProposedStatementTx[];
  checked: boolean[];
  dup: boolean[];
  note?: string | null;
  saving?: boolean;
  onToggle: (index: number, value: boolean) => void;
  onToggleAll: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
}) {
  const total = items
    .filter((_, i) => checked[i])
    .reduce((s, it) => s + (it.kind === "expense" ? it.amount : 0), 0);
  const allChecked = checked.every(Boolean);

  return (
    <div className="space-y-3">
      {note && <p className="text-xs text-muted-foreground rounded-md border p-2.5">{note}</p>}
      {items.some((it) => it.origin === "past" || it.origin === "future") && (
        <p className="text-xs text-muted-foreground rounded-md border p-2.5">
          Compras parceladas foram expandidas: as parcelas <strong>passadas e futuras</strong> entram
          nos meses certos, para o retrato ficar completo de uma vez. Desmarque o que não quiser —
          e o que já estava registrado veio desmarcado sozinho.
        </p>
      )}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button className="underline underline-offset-2" onClick={() => onToggleAll(!allChecked)}>
          {allChecked ? "Desmarcar todos" : "Marcar todos"}
        </button>
        <span>{checked.filter(Boolean).length} de {items.length} · saídas {brl(total)}</span>
      </div>
      <div className="max-h-72 overflow-y-auto divide-y rounded-lg border">
        {items.map((it, i) => (
          <label key={i} className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-muted/40">
            <Checkbox checked={checked[i]} onCheckedChange={(v) => onToggle(i, Boolean(v))} />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">
                {it.description}
                {it.origin === "past" && <Badge variant="secondary" className="text-[10px] ml-1.5 align-middle">parcela passada</Badge>}
                {it.origin === "future" && <Badge variant="secondary" className="text-[10px] ml-1.5 align-middle">parcela futura</Badge>}
                {dup[i] && <Badge variant="outline" className="text-[10px] ml-1.5 align-middle">já registrado</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                {it.category} · {new Date(it.occurred_at + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" })}
              </p>
            </div>
            <span className={it.kind === "expense" ? "text-sm font-medium text-destructive" : "text-sm font-medium text-success"}>
              {it.kind === "expense" ? "−" : "+"}{brl(it.amount)}
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          <X className="w-4 h-4 mr-1" /> {cancelLabel}
        </Button>
        <Button className="flex-1" onClick={onConfirm} disabled={saving}>
          {saving
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : (<><Check className="w-4 h-4 mr-1.5" /> Confirmar selecionados</>)}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Importação não gera XP por item — só o marco "mês mapeado" (+15 XP, uma vez por mês).
        XP é por ação na vida real, não por volume. A imagem foi processada e descartada.
      </p>
    </div>
  );
}
