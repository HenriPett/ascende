// ASCENDE — Blog: o histórico por intenção e URL (content/blog/INDICE.md).
//
// POR QUE UM ARQUIVO VERSIONADO, E NÃO SÓ A LISTA DE POSTS: a lista de posts é
// o presente; o INDICE é o que JÁ SAIU. A rotina de publicação roda três vezes
// por dia, sempre com texto novo — e a duplicata que ela arrisca não é o mesmo
// arquivo duas vezes, é o mesmo assunto com outro título, ou um post apagado
// que volta com outro slug. O INDICE guarda a intenção normalizada de tudo o
// que foi publicado e o check compara contra ela.
//
// É Markdown para ser lido por gente no GitHub, e é GERADO
// (`npm run blog:indice`) para nunca ser editado à mão sem querer. A única
// edição à mão legítima é tirar um post do ar — e aí ela tem de ser explícita.
import type { ClusterDoBlog, PostDoBlog } from "@/lib/blog/tipos";

export interface LinhaDoIndice {
  slug: string;
  intent: string;
  cluster: ClusterDoBlog;
  datePublished: string;
  dateModified?: string;
}

const CABECALHO = `# Índice do blog — histórico por intenção e URL

<!-- Gerado por \`npm run blog:indice\`. Não edite à mão: o \`npm run blog:check\`
     compara esta tabela com content/blog/*.md e recusa o build se divergirem.
     Única edição manual legítima: tirar um post do ar (apague a linha E o
     arquivo, no mesmo commit, com o motivo na mensagem). -->

Cada linha é uma URL que já foi publicada em https://ascende.site/blog/<slug>/.
O slug não muda depois de publicado, e a intenção não se repete.

| slug | intenção | cluster | publicado | modificado |
|---|---|---|---|---|
`;

const escapar = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function gerarIndice(linhas: LinhaDoIndice[]): string {
  const ordenadas = [...linhas].sort((a, b) =>
    a.datePublished.localeCompare(b.datePublished) || a.slug.localeCompare(b.slug));
  return CABECALHO + ordenadas.map((l) =>
    `| ${l.slug} | ${escapar(l.intent)} | ${l.cluster} | ${l.datePublished} | ${l.dateModified ?? ""} |`,
  ).join("\n") + (ordenadas.length ? "\n" : "");
}

/** Lê as linhas da tabela. Linha que não for da tabela é ignorada. */
export function lerIndice(texto: string): LinhaDoIndice[] {
  const out: LinhaDoIndice[] = [];
  for (const l of texto.replace(/\r\n/g, "\n").split("\n")) {
    if (!l.startsWith("| ") || l.startsWith("| slug ") || l.startsWith("|---")) continue;
    // Divide por `|` que não esteja escapado.
    const cel = l.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
    if (cel.length < 5) continue;
    const [slug, intent, cluster, datePublished, dateModified] = cel;
    out.push({
      slug, intent, cluster: cluster as ClusterDoBlog, datePublished,
      ...(dateModified ? { dateModified } : {}),
    });
  }
  return out;
}

/** O INDICE novo a partir dos posts atuais, MANTENDO o histórico: linha de
 *  slug que não está mais na pasta continua — sumir com ela é a decisão
 *  manual que o check exige. A data de publicação de quem já estava no INDICE
 *  é preservada (não se reescreve o dia em que um post foi ao ar). */
export function atualizarIndice(antigo: LinhaDoIndice[], posts: PostDoBlog[]): LinhaDoIndice[] {
  const porSlug = new Map(antigo.map((l) => [l.slug, l]));
  for (const p of posts) {
    const anterior = porSlug.get(p.slug);
    porSlug.set(p.slug, {
      slug: p.slug,
      intent: p.intent,
      cluster: p.cluster,
      datePublished: anterior?.datePublished ?? p.datePublished,
      ...(p.dateModified ? { dateModified: p.dateModified } : {}),
    });
  }
  return [...porSlug.values()];
}
