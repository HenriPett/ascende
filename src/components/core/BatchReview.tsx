import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";

/* Revisão em lote — o esqueleto compartilhado.
 *
 * A fatura (StatementReview) e o CSV de saúde (HealthImport) chegam por
 * caminhos diferentes de propósito: um depende de interpretação de documento,
 * o outro é parsing determinístico. Mas a REVISÃO era a mesma coisa escrita
 * duas vezes: marcar/desmarcar todos, contador "N de M", lista rolável com
 * divide-y, linha com Checkbox, badge de duplicado, Cancelar/Confirmar e um
 * rodapé explicativo. O plano (§4.3) pede exatamente isso — parsers
 * diferentes, interface de revisão única.
 *
 * O que cada tela ainda traz de seu entra pelos slots: `header` (o cabeçalho
 * rico da importação de saúde, o aviso de parcelas da fatura), `progress`
 * (barra de lotes, só saúde), `footer` (o texto de rodapé) e `renderItem`,
 * que desenha o conteúdo da linha à direita do checkbox.
 *
 * O estado do `checked` vive SEMPRE no pai. Era assim na fatura e passou a
 * ser assim na saúde: quem grava é quem sabe o que está selecionado. */

/** Badge de "já registrado". Idêntico nas duas telas — agora escrito uma vez. */
export function DuplicateBadge() {
  return <Badge variant="outline" className="text-caption2 ml-1.5 align-middle">já registrado</Badge>;
}

export default function BatchReview<T>({
  items,
  checked,
  dup,
  renderItem,
  itemKey,
  itemStyle,
  header,
  progress,
  footer,
  counterSuffix,
  confirmLabel,
  confirmDisabled = false,
  cancelLabel = "Cancelar",
  saving = false,
  itemsDisabled = false,
  listClassName = "max-h-72 overflow-y-auto divide-y rounded-lg border",
  onToggle,
  onToggleAll,
  onCancel,
  onConfirm,
}: {
  items: T[];
  checked: boolean[];
  /** Quais itens já existem no histórico. Chega ao `renderItem` como 3º
   *  argumento, para a tela decidir ONDE encaixar o `DuplicateBadge`. */
  dup: boolean[];
  /** Conteúdo da linha à direita do checkbox. */
  renderItem: (item: T, index: number, isDuplicate: boolean) => ReactNode;
  itemKey?: (item: T, index: number) => string;
  itemStyle?: CSSProperties;
  /** Tudo acima da barra de "marcar todos": cabeçalho, avisos, notas. */
  header?: ReactNode;
  /** Entre a lista e os botões — a barra de progresso da gravação em lotes. */
  progress?: ReactNode;
  footer?: ReactNode;
  /** Emendado ao "N de M": " · saídas R$ 120,00" ou " selecionados". */
  counterSuffix?: ReactNode;
  confirmLabel?: ReactNode;
  confirmDisabled?: boolean;
  cancelLabel?: string;
  saving?: boolean;
  /** Trava os checkboxes durante a gravação. */
  itemsDisabled?: boolean;
  listClassName?: string;
  onToggle: (index: number, value: boolean) => void;
  onToggleAll: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const selected = checked.filter(Boolean).length;
  const allChecked = checked.length > 0 && checked.every(Boolean);

  return (
    <div className="space-y-3">
      {header}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button
          className="underline underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => onToggleAll(!allChecked)}
          disabled={saving}
        >
          {allChecked ? "Desmarcar todos" : "Marcar todos"}
        </button>
        <span>{selected} de {items.length}{counterSuffix}</span>
      </div>

      <div className={listClassName}>
        {items.map((item, i) => (
          <label
            key={itemKey ? itemKey(item, i) : i}
            className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-muted/40"
            style={itemStyle}
          >
            <Checkbox
              checked={checked[i]}
              disabled={itemsDisabled}
              onCheckedChange={(v) => onToggle(i, Boolean(v))}
            />
            {renderItem(item, i, Boolean(dup[i]))}
          </label>
        ))}
      </div>

      {progress}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          <X className="w-4 h-4 mr-1" /> {cancelLabel}
        </Button>
        <Button className="flex-1" onClick={onConfirm} disabled={saving || confirmDisabled} loading={saving}>
          <Check className="w-4 h-4 mr-1.5" /> {confirmLabel}
        </Button>
      </div>

      {footer}
    </div>
  );
}
