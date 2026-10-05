import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { BotaoFechar } from "@/components/ui/fechar";
import { DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";

/* ═══════════════════════════════════════════════════════════════════════════
   A FOLHA DE BAIXO DA CASA — e o diálogo que ela vira em tela larga
   ═══════════════════════════════════════════════════════════════════════════

   Este é o primitivo para TODA folha que sobe de baixo. A `Sheet side="bottom"`
   (ui/sheet.tsx) é o `Dialog` do Radix posicionado embaixo: ela não arrasta e
   não tem puxador — e no iPhone as pessoas fecham folha arrastando para baixo,
   sem procurar botão nenhum (`sheets.md › Mobile`: "Support swiping to dismiss a
   sheet. People expect to swipe vertically to dismiss a sheet instead of
   tapping a dismiss button"). No celular este aqui é o vaul, que faz as duas.

   ─── EM TELA LARGA ELE VIRA DIÁLOGO, SOZINHO ────────────────────────────

   A primeira versão era SÓ o vaul, e o QA mediu o resultado no desktop: a
   folha de consentimento do Social abria com 1440 px de largura, colada no pé
   da janela, com os interruptores a ~1.500 px dos rótulos. Folha de baixo é a
   peça do polegar; numa janela de computador ela é uma faixa estranha
   atravessando a tela.

   A escolha agora é feita AQUI, uma vez, pela largura (a mesma régua de
   768 px do `useIsMobile`, a mesma do `ui/folha.tsx`): abaixo dela, vaul; acima,
   o Dialog do Radix, centralizado. Toda chamada de `Drawer` do app ganha isso
   sem mudar uma linha — e é por isso que o conserto mora no primitivo e não em
   cada tela. Funciona porque o vaul é feito do Dialog do Radix: o `Trigger`, o
   `Close`, o `Title` e a `Description` dele SÃO os do Radix, e servem aos dois.
   As peças que dependem da largura (`Content`, `Header`, `Body`, `Footer`) leem
   o contexto e desenham a versão certa.

   Limitação honesta, a mesma do `Folha`: `useIsMobile` responde `false` no
   primeiro render e só acerta depois do efeito. Uma folha que já nasce ABERTA
   no celular piscaria de diálogo para gaveta; as de hoje abrem por toque,
   quando ele já acertou.

   ─── O FOCO, nas duas pontas ────────────────────────────────────────────

   · AO ABRIR, o foco entra na folha — no PRÓPRIO contêiner, não no primeiro
     campo. O vaul nasce com `autoFocus` desligado e cancela o foco automático
     do Radix: o foco ficava atrás do véu, e o leitor de tela não chegava ao
     conteúdo. Ligar o `autoFocus` dele resolveria isso trocando por outro
     problema — no iPhone, focar o primeiro campo ABRE O TECLADO por cima da
     folha que nem terminou de subir. Focar o contêiner (que já tem
     `tabIndex=-1`) leva o leitor de tela para dentro sem teclado nenhum. No
     diálogo de tela larga fica o padrão do Radix, que foca o primeiro campo:
     lá há teclado físico, e é o que se espera de um formulário.
   · AO FECHAR, o foco volta a quem abriu. Folha aberta por ESTADO (o
     REGISTRAR, a engrenagem do consentimento) não tem `Trigger`, e o Radix só
     sabe voltar para um `Trigger` — o foco caía no `<body>`. O primitivo
     anota quem tinha o foco no instante de abrir e devolve para ele.

     QUANDO anotar é o que importa, e a primeira versão errou: ela anotava no
     `onOpenAutoFocus`, que roda DEPOIS de o conteúdo montar — e um campo com
     `autoFocus` (Criar grupo, Entrar com código, o editor de calorias) já
     tinha roubado o foco nesse instante. O primitivo anotava o próprio campo,
     que ao fechar já não existia, e nada voltava. Agora a anotação é feita na
     RAIZ, no render em que `open` passa a verdadeiro — antes de qualquer
     filho montar, quando o foco ainda está em quem abriu.
     E quem abriu pode ser um ITEM DE MENU ("Chamar alguém", no ⋯ do grupo),
     que some junto com o menu. Aí o destino certo é o botão que abriu o menu:
     o conteúdo do menu do Radix aponta para ele em `aria-labelledby`. Uma
     chamada que passe o próprio `onCloseAutoFocus` com `preventDefault` manda
     no seu caso (o REGISTRAR faz isso, porque no iPhone tocar um botão não o
     foca, e então não haveria o que anotar).
   ═══════════════════════════════════════════════════════════════════════════ */

type Contexto = { largo: boolean; quem: React.MutableRefObject<HTMLElement | null> };
const EmTelaLarga = React.createContext<Contexto>({ largo: false, quem: { current: null } });

/** Quem tem o foco AGORA — trocando um item de menu pelo botão que abriu o
 *  menu, porque o item desmonta quando o menu fecha. */
function quemTemOFoco(): HTMLElement | null {
  const ativo = document.activeElement;
  if (!(ativo instanceof HTMLElement) || ativo === document.body) return null;
  const menu = ativo.closest<HTMLElement>('[role="menu"]');
  const gatilho = menu?.getAttribute("aria-labelledby");
  return (gatilho && document.getElementById(gatilho)) || ativo;
}

/**
 * Anota quem abriu, no render em que `open` vira verdadeiro (ver o cabeçalho).
 *
 * Ler o DOM durante o render não é o idioma do React, e a escolha é
 * deliberada: é o ÚNICO instante anterior ao `autoFocus` dos filhos (que age
 * na montagem, antes de qualquer efeito do pai). A leitura é idempotente — um
 * segundo render do mesmo `open` não anota de novo — e não altera nada.
 */
function useQuemAbriu(open: boolean | undefined) {
  const quem = React.useRef<HTMLElement | null>(null);
  const estava = React.useRef(false);
  if (open && !estava.current && typeof document !== "undefined") quem.current = quemTemOFoco();
  estava.current = !!open;
  return quem;
}

/* `shouldScaleBackground` nasce FALSO, e não é gosto. O efeito de "afundar a
   página atrás da folha" só acontece se algum elemento tiver o atributo
   `vaul-drawer-wrapper` — e nenhum tem. Com `true`, o vaul procura o elemento,
   não acha e desiste em silêncio: uma opção ligada que promete um efeito que
   não acontece. Se um dia alguém quiser o efeito, o caminho é pôr o atributo
   no contêiner do AppLayout e testar no iPhone, não religar isto às cegas. */
const Drawer = ({
  shouldScaleBackground = false,
  open, onOpenChange, defaultOpen, modal, children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => {
  const celular = useIsMobile();
  const quem = useQuemAbriu(open);
  if (!celular) {
    // Em tela larga só o que o Dialog entende passa adiante; as opções do vaul
    // (pontos de parada, arrasto) não têm sentido num diálogo centralizado.
    return (
      <EmTelaLarga.Provider value={{ largo: true, quem }}>
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen} modal={modal}>
          {children}
        </DialogPrimitive.Root>
      </EmTelaLarga.Provider>
    );
  }
  return (
    <EmTelaLarga.Provider value={{ largo: false, quem }}>
      <DrawerPrimitive.Root
        shouldScaleBackground={shouldScaleBackground}
        open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen} modal={modal}
        {...props}
      >
        {children}
      </DrawerPrimitive.Root>
    </EmTelaLarga.Provider>
  );
};
Drawer.displayName = "Drawer";

// Os do Radix, que servem às duas formas (ver o cabeçalho).
const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;

const DrawerPortal = DrawerPrimitive.Portal;

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-black/80", className)} {...props} />
));
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName;

