/**
 * GEO e autoria (29/10/2026): o autor de todo post (constante única), o
 * `resumo` do frontmatter, a seção "## Perguntas frequentes" → FAQPage, e o
 * que isso muda no JSON-LD, no feed, no .md, no llms.txt e nas páginas.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/integrations/supabase/client", () => import("@/prerender/supabaseAusente"));

import { lerPost } from "@/lib/blog/post";
import { lerFaq, textoPlano } from "@/lib/blog/faq";
import { AUTOR_DO_BLOG, ASSINATURA_DO_AUTOR, type PostDoBlog } from "@/lib/blog/tipos";
import { artigoEmMarkdown, listagemEmMarkdown } from "@/lib/blog/markdown";
import { gerarFeed } from "@/lib/blog/sitemap";
import { gerarLlmsTxt } from "@/lib/agentes/llms";
import { renderArtigo, renderListagem } from "@/blog/render";
import { comJsonLd, jsonLdDaPagina, PAGINAS_PRE_RENDERIZADAS } from "@/prerender/paginas";
import { renderizarRota } from "@/prerender/entrada";
import { SOBRE, SOBRE_FAQ } from "@/lib/sobre";

const HOJE = "2026-10-29";
const CTX = { siteUrl: "https://ascende.site", cssHrefs: ["/assets/x.css"] };
const RAIZ = join(__dirname, "..", "..", "..");

const FAQ_OK = `## Perguntas frequentes

### Primeira pergunta?

Resposta com [link](/recusas) e **ênfase**.

### Segunda pergunta?

Outra resposta,
em duas linhas.
`;

function arquivo(extraFm = "", corpo = `Texto.\n\n## Seção\n\nMais texto.\n\n${FAQ_OK}`) {
  return `---
title: Um título com tamanho suficiente
description: Uma descrição com tamanho suficiente para passar no limite mínimo de setenta caracteres.
slug: um-post
datePublished: 2026-10-01
intent: como testar o formato GEO do blog
cluster: rotina-integrada
sources:
  - title: Fonte
    url: https://www.gov.br/
    publisher: Gov
    accessed: 2026-09-30
${extraFm}---
${corpo}`;
}
const ler = (extraFm = "", corpo?: string) => lerPost("um-post.md", arquivo(extraFm, corpo), HOJE);

describe("o autor: uma constante só", () => {
  it("Henrique Pett, fundador do Ascende, com a seção /sobre#autor", () => {
    expect(AUTOR_DO_BLOG).toEqual({ nome: "Henrique Pett", cargo: "Fundador do Ascende", url: "https://ascende.site/sobre#autor" });
    expect(ASSINATURA_DO_AUTOR).toBe("Henrique Pett, fundador do Ascende");
  });

  it("'author' no frontmatter continua recusado (o autor não é por post)", () => {
    expect(ler("author: Outra Pessoa\n").erros.join(" ")).toMatch(/chave proibida 'author'.*AUTOR_DO_BLOG/);
  });

  it("nenhum lugar do código escreve o nome numa string fora da constante", () => {
    for (const f of ["src/blog/render.tsx", "src/blog/paginas.tsx", "src/lib/blog/markdown.ts", "src/lib/blog/sitemap.ts", "src/lib/agentes/llms.ts", "src/prerender/paginas.ts"]) {
      // Em comentário pode (documenta); em string, não.
      const codigo = readFileSync(join(RAIZ, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(codigo, f).not.toContain("Henrique Pett");
    }
  });
});

describe("resumo no frontmatter", () => {
  it("2 a 4 frases de até 200 caracteres: entra no post", () => {
    const r = ler('resumo:\n  - "Frase um."\n  - "Frase dois."\n');
    expect(r.erros).toEqual([]);
    expect(r.post!.resumo).toEqual(["Frase um.", "Frase dois."]);
  });

  it("opcional: sem ele, []", () => {
    expect(ler().post!.resumo).toEqual([]);
  });

  it.each([
    ['resumo: ["Só uma."]\n', /resumo tem 1 item\(ns\); precisa de 2 a 4/],
    ['resumo: ["a.", "b.", "c.", "d.", "e."]\n', /resumo tem 5 item/],
    [`resumo: ["${"x".repeat(201)}", "b."]\n`, /resumo\[0\] tem 201 caracteres; no máximo 200/],
    ['resumo: ["", "b."]\n', /resumo\[0\] está vazio/],
    ['resumo: "uma string"\n', /resumo tem de ser uma lista/],
    ['resumo: ["- item", "b."]\n', /resumo\[0\] é uma frase/],
    ['resumo: ["Revisar TODO isto.", "b."]\n', /marcador de texto não pronto 'TODO'/],
  ])("%s → erro", (fm, msg) => {
    expect(ler(fm).erros.join(" ")).toMatch(msg);
  });
});

describe("FAQ: '## Perguntas frequentes' → perguntas e respostas", () => {
  it("lê pergunta e o parágrafo único (linhas juntadas)", () => {
    const r = lerFaq(`Intro.\n\n${FAQ_OK}`);
    expect(r.erros).toEqual([]);
    expect(r.faq).toEqual([
      { pergunta: "Primeira pergunta?", resposta: "Resposta com [link](/recusas) e **ênfase**." },
      { pergunta: "Segunda pergunta?", resposta: "Outra resposta, em duas linhas." },
    ]);
  });

  it("sem a seção, sem FAQ e sem erro", () => {
    expect(lerFaq("## Outra\n\n### Uma?\n\nTexto.\n")).toEqual({ faq: [], erros: [] });
  });

  it("'---' encerra a última resposta: depois dele, o aviso final (parágrafos) fica fora do FAQ", () => {
    const r = lerFaq(`${FAQ_OK}\n---\n\nConteúdo educativo. Não substitui orientação.\n`);
    expect(r.erros).toEqual([]);
    expect(r.faq.at(-1)!.resposta).toBe("Outra resposta, em duas linhas.");
  });

  it.each([
    ["pergunta sem '?'", FAQ_OK.replace("Primeira pergunta?", "Primeira pergunta"), /termina em '\?'/],
    ["1 pergunta só", "## Perguntas frequentes\n\n### Uma?\n\nResp.\n", /tem 1 pergunta\(s\); precisa de 2 a 6/],
    ["7 perguntas", "## Perguntas frequentes\n\n" + Array.from({ length: 7 }, (_, i) => `### P${i}?\n\nR.\n`).join("\n"), /tem 7 pergunta/],
    ["pergunta sem resposta", FAQ_OK.replace("Resposta com [link](/recusas) e **ênfase**.\n", ""), /precisa de UM parágrafo/],
    ["resposta em lista", FAQ_OK.replace("Resposta com", "- Resposta com"), /precisa de UM parágrafo/],
    ["dois parágrafos", FAQ_OK.replace("e **ênfase**.", "e **ênfase**.\n\nSegundo parágrafo."), /é UM parágrafo/],
    ["produto depois da última resposta, sem '---'", `${FAQ_OK}\nSe quiser guardar no Ascende...\n`, /é UM parágrafo.*'---'/],
    ["título depois do '---'", `${FAQ_OK}\n---\n\n### Mais?\n`, /depois do '---' do FAQ só vem o aviso/],
    ["não é a última seção", `${FAQ_OK}\n## Outra seção\n\nTexto.\n`, /tem de ser a última seção/],
    ["parágrafo antes da 1ª pergunta", FAQ_OK.replace("### Primeira", "Intro do FAQ.\n\n### Primeira"), /logo abaixo de '## Perguntas frequentes' vem a primeira/],
    ["duas seções", `${FAQ_OK}\n${FAQ_OK}`, /aparece 2 vezes/],
    ["título quase igual", FAQ_OK.replace("## Perguntas frequentes", "## Perguntas Frequentes"), /exatamente '## Perguntas frequentes'/],
    ["nível errado", FAQ_OK.replace("## Perguntas frequentes", "### Perguntas frequentes"), /exatamente '## Perguntas frequentes'/],
  ])("%s → erro", (_n, corpo, msg) => {
    const r = lerFaq(corpo);
    expect(r.erros.join(" ")).toMatch(msg);
    expect(r.faq).toEqual([]);
  });

  it("'### …' dentro de bloco de código não conta", () => {
    expect(lerFaq("```\n## Perguntas frequentes\n```\n").faq).toEqual([]);
  });

  it("o FAQ chega ao post pelo lerPost (e um FAQ errado barra o post)", () => {
    expect(ler().post!.faq).toHaveLength(2);
    expect(ler("", "Texto.\n\n## Perguntas frequentes\n\n### Só uma?\n\nR.\n").erros.join(" ")).toMatch(/precisa de 2 a 6/);
  });

  it("textoPlano: o JSON-LD sem Markdown", () => {
    expect(textoPlano("Veja [o guia](/blog/x/), **isto** e _aquilo_ em `código`.")).toBe("Veja o guia, isto e aquilo em código.");
    expect(textoPlano("snake_case_fica e 2*3*4")).toBe("snake_case_fica e 2*3*4");
  });
});

describe("o artigo com resumo e FAQ", () => {
  const p = ler('resumo:\n  - "Frase um."\n  - "Frase dois."\n').post! as PostDoBlog;
  const html = renderArtigo(p, [], CTX);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

  it("BlogPosting: abstract = o resumo; author = Person do AUTOR_DO_BLOG", () => {
    const bp = ld.find((d) => d["@type"] === "BlogPosting");
    expect(bp.abstract).toBe("Frase um. Frase dois.");
    expect(bp.author).toMatchObject({ "@type": "Person", name: "Henrique Pett", url: "https://ascende.site/sobre#autor" });
    expect(bp.publisher["@type"]).toBe("Organization");
  });

  it("FAQPage gerado das perguntas visíveis, respostas em texto", () => {
    const faq = ld.find((d) => d["@type"] === "FAQPage");
    expect(faq.mainEntity).toEqual([
      { "@type": "Question", name: "Primeira pergunta?", acceptedAnswer: { "@type": "Answer", text: "Resposta com link e ênfase." } },
      { "@type": "Question", name: "Segunda pergunta?", acceptedAnswer: { "@type": "Answer", text: "Outra resposta, em duas linhas." } },
    ]);
    expect(html).toMatch(/<h3[^>]*>Primeira pergunta\?<\/h3>/);
  });

  it("sem FAQ no corpo, sem FAQPage", () => {
    const sem = renderArtigo(ler("", "Texto.\n\n## Seção\n\nMais.\n").post!, [], CTX);
    expect(sem).not.toContain("FAQPage");
  });

  it("listagem: cada BlogPosting com o autor", () => {
    const l = renderListagem([p], CTX);
    expect(l).toContain('"author":{"@type":"Person","name":"Henrique Pett","url":"https://ascende.site/sobre#autor"}');
  });

  it(".md: byline, 'Em resumo' antes do corpo; listagem diz quem escreve", () => {
    const md = artigoEmMarkdown(p);
    expect(md).toContain("Por Henrique Pett, fundador do Ascende. Publicado em 2026-10-01.");
    expect(md.indexOf("## Em resumo\n\n- Frase um.\n- Frase dois.")).toBeLessThan(md.indexOf("Texto."));
    expect(md).toContain("## Perguntas frequentes");
    expect(listagemEmMarkdown([p])).toContain("Textos de Henrique Pett, fundador do Ascende.");
    expect(artigoEmMarkdown(ler().post!)).not.toContain("Em resumo");
  });

  it("feed: dc:creator em cada item, namespace declarado", () => {
    const feed = gerarFeed([p]);
    expect(feed).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
    expect(feed).toContain("<dc:creator>Henrique Pett</dc:creator>");
  });

  it("llms.txt cita o autor (com o link da /sobre#autor) antes dos posts", () => {
    const base = readFileSync(join(RAIZ, "src", "lib", "agentes", "llms.txt"), "utf8");
    const txt = gerarLlmsTxt(base, [p]);
    expect(txt).toContain("- [Henrique Pett, fundador do Ascende](https://ascende.site/sobre#autor): autor de todos os posts do blog.");
    expect(gerarLlmsTxt(base, [])).not.toContain("sobre#autor): autor");
  });
});

describe("as páginas pré-renderizadas: WebPage/AboutPage + BreadcrumbList", () => {
  const pg = (rota: string) => PAGINAS_PRE_RENDERIZADAS.find((p) => p.rota === rota)!;

  it("legais e /recusas: WebPage com o <head> da página e a trilha", () => {
    for (const rota of ["/privacidade", "/termos", "/aviso-legal", "/recusas"]) {
      const [wp, trilha, ...resto] = jsonLdDaPagina(pg(rota)) as Record<string, unknown>[];
      expect(wp).toMatchObject({ "@type": "WebPage", name: pg(rota).cabeca!.title, description: pg(rota).cabeca!.description, url: `https://ascende.site${rota}` });
      expect((trilha.itemListElement as { item: string }[]).map((i) => i.item)).toEqual(["https://ascende.site/", `https://ascende.site${rota}`]);
      // Nome sem a marca: "Ascende › Política de Privacidade", não "… — Ascende".
      expect((trilha.itemListElement as { name: string }[])[1].name).not.toMatch(/Ascende$/);
      expect(resto).toEqual([]);
    }
  });

  it("/sobre: AboutPage, FAQPage das perguntas visíveis e o autor (Person com o @id do BlogPosting)", () => {
    const ld = jsonLdDaPagina(pg("/sobre")) as Record<string, unknown>[];
    expect(ld.map((d) => d["@type"])).toEqual(["AboutPage", "BreadcrumbList", "FAQPage", "Person"]);
    const faq = ld[2].mainEntity as { name: string }[];
    expect(faq.map((q) => q.name)).toEqual(lerFaq(SOBRE_FAQ).faq.map((f) => f.pergunta));
    expect(faq.length).toBeGreaterThanOrEqual(2);
    expect(ld[3]).toEqual({
      "@context": "https://schema.org", "@type": "Person", "@id": "https://ascende.site/sobre#autor",
      name: "Henrique Pett", jobTitle: "Fundador do Ascende", url: "https://ascende.site/sobre#autor",
      worksFor: { "@type": "Organization", "@id": "https://ascende.site/#organization", name: "Ascende", url: "https://ascende.site/" },
    });
  });

  it("a home não ganha nada (o JSON-LD dela está no index.html)", () => {
    expect(jsonLdDaPagina(pg("/"))).toEqual([]);
  });

  it("comJsonLd: no fim do <head>, JSON válido, '<' neutralizado", () => {
    const html = comJsonLd("<html><head><title>x</title>\n  </head><body></body></html>", [{ a: "</script>" }]);
    expect(html).toContain('<script type="application/ld+json">{"a":"\\u003c/script>"}</script>\n  </head>');
  });

  it("/sobre desenha #autor e #perguntas-frequentes, e o texto do autor é só fato", async () => {
    const m = await renderizarRota("/sobre");
    expect(m).toMatch(/<section id="autor"[^>]*>[\s\S]*?<h2[^>]*>Quem escreve o blog<\/h2>/);
    expect(m).toMatch(/<section id="perguntas-frequentes"[^>]*>[\s\S]*?<h2[^>]*>Perguntas frequentes<\/h2>/);
    expect(SOBRE).toContain("**Henrique Pett, fundador do Ascende**");
    expect(SOBRE).not.toMatch(/especialista|revisado por|nutricionista formado|PhD|Dr\./i);
  });
});
