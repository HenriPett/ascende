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
 *  abaixo do HTML. Vale o q da faixa NOMEADA: `text/markdown;q=0, *\/*` é
 *  recusa explícita (o curinga não devolve o Markdown que o cliente recusou).
 *  `*\/*` e `text/*` sozinhos são navegador e curl: HTML. No empate explícito
 *  (`text/markdown, text/html`), quem pediu Markdown pelo nome quer Markdown. */
export function prefereMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  const nomeadas = lerAccept(accept).filter((f) => f.tipo === "text" && MARKDOWN.includes(`text/${f.sub}`));
  if (!nomeadas.length) return false;
  const qMd = Math.max(...nomeadas.map((f) => f.q));
  return qMd > 0 && qMd >= qualidade(accept, "text/html");
}

/** As páginas da raiz que têm versão em Markdown — as pré-renderizadas
 *  (src/prerender/paginas.ts; o teste confere que as listas batem). */
export const PAGINAS_EM_MARKDOWN: readonly string[] = ["/", "/privacidade", "/termos", "/aviso-legal", "/recusas", "/sobre"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Para onde vai um pedido de Markdown:
 *  - `md`: o .md do build, SEMPRE um caminho deste mapa — uma página de
 *    PAGINAS_EM_MARKDOWN, /blog/ ou /blog/<slug>/;
 *  - `arquivo`: o caminho tem extensão (/llms.txt, /sitemap.xml) e segue
 *    para o Netlify como é;
 *  - `desconhecido`: todo o resto → 404 em Markdown, sem buscar nada.
 *
 *  SEGURANÇA: o caminho decodificado nunca é concatenado cru numa URL. Um
 *  `%2F%2Fevil.example%2Fx` decodifica para `//evil.example/x`, que o
 *  `new URL` leria como OUTRO host — a edge buscaria e serviria conteúdo de
 *  terceiro com o canonical do Ascende. Por isso: barra dupla, `\`, `@`,
 *  `..`, `%` que sobre, controle e espaço são `desconhecido`, e o alvo é
 *  montado a partir do mapa, não do pedido. */
export type DestinoMarkdown = { tipo: "md"; alvo: string } | { tipo: "arquivo" } | { tipo: "desconhecido" };

export function destinoMarkdown(pathname: string): DestinoMarkdown {
  const desconhecido = { tipo: "desconhecido" } as const;
  let c: string;
  try { c = decodeURIComponent(pathname); } catch { return desconhecido; }
  // eslint-disable-next-line no-control-regex
  if (!c.startsWith("/") || c.includes("//") || c.includes("..") || /[\\@%?#\s\u0000-\u001f\u007f]/.test(c)) return desconhecido;
  const ultimo = c.split("/").pop() ?? "";
  if (/\.[a-z0-9]+$/i.test(ultimo)) return { tipo: "arquivo" };
  const sem = c === "/" ? "/" : c.replace(/\/$/, "");
  if (PAGINAS_EM_MARKDOWN.includes(sem)) return { tipo: "md", alvo: sem === "/" ? "/index.md" : `${sem}.md` };
  const blog = sem.match(/^\/blog(?:\/([^/]+))?$/);
  if (blog && !blog[1]) return { tipo: "md", alvo: "/blog/index.md" };
  if (blog && SLUG.test(blog[1])) return { tipo: "md", alvo: `/blog/${blog[1]}/index.md` };
  return desconhecido;
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
  const destino: DestinoMarkdown = leitura && prefereMarkdown(req.headers.get("accept"))
    ? destinoMarkdown(url.pathname)
    : { tipo: "arquivo" };

  if (destino.tipo === "arquivo") {
    const r = await proximo();
    // Toda página que PODE sair em Markdown varia por Accept — inclusive a
    // resposta HTML, senão um cache guardaria uma e serviria para o outro.
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: comVaryAccept(new Headers(r.headers)) });
  }

  const head = req.method === "HEAD";
  /** Só arquivo da MESMA origem do pedido — a segunda trava, depois do mapa. */
  const daOrigem = async (caminho: string): Promise<Response | null> => {
    const alvo = new URL(caminho, url.origin);
    if (alvo.origin !== url.origin) return null;
    const r = await buscar(alvo);
    if (r.ok) return r;
    await r.body?.cancel();
    return null;
  };

  const r = destino.tipo === "md" ? await daOrigem(destino.alvo) : null;
  if (r) return respostaMarkdown(await r.text(), 200, new URL(url.pathname, url.origin).toString(), head);
  const nf = await daOrigem(PAGINA_404_MD);
  const corpo = nf ? await nf.text() : SE_NEM_O_404_EXISTIR;
  return respostaMarkdown(corpo.trim() ? corpo : SE_NEM_O_404_EXISTIR, 404, null, head);
}

/** Onde a edge NÃO roda: arquivos (assets com hash, imagens, sw.js, os
 *  próprios .md, llms.txt, sitemap), a SPA autenticada, que não tem versão
 *  em Markdown e não deve pagar a edge em cada navegação, e os aliases 301. */
export const CAMINHOS_EXCLUIDOS = [
  "/assets/*",
  // As origens dos 301 do netlify.toml: a edge roda antes dos redirects, e
  // pedir Markdown de /about daria 404 em vez de levar a /sobre.
  "/about", "/privacy",
  "/app", "/app/*", "/auth", "/auth/*", "/onboarding", "/onboarding/*",
  "/*.md", "/*.txt", "/*.xml", "/*.js", "/*.css", "/*.json", "/*.webmanifest",
  "/*.png", "/*.jpg", "/*.webp", "/*.svg", "/*.ico", "/*.woff2",
];
