// Revisão de lançamentos propostos (fatura, print, comprovante) — o miolo
// que antes vivia dentro de ImportStatement e agora é compartilhado pelas
// TRÊS superfícies onde a pessoa fala com a IA: o diálogo de importação
// (Prosperidade), o Conselheiro (Chat) e a CaptureBar (Hoje/Onboarding).
// Mesma UX nos três lugares: lista com checkboxes, badges de parcela,
// duplicatas desmarcadas por padrão, confirmação em lote. A IA propõe,
// a pessoa confirma — nada é gravado sozinho.
//
// O esqueleto da revisão (marcar todos, contador, lista, botões) mora em
// BatchReview, compartilhado com a importação de CSV de saúde. Aqui fica só
// o que é do mundo financeiro: parcelas, categoria e valor.
import { Badge } from "@/components/ui/badge";
import BatchReview, { DuplicateBadge } from "@/components/core/BatchReview";
import { brl } from "@/lib/format";
import type { ProposedStatementTx } from "@/lib/prosperidade";

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

  return (
    <BatchReview
      items={items}
      checked={checked}
      dup={dup}
      saving={saving}
      cancelLabel={cancelLabel}
      confirmLabel="Confirmar selecionados"
      counterSuffix={<> · saídas {brl(total)}</>}
      onToggle={onToggle}
      onToggleAll={onToggleAll}
      onCancel={onCancel}
      onConfirm={onConfirm}
      header={
        <>
          {note && <p className="text-xs text-muted-foreground rounded-md border p-2.5">{note}</p>}
          {items.some((it) => it.origin === "past" || it.origin === "future") && (
            <p className="text-xs text-muted-foreground rounded-md border p-2.5">
              Compras parceladas foram expandidas: as parcelas <strong>passadas e futuras</strong> entram
              nos meses certos, para o retrato ficar completo de uma vez. Desmarque o que não quiser —
              e o que já estava registrado veio desmarcado sozinho.
            </p>
          )}
        </>
      }
      footer={
        <p className="text-caption2 text-muted-foreground">
          Importação não gera XP por item — só o marco "mês mapeado" (+15 XP, uma vez por mês).
          XP é por ação na vida real, não por volume. A imagem foi processada e descartada.
        </p>
      }
      renderItem={(it, _i, isDup) => (
        <>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">
              {it.description}
              {it.origin === "past" && <Badge variant="secondary" className="text-caption2 ml-1.5 align-middle">parcela passada</Badge>}
              {it.origin === "future" && <Badge variant="secondary" className="text-caption2 ml-1.5 align-middle">parcela futura</Badge>}
              {isDup && <DuplicateBadge />}
            </p>
            <p className="text-xs text-muted-foreground">
              {it.category} · {new Date(it.occurred_at + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" })}
            </p>
          </div>
          <span className={it.kind === "expense" ? "text-sm font-medium text-destructive" : "text-sm font-medium text-success"}>
            {it.kind === "expense" ? "−" : "+"}{brl(it.amount)}
          </span>
        </>
      )}
    />
  );
}
