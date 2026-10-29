import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const Accordion = AccordionPrimitive.Root;

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item ref={ref} className={cn("border-b", className)} {...props} />
));
AccordionItem.displayName = "AccordionItem";

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

/** `sempreNoDom`: a resposta fica no HTML também fechada (o FAQ da home:
 *  o FAQPage pede o texto na página e o pré-render é lido sem JS). Radix com
 *  `forceMount` não esconde nada sozinho, então fechado = altura 0 e
 *  `invisible` (fora da leitura de tela e do Tab, como o `hidden` de antes).
 *  O `invisible` só vale ao FIM dos 200 ms do accordion-up (a transição de
 *  `visibility` troca no final), então o texto encolhe como antes. */
const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  Omit<React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>, "forceMount"> & { sempreNoDom?: boolean }
>(({ className, children, sempreNoDom = false, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    {...(sempreNoDom ? { forceMount: true as const } : {})}
    className={cn(
      "overflow-hidden text-sm transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",
      sempreNoDom && "duration-200 data-[state=closed]:h-0 data-[state=closed]:invisible",
    )}
    {...props}
  >
    <div className={cn("pb-4 pt-0", className)}>{children}</div>
  </AccordionPrimitive.Content>
));

AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
