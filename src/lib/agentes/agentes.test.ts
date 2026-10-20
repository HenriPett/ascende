/**
 * Agentes: negociação de Markdown (q-values, 404, Vary), o conversor de HTML
 * das páginas em JSX, e o /llms.txt (formato llmstxt.org, seção de posts
 * gerada no build).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAMINHOS_EXCLUIDOS, destinoMarkdown, negociar, prefereMarkdown, qualidade,
} from "@/lib/agentes/negociacao";
import { htmlParaMarkdown, linksAbsolutos } from "@/lib/agentes/htmlParaMarkdown";
import { gerarLlmsTxt } from "@/lib/agentes/llms";

const RAIZ = join(__dirname, "..", "..", "..");

describe("Accept: qualidade e preferência (RFC 9110, q-values)", () => {
  it("a faixa mais específica vence", () => {
    expect(qualidade("text/*;q=0.3, text/markdown;q=0.8, */*;q=0.1", "text/markdown")).toBe(0.8);
    expect(qualidade("text/*;q=0.3, */*;q=0.1", "text/markdown")).toBe(0.3);
    expect(qualidade("*/*;q=0.1", "text/html")).toBe(0.1);
    expect(qualidade("application/json", "text/html")).toBe(0);
    expect(qualidade(null, "text/html")).toBe(1);
  });

  it.each([
    ["text/markdown", true],
    ["text/markdown, text/html;q=0.9", true],
    ["text/html;q=0.5, text/markdown;q=0.9", true],
    ["text/markdown, text/html", true], // empate explícito: pediu pelo nome
    ["text/x-markdown", true],
    ["TEXT/MARKDOWN; charset=utf-8", true],
    ["text/html, text/markdown;q=0.5", false],
    ["text/markdown;q=0", false],
    ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", false], // navegador
    ["*/*", false], // curl
    ["text/*", false],
    ["", false],
    [null, false],
    ["text/markdown;q=abc, text/html", false], // q inválido conta como 0
    ["text/markdown;q=0, */*", false], // recusa explícita: o curinga não a desfaz
    ["text/markdown;q=0, text/*", false],
    ["text/markdown;q=0.5, text/html;q=0.9, */*", false], // prefere HTML
    ["text/x-markdown;q=0, text/markdown", true],
  ])("%s → markdown? %s", (accept, esperado) => {
    expect(prefereMarkdown(accept)).toBe(esperado);
  });
});

describe("o .md de cada caminho (só o mapa conhecido)", () => {
  it.each([
    ["/", "/index.md"],
    ["/privacidade", "/privacidade.md"],
    ["/privacidade/", "/privacidade.md"],
    ["/sobre", "/sobre.md"],
    ["/blog", "/blog/index.md"],
    ["/blog/", "/blog/index.md"],
    ["/blog/um-post/", "/blog/um-post/index.md"],
    ["/blog/um-post", "/blog/um-post/index.md"],
  ])("%s → %s", (caminho, md) => {
    expect(destinoMarkdown(caminho)).toEqual({ tipo: "md", alvo: md });
  });

  it("arquivo (com extensão) segue como é", () => {
    for (const c of ["/llms.txt", "/sitemap.xml", "/icon-512.png", "/blog/feed.xml"]) {
      expect(destinoMarkdown(c), c).toEqual({ tipo: "arquivo" });
    }
  });

  it("fora do mapa, ou estranho, é desconhecido (404 em Markdown, sem buscar nada)", () => {
    for (const c of [
      "/nao-existe", "/app", "/privacidade/x", "/blog/Um_Post/", "/blog/a/b/",
      "//evil.example/x", "/%2F%2Fevil.example%2Fx", "/%2f%2fevil.example", "/%5Cevil.example%2Fx", "/\\evil.example",
      "/@evil.example", "/%40evil.example", "/a/../b", "/%2E%2E/x", "/privacidade%3F", "/privacidade%23x",
      "/%252F%252Fevil.example", "/%E0%A4%A", "/x%00", "/ privacidade", "https://evil.example/x",
    ]) {
      expect(destinoMarkdown(c), c).toEqual({ tipo: "desconhecido" });
    }
  });
});