type ConteudoProps = React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> & {
  /** Esconde o Fechar na folha de baixo. Só para folha cujo próprio conteúdo
   *  já tem uma saída óbvia por toque — o padrão é mostrar. No diálogo de tela
   *  larga o Fechar aparece sempre. */
  semFechar?: boolean;
};

/** Devolve o foco a quem abriu (anotado pela raiz). Uma chamada que passe o
 *  próprio `onCloseAutoFocus` com `preventDefault` manda no seu caso. */
function aoFecharDevolvendo(
  quem: React.MutableRefObject<HTMLElement | null>,
  onCloseAutoFocus: ConteudoProps["onCloseAutoFocus"],
) {
  return (e: Event) => {
    onCloseAutoFocus?.(e);
    if (e.defaultPrevented) return;
    const alvo = quem.current;
    quem.current = null;
    if (alvo && alvo.isConnected) {
      e.preventDefault();
      alvo.focus();
    }
  };
}

const DrawerContent = React.forwardRef<React.ElementRef<typeof DrawerPrimitive.Content>, ConteudoProps>(
  ({ className, children, semFechar, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
    const { largo, quem } = React.useContext(EmTelaLarga);
    const aoFechar = aoFecharDevolvendo(quem, onCloseAutoFocus);

    if (largo) {
      return (
        <DialogContent
          ref={ref}
          // O mesmo desenho do `Folha` em tela larga: um diálogo de formulário,
          // com o miolo rolando e o cabeçalho parado.
          className={cn("max-w-md max-h-[85dvh] flex flex-col", className)}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={aoFechar}
          {...props}
        >
          {children}
        </DialogContent>
      );
    }

    return (
      <DrawerPortal>
        <DrawerOverlay />
        <DrawerPrimitive.Content
          ref={ref}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto max-h-[85dvh] flex-col rounded-t-2xl border bg-elevated",
            "pb-[env(safe-area-inset-bottom)]",
            "outline-none",
            className,
          )}
          onOpenAutoFocus={(e) => {
            onOpenAutoFocus?.(e);
            if (e.defaultPrevented) return;
            // O CONTÊINER, não o primeiro campo: ver o cabeçalho (teclado).
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={aoFechar}
          {...props}
        >
          {/* O puxador. `aria-hidden` porque ele é a pista VISUAL do gesto; quem
              usa leitor de tela fecha pelo botão, que tem nome. */}
          <div className="mx-auto mt-2 h-[5px] w-9 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
          {children}
          {!semFechar && <BotaoFechar as={DrawerPrimitive.Close} />}
        </DrawerPrimitive.Content>
      </DrawerPortal>
    );
  },
);
DrawerContent.displayName = "DrawerContent";

/** O miolo que rola. Na folha de baixo a rolagem precisa morar num filho do
 *  conteúdo para o arrastar e o rolar não brigarem; no diálogo é o mesmo
 *  papel, sem o respiro lateral (o diálogo já tem o dele). */
const DrawerBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const { largo } = React.useContext(EmTelaLarga);
  return (
    <div
      className={cn(
        largo ? "min-h-0 flex-1 overflow-y-auto" : "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6",
        className,
      )}
      {...props}
    />
  );
};
DrawerBody.displayName = "DrawerBody";

const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const { largo } = React.useContext(EmTelaLarga);
  if (largo) return <DialogHeader className={cn("text-left pr-8", className)} {...props} />;
  // `pr-14`: o título não passa por baixo do Fechar de 44 pt.
  return <div className={cn("grid gap-1.5 p-4 pr-14 text-left", className)} {...props} />;
};
DrawerHeader.displayName = "DrawerHeader";

const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const { largo } = React.useContext(EmTelaLarga);
  if (largo) return <DialogFooter className={className} {...props} />;
  return <div className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />;
};
DrawerFooter.displayName = "DrawerFooter";

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DrawerTitle.displayName = DialogPrimitive.Title.displayName;

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DrawerDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerBody,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
