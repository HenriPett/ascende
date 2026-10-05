import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "ascende-theme";

/* A meta `theme-color` pinta a status bar do PWA instalado e a barra do
   Chrome no Android. Os valores são os tokens `--background` de `:root`
   (46 55% 98%) e de `.dark` (240 8% 5.5%) convertidos para hex — iguais aos
   do index.html e do manifest. Os antigos #FCFAF4/#0e0e12 diziam ser isso e
   não eram; quem mudar o token, recalcula os três lugares. */
const THEME_COLOR = { light: "#FDFBF7", dark: "#0D0D0F" } as const;

/* Ler ou escrever em localStorage pode LANÇAR — Safari com cookies
   bloqueados, modo restrito, WKWebView sem storage configurado. `initTheme()`
   roda no main.tsx antes do primeiro render: uma exceção aqui é tela branca
   antes de qualquer coisa montar. Sem storage, o tema vale só nesta sessão. */
function readStored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

function writeStored(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* sem persistência: a escolha vale até o fim da sessão */
  }
}

function systemDark() {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);

  /* O index.html declara duas metas `theme-color` com `media`
     (prefers-color-scheme). Isso segue o SISTEMA, e o app permite escolher um
     tema à revelia dele: quem está no escuro do aparelho e escolhe claro aqui
     ficaria com moldura escura. Escrever nas duas e remover o `media` faz a
     escolha explícita do usuário vencer, sem depender de qual meta o
     navegador leria primeiro. */
  const color = dark ? THEME_COLOR.dark : THEME_COLOR.light;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.removeAttribute("media");
    meta.setAttribute("content", color);
  });
}

/** Aplica o tema salvo antes do primeiro render (chamado no main.tsx). */
export function initTheme() {
  apply(readStored());
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStored);
  // Espelha a preferência do sistema em estado para que `isDark` seja
  // reativo: antes, mudar o tema do aparelho com o app em "system" repintava
  // a tela mas deixava o ícone do botão apontando para o lado errado.
  const [sysDark, setSysDark] = useState(systemDark);

  const setTheme = useCallback((t: Theme) => {
    writeStored(t);
    setThemeState(t);
    apply(t);
  }, []);

  // Acompanha o sistema quando em "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setSysDark(mq.matches);
      apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const isDark = theme === "dark" || (theme === "system" && sysDark);
  return { theme, setTheme, isDark };
}