describe("negociar (a edge function inteira)", () => {
  const site: Record<string, string> = {
    "/index.md": "# Ascende\n\nO app.\n",
    "/privacidade.md": "# Política de Privacidade\n\nTexto.\n",
    "/blog/um-post/index.md": "# Um post\n",
    "/404.md": "# Página não encontrada\n\nLinks.\n",
  };
  const buscar = async (u: URL) =>
    site[u.pathname] !== undefined ? new Response(site[u.pathname], { status: 200 }) : new Response("<html>404</html>", { status: 404 });
  const html = async () => new Response("<!doctype html><h1>HTML</h1>", { status: 200, headers: { "content-type": "text/html", vary: "Accept-Encoding" } });
  const req = (caminho: string, accept: string | null, method = "GET") =>
    new Request(`https://ascende.site${caminho}`, { method, headers: accept ? { accept } : {} });

  it("pede Markdown → 200, text/markdown; charset=utf-8, Vary: Accept, corpo não vazio, canonical no Link", async () => {
    const r = await negociar(req("/privacidade", "text/markdown"), html, buscar);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(r.headers.get("vary")).toBe("Accept");
    expect(r.headers.get("link")).toBe('<https://ascende.site/privacidade>; rel="canonical"');
    expect(await r.text()).toBe(site["/privacidade.md"]);
  });

  it("home e post do blog", async () => {
    expect(await (await negociar(req("/", "text/markdown"), html, buscar)).text()).toContain("# Ascende");
    expect(await (await negociar(req("/blog/um-post/", "text/markdown;q=1, text/html;q=0.5"), html, buscar)).text()).toBe("# Um post\n");
  });

  it("caminho desconhecido + Markdown → 404 com o 404.md, em text/markdown", async () => {
    const r = await negociar(req("/nao-existe", "text/markdown"), html, buscar);
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await r.text()).toBe(site["/404.md"]);
  });

  it("REGRESSÃO (proxy aberto): nenhum caminho faz a edge buscar fora da própria origem", async () => {
    const pedidos: string[] = [];
    const espiao = async (u: URL) => { pedidos.push(u.toString()); return buscar(u); };
    for (const c of ["/%2F%2Fevil.example%2Fx", "/%5Cevil.example%2Fx", "/%5C%5Cevil.example/x", "/%2F%2F127.0.0.1%2Fadmin",
      "/@evil.example/x", "/%40evil.example", "/..%2F..%2Fx", "/%252F%252Fevil.example", "/blog/%2F%2Fevil.example/"]) {
      const r = await negociar(req(c, "text/markdown"), html, espiao);
      expect(r.status, c).toBe(404);
      expect(r.headers.get("link"), c).toBeNull();
      expect(await r.text(), c).toBe(site["/404.md"]);
    }
    expect(pedidos.length).toBeGreaterThan(0);
    for (const p of pedidos) expect(new URL(p).origin, p).toBe("https://ascende.site");
    expect(new Set(pedidos)).toEqual(new Set(["https://ascende.site/404.md"]));
  });

  it("sem nem o 404.md, ainda responde 404 em Markdown não vazio", async () => {
    const r = await negociar(req("/nao-existe", "text/markdown"), html, async () => new Response("", { status: 404 }));
    expect(r.status).toBe(404);
    expect((await r.text()).length).toBeGreaterThan(20);
  });

  it("HEAD com Markdown: cabeçalhos sem corpo", async () => {
    const r = await negociar(req("/privacidade", "text/markdown", "HEAD"), html, buscar);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/markdown/);
    expect(await r.text()).toBe("");
  });

  it("navegador (text/html) → a resposta de sempre, acrescida de Vary: Accept", async () => {
    const r = await negociar(req("/privacidade", "text/html,*/*;q=0.8"), html, buscar);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html");
    expect(r.headers.get("vary")).toBe("Accept-Encoding, Accept");
    expect(await r.text()).toContain("<h1>HTML</h1>");
  });

  it("Vary que já tem Accept não duplica; POST nunca vira Markdown", async () => {
    const comVary = async () => new Response("x", { headers: { vary: "accept" } });
    expect((await negociar(req("/", "text/html"), comVary, buscar)).headers.get("vary")).toBe("accept");
    const r = await negociar(req("/", "text/markdown", "POST"), html, buscar);
    expect(r.headers.get("content-type")).toBe("text/html");
  });

  it("arquivo com extensão segue para o Netlify mesmo pedindo Markdown", async () => {
    const r = await negociar(req("/llms.txt", "text/markdown"), () => Promise.resolve(new Response("llms")), buscar);
    expect(await r.text()).toBe("llms");
  });
});

