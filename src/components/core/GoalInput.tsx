import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Target } from "lucide-react";

/**
 * Entrada de meta padronizada — mesma anatomia em todos os pilares:
 * input compacto com a meta atual no placeholder + botão "Meta".
 * A validação e o toast ficam com a página (cada meta tem suas regras).
 */
export default function GoalInput({
  placeholder,
  currentLabel,
  onSubmit,
  inputMode = "decimal",
}: {
  placeholder: string;
  /** Meta atual formatada (vira o placeholder quando existe). Ex.: "Meta: 3.000 kcal/dia" */
  currentLabel?: string | null;
  onSubmit: (raw: string) => void | Promise<void>;
  inputMode?: "decimal" | "numeric";
}) {
  const [value, setValue] = useState("");

  const submit = async () => {
    if (!value.trim()) return;
    await onSubmit(value);
    setValue("");
  };

  return (
    <div className="flex gap-2 items-center">
      <Input
        inputMode={inputMode}
        className="h-9 text-sm min-w-0 flex-1"
        placeholder={currentLabel || placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        aria-label={placeholder}
      />
      <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={submit}>
        <Target className="w-3.5 h-3.5 mr-1.5" /> Meta
      </Button>
    </div>
  );
}
