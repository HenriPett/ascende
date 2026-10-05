import { createContext, useContext, useEffect } from "react";
import { prefersReducedMotion } from "@/hooks/useReducedMotion";

/* Ponte entre o botão REGISTRAR da barra e a caixa de captura da tela.
 *
 * A decisão do fundador: o REGISTRAR não abre uma segunda caixa quando a
 * pessoa JÁ está na Hoje — ele foca a que está ali. Duplicar a mesma ação a
 * dois centímetros de distância é confusão; mas tirar da Hoje o item mais
 * usado da tela quebraria um hábito que já existe. As duas coisas: uma ação
 * por tela, alcançável de qualquer tela.
 *
 * POR QUE CONTEXTO E NÃO getElementById("captura")
 * Sem string mágica, e a barra não precisa saber em que rota está: se ninguém
 * registrou um alvo, ela abre a folha. Se um dia outra tela também embutir a
 * captura, funciona sozinho. */

type FocusFn = () => void;

interface CaptureFocusValue {
  /** A tela que embute a captura registra aqui COMO focá-la. */
  register: (fn: FocusFn | null) => void;
  /** `null` quando nenhuma tela montada tem captura embutida. */
  focus: FocusFn | null;
}

export const CaptureFocusContext = createContext<CaptureFocusValue | null>(null);

/**
 * Para a BARRA: devolve a função de foco, ou `null` se ninguém registrou.
 * `focus ? focus() : abrirFolha()` é toda a decisão.
 */
export function useCaptureFocus(): FocusFn | null {
  return useContext(CaptureFocusContext)?.focus ?? null;
}

/**
 * Para a TELA que embute a captura. Registra ao montar e limpa ao desmontar —
 * sem a limpeza, sair da Hoje deixaria a barra achando que ainda há um alvo, e
 * o REGISTRAR viraria um botão que não faz nada.
 */
export function useProvideCaptureFocus(fn: FocusFn): void {
  const ctx = useContext(CaptureFocusContext);
  useEffect(() => {
    ctx?.register(fn);
    return () => ctx?.register(null);
    // `fn` é estável por useCallback na tela; `ctx.register` é estável por
    // useCallback no AppLayout.
  }, [ctx, fn]);
}

/**
 * O gesto completo: rola até a caixa, dá o pulso de anel e SÓ ENTÃO foca.
 *
 * A ordem importa. Focar antes abre o teclado, o layout encolhe
 * (`interactive-widget=resizes-content` no index.html) e o scroll vai para o
 * lugar errado. E o pulso é obrigatório, não enfeite: focar um campo que já
 * estava visível pode parecer que o botão não fez nada — e botão que parece
 * morto é pior que abrir a folha.
 */
export function focusCaptureElement(wrapper: HTMLElement | null): void {
  if (!wrapper) return;

  // A leitura pontual do hook da casa: isto é uma função, não um componente.
  const reduced = prefersReducedMotion();

  wrapper.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });

  // Reinicia a animação mesmo em toques repetidos: sem remover a classe, o
  // segundo toque no REGISTRAR não daria pulso nenhum.
  wrapper.classList.remove("capture-pulse");
  void wrapper.offsetWidth;
  wrapper.classList.add("capture-pulse");
  window.setTimeout(() => wrapper.classList.remove("capture-pulse"), 700);

  // No estado de REVISÃO a CaptureBar não tem textarea (a lista de propostas
  // ocupou o lugar). Nunca roubar foco para um campo que não está montado:
  // cai para o primeiro controle da revisão.
  requestAnimationFrame(() => {
    const target = wrapper.querySelector<HTMLElement>("textarea")
      ?? wrapper.querySelector<HTMLElement>("input:not([type=file]), button:not([disabled])");
    target?.focus({ preventScroll: true });
  });
}
