import * as React from "react";

import { cn } from "@/lib/utils";

/* O CAMPO SE IDENTIFICA PELO PREENCHIMENTO, NÃO PELA BORDA.
   A borda `--input` mede 1,26:1 sobre o fundo no claro (1,34:1 no escuro), e o
   campo era pintado com `bg-background` — o mesmo marfim da página. Na prática
   o campo só existia pelo placeholder. Engrossar a borda até 3:1 (o mínimo do
   WCAG 1.4.11 para o limite de um componente) pediria algo como
   `border-foreground/50`, que é exatamente o peso que a marca recusa — o
   index.css diz "bordas quase invisíveis, tudo flutua".
   O conserto que preserva a marca é o do próprio iOS nos campos arredondados:
   um PREENCHIMENTO suave (`bg-muted/60`), com a borda fina mantida. A forma do
   campo passa a ser vista, e nada fica mais pesado. */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 coarse:h-11 w-full rounded-md border border-input bg-muted/60 px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
