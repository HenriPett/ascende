// ASCENDE — `lazy` que pode ser carregado ANTES do primeiro render.
//
// As páginas públicas pré-renderizadas (/privacidade, /recusas, /sobre…) são
// chunks sob demanda. Com `React.lazy` puro, o primeiro render no navegador
// SEMPRE suspende — e o <Suspense> trocaria o HTML pré-renderizado pelo
// Splash até o chunk chegar: um flash de tela vazia numa página que já estava
// pronta. Com `preload()` aguardado antes do `createRoot` (src/main.tsx), o
// componente já está em mãos e o primeiro render desenha a página direto.
// O pré-render no build (scripts/prerender.mjs) usa o mesmo `preload()` para
// que o `renderToString` não encontre nada suspenso.
import { createElement, lazy, type ComponentType } from "react";

export type ComPreload<P> = ComponentType<P> & { preload: () => Promise<void> };

export function lazyComPreload<P extends Record<string, any>>(
  carregar: () => Promise<{ default: ComponentType<P> }>,
): ComPreload<P> {
  let pronto: ComponentType<P> | null = null;
  const Preguicoso = lazy(carregar) as unknown as ComponentType<P>;
  function Pagina(props: P) {
    return createElement(pronto ?? Preguicoso, props);
  }
  Pagina.preload = () => carregar().then((m) => { pronto = m.default; });
  return Pagina;
}
