// ASCENDE — Blog: os templates, verificados no HTML que de fato sai.
// Os posts daqui são FIXTURES de teste (regra 5 do plano): não existem em
// content/blog e nunca chegam ao dist de produção.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import type { ContextoDoBlog, PostDoBlog } from "@/lib/blog/tipos";
import { Markdown } from "@/components/core/Markdown";
import SiteFooter from "@/components/core/SiteFooter";
import { renderArtigo, renderListagem, TEMA_JS, CAMINHO_DO_TEMA } from "./render";
import { dataPorExtenso, minutosDeLeitura, jsonParaScript } from "./formato";

const ctx: ContextoDoBlog = { siteUrl: "https://ascende.site", cssHrefs: ["/assets/index-abc123.css"] };

function post(slug: string, extra: Partial<PostDoBlog> = {}): PostDoBlog {
  return {
    slug,
    title: `Fixture ${slug}`,
    description: `Descrição da fixture ${slug}.`,
    datePublished: "2026-10-14",
    intent: `intenção ${slug}`,
    cluster: "rotina-integrada",
    sources: [{ title: "Fonte de teste", url: "https://exemplo.org/a", publisher: "Exemplo", accessed: "2026-10-10" }],
    related: [],
    productPath: "/",
    corpo: "Primeiro parágrafo com [um link](/recusas).\n\n## Uma seção\n\nTexto.\n\n### Detalhe\n\n> Uma citação.\n",
    caminho: `/blog/${slug}/`,
    url: `https://ascende.site/blog/${slug}/`,
    imagens: {},
    resumo: [],
    faq: [],
    ...extra,
  };
}

const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

