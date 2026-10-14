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
  /** Caminho público, com barra final: /blog/<slug>/ */
  caminho: string;
  /** URL absoluta canônica: https://ascende.site/blog/<slug>/ */
  url: string;
}

/** O que o pipeline entrega aos templates além dos posts. */
export interface ContextoDoBlog {
  /** Sem barra final: https://ascende.site */
  siteUrl: string;
  /** Os <link rel="stylesheet"> do dist/index.html da SPA, na ordem. */
  cssHrefs: string[];
}

export const SITE_URL = "https://ascende.site";

/** A frase que descreve o blog — na listagem (texto e meta description) e no
 *  canal do RSS. Uma só, para as três nunca dizerem coisas diferentes
 *  (pedido da Clareira, docs/blog/EDITORIAL.md). */
export const DESCRICAO_DO_BLOG =
  "Rotina, comida que cabe no orçamento e IA com privacidade — com as fontes de cada texto.";
