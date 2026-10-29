// ASCENDE — Blog: ler UM arquivo de post e dizer, com motivo, o que está
// errado nele.
//
// O esquema do frontmatter foi combinado com a Clareira (docs/blog/EDITORIAL.md)
// e é ESTRITO: chave fora da lista é erro. A razão é o que o blog promete não
// fazer — `reviewedBy`, `medicalReview`, `rating` não existem porque o Ascende
// não tem revisão profissional para declarar. `author` também não: o autor de
// todo post é UM só, fixo no template (AUTOR_DO_BLOG em tipos.ts) — um campo
// por post deixaria cada texto declarar outro autor. Um campo que o esquema
// aceitasse "por via das dúvidas" seria o primeiro passo para alguém um dia
// preenchê-lo.
//
// Função pura: recebe o texto e a data de hoje, devolve o post ou os erros.
// Quem lê o disco é scripts/blog.mjs.
import yaml from "js-yaml";
import {
  CLUSTERS, PRODUCT_PATHS, SITE_URL,
  type ClusterDoBlog, type FonteDoPost, type PostDoBlog, type ProductPath,
} from "@/lib/blog/tipos";
import { errosDaImagemNoTexto, imagensDoCorpo } from "@/lib/blog/imagem";
import { lerFaq } from "@/lib/blog/faq";

export const CHAVES_OBRIGATORIAS = [
  "title", "description", "slug", "datePublished", "intent", "cluster", "sources",
] as const;
export const CHAVES_OPCIONAIS = ["seoTitle", "dateModified", "related", "productPath", "resumo"] as const;

/** `resumo`: 2 a 4 frases, cada uma de até 200 caracteres. É a resposta
 *  direta à intenção — o que um buscador ou uma IA cita primeiro. */
export const RESUMO_MIN = 2;
export const RESUMO_MAX = 4;
export const RESUMO_ITEM_MAX = 200;
const CHAVES = new Set<string>([...CHAVES_OBRIGATORIAS, ...CHAVES_OPCIONAIS]);

