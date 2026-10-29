/**
 * Pré-render: cada página pública sai com o conteúdo no HTML (H1 e texto de
 * verdade, sem JS), o <head> dela, o tema antes do CSS; a 404 da casa; e o
 * JSON-LD Organization da home, sem contato inventado.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// O mesmo que scripts/prerender.mjs faz: o cliente do Supabase não entra.
vi.mock("@/integrations/supabase/client", () => import("@/prerender/supabaseAusente"));

import { renderizar404, renderizarRota } from "@/prerender/entrada";
import {
  aplicarCabeca, canonicaDe, comConteudo, comTema, faqDoMarkup, jsonLdInvalidos, PAGINAS_PRE_RENDERIZADAS,
  paginaSemApp, semJsonLd,
} from "@/prerender/paginas";
import { htmlParaMarkdown } from "@/lib/agentes/htmlParaMarkdown";
import { FAQ_DA_HOME } from "@/lib/faqDaHome";
import { textoPlano } from "@/lib/blog/faq";
import { PAGINAS_PUBLICAS } from "@/lib/blog/sitemap";
import { PRIVACIDADE } from "@/lib/legal";
import { SOBRE } from "@/lib/sobre";
import { BLOG_TEM_POSTS } from "@/blog/temPosts";

const RAIZ = join(__dirname, "..", "..");
const INDEX = readFileSync(join(RAIZ, "index.html"), "utf8");
const texto = (html: string) => html.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&[a-z#0-9]+;/gi, "x").replace(/\s+/g, " ").trim();

describe("cada página pública pré-renderizada", () => {
  it.each(PAGINAS_PRE_RENDERIZADAS.map((p) => [p.rota]))("%s: H1 e mais de 500 caracteres de texto, sem JS", async (rota) => {
    const markup = await renderizarRota(rota);
    expect(markup.match(/<h1\b/g), "exatamente um <h1>").toHaveLength(1);
    expect(texto(markup).length).toBeGreaterThan(500);
    // Não é o Splash do <Suspense> (chunk não carregado) nem o NotFound.
    expect(markup).not.toContain("animate-pulse font-display text-xl");
    expect(markup).not.toContain("Esse degrau não existe");
  });

  it("o conteúdo é o da página: /privacidade tem a política, /sobre tem o texto aprovado", async () => {
    expect(texto(await renderizarRota("/privacidade"))).toContain("Identificação da Controladora");
    expect(texto(await renderizarRota("/sobre"))).toContain("Quem opera o Ascende");
    expect(texto(await renderizarRota("/recusas"))).toContain("Nunca venderemos seus dados");
  });

  it("todo JSON-LD do HTML pré-renderizado é JSON (o texto de <script> não decodifica &quot;)", async () => {
    for (const p of PAGINAS_PRE_RENDERIZADAS) {
      const html = comConteudo(INDEX, await renderizarRota(p.rota));
      expect(jsonLdInvalidos(html), p.rota).toEqual([]);
    }
    const home = await renderizarRota("/");
    expect(home).toContain('"@type":"FAQPage"');
    expect(jsonLdInvalidos('<script type="application/ld+json">{&quot;a&quot;:1}</script>')).toHaveLength(1);
  });

  it("FAQ da home: cada pergunta e resposta do FAQPage está no HTML pré-renderizado (o texto visível É o do schema)", async () => {
    const home = await renderizarRota("/");
    const faq = faqDoMarkup(home);
    expect(faq.map((f) => f.pergunta)).toEqual(FAQ_DA_HOME.map((f) => f.pergunta));
    // Texto do HTML sem script, entidades decodificadas e sem espaços (a
    // tag de um link vira espaço antes do ponto final).
    const plano = (t: string) => t.replace(/\s+/g, "");
    const visivel = plano(home.replace(/<script\b[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    for (const f of faq) {
      expect(visivel, f.pergunta).toContain(plano(f.pergunta));
      expect(visivel, f.pergunta).toContain(plano(f.resposta));
    }
    // Fechado, mas no DOM: forceMount + altura 0 + invisible (não o `hidden`).
    expect(home.match(/data-state="closed"[^>]*class="[^"]*data-\[state=closed\]:invisible/g)?.length).toBeGreaterThanOrEqual(FAQ_DA_HOME.length);
  });

  it("index.md tem o FAQ inteiro (pergunta em ### e a resposta) e títulos com <br> inteiros", async () => {
    const md = htmlParaMarkdown(await renderizarRota("/"), "https://ascende.site");
    for (const f of FAQ_DA_HOME) {
      const i = md.indexOf(`### ${f.pergunta}`);
      expect(i, f.pergunta).toBeGreaterThan(0);
      const depois = textoPlano(md.slice(i).split("\n\n")[1]);
      expect(depois).toBe(textoPlano(f.resposta));
    }
    expect(md).toMatch(/^## Batalhas: para o que rouba seu dinheiro e sua energia\.$/m);
    expect(md).not.toMatch(/^- •/m);
  });

  it("as páginas pré-renderizadas SÃO as do sitemap (uma rota pública nova entra nas duas listas)", () => {
    expect(PAGINAS_PRE_RENDERIZADAS.map((p) => p.rota).sort()).toEqual(PAGINAS_PUBLICAS.map((p) => p.caminho).sort());
  });

  it("arquivo sem barra (o Netlify serve /privacidade de privacidade.html) e .md ao lado", () => {
    for (const p of PAGINAS_PRE_RENDERIZADAS) {
      if (p.rota === "/") { expect([p.arquivo, p.md]).toEqual(["index.html", "index.md"]); continue; }
      expect(p.arquivo).toBe(`${p.rota.slice(1)}.html`);
      expect(p.md).toBe(`${p.rota.slice(1)}.md`);
    }
  });
});

describe("o HTML montado a partir do index.html", () => {
  const pg = PAGINAS_PRE_RENDERIZADAS.find((p) => p.rota === "/privacidade")!;
  const html = semJsonLd(aplicarCabeca(comTema(comConteudo(INDEX, "<main><h1>X</h1></main>")), { ...pg.cabeca!, canonical: canonicaDe(pg.rota) }));

  it("o <head> é o da página: title, description, canonical sem barra, og:url, og/twitter", () => {
    expect(html).toContain("<title>Política de Privacidade — Ascende</title>");
    expect(html).toContain('<link rel="canonical" href="https://ascende.site/privacidade" />');
    expect(html).toContain('<meta property="og:url" content="https://ascende.site/privacidade" />');
    expect(html).toContain('<meta property="og:title" content="Política de Privacidade — Ascende" />');
    expect(html).toContain('<meta name="twitter:title" content="Política de Privacidade — Ascende" />');
    expect(html).toContain(`<meta name="description" content="${pg.cabeca!.description}" />`);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
  });

  it("conteúdo no #root com data-prerender; tema.js antes de qualquer CSS; JSON-LD só na home", () => {
    expect(html).toContain('<div id="root" data-prerender><main><h1>X</h1></main></div>');
    const tema = html.indexOf('<script src="/tema.js"></script>');
    expect(tema).toBeGreaterThan(0);
    expect(tema).toBeLessThan(html.indexOf("<link rel=\"icon\""));
    expect(html).not.toContain("application/ld+json");
    expect(html).not.toContain("Quem publica o Ascende"); // o comentário do JSON-LD também sai
  });

  it("o template mudou e uma tag sumiu ou duplicou → erro, não página com o <head> errado", () => {
    expect(() => comConteudo(INDEX.replace('<div id="root"></div>', ""), "x")).toThrow(/root/);
    expect(() => aplicarCabeca(INDEX.replace("<title>", "<title>a</title><title>"), { title: "t", description: "d", canonical: null })).toThrow(/title/);
  });
});

describe("a 404 da casa", () => {
  const markup = renderizar404();
  const html = paginaSemApp(comConteudo(aplicarCabeca(INDEX, { title: "Página não encontrada — Ascende", description: "x", canonical: null }), markup, { app: false }));

  it("diz o que houve e oferece saídas que existem", () => {
    expect(texto(markup).length).toBeGreaterThan(20);
    for (const href of ["/", "/sobre", "/sitemap.xml", "/llms.txt"]) expect(markup).toContain(`href="${href}"`);
    // "Blog" só quando o build acha post (BLOG_TEM_POSTS, regra do zero do blog).
    if (BLOG_TEM_POSTS) expect(markup).toContain('href="/blog/"');
    else expect(markup).not.toContain("/blog/");
    expect(markup).toMatch(/<h1\b/);
  });

  it("sem o JS da SPA, sem canonical, fora do índice", () => {
    expect(html).not.toMatch(/<script type="module"/);
    expect(html).not.toContain("modulepreload");
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).toContain('<div id="root">');
    expect(html).not.toContain("data-prerender");
  });
});

describe("JSON-LD da home", () => {
  const blocos = [...INDEX.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const org = blocos.find((b) => b["@type"] === "Organization");

  it("SoftwareApplication e Organization, ligados pelo @id", () => {
    expect(blocos.map((b) => b["@type"]).sort()).toEqual(["Organization", "SoftwareApplication"]);
    expect(org).toMatchObject({ name: "Ascende", url: "https://ascende.site/", logo: "https://ascende.site/icon-512.png" });
    expect(blocos.find((b) => b["@type"] === "SoftwareApplication").publisher).toEqual({ "@id": org["@id"] });
  });

  it("sem contactPoint, e-mail ou telefone inventados (não há canal público)", () => {
    const json = JSON.stringify(org);
    expect(json).not.toMatch(/contactPoint|email|telephone/i);
  });

  it("a oferta de preço 0 é o plano gratuito, não o produto inteiro; sem app nativo", () => {
    const app = blocos.find((b) => b["@type"] === "SoftwareApplication");
    expect(app.offers).toMatchObject({ "@type": "Offer", name: "Plano gratuito", price: "0" });
    expect(app.offers.description).toMatch(/Ascende\+, por assinatura/);
    expect(app.operatingSystem).toBe("Web");
  });

  it("o endereço é a sede publicada na Política de Privacidade (e no /sobre)", () => {
    const a = org.address;
    expect(a["@type"]).toBe("PostalAddress");
    const sede = `com sede em ${a.streetAddress}, ${a.addressLocality} – ${a.addressRegion}, CEP ${a.postalCode}`;
    expect(PRIVACIDADE).toContain(sede);
    expect(SOBRE).toContain(sede);
    expect(a.addressCountry).toBe("BR");
  });
});
