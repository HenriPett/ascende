#!/usr/bin/env node
// ASCENDE — Blog: o comando que lê o disco e escreve o disco.
//
//   node scripts/blog.mjs check  [--content <pasta>]
//   node scripts/blog.mjs indice [--content <pasta>]
//   node scripts/blog.mjs build  --out <pasta> [--content <pasta>]
//
// (`npm run blog:check`, `npm run blog:indice` e o fim de `npm run build`.)
//
// POR QUE ESTE ARQUIVO É .mjs E CARREGA O RESTO PELO VITE: a lógica mora em
// TypeScript (src/lib/blog/*, testada pelo vitest) e os templates em TSX
// (src/blog/render.tsx, do Pixel), com o alias `@/`. Rodar isso em Node pedia
// tsx ou vite-node — dependência nova. O Vite já é dependência e sabe carregar
// TS/TSX com os aliases do projeto (`ssrLoadModule`), sem servidor HTTP
// nenhum. É ele que faz o trabalho.
//
// FIXTURES NUNCA EM PRODUÇÃO (plano, regra 5): `--content` diferente de
// content/blog só é aceito com `--out` diferente de dist.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTEUDO_PADRAO = join(RAIZ, "content", "blog");
const DIST_PADRAO = join(RAIZ, "dist");

const [comando, ...resto] = process.argv.slice(2);
const opcao = (nome) => {
  const i = resto.indexOf(`--${nome}`);
  return i >= 0 ? resto[i + 1] : undefined;
};
const conteudo = resolve(RAIZ, opcao("content") ?? process.env.BLOG_CONTENT_DIR ?? CONTEUDO_PADRAO);
const saida = opcao("out") ? resolve(RAIZ, opcao("out")) : null;

const falhar = (msg) => { console.error(`blog: ${msg}`); process.exit(1); };

if (!["check", "indice", "build"].includes(comando)) {
  falhar("uso: node scripts/blog.mjs <check|indice|build> [--content <pasta>] [--out <pasta>]");
}
if (comando === "build" && !saida) falhar("build precisa de --out <pasta>");
if (saida && resolve(saida) === DIST_PADRAO && resolve(conteudo) !== CONTEUDO_PADRAO) {
  falhar(`recusado: conteúdo de ${relative(RAIZ, conteudo)} não vai para dist/ (fixtures só em preview)`);
}

/** Os posts da pasta: todo .md menos o INDICE. Nome fora do padrão NÃO é
 *  ignorado em silêncio — vira erro de slug na checagem. */
function lerArquivos() {
  if (!existsSync(conteudo)) return [];
  return readdirSync(conteudo)
    .filter((n) => n.endsWith(".md") && n !== "INDICE.md")
    .sort()
    .map((nome) => ({ nome, texto: readFileSync(join(conteudo, nome), "utf8") }));
}
/** content/blog/img/<slug>/<arquivo>: slug → (nome → bytes). Arquivo oculto
 *  (`.DS_Store`, que o Finder cria sozinho) não conta: não é do post e não
 *  pode virar "imagem que ninguém usa". */
function lerPastasDeImagem() {
  const raiz = join(conteudo, "img");
  if (!existsSync(raiz)) return {};
  const out = {};
  for (const slug of readdirSync(raiz, { withFileTypes: true })) {
    if (!slug.isDirectory() || slug.name.startsWith(".")) continue;
    out[slug.name] = {};
    for (const f of readdirSync(join(raiz, slug.name), { withFileTypes: true })) {
      if (f.isFile() && !f.name.startsWith(".")) {
        out[slug.name][f.name] = new Uint8Array(readFileSync(join(raiz, slug.name, f.name)));
      }
    }
  }
  return out;
}
const caminhoDoIndice = join(conteudo, "INDICE.md");
const lerIndiceTexto = () => (existsSync(caminhoDoIndice) ? readFileSync(caminhoDoIndice, "utf8") : null);

