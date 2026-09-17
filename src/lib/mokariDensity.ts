// ASCENDE — Mokari: a DENSIDADE, o eixo que não termina.
//
// ─── O PROBLEMA QUE ESTE ARQUIVO EXISTE PARA RESOLVER ───────────────────
// A afinidade por pilar tinha três níveis (1, 10 e 40 registros) e o estágio,
// quatro (0, 200, 1.000 e 3.000 XP). Medido numa simulação de 180 dias de uso
// regular (~27 XP/dia), o desenho mudava em DOZE dias — e mal distribuídos:
// nove mudanças até o dia 40, nenhuma entre o dia 40 e o 90, nenhuma entre o
// 112 e o 180.
//
// A causa não é a arte, é a aritmética: a afinidade satura em 40 registros
// por pilar (~dia 40) e o estágio em 3.000 XP (~dia 112). Passado isso, NADA
// que a pessoa faça muda o desenho. Nunca mais. Um espelho da jornada que
// para de refletir aos quatro meses contradiz a própria frase que o app diz
// sobre ele ("o retrato do que você registrou até aqui").
//
// ─── A CURVA ────────────────────────────────────────────────────────────
// `densidade(n) = piso(C·n^P)`, sem teto. Três propriedades, e as três são
// testadas:
//
//   1. NÃO SATURA. Para todo n existe um m > n com densidade maior. Registrar
//      sempre volta a valer alguma coisa, um dia.
//   2. DESACELERA. O ganho por registro cai com 1/n, então o começo é
//      generoso e o veterano não vira um matagal de mil folhas. As mudanças
//      ficam mais raras com o tempo, mas nunca param.
//   3. NUNCA DÁ MENOS QUE A TABELA ANTIGA. Para TODA contagem, a densidade
//      nova é >= a antiga. É isto que faz a regra 1 do Mokari ("nunca
//      regride") sobreviver à própria troca de fórmula, sem precisar guardar
//      o estado anterior de ninguém: a não-regressão é provada por
//      propriedade, não gravada num campo que pode faltar.
//
// POR QUE POTÊNCIA E NÃO LOGARITMO. A primeira versão era `A·ln(n)+B`, e ela
// desacelera rápido DEMAIS: com o logaritmo, cada marca nova exige que a
// contagem cresça sempre o MESMO fator (~1,7x), então o intervalo entre duas
// mudanças cresce 70% a cada vez. Medido, dava um vão de 142 dias no segundo
// ano — "nunca satura" na teoria e "parou" na prática, que é a mesma queixa de
// onde essa história começou.
//
// Com `n^0,4` o fator exigido ENCOLHE conforme a árvore cresce (de 9 para 10
// marcas são +30% de registros; de 20 para 21, +13%). O resultado é uma curva
// que continua desacelerando em dias, mas muito mais devagar — e que não tem
// fim de verdade, não só no papel.
//
// Os coeficientes saíram de ancorar a curva nos três pontos da tabela antiga
// (1 registro → 2 folhas, 10 → 5, 40 → 9) e deixar o resto seguir. Não são
// gosto: mudar qualquer um faz o teste de não-regressão falhar se passar por
// baixo em qualquer contagem.
import type { PillarAffinity } from "@/lib/mokari";

/* Coeficientes da curva. Ver a nota acima antes de mexer — e note que eles
   NÃO foram escolhidos por gosto, foram apertados entre dois testes que
   puxam para lados opostos:

   • por baixo, a não-regressão: `C·40^P` tem que dar 9 ou mais, senão quem
     tinha nove folhas veria oito;
   • por cima, a legibilidade: dez anos de uso pesado num mesmo pilar não
     podem passar de algumas dezenas de marcas, senão a copa vira mancha e
     o anel externo sai do quadro.

   Com P = 0,4 a primeira versão passava no de baixo e falhava no de cima
   (114 marcas em dez anos). P = 0,3 cabe nos dois. */
const C = 3.0;
const P = 0.3;

