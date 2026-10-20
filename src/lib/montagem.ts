// ASCENDE — A montagem por cima de uma página pré-renderizada.
//
// O pré-render (scripts/prerender.mjs) entrega o #root já com a página, e o
// main.tsx troca esse conteúdo pelo mesmo markup do React (createRoot). A
// troca cria nós NOVOS: toda animação de entrada (`animate-fade-up`)
// RECOMEÇA — o herói da Landing, que já tinha assentado na pintura do HTML,
// descia 8 px e subia de novo quando o JS chegava (medido no Chrome em 390:
// troca aos ~110 ms em rede local; em 4G, de 0,5 a 2 s depois). O CLS não pega,
// porque é transform.
//
// Não dá para resolver só com CSS: desligar a animação e religá-la depois
// recomeça a animação do mesmo jeito. Então quem anima pergunta aqui, uma vez,
// se está montando por cima do pré-render — e, se estiver, não anima: a
// entrada já foi vista no HTML. Navegar de volta para a página depois anima
// normalmente (a marca é consumida na primeira montagem).

let porCimaDoPrerender = false;

/** Chamado pelo main.tsx, antes do createRoot. */
export function marcarMontagemDoPrerender(sim: boolean): void {
  porCimaDoPrerender = sim;
}

/** A página que anima a entrada lê UMA vez (no inicializador do estado) e
 *  consome a marca: a próxima visita, já dentro da SPA, anima. */
export function consumirMontagemDoPrerender(): boolean {
  const era = porCimaDoPrerender;
  porCimaDoPrerender = false;
  return era;
}
