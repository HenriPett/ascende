import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.25rem", screens: { "2xl": "1200px" } },
    extend: {
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        display: ["Sora", "Outfit", "system-ui", "sans-serif"],
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
        // Cores dos pilares
        prosperidade: "hsl(var(--prosperidade))",
        vitalidade: "hsl(var(--vitalidade))",
        alimentacao: "hsl(var(--alimentacao))",
        mente: "hsl(var(--mente))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
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