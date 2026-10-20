/**
 * Rotas do App.tsx × regras do netlify.toml × arquivos do build. Sem o
 * catch-all de antes, uma rota declarada no App sem regra (ou sem arquivo)
 * vira 404 no Netlify antes do React rodar — este teste é o que impede.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lerRegras, resolver } from "@/prerender/netlify";
import { PAGINA_404, PAGINAS_PRE_RENDERIZADAS } from "@/prerender/paginas";
import { APP_ROUTES, FROZEN_EXTERNAL_PUBLIC_PATHS } from "@/lib/routes";
import { CAMINHOS_EXCLUIDOS, PAGINAS_EM_MARKDOWN } from "@/lib/agentes/negociacao";

const RAIZ = join(__dirname, "..", "..");
const TOML = readFileSync(join(RAIZ, "netlify.toml"), "utf8");
const regras = lerRegras(TOML);
const APP = readFileSync(join(RAIZ, "src", "App.tsx"), "utf8");
/** As rotas de topo declaradas no App.tsx (menos o `*` do NotFound). */
const rotasDoApp = [...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "*");

/** O que o build escreve em dist/ (o que importa para a resolução). */
const ARQUIVOS = new Set([
  ...PAGINAS_PRE_RENDERIZADAS.flatMap((p) => [p.arquivo, p.md]),
  PAGINA_404.arquivo, PAGINA_404.md, "app-shell.html", "tema.js", "sitemap.xml", "llms.txt", "sw.js",
  "blog/index.html", "blog/um-post/index.html", "blog/feed.xml",
]);
const PRE = new Set(PAGINAS_PRE_RENDERIZADAS.map((p) => p.rota));
const ehShell = (caminho: string) => {
  const r = resolver(caminho, regras, ARQUIVOS);
  return r.tipo === "regra" && r.regra.to === "/app-shell.html" && r.status === 200;
};

describe("rotas do App.tsx × netlify.toml", () => {
  it("o App declara as rotas que este teste conhece (se mudar, o teste precisa saber)", () => {
    expect(rotasDoApp).toEqual(expect.arrayContaining(["/", "/auth", "/auth/callback", "/privacidade", "/termos", "/aviso-legal", "/recusas", "/sobre", "/onboarding", "/app"]));
  });

  it("toda rota pública pré-renderizada é servida pelo PRÓPRIO arquivo, 200", () => {
    for (const rota of PRE) {
      expect(rotasDoApp, `${rota} pré-renderizada sem rota no App`).toContain(rota);
      const r = resolver(rota, regras, ARQUIVOS);
      expect(r, rota).toMatchObject({ tipo: "arquivo", status: 200 });
    }
  });

  it("toda outra rota do App chega ao shell da SPA (200, reescrita — o endereço e a ?query ficam)", () => {
    for (const rota of rotasDoApp.filter((r) => !PRE.has(r))) expect(ehShell(rota), rota).toBe(true);
    for (const r of APP_ROUTES) expect(ehShell(`/app/${r.path || ""}`.replace(/:[^/]+/g, "x")), r.path).toBe(true);
    for (const rota of Object.keys(FROZEN_EXTERNAL_PUBLIC_PATHS)) expect(ehShell(rota), rota).toBe(true);
    expect(ehShell("/app/prosperidade/")).toBe(true);
  });

  it("a ?query não depende de regra: nenhuma casa por query, e reescrita 200 não muda a URL", () => {
    expect(TOML).not.toMatch(/^\s*query\s*=/m);
    expect(TOML).not.toMatch(/:splat|[?&]convite/);
  });

  it("não há catch-all: endereço que não existe é 404 (o 404.html da casa)", () => {
    expect(regras.find((r) => r.from === "/*")).toBeUndefined();
    for (const c of ["/nao-existe", "/privacidade/qualquer", "/appx", "/authz", "/onboardingx", "/blog/sumiu/"]) {
      expect(resolver(c, regras, ARQUIVOS).status, c).toBe(404);
    }
  });

  it("nenhuma regra força por cima de arquivo nem alcança página pré-renderizada, blog, llms.txt ou sitemap", () => {
    for (const r of regras) expect(r.force, r.from).toBe(false);
    for (const c of [...PRE, "/blog/", "/blog/um-post/", "/llms.txt", "/sitemap.xml", "/sw.js"]) {
      expect(resolver(c, regras, ARQUIVOS).tipo, c).toBe("arquivo");
    }
  });

  it("aliases em inglês: 301 para a página que existe", () => {
    expect(resolver("/about", regras, ARQUIVOS)).toMatchObject({ tipo: "regra", status: 301, regra: { to: "/sobre" } });
    expect(resolver("/privacy", regras, ARQUIVOS)).toMatchObject({ tipo: "regra", status: 301, regra: { to: "/privacidade" } });
    expect(resolver("/sobre", regras, ARQUIVOS).tipo).toBe("arquivo");
  });

  it("a edge do Markdown não roda onde a SPA mora nem nos aliases 301 (a edge vem antes dos redirects)", () => {
    for (const r of regras.filter((x) => x.to === "/app-shell.html" || x.status === 301)) expect(CAMINHOS_EXCLUIDOS, r.from).toContain(r.from);
  });

  it("o mapa de Markdown da edge é exatamente o das páginas pré-renderizadas", () => {
    expect([...PAGINAS_EM_MARKDOWN].sort()).toEqual([...PRE].sort());
  });

  it("o service worker guarda como shell só o /app-shell.html, e só das rotas da SPA", () => {
    const sw = readFileSync(join(RAIZ, "public", "sw.js"), "utf8");
    expect(sw).toContain('const SHELL_URL = "/app-shell.html";');
    const spa = sw.match(/\[("\/[a-z]+"(?:, )?)+\]/)![0];
    const daSpa = regras.filter((r) => r.to === "/app-shell.html").map((r) => r.from.replace(/\/\*$/, ""));
    expect(JSON.parse(spa).sort()).toEqual([...new Set(daSpa)].sort());
  });
});