describe("o artigo sai inteiro, indexável sem JS", () => {
  const a = post("um", { related: ["dois"] });
  const html = renderArtigo(a, [post("dois", { title: "Fixture relacionada" })], ctx);

  it("documento completo em pt-BR, com o corpo renderizado no arquivo", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain("Primeiro parágrafo com");
    expect(html).toContain('<link rel="stylesheet" href="/assets/index-abc123.css"/>');
  });

  it("um h1 só, e ele é o título", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Fixture um<\/h1>/);
  });

  it("o <head> do checklist", () => {
    expect(html).toContain("<title>Fixture um | Ascende</title>");
    expect(html).toContain('<meta name="description" content="Descrição da fixture um."/>');
    expect(html).toContain('<link rel="canonical" href="https://ascende.site/blog/um/"/>');
    expect(html).toContain('<meta property="og:type" content="article"/>');
    expect(html).toContain('<meta property="og:url" content="https://ascende.site/blog/um/"/>');
    expect(html).toContain('<meta property="og:image" content="https://ascende.site/icon-512.png"/>');
    expect(html).toContain('<meta property="og:locale" content="pt_BR"/>');
    expect(html).toContain('<meta property="article:published_time" content="2026-10-14"/>');
    expect(html).toContain('<meta name="twitter:card" content="summary"/>');
    // og:title sem " | Ascende": a marca vai no og:site_name.
    expect(html).toContain('<meta property="og:title" content="Fixture um"/>');
    expect(html).toContain('<link rel="alternate" type="application/rss+xml" title="Blog do Ascende" href="https://ascende.site/blog/feed.xml"/>');
    expect(html).not.toContain("noindex");
  });

  it("seoTitle, quando existe, vence no <title> — o h1 continua o title", () => {
    const h = renderArtigo(post("x", { seoTitle: "Curto" }), [], ctx);
    expect(h).toContain("<title>Curto | Ascende</title>");
    expect(h).toMatch(/<h1[^>]*>Fixture x<\/h1>/);
  });

  it("JSON-LD verdadeiro: autor Henrique Pett (Person, só fatos), publisher Organization, sem revisão, sem dateModified inventado", () => {
    const [bp, trilha] = jsonLd(html);
    expect(bp["@type"]).toBe("BlogPosting");
    expect(bp.headline).toBe("Fixture um");
    expect(bp.datePublished).toBe("2026-10-14");
    expect(bp).not.toHaveProperty("dateModified");
    const org = {
      "@type": "Organization", name: "Ascende", url: "https://ascende.site/",
      logo: { "@type": "ImageObject", url: "https://ascende.site/icon-512.png" },
    };
    // Decisão do Henrique (29/10/2026): ele assina todo post. Só o que é
    // fato — nada de sameAs, foto, credencial ou "especialista".
    expect(bp.author).toEqual({
      "@type": "Person", name: "Henrique Pett", jobTitle: "Fundador do Ascende",
      url: "https://ascende.site/sobre#autor", worksFor: org,
    });
    expect(bp.publisher).toEqual(org);
    expect(JSON.stringify(bp.author)).not.toMatch(/sameAs|image|hasCredential|knowsAbout|honorificPrefix/);
    expect(bp).not.toHaveProperty("abstract"); // sem resumo, sem abstract
    expect(bp.mainEntityOfPage).toBe("https://ascende.site/blog/um/");
    expect(bp.isPartOf).toEqual({ "@type": "Blog", url: "https://ascende.site/blog/" });
    // `image` só existe como logo da Organization — nunca capa no BlogPosting.
    expect(bp).not.toHaveProperty("image");
    expect(html).not.toMatch(/reviewedBy|aggregateRating|medicalReview/);
    expect(html.match(/"Person"/g)).toHaveLength(1); // só o autor
    expect(trilha.itemListElement.map((i: { item: string }) => i.item)).toEqual([
      "https://ascende.site/", "https://ascende.site/blog/", "https://ascende.site/blog/um/",
    ]);
    expect(html).not.toContain("article:modified_time");
  });

  it("dateModified só quando o post mudou de fato", () => {
    const h = renderArtigo(post("m", { dateModified: "2026-10-20" }), [], ctx);
    expect(jsonLd(h)[0].dateModified).toBe("2026-10-20");
    expect(h).toContain('<meta property="article:modified_time" content="2026-10-20"/>');
    expect(h).toContain("Atualizado em");
    const igual = renderArtigo(post("n", { dateModified: "2026-10-14" }), [], ctx);
    expect(jsonLd(igual)[0]).not.toHaveProperty("dateModified");
  });

  it("data visível em <time> e tempo de leitura calculado", () => {
    expect(html).toContain('<time dateTime="2026-10-14">14 de outubro de 2026</time>');
    expect(html).toContain("1 min de leitura");
  });

  it("links: trilha para /blog/, relacionados, produto, fontes externas com noopener", () => {
    expect(html).toMatch(/<nav aria-label="Trilha"><a href="\/blog\/"/);
    expect(html).toContain('href="/blog/dois/"');
    expect(html).toContain("Continue lendo");
    expect(html).toMatch(/href="\/"[^>]*>Como o Ascende funciona/);
    expect(html).toMatch(/<a href="https:\/\/exemplo\.org\/a" rel="noopener"/);
    expect(html).toContain('href="/auth?intent=signup"');
  });

  it("sem relacionados, a seção não existe", () => {
    expect(renderArtigo(post("s"), [], ctx)).not.toContain("Continue lendo");
  });

  it("acessível: skip link que leva a <main>, alvos de 44 pt, Blog no rodapé", () => {
    expect(html).toContain('<a href="#conteudo"');
    expect(html).toMatch(/<main id="conteudo" tabindex="-1"/);
    expect(html).toMatch(/<a href="\/blog\/" class="[^"]*min-h-11[^"]*">Blog<\/a>/);
  });

  it("nenhum JS além do tema (externo, mesma origem) — o CSP proíbe inline", () => {
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1]);
    for (const s of scripts) expect(s === ` src="${CAMINHO_DO_TEMA}"` || s === ' type="application/ld+json"').toBe(true);
    expect(html).not.toMatch(/\son[a-z]+=/);
  });
});

