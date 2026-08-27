import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* Área de toque mínima de 44x44 (iOS HIG) sem mexer no visual.
   A camada `::after` é invisível, centrada no botão e nunca menor que 44px:
   o botão continua desenhado do tamanho que a tela pede, mas o dedo acerta
   um alvo de 44px. Vale inclusive para os call sites que reduzem o botão na
   mão (`className="w-6 h-6"` etc.), que de outra forma continuariam com
   24-32px de alvo. Só sob `pointer: coarse` — no mouse, o alvo visual já é
   o alvo real e ampliá-lo faria botões vizinhos roubarem o clique. */
const TOUCH_TARGET =
  "relative coarse:after:absolute coarse:after:left-1/2 coarse:after:top-1/2 " +
  "coarse:after:h-full coarse:after:w-full coarse:after:min-h-[44px] coarse:after:min-w-[44px] " +
  "coarse:after:-translate-x-1/2 coarse:after:-translate-y-1/2";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 " +
    TOUCH_TARGET,
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        // No toque o botão de ícone passa a ter 44px de verdade, não só de
        // alvo; no mouse continua 40px para não desalinhar dos inputs h-10.
        icon: "h-10 w-10 coarse:h-11 coarse:w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
