// ASCENDE — O sitemap e o RSS, gerados no build.
//
// O public/sitemap.xml era estático, com as 5 páginas públicas escritas à mão.
// Com o blog, o sitemap passa a ter URLs que nascem a cada post — e duas
// listas (o XML estático + a dos posts) divergiriam na primeira página pública
// nova. Então as 5 páginas viraram DADO, aqui, e o XML inteiro é gerado no
// build a partir dele. O arquivo estático saiu de public/ para não existirem
// duas verdades sobre o que o Google deve ler.
//
// Com 0 posts o sitemap é exatamente o de antes: as mesmas 5 URLs, com as
// mesmas frequências e prioridades. Nenhuma entrada de blog aparece.
import { DESCRICAO_DO_BLOG, SITE_URL, type PostDoBlog } from "@/lib/blog/tipos";

export interface PaginaPublica {
  caminho: string;
  changefreq: "weekly" | "monthly";
  priority: string;
}

/** As páginas públicas indexáveis, na ordem do sitemap de antes. Rota pública
 *  nova (fora de /app, /onboarding e /auth, que o robots.txt fecha) entra
 *  aqui — e só aqui. */
export const PAGINAS_PUBLICAS: readonly PaginaPublica[] = [
  { caminho: "/", changefreq: "weekly", priority: "1.0" },
  { caminho: "/recusas", changefreq: "monthly", priority: "0.6" },
  { caminho: "/privacidade", changefreq: "monthly", priority: "0.3" },
  { caminho: "/termos", changefreq: "monthly", priority: "0.3" },
  { caminho: "/aviso-legal", changefreq: "monthly", priority: "0.3" },
];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const ultimaData = (p: PostDoBlog) => p.dateModified ?? p.datePublished;

/** `posts` em qualquer ordem. */
export function gerarSitemap(posts: PostDoBlog[]): string {
  const url = (loc: string, extra: string) => `  <url>\n    <loc>${esc(loc)}</loc>\n${extra}  </url>\n`;
  let corpo = PAGINAS_PUBLICAS.map((p) =>
    url(`${SITE_URL}${p.caminho}`, `    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n`),
  ).join("");
  if (posts.length) {
    // `lastmod` só com data REAL: a do post mais recente para a listagem, e a
    // de cada post (modificação, se houver) para ele. Nunca a data do build —
    // isso diria ao buscador que tudo mudou a cada deploy.
    const maisRecente = posts.map(ultimaData).sort().at(-1)!;
    corpo += url(`${SITE_URL}/blog/`, `    <lastmod>${maisRecente}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n`);
    for (const p of [...posts].sort((a, b) => a.slug.localeCompare(b.slug))) {
      corpo += url(p.url, `    <lastmod>${ultimaData(p)}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${corpo}</urlset>\n`;
}

const DIAS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RFC 822, como o RSS 2.0 pede. Meia-noite em São Paulo do dia publicado:
 *  o post não tem hora de publicação no frontmatter, e inventar uma seria
 *  inventar dado. O dia é o real; a hora é o começo dele, explícita. */
export function dataRfc822(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const semana = DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  return `${semana}, ${String(d).padStart(2, "0")} ${MESES[m - 1]} ${a} 00:00:00 -0300`;
}

/** RSS 2.0 de `dist/blog/feed.xml`. `posts` já ordenados do mais novo. */
export function gerarFeed(posts: PostDoBlog[]): string {
  const ultima = posts.map(ultimaData).sort().at(-1);
  const itens = posts.map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(p.url)}</link>
      <guid isPermaLink="true">${esc(p.url)}</guid>
      <pubDate>${dataRfc822(p.datePublished)}</pubDate>
      <description>${esc(p.description)}</description>
    </item>
`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog do Ascende</title>
    <link>${SITE_URL}/blog/</link>
    <atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml" />
    <description>${esc(DESCRICAO_DO_BLOG)}</description>
    <language>pt-BR</language>
${ultima ? `    <lastBuildDate>${dataRfc822(ultima)}</lastBuildDate>\n` : ""}${itens}  </channel>
</rss>
`;
}