describe("a listagem", () => {
  const posts = [post("novo", { datePublished: "2026-10-14" }), post("velho", { datePublished: "2026-10-01" })];
  const html = renderListagem(posts, ctx);

  it("canonical do blog, og website, e JSON-LD Blog com os posts", () => {
    expect(html).toContain('<link rel="canonical" href="https://ascende.site/blog/"/>');
    expect(html).toContain('<meta property="og:type" content="website"/>');
    expect(html).toContain('<meta property="og:image" content="https://ascende.site/icon-512.png"/>');
    expect(html).toContain('application/rss+xml');
    const [b] = jsonLd(html);
    expect(b["@type"]).toBe("Blog");
    expect(b.inLanguage).toBe("pt-BR");
    expect(b.publisher.name).toBe("Ascende");
    expect(b.blogPost.map((p: { url: string }) => p.url)).toEqual([
      "https://ascende.site/blog/novo/", "https://ascende.site/blog/velho/",
    ]);
  });

  it("um link por cartão, na ordem recebida, um h1", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html.indexOf('href="/blog/novo/"')).toBeLessThan(html.indexOf('href="/blog/velho/"'));
    expect(html).toContain("Rotina integrada");
  });

  it("sem post não há listagem — nunca uma página vazia", () => {
    expect(() => renderListagem([], ctx)).toThrow();
  });
});

describe("o markdown do artigo (modo opt-in)", () => {
  const md = (c: string, artigo = true) => renderToStaticMarkup(createElement(Markdown, { content: c, artigo }));

  it("títulos viram h2/h3 com âncora; # no corpo desce a h2", () => {
    const h = md("# Topo\n\n## Comida no orçamento\n\n## Comida no orçamento\n\n#### Fundo");
    expect(h).toMatch(/<h2 id="topo"/);
    expect(h).toMatch(/<h2 id="comida-no-orcamento"/);
    expect(h).toMatch(/<h2 id="comida-no-orcamento-2"/);
    expect(h).toMatch(/<h3 id="fundo"/);
  });

  it("links e citação no artigo; no chat continuam texto", () => {
    expect(md("Veja [isto](https://exemplo.org).")).toContain('<a href="https://exemplo.org"');
    expect(md("> dito")).toContain("<blockquote");
    const chat = md("Veja [isto](https://exemplo.org).", false);
    expect(chat).not.toContain("<a ");
    expect(chat).toContain("[isto](https://exemplo.org)");
  });
});

describe("as regras pequenas", () => {
  it("data por extenso lida da string, sem fuso", () => {
    expect(dataPorExtenso("2026-01-01")).toBe("1 de janeiro de 2026");
    expect(dataPorExtenso("2026-10-14")).toBe("14 de outubro de 2026");
    expect(() => dataPorExtenso("14/10/2026")).toThrow();
  });

  it("leitura: palavras ÷ 200, para cima, mínimo 1", () => {
    expect(minutosDeLeitura("uma")).toBe(1);
    expect(minutosDeLeitura(Array(201).fill("palavra").join(" "))).toBe(2);
    expect(minutosDeLeitura("## Título\n\n[duas palavras](/x)")).toBe(1);
  });

  it("JSON-LD não fecha o <script> antes da hora", () => {
    expect(jsonParaScript({ t: "</script><b>" })).not.toContain("</script>");
  });

  it("o tema repete a chave e a regra do useTheme", () => {
    expect(TEMA_JS).toContain('"ascende-theme"');
    expect(TEMA_JS).toContain("prefers-color-scheme: dark");
    // Escolha explícita vence o sistema também na moldura (como o useTheme).
    expect(TEMA_JS).toContain('removeAttribute("media")');
  });

  it("o link Blog da SPA só aparece com post", () => {
    const f = (blog?: boolean) =>
      renderToStaticMarkup(createElement(StaticRouter, { location: "/" }, createElement(SiteFooter, { blog })));
    expect(f(false)).not.toContain('href="/blog/"');
    expect(f(true)).toContain('href="/blog/"');
    // Sem o define do build (aqui, no Vitest), o padrão é "não há post".
    expect(f()).not.toContain('href="/blog/"');
  });
});