describe("a edge function", () => {
  const edge = readFileSync(join(RAIZ, "netlify", "edge-functions", "markdown.ts"), "utf8");

  it("só cola: importa a negociação deste módulo e roda em /* menos os excluídos", () => {
    expect(edge).toContain('from "../../src/lib/agentes/negociacao.ts"');
    expect(edge).toMatch(/path:\s*"\/\*"/);
    expect(edge).toContain("excludedPath: CAMINHOS_EXCLUIDOS");
  });

  it("não roda na SPA autenticada, nos assets nem nos próprios .md", () => {
    for (const c of ["/app", "/app/*", "/auth", "/auth/*", "/onboarding", "/assets/*", "/*.md", "/*.txt", "/about", "/privacy"]) {
      expect(CAMINHOS_EXCLUIDOS).toContain(c);
    }
  });
});

describe("HTML pré-renderizado → Markdown", () => {
  const B = "https://ascende.site";

  it("títulos, parágrafos, listas, links absolutos e ênfase", () => {
    const html = '<main><h1>O <em>app</em></h1><p>Texto com <strong>força</strong> e <a href="/recusas">recusas</a>.</p>'
      + '<ul><li>um</li><li><p>dois</p></li></ul><ol><li>a</li><li>b</li></ol>'
      + '<blockquote><p>citação</p></blockquote><p>Externo: <a href="https://ibge.gov.br/x?a=1&amp;b=2">IBGE</a></p></main>';
    expect(htmlParaMarkdown(html, B)).toBe(
      "# O _app_\n\nTexto com **força** e [recusas](https://ascende.site/recusas).\n\n- um\n- dois\n\n1. a\n2. b\n\n> citação\n\n"
      + "Externo: [IBGE](https://ibge.gov.br/x?a=1&b=2)\n",
    );
  });

  it("descarta svg, botão, script, aria-hidden e o atributo hidden — mas não a classe 'hidden' do Tailwind", () => {
    const html = '<div><svg><title>ícone</title></svg><button>Clique</button><script>x()</script>'
      + '<span aria-hidden="true">•</span><p hidden="">escondido</p><p class="hidden md:block">visível no desktop</p><p>fica</p></div>';
    expect(htmlParaMarkdown(html, B)).toBe("visível no desktop\n\nfica\n");
  });

  it("sem a moldura do site (header, nav); links lado a lado não colam; <ol> com número desenhado não duplica", () => {
    const html = '<header><a href="/">Ascende</a></header><nav><a href="/auth">Entrar</a></nav>'
      + '<div><a href="/auth">Começar</a><span>Conta grátis</span></div>'
      + '<ol><li><div>1</div><h2>Nunca vender</h2><p>Detalhe.</p></li></ol><footer><p>Aviso.</p></footer>';
    expect(htmlParaMarkdown(html, B)).toBe(
      "[Começar](https://ascende.site/auth) Conta grátis\n\n1. ## Nunca vender\n\n   Detalhe.\n\nAviso.\n",
    );
  });

  it("<br> dentro de título vira espaço (título é uma linha); '•' desenhado no <li> não duplica o marcador", () => {
    expect(htmlParaMarkdown("<h2>Batalhas: para o que rouba<br/>seu dinheiro.</h2><ul><li>• Captura</li><li>· Outra</li></ul>", B))
      .toBe("## Batalhas: para o que rouba seu dinheiro.\n\n- Captura\n- Outra\n");
  });

  it("Markdown escrito à mão ganha links absolutos (e externo fica como está)", () => {
    expect(linksAbsolutos("Veja [recusas](/recusas), [início](/) e [IBGE](https://ibge.gov.br/) e [x](//cdn.x)", B))
      .toBe("Veja [recusas](https://ascende.site/recusas), [início](https://ascende.site/) e [IBGE](https://ibge.gov.br/) e [x](//cdn.x)");
  });

  it("entidades e texto solto entre blocos", () => {
    expect(htmlParaMarkdown("<div>Tom &amp; Jerry &#8212; <b>já</b><p>depois</p>fim</div>", B))
      .toBe("Tom & Jerry — **já**\n\ndepois\n\nfim\n");
  });
});

