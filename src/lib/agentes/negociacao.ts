// ASCENDE — Negociação de conteúdo: Markdown para quem pede Markdown.
//
// Agentes (e ferramentas como as do acceptmarkdown.com) mandam
// `Accept: text/markdown`. Para eles, a mesma URL responde com o .md gerado
// no build (dist/index.md, dist/privacidade.md, dist/blog/<slug>/index.md…);
// para o navegador, nada muda: o HTML de sempre, só com `Vary: Accept` para
// nenhum cache misturar as duas versões.
//
// Este arquivo é PURO e sem alias (`@/`): roda no vitest e é importado tal
// qual pela Netlify Edge Function (netlify/edge-functions/markdown.ts, Deno),
// que só cola `context.next()` e `fetch`. Toda decisão está aqui, testada.

const MARKDOWN = ["text/markdown", "text/x-markdown"];

interface Faixa { tipo: string; sub: string; q: number }

function lerAccept(accept: string): Faixa[] {
  const out: Faixa[] = [];
  for (const parte of accept.split(",")) {
    const [midia, ...params] = parte.trim().split(";");
    const [tipo, sub] = midia.trim().toLowerCase().split("/");
    if (!tipo || !sub) continue;
    let q = 1;
    for (const p of params) {
      const [k, v] = p.trim().split("=");
      if (k.trim().toLowerCase() === "q") {
        const n = Number(v);
        q = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
      }
    }
    out.push({ tipo, sub, q });
  }
  return out;
}

/** A qualidade que `accept` dá a `midia` (RFC 9110 §12.5.1): vale a faixa
 *  MAIS ESPECÍFICA que casa (`text/markdown` > `text/*` > `*\/*`). 0 = não
 *  aceita; ausência de Accept = aceita tudo com q=1. */
export function qualidade(accept: string | null, midia: string): number {
  if (!accept || !accept.trim()) return 1;
  const [tipo, sub] = midia.toLowerCase().split("/");
  let melhor = -1;
  let q = 0;
  for (const f of lerAccept(accept)) {
    const espec = f.tipo === tipo && f.sub === sub ? 2 : f.tipo === tipo && f.sub === "*" ? 1 : f.tipo === "*" && f.sub === "*" ? 0 : -1;
    if (espec > melhor) { melhor = espec; q = f.q; }
  }
  return melhor < 0 ? 0 : q;
}

/** Markdown só quando o cliente PEDE Markdown pelo nome, com q > 0 e não
 *  abaixo do HTML. `*\/*` e `text/*` sozinhos são navegador e curl: HTML. No
 *  empate explícito (`text/markdown, text/html`), quem pediu Markdown pelo
 *  nome quer Markdown. */
export function prefereMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  const nomeado = lerAccept(accept).some((f) => f.tipo === "text" && MARKDOWN.includes(`text/${f.sub}`));
  if (!nomeado) return false;
  const qMd = Math.max(...MARKDOWN.map((m) => qualidade(accept, m)));
  return qMd > 0 && qMd >= qualidade(accept, "text/html");
}

/** O .md que responde por `pathname`, ou `null` quando não é página (tem
 *  extensão: /llms.txt, /sitemap.xml, /icon-512.png — esses seguem como são).
 *  O blog usa barra final (/blog/<slug>/ → /blog/<slug>/index.md); as páginas
 *  da raiz, não (/privacidade → /privacidade.md). */
export function markdownDoCaminho(pathname: string): string | null {
  let caminho: string;
  try { caminho = decodeURIComponent(pathname); } catch { return null; }
  if (!caminho.startsWith("/") || caminho.includes("..")) return null;
  const ultimo = caminho.split("/").pop() ?? "";
  if (ultimo.includes(".")) return null;
  if (caminho === "/") return "/index.md";
  if (caminho === "/blog" || caminho.startsWith("/blog/")) {
    return `${caminho.endsWith("/") ? caminho : `${caminho}/`}index.md`;
  }
  return `${caminho.replace(/\/+$/, "")}.md`;
}

export const PAGINA_404_MD = "/404.md";
const SE_NEM_O_404_EXISTIR = "# Página não encontrada\n\nEste endereço não existe no Ascende. Comece por https://ascende.site/ ou https://ascende.site/llms.txt.\n";

function comVaryAccept(h: Headers): Headers {
  const vary = h.get("vary");
  const ja = vary?.split(",").some((v) => v.trim().toLowerCase() === "accept" || v.trim() === "*");
  if (!ja) h.set("vary", vary ? `${vary}, Accept` : "Accept");
  return h;
}

function respostaMarkdown(corpo: string, status: number, canonica: string | null, head: boolean): Response {
  const h = new Headers({
    "content-type": "text/markdown; charset=utf-8",
    vary: "Accept",
    "x-content-type-options": "nosniff",
  });
  if (canonica) h.set("link", `<${canonica}>; rel="canonical"`);
  return new Response(head ? null : corpo, { status, headers: h });
}

/**
 * A negociação inteira. `proximo` é o `context.next()` da edge (a resposta
 * que o Netlify daria sem ela); `buscar` lê um arquivo do próprio site.
 */
export async function negociar(
  req: Request,
  proximo: () => Promise<Response>,
  buscar: (url: URL) => Promise<Response>,
): Promise<Response> {
  const url = new URL(req.url);
  const leitura = req.method === "GET" || req.method === "HEAD";
  const alvo = leitura && prefereMarkdown(req.headers.get("accept")) ? markdownDoCaminho(url.pathname) : null;

  if (!alvo) {
    const r = await proximo();
    // Toda página que PODE sair em Markdown varia por Accept — inclusive a
    // resposta HTML, senão um cache guardaria uma e serviria para o outro.
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: comVaryAccept(new Headers(r.headers)) });
  }

  const head = req.method === "HEAD";
  const r = await buscar(new URL(alvo, url));
  if (r.ok) {
    const canonica = new URL(url.pathname, url).toString();
    return respostaMarkdown(await r.text(), 200, canonica, head);
  }
  await r.body?.cancel();
  const nf = await buscar(new URL(PAGINA_404_MD, url));
  const corpo = nf.ok ? await nf.text() : SE_NEM_O_404_EXISTIR;
  return respostaMarkdown(corpo.trim() ? corpo : SE_NEM_O_404_EXISTIR, 404, null, head);
}

/** Onde a edge NÃO roda: arquivos (assets com hash, imagens, sw.js, os
 *  próprios .md, llms.txt, sitemap) e a SPA autenticada, que não tem versão
 *  em Markdown e não deve pagar a edge em cada navegação. */
export const CAMINHOS_EXCLUIDOS = [
  "/assets/*",
  "/app", "/app/*", "/auth", "/auth/*", "/onboarding", "/onboarding/*",
  "/*.md", "/*.txt", "/*.xml", "/*.js", "/*.css", "/*.json", "/*.webmanifest",
  "/*.png", "/*.jpg", "/*.webp", "/*.svg", "/*.ico", "/*.woff2",
];
