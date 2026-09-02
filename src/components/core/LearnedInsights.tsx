import { Link } from "react-router-dom";
import { Brain, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MEMORY_CATEGORY_LABEL, type LearnedMemory } from "@/lib/memories";

/**
 * Bloco discreto exibido logo após uma resposta da IA: mostra o que ela
 * aprendeu sobre a pessoa NESTA mensagem. O aprendizado é real — as memórias
 * já foram gravadas no backend e alimentam Conselheiro e briefing — e a
 * pessoa pode ver e apagar tudo em Ajustes.
 */
export default function LearnedInsights({
  items, onDismiss,
}: { items: LearnedMemory[]; onDismiss: () => void }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-2 animate-fade-up">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Brain className="w-4 h-4 text-primary" />
          Aprendi sobre você
        </p>
        <Button
          variant="ghost" size="icon" className="h-6 w-6 -mt-0.5 -mr-1 text-muted-foreground"
          onClick={onDismiss} aria-label="Dispensar o que o Conselheiro aprendeu"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <ul className="space-y-1.5">
        {items.map((m, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />
            <span className="min-w-0 break-words">
              {m.content}
              <span className="ml-1.5 text-[11px] text-muted-foreground">
                · {MEMORY_CATEGORY_LABEL[m.category] ?? MEMORY_CATEGORY_LABEL.outro}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Vou lembrar disso nas próximas conversas.{" "}
        <Link to="/app/ajustes" className="underline underline-offset-2 hover:text-foreground">
          Veja e apague o que sei sobre você em Ajustes.
        </Link>
      </p>
    </div>
  );
}
