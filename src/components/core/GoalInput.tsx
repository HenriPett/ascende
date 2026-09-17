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
      {/* `min-h-11` no lugar de `h-9` (36px): este é o controle com que a
          pessoa DEFINE as metas do app — teto do dia, orçamento do mês,
          calorias, proteína. Alvo abaixo de 44px num controle de digitação
          é onde o dedo erra e o número sai trocado. */}
      <Input
        inputMode={inputMode}
        className="min-h-11 text-sm min-w-0 flex-1"
        placeholder={currentLabel || placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        aria-label={placeholder}
      />
      <Button size="sm" variant="outline" className="min-h-11 shrink-0" onClick={submit}>
        <Target className="w-3.5 h-3.5 mr-1.5" /> Definir meta
      </Button>
    </div>
  );
}
