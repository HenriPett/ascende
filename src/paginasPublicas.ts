// As páginas públicas pré-renderizadas no build que são chunks sob demanda.
// Carregam com `preload()` antes do primeiro render (src/main.tsx): sem isso
// o <Suspense> trocaria o HTML pronto pelo Splash enquanto o chunk chega. O
// pré-render (src/prerender/entrada.tsx) usa o mesmo preload. Landing não
// está aqui: já vem no bundle inicial.
import { lazyComPreload } from "@/lib/lazyComPreload";

export const Legal = lazyComPreload(() => import("@/pages/Legal"));
export const Recusas = lazyComPreload(() => import("@/pages/Recusas"));
export const Sobre = lazyComPreload(() => import("@/pages/Sobre"));

/** Carrega o chunk da página pública de `pathname`; outra rota não carrega
 *  nada. */
export function precarregarPagina(pathname: string): Promise<void> {
  const rota = pathname.replace(/\/+$/, "") || "/";
  if (rota === "/privacidade" || rota === "/termos" || rota === "/aviso-legal") return Legal.preload();
  if (rota === "/recusas") return Recusas.preload();
  if (rota === "/sobre") return Sobre.preload();
  return Promise.resolve();
}
