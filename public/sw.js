/* Service worker do Ascende — cache conservador.
 *
 * Regra que orienta tudo aqui: um service worker erra para o lado de servir
 * conteúdo velho, e conteúdo velho num app instalado é indistinguível de um
 * app quebrado. Por isso:
 *   • HTML e navegação → rede primeiro. O cache só entra quando não há rede.
 *   • Assets com hash no nome (/assets/*) → cache primeiro; o nome muda a
 *     cada build, então nunca há versão velha para servir por engano.
 *   • Qualquer outra origem (Supabase, fontes, Clarity) → não intercepta.
 *   • Só GET. POST/PATCH nunca passam por aqui.
 *
 * Ao trocar a estratégia, suba o VERSION: os caches antigos são apagados no
 * activate e o SW novo assume na hora (skipWaiting + clients.claim).
 */

const VERSION = "v1";
const SHELL_CACHE = `ascende-shell-${VERSION}`;
const ASSET_CACHE = `ascende-assets-${VERSION}`;
const SHELL_URL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(SHELL_URL))
      .catch(() => {
        /* sem rede na instalação: o shell é preenchido na primeira navegação */
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("ascende-") && k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Rede primeiro, cache como rede de segurança. Guarda uma cópia do shell. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy)).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await caches.match(SHELL_URL);
    if (cached) return cached;
    throw err;
  }
}

/** Cache primeiro — só para arquivos cujo nome já carrega o hash do build. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, fontes, Clarity

  /* O BLOG NÃO É A SPA. /blog/ e /blog/<slug>/ são HTML estático gerado no
     build (scripts/blog.mjs), cada página um documento próprio. O
     `networkFirst` abaixo guarda TODA navegação bem-sucedida como o shell da
     SPA — com o blog, abrir um artigo online gravaria o HTML do artigo no
     lugar do index.html, e depois, sem rede, qualquer tela do app abriria o
     artigo. Sem interceptar, o navegador busca a página direto e o cache do
     shell continua sendo só da SPA. Offline, o blog mostra a página de
     "sem conexão" do próprio navegador: honesto, e nada se confunde. */
  if (url.pathname === "/blog" || url.pathname.startsWith("/blog/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
  }
});
