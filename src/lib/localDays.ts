// ASCENDE — Contagem de DIAS DISTINTOS no fuso do app (puro, sem I/O).
//
// Existe porque `iso.slice(0, 10)` parece inofensivo e não é. As colunas são
// `timestamptz` e chegam do PostgREST em UTC, então o corte devolve o dia
// UTC — não o dia que a pessoa viveu. `lib/dates.ts` proíbe isso na primeira
// linha do arquivo ("agrupamentos, 'hoje', semanas e meses usam SEMPRE o fuso
// America/Sao_Paulo"), e os Indicadores faziam exatamente isso em três
// lugares.
//
// O ERRO NÃO É SÓ DESLOCAR UM DIA — É COLAPSAR DOIS.
//
// São Paulo é UTC-3: tudo registrado das 21:00 em diante cai no dia seguinte
// em UTC. Então o jantar de terça às 22:00 (UTC: quarta) e o almoço de quarta
// às 12:00 (UTC: quarta) viram o MESMO dia, e uma contagem de "dias distintos
// com refeição" perde metade dos dias de quem janta tarde. Quem come todo dia
// e registra à noite aparecia com ~7 dos últimos 14 dias.
//
// Por isso a contagem mora aqui, num lugar só, e não como um `slice` repetido
// em cada tela: a regra é uma, e a próxima pessoa que precisar contar dias
// encontra a versão certa antes de escrever a errada.
import { dateISOInSP } from "@/lib/dates";

/**
 * "YYYY-MM-DD" no fuso do app, ou `null` quando o carimbo não é uma data.
 *
 * Devolver `null` em vez de lançar é deliberado: um carimbo corrompido numa
 * lista de 200 não pode derrubar o indicador inteiro — mas também não pode
 * virar um dia inventado, então ele simplesmente não conta (ver
 * `distinctLocalDays`).
 */
export function localDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateISOInSP(d);
}

/** Quantos dias DISTINTOS, no fuso do app, estes carimbos cobrem. */
export function distinctLocalDays(isos: readonly (string | null | undefined)[]): number {
  const days = new Set<string>();
  for (const iso of isos) {
    const day = localDay(iso);
    if (day) days.add(day);
  }
  return days.size;
}
