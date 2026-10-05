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
    /* `flex-wrap` com piso no campo: no tamanho padrão campo e "Definir
       meta" dividem a linha, como antes; com Texto Maior o botão desce para
       baixo do campo em vez de empurrar a página. Sem `shrink-0` no botão:
       no toque o rótulo do `Button` quebra linha, e `shrink-0` o prenderia à
       largura de uma linha só — mais larga que a tela no maior tamanho. */
    <div className="flex flex-wrap gap-2 items-center">
      {/* `min-h-11` no lugar de `h-9` (36px): este é o controle com que a
          pessoa DEFINE as metas do app — teto do dia, orçamento do mês,
          calorias, proteína. Alvo abaixo de 44px num controle de digitação
          é onde o dedo erra e o número sai trocado.
          `min-w-[min(8rem,100%)]`: o piso de 8 rem impede o campo de virar
          uma fresta ao lado do botão, mas no maior tamanho de texto 8 rem
          passava de 320 px e empurrava a linha para fora da tela. O piso
          continua, com teto na largura disponível. */}
      <Input
        inputMode={inputMode}
        className="min-h-11 text-sm min-w-[min(8rem,100%)] flex-1"
        placeholder={currentLabel || placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        aria-label={placeholder}
      />
      <Button size="sm" variant="outline" className="min-h-11" onClick={submit}>
        <Target className="w-3.5 h-3.5 mr-1.5" /> Definir meta
      </Button>
    </div>
  );
}
