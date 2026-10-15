import { type ReactNode } from "react";
import type { ImagemDoPost } from "@/lib/blog/tipos";

// Renderizador de markdown enxuto para as respostas do Conselheiro e os planos:
// títulos, negrito, itálico, código, listas, tabelas e divisores.
// `doc` liga o modo documento (planos): tipografia maior e seções bem separadas.
//
// `artigo` liga o modo do BLOG (renderizado no build, sem JS): títulos viram
// <h2>/<h3> de verdade, com âncora — a hierarquia de headings é o que o leitor
// de tela usa para navegar um texto longo, e um <p> estilizado não aparece
// nela —, mais links `[texto](href)` e citações `> `. É opt-in de propósito: no
// chat o texto vem da IA, e um link clicável escrito pelo modelo é outra
// conversa (de segurança). No blog o texto é do repositório, e o blog:check
// confere cada href antes do build.

const LINK_ARTIGO =
  "text-foreground underline underline-offset-2 decoration-[hsl(var(--gold-text))] hover:decoration-2";

function inline(text: string, links = false): ReactNode[] {
  const nodes: ReactNode[] = [];
  /* O `_itálico_` segue a regra do CommonMark: o `_` que abre não pode vir
     seguido de espaço nem o que fecha precedido de espaço, e nenhum dos dois
     pode estar colado em letra, número ou outro `_`. Antes, `_([^_]+)_` casava
     "_ a _" dentro de "___ a ___" (lacunas de preencher) e gerava
     "__<em> a </em>__" (Clareira, post 2). E `nome_do_arquivo` não vira mais
     itálico. Sem lookbehind de propósito — `(?<!…)` só existe no Safari
     16.4+, e um SyntaxError aqui derrubaria o chat inteiro num iPhone mais
     velho: o caractere de antes é CAPTURADO (grupo 4) e devolvido como texto. */
  const SUBLINHADO = String.raw`(^|[^\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}_])`;
  const regex = links
    ? new RegExp(String.raw`(\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|${SUBLINHADO}|\x60([^\x60]+)\x60|\[([^\]]+)\]\(([^)\s]+)\))`, "gu")
    : new RegExp(String.raw`(\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|${SUBLINHADO}|\x60([^\x60]+)\x60)`, "gu");
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) nodes.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<em key={key++}>{m[3]}</em>);
    else if (m[5] !== undefined) {
      if (m[4]) nodes.push(m[4]);
      nodes.push(<em key={key++}>{m[5]}</em>);
    }
    else if (m[6] !== undefined)
      nodes.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {m[6]}
        </code>
      );
    else if (m[7] !== undefined) {
      const externo = /^https:\/\//.test(m[8]);
      nodes.push(
        <a key={key++} href={m[8]} className={LINK_ARTIGO} {...(externo ? { rel: "noopener" } : {})}>
          {inline(m[7])}
        </a>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const isBullet = (l: string) => /^\s*[-*]\s+/.test(l);
const isNumbered = (l: string) => /^\s*\d+\.\s+/.test(l);
const isHeading = (l: string) => /^#{1,6}\s+/.test(l);
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
/** `![alt](./arquivo.png "legenda")` sozinha na linha. Só existe no artigo. */
const IMAGEM = /^\s*!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)\s*$/;
const isQuote = (l: string) => /^\s*>\s?/.test(l);
const isHr = (l: string) => /^\s*-{3,}\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(l);

function splitRow(l: string): string[] {
  return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** Âncora estável para um título: sem acento, minúscula, hífens. */
function ancora(texto: string): string {
  return texto
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "secao";
}

/* A FIGURA DO ARTIGO. Só no modo artigo e só com a imagem já resolvida pelo
   pipeline (`imagens`, indexado pelo src exato do corpo): dimensões lidas do
   arquivo no build viram width/height — o navegador reserva o espaço e o
   texto não pula quando ela carrega —, e a variante -360 vira srcset.
   No chat e nos planos não há imagem: lá a sintaxe continua texto, porque o
   texto vem da IA e uma imagem dela seria uma requisição para fora.

   A altura tem TETO: o diagrama do post 2 é vertical (720×1160), e na coluna
   do desktop ele passaria de uma tela inteira. `max-width` proporcional à
   altura da tela (85svh × largura/altura) encolhe a figura mantendo a
   proporção; no celular quem manda continua sendo a largura da coluna. */
const SIZES = "(min-width: 42rem) 40rem, calc(100vw - 2.5rem)";

function Figura({ img, alt, legenda }: { img: ImagemDoPost; alt: string; legenda: string }) {
  const proporcao = img.width / img.height;
  return (
    <figure className="mt-8 first:mt-0 mx-auto" style={{ maxWidth: `min(100%, calc(85svh * ${proporcao.toFixed(4)}))` }}>
      {/* A imagem abre sozinha, no tamanho original: é o zoom com pinça do
          celular, sem JS — no diagrama, o texto miúdo fica legível ali. O nome
          do link diz o que ele faz E o que a imagem mostra. */}
      <a
        href={img.src}
        aria-label={`Abrir a imagem em tamanho original: ${alt}`}
        className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
      <img
        src={img.src}
        width={img.width}
        height={img.height}
        {...(img.variantes.length > 1
          ? { srcSet: img.variantes.map((v) => `${v.src} ${v.width}w`).join(", "), sizes: SIZES }
          : {})}
        alt={alt}
        loading="lazy"
        decoding="async"
        // No escuro, um diagrama de fundo claro brilha mais que a página
        // inteira: um pouco menos de brilho (dark-mode.md › soften white
        // backgrounds). É a única exceção ao "só tokens": imagem não tem token.
        className="block w-full h-auto rounded-lg border bg-card dark:brightness-90"
      />
      </a>
      <figcaption className="mt-2 text-footnote text-muted-foreground text-pretty break-words">{legenda}</figcaption>
    </figure>
  );
}

export function Markdown({
  content, doc = false, artigo = false, imagens = {},
}: { content: string; doc?: boolean; artigo?: boolean; imagens?: Record<string, ImagemDoPost> }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const ids = new Map<string, number>();
  const il = (t: string) => inline(t, artigo);

  // Classes por modo: chat (compacto), documento (planos) e artigo (blog —
  // a especificação de leitura da Prisma: corpo 17/27, h2 22/28, h3 20/25).
  const cls = artigo
    ? {
        h12: "font-display font-semibold text-title2 mt-12 mb-3 first:mt-0 text-balance break-words hyphens-auto scroll-mt-20",
        h3: "font-semibold text-title3 mt-8 mb-2 first:mt-0 text-balance break-words hyphens-auto scroll-mt-20",
        p: "mt-5 first:mt-0 text-pretty break-words",
        // Listas quebram palavra como os parágrafos: a 40 pt
        // "desnecessariamente" num item estourava a tela (Lince, post 3).
        ul: "list-disc pl-5 space-y-2 mt-5 break-words hyphens-auto",
        ol: "list-decimal pl-5 space-y-2 mt-5 break-words hyphens-auto",
      }
    : doc
    ? {
        h12: "font-display font-semibold text-lg mt-6 mb-2 first:mt-0 pb-1.5 border-b",
        h3: "font-semibold text-[0.95rem] mt-4 mb-1.5 first:mt-0",
        p: "my-2 first:mt-0 last:mb-0 leading-relaxed",
        ul: "list-disc pl-5 space-y-1 my-2",
        ol: "list-decimal pl-5 space-y-1 my-2",
      }
    : {
        h12: "font-display font-semibold text-[0.95rem] mt-2.5 mb-1 first:mt-0",
        h3: "font-semibold mt-2 mb-0.5 first:mt-0",
        p: "my-1 first:mt-0 last:mb-0 leading-relaxed",
        ul: "list-disc pl-5 space-y-0.5 my-1.5",
        ol: "list-decimal pl-5 space-y-0.5 my-1.5",
      };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Divisor
    if (isHr(line)) {
      // No artigo, o divisor é um fio neutro: a `ascend-line` dourada aparece
      // uma vez só, no fim (assinatura) — a especificação limita o ouro.
      blocks.push(<div key={key++} className={artigo ? "border-t my-10" : doc ? "ascend-line my-5" : "ascend-line my-3"} aria-hidden />);
      i++;
      continue;
    }

    // Tabela: linha | ... | seguida do separador |---|
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && !isTableSep(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className={artigo ? "mt-5 overflow-x-auto rounded-lg border" : "my-2.5 overflow-x-auto rounded-lg border"}>
          <table className="w-full text-[0.85rem]">
            <thead>
              <tr className="bg-muted/60">
                {header.map((c, j) => (
                  <th key={j} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{il(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t">
                  {r.map((c, cj) => (
                    <td key={cj} className="px-3 py-1.5 align-top">{il(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const fig = artigo ? IMAGEM.exec(line) : null;
    if (fig) {
      const [, alt, src, legenda] = fig;
      const img = imagens[src];
      // O blog:check garante alt, legenda e arquivo; chegar aqui sem eles é
      // bug do pipeline — publicar uma figura sem dimensão, sem alt ou
      // quebrada seria pior que o build falhar.
      if (!img) throw new Error(`imagem do artigo sem resolução no pipeline: ${src}`);
      if (!alt.trim() || !legenda?.trim()) throw new Error(`imagem do artigo sem alt ou legenda: ${src}`);
      blocks.push(<Figura key={key++} img={img} alt={alt.trim()} legenda={legenda.trim()} />);
      i++;
      continue;
    }

    // Citação (só no artigo): linhas `> ` seguidas viram um bloco só.
    if (artigo && isQuote(line)) {
      const para: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        para.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="mt-5 border-l-2 border-border pl-4 text-muted-foreground text-pretty">
          {il(para.join(" "))}
        </blockquote>
      );
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h && artigo) {
      // O H1 do artigo é o título do post (fora daqui): `#` no corpo desce a
      // h2, e de `###` para baixo é h3 — não há h4 na especificação.
      const texto = h[2].trim();
      const base = ancora(texto.replace(/[*_`]/g, ""));
      const n = (ids.get(base) ?? 0) + 1;
      ids.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      blocks.push(
        h[1].length <= 2
          ? <h2 key={key++} id={id} className={cls.h12}>{il(texto)}</h2>
          : <h3 key={key++} id={id} className={cls.h3}>{il(texto)}</h3>
      );
      i++;
      continue;
    }
    if (h) {
      blocks.push(
        <p key={key++} className={h[1].length <= 2 ? cls.h12 : cls.h3}>{inline(h[2])}</p>
      );
      i++;
      continue;
    }

    if (isBullet(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(<li key={items.length}>{il(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>);
        i++;
      }
      blocks.push(<ul key={key++} className={cls.ul}>{items}</ul>);
      continue;
    }

    if (isNumbered(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(<li key={items.length}>{il(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>);
        i++;
      }
      blocks.push(<ol key={key++} className={cls.ol}>{items}</ol>);
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !isHeading(lines[i]) && !isBullet(lines[i]) && !isNumbered(lines[i]) &&
      !isTableRow(lines[i]) && !isHr(lines[i]) && !(artigo && (isQuote(lines[i]) || IMAGEM.test(lines[i])))
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++} className={cls.p}>{il(para.join(" "))}</p>);
  }

  return <div>{blocks}</div>;
}