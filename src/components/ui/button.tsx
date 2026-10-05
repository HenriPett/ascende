import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/* Área de toque mínima de 44x44 (iOS HIG) sem mexer no visual.
   A camada `::after` é invisível, centrada no botão e nunca menor que 44px:
   o botão continua desenhado do tamanho que a tela pede, mas o dedo acerta
   um alvo de 44px. Vale inclusive para os call sites que reduzem o botão na
   mão (`className="w-6 h-6"` etc.), que de outra forma continuariam com
   24-32px de alvo. Só sob `pointer: coarse` — no mouse, o alvo visual já é
   o alvo real e ampliá-lo faria botões vizinhos roubarem o clique. */
const TOUCH_TARGET =
  "relative coarse:after:absolute coarse:after:left-1/2 coarse:after:top-1/2 " +
  "coarse:after:h-full coarse:after:w-full coarse:after:min-h-[44px] coarse:after:min-w-[44px] " +
  "coarse:after:-translate-x-1/2 coarse:after:-translate-y-1/2";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 " +
    TOUCH_TARGET,
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /* 44 pt no TOQUE também na altura desenhada, não só no alvo invisível.
         O `::after` acima já garantia o dedo, mas o botão continuava com 40 e
         36 pt de desenho no iPhone — "Salvar rotina" 104×36, "Entendi" 74×36,
         medidos pelo QA — e a altura visível é o que diz à pessoa que ali se
         toca. No mouse (`pointer: fine`) nada muda: 40 e 36 continuam
         alinhando com os campos `h-10` da mesma linha. */
      /* E NO TOQUE O RÓTULO QUEBRA LINHA, em vez de empurrar a página para o
         lado. A base tem `whitespace-nowrap` e a altura era fixa: com o Texto
         Maior ligado, "Pedir um plano que cabe no meu bolso" e "Conectar meu
         WhatsApp" não podiam quebrar, e o botão crescia para a DIREITA — o QA
         mediu a página rolando de lado em 12 de 14 telas, três delas já no
         último degrau padrão (23 pt), que nem é tamanho de acessibilidade. No
         toque o rótulo quebra, a altura vira mínimo (44 pt) e cresce com as
         linhas. No mouse nada muda. `icon` fica de fora: não tem rótulo.
         · `text-balance`: quando quebra, quebra em linhas parecidas — sem
           "bolso" sozinho na segunda linha de "Pedir um plano que cabe no meu
           bolso".
         · `max-w-full` + `overflow-wrap: break-word`: o ÚLTIMO recurso, para a
           palavra que sozinha não cabe na linha. NÃO `anywhere`: ele também
           derruba a largura mínima do botão para uma letra, e qualquer vizinho
           `flex-1` o espremia até partir "Salv / ar" já no tamanho padrão
           (medido pelo Lince). `break-word` só age quando a palavra não cabe
           de jeito nenhum — a largura mínima continua a da maior palavra. */
      size: {
        default: "h-10 px-4 py-2 coarse:h-auto coarse:min-h-11 coarse:py-2 coarse:whitespace-normal coarse:text-center coarse:text-balance coarse:max-w-full coarse:[overflow-wrap:break-word]",
        sm: "h-9 rounded-md px-3 coarse:h-auto coarse:min-h-11 coarse:py-2 coarse:whitespace-normal coarse:text-center coarse:text-balance coarse:max-w-full coarse:[overflow-wrap:break-word]",
        lg: "h-11 rounded-md px-8 coarse:h-auto coarse:min-h-11 coarse:py-2 coarse:whitespace-normal coarse:text-center coarse:text-balance coarse:max-w-full coarse:[overflow-wrap:break-word]",
        // No toque o botão de ícone passa a ter 44px de verdade, não só de
        // alvo; no mouse continua 40px para não desalinhar dos inputs h-10.
        icon: "h-10 w-10 coarse:h-11 coarse:w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * O botão está fazendo o que o rótulo dele promete.
   *
   * POR QUE ISTO É UMA PROP, e não o `{carregando ? <Loader2/> : "Rótulo"}`
   * que existe em 42 lugares do app: aquele padrão APAGA o nome do botão no
   * momento exato em que ele importa. Durante o carregamento o VoiceOver lia
   * "botão, esmaecido" — sem dizer qual — e o botão que não ocupa a largura
   * toda encolhia sob o dedo (`buttons.md › Content`: "Ensure that each button
   * clearly communicates its purpose").
   *
   * Aqui o rótulo FICA, transparente mas no lugar: segura a largura e continua
   * sendo o nome acessível, e `aria-busy` diz que ele está ocupado. O spinner é
   * desenhado por cima. O botão também fica desabilitado, para um segundo
   * toque não disparar a mesma ação de novo.
   *
   * `opacity-0`, e NÃO `invisible`. A primeira versão usava `invisible`
   * (`visibility: hidden`) e reproduzia exatamente o defeito que a prop existe
   * para consertar: conteúdo com `visibility: hidden` SAI da árvore de
   * acessibilidade e do cálculo do nome acessível, então o VoiceOver voltava a
   * dizer "botão, esmaecido, ocupado" sem dizer qual. Transparência esconde só
   * para os olhos.
   */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    // `asChild` entrega o filho único ao Slot, e envolvê-lo num <span> quebraria
    // o contrato do Slot. Botão que vira link não tem estado de carregamento.
    if (asChild) {
      /* O estado DESABILITADO atravessa o Slot. Ele era desestruturado acima e
         só repassado no outro ramo — `<Button asChild disabled><Link/></Button>`
         perdia o `disabled` em silêncio. Um link não tem `disabled` de verdade,
         por isso vai também `aria-disabled` (que o leitor de tela anuncia e que a
         classe base usa para tirar o clique e esmaecer). */
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          {...props}
        >
          {children}
        </Comp>
      );
    }
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            {/* O MESMO `gap-2` do botão: com o rótulo invisível ocupando o
                mesmo espaço de antes, a largura não se mexe nem um pixel. */}
            <span className="opacity-0 inline-flex items-center gap-2">{children}</span>
            <Loader2 className="absolute inset-0 m-auto animate-spin" aria-hidden />
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