/* ── A figura do artigo (post 2): só no artigo, só resolvida pelo pipeline ── */
describe("a figura do artigo", () => {
  const img = {
    src: "/blog/fx/diagrama.png", width: 720, height: 1160,
    variantes: [{ src: "/blog/fx/diagrama-360.png", width: 360 }, { src: "/blog/fx/diagrama.png", width: 720 }],
  };
  const corpo = 'Antes.\n![Diagrama em três etapas da revisão](./diagrama.png "Diagrama: Ascende")\nDepois.';
  const fig = (c = corpo, imagens: Record<string, typeof img> = { "./diagrama.png": img }) =>
    renderToStaticMarkup(createElement(Markdown, { content: c, artigo: true, imagens }));

  it("figure > img com dimensões, srcset, sizes, alt, lazy e async + figcaption", () => {
    const h = fig();
    expect(h).toMatch(/<figure[^>]*><a href="\/blog\/fx\/diagrama\.png" aria-label="Abrir a imagem em tamanho original: Diagrama em três etapas da revisão"[^>]*><img src="\/blog\/fx\/diagrama\.png" width="720" height="1160"/);
    expect(h).toContain('srcSet="/blog/fx/diagrama-360.png 360w, /blog/fx/diagrama.png 720w"');
    expect(h).toContain('sizes="(min-width: 42rem) 40rem, calc(100vw - 2.5rem)"');
    expect(h).toContain('alt="Diagrama em três etapas da revisão"');
    expect(h).toContain('loading="lazy"');
    expect(h).toContain('decoding="async"');
    expect(h).toContain("<figcaption");
    expect(h).toContain(">Diagrama: Ascende</figcaption>");
    // A imagem é um bloco: o parágrafo de antes e o de depois continuam inteiros.
    expect(h).toMatch(/<p[^>]*>Antes\.<\/p><figure/);
    expect(h).toMatch(/<\/figure><p[^>]*>Depois\.<\/p>/);
  });

  it("não estoura a coluna: largura 100%, altura proporcional, teto pela altura da tela", () => {
    const h = fig();
    expect(h).toContain("w-full h-auto");
    expect(h).toContain("dark:brightness-90");
    expect(h).toContain("max-width:min(100%, calc(85svh * 0.6207))");
  });

  it("sem variante, sem srcset", () => {
    const h = fig(corpo, { "./diagrama.png": { ...img, variantes: [{ src: img.src, width: 720 }] } });
    expect(h).not.toContain("srcSet");
    expect(h).not.toContain("sizes=");
  });

  it("imagem não resolvida, sem alt ou sem legenda: o build falha, não publica figura quebrada", () => {
    expect(() => fig(corpo, {})).toThrow();
    expect(() => fig('![](./diagrama.png "Legenda")')).toThrow();
    expect(() => fig("![Um alt](./diagrama.png)")).toThrow();
  });

  it("no chat e nos planos não existe imagem: a sintaxe continua texto", () => {
    for (const modo of [{}, { doc: true }]) {
      const h = renderToStaticMarkup(createElement(Markdown, { content: corpo, ...modo }));
      expect(h).not.toContain("<img");
      expect(h).toContain("![Diagrama em três etapas da revisão]");
    }
  });

  it("o artigo passa as imagens do post ao corpo", () => {
    const h = renderArtigo(post("fx", { corpo, imagens: { "./diagrama.png": img } }), [], ctx);
    expect(h).toContain('<img src="/blog/fx/diagrama.png"');
    // Não muda o og:image (o diagrama vertical não serve de prévia).
    expect(h).toContain('<meta property="og:image" content="https://ascende.site/icon-512.png"/>');
  });
});

