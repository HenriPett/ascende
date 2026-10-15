// ASCENDE — Blog: a checagem da COLEÇÃO, o que nenhum arquivo sabe sozinho.
//
// `npm run blog:check` e o build passam por aqui. Um post só entra no ar se a
// coleção inteira estiver de pé: slug e intenção únicos — inclusive contra o
// HISTÓRICO, para um post apagado não voltar como "novo" com outra roupa —,
// `related` apontando para quem existe, e links internos que resolvem.
import { PAGINAS_PUBLICAS } from "@/lib/blog/sitemap";
import { linhasDeTexto, linksDoCorpo, lerPost, normalizarIntencao } from "@/lib/blog/post";
import { conferirImagens, imagensDoCorpo } from "@/lib/blog/imagem";
import type { LinhaDoIndice } from "@/lib/blog/indice";
import type { PostDoBlog } from "@/lib/blog/tipos";

export interface ArquivoDePost {
  nome: string;   // <slug>.md
  texto: string;
}

export interface ResultadoDaChecagem {
  /** Em ordem de publicação, do mais novo para o mais antigo. */
  posts: PostDoBlog[];
  /** `arquivo: mensagem`. Vazio = a coleção pode ir ao ar. */
  erros: string[];
  /** Imagens a copiar: destino relativo a dist/ → { slug, nome } na pasta
   *  content/blog/img/<slug>/. Só o que algum post usa. */
  copias: Record<string, { slug: string; nome: string }>;
}

/** As pastas de imagem: slug → (nome do arquivo → bytes). */
export type PastasDeImagem = Record<string, Record<string, Uint8Array>>;

/** Do mais novo para o mais antigo; slug desempata, para a ordem nunca
 *  depender da ordem em que o sistema de arquivos listou os arquivos. */
export const porPublicacao = (a: PostDoBlog, b: PostDoBlog) =>
  b.datePublished.localeCompare(a.datePublished) || a.slug.localeCompare(b.slug);

/** Destino de um link interno é uma página que existe? */
function destinoInternoExiste(destino: string, slugs: Set<string>): boolean {
  const caminho = destino.split("#")[0].split("?")[0];
  if (caminho === "") return true; // âncora na própria página
  if (PAGINAS_PUBLICAS.some((p) => p.caminho === caminho)) return true;
  if (caminho === "/blog" || caminho === "/blog/") return slugs.size > 0;
  const m = caminho.match(/^\/blog\/([^/]+)\/?$/);
  return !!m && slugs.has(m[1]);
}

