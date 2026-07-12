// Google Identity Services (GIS) — login com Google SEM redirect de página.
//
// Por que existe: o fluxo de redirect (signInWithOAuth) quebra no app
// instalado (PWA): a volta do Google abre no NAVEGADOR, não na janela do
// app — no iOS o storage é até separado, e a sessão nunca chega. Com o GIS,
// o botão oficial do Google entrega um ID token via popup/FedCM na MESMA
// janela, e o supabase-js troca por sessão com signInWithIdToken. Zero
// redirect, funciona em navegador e em PWA instalado.
//
// Requisitos de configuração (README, seção "Login com Google"):
// • VITE_GOOGLE_CLIENT_ID no .env (o MESMO Client ID web do provider no Supabase);
// • o domínio do app em "Authorized JavaScript origins" no Google Cloud Console.
// Sem o VITE_GOOGLE_CLIENT_ID, o app cai no fluxo de redirect (fallback).

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { google?: any }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisPromise: Promise<boolean> | null = null;

/** Injeta o script do GIS uma única vez. Resolve false se falhar (offline,
 *  bloqueador) — o chamador cai no fallback de redirect. */
export function loadGis(): Promise<boolean> {
  if (window.google?.accounts?.id) return Promise.resolve(true);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve) => {
    const el = document.createElement("script");
    el.src = GIS_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve(Boolean(window.google?.accounts?.id));
    el.onerror = () => resolve(false);
    document.head.appendChild(el);
    // Rede muito lenta também vira fallback — melhor um redirect que um botão morto.
    setTimeout(() => resolve(Boolean(window.google?.accounts?.id)), 8000);
  });
  return gisPromise;
}

/** Par de nonce do fluxo de ID token (padrão documentado pelo Supabase):
 *  o hash vai para o Google (entra no token) e o valor cru vai para o
 *  signInWithIdToken, que confere o vínculo — anti-replay. */
export async function makeNoncePair(): Promise<{ nonce: string; hashedNonce: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
  const hashedNonce = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { nonce, hashedNonce };
}

/** true quando o app roda instalado (PWA standalone) — útil para telemetria
 *  e mensagens; a escolha GIS×redirect é pela config, não pelo ambiente. */
export function isStandalone(): boolean {
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;
  } catch { return false; }
}
