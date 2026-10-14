// ASCENDE — Blog: as páginas como DOCUMENTO INTEIRO, em string, no build.
//
// O pipeline (Forge) chama `renderListagem` e `renderArtigo` pela API do Vite
// (ssrLoadModule) e grava o resultado em dist/blog/. Este módulo não pode
// precisar de DOM: só `renderToStaticMarkup`. O HTML sai completo — conteúdo,
// <head>, dados estruturados — porque a regra 1 do plano é ser indexável SEM
// JS; meta montada pela SPA não serve.
//
// O <head> segue o checklist da Clareira (docs/blog/EDITORIAL.md): title,
// description, canonical com barra final, Open Graph, Twitter, JSON-LD
// VERDADEIRO — autor e publisher são a Organization "Ascende", nunca uma
// pessoa; nada de revisão profissional, nota, imagem que não existe.

import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import type { ReactNode } from "react";
import { DESCRICAO_DO_BLOG, type ContextoDoBlog, type PostDoBlog } from "@/lib/blog/tipos";
import { Artigo, Listagem } from "./paginas";
import { foiAtualizado, jsonParaScript } from "./formato";

/* ── O ESCURO SEM O REACT ────────────────────────────────────────────────
   A página é estática: o `useTheme` não roda, e sem ele a classe `.dark`
   nunca aparece. Este script repete a regra do useTheme.tsx (escolha salva,
   senão a do sistema) e põe `.dark` no <html> antes do CSS pintar. Ele é
   EXTERNO e da mesma origem porque o CSP é `script-src 'self'`: inline não
   roda. É melhoria, não dependência — sem JS a página fica no claro e o
   conteúdo está todo lá. O pipeline grava `TEMA_JS` em `CAMINHO_DO_TEMA`. */
export const CAMINHO_DO_TEMA = "/blog/tema.js";
// E, como o useTheme, quando há escolha EXPLÍCITA ela vence o sistema também
// na moldura do navegador: as duas metas `theme-color` perdem o `media` e
// ganham a cor escolhida. O script roda no <head> antes das metas existirem,
// então essa parte espera o DOM.
export const TEMA_JS = `(function () {
  var t = "system";
  try { t = localStorage.getItem("ascende-theme") || "system"; } catch (e) {}
  var escuro = t === "dark";
  if (t !== "dark" && t !== "light") {
    try { escuro = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
  }
  if (escuro) document.documentElement.classList.add("dark");
  if (t === "dark" || t === "light") {
    document.addEventListener("DOMContentLoaded", function () {
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < metas.length; i++) {
        metas[i].removeAttribute("media");
        metas[i].setAttribute("content", escuro ? "#0D0D0F" : "#FDFBF7");
      }
    });
  }
})();
`;

const OG_IMAGE = "https://ascende.site/icon-512.png";
/** O feed que o pipeline gera — anunciado no <head> para leitores de RSS o
 *  acharem sozinhos. */
const FEED = "https://ascende.site/blog/feed.xml";
// O logo é o ícone real do app (verdadeiro); NÃO há `image` no BlogPosting —
// não existe imagem de capa, e inventar uma é o que a regra 2 proíbe.
const ORGANIZACAO = {
  "@type": "Organization",
  name: "Ascende",
  url: "https://ascende.site/",
  logo: { "@type": "ImageObject", url: OG_IMAGE },
} as const;

interface Cabeca {
  titulo: string;
  /** O título puro para o og:title — a marca já vai no og:site_name. */
  tituloOg: string;
  descricao: string;
  canonical: string;
  ogType: "website" | "article";
  extras?: ReactNode;
  jsonLd: unknown[];
}

