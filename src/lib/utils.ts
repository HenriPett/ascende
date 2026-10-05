import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/* O tailwind-merge só conhece os tamanhos de fonte padrão do Tailwind. Os
   papéis tipográficos do tailwind.config.ts (text-caption2 … text-title1)
   ele lia como COR — e `cn("text-body text-muted-foreground")` devolvia só
   "text-muted-foreground": o tamanho sumia em silêncio, sem erro nenhum.
   Registrar os papéis no grupo de font-size é o que faz o merge acertar.
   Quem criar um papel novo no config, acrescenta aqui também. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption2", "caption", "footnote", "subhead", "body", "title3", "title2", "title1"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
