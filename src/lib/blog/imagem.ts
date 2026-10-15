// ASCENDE — Blog: a imagem do post, mínima e segura (PLANO-2).
//
// O contrato: só imagem LOCAL do próprio post (content/blog/img/<slug>/), em
// PNG, JPEG ou WebP — nunca URL externa (é outro site decidindo o que aparece
// no nosso artigo, e quebra quando ele muda) e nunca SVG servido (a fonte do
// texto dentro do SVG não existe no iPhone, e o diagrama sai com outra letra).
// No corpo, `![alt](./arquivo.png "legenda com crédito")`, SOZINHA na linha.
//
// As dimensões são lidas do CABEÇALHO do arquivo, no build, sem dependência:
// cada formato diz largura e altura nos primeiros bytes. Com width/height
// reais no <img>, a página não pula quando a imagem chega — e o número não é
// digitado por ninguém, então não erra.
import type { ImagemDoPost } from "@/lib/blog/tipos";

/** Os formatos aceitos, pela extensão. `.jpeg` não: uma grafia só. */
export const EXTENSOES = { png: "png", jpg: "jpeg", webp: "webp" } as const;
export type Formato = (typeof EXTENSOES)[keyof typeof EXTENSOES];

/** 500 KB. Um diagrama de artigo não precisa de mais; acima disto, é foto sem
 *  compressão — e quem paga é quem lê no 4G. */
export const LIMITE_BYTES = 500 * 1024;

/** Texto alternativo: obrigatório e DESCRITIVO. 20 caracteres é o piso de uma
 *  frase que diz o que a imagem mostra ("Diagrama da revisão semanal"), não um
 *  rótulo ("imagem 1"). O teto é o que um leitor de tela lê sem cansar. */
export const ALT_MIN = 20;
export const ALT_MAX = 250;
/** Legenda (o `title` do markdown): obrigatória, porque leva o crédito. */
export const LEGENDA_MIN = 10;
export const LEGENDA_MAX = 200;

/** Variante estreita para o `srcset`: `<nome>-360.<ext>`, 360 px de largura. */
export const LARGURA_DA_VARIANTE = 360;

export interface Dimensoes { formato: Formato; width: number; height: number }

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** Formato e dimensões REAIS pelo cabeçalho, ou `null` se não for um PNG,
 *  JPEG ou WebP legível. Não confia na extensão. */
export function lerDimensoes(b: Uint8Array): Dimensoes | null {
  // PNG: assinatura de 8 bytes; o primeiro chunk é o IHDR, com largura e
  // altura em 32 bits big-endian nos bytes 16 e 20.
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") {
    return { formato: "png", width: u32be(b, 16), height: u32be(b, 20) };
  }
  // JPEG: FF D8, e então segmentos. As dimensões estão no segmento SOFn
  // (C0–CF, menos C4, C8 e CC, que são tabelas): altura em +5, largura em +7.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marcador = b[i + 1];
      if (marcador === 0xff) { i++; continue; } // preenchimento
      if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) { i += 2; continue; }
      const tamanho = u16be(b, i + 2);
      if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
        return { formato: "jpeg", width: u16be(b, i + 7), height: u16be(b, i + 5) };
      }
      if (tamanho < 2) return null;
      i += 2 + tamanho;
    }
    return null;
  }
  // WebP: RIFF....WEBP e um de três chunks.
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 ") { // com perdas: 14 bits cada, depois do código de início 9D 01 2A
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      return { formato: "webp", width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    }
    if (chunk === "VP8L") { // sem perdas: assinatura 2F, e 14 bits de (largura−1) e (altura−1)
      if (b[20] !== 0x2f) return null;
      const width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
      const height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
      return { formato: "webp", width, height };
    }
    if (chunk === "VP8X") { // estendido: 24 bits little-endian de (largura−1) e (altura−1)
      return { formato: "webp", width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
    }
  }
  return null;
}

/** Uma imagem escrita no corpo. */
export interface ImagemNoCorpo {
  n: number;
  alt: string;
  src: string;
  legenda: string | null;
  /** A linha tem SÓ a imagem? (o template a desenha como bloco, <figure>) */
  sozinha: boolean;
}

const IMAGEM_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g;

export function imagensDoCorpo(linhas: { n: number; l: string }[]): ImagemNoCorpo[] {
  const out: ImagemNoCorpo[] = [];
  for (const { n, l } of linhas) {
    const todas = [...l.matchAll(IMAGEM_RE)];
    for (const m of todas) {
      out.push({
        n, alt: m[1].trim(), src: m[2], legenda: m[3] === undefined ? null : m[3].trim(),
        sozinha: todas.length === 1 && l.trim() === m[0],
      });
    }
  }
  return out;
}

const NOME_RE = /^\.\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(png|jpg|webp)$/;

