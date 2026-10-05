import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      /* 44×44 pt de alvo no TOQUE sem mudar o desenho do trilho (44×24). O
         `::after` estende a área 10 pt para cima e para baixo. Em Ajustes são 17
         interruptores soltos na linha, sem um <label> em volta, e o alvo era o
         próprio trilho de 24 pt — abaixo do mínimo de 28 (`accessibility.md ›
         Mobility`). Envolver a linha num <label> continua sendo o ideal (o iOS
         faz a LINHA inteira ser o alvo, `toggles.md`); isto é o chão, para o
         interruptor que ficar solto. Só sob `pointer: coarse`, como o `Button`.
         EM PX, NÃO EM REM: o interruptor do iOS não cresce com o Texto Maior
         (é um controle, não texto), e o daqui crescia — 110 px de largura no
         maior tamanho, empurrando as linhas de Ajustes para fora da tela. Com
         o trilho em 44×24 px e o alvo estendido 12 px para cima e para baixo,
         o toque continua com 44 pt em qualquer tamanho de texto. São 12, não
         10: o `::after` posicionado conta a partir da caixa de preenchimento,
         que fica DENTRO da borda de 2 px — com 10 o alvo media 40 (Lince). */
      "peer relative coarse:after:absolute coarse:after:inset-x-0 coarse:after:-inset-y-[12px] coarse:after:content-[''] inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-[20px] w-[20px] rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-[20px] data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