/* ── O `_` do itálico segue o CommonMark (Clareira, post 2) ── */
describe("itálico com sublinhado", () => {
  const md = (c: string, artigo = false) => renderToStaticMarkup(createElement(Markdown, { content: c, artigo }));

  it("lacunas '___ a ___' continuam texto, sem <em>", () => {
    for (const artigo of [false, true]) {
      const h = md("Vou fazer: ___ a ___ e depois ___.", artigo);
      expect(h).not.toContain("<em>");
      expect(h).toContain("___ a ___");
    }
  });

  it("_palavra_ e _duas palavras_ viram itálico, com o texto de antes preservado", () => {
    expect(md("um _texto_ aqui")).toContain("um <em>texto</em> aqui");
    expect(md("_começo_ e (_entre parênteses_).")).toContain("<em>começo</em> e (<em>entre parênteses</em>).");
  });

  it("sublinhado dentro de palavra não abre ênfase", () => {
    expect(md("o arquivo nome_do_arquivo.md")).not.toContain("<em>");
    expect(md("ação_rápida_já")).not.toContain("<em>");
  });

  it("os outros marcadores continuam: negrito, *itálico*, `código` e link no artigo", () => {
    const h = md("**forte**, *leve*, `x_y`, [link](/recusas) e _fim_", true);
    expect(h).toContain("<strong>forte</strong>");
    expect(h).toContain("<em>leve</em>");
    expect(h).toMatch(/<code[^>]*>x_y<\/code>/);
    expect(h).toContain('href="/recusas"');
    expect(h).toContain("<em>fim</em>");
  });
});

describe("listas do artigo quebram palavra longa", () => {
  const md = (c: string, modo: Record<string, boolean>) => renderToStaticMarkup(createElement(Markdown, { content: c, ...modo }));
  it("ul e ol com break-words e hyphens-auto só no artigo", () => {
    const c = "- desnecessariamente\n\n1. desnecessariamente";
    const a = md(c, { artigo: true });
    expect(a).toMatch(/<ul class="[^"]*break-words hyphens-auto/);
    expect(a).toMatch(/<ol class="[^"]*break-words hyphens-auto/);
    for (const modo of [{}, { doc: true }]) expect(md(c, modo)).not.toContain("hyphens-auto");
  });
});

/* ── Modo `pagina` (Legal e Sobre pré-renderizados): títulos reais, mesmo visual ── */
describe("o markdown das páginas públicas de texto", () => {
  const md = (c: string, modo: Record<string, boolean>) => renderToStaticMarkup(createElement(Markdown, { content: c, ...modo }));
  const c = "# Política\n\n## 1. Dados\n\n### Detalhe\n\nVeja a [lista](/recusas).";

  it("# → h1, ## → h2, ### → h3, com as MESMAS classes do modo doc", () => {
    const pg = md(c, { doc: true, pagina: true });
    const doc = md(c, { doc: true });
    expect(pg).toMatch(/<h1 class="[^"]+">Política<\/h1>/);
    expect(pg).toMatch(/<h2 class="[^"]+">1\. Dados<\/h2>/);
    expect(pg).toMatch(/<h3 class="[^"]+">Detalhe<\/h3>/);
    const classes = (h: string) => [...h.matchAll(/class="([^"]+)"/g)].map((m) => m[1]).slice(0, 3);
    // As mesmas do doc + `tracking-normal`, que desfaz o aperto que o
    // index.css dá a todo h1/h2/h3 (no doc eles eram <p>, sem aperto).
    expect(classes(pg)).toEqual(classes(doc).map((c) => `${c} tracking-normal`));
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).toMatch(/h1, h2, h3 \{ letter-spacing: -0\.02em; \}/);
    expect(pg).toContain('<a href="/recusas"');
  });

  it("planos (doc) e chat continuam com <p> e sem link", () => {
    for (const modo of [{ doc: true }, {}]) {
      const h = md(c, modo);
      expect(h).not.toMatch(/<h[123]/);
      expect(h).not.toContain("<a ");
    }
  });
});
