// Importação de fatura: o mês inteiro em um gesto (Prosperidade em camadas, Etapa 3).
// Fluxo: escolher PDF/foto → IA extrai lançamentos PROPOSTOS → confirmação em
// lote (a pessoa desmarca o que não quiser) → grava com source='import'.
// XP: nenhum por item (anti-inflação de nível); um marco único "mês mapeado"
// por mês, via rpc award_import_milestone. Privacidade: o arquivo é processado
// e descartado no servidor — nada da fatura fica armazenado.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { FileUp, Loader2, Check } from "lucide-react";
import { brl } from "@/lib/format";
import { readFnError, isPlanLimit, type PlanLimitError } from "@/lib/fnError";
import type { ProposedStatementTx } from "@/lib/prosperidade";

const MAX_FILE_BYTES = 6_500_000;
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });
}

export default function ImportStatement({
  onImported, onPlanLimit,
}: {
  onImported: () => void;
  onPlanLimit: (info: PlanLimitError) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<ProposedStatementTx[] | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const reset = () => { setItems(null); setChecked([]); setNote(null); };

  const pick = () => fileRef.current?.click();

  const analyze = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error("Arquivo muito grande. Envie só a fatura do mês (até ~6 MB).");
      return;
    }
    setAnalyzing(true);
    reset();
    try {
      const b64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("import-statement", {
        body: { file: b64, media_type: file.type || "application/pdf" },
      });
      if (error) {
        const body = await readFnError(error);
        if (isPlanLimit(body)) { setOpen(false); onPlanLimit(body); return; }
        toast.error((body?.error as string) ?? "Não consegui ler o documento. Tente de novo.");
        return;
      }
      if (data?.error) { toast.error(String(data.error)); return; }
      if (!data?.is_statement) {
        toast.error(data?.note ?? "Isso não parece uma fatura ou extrato.");
        return;
      }
      const list = (data.items ?? []) as ProposedStatementTx[];
      if (!list.length) {
        toast.error("Não encontrei lançamentos legíveis no documento.");
        return;
      }
      setItems(list);
      setChecked(list.map(() => true));
      setNote(data.note ?? null);
    } catch {
      toast.error("Não consegui ler o documento. Tente de novo.");
    } finally {
      setAnalyzing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirm = async () => {
    if (!user || !items) return;
    const selected = items.filter((_, i) => checked[i]);
    if (!selected.length) { toast.error("Selecione pelo menos um lançamento."); return; }
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
      // Marco único por mês: a ação real foi UMA (trazer o documento).
      const { data: awarded } = await supabase.rpc("award_import_milestone");
      toast.success(
        awarded
          ? `${selected.length} lançamentos importados. Mês mapeado: +15 XP`
          : `${selected.length} lançamentos importados.`
      );
      setOpen(false);
      reset();
      qc.invalidateQueries();
      onImported();
    } catch {
      toast.error("Não consegui gravar os lançamentos. Tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  const total = (items ?? [])
    .filter((_, i) => checked[i])
    .reduce((s, it) => s + (it.kind === "expense" ? it.amount : 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="shrink-0">
          <FileUp className="w-4 h-4 mr-1.5" /> Importar fatura
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Importar fatura ou extrato</DialogTitle>
          <DialogDescription>
            O mês inteiro em um gesto: envie o PDF (ou um print) da fatura e confirme os
            lançamentos em lote. O arquivo é processado e descartado — nada fica armazenado.
          </DialogDescription>
        </DialogHeader>

        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) analyze(f); }} />

        {!items && (
          <Button className="w-full" onClick={pick} disabled={analyzing}>
            {analyzing
              ? (<><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Lendo o documento...</>)
              : (<><FileUp className="w-4 h-4 mr-1.5" /> Escolher PDF ou foto</>)}
          </Button>
        )}

        {items && (
          <div className="space-y-3">
            {note && <p className="text-xs text-muted-foreground rounded-md border p-2.5">{note}</p>}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <button className="underline underline-offset-2"
                onClick={() => setChecked(items.map(() => !checked.every(Boolean)))}>
                {checked.every(Boolean) ? "Desmarcar todos" : "Marcar todos"}
              </button>
              <span>{checked.filter(Boolean).length} de {items.length} · saídas {brl(total)}</span>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y rounded-lg border">
              {items.map((it, i) => (
                <label key={i} className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-muted/40">
                  <Checkbox checked={checked[i]}
                    onCheckedChange={(v) => setChecked((arr) => arr.map((c, j) => (j === i ? Boolean(v) : c)))} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{it.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {it.category} · {new Date(it.occurred_at + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                    </p>
                  </div>
                  <span className={it.kind === "expense" ? "text-sm font-medium text-destructive" : "text-sm font-medium text-success"}>
                    {it.kind === "expense" ? "−" : "+"}{brl(it.amount)}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={reset} disabled={saving}>Trocar arquivo</Button>
              <Button className="flex-1" onClick={confirm} disabled={saving}>
                {saving
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : (<><Check className="w-4 h-4 mr-1.5" /> Confirmar selecionados</>)}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Importação não gera XP por item — só o marco "mês mapeado" (+15 XP, uma vez por mês).
              XP é por ação na vida real, não por volume.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
