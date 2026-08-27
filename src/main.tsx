import { createRoot } from "react-dom/client";
import App from "./App";
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
