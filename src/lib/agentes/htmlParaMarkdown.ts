// ASCENDE — HTML pré-renderizado → Markdown, para as páginas cujo texto vive
// em JSX (Landing, Recusas) e não num .md. Sem dependência: o HTML de entrada
// é o do NOSSO renderToString, não HTML qualquer da web — então basta cobrir
// o que as nossas páginas usam (títulos, parágrafos, listas, links, ênfase,
// citação) e descartar o resto (svg, botões de interface, o que é
// aria-hidden).

const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'",
};
const decodificar = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (ENTIDADES[k] !== undefined) return ENTIDADES[k];
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(Number(k.slice(1)));
    return m;
  });

const VAZIOS = new Set(["br", "hr", "img", "input", "meta", "link", "source", "wbr"]);
/** Descartados COM o conteúdo. */
const DESCARTAR = new Set(["svg", "script", "style", "button", "form", "noscript", "template", "input", "textarea", "select",
  // A moldura do site (logo, "Entrar", "Voltar ao início") se repete em toda
  // página e não é conteúdo dela; o rodapé (aviso de saúde, links legais) fica.
  "header", "nav"]);
const BLOCOS = new Set(["p", "div", "section", "article", "main", "header", "footer", "nav", "aside", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "figure", "figcaption", "details", "summary", "dl", "dt", "dd", "table", "tr"]);

interface No { tag: string; attrs: string; filhos: (No | string)[] }

function arvore(html: string): No {
  const raiz: No = { tag: "#raiz", attrs: "", filhos: [] };
  const pilha: No[] = [raiz];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (const m of html.matchAll(re)) {
    const topo = pilha[pilha.length - 1];
    if (m[4] !== undefined) { topo.filhos.push(m[4]); continue; }
    if (!m[1]) continue; // comentário
    const tag = m[1].toLowerCase();
    if (m[0].startsWith("</")) {
      const i = pilha.map((n) => n.tag).lastIndexOf(tag);
      if (i > 0) pilha.length = i;
      continue;
    }
    const no: No = { tag, attrs: m[2], filhos: [] };
    topo.filhos.push(no);
    if (!m[3] && !VAZIOS.has(tag)) pilha.push(no);
  }
  return raiz;
}

const attr = (no: No, nome: string) => no.attrs.match(new RegExp(`\\b${nome}="([^"]*)"`))?.[1];
/** O que nem quem lê a tela ouve (decoração) não vai para o Markdown. */
const escondido = (no: No) => attr(no, "aria-hidden") === "true" ||
  /(^|\s)hidden(\s|=|$)/.test(no.attrs.replace(/"[^"]*"/g, '""')); // o ATRIBUTO hidden, não a classe do Tailwind

/** Junta pedaços inline. Dois elementos lado a lado sem espaço no HTML (um
 *  link-botão e o texto seguinte, num flex) colariam no Markdown:
 *  `[Entrar](…)Começar` — entre um link e uma palavra entra um espaço. */
function juntar(pedacos: string[]): string {
  let out = "";
  for (const p of pedacos) {
    if (out && /\)$/.test(out) && /^[\p{L}\p{N}[]/u.test(p)) out += " ";
    out += p;
  }
  return out;
}

/** Texto inline de um nó (links, ênfase), em uma linha. */
function inline(n: No | string, base: string): string {
  if (typeof n === "string") return decodificar(n).replace(/\s+/g, " ");
  if (DESCARTAR.has(n.tag) || escondido(n)) return "";
  if (n.tag === "br") return "\n";
  if (n.tag === "img") { const alt = attr(n, "alt"); return alt ? decodificar(alt) : ""; }
  const dentro = juntar(n.filhos.map((f) => inline(f, base)));
  const t = dentro.trim();
  if (!t) return dentro.includes(" ") ? " " : "";
  if (n.tag === "strong" || n.tag === "b") return `**${t}**`;
  if (n.tag === "em" || n.tag === "i") return `_${t}_`;
  if (n.tag === "code") return `\`${t}\``;
  if (n.tag === "a") {
    const href = attr(n, "href");
    if (!href || href.startsWith("#")) return dentro;
    return `[${t}](${href.startsWith("/") ? base + href : decodificar(href)})`;
  }
  return dentro;
}

function blocos(n: No | string, base: string, out: string[]): void {
  if (typeof n === "string") { const t = inline(n, base).trim(); if (t) out.push(t); return; }
  if (DESCARTAR.has(n.tag) || escondido(n)) return;
  const h = n.tag.match(/^h([1-6])$/);
  if (h) { const t = inline(n, base).trim(); if (t) out.push(`${"#".repeat(Number(h[1]))} ${t}`); return; }
  if (n.tag === "p" || n.tag === "figcaption" || n.tag === "summary" || n.tag === "dt") {
    const t = inline(n, base).trim().replace(/ *\n */g, "  \n");
    if (t) out.push(t);
    return;
  }
  if (n.tag === "blockquote") {
    const dentro: string[] = [];
    for (const f of n.filhos) blocos(f, base, dentro);
    if (dentro.length) out.push(dentro.join("\n\n").split("\n").map((l) => `> ${l}`.trimEnd()).join("\n"));
    return;
  }
  if (n.tag === "ul" || n.tag === "ol") {
    let i = 1;
    const itens: string[] = [];
    for (const f of n.filhos) {
      if (typeof f === "string" || f.tag !== "li") continue;
      const dentro: string[] = [];
      blocos(f, base, dentro);
      // Numeração desenhada à mão dentro do <li> de um <ol> ("1", "2"…) já é
      // a do Markdown: sem isso sairia "1. 1".
      if (n.tag === "ol" && /^\d+\.?$/.test(dentro[0] ?? "")) dentro.shift();
      if (!dentro.length) continue;
      const marca = n.tag === "ol" ? `${i++}. ` : "- ";
      itens.push(marca + dentro.join("\n\n").split("\n").map((l, j) => (j && l ? " ".repeat(marca.length) + l : l)).join("\n"));
    }
    if (itens.length) out.push(itens.join("\n"));
    return;
  }
  // Bloco genérico (div, section, li…): junta o texto inline seguido e
  // desce nos blocos filhos.
  let corrida: string[] = [];
  const descarregar = () => { const t = juntar(corrida).trim(); if (t) out.push(t.replace(/ *\n */g, "  \n")); corrida = []; };
  for (const f of n.filhos) {
    if (typeof f !== "string" && (BLOCOS.has(f.tag))) { descarregar(); blocos(f, base, out); }
    else corrida.push(inline(f, base));
  }
  descarregar();
}

/** `base`: origem para tornar absolutos os links internos (`/recusas` →
 *  `https://ascende.site/recusas`), porque o Markdown sai do contexto do site. */
export function htmlParaMarkdown(html: string, base: string): string {
  const out: string[] = [];
  blocos(arvore(html), base, out);
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
