/* ASCENDE — Testes do pipeline do blog (dados, checagem, sitemap, RSS,
 * histórico e a regra do zero).
 *
 * As fixtures moram em src/lib/blog/fixtures/posts e NUNCA em content/blog:
 * scripts/blog.mjs recusa levá-las para dist/. Elas só existem aqui e no
 * preview (`npm run blog:preview` → dist-preview/).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  dataValida, errosDoCorpo, hojeEmSaoPaulo, lerPost, normalizarIntencao, placeholders,
} from "@/lib/blog/post";
import { checarColecao, type ArquivoDePost } from "@/lib/blog/checagem";
import { atualizarIndice, gerarIndice, lerIndice } from "@/lib/blog/indice";
import { dataRfc822, gerarFeed, gerarSitemap, PAGINAS_PUBLICAS } from "@/lib/blog/sitemap";
import { cssDoIndex, gerarBlog, type Templates } from "@/lib/blog/pipeline";
import * as render from "@/blog/render";

const HOJE = "2026-10-14";
const PASTA = join(__dirname, "fixtures", "posts");
const fixtures = (): ArquivoDePost[] =>
  readdirSync(PASTA).filter((n) => n.endsWith(".md") && n !== "INDICE.md").sort()
    .map((nome) => ({ nome, texto: readFileSync(join(PASTA, nome), "utf8") }));
const indiceDasFixtures = () => readFileSync(join(PASTA, "INDICE.md"), "utf8");
const CTX = { siteUrl: "https://ascende.site", cssHrefs: ["/assets/index-teste.css"] };

/** Um post válido mínimo, com campos sobrescrevíveis, para testar UMA regra por vez. */
function post(campos: Record<string, string> = {}, corpo = "Texto.\n\n## Seção\n\nMais texto.\n") {
  const base: Record<string, string> = {
    title: "Um título com tamanho suficiente",
    description: "Uma descrição com tamanho suficiente para passar no limite mínimo de setenta caracteres.",
    slug: "um-post",
    datePublished: "2026-10-01",
    intent: "como testar o pipeline do blog",
    cluster: "rotina-integrada",
    sources: "\n  - title: Fonte\n    url: https://www.gov.br/\n    publisher: Gov\n    accessed: 2026-09-30",
    ...campos,
  };
  const yaml = Object.entries(base).filter(([, v]) => v !== "__omitir__")
    .map(([k, v]) => (v.startsWith("\n") ? `${k}:${v}` : `${k}: ${v}`)).join("\n");
  return `---\n${yaml}\n---\n${corpo}`;
}
const erros = (texto: string, nome = "um-post.md") => lerPost(nome, texto, HOJE).erros;

// ─── 1. Um post sozinho ─────────────────────────────────────────────────

