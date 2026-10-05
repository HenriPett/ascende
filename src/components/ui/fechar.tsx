import * as React from "react";
import { X } from "lucide-react";

/**
 * O FECHAR DE TODA FOLHA E TODO DIÁLOGO — 44×44 pt, no primitivo.
 *
 * Ele era um ícone de 16 px num botão sem tamanho: a caixa de toque era a do
 * ícone, 16×16, abaixo até do MÍNIMO do iOS (28×28; o padrão é 44×44,
 * `accessibility.md › Mobility`). E no celular não há Escape: para quase todo
 * diálogo centralizado, o X é a única saída por toque.
 *
 * A casa já tinha pago este conserto uma vez, à mão, folha por folha (achado
 * N5, AppLayout) — e 19 dos 24 modais do app tinham ficado de fora. Aqui ele
 * vale para todos de uma vez, com a MESMA aritmética: o ícone estava centrado
 * a 24 px de cada borda (`right-4` + 16/2); com a caixa em 44 e `right-0.5`,
 * o centro continua em 24 (2 + 44/2). Cresce a área, o desenho fica onde
 * estava.
 */
export function BotaoFechar({
  as: Comp,
}: {
  /** O `Close` do primitivo: o do Radix (folha e diálogo) ou o do vaul
   *  (drawer). Cada um sabe fechar o próprio contêiner; o desenho é um só. */
  as: React.ElementType;
}) {
  return (
    <Comp className="absolute right-0.5 top-0.5 grid h-11 w-11 place-items-center rounded-full opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none">
      <X className="h-4 w-4" aria-hidden />
      <span className="sr-only">Fechar</span>
    </Comp>
  );
}