/** O que dá para saber olhando só o texto (sem os arquivos). */
export function errosDaImagemNoTexto(img: ImagemNoCorpo): string[] {
  const erros: string[] = [];
  const onde = `corpo, linha ${img.n}: imagem '${img.src}'`;
  if (!img.sozinha) erros.push(`${onde}: tem de estar sozinha na linha (é desenhada como bloco, não no meio do texto)`);
  if (img.alt.length < ALT_MIN) {
    erros.push(`${onde}: alt com ${img.alt.length} caracteres — precisa descrever o que a imagem mostra (${ALT_MIN} a ${ALT_MAX})`);
  } else if (img.alt.length > ALT_MAX) {
    erros.push(`${onde}: alt com ${img.alt.length} caracteres; no máximo ${ALT_MAX}`);
  }
  if (img.legenda === null || img.legenda.length < LEGENDA_MIN) {
    erros.push(`${onde}: falta a legenda com o crédito — ![alt](./arquivo.png "legenda") (${LEGENDA_MIN} a ${LEGENDA_MAX} caracteres)`);
  } else if (img.legenda.length > LEGENDA_MAX) {
    erros.push(`${onde}: legenda com ${img.legenda.length} caracteres; no máximo ${LEGENDA_MAX}`);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(img.src) || img.src.startsWith("//")) {
    erros.push(`${onde}: só imagem local do post — nada de URL externa`);
  } else if (/\.svg$/i.test(img.src)) {
    erros.push(`${onde}: SVG não é servido (a fonte do texto do SVG não existe no iPhone); exporte PNG, JPEG ou WebP`);
  } else if (!NOME_RE.test(img.src)) {
    erros.push(`${onde}: tem de ser './<nome>.(png|jpg|webp)', na pasta do próprio post, com nome em minúsculas e hífens`);
  }
  return erros;
}

export interface ImagensConferidas {
  /** Pelo `src` exato do corpo. */
  imagens: Record<string, ImagemDoPost>;
  /** Destino relativo a dist/ → nome do arquivo na pasta do post. */
  copias: Record<string, string>;
  erros: string[];
}

/**
 * Confere as imagens de UM post contra os arquivos da pasta dele
 * (content/blog/img/<slug>/). `pasta` é nome → bytes; `undefined` = a pasta
 * não existe.
 *
 * A pasta publica EXATAMENTE o que o post usa: arquivo que nenhuma imagem
 * referencia (e que não é a variante -360 de uma referenciada) é erro, para
 * nada entrar em dist/ sem estar no texto.
 */
export function conferirImagens(
  slug: string, imgs: ImagemNoCorpo[], pasta: Record<string, Uint8Array> | undefined,
): ImagensConferidas {
  const imagens: ImagensConferidas["imagens"] = {};
  const copias: Record<string, string> = {};
  const erros: string[] = [];
  const usados = new Set<string>();
  const publicado = (nome: string) => `/blog/${slug}/${nome}`;

  for (const img of imgs) {
    const m = img.src.match(NOME_RE);
    if (!m || imagens[img.src]) continue; // forma errada já é erro de texto; repetida reaproveita
    const [, base, ext] = m;
    const nome = `${base}.${ext}`;
    const onde = `imagem '${img.src}'`;
    const bytes = pasta?.[nome];
    if (!bytes) { erros.push(`${onde}: o arquivo content/blog/img/${slug}/${nome} não existe`); continue; }
    usados.add(nome);

    const conferir = (arquivo: string, b: Uint8Array): Dimensoes | null => {
      if (b.length > LIMITE_BYTES) {
        erros.push(`${onde}: ${arquivo} tem ${Math.ceil(b.length / 1024)} KB; o limite é ${LIMITE_BYTES / 1024} KB`);
      }
      const d = lerDimensoes(b);
      if (!d) { erros.push(`${onde}: ${arquivo} não é um PNG, JPEG ou WebP legível`); return null; }
      const esperado = EXTENSOES[arquivo.split(".").pop() as keyof typeof EXTENSOES];
      if (d.formato !== esperado) {
        erros.push(`${onde}: ${arquivo} é ${d.formato.toUpperCase()} com extensão .${arquivo.split(".").pop()}`);
        return null;
      }
      return d;
    };

    const d = conferir(nome, bytes);
    if (!d) continue;
    const variantes = [{ src: publicado(nome), width: d.width }];
    copias[`blog/${slug}/${nome}`] = nome;

    const nomeVariante = `${base}-${LARGURA_DA_VARIANTE}.${ext}`;
    const bv = pasta?.[nomeVariante];
    if (bv) {
      usados.add(nomeVariante);
      const dv = conferir(nomeVariante, bv);
      if (dv) {
        // A variante é a MESMA imagem, mais estreita: largura exata e a mesma
        // proporção (1 px de folga pelo arredondamento). Outra proporção faria
        // o navegador desenhar uma figura diferente no celular.
        const proporcao = Math.round((d.height * dv.width) / d.width);
        if (dv.width !== LARGURA_DA_VARIANTE) {
          erros.push(`${onde}: a variante ${nomeVariante} tem ${dv.width} px de largura; precisa de ${LARGURA_DA_VARIANTE}`);
        } else if (Math.abs(proporcao - dv.height) > 1) {
          erros.push(`${onde}: a variante ${nomeVariante} (${dv.width}×${dv.height}) não tem a proporção da original (${d.width}×${d.height})`);
        } else if (dv.width >= d.width) {
          erros.push(`${onde}: a variante ${nomeVariante} não é mais estreita que a original`);
        } else {
          variantes.unshift({ src: publicado(nomeVariante), width: dv.width });
          copias[`blog/${slug}/${nomeVariante}`] = nomeVariante;
        }
      }
    }
    imagens[img.src] = { src: publicado(nome), width: d.width, height: d.height, variantes };
  }

  for (const nome of Object.keys(pasta ?? {}).sort()) {
    if (!usados.has(nome)) {
      erros.push(`content/blog/img/${slug}/${nome} não é usado por nenhuma imagem do post (a pasta publica só o que o texto mostra)`);
    }
  }
  return { imagens, copias, erros: erros.map((e) => `${slug}.md: ${e}`) };
}