const vite = await createServer({
  root: RAIZ,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const { hojeEmSaoPaulo, lerPost } = await vite.ssrLoadModule("/src/lib/blog/post.ts");
  const { checarColecao } = await vite.ssrLoadModule("/src/lib/blog/checagem.ts");
  const { lerIndice, gerarIndice, atualizarIndice } = await vite.ssrLoadModule("/src/lib/blog/indice.ts");
  const hoje = hojeEmSaoPaulo();
  const arquivos = lerArquivos();
  const imagens = lerPastasDeImagem();
  const indiceTexto = lerIndiceTexto();

  if (comando === "check") {
    const { posts, erros, copias } = checarColecao(arquivos, lerIndice(indiceTexto ?? ""), hoje, imagens);
    if (erros.length) {
      console.error(`blog:check — ${erros.length} erro(s) em ${relative(RAIZ, conteudo)}:`);
      for (const e of erros) console.error(`  ✗ ${e}`);
      process.exit(1);
    }
    const nImagens = Object.keys(copias).length;
    console.log(`blog:check — ok: ${posts.length} post(s), ${nImagens} arquivo(s) de imagem em ${relative(RAIZ, conteudo)} (hoje em São Paulo: ${hoje}).`);
  }

  if (comando === "indice") {
    // Só os posts que passam sozinhos entram; e o INDICE novo só é escrito se
    // a coleção inteira passar CONTRA ele. Um INDICE que absorvesse um post
    // errado esconderia o erro na próxima checagem.
    const lidos = arquivos.map((a) => lerPost(a.nome, a.texto, hoje));
    const errosDeArquivo = lidos.flatMap((l, i) => l.erros.map((e) => `${arquivos[i].nome}: ${e}`));
    if (errosDeArquivo.length) {
      console.error("blog:indice — corrija antes de indexar:");
      for (const e of errosDeArquivo) console.error(`  ✗ ${e}`);
      process.exit(1);
    }
    const novo = atualizarIndice(lerIndice(indiceTexto ?? ""), lidos.map((l) => l.post));
    const { erros } = checarColecao(arquivos, novo, hoje, imagens);
    if (erros.length) {
      console.error("blog:indice — a coleção não passa contra o índice novo:");
      for (const e of erros) console.error(`  ✗ ${e}`);
      process.exit(1);
    }
    mkdirSync(conteudo, { recursive: true });
    writeFileSync(caminhoDoIndice, gerarIndice(novo));
    console.log(`blog:indice — ${relative(RAIZ, caminhoDoIndice)}: ${novo.length} linha(s).`);
  }

  if (comando === "build") {
    const indexHtml = join(saida, "index.html");
    if (!existsSync(indexHtml)) falhar(`${relative(RAIZ, indexHtml)} não existe: rode o vite build antes`);
    const { gerarBlog, cssDoIndex } = await vite.ssrLoadModule("/src/lib/blog/pipeline.ts");
    const { SITE_URL } = await vite.ssrLoadModule("/src/lib/blog/tipos.ts");
    const ctx = { siteUrl: SITE_URL, cssHrefs: cssDoIndex(readFileSync(indexHtml, "utf8")) };
    // Os templates só são carregados se houver post: com 0 posts o build não
    // depende deles existirem nem funcionarem.
    const temPost = arquivos.length > 0;
    const templates = temPost
      ? await vite.ssrLoadModule("/src/blog/render.tsx")
      : { renderListagem: () => "", renderArtigo: () => "" };
    const llmsBase = readFileSync(join(RAIZ, "src", "lib", "agentes", "llms.txt"), "utf8");
    const out = gerarBlog({ arquivos, indice: indiceTexto, hoje, ctx, templates, imagens, llmsBase });
    if (out.erros.length) {
      console.error(`blog: o build NÃO publica — ${out.erros.length} erro(s):`);
      for (const e of out.erros) console.error(`  ✗ ${e}`);
      process.exit(1);
    }
    // Um dist/blog de um build anterior (com posts) não pode sobreviver a um
    // build sem posts: seria o blog fantasma que a regra do zero proíbe.
    rmSync(join(saida, "blog"), { recursive: true, force: true });
    for (const [rel, texto] of Object.entries(out.arquivos)) {
      const destino = join(saida, rel);
      mkdirSync(dirname(destino), { recursive: true });
      writeFileSync(destino, texto);
    }
    console.log(`blog: ${out.posts.length} post(s) → ${Object.keys(out.arquivos).sort().join(", ")} em ${relative(RAIZ, saida)}/`);
  }
} finally {
  await vite.close();
}
