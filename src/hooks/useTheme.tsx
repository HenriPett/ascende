import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "ascende-theme";

function systemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
}

/** Aplica o tema salvo antes do primeiro render (chamado no main.tsx). */
export function initTheme() {
  const saved = (localStorage.getItem(KEY) as Theme | null) ?? "system";
  apply(saved);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(KEY) as Theme | null) ?? "system"
  );

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(KEY, t);
    setThemeState(t);
    apply(t);
  }, []);

  // Acompanha o sistema quando em "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && systemDark());
  return { theme, setTheme, isDark };
}
