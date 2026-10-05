import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody, DrawerFooter,
} from "@/components/ui/drawer";

/* ═══════════════════════════════════════════════════════════════════════════
   FOLHA: o formulário curto que vira folha de baixo no celular
   ═══════════════════════════════════════════════════════════════════════════
   Diálogo centralizado é a peça certa para um aviso de duas linhas, não para
   um formulário. No iPhone o diálogo com campo fica entre o teclado e o topo,
   longe do polegar, e não fecha arrastando; a folha de baixo (o Drawer)
   fica onde o dedo já está e fecha como toda folha do sistema
   (`sheets.md › Mobile`). No desktop a folha de baixo atravessando a janela
   inteira é que seria estranha — lá o diálogo continua.

   Antes disso cada tela escrevia o próprio `isMobile ? <Drawer> : <Dialog>`,
   com o miolo duplicado nos dois ramos (ver Planos.tsx). Aqui a escolha é
   feita UMA vez, no `Folha`, e as peças de dentro só leem o contexto — a
   chamada tem uma árvore só:

     <Folha open={aberto} onOpenChange={setAberto}>
       <FolhaContent>
         <FolhaHeader><FolhaTitle/><FolhaDescription/></FolhaHeader>
         <FolhaBody>…campos…</FolhaBody>
         <FolhaFooter>…Cancelar / Salvar…</FolhaFooter>
       </FolhaContent>
     </Folha>

   Limitação honesta: `useIsMobile` responde `false` no primeiro render e só
   acerta depois do efeito. Uma Folha que já nasce ABERTA no celular piscaria
   de diálogo para gaveta; as de hoje abrem por toque, quando ele já acertou.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── AGORA O `Folha` É O `Drawer` ──────────────────────────────────────
   Quando este arquivo nasceu, o `Drawer` só sabia ser gaveta, e a escolha
   gaveta-ou-diálogo morava aqui. Desde então o próprio `Drawer` faz essa
   escolha pela mesma régua (`useIsMobile`, 768 px) — e faz mais: anota quem
   abriu ANTES de o conteúdo montar e devolve o foco ao fechar, inclusive
   quando um campo tem `autoFocus` (o editor de calorias da Vitalidade tem) ou
   quando quem abriu foi um item de menu que desmonta (ver ui/drawer.tsx).
   Manter aqui um segundo ramo com o Dialog cru deixaria o `Folha` sem essa
   devolução no desktop. Então as peças viram apelidos das do `Drawer`, com a
   mesma API de antes: nenhuma chamada muda.
   A única diferença que fica é o rodapé: no celular, a ação principal em cima
   e o Cancelar embaixo (`flex-col-reverse`), como sempre foi aqui. */

type RaizProps = { open?: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode };
type DivProps = React.HTMLAttributes<HTMLDivElement>;

function Folha({ open, onOpenChange, children }: RaizProps) {
  return <Drawer open={open} onOpenChange={onOpenChange}>{children}</Drawer>;
}

function FolhaContent({ className, children, ...props }: DivProps) {
  return <DrawerContent className={className} {...props}>{children}</DrawerContent>;
}

const FolhaHeader = DrawerHeader;
const FolhaTitle = DrawerTitle;
const FolhaDescription = DrawerDescription;
const FolhaBody = DrawerBody;

/* No celular a ação principal fica EM CIMA e o Cancelar embaixo — a mesma
   ordem que o DialogFooter já dá (`flex-col-reverse`) e a de `alerts.md ›
   Buttons`. A chamada escreve Cancelar antes de Salvar, como sempre. No
   diálogo de tela larga o `DrawerFooter` já é o rodapé do diálogo. */
function FolhaFooter({ className, ...props }: DivProps) {
  return <DrawerFooter className={cn("flex-col-reverse", className)} {...props} />;
}

export { Folha, FolhaContent, FolhaHeader, FolhaTitle, FolhaDescription, FolhaBody, FolhaFooter };
