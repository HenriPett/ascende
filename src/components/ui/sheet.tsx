import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";
import { BotaoFechar } from "@/components/ui/fechar";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

/* `bg-elevated`, não `bg-background`: no escuro a folha pintava o fundo da
   página (5,5% de luz) por cima de cartões de 9,5% — a camada da frente ficava
   MAIS ESCURA que a de trás. O iOS faz o contrário, e por um bom motivo: a
   superfície elevada é mais clara, e é isso que faz a folha "vir para a frente"
   (`dark-mode.md`: "the elevated colors are brighter"). No claro, elevado é o
   mesmo branco do cartão e nada muda. */
const sheetVariants = cva(
  "fixed z-50 gap-4 bg-elevated p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        /* A folha de baixo traz o chão do iPhone NO PRIMITIVO, e não em cada
           chamada — antes, quatro folhas lembravam disso e duas não, e nessas
           duas o último botão terminava dentro dos ~34 pt do indicador de
           início, onde o toque vira gesto do sistema.
           · `pb-[calc(1.5rem+env(...))]` SOMA o recorte ao respiro; o
             `safe-bottom` sozinho o substituía e zerava em aparelho sem
             recorte (achado N6, AppLayout).
           · `max-h-[85dvh]`, não `vh`: no Safari o `vh` mede a tela sem a
             barra do navegador, e a folha ficava mais alta do que o espaço
             visível — o fim dela sumia atrás da barra.
           · `rounded-t-2xl`: a folha de baixo do iOS é arredondada em cima, e
             o resto deste app é todo arredondado.
           Para folha de baixo NOVA, prefira o `Drawer` (ui/drawer.tsx): ele
           tem puxador e fecha arrastando, que esta não tem. */
        bottom:
          "inset-x-0 bottom-0 border-t rounded-t-2xl max-h-[85dvh] overflow-y-auto overscroll-contain pb-[calc(1.5rem+env(safe-area-inset-bottom))] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        <BotaoFechar as={SheetPrimitive.Close} />
      </SheetPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
