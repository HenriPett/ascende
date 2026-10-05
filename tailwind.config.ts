import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.25rem", screens: { "2xl": "1200px" } },
    extend: {
      /* Fonte do sistema no corpo, Sora nos títulos. A Outfit carregava tudo,
         inclusive legendas de 11px, onde uma geométrica sem tamanhos ópticos
         é a primeira a perder legibilidade e onde ninguém vê marca. O SF
         traz tamanhos ópticos, acompanha o Dynamic Type e o Texto em Negrito
         do iOS — coisa que fonte web não faz. A marca fica onde ela é vista:
         títulos, números e o nível, em Sora (auto-hospedada, ver main.tsx —
         nenhuma requisição ao Google em tela de finanças, saúde ou diário).
         "Sora Variable" é o nome que o @fontsource-variable registra. */
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", '"SF Pro Text"', "system-ui", "sans-serif"],
        display: ["Sora Variable", "Sora", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
      },
      /* Escala por PAPEL, espelhando os estilos de texto do iOS no tamanho
         padrão (typography.md › Specifications › Large). Em rem de propósito:
         com `font: -apple-system-body` na raiz (index.css), 1rem é o Body do
         sistema e tudo cresce junto com o Texto Maior. Piso: caption2, 11pt.
         Uso: text-caption2 · caption · footnote · subhead · body · title3 ·
         title2 · title1. Os text-xs/sm/base do Tailwind continuam existindo,
         mas texto novo nasce com um papel, não com um número. */
      fontSize: {
        caption2: ["0.6875rem", { lineHeight: "0.8125rem" }],  // 11/13
        caption: ["0.75rem", { lineHeight: "1rem" }],          // 12/16
        footnote: ["0.8125rem", { lineHeight: "1.125rem" }],   // 13/18
        subhead: ["0.9375rem", { lineHeight: "1.25rem" }],     // 15/20
        body: ["1.0625rem", { lineHeight: "1.375rem" }],       // 17/22
        title3: ["1.25rem", { lineHeight: "1.5625rem", fontWeight: "600" }], // 20/25
        title2: ["1.375rem", { lineHeight: "1.75rem", fontWeight: "600" }],  // 22/28
        title1: ["1.75rem", { lineHeight: "2.125rem", fontWeight: "600" }],  // 28/34
        /* Do 3xl para cima o aperto de título cai para -0.01em: na tabela de
           tracking do SF o aperto é máximo perto de 20pt e volta a abrir nos
           tamanhos grandes. Valores de tamanho e entrelinha são os do Tailwind. */
        "3xl": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.01em" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.01em" }],
        "5xl": ["3rem", { lineHeight: "1", letterSpacing: "-0.01em" }],
        "6xl": ["3.75rem", { lineHeight: "1", letterSpacing: "-0.01em" }],
      },
      /* `tracking-widest` aparece em legenda maiúscula de 11px. O 0.1em
         padrão dava +1,1px; a tabela do SF pede +0,06pt a 11pt. Maiúscula
         pequena aguenta um pouco mais que isso, mas não o dobro de wider. */
      letterSpacing: {
        widest: "0.06em",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
        gold: { DEFAULT: "hsl(var(--gold))", foreground: "hsl(var(--gold-foreground))" },
        // Cores dos pilares — três, desde a fusão de 17/09/2026.
        prosperidade: "hsl(var(--prosperidade))",
        vitalidade: "hsl(var(--vitalidade))",
        // @deprecated apelido de `vitalidade`, igual ao token CSS de mesmo
        // nome — REMOVER ATÉ 30/11/2026, no mesmo commit que tirar
        // `--alimentacao` do index.css. Os dois saem juntos ou o apelido
        // sobrevive num lugar e ninguém percebe.
        alimentacao: "hsl(var(--alimentacao))",
        mente: "hsl(var(--mente))",
        // Folhas, diálogos e popovers — mais claro que o card no escuro.
        elevated: "hsl(var(--elevated))",
        agua: "hsl(var(--agua))",
      },
      /* TINTA. `textColor` vence `colors` só nas utilities de texto
         (`text-*`, com variantes e opacidade): `bg-gold`, `ring-primary`,
         `fill-success` continuam na cor de identidade, e `text-gold`,
         `hover:text-primary`, `text-success/80` saem na cor que passa
         contraste. Os valores e as medições estão no index.css (--gold-text).
         `foreground` repetido porque esta chave substitui a de `colors`
         para `text-primary-foreground` etc. */
      textColor: {
        primary: { DEFAULT: "hsl(var(--gold-text))", foreground: "hsl(var(--primary-foreground))" },
        gold: { DEFAULT: "hsl(var(--gold-text))", foreground: "hsl(var(--gold-foreground))" },
        success: { DEFAULT: "hsl(var(--success-text))", foreground: "hsl(var(--success-foreground))" },
        warning: { DEFAULT: "hsl(var(--warning-text))", foreground: "hsl(var(--warning-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive-text))", foreground: "hsl(var(--destructive-foreground))" },
        vitalidade: "hsl(var(--vitalidade-text))",
        mente: "hsl(var(--mente-text))",
      },
      /* Uma régua de raio só. `xl` e `2xl` eram os padrões do Tailwind (12 e
         16px) — iguais a `sm` e `md` com outro nome, mas fora do token: mudar
         --radius mexia em metade do app. Agora apontam para ele, com o mesmo
         valor de hoje. */
      borderRadius: {
        "2xl": "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) - 8px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 8px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        // Só TRANSFORM. Nenhum keyframe desta base controla visibilidade — ver
        // a nota em `animation`, abaixo: é o único jeito de a animação não
        // conseguir apagar a tela.
        "fade-up": { from: { transform: "translateY(8px)" }, to: { transform: "translateY(0)" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        /* Esta animação NÃO mexe em opacidade — e isso não é gosto, é seguro.
         *
         * A tentativa anterior era `forwards` no lugar de `both`, apostando
         * que assim o keyframe `from` (opacity:0) não seria aplicado antes da
         * hora. A aposta está errada, e dá para reproduzir: o fill-mode só
         * manda no DEPOIS que a animação termina; enquanto ela está ATIVA, o
         * valor animado vale sempre — inclusive parada no tempo 0.
         *
         * E parada no tempo 0 é justamente o caso real. Medido ao vivo na
         * /app/pilares: `animationPlayState: "running"` com `currentTime: 0`
         * que nunca avança, porque a aba não recebe frames (segundo plano,
         * PWA suspenso, economia de bateria, aceleração desligada). Resultado:
         * opacity 0 permanente, página inteira em branco. Nada volta sozinho.
         *
         * Nenhum fill-mode resolve isso, porque uma animação travada é
         * indistinguível de uma animação normal. O que resolve é a animação
         * não ter poder sobre a visibilidade: só translateY. Se ela nunca
         * rodar, o conteúdo está lá, legível, 8px mais abaixo — um defeito que
         * ninguém nota, no lugar de uma tela vazia.
         *
         * Sem fill-mode de propósito: o estado final (translateY(0)) já é o
         * natural do elemento, então não há o que segurar. */
        "fade-up": "fade-up 0.35s ease-out",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // `coarse:` = @media (pointer: coarse) — só dedo, nunca mouse. Usado para
    // ampliar a área de toque dos botões sem inchar a interface no desktop.
    plugin(({ addVariant }) => {
      addVariant("coarse", "@media (pointer: coarse)");
    }),
  ],
} satisfies Config;