describe("/llms.txt (llmstxt.org)", () => {
  const base = readFileSync(join(RAIZ, "src", "lib", "agentes", "llms.txt"), "utf8");
  const posts = [
    { title: "Post novo [com colchete]", url: "https://ascende.site/blog/novo/", description: "O mais novo." },
    { title: "Post velho", url: "https://ascende.site/blog/velho/", description: "O mais antigo." },
  ];
  const txt = gerarLlmsTxt(base, posts);

  it("formato: H1, blockquote, parágrafos, e só seções H2 com listas de links", () => {
    const linhas = txt.split("\n");
    expect(linhas[0]).toBe("# Ascende");
    expect(linhas[1]).toBe("");
    expect(linhas[2]).toMatch(/^> \S/);
    expect(txt.match(/^# /gm)).toHaveLength(1);
    const secoes = txt.split(/^## /m).slice(1);
    expect(secoes.map((s) => s.split("\n")[0])).toEqual(["Páginas principais", "Quando usar", "Como um agente deve usar", "Optional"]);
    // Antes da 1ª seção: só parágrafos (nada de lista ou título).
    const intro = txt.slice(0, txt.indexOf("\n## "));
    expect(intro).not.toMatch(/^[-*] |^#{2,} /m);
    // Nas seções de links, todo item é "- [nome](url): descrição".
    for (const s of [secoes[0], secoes[3]]) {
      for (const item of s.split("\n").slice(1).filter((l) => l.trim())) {
        expect(item).toMatch(/^- \[[^\]]+(?:\\\][^\]]*)*\]\(https:\/\/ascende\.site\/[^)\s]*\): \S/);
      }
    }
  });

  it("a seção Optional termina com um link por post, na ordem recebida (mais novo primeiro), e o resto é literal", () => {
    expect(txt.startsWith(base.trimEnd())).toBe(true);
    expect(txt.endsWith(
      "- [Post novo \\[com colchete\\]](https://ascende.site/blog/novo/): O mais novo.\n"
      + "- [Post velho](https://ascende.site/blog/velho/): O mais antigo.\n",
    )).toBe(true);
  });

  it("sem post (sem blog), a seção Optional sai inteira — e não sobra link para o blog nela", () => {
    const vazio = gerarLlmsTxt(base, []);
    expect(vazio).not.toContain("## Optional");
    expect(vazio).not.toContain("feed.xml");
    expect(vazio.endsWith("\n")).toBe(true);
  });

  it("anuncia o que o deploy entrega: /sobre, text/markdown, sitemap — e não promete API", () => {
    expect(txt).toContain("https://ascende.site/sobre");
    expect(txt).toContain("Accept: text/markdown");
    expect(txt).toContain("https://ascende.site/sitemap.xml");
    expect(txt).toContain("## Quando usar");
    expect(txt).toMatch(/Não há API pública/);
  });
});
