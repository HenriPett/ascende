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
>(({ className, children, sempreNoDom = false, style, ...props }, ref) => {
  /* E A ANIMAÇÃO SÓ DEPOIS DE MONTAR. No HTML pré-renderizado a resposta
     chega `data-state=closed` — e com a classe do accordion-up ela RODAVA na
     primeira pintura, antes do JS: a altura de partida é uma variável que só
     o Radix preenche, então as seis respostas ocupavam a altura inteira por
     ~100 ms e depois sumiam (medido no Chrome em 390; o CLS não acusa porque
     o FAQ fica abaixo da dobra). Sem a classe até montar, o fechado do HTML é
     h-0 desde o primeiro quadro. Depois de montar, o Radix segura a animação
     de montagem (animation-name: none inline até a primeira troca de estado),
     então pôr a classe aqui não dispara nada; abrir e fechar animam como
     antes. Só no ramo `sempreNoDom`: o resto do app não muda. */
  const [montado, setMontado] = React.useState(false);
  React.useEffect(() => setMontado(true), []);
  const animacao = "data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down";

  /* A ALTURA QUE O ABRIR PRECISA. O accordion-down anima de 0 até
     --radix-accordion-content-height, que o Radix mede — mas com
     `forceMount` ele mede e não redesenha (o redesenho dele vem da troca de
     presença, que aqui nunca acontece): a variável ficava vazia, e o abrir
     virava um salto de 0 para a altura inteira na metade dos 200 ms (medido
     no Chrome, tempo real). Aqui a altura vem do conteúdo de dentro — que
     tem a altura natural mesmo com a caixa de fora em h-0 — e é reobservada
     quando muda (Texto Maior, largura da tela). */
  const interno = React.useRef<HTMLDivElement>(null);
  const [altura, setAltura] = React.useState<number | null>(null);
  React.useEffect(() => {
    const el = interno.current;
    if (!sempreNoDom || !el) return;
    const medir = () => setAltura(el.getBoundingClientRect().height);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [sempreNoDom]);
  return (
    <AccordionPrimitive.Content
      ref={ref}
      {...(sempreNoDom ? { forceMount: true as const } : {})}
      /* O `invisible` do fechado espera o fim do accordion-up por uma
         transição de `visibility` (ela troca no final) — mas o Radix, ao
         medir, põe `transition-duration: 0s` INLINE, e a troca vinha na hora:
         o texto sumia e a caixa encolhia vazia. A duração vai com !important,
         só para a `visibility`, para ganhar do inline; assim o texto encolhe
         visível, como no acordeão de antes. */
      className={cn(
        "overflow-hidden text-sm",
        sempreNoDom
          ? cn(
              montado && animacao,
              "[transition-property:visibility] !duration-200 data-[state=closed]:h-0 data-[state=closed]:invisible",
            )
          : cn("transition-all", animacao),
      )}
      {...props}
      style={
        sempreNoDom && altura
          ? ({ ...style, "--radix-accordion-content-height": `${altura}px` } as React.CSSProperties)
          : style
      }
    >
      <div ref={interno} className={cn("pb-4 pt-0", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
});

AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