/**
 * Quantas marcas o pilar PEDE, dado o total de registros dele em toda a
 * história. Sem teto: cresce para sempre, cada vez mais devagar.
 *
 * Zero registro é zero marca — a gema (afinidade 0) é outra peça, e é ela que
 * diz "ainda não" sem dizer "faltou".
 */
export function markDensity(count: number): number {
  const n = Number.isFinite(count) ? Math.floor(count) : 0;
  if (n <= 0) return 0;
  return Math.floor(C * Math.pow(n, P));
}

/* As três marcas saem da MESMA densidade, com proporções próprias. Elas
   existem porque uma árvore com tantos frutos quanto folhas não lê como
   árvore — e porque os três números da tabela antiga eram diferentes entre si
   (folhas 2/5/9, frutos 1/3/6, flores 2/5/5).

   `ceil` nas flores e `round` nos frutos não é capricho: são os
   arredondamentos que fazem a curva nova passar por cima da antiga em TODO
   ponto, inclusive no primeiro registro. O teste de não-regressão é quem
   manda aqui. */
export const leafCount = (count: number): number => markDensity(count);
export const fruitCount = (count: number): number => Math.round(markDensity(count) * 0.66);
export const flowerCount = (count: number): number => Math.ceil(markDensity(count) * 0.85);
export const rootCount = (count: number): number => Math.ceil(markDensity(count) * 0.85);

/* ═══ A TABELA ANTIGA, PRESERVADA PARA SER SUPERADA ══════════════════════
   Ela não está aqui por nostalgia: é o PISO que o teste usa para provar que
   ninguém vê menos do que via. Apagar daqui é apagar a prova. */
export const LEGACY_AFFINITY_EVENTS: readonly number[] = [1, 10, 40];
export const LEGACY_LEAVES: Record<PillarAffinity, number> = { 0: 0, 1: 2, 2: 5, 3: 9 };
export const LEGACY_FRUITS: Record<PillarAffinity, number> = { 0: 0, 1: 1, 2: 3, 3: 6 };
export const LEGACY_FLOWERS: Record<PillarAffinity, number> = { 0: 0, 1: 2, 2: 5, 3: 5 };
/** As raízes eram traçados à mão: 2 no nível 1, 4 no 2, 7 no 3. */
export const LEGACY_ROOTS: Record<PillarAffinity, number> = { 0: 0, 1: 2, 2: 4, 3: 7 };

/** O nível antigo de uma contagem — a entrada da tabela acima. */
export function legacyLevel(count: number): PillarAffinity {
  const n = Number.isFinite(count) ? count : 0;
  let level = 0;
  for (let i = 0; i < LEGACY_AFFINITY_EVENTS.length; i++) {
    if (n >= LEGACY_AFFINITY_EVENTS[i]) level = i + 1;
  }
  return level as PillarAffinity;
}

/* ═══ QUANTO FALTA ═══════════════════════════════════════════════════════
   O `detail` do Mokari já trazia XP, registros e dias — e nunca foi mostrado
   em lugar nenhum. Sem distância, uma mudança que leva cinquenta dias é
   indistinguível de nenhuma mudança: a pessoa não tem como saber se está
   perto de algo ou se o desenho simplesmente parou.

   A distância é dita em REGISTROS, nunca em porcentagem de uma barra: o
   Mokari é espelho, não placar. "3 registros de Mente" é uma frase sobre a
   vida da pessoa; "68% para o próximo nível" é uma frase sobre o app. */
export function nextMarkAt(count: number): number {
  const atual = markDensity(count);
  let n = Math.max(1, Math.floor(count) + 1);
  // A curva é monótona e não satura, então este laço sempre termina. O teto
  // é só uma cinta de segurança contra coeficiente mal editado.
  for (let i = 0; i < 100000 && markDensity(n) <= atual; i++) n++;
  return n;
}

/** Quantos registros faltam para a próxima marca daquele pilar. */
export const marksToGo = (count: number): number =>
  Math.max(1, nextMarkAt(count) - Math.max(0, Math.floor(count)));
