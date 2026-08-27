import { Component, type ErrorInfo, type ReactNode } from "react";

/* Rede de segurança de último recurso. Sem ela, qualquer exceção durante o
   render desmonta a árvore inteira e o usuário fica com uma tela branca —
   sem explicação, sem saída e sem pista do que aconteceu. O objetivo aqui
   não é recuperar o estado, é sempre sobrar alguma coisa na tela. */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Sem serviço de telemetria de erro ainda: o console é o que temos, e é
    // o que o Clarity grava junto da sessão.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private goHome = () => {
    // Navegação dura de propósito: o router pode ser justamente o que quebrou.
    window.location.assign("/app");
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-dvh grid place-items-center bg-background px-4 py-8">
        <div className="w-full max-w-md space-y-4 text-center">
          <p className="font-display text-xl font-semibold">Alguma coisa quebrou aqui.</p>
          <p className="text-sm text-muted-foreground">
            A falha é nossa, não sua — e nada do que você registrou se perdeu.
            Recarregar a tela costuma resolver.
          </p>

          <div className="flex items-center justify-center gap-2">
            <button
              onClick={this.reload}
              className="h-11 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Recarregar
            </button>
            <button
              onClick={this.goHome}
              className="h-11 px-4 rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Ir para o início
            </button>
          </div>

          {/* Detalhe técnico recolhido: útil num print de suporte, discreto
              para quem só quer voltar a usar o app. */}
          <details className="text-left">
            <summary className="text-xs text-muted-foreground cursor-pointer select-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              Detalhes técnicos
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-md border bg-muted/50 p-2 text-[11px] whitespace-pre-wrap break-words">
              {error.message || String(error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
