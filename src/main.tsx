import { createRoot } from "react-dom/client";
import App from "./App";
/* Sora auto-hospedada: os arquivos saem em /assets/* com hash, e o sw.js já
   os guarda em cache-first — o PWA abre com a fonte certa mesmo sem rede, e
   nenhuma tela (finanças, saúde, diário) faz requisição ao Google. Antes do
   index.css para que o @font-face exista quando o CSS do app pedir a família. */
import "@fontsource-variable/sora";
import "./index.css";
import { initTheme } from "@/hooks/useTheme";
import ErrorBoundary from "@/components/core/ErrorBoundary";

// Aplica o tema salvo (claro/escuro/sistema) antes do primeiro render — evita "flash".
initTheme();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

/* Service worker só em produção: em dev ele competiria com o HMR do Vite e
   serviria módulos velhos. Registrado depois do `load` para não disputar
   banda com o primeiro render. */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* sem service worker o app funciona igual, só não abre offline */
    });
  });
}
