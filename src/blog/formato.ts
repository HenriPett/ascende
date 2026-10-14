// ASCENDE — Blog: o que os templates calculam a partir do post, como regra
// pura e testada. Nada aqui é escrito à mão em post nenhum: a data por
// extenso e o tempo de leitura saem do frontmatter e do corpo.

import type { ClusterDoBlog } from "@/lib/blog/tipos";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-10-14" → "14 de outubro de 2026". Lido da STRING, sem `Date`: um
 *  `new Date("2026-10-14")` é meia-noite em UTC, que no fuso de São Paulo
 *  ainda é dia 13 — e a data impressa mentiria por um dia. */
export function dataPorExtenso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`data fora do formato AAAA-MM-DD: ${iso}`);
  const mes = MESES[Number(m[2]) - 1];
  if (!mes) throw new Error(`mês inválido: ${iso}`);
  return `${Number(m[3])} de ${mes} de ${m[1]}`;
}

/** Minutos de leitura: palavras ÷ 200, arredondado para cima, no mínimo 1.
 *  A marcação do markdown não conta como palavra; o texto de um link conta. */
export function minutosDeLeitura(corpo: string): number {
  const texto = corpo
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|-]+/g, " ");
  const palavras = texto.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.ceil(palavras / 200));
}

/** O nome do cluster na meta do cartão — texto, não selo colorido: as cores
 *  do app significam pilares, e cluster não é pilar. */
export const ROTULO_DO_CLUSTER: Record<ClusterDoBlog, string> = {
  "rotina-integrada": "Rotina integrada",
  "alimentacao-orcamento": "Alimentação e orçamento",
  "ia-privacidade": "IA e privacidade",
};

/** O `dateModified` só vale quando o post de fato mudou depois de publicado. */
export function foiAtualizado(p: { datePublished: string; dateModified?: string }): boolean {
  return !!p.dateModified && p.dateModified !== p.datePublished;
}

/** JSON dentro de `<script type="application/ld+json">`: um `</script>` no
 *  texto de um título fecharia a tag antes da hora. `<` vira `<`, que o
 *  JSON lê igual e o HTML não interpreta. */
export function jsonParaScript(dados: unknown): string {
  return JSON.stringify(dados).replace(/</g, "\\u003c");
}
