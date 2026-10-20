#!/usr/bin/env node
// ASCENDE — Pré-render das páginas públicas, no fim do `npm run build`.
//
//   node scripts/prerender.mjs --out dist
//
// Lê o dist/index.html do vite build (o shell da SPA) e escreve:
//   app-shell.html            o shell intocado — o netlify.toml o serve para
//                             /app, /auth e /onboarding;
//   index.html, <rota>.html   cada página pública com o conteúdo no #root e o
//                             <head> dela (src/prerender/paginas.ts);
//   <rota>.md, index.md       a mesma página em Markdown (agentes);
//   404.html, 404.md          a 404 da casa, sem o JS da SPA;
//   tema.js                   o tema escuro antes do CSS (o do blog).
//
// Mesmo padrão do scripts/blog.mjs: o TSX é carregado pelo Vite
// (ssrLoadModule), sem dependência nova.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const i = args.indexOf("--out");
if (i < 0 || !args[i + 1]) { console.error("prerender: uso: node scripts/prerender.mjs --out <pasta>"); process.exit(1); }
const saida = resolve(RAIZ, args[i + 1]);
const indexHtml = join(saida, "index.html");
if (!existsSync(indexHtml)) { console.error(`prerender: ${relative(RAIZ, indexHtml)} não existe: rode o vite build antes`); process.exit(1); }

const vite = await createServer({
  root: RAIZ,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    // O cliente do Supabase não entra no pré-render: ver src/prerender/supabaseAusente.ts.
    name: "ascende:supabase-ausente",
    enforce: "pre",
    // O alias "@/" do vite.config já foi resolvido quando o id chega aqui.
    resolveId: (id) => (/\/src\/integrations\/supabase\/client(\.ts)?$/.test(id) ? join(RAIZ, "src/prerender/supabaseAusente.ts") : null),
  }],
});

try {
  const shell = readFileSync(indexHtml, "utf8");
  // Rodar duas vezes sobre o mesmo dist (sem vite build no meio) partiria de
  // uma página já pré-renderizada. O app-shell é o original.
  if (!shell.includes('<div id="root"></div>')) {
    throw new Error(`${relative(RAIZ, indexHtml)} já é pré-renderizado: rode o vite build antes`);
  }
  const p = await vite.ssrLoadModule("/src/prerender/paginas.ts");
  const { renderizarRota, renderizar404 } = await vite.ssrLoadModule("/src/prerender/entrada.tsx");
  const { htmlParaMarkdown } = await vite.ssrLoadModule("/src/lib/agentes/htmlParaMarkdown.ts");
  const { PRIVACIDADE, TERMOS, AVISO_LEGAL } = await vite.ssrLoadModule("/src/lib/legal.ts");
  const { SOBRE } = await vite.ssrLoadModule("/src/lib/sobre.ts");
  const { TEMA_JS } = await vite.ssrLoadModule("/src/blog/render.tsx");
  const { SITE_URL } = await vite.ssrLoadModule("/src/lib/blog/tipos.ts");

  // Páginas cujo texto JÁ é Markdown: o .md é a fonte, não uma conversão.
  const fonteMd = { "/privacidade": PRIVACIDADE, "/termos": TERMOS, "/aviso-legal": AVISO_LEGAL, "/sobre": SOBRE };
  const escritos = [];
  const escrever = (rel, conteudo) => { writeFileSync(join(saida, rel), conteudo); escritos.push(rel); };

  escrever("app-shell.html", shell);
  escrever("tema.js", TEMA_JS);

  for (const pg of p.PAGINAS_PRE_RENDERIZADAS) {
    const markup = await renderizarRota(pg.rota);
    if (!markup.includes("<h1")) throw new Error(`${pg.rota}: o pré-render saiu sem <h1>`);
    let html = p.comTema(p.comConteudo(shell, markup));
    if (pg.cabeca) html = p.semJsonLd(p.aplicarCabeca(html, { ...pg.cabeca, canonical: p.canonicaDe(pg.rota) }));
    escrever(pg.arquivo, html);
    const md = fonteMd[pg.rota]?.trim() ?? htmlParaMarkdown(markup, SITE_URL).trim();
    escrever(pg.md, `${md}\n\nURL: ${p.canonicaDe(pg.rota)}\n`);
  }

  const nf = p.paginaSemApp(p.semJsonLd(p.comTema(p.comConteudo(
    p.aplicarCabeca(shell, { title: p.PAGINA_404.title, description: "Este endereço não existe no Ascende.", canonical: null }),
    renderizar404(), { app: false },
  ))));
  escrever(p.PAGINA_404.arquivo, nf);
  escrever(p.PAGINA_404.md, `# Página não encontrada\n\nEste endereço não existe no Ascende. Caminhos que existem:\n\n- [Página inicial](${SITE_URL}/)\n- [Sobre o Ascende](${SITE_URL}/sobre)\n- [Blog](${SITE_URL}/blog/)\n- [Mapa do site](${SITE_URL}/sitemap.xml)\n- [llms.txt](${SITE_URL}/llms.txt)\n`);

  console.log(`prerender: ${escritos.join(", ")} em ${relative(RAIZ, saida)}/`);
} catch (e) {
  console.error(`prerender: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await vite.close();
}
