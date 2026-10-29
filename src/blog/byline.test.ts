// ASCENDE — Blog: a byline e o bloco "Em resumo" (GEO + autoria, 29/10).
// Fixtures de teste — não existem em content/blog.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { AUTOR_DO_BLOG, type PostDoBlog } from "@/lib/blog/tipos";
import { Artigo, Listagem } from "./paginas";

function post(slug: string, extra: Partial<PostDoBlog> = {}): PostDoBlog {
  return {
    slug, title: `Fixture ${slug}`, description: `Descrição ${slug}.`, datePublished: "2026-10-29",
    intent: `intenção ${slug}`, cluster: "rotina-integrada", sources: [], related: [], productPath: "/",
    corpo: "Texto.\n\n## Perguntas frequentes\n\n### Vale?\n\nVale.", caminho: `/blog/${slug}/`,
    url: `https://ascende.site/blog/${slug}/`, imagens: {}, resumo: [], faq: [], ...extra,
  };
}
const html = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(StaticRouter, { location: "/blog/" }, el));
const artigo = (p: PostDoBlog) => html(createElement(Artigo, { post: p, relacionados: [] }));

describe("a byline do artigo", () => {
  const h = artigo(post("um"));

  it("'Por Henrique Pett, fundador do Ascende', com o nome levando à seção do autor", () => {
    expect(h).toMatch(new RegExp(`Por <a href="/sobre#autor" class="[^"]*min-h-11[^"]*">${AUTOR_DO_BLOG.nome}</a>, fundador do Ascende`));
    // A constante é absoluta (JSON-LD, feed); na página, o link é relativo.
    expect(AUTOR_DO_BLOG.url).toBe("https://ascende.site/sobre#autor");
  });

  it("fica entre o título e a data — e a data continua em <time>", () => {
    const iH1 = h.indexOf("</h1>"), iPor = h.indexOf("Por <a"), iData = h.indexOf('<time dateTime="2026-10-29">');
    expect(iH1).toBeLessThan(iPor);
    expect(iPor).toBeLessThan(iData);
  });

  it("nada de credencial inventada", () => {
    expect(h).not.toMatch(/especialista|revisado por|nutricionista responsável|Dr\.|<img[^>]*autor/i);
  });
});

describe("o bloco 'Em resumo'", () => {
  it("sem resumo, não existe — nada de bloco vazio", () => {
    expect(artigo(post("sem"))).not.toContain("Em resumo");
  });

  it("com resumo: <section> com <h2> 'Em resumo' e um item por frase, logo depois do cabeçalho e antes do corpo", () => {
    const h = artigo(post("com", { resumo: ["Primeira frase.", "Segunda frase."] }));
    expect(h).toMatch(/<section aria-labelledby="resumo-do-post"[^>]*><h2 id="resumo-do-post"[^>]*>Em resumo<\/h2><ul[^>]*><li>Primeira frase\.<\/li><li>Segunda frase\.<\/li><\/ul><\/section>/);
    const iResumo = h.indexOf("Em resumo"), iCorpo = h.indexOf("<p class=\"mt-5 first:mt-0");
    expect(h.indexOf("<time")).toBeLessThan(iResumo);
    expect(iResumo).toBeLessThan(iCorpo);
  });

  it("legível em Texto Maior: o texto quebra palavra longa e hifeniza", () => {
    const h = artigo(post("x", { resumo: ["desnecessariamente"] }));
    expect(h).toMatch(/<ul class="[^"]*break-words hyphens-auto/);
  });

  it("a seção de perguntas do corpo continua saindo pelo Markdown (h2 + h3)", () => {
    const h = artigo(post("faq"));
    expect(h).toMatch(/<h2 id="perguntas-frequentes"/);
    expect(h).toMatch(/<h3 id="vale"/);
  });
});

describe("a autoria na listagem", () => {
  const h = html(createElement(Listagem, { posts: [post("a"), post("b")] }));

  it("uma vez, debaixo da descrição do blog — não em cada cartão", () => {
    expect(h.match(/Escrito por <a href="\/sobre#autor"/g)).toHaveLength(1);
    expect(h.indexOf("Escrito por")).toBeLessThan(h.indexOf("<ol"));
  });

  it("sem link dentro do link do cartão", () => {
    for (const cartao of h.split('<a href="/blog/').slice(1)) {
      const fim = cartao.indexOf("</a>");
      expect(cartao.slice(0, fim)).not.toContain("<a ");
    }
  });
});
