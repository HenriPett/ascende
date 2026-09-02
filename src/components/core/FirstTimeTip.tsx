import { Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GUIDES, type GuideId } from "@/lib/guides";
import { useGuides } from "@/hooks/useGuides";
import { cn } from "@/lib/utils";

/**
 * Dica de primeira vez: um cartão discreto, sem overlay, que apresenta uma
 * função no momento em que a pessoa a encontra. Some para sempre com um toque
 * em "Entendi" — ou sozinho, quando a pessoa simplesmente usa a função
 * (o auto-dispensa é feito pela tela dona, via useGuides().markSeen).
 * Quem não quiser nenhuma dica desliga tudo pelo link no rodapé.
 */
export default function FirstTimeTip({ id, className }: { id: GuideId; className?: string }) {
  const { shouldShow, markSeen, disableAll } = useGuides();
  if (!shouldShow(id)) return null;
  const guide = GUIDES[id];

  return (
    <div
      role="note"
      className={cn("rounded-xl border border-gold/40 bg-gold/5 p-3 space-y-1.5 animate-fade-up", className)}
    >
      <p className="text-sm font-medium flex items-center gap-1.5">
        <Lightbulb className="w-4 h-4 text-gold shrink-0" />
        {guide.title}
      </p>
      <p className="text-sm text-muted-foreground">{guide.text}</p>
      <div className="flex items-center justify-between gap-2 pt-0.5">
        {/* 11px de texto dá 16px de alvo — menos de metade dos 44pt de
            referência, e este é um botão de "some para sempre": errar o toque
            aqui é acertar outra coisa. Aumentar a fonte estragaria a
            hierarquia (a ação do card é "Entendi", não este link), então quem
            cresce é a ÁREA.

            `py-3.5 -my-3.5`, e não um pseudo-elemento absoluto. A primeira
            tentativa foi o ::after de 44px, e ele até funciona no toque — mas
            deixa `getBoundingClientRect()` em 115x16, então toda auditoria de
            acessibilidade continua reprovando o botão e ninguém consegue
            provar o contrário sem simular um toque. Com padding, a CAIXA passa
            a medir 115x44 de verdade; a margem negativa devolve os 28px ao
            layout, e como a linha é um flex `items-center` cuja altura é
            ditada pelo botão "Entendi" (36px), nada ao redor se move. */}
        <button
          type="button"
          className="py-3.5 -my-3.5 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onClick={() => {
            disableAll();
            toast.success("Dicas desligadas. Se mudar de ideia, reative em Ajustes.");
          }}
        >
          Não mostrar mais dicas
        </button>
        <Button size="sm" variant="outline" onClick={() => markSeen(id)}>
          Entendi
        </Button>
      </div>
    </div>
  );
}
