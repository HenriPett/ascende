import { useEffect, useRef } from "react";
import { Toaster as Sonner, toast } from "sonner";

import { useTheme } from "@/hooks/useTheme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/* ═══ O ERRO FICA ATÉ ALGUÉM FECHAR ═══════════════════════════════════════
   Um aviso que some sozinho é uma interface com cronômetro, e erro com
   cronômetro é o pior caso dela: ele aparece no topo, longe de onde a pessoa
   estava olhando, e vai embora antes de quem lê devagar ou usa o VoiceOver
   conseguir agir sobre ele (`accessibility.md › Cognitive`: "Minimize use of
   time-boxed interface elements. … Prefer dismissing views with an explicit
   action."). O app tem 145 `toast.error`.

   POR QUE A REGRA MORA AQUI, e não nos 145 lugares: 32 arquivos importam
   `toast` direto de "sonner", não deste módulo. O `toast` do Sonner é um
   objeto único compartilhado por todos esses imports, então dar ao `.error`
   dele uma duração padrão infinita, uma vez, alcança todos — e quem passar
   `duration` explícito continua mandando no seu caso.

   É um efeito colateral de módulo, e por isso ele é idempotente (o HMR do Vite
   reavalia este arquivo a cada edição, e sem a marca o embrulho se empilharia)
   e fica escrito aqui em vez de escondido. Este módulo é importado pelo App, e
   o `Toaster` só existe montado a partir dele — não há toast que nasça antes. */
const MARCA = Symbol.for("ascende.toast.error.persistente");
type ErroDoToast = typeof toast.error & { [MARCA]?: true };

/* E DUAS CONSEQUÊNCIAS DE ELE NÃO SUMIR SOZINHO, que a revisão pegou:

   1. EMPILHAR. Antes, falhar três vezes dava três toasts que sumiam; persistente,
      dava três toasts vermelhos idênticos para fechar à mão. O Sonner só
      deduplica por `id` — então o `id` padrão de um erro é a PRÓPRIA MENSAGEM:
      a mesma falha de novo ATUALIZA o aviso que já está na tela, em vez de pôr
      outro em cima. Quem passa `id` próprio continua mandando.
   2. MENTIR DEPOIS DO ACERTO. Rede cai, aparece o erro, a pessoa tenta de novo
      e dá certo — e o vermelho continuava lá, afirmando uma falha que já não
      era verdade. Com o `id` sendo a mensagem, o handler que acerta na segunda
      dispensa o próprio erro (`toast.dismiss(mensagem)`); e, como rede de
      segurança, `dispensarErros()` limpa os erros abertos na troca de tela (o
      AppLayout chama): um erro de outra tela não é sobre a tela de agora. */
const ERROS_ABERTOS = new Set<string | number>();

if (!(toast.error as ErroDoToast)[MARCA]) {
  const original = toast.error;
  const persistente: ErroDoToast = (mensagem, dados) => {
    const id = dados?.id ?? (typeof mensagem === "string" ? mensagem : undefined);
    const criado = original(mensagem, { duration: Infinity, ...(id !== undefined ? { id } : {}), ...dados });
    ERROS_ABERTOS.add(criado);
    return criado;
  };
  persistente[MARCA] = true;
  toast.error = persistente;

  /* UM SUCESSO INVALIDA OS ERROS QUE VIERAM ANTES. O caso medido pelo QA:
     anexar um arquivo que não é imagem → erro → registrar um copo de água pelo
     atalho → sucesso. Os dois ficavam empilhados, e quando o sucesso sumia o
     erro continuava lá, descrevendo um estado que já não existia. Dispensar
     por handler (cada um chamando `toast.dismiss` no próprio acerto) cobriria
     só os handlers que alguém lembrasse; aqui a regra é uma só: se algo deu
     certo agora, o vermelho de antes deixa de ser a notícia. Os erros vêm
     ANTES do sucesso novo de propósito — é a mesma ordem em que aconteceram. */
  const sucessoOriginal = toast.success;
  const sucesso: typeof toast.success = (mensagem, dados) => {
    dispensarErros();
    return sucessoOriginal(mensagem, dados);
  };
  toast.success = sucesso;
}

/** Fecha os erros persistentes ainda abertos. Só os ERROS: um toast de sucesso
 *  disparado logo antes de navegar ("Grupo criado", "Salvo") tem de chegar à
 *  tela nova. */
export function dispensarErros(): void {
  for (const id of ERROS_ABERTOS) toast.dismiss(id);
  ERROS_ABERTOS.clear();
}

/* O RÓTULO DO FECHAR, EM PORTUGUÊS — e por que é feito assim.
   O Sonner 1.7.4 escreve `aria-label="Close toast"` no botão de fechar. O
   componente de toast dele até tem a opção `closeButtonAriaLabel`, mas o
   `<Toaster>` não a repassa (conferido no `dist/` instalado), então ela não é
   alcançável por prop. A 1.7.4 é a última da major 1; a opção existe na 2.x, e
   trocar de major por um rótulo, no meio desta entrega, é risco desproporcional.
   O que sobra de robusto: observar o contêiner do Toaster e reescrever o rótulo
   quando um botão de fechar aparece. O React não volta a mexer no atributo
   depois de montar o botão (a prop dele não muda), então a troca fica — e
   trocar só quando difere evita o observador se alimentar da própria escrita.
   Quando o app for para o Sonner 2, isto vira `toastOptions.closeButtonAriaLabel`. */
const ROTULO_DO_FECHAR = "Fechar aviso";

const Toaster = ({ ...props }: ToasterProps) => {
  const raiz = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const traduzir = () => {
      el.querySelectorAll<HTMLButtonElement>("button[data-close-button]").forEach((b) => {
        if (b.getAttribute("aria-label") !== ROTULO_DO_FECHAR) b.setAttribute("aria-label", ROTULO_DO_FECHAR);
      });
    };
    traduzir();
    const observador = new MutationObserver(traduzir);
    observador.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
    return () => observador.disconnect();
  }, []);

  // Antes vinha de `next-themes`, que nunca teve provider montado neste app:
  // o hook devolvia `undefined`, caía em "system" e os toasts ignoravam a
  // escolha manual de tema. O tema real é o do nosso próprio hook.
  const { isDark } = useTheme();

  return (
    <Sonner
      ref={raiz}
      // O nome da região de avisos que o leitor de tela anuncia; o padrão era
      // "Notifications". Este sim é prop.
      containerAriaLabel="Avisos"
      theme={isDark ? "dark" : "light"}
      className="toaster group"
      // Os toasts saem em `top-center`: sem o inset, encostam na status bar /
      // Dynamic Island em standalone e em WKWebView.
      offset="calc(env(safe-area-inset-top, 0px) + 1rem)"
      /* Fechar por toque, sempre. Com o erro persistente (acima) ele deixa de
         ser conveniência e passa a ser a saída. */
      closeButton
      toastOptions={{
        // 6 s para o que não é erro: o padrão do Sonner (4 s) é curto para ler
        // uma frase inteira em português, que costuma ser mais longa que a
        // mesma frase em inglês.
        duration: 6000,
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-elevated group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          /* O "x" do Sonner tem ~20 pt e já é posicionado de forma absoluta
             por ele — então o alvo cresce por um `::after` invisível de 12 pt
             para cada lado (20 + 24 = 44), sem mexer no desenho nem na
             posição. Mesmo princípio do alvo do `Button`. */
          closeButton: "after:absolute after:-inset-3 after:content-['']",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
