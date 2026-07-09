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
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
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
