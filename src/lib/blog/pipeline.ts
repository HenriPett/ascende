// ASCENDE — Blog: do conteúdo aos arquivos de saída, sem tocar no disco.
//
// Recebe os .md, o INDICE, o dia de hoje e as funções de render dos templates
// (src/blog/render.tsx, do Pixel) e devolve o MAPA de arquivos a escrever em
// dist/. Quem lê e escreve o disco é scripts/blog.mjs; aqui fica a decisão do
// que existe — e é por isso que ela é testável com fixtures.
//
// A REGRA DO ZERO (plano, regra 5): sem post, o blog não existe em público.
// Nada de dist/blog/, nada de feed, nada de /blog no sitemap. Só o sitemap das
// 5 páginas de sempre. Uma listagem vazia publicada seria conteúdo fictício
// com outro nome.
import { checarColecao, type ArquivoDePost, type PastasDeImagem } from "@/lib/blog/checagem";
import { lerIndice } from "@/lib/blog/indice";
import { gerarFeed, gerarSitemap } from "@/lib/blog/sitemap";
import type { ContextoDoBlog, PostDoBlog } from "@/lib/blog/tipos";

/** A interface dos templates. Devolvem o DOCUMENTO inteiro (com <!doctype>). */
export interface Templates {
  renderListagem(posts: PostDoBlog[], ctx: ContextoDoBlog): string;
  renderArtigo(post: PostDoBlog, relacionados: PostDoBlog[], ctx: ContextoDoBlog): string;
  /** O script externo que aplica o tema escuro antes do CSS. Externo porque a
   *  CSP do site (`script-src 'self'`) proíbe script inline — e é o ÚNICO JS
   *  das páginas do blog; o artigo é lido sem ele. */
  TEMA_JS: string;
  /** Onde ele é servido, absoluto (`/blog/tema.js`). */
  CAMINHO_DO_TEMA: string;
}

export interface SaidaDoBlog {
  /** caminho relativo a dist/ → conteúdo (texto, ou os bytes de uma imagem). */
  arquivos: Record<string, string | Uint8Array>;
  posts: PostDoBlog[];
  erros: string[];
}

export function gerarBlog(entrada: {
  arquivos: ArquivoDePost[];
  indice: string | null;
  hoje: string;
  ctx: ContextoDoBlog;
  templates: Templates;
  /** content/blog/img/: slug → (nome → bytes). */
  imagens?: PastasDeImagem;
}): SaidaDoBlog {
  const pastas = entrada.imagens ?? {};
  const { posts, erros, copias } = checarColecao(entrada.arquivos, lerIndice(entrada.indice ?? ""), entrada.hoje, pastas);
  // Coleção com erro não publica NADA — nem os posts que estão certos. Um
  // build que sai com metade do blog é pior que um build que falha: o primeiro
  // ninguém nota.
  if (erros.length) return { arquivos: {}, posts: [], erros };

  const arquivos: SaidaDoBlog["arquivos"] = { "sitemap.xml": gerarSitemap(posts) };
  if (posts.length === 0) return { arquivos, posts, erros };

  const porSlug = new Map(posts.map((p) => [p.slug, p]));
  arquivos["blog/index.html"] = entrada.templates.renderListagem(posts, entrada.ctx);
  for (const p of posts) {
    const relacionados = p.related.map((s) => porSlug.get(s)!).filter(Boolean);
    arquivos[`blog/${p.slug}/index.html`] = entrada.templates.renderArtigo(p, relacionados, entrada.ctx);
  }
  arquivos["blog/feed.xml"] = gerarFeed(posts);
  arquivos[entrada.templates.CAMINHO_DO_TEMA.replace(/^\//, "")] = entrada.templates.TEMA_JS;
  // As imagens vão para a pasta DO ARTIGO (dist/blog/<slug>/), ao lado do
  // index.html: o caminho publicado é /blog/<slug>/<arquivo>, o mesmo que o
  // render recebe em `post.imagens`.
  for (const [destino, { slug, nome }] of Object.entries(copias)) arquivos[destino] = pastas[slug][nome];
  return { arquivos, posts, erros };
}

/** Os `<link rel="stylesheet" href>` do dist/index.html da SPA, na ordem. Os
 *  templates usam as MESMAS classes Tailwind, e o Tailwind já varre src/**:
 *  o CSS da SPA tem tudo o que o blog desenha — reusar o arquivo é não ter um
 *  segundo build de CSS. */
export function cssDoIndex(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/g)) {
    const tag = m[0];
    if (!/\brel=["']?stylesheet["']?/.test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/);
    if (href) out.push(href[1]);
  }
  return out;
}