export function checarColecao(
  arquivos: ArquivoDePost[], indice: LinhaDoIndice[], hoje: string, pastasDeImagem: PastasDeImagem = {},
): ResultadoDaChecagem {
  const erros: string[] = [];
  const posts: PostDoBlog[] = [];
  const copias: ResultadoDaChecagem["copias"] = {};

  for (const a of arquivos) {
    const { post, erros: e } = lerPost(a.nome, a.texto, hoje);
    erros.push(...e.map((m) => `${a.nome}: ${m}`));
    if (!post) continue;
    // As imagens: cada uma existe na pasta DO POST, no formato e tamanho
    // certos, com as dimensões lidas do arquivo — e a pasta não tem sobra.
    const conf = conferirImagens(post.slug, imagensDoCorpo(linhasDeTexto(post.corpo)), pastasDeImagem[post.slug]);
    erros.push(...conf.erros);
    post.imagens = conf.imagens;
    for (const [destino, nome] of Object.entries(conf.copias)) copias[destino] = { slug: post.slug, nome };
    posts.push(post);
  }
  // Pasta de imagem sem post é sobra: nada dela seria publicado, e o nome
  // errado (um slug digitado diferente) é exatamente o que ela costuma ser.
  for (const slug of Object.keys(pastasDeImagem)) {
    if (!arquivos.some((a) => a.nome === `${slug}.md`)) {
      erros.push(`content/blog/img/${slug}/: não há post com esse slug`);
    }
  }

  // Slugs únicos. Com o slug igual ao nome do arquivo, só se repete se dois
  // arquivos disserem o mesmo slug — o que lerPost já pega; fica a trava.
  const slugs = new Set<string>();
  for (const p of posts) {
    if (slugs.has(p.slug)) erros.push(`${p.slug}.md: slug repetido`);
    slugs.add(p.slug);
  }

  // Intenção única, entre os posts E contra o histórico do INDICE. É ISTO que
  // impede a duplicata que a rotina de publicação mais arrisca: o mesmo
  // assunto com outra palavra no título.
  const donoDaIntencao = new Map<string, string>();
  for (const l of indice) donoDaIntencao.set(normalizarIntencao(l.intent), l.slug);
  const vistas = new Map<string, string>();
  for (const p of posts) {
    const k = normalizarIntencao(p.intent);
    const outro = vistas.get(k);
    if (outro) erros.push(`${p.slug}.md: a intenção repete a de '${outro}'`);
    vistas.set(k, p.slug);
    const doHistorico = donoDaIntencao.get(k);
    if (doHistorico && doHistorico !== p.slug) {
      erros.push(`${p.slug}.md: a intenção já foi respondida por '${doHistorico}' (INDICE.md)`);
    }
  }

  // `related` e links internos: só destinos que existem nesta coleção.
  const dosLidos = new Set(posts.map((p) => p.slug));
  for (const p of posts) {
    for (const r of p.related) {
      if (!dosLidos.has(r)) erros.push(`${p.slug}.md: related '${r}' não existe`);
    }
    for (const { n, destino } of linksDoCorpo(p.corpo)) {
      if (/^https:\/\//.test(destino)) continue;
      if (destino.startsWith("/") || destino.startsWith("#")) {
        if (!destinoInternoExiste(destino, dosLidos)) {
          erros.push(`${p.slug}.md: corpo, linha ${n}: link interno '${destino}' não resolve`);
        }
        continue;
      }
      erros.push(`${p.slug}.md: corpo, linha ${n}: link '${destino}' tem de ser https:// ou um caminho interno /…`);
    }
  }

  // O HISTÓRICO É IMUTÁVEL. Um slug publicado é uma URL que já saiu — em
  // busca, em compartilhamento, no RSS de alguém. Ele não some e não muda de
  // nome em silêncio: tirar um post do ar é decisão explícita, editando o
  // INDICE.md à mão, e o check obriga essa decisão a acontecer.
  const doIndice = new Map(indice.map((l) => [l.slug, l]));
  for (const l of indice) {
    if (!dosLidos.has(l.slug) && !arquivos.some((a) => a.nome === `${l.slug}.md`)) {
      erros.push(`INDICE.md: '${l.slug}' foi publicado e o arquivo sumiu (slug é imutável; tirar do ar é decisão explícita no INDICE)`);
    }
  }
  for (const p of posts) {
    const l = doIndice.get(p.slug);
    if (!l) {
      erros.push(`${p.slug}.md: não está no INDICE.md — rode 'npm run blog:indice' e confira o diff`);
      continue;
    }
    // A data de publicação é a do dia em que o post FOI ao ar. Reescrevê-la
    // seria inventar data (regra 3 do plano): mudança vai em dateModified.
    if (l.datePublished !== p.datePublished) {
      erros.push(`${p.slug}.md: datePublished de post publicado não muda (era ${l.datePublished}); a mudança vai em dateModified`);
      continue;
    }
    if (l.intent !== p.intent || l.cluster !== p.cluster || (l.dateModified ?? "") !== (p.dateModified ?? "")) {
      erros.push(`${p.slug}.md: o INDICE.md está desatualizado para este post — rode 'npm run blog:indice'`);
    }
  }

  return { posts: posts.sort(porPublicacao), erros, copias };
}
