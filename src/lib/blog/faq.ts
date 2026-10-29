// ASCENDE — Blog: a seção "## Perguntas frequentes" do corpo vira FAQPage.
//
// O FAQPage JSON-LD é o que um buscador ou uma IA pode citar como resposta
// pronta — por isso a resposta tem fronteira exata, combinada com a Clareira
// (docs/blog/EDITORIAL.md §6):
//
//   ## Perguntas frequentes        ← a ÚLTIMA seção do corpo
//
//   ### Pergunta que termina em?   ← 2 a 6
//
//   Um parágrafo só: a resposta.   ← exatamente UM parágrafo
//
//   ---                            ← opcional: depois dele, só o aviso
//                                    educativo final, sem título
//
// O parágrafo de produto ("Se quiser guardar… no Ascende") fica ANTES do FAQ:
// produto dentro de uma resposta do FAQPage seria o Ascende citando a si
// mesmo como resposta a uma dúvida de saúde ou dinheiro.
import type { PerguntaDoPost } from "@/lib/blog/tipos";

export const TITULO_DO_FAQ = "Perguntas frequentes";
export const FAQ_MIN = 2;
export const FAQ_MAX = 6;

interface Bloco { n: number; linhas: string[] }

const ehHr = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
const ehTitulo = (l: string) => /^#{1,6}\s+\S/.test(l);
/** Parágrafo = texto corrido: não é lista, citação, imagem, tabela, título,
 *  divisor nem bloco de código. */
const ehParagrafo = (b: Bloco) => {
  const l = b.linhas[0];
  return !/^\s*([-*+]\s|\d+[.)]\s|>|!\[|\||```)/.test(l) && !ehTitulo(l) && !ehHr(l);
};

/** As linhas do corpo em blocos separados por linha em branco; título e
 *  divisor são sempre um bloco sozinho. Código cercado é um bloco só. */
function blocos(linhas: string[], inicio: number): Bloco[] {
  const out: Bloco[] = [];
  let atual: Bloco | null = null;
  let codigo = false;
  for (let i = inicio; i < linhas.length; i++) {
    const l = linhas[i];
    const n = i + 1;
    if (codigo) { atual!.linhas.push(l); if (/^\s*```/.test(l)) { codigo = false; atual = null; } continue; }
    if (!l.trim()) { atual = null; continue; }
    if (/^\s*```/.test(l)) { atual = { n, linhas: [l] }; out.push(atual); codigo = true; continue; }
    if (ehTitulo(l) || ehHr(l)) { out.push({ n, linhas: [l] }); atual = null; continue; }
    if (atual) atual.linhas.push(l);
    else { atual = { n, linhas: [l] }; out.push(atual); }
  }
  return out;
}

export function lerFaq(corpo: string): { faq: PerguntaDoPost[]; erros: string[] } {
  const linhas = corpo.split("\n");
  const erros: string[] = [];
  // Fora de bloco de código.
  let codigo = false;
  const titulos: { n: number; nivel: number; texto: string }[] = [];
  linhas.forEach((l, i) => {
    if (/^\s*```/.test(l)) { codigo = !codigo; return; }
    const m = !codigo && l.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (m) titulos.push({ n: i + 1, nivel: m[1].length, texto: m[2] });
  });

  const parecidos = titulos.filter((t) => t.texto.toLowerCase().replace(/[:.]$/, "") === TITULO_DO_FAQ.toLowerCase());
  const exatos = parecidos.filter((t) => t.nivel === 2 && t.texto === TITULO_DO_FAQ);
  for (const t of parecidos) {
    if (!exatos.includes(t)) erros.push(`corpo, linha ${t.n}: o FAQ é exatamente '## ${TITULO_DO_FAQ}'`);
  }
  if (exatos.length > 1) erros.push(`corpo: '## ${TITULO_DO_FAQ}' aparece ${exatos.length} vezes; é uma seção só`);
  if (exatos.length !== 1) return { faq: [], erros };

  const sec = exatos[0];
  const depois = titulos.filter((t) => t.n > sec.n && t.nivel <= 2);
  if (depois.length) {
    erros.push(`corpo, linha ${depois[0].n}: '## ${TITULO_DO_FAQ}' tem de ser a última seção do corpo`);
  }

  const faq: PerguntaDoPost[] = [];
  const bs = blocos(linhas, sec.n);
  let i = 0;
  if (bs[0] && !/^###\s/.test(bs[0].linhas[0])) {
    erros.push(`corpo, linha ${bs[0].n}: logo abaixo de '## ${TITULO_DO_FAQ}' vem a primeira '### Pergunta?'`);
  }
  while (i < bs.length) {
    const b = bs[i];
    const l = b.linhas[0];
    if (ehHr(l)) {
      // O aviso final: só parágrafos, sem título.
      for (const r of bs.slice(i + 1)) {
        if (!ehParagrafo(r)) erros.push(`corpo, linha ${r.n}: depois do '---' do FAQ só vem o aviso final, em parágrafo`);
      }
      break;
    }
    const q = l.match(/^###\s+(.*?)\s*$/);
    if (!q) { i++; continue; } // já reportado (bloco a mais, abaixo) ou o primeiro bloco
    const pergunta = q[1];
    if (!pergunta.endsWith("?")) erros.push(`corpo, linha ${b.n}: a pergunta do FAQ termina em '?' ('${pergunta}')`);
    const resp = bs[i + 1];
    if (!resp || !ehParagrafo(resp)) {
      erros.push(`corpo, linha ${b.n}: '${pergunta}' precisa de UM parágrafo de resposta logo abaixo`);
      i++;
      continue;
    }
    const prox = bs[i + 2];
    if (prox && !/^###\s/.test(prox.linhas[0]) && !ehHr(prox.linhas[0])) {
      erros.push(`corpo, linha ${prox.n}: a resposta de '${pergunta}' é UM parágrafo; o que vem depois da última resposta precisa de '---' antes`);
      // pula até o próximo ### ou ---
      let j = i + 2;
      while (j < bs.length && !/^###\s/.test(bs[j].linhas[0]) && !ehHr(bs[j].linhas[0])) j++;
      faq.push({ pergunta, resposta: resp.linhas.join(" ").trim() });
      i = j;
      continue;
    }
    faq.push({ pergunta, resposta: resp.linhas.join(" ").trim() });
    i += 2;
  }
  if (faq.length < FAQ_MIN || faq.length > FAQ_MAX) {
    erros.push(`corpo: o FAQ tem ${faq.length} pergunta(s); precisa de ${FAQ_MIN} a ${FAQ_MAX}`);
  }
  return { faq: erros.length ? [] : faq, erros };
}

/** Markdown inline → texto: o que vai para o JSON-LD (`[t](u)` → t, sem
 *  `**`, `_`, `` ` ``). */
export function textoPlano(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\p{L}\p{N}])[*_]([^*_]+)[*_](?=$|[^\p{L}\p{N}])/gu, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
