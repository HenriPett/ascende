// Importação de fatura: o mês inteiro em um gesto (Prosperidade em camadas, Etapa 3).
// Fluxo: escolher PDF/foto → IA extrai lançamentos PROPOSTOS → confirmação em
// lote (a pessoa desmarca o que não quiser) → grava com source='import'.
// XP: nenhum por item (anti-inflação de nível); um marco único "mês mapeado"
// por mês, via rpc award_import_milestone. Privacidade: o arquivo é processado
// e descartado no servidor — nada da fatura fica armazenado.
//
// Refactor (Fatura em toda IA): a lista de revisão e a gravação em lote agora
// vivem em StatementReview/useStatementConfirm — as mesmas peças usadas pelo
// Conselheiro (Chat) e pela CaptureBar. Este diálogo continua sendo o caminho
// para o PDF de fatura completa.
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { fileToBase64 } from "@/lib/files";
import { formatSP } from "@/lib/dates";
import { hashFile, findSourceByHash } from "@/lib/dataSources";
import { readFnError, isPlanLimit, type PlanLimitError } from "@/lib/fnError";
import type { ProposedStatementTx } from "@/lib/prosperidade";
import StatementReview from "@/components/core/StatementReview";
import { findStatementDuplicates } from "@/lib/statementImport";
import { useStatementConfirm } from "@/hooks/useStatementConfirm";

const MAX_FILE_BYTES = 6_500_000;
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

export default function ImportStatement({
  onImported, onPlanLimit,
}: {
  onImported: () => void;
  onPlanLimit: (info: PlanLimitError) => void;
}) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [items, setItems] = useState<ProposedStatementTx[] | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [dup, setDup] = useState<boolean[]>([]);
  const [note, setNote] = useState<string | null>(null);
  // Identidade do documento. O hash é o que reconhece a reimportação: sem
  // ele, o MESMO PDF abriria uma fonte nova a cada envio e o marco de +15 XP
  // voltaria à regra genérica de 1x/mês.
  const [file, setFile] = useState<{ name: string; hash: string } | null>(null);
  const [seenBefore, setSeenBefore] = useState<string | null>(null);
  const { confirm: confirmStatement, saving } = useStatementConfirm();

  const reset = () => {
    setItems(null); setChecked([]); setDup([]); setNote(null);
    setFile(null); setSeenBefore(null);
  };

  const pick = () => fileRef.current?.click();

  const analyze = async (picked: File) => {
    if (picked.size > MAX_FILE_BYTES) {
      toast.error("Arquivo muito grande. Envie só a fatura do mês (até ~6 MB).");
      return;
    }
    setAnalyzing(true);
    reset();
    try {
      const b64 = await fileToBase64(picked);
      const { data, error } = await supabase.functions.invoke("import-statement", {
        body: { file: b64, media_type: picked.type || "application/pdf" },
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
      const dups = user ? await findStatementDuplicates(user.id, list) : list.map(() => false);
      // Hash do próprio arquivo (Blob), que é o que foi enviado para leitura.
      const hash = await hashFile(picked);
      setFile({ name: picked.name, hash });
      if (user) {
        const previous = await findSourceByHash(user.id, hash);
        setSeenBefore(previous?.created_at ?? null);
      }
      setItems(list);
      setDup(dups);
      setChecked(list.map((_, i) => !dups[i]));
      setNote(data.note ?? null);
    } catch {
      toast.error("Não consegui ler o documento. Tente de novo.");
    } finally {
      setAnalyzing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirm = async () => {
    if (!items) return;
    const selected = items.filter((_, i) => checked[i]);
    if (!selected.length) { toast.error("Selecione pelo menos um lançamento."); return; }

    // As contas do recibo, particionando o documento inteiro: o que entrou,
    // o que ficou fora por já estar registrado, e o que a pessoa descartou na
    // revisão. Os três somam `totalRows` — é o que permite auditar depois.
    const duplicateRows = items.filter((_, i) => dup[i] && !checked[i]).length;
    const rejectedRows = items.filter((_, i) => !checked[i] && !dup[i]).length;

    const ok = await confirmStatement(selected, {
      displayName: file?.name,
      fileHash: file?.hash ?? null,
      totalRows: items.length,
      duplicateRows,
      rejectedRows,
    });
    if (ok) {
      setOpen(false);
      reset();
      onImported();
    }
  };

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
            Dica: prints e comprovantes avulsos também funcionam direto na captura da tela
            Hoje e na conversa com o Conselheiro.
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

        {items && seenBefore && (
          <p className="text-xs rounded-md border border-primary/30 bg-primary/5 p-2.5">
            Você já importou este documento em{" "}
            <strong>{formatSP(seenBefore, { day: "2-digit", month: "short", year: "numeric" })}</strong>.
            Confirmar de novo não duplica o que já está gravado, e não rende XP outra vez.
          </p>
        )}

        {items && (
          <StatementReview
            items={items} checked={checked} dup={dup} note={note} saving={saving}
            cancelLabel="Trocar arquivo"
            onToggle={(i, v) => setChecked((arr) => arr.map((c, j) => (j === i ? v : c)))}
            onToggleAll={(v) => setChecked(items.map(() => v))}
            onCancel={reset}
            onConfirm={confirm}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}