describe("um post: o esquema estrito do frontmatter", () => {
  it("o post mínimo válido passa e sai com as URLs canônicas com barra final", () => {
    const { post: p, erros: e } = lerPost("um-post.md", post(), HOJE);
    expect(e).toEqual([]);
    expect(p?.caminho).toBe("/blog/um-post/");
    expect(p?.url).toBe("https://ascende.site/blog/um-post/");
    expect(p?.productPath).toBe("/");
    expect(p?.related).toEqual([]);
  });

  it("chave proibida é recusada pelo NOME, com o porquê (não existe autor-pessoa nem revisão)", () => {
    for (const k of ["author", "reviewedBy", "medicalReview", "rating", "image"]) {
      expect(erros(post({ [k]: "x" })).join(" ")).toMatch(new RegExp(`chave proibida '${k}'`));
    }
    expect(erros(post({ outra: "x" })).join(" ")).toMatch(/chave desconhecida 'outra'/);
  });

  it("cada obrigatória faz falta", () => {
    for (const k of ["title", "description", "slug", "datePublished", "intent", "cluster", "sources"]) {
      expect(erros(post({ [k]: "__omitir__" })).join(" ")).toContain(`falta '${k}'`);
    }
  });

  it("limites de tamanho: title 20–90, description 70–160, intent 10–140", () => {
    expect(erros(post({ title: "Curto demais" })).join(" ")).toMatch(/title tem 12/);
    expect(erros(post({ description: "Curta." })).join(" ")).toMatch(/description tem 6/);
    expect(erros(post({ intent: "curta" })).join(" ")).toMatch(/intent tem 5/);
  });

  it("title > 55 exige seoTitle de até 55 (o <title> é seoTitle ?? title)", () => {
    const longo = "Um título bem comprido que passa de cinquenta e cinco caracteres no total";
    expect(erros(post({ title: longo })).join(" ")).toMatch(/defina um seoTitle/);
    expect(erros(post({ title: longo, seoTitle: "Título curto" }))).toEqual([]);
    expect(erros(post({ seoTitle: "x".repeat(56) })).join(" ")).toMatch(/seoTitle tem 56/);
  });

  it("slug: padrão, até 60, e igual ao nome do arquivo", () => {
    expect(erros(post({ slug: "Com Espaco" })).join(" ")).toMatch(/fora do padrão/);
    expect(erros(post({ slug: "outro" })).join(" ")).toMatch(/diferente do nome do arquivo/);
    const sessenta1 = "a".repeat(61);
    expect(erros(post({ slug: sessenta1 }), `${sessenta1}.md`).join(" ")).toMatch(/até 60/);
  });

  it("datas: dia real de calendário, nunca no futuro de São Paulo, modificação depois da publicação", () => {
    expect(erros(post({ datePublished: "2026-02-30" })).join(" ")).toMatch(/não é uma data real/);
    expect(erros(post({ datePublished: "2026-10-15" })).join(" ")).toMatch(/está no futuro/);
    expect(erros(post({ dateModified: "2026-09-01" })).join(" ")).toMatch(/tem de ser depois/);
    expect(erros(post({ dateModified: "2026-10-14" }))).toEqual([]);
    expect(dataValida("2028-02-29")).toBe(true);
    expect(dataValida("2027-02-29")).toBe(false);
  });

  it("'hoje' é o dia de São Paulo: 22h de 14/10 em Brasília ainda é 14/10 (em UTC já seria 15)", () => {
    expect(hojeEmSaoPaulo(new Date("2026-10-15T01:00:00Z"))).toBe("2026-10-14");
    expect(hojeEmSaoPaulo(new Date("2026-10-15T03:30:00Z"))).toBe("2026-10-15");
  });

  it("a data no YAML continua string — o esquema padrão viraria Date e passaria pelo fuso", () => {
    const p = lerPost("um-post.md", post(), HOJE).post!;
    expect(typeof p.datePublished).toBe("string");
    expect(p.datePublished).toBe("2026-10-01");
  });

  it("cluster e productPath fechados", () => {
    expect(erros(post({ cluster: "outro" })).join(" ")).toMatch(/cluster 'outro' não existe/);
    expect(erros(post({ productPath: "/app" })).join(" ")).toMatch(/productPath '\/app' não existe/);
    expect(erros(post({ productPath: "/recusas" }))).toEqual([]);
  });

  it("fontes: pelo menos 1, https, sem repetir, accessed real e não futura", () => {
    expect(erros(post({ sources: "[]" })).join(" ")).toMatch(/pelo menos 1 fonte/);
    const fonte = (url: string, acc = "2026-09-30") =>
      `\n  - title: F\n    url: ${url}\n    publisher: P\n    accessed: ${acc}`;
    expect(erros(post({ sources: fonte("http://inseguro.com.br") })).join(" ")).toMatch(/https/);
    expect(erros(post({ sources: fonte("https://a.br") + fonte("https://a.br") })).join(" ")).toMatch(/repetida/);
    expect(erros(post({ sources: fonte("https://a.br", "2026-12-01") })).join(" ")).toMatch(/futuro/);
  });

  it("related: até 3, sem repetir, sem o próprio", () => {
    expect(erros(post({ related: "[a, b, c, d]" })).join(" ")).toMatch(/no máximo 3/);
    expect(erros(post({ related: "[a, a]" })).join(" ")).toMatch(/repetido/);
    expect(erros(post({ related: "[um-post]" })).join(" ")).toMatch(/próprio post/);
  });
});

describe("um post: o corpo", () => {
  it("o H1 é o title: '# ' no corpo é recusado; ## e ### passam; pular nível e h4+ não", () => {
    expect(errosDoCorpo("# Título\n")).toEqual([expect.stringMatching(/o H1 é o title/)]);
    expect(errosDoCorpo("## A\n\n### B\n\n## C\n")).toEqual([]);
    expect(errosDoCorpo("### Direto\n").join(" ")).toMatch(/pulou nível/);
    expect(errosDoCorpo("## A\n\n### B\n\n#### C\n").join(" ")).toMatch(/h4 não existe no template/);
  });

  it("dentro de bloco de código, '#' não é título", () => {
    expect(errosDoCorpo("Texto.\n\n```\n# comentário de shell\n```\n")).toEqual([]);
  });

  it("imagem não é suportada (sairia como texto literal)", () => {
    expect(errosDoCorpo("Veja ![foto](/x.png)\n").join(" ")).toMatch(/imagem não é suportada/);
  });

  it("placeholder: 'TODO' maiúsculo é erro, 'todo dia' e 'todos' são português", () => {
    expect(placeholders("Revisar isto TODO")).toHaveLength(1);
    expect(placeholders("Todo dia conta, e todos os gastos entram.")).toEqual([]);
    for (const p of ["lorem ipsum", "[inserir dado]", "PLACEHOLDER", "https://example.com", "exemplo.com", "TBD", "FIXME", "XXX"]) {
      expect(placeholders(p).length, p).toBeGreaterThan(0);
    }
    // vale também no frontmatter
    expect(erros(post({ description: "Uma descrição TODO com tamanho suficiente para passar no limite de setenta." })).join(" "))
      .toMatch(/marcador de texto não pronto 'TODO'/);
  });

  it("intenção normalizada: acento, caixa e pontuação não fazem duas intenções diferentes", () => {
    expect(normalizarIntencao("Como fazer o MERCADO caber no orçamento?"))
      .toBe(normalizarIntencao("como   fazer o mercado caber no orcamento"));
  });
});

// ─── 2. A coleção ───────────────────────────────────────────────────────

describe("a coleção de fixtures", () => {
  it("passa inteira, ordenada do mais novo (slug desempata)", () => {
    const { posts, erros: e } = checarColecao(fixtures(), lerIndice(indiceDasFixtures()), HOJE);
    expect(e).toEqual([]);
    expect(posts.map((p) => p.slug)).toEqual([
      "mercado-no-orcamento-do-mes", "privacidade-do-conselheiro", "rotina-de-registro-em-uma-frase",
    ]);
  });

  it("intenção repetida entre dois posts é recusada", () => {
    const a = { nome: "a-post.md", texto: post({ slug: "a-post", intent: "Como TESTAR o pipeline do blog?" }) };
    const b = { nome: "b-post.md", texto: post({ slug: "b-post" }) };
    const ind = atualizarIndice([], [lerPost(a.nome, a.texto, HOJE).post!, lerPost(b.nome, b.texto, HOJE).post!]);
    expect(checarColecao([a, b], ind, HOJE).erros.join(" ")).toMatch(/repete a de/);
  });

  it("intenção de um post que JÁ SAIU (histórico) não volta com outro slug", () => {
    const indice = [{ slug: "antigo", intent: "como testar o pipeline do blog", cluster: "rotina-integrada" as const, datePublished: "2026-08-01" }];
    const novo = { nome: "um-post.md", texto: post() };
    const r = checarColecao([novo], [...indice, { ...indice[0], slug: "um-post", intent: "outra coisa qualquer" }], HOJE);
    expect(r.erros.join(" ")).toMatch(/já foi respondida por 'antigo'/);
  });

  it("slug publicado que sumiu é erro (URL que já saiu não some em silêncio)", () => {
    const indice = lerIndice(indiceDasFixtures());
    const semUm = fixtures().filter((a) => a.nome !== "privacidade-do-conselheiro.md");
    expect(checarColecao(semUm, indice, HOJE).erros.join(" ")).toMatch(/'privacidade-do-conselheiro' foi publicado e o arquivo sumiu/);
  });

  it("post fora do INDICE, ou INDICE desatualizado, pede blog:indice", () => {
    expect(checarColecao([{ nome: "um-post.md", texto: post() }], [], HOJE).erros.join(" "))
      .toMatch(/não está no INDICE.md/);
    const indice = lerIndice(indiceDasFixtures()).map((l) =>
      l.slug === "rotina-de-registro-em-uma-frase" ? { ...l, intent: "intenção velha do índice" } : l);
    expect(checarColecao(fixtures(), indice, HOJE).erros.join(" ")).toMatch(/INDICE.md está desatualizado/);
  });

  it("data de publicação de post publicado não muda (mudança vai em dateModified)", () => {
    const indice = lerIndice(indiceDasFixtures()).map((l) =>
      l.slug === "rotina-de-registro-em-uma-frase" ? { ...l, datePublished: "2026-08-15" } : l);
    expect(checarColecao(fixtures(), indice, HOJE).erros.join(" ")).toMatch(/datePublished de post publicado não muda/);
  });

  it("related e links internos só para o que existe; externo só https", () => {
    const corpo = "Veja [a](/blog/nao-existe/), [b](/app), [c](http://x.com.br), [d](relativo), [e](/recusas#topo), [f](https://ok.com.br).\n\n## S\n";
    const a = { nome: "um-post.md", texto: post({ related: "[fantasma]" }, corpo) };
    const r = checarColecao([a], atualizarIndice([], [lerPost(a.nome, post(), HOJE).post!]), HOJE);
    const txt = r.erros.join("\n");
    expect(txt).toMatch(/related 'fantasma' não existe/);
    expect(txt).toMatch(/'\/blog\/nao-existe\/' não resolve/);
    expect(txt).toMatch(/'\/app' não resolve/);
    expect(txt).toMatch(/'http:\/\/x.com.br' tem de ser https/);
    expect(txt).toMatch(/'relativo' tem de ser https/);
    expect(txt).not.toMatch(/recusas#topo/);
    expect(txt).not.toMatch(/ok\.com\.br/);
  });
});

describe("o INDICE", () => {
  it("ida e volta: gerar e ler devolve as mesmas linhas, com '|' na intenção escapado", () => {
    const linhas = [{ slug: "a", intent: "custo | benefício", cluster: "ia-privacidade" as const, datePublished: "2026-09-01", dateModified: "2026-09-02" }];
    expect(lerIndice(gerarIndice(linhas))).toEqual(linhas);
  });

  it("atualizar mantém o histórico e a data de publicação original", () => {
    const antigo = [{ slug: "um-post", intent: "x", cluster: "rotina-integrada" as const, datePublished: "2026-09-01" },
      { slug: "removido", intent: "y", cluster: "rotina-integrada" as const, datePublished: "2026-08-01" }];
    const p = lerPost("um-post.md", post(), HOJE).post!;
    const novo = atualizarIndice(antigo, [p]);
    expect(novo.find((l) => l.slug === "um-post")?.datePublished).toBe("2026-09-01");
    expect(novo.some((l) => l.slug === "removido")).toBe(true);
  });

  it("o INDICE das fixtures está em dia com elas (o mesmo check do build)", () => {
    const posts = checarColecao(fixtures(), lerIndice(indiceDasFixtures()), HOJE).posts;
    expect(gerarIndice(atualizarIndice(lerIndice(indiceDasFixtures()), posts))).toBe(indiceDasFixtures());
  });
});

// ─── 3. Sitemap e RSS ───────────────────────────────────────────────────

describe("sitemap e RSS", () => {
  it("com 0 posts o sitemap é BYTE A BYTE o public/sitemap.xml de antes (as 5 URLs)", () => {
    const antes = readFileSync(join(__dirname, "fixtures", "sitemap-de-antes.xml"), "utf8");
    expect(gerarSitemap([])).toBe(antes);
    expect(PAGINAS_PUBLICAS.map((p) => p.caminho)).toEqual(["/", "/recusas", "/privacidade", "/termos", "/aviso-legal"]);
  });

  it("com posts: as 5 de sempre + /blog/ + cada post, lastmod com data real (modificação se houver)", () => {
    const { posts } = checarColecao(fixtures(), lerIndice(indiceDasFixtures()), HOJE);
    const xml = gerarSitemap(posts);
    expect((xml.match(/<loc>/g) ?? []).length).toBe(5 + 1 + 3);
    expect(xml).toContain("<loc>https://ascende.site/blog/</loc>\n    <lastmod>2026-09-20</lastmod>");
    expect(xml).toContain("<loc>https://ascende.site/blog/mercado-no-orcamento-do-mes/</loc>\n    <lastmod>2026-09-20</lastmod>");
    expect(xml).toContain("<loc>https://ascende.site/blog/rotina-de-registro-em-uma-frase/</loc>\n    <lastmod>2026-09-01</lastmod>");
    for (const p of PAGINAS_PUBLICAS) expect(xml).toContain(`<loc>https://ascende.site${p.caminho}</loc>`);
  });

  it("RSS: um item por post, datas RFC 822 do dia real, título escapado", () => {
    expect(dataRfc822("2026-10-14")).toBe("Wed, 14 Oct 2026 00:00:00 -0300");
    const { posts } = checarColecao(fixtures(), lerIndice(indiceDasFixtures()), HOJE);
    const feed = gerarFeed(posts);
    expect((feed.match(/<item>/g) ?? []).length).toBe(3);
    expect(feed).toContain("<guid isPermaLink=\"true\">https://ascende.site/blog/privacidade-do-conselheiro/</guid>");
    expect(feed).toContain("&quot;duplas&quot;");
    // A MESMA frase da listagem (uma constante só, DESCRICAO_DO_BLOG).
    expect(feed).toContain("<description>Rotina, comida que cabe no orçamento e IA com privacidade — com as fontes de cada texto.</description>");
  });
});

// ─── 4. O pipeline inteiro ──────────────────────────────────────────────

const falsos: Templates = {
  renderListagem: (ps) => `LISTA:${ps.map((p) => p.slug).join(",")}`,
  renderArtigo: (p, rel) => `ARTIGO:${p.slug}:${rel.map((r) => r.slug).join(",")}`,
  TEMA_JS: "/* tema */",
  CAMINHO_DO_TEMA: "/blog/tema.js",
};

describe("o pipeline", () => {
  it("A REGRA DO ZERO: sem post, só o sitemap das 5 — nada de blog/, feed ou listagem", () => {
    const out = gerarBlog({ arquivos: [], indice: null, hoje: HOJE, ctx: CTX, templates: falsos });
    expect(out.erros).toEqual([]);
    expect(Object.keys(out.arquivos)).toEqual(["sitemap.xml"]);
    expect(out.arquivos["sitemap.xml"]).not.toContain("/blog");
  });

  it("com as fixtures: listagem, um index.html por post, feed, tema e sitemap", () => {
    const out = gerarBlog({ arquivos: fixtures(), indice: indiceDasFixtures(), hoje: HOJE, ctx: CTX, templates: falsos });
    expect(out.erros).toEqual([]);
    expect(Object.keys(out.arquivos).sort()).toEqual([
      "blog/feed.xml", "blog/index.html",
      "blog/mercado-no-orcamento-do-mes/index.html", "blog/privacidade-do-conselheiro/index.html",
      "blog/rotina-de-registro-em-uma-frase/index.html", "blog/tema.js", "sitemap.xml",
    ]);
    expect(out.arquivos["blog/mercado-no-orcamento-do-mes/index.html"])
      .toBe("ARTIGO:mercado-no-orcamento-do-mes:rotina-de-registro-em-uma-frase");
  });

  it("um erro na coleção não publica NADA — nem os posts certos", () => {
    const quebrado = [...fixtures(), { nome: "ruim.md", texto: "sem frontmatter" }];
    const out = gerarBlog({ arquivos: quebrado, indice: indiceDasFixtures(), hoje: HOJE, ctx: CTX, templates: falsos });
    expect(out.erros.length).toBeGreaterThan(0);
    expect(out.arquivos).toEqual({});
  });

  it("com os templates DE VERDADE (src/blog/render.tsx): HTML completo, sem script inline executável", () => {
    const out = gerarBlog({ arquivos: fixtures(), indice: indiceDasFixtures(), hoje: HOJE, ctx: CTX, templates: render });
    const artigo = out.arquivos["blog/mercado-no-orcamento-do-mes/index.html"];
    expect(artigo.startsWith("<!doctype html>")).toBe(true);
    expect(artigo).toContain('<link rel="canonical" href="https://ascende.site/blog/mercado-no-orcamento-do-mes/"/>');
    expect(artigo).toContain('href="/assets/index-teste.css"');
    expect(artigo).toContain("Antes do mercado"); // o corpo está no HTML servido
    expect(artigo).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(artigo).not.toContain("<script>alert");
    // Só JSON-LD (não executa) e o tema externo da mesma origem.
    const scripts = [...artigo.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    for (const s of scripts) expect(s).toMatch(/type="application\/ld\+json"|src="\/blog\/tema\.js"/);
    expect(out.arquivos["blog/tema.js"]).toBe(render.TEMA_JS);
  });

  it("o CSS vem dos <link rel=stylesheet> do index.html da SPA", () => {
    const html = '<link rel="icon" href="/f.svg"><link rel="stylesheet" crossorigin href="/assets/index-A.css"><link rel=stylesheet href="/assets/b.css">';
    expect(cssDoIndex(html)).toEqual(["/assets/index-A.css", "/assets/b.css"]);
  });
});

// ─── 5. As travas fora do código do blog ────────────────────────────────

describe("as travas que o blog depende e que moram em outros arquivos", () => {
  const raiz = join(__dirname, "..", "..", "..");
  it("o Netlify não força o catch-all (senão todo artigo viraria o shell da SPA)", () => {
    const toml = readFileSync(join(raiz, "netlify.toml"), "utf8");
    const regra = toml.slice(toml.indexOf("[[redirects]]"), toml.indexOf("[[headers]]"));
    expect(regra).toContain('from = "/*"');
    expect(regra).not.toMatch(/^\s*force\s*=\s*true/m);
  });

  it("o service worker não intercepta /blog (não grava artigo no lugar do shell da SPA)", () => {
    const sw = readFileSync(join(raiz, "public", "sw.js"), "utf8");
    const pula = sw.indexOf('url.pathname.startsWith("/blog/")');
    expect(pula).toBeGreaterThan(0);
    expect(pula).toBeLessThan(sw.indexOf('request.mode === "navigate"'));
  });

  it("o sitemap estático saiu de public/ (uma lista só: PAGINAS_PUBLICAS)", () => {
    expect(readdirSync(join(raiz, "public"))).not.toContain("sitemap.xml");
  });

  it("content/blog não tem fixture nem post de teste: só o que é para publicar", () => {
    const nomes = readdirSync(join(raiz, "content", "blog"));
    const daFixture = readdirSync(PASTA).filter((n) => n !== "INDICE.md");
    for (const n of daFixture) expect(nomes).not.toContain(n);
  });
});