function documento(cabeca: Cabeca, ctx: ContextoDoBlog, corpo: ReactNode): string {
  const html = renderToStaticMarkup(
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{cabeca.titulo}</title>
        <meta name="description" content={cabeca.descricao} />
        <link rel="canonical" href={cabeca.canonical} />
        <link rel="alternate" type="application/rss+xml" title="Blog do Ascende" href={FEED} />
        {/* Antes do CSS e bloqueante, de propósito: decidir o tema depois da
            primeira pintura é piscar o claro para quem usa o escuro. */}
        <script src={CAMINHO_DO_TEMA} />
        {ctx.cssHrefs.map((href) => <link key={href} rel="stylesheet" href={href} />)}
        <meta name="theme-color" content="#FDFBF7" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0D0D0F" media="(prefers-color-scheme: dark)" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta property="og:type" content={cabeca.ogType} />
        <meta property="og:url" content={cabeca.canonical} />
        <meta property="og:title" content={cabeca.tituloOg} />
        <meta property="og:description" content={cabeca.descricao} />
        <meta property="og:image" content={OG_IMAGE} />
        <meta property="og:locale" content="pt_BR" />
        <meta property="og:site_name" content="Ascende" />
        {cabeca.extras}
        <meta name="twitter:card" content="summary" />
        {cabeca.jsonLd.map((d, i) => (
          // `dangerouslySetInnerHTML` porque o React escaparia as aspas do
          // JSON como texto. O conteúdo é do repositório (não de usuário) e
          // passa por `jsonParaScript`, que neutraliza `</script>`.
          <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonParaScript(d) }} />
        ))}
      </head>
      <body>
        {/* O SiteFooter usa <Link>: um roteador estático só para ele ter
            contexto. Nada navega no cliente — não há JS de app na página. */}
        <StaticRouter location={cabeca.canonical.replace(ctx.siteUrl, "") || "/"}>{corpo}</StaticRouter>
      </body>
    </html>,
  );
  return `<!doctype html>\n${html}\n`;
}

const tituloDaPagina = (t: string) => `${t} | Ascende`;
const urlDoBlog = (ctx: ContextoDoBlog) => `${ctx.siteUrl}/blog/`;

export function renderListagem(posts: PostDoBlog[], ctx: ContextoDoBlog): string {
  const descricao = DESCRICAO_DO_BLOG;
  const canonical = urlDoBlog(ctx);
  return documento(
    {
      titulo: tituloDaPagina("Blog"),
      tituloOg: "Blog do Ascende",
      descricao,
      canonical,
      ogType: "website",
      jsonLd: [{
        "@context": "https://schema.org",
        "@type": "Blog",
        name: "Blog do Ascende",
        url: canonical,
        description: descricao,
        inLanguage: "pt-BR",
        publisher: ORGANIZACAO,
        blogPost: posts.map((p) => ({
          "@type": "BlogPosting",
          headline: p.title,
          url: p.url,
          datePublished: p.datePublished,
          ...(foiAtualizado(p) ? { dateModified: p.dateModified } : {}),
        })),
      }],
    },
    ctx,
    <Listagem posts={posts} />,
  );
}

export function renderArtigo(post: PostDoBlog, relacionados: PostDoBlog[], ctx: ContextoDoBlog): string {
  const blog = urlDoBlog(ctx);
  const modificado = foiAtualizado(post);
  return documento(
    {
      titulo: tituloDaPagina(post.seoTitle ?? post.title),
      tituloOg: post.title,
      descricao: post.description,
      canonical: post.url,
      ogType: "article",
      extras: (
        <>
          <meta property="article:published_time" content={post.datePublished} />
          {modificado && <meta property="article:modified_time" content={post.dateModified} />}
        </>
      ),
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.description,
          datePublished: post.datePublished,
          ...(modificado ? { dateModified: post.dateModified } : {}),
          inLanguage: "pt-BR",
          mainEntityOfPage: post.url,
          url: post.url,
          author: ORGANIZACAO,
          publisher: ORGANIZACAO,
          isPartOf: { "@type": "Blog", url: blog },
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Ascende", item: `${ctx.siteUrl}/` },
            { "@type": "ListItem", position: 2, name: "Blog", item: blog },
            { "@type": "ListItem", position: 3, name: post.title, item: post.url },
          ],
        },
      ],
    },
    ctx,
    <Artigo post={post} relacionados={relacionados} />,
  );
}
