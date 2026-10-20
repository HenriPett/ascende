import { createRoot } from "react-dom/client";
import App from "./App";
import { precarregarPagina } from "@/paginasPublicas";
import { marcarMontagemDoPrerender } from "@/lib/montagem";
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

/* PÁGINA PRÉ-RENDERIZADA (scripts/prerender.mjs): o #root já chega com o
   HTML da página, marcado com `data-prerender`. O `createRoot` substitui esse
   conteúdo pelo mesmo markup — mas só depois que o chunk da página estiver
   carregado, para o primeiro render já ser a página e não o Splash do
   <Suspense>. Até lá, quem está na tela é o HTML do build. Se o chunk falhar,
   monta assim mesmo: o <Suspense>/ErrorBoundary cuidam, como sem pré-render. */
const root = document.getElementById("root")!;
// Antes do createRoot: a Landing precisa saber que a entrada já foi vista no HTML.
marcarMontagemDoPrerender(root.hasAttribute("data-prerender"));
const pronta = root.hasAttribute("data-prerender")
  ? precarregarPagina(window.location.pathname).catch(() => {})
  : Promise.resolve();
void pronta.then(() => {
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
});

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
