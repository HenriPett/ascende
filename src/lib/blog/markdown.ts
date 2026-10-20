// ASCENDE — Blog em Markdown, para agentes (negociação `Accept: text/markdown`,
// src/lib/agentes/negociacao.ts). O post JÁ é Markdown: a versão servida é o
// corpo de content/blog/<slug>.md com o H1, a data e as fontes que o HTML
// mostra — e com links internos e imagens em URL absoluta, porque o .md sai
// do contexto da página.
import { DESCRICAO_DO_BLOG, SITE_URL, type PostDoBlog } from "@/lib/blog/tipos";

/** `](/recusas)` → `](https://ascende.site/recusas)`; `](./img.png)` → a URL
 *  da pasta do artigo. */
function absolutizar(corpo: string, urlDoPost: string): string {
  return corpo
    .replace(/\]\(\s*\.\//g, `](${urlDoPost}`)
    .replace(/\]\(\s*\/(?!\/)/g, `](${SITE_URL}/`);
}

export function artigoEmMarkdown(p: PostDoBlog): string {
  const datas = p.dateModified
    ? `Publicado em ${p.datePublished}, atualizado em ${p.dateModified}. Por Ascende.`
    : `Publicado em ${p.datePublished}. Por Ascende.`;
  const fontes = p.sources.length
    ? `\n\n## Fontes\n\n${p.sources.map((f) => `- [${f.title}](${f.url}) — ${f.publisher}, acessado em ${f.accessed}.`).join("\n")}`
    : "";
  return `# ${p.title}\n\n> ${p.description}\n\n${datas}\n\n${absolutizar(p.corpo.trim(), p.url)}${fontes}\n\nURL: ${p.url}\n`;
}

/** `posts` do mais novo para o mais antigo, como a listagem. */
export function listagemEmMarkdown(posts: PostDoBlog[]): string {
  const itens = posts.map((p) => `- [${p.title}](${p.url}) — ${p.datePublished}. ${p.description}`);
  return `# Blog do Ascende\n\n> ${DESCRICAO_DO_BLOG}\n\n${itens.join("\n")}\n\nFeed RSS: ${SITE_URL}/blog/feed.xml\n`;
}
