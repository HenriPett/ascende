// ASCENDE — /llms.txt (formato https://llmstxt.org): o resumo do site para
// agentes. O texto é literal, em src/lib/agentes/llms.txt (Farol redige, Fiel
// aprova; afirmações só da coluna "Pode" do docs/blog/EDITORIAL.md §6).
//
// A EXCEÇÃO É A LISTA DE POSTS: o blog publica todo dia por rotina, e uma
// lista escrita à mão ficaria velha no dia seguinte. A seção "## Optional"
// termina com um link por post, gerado no build (scripts/blog.mjs) a partir
// dos posts que passaram no blog:check — título, URL canônica e description,
// do mais novo para o mais antigo. Sem post, sem blog: a seção sai inteira
// (regra do zero do blog).
import { AUTOR_DO_BLOG, ASSINATURA_DO_AUTOR, type PostDoBlog } from "@/lib/blog/tipos";

const SECAO_OPCIONAL = "\n## Optional\n";
const escLink = (s: string) => s.replace(/([[\]\\])/g, "\\$1");

export function gerarLlmsTxt(base: string, posts: Pick<PostDoBlog, "title" | "url" | "description">[]): string {
  const i = base.indexOf(SECAO_OPCIONAL);
  if (i < 0) throw new Error("llms.txt: a base precisa terminar com a seção '## Optional'");
  if (!posts.length) return base.slice(0, i).trimEnd() + "\n";
  // O autor do blog, da constante única (AUTOR_DO_BLOG): só o fato.
  const autor = `- [${ASSINATURA_DO_AUTOR}](${AUTOR_DO_BLOG.url}): autor de todos os posts do blog.`;
  const itens = posts.map((p) => `- [${escLink(p.title)}](${p.url}): ${p.description}`);
  return `${base.trimEnd()}\n${autor}\n${itens.join("\n")}\n`;
}
