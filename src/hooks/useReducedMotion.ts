import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/* A regra de `prefers-reduced-motion` do index.css só alcança CSS. O que
   anima em JS passa batido: `scrollIntoView({ behavior: "smooth" })`
   explícito vence o `scroll-behavior: auto` do CSS, e o Recharts anima com
   requestAnimationFrame. Quem anima em JS pergunta aqui.
   Esta checagem estava escrita três vezes (Mokari, useCaptureFocus,
   Vitalidade); agora mora num lugar só e acompanha a troca do ajuste com o
   app aberto. `matchMedia` pode faltar em ambiente de teste — sem ele, a
   resposta é "não reduzir", que é o padrão do sistema. */
function query(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && window.matchMedia ? window.matchMedia(QUERY) : null;
  } catch {
    return null;
  }
}

/** Leitura pontual, para código fora de componente (handlers, hooks não-React). */
export function prefersReducedMotion(): boolean {
  return query()?.matches ?? false;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}