/** Chaves que o esquema recusa nominalmente, com o porquê na mensagem. */
const PROIBIDAS: Record<string, string> = {
  author: "o autor de todo post é fixo no template (AUTOR_DO_BLOG em src/lib/blog/tipos.ts)",
  reviewedBy: "o Ascende não tem revisão profissional para declarar",
  medicalReview: "o Ascende não tem revisão médica para declarar",
  rating: "o blog não publica avaliação",
  image: "o og:image continua /icon-512.png; imagem do artigo vai no corpo, ![alt](./arquivo.png \"legenda\")",
};

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A data é um dia que existe no calendário? `2026-02-30` não é. */
export function dataValida(s: unknown): s is string {
  if (typeof s !== "string" || !DATA_RE.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Hoje em São Paulo, YYYY-MM-DD. É o dia em que o post é publicado de fato —
 *  em UTC, depois das 21h, "hoje" já seria amanhã, e um post do dia seria
 *  recusado como "data no futuro" (ou, pior, aceito com o dia errado). */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(agora);
}

/** A intenção normalizada para comparar: minúsculas, sem acento, sem
 *  pontuação, espaços colapsados. Duas intenções iguais por este critério são
 *  o MESMO post, e o segundo é duplicata. */
export function normalizarIntencao(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Separa `---\n<yaml>\n---\n<corpo>`. */
export function separarFrontmatter(texto: string): { frontmatter: string; corpo: string } | null {
  const t = texto.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  return m ? { frontmatter: m[1], corpo: m[2] } : null;
}

export interface Lido {
  post: PostDoBlog | null;
  erros: string[];
}

const comp = (v: unknown) => (typeof v === "string" ? v.trim().length : -1);

/**
 * Lê e valida um post. `nomeArquivo` é o nome sem pasta (`<slug>.md`);
 * `hoje` é YYYY-MM-DD em São Paulo.
 *
 * Valida só o que dá para saber olhando UM arquivo. O que depende dos outros
 * (slug e intenção únicos, `related` existente, links internos) fica em
 * checagem.ts.
 */
export function lerPost(nomeArquivo: string, texto: string, hoje: string): Lido {
  const erros: string[] = [];
  const partes = separarFrontmatter(texto);
  if (!partes) return { post: null, erros: ["sem frontmatter: o arquivo tem de começar com '---', o YAML, e '---'"] };

  let fm: unknown;
  try {
    // JSON_SCHEMA de propósito: no esquema padrão o YAML transforma
    // `2026-10-14` em Date — e uma Date passa pelo fuso no caminho. Aqui
    // datas continuam strings, e o dia é o que está escrito.
    fm = yaml.load(partes.frontmatter, { schema: yaml.JSON_SCHEMA });
  } catch (e) {
    return { post: null, erros: [`frontmatter não é YAML válido: ${(e as Error).message.split("\n")[0]}`] };
  }
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) {
    return { post: null, erros: ["frontmatter tem de ser um mapa de chave: valor"] };
  }
  const f = fm as Record<string, unknown>;

  for (const k of Object.keys(f)) {
    if (PROIBIDAS[k]) erros.push(`chave proibida '${k}': ${PROIBIDAS[k]}`);
    else if (!CHAVES.has(k)) erros.push(`chave desconhecida '${k}' (o esquema é estrito)`);
  }
  for (const k of CHAVES_OBRIGATORIAS) {
    if (f[k] === undefined || f[k] === null || f[k] === "") erros.push(`falta '${k}'`);
  }

  const nTitle = comp(f.title);
  if (f.title !== undefined && (nTitle < 20 || nTitle > 90)) {
    erros.push(`title tem ${nTitle} caracteres; precisa de 20 a 90`);
  }
  if (f.seoTitle !== undefined && (comp(f.seoTitle) < 1 || comp(f.seoTitle) > 55)) {
    erros.push(`seoTitle tem ${comp(f.seoTitle)} caracteres; precisa de até 55`);
  }
  const tituloDaAba = typeof f.seoTitle === "string" ? f.seoTitle : f.title;
  if (typeof tituloDaAba === "string" && tituloDaAba.trim().length > 55 && f.seoTitle === undefined) {
    erros.push(`title tem ${tituloDaAba.trim().length} caracteres (> 55): defina um seoTitle de até 55`);
  }

  const nDesc = comp(f.description);
  if (f.description !== undefined && (nDesc < 70 || nDesc > 160)) {
    erros.push(`description tem ${nDesc} caracteres; precisa de 70 a 160`);
  }

  const slugDoArquivo = nomeArquivo.replace(/\.md$/, "");
  if (f.slug !== undefined) {
    if (typeof f.slug !== "string" || !SLUG_RE.test(f.slug)) {
      erros.push(`slug '${String(f.slug)}' fora do padrão (minúsculas, números e hífens: ${SLUG_RE.source})`);
    } else if (f.slug.length > 60) {
      erros.push(`slug tem ${f.slug.length} caracteres; precisa de até 60`);
    }
    if (f.slug !== slugDoArquivo) {
      erros.push(`slug '${String(f.slug)}' diferente do nome do arquivo ('${slugDoArquivo}.md')`);
    }
  }

  const dataNaoFutura = (campo: string, v: unknown) => {
    if (v === undefined) return;
    if (!dataValida(v)) erros.push(`${campo} '${String(v)}' não é uma data real YYYY-MM-DD`);
    else if (v > hoje) erros.push(`${campo} ${v} está no futuro (hoje em São Paulo é ${hoje}); data inventada não entra`);
  };
  dataNaoFutura("datePublished", f.datePublished);
  dataNaoFutura("dateModified", f.dateModified);
  if (dataValida(f.datePublished) && dataValida(f.dateModified) && f.dateModified <= f.datePublished) {
    erros.push(`dateModified ${f.dateModified} tem de ser depois de datePublished ${f.datePublished}`);
  }

  const nIntent = comp(f.intent);
  if (f.intent !== undefined && (nIntent < 10 || nIntent > 140)) {
    erros.push(`intent tem ${nIntent} caracteres; precisa de 10 a 140`);
  }

  if (f.cluster !== undefined && !CLUSTERS.includes(f.cluster as ClusterDoBlog)) {
    erros.push(`cluster '${String(f.cluster)}' não existe (${CLUSTERS.join(" | ")})`);
  }

  const fontes: FonteDoPost[] = [];
  if (f.sources !== undefined) {
    if (!Array.isArray(f.sources) || f.sources.length === 0) {
      erros.push("sources tem de ser uma lista com pelo menos 1 fonte");
    } else {
      const urls = new Set<string>();
      f.sources.forEach((s: unknown, i: number) => {
        const n = `sources[${i}]`;
        if (!s || typeof s !== "object" || Array.isArray(s)) { erros.push(`${n} tem de ser um mapa`); return; }
        const o = s as Record<string, unknown>;
        for (const k of Object.keys(o)) {
          if (!["title", "url", "publisher", "accessed"].includes(k)) erros.push(`${n}: chave desconhecida '${k}'`);
        }
        if (comp(o.title) < 1) erros.push(`${n}: falta title`);
        if (comp(o.publisher) < 1) erros.push(`${n}: falta publisher`);
        if (typeof o.url !== "string" || !/^https:\/\/[^\s]+$/.test(o.url)) erros.push(`${n}: url tem de ser https://`);
        else if (urls.has(o.url)) erros.push(`${n}: url repetida no mesmo post (${o.url})`);
        else urls.add(o.url);
        if (!dataValida(o.accessed)) erros.push(`${n}: accessed '${String(o.accessed)}' não é uma data real YYYY-MM-DD`);
        else if (o.accessed > hoje) erros.push(`${n}: accessed ${o.accessed} está no futuro`);
        fontes.push({
          title: String(o.title ?? "").trim(), url: String(o.url ?? ""),
          publisher: String(o.publisher ?? "").trim(), accessed: String(o.accessed ?? ""),
        });
      });
    }
  }

  let related: string[] = [];
  if (f.related !== undefined) {
    if (!Array.isArray(f.related) || f.related.some((r) => typeof r !== "string")) {
      erros.push("related tem de ser uma lista de slugs");
    } else {
      related = f.related as string[];
      if (related.length > 3) erros.push(`related tem ${related.length} slugs; no máximo 3`);
      if (new Set(related).size !== related.length) erros.push("related tem slug repetido");
      if (related.includes(slugDoArquivo)) erros.push("related não pode apontar para o próprio post");
    }
  }

  const productPath = (f.productPath ?? "/") as ProductPath;
  if (!PRODUCT_PATHS.includes(productPath)) {
    erros.push(`productPath '${String(f.productPath)}' não existe (${PRODUCT_PATHS.join(" | ")})`);
  }

  let resumo: string[] = [];
  if (f.resumo !== undefined) {
    if (!Array.isArray(f.resumo) || f.resumo.some((r) => typeof r !== "string")) {
      erros.push("resumo tem de ser uma lista de frases");
    } else {
      resumo = (f.resumo as string[]).map((r) => r.trim());
      if (resumo.length < RESUMO_MIN || resumo.length > RESUMO_MAX) {
        erros.push(`resumo tem ${resumo.length} item(ns); precisa de ${RESUMO_MIN} a ${RESUMO_MAX}`);
      }
      resumo.forEach((r, i) => {
        if (!r) erros.push(`resumo[${i}] está vazio`);
        else if (r.length > RESUMO_ITEM_MAX) erros.push(`resumo[${i}] tem ${r.length} caracteres; no máximo ${RESUMO_ITEM_MAX}`);
        else if (/^#|^[-*+]\s|\n/.test(r)) erros.push(`resumo[${i}] é uma frase, sem título, lista ou quebra de linha`);
      });
    }
  }

  erros.push(...errosDoCorpo(partes.corpo));
  const { faq, erros: errosDoFaq } = lerFaq(partes.corpo);
  erros.push(...errosDoFaq);
  erros.push(...placeholders(texto));

  if (erros.length) return { post: null, erros };
  const slug = f.slug as string;
  const caminho = `/blog/${slug}/`;
  return {
    erros,
    post: {
      slug,
      title: (f.title as string).trim(),
      ...(typeof f.seoTitle === "string" ? { seoTitle: f.seoTitle.trim() } : {}),
      description: (f.description as string).trim(),
      datePublished: f.datePublished as string,
      ...(typeof f.dateModified === "string" ? { dateModified: f.dateModified } : {}),
      intent: (f.intent as string).trim(),
      cluster: f.cluster as ClusterDoBlog,
      sources: fontes,
      related,
      productPath,
      corpo: partes.corpo.replace(/^\n+/, ""),
      // Preenchido por checagem.ts, que conhece os arquivos da pasta do post.
      imagens: {},
      resumo,
      faq,
      caminho,
      url: `${SITE_URL}${caminho}`,
    },
  };
}

/** Linhas fora de bloco de código (```), com o número da linha. */
export function linhasDeTexto(corpo: string): { n: number; l: string }[] {
  const out: { n: number; l: string }[] = [];
  let dentro = false;
  corpo.split("\n").forEach((l, i) => {
    if (/^\s*```/.test(l)) { dentro = !dentro; return; }
    if (!dentro) out.push({ n: i + 1, l });
  });
  return out;
}

/** Títulos: o H1 é o `title` (um só por página); no corpo começa em `##` e
 *  nunca pula nível — `##` direto para `####` quebra a estrutura que leitor de
 *  tela e busca usam para navegar. */
export function errosDoCorpo(corpo: string): string[] {
  const erros: string[] = [];
  if (!corpo.trim()) return ["o corpo está vazio"];
  // A imagem: alt, legenda, sozinha na linha, local e no formato certo. O
  // que depende do arquivo (existe, tamanho, dimensões) fica em checagem.ts.
  for (const img of imagensDoCorpo(linhasDeTexto(corpo))) erros.push(...errosDaImagemNoTexto(img));
  let anterior = 1;
  for (const { n, l } of linhasDeTexto(corpo)) {
    const m = l.match(/^(#{1,6})\s+\S/);
    if (!m) continue;
    const nivel = m[1].length;
    if (nivel === 1) { erros.push(`corpo, linha ${n}: '# ' não pode — o H1 é o title`); continue; }
    // O template do artigo desenha h2 e h3 (Markdown.tsx, modo artigo). Um
    // h4 sairia como texto comum — a estrutura que o autor escreveu sumiria
    // calada. Recusar é dizer isso antes de publicar.
    if (nivel > 3) { erros.push(`corpo, linha ${n}: h${nivel} não existe no template (só ## e ###)`); continue; }
    if (nivel > anterior + 1) {
      erros.push(`corpo, linha ${n}: título h${nivel} depois de h${anterior} (pulou nível)`);
    }
    anterior = nivel;
  }
  return erros;
}

/** Os marcadores de texto que não estava pronto. Os em MAIÚSCULAS são só a
 *  palavra inteira e em maiúsculas: em minúsculas, "todo" e "todos" são
 *  português, e o check não pode recusar "todo dia". */
const PLACEHOLDER_QUALQUER_CAIXA = [/lorem/i, /ipsum/i, /\[inserir/i, /placeholder/i, /example\.com/i, /exemplo\.com/i];
const PLACEHOLDER_MAIUSCULO = [/\bTODO\b/, /\bTBD\b/, /\bFIXME\b/, /\bXXX\b/];

export function placeholders(texto: string): string[] {
  const erros: string[] = [];
  texto.replace(/\r\n/g, "\n").split("\n").forEach((l, i) => {
    for (const re of [...PLACEHOLDER_QUALQUER_CAIXA, ...PLACEHOLDER_MAIUSCULO]) {
      const m = l.match(re);
      if (m) erros.push(`linha ${i + 1}: marcador de texto não pronto '${m[0]}'`);
    }
  });
  return erros;
}

/** Os links `[texto](destino)` do corpo, com a linha. Imagens (`![…](…)`)
 *  NÃO entram: o destino delas é um arquivo do post (`./x.png`), conferido
 *  pelas regras de imagem — pela de link, seria um "caminho relativo" errado. */
export function linksDoCorpo(corpo: string): { n: number; destino: string }[] {
  const out: { n: number; destino: string }[] = [];
  for (const { n, l } of linhasDeTexto(corpo)) {
    for (const m of l.matchAll(/(?<!!)\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) out.push({ n, destino: m[1] });
  }
  return out;
}
