import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* Falha de leitura com cara PRÓPRIA — o padrão da casa, num lugar só.
 *
 * O problema que este componente existe para impedir: quando uma query falha,
 * `isLoading` vira false, `data` fica undefined e o consumo com `data ?? []`
 * entrega uma lista vazia. A tela então diz, com toda a confiança, que a
 * pessoa não tem nada — e às vezes age em cima disso (oferece onboarding,
 * pede cadastro do zero, zera um indicador). Quem tem oito meses de histórico
 * vê a própria vida sumir por causa de um timeout.
 *
 * A régua: vazio por falha nunca pode ser lido como vazio de verdade. Diz o
 * que houve, diz que nada se perdeu, e oferece o caminho de volta. */
export default function QueryError({
  title,
  detail = "Pode ser a conexão — seus registros continuam salvos.",
  onRetry,
  retrying,
  variant = "card",
  className,
}: {
  /** O que não carregou, em português e no concreto: "Não consegui carregar
   *  seus lançamentos." Nunca "erro ao buscar dados". */
  title: string;
  /** Por que não é culpa da pessoa e o que continua de pé. */
  detail?: string;
  onRetry?: () => void;
  /** `isFetching` da query — troca o botão por "Tentando…". */
  retrying?: boolean;
  /** `plain` para quando já existe um Card em volta. */
  variant?: "card" | "plain";
  className?: string;
}) {
  /* `role="alert"`: a falha SUBSTITUI o conteúdo, e para quem não vê a tela
     isso acontecia em silêncio — a lista simplesmente não chegava. O papel faz
     o leitor de tela anunciar o que não carregou assim que o aviso aparece. */
  const body = (
    <div className="flex items-start gap-3" role="alert">
      <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
            {retrying
              ? (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Tentando…</>)
              : (<><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Tentar de novo</>)}
          </Button>
        )}
      </div>
    </div>
  );

  if (variant === "plain") return <div className={className}>{body}</div>;
  return <Card className={cn("p-4", className)}>{body}</Card>;
}
