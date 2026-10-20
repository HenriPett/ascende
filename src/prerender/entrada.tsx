// Entrada do pré-render, carregada por scripts/prerender.mjs pelo Vite
// (ssrLoadModule), como o blog. Desenha a MESMA árvore do navegador
// (AppComRoteador), trocando só o roteador: StaticRouter na rota pedida.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { AppComRoteador } from "@/App";
import { precarregarPagina } from "@/paginasPublicas";
import ErrorBoundary from "@/components/core/ErrorBoundary";
import NaoEncontrada from "@/prerender/NaoEncontrada";

/** O markup do #root para `rota`. O chunk da página é carregado antes, para
 *  o render não encontrar nada suspenso (sairia o Splash). Markup estático,
 *  sem marcas de hidratação: o main.tsx usa createRoot, não hydrateRoot. */
export async function renderizarRota(rota: string): Promise<string> {
  await precarregarPagina(rota);
  const Roteador = ({ children }: { children: ReactNode }) => <StaticRouter location={rota}>{children}</StaticRouter>;
  return renderToStaticMarkup(
    <ErrorBoundary>
      <AppComRoteador Roteador={Roteador} />
    </ErrorBoundary>,
  );
}

export function renderizar404(): string {
  return renderToStaticMarkup(<NaoEncontrada />);
}
