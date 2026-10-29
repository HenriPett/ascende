// ASCENDE — Blog: o contrato entre o pipeline (dados, arquivos, sitemap, RSS,
// blog:check) e os templates (src/blog/render.tsx).
//
// Um lugar só para a forma de um post: o frontmatter que o blog:check valida,
// o que os templates recebem e o que o sitemap e o RSS leem são o MESMO tipo.
// Três definições paralelas divergiriam no primeiro campo novo.

/** Os três clusters orientativos do docs/blog/EDITORIAL.md. Fechado: um
 *  cluster novo é decisão editorial, e precisa passar por aqui. */
export const CLUSTERS = ["rotina-integrada", "alimentacao-orcamento", "ia-privacidade"] as const;
export type ClusterDoBlog = (typeof CLUSTERS)[number];

/** Para onde o link de produto do fim do artigo leva. Só rotas públicas que
 *  existem — nunca uma tela do app que exige login. */
export const PRODUCT_PATHS = ["/", "/recusas"] as const;
export type ProductPath = (typeof PRODUCT_PATHS)[number];

/** Uma fonte citada. `accessed` é a data em que alguém de fato a leu. */
export interface FonteDoPost {
  title: string;
  url: string;
  publisher: string;
  accessed: string; // YYYY-MM-DD
}

/** Uma imagem do corpo, já conferida e medida no build. A imagem é do POST:
 *  mora em content/blog/img/<slug>/ e é publicada em /blog/<slug>/. `alt` e
 *  legenda não estão aqui — saem do próprio markdown, `![alt](./x.png "legenda")`. */
export interface ImagemDoPost {
  /** Caminho publicado: /blog/<slug>/<arquivo> */
  src: string;
  /** Dimensões REAIS, lidas do cabeçalho do arquivo (width/height no <img>
   *  para a página não pular quando a imagem carregar). */
  width: number;
  height: number;
  /** Para o `srcset` com descritor `w`: a variante `<nome>-360.<ext>`, se
   *  existir, e a própria — em largura crescente. Só a própria sem variante. */
  variantes: { src: string; width: number }[];
}

/** O post como os templates o recebem: frontmatter validado + o que o
 *  pipeline deriva (corpo, URLs). Datas são strings YYYY-MM-DD de calendário
 *  real — nunca `Date`, para nenhum fuso mudar o dia no caminho. */
export interface PostDoBlog {
  slug: string;
  /** O H1 do artigo. */
  title: string;
  /** Título curto para o <title>, quando o H1 passa de 55 caracteres. */
  seoTitle?: string;
  description: string;
  datePublished: string;
  /** Ausente = o post nunca mudou. Não emitir no JSON-LD. */
  dateModified?: string;
  /** A pergunta/busca que o post responde. Única entre todos os posts. */
  intent: string;
  cluster: ClusterDoBlog;
  sources: FonteDoPost[];
  /** Slugs de posts relacionados (0–3), já conferidos como existentes. */
  related: string[];
  productPath: ProductPath;
  /** O corpo em markdown, sem o frontmatter. O H1 vem de `title`. */
  corpo: string;
  /** As imagens do corpo, pelo `src` EXATO do markdown (`./arquivo.png`).
   *  `{}` quando o post não tem imagem. */
  imagens: Record<string, ImagemDoPost>;
  /** O `resumo` do frontmatter: 2 a 4 frases, a resposta direta à intenção.
   *  `[]` quando o post não tem. Vira o bloco "Em resumo", o `abstract` do
   *  BlogPosting e o começo do .md. */
  resumo: string[];
  /** As perguntas da seção `## Perguntas frequentes` do corpo (`[]` sem a
   *  seção). Viram o FAQPage JSON-LD do artigo. */
  faq: PerguntaDoPost[];
  /** Caminho público, com barra final: /blog/<slug>/ */
  caminho: string;
  /** URL absoluta canônica: https://ascende.site/blog/<slug>/ */
  url: string;
}

export interface PerguntaDoPost {
  pergunta: string;
  /** O parágrafo único depois do `### …?`, em Markdown. */
  resposta: string;
}

/** O que o pipeline entrega aos templates além dos posts. */
export interface ContextoDoBlog {
  /** Sem barra final: https://ascende.site */
  siteUrl: string;
  /** Os <link rel="stylesheet"> do dist/index.html da SPA, na ordem. */
  cssHrefs: string[];
}

export const SITE_URL = "https://ascende.site";

/** O AUTOR DE TODO POST (decisão do Henrique, 29/10/2026). Uma constante só:
 *  byline do artigo e da listagem, `author` do BlogPosting, feed, .md e
 *  llms.txt leem daqui — trocar o nome é trocar esta constante. Só fatos: ele
 *  é o fundador e escreve o blog. Nada de credencial, "especialista", foto ou
 *  sameAs que não existam (docs/blog/EDITORIAL.md §4). */
export const AUTOR_DO_BLOG = {
  nome: "Henrique Pett",
  cargo: "Fundador do Ascende",
  /** A seção do autor na página /sobre. */
  url: `${SITE_URL}/sobre#autor`,
} as const;

/** "Henrique Pett, fundador do Ascende" — a assinatura em texto corrido. */
export const ASSINATURA_DO_AUTOR =
  `${AUTOR_DO_BLOG.nome}, ${AUTOR_DO_BLOG.cargo.charAt(0).toLowerCase()}${AUTOR_DO_BLOG.cargo.slice(1)}`;

/** A frase que descreve o blog — na listagem (texto e meta description) e no
 *  canal do RSS. Uma só, para as três nunca dizerem coisas diferentes
 *  (pedido da Clareira, docs/blog/EDITORIAL.md). */
export const DESCRICAO_DO_BLOG =
  "Rotina, comida que cabe no orçamento e IA com privacidade — com as fontes de cada texto.";
