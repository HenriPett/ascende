// ASCENDE — A faixa de peso corporal plausível. Um lugar só.
//
// POR QUE ESTE MÓDULO EXISTE
//
// A regra estava escrita duas vezes, com fronteiras diferentes, nos dois lados
// do MESMO fluxo: o parser de importação descartava com `kg < 20 || kg > 400`
// (aceitando 20,0 e 400,0) e a gravação aceitava com `v > 20 && v < 400`
// (recusando 20,0 e 400,0). O resultado que a pessoa via: a pesagem de
// exatamente 20,0 kg aparecia no cartão de revisão, ela confirmava, e o app
// respondia "não registrei: 20 kg está fora do que eu aceito (de 20 a 400 kg)"
// — recusando na segunda tela o número que ele mesmo tinha mostrado na
// primeira, com uma mensagem que diz aceitar aquele valor.
//
// A FRONTEIRA É INCLUSIVA — [20, 400] —, por três razões:
//   1. A mensagem de erro já promete "de 20 a 400 kg". "De 20 a 400" inclui 20
//      e 400 em português; o código tinha de seguir o texto, não o contrário.
//   2. Nem 20 kg nem 400 kg são valores implausíveis em si (uma criança
//      pequena; um adulto em peso extremo mas registrado). O que a faixa
//      existe para barrar é o erro de unidade e o lixo de coluna — 0,3 kg,
//      3.500 kg —, e esses ficam barrados de qualquer jeito.
//   3. Entre recusar um dado válido e aceitar um dado de borda, o erro mais
//      barato é aceitar: peso é registro da pessoa sobre o próprio corpo, e
//      ela pode corrigir depois. Perder a pesagem dela, não.
//
// Não é um módulo "de importação" nem "de captura" de propósito: enquanto a
// regra morar dentro de um dos dois lados, o outro lado continua tentado a
// reescrevê-la.

/** Mínimo aceito, em kg. INCLUSIVO. */
export const BODY_WEIGHT_MIN_KG = 20;

/** Máximo aceito, em kg. INCLUSIVO. */
export const BODY_WEIGHT_MAX_KG = 400;

/**
 * A faixa como a pessoa lê, para a mensagem de recusa não divergir do código.
 * Quem mudar as constantes acima mexe no texto junto, sem procurar string.
 */
export const BODY_WEIGHT_RANGE_LABEL = `de ${BODY_WEIGHT_MIN_KG} a ${BODY_WEIGHT_MAX_KG} kg`;

/**
 * O peso é plausível como peso corporal? Fronteiras INCLUSIVAS.
 *
 * Use esta função nos dois lados (importação e gravação) em vez de repetir a
 * comparação: foi a comparação repetida que produziu a contradição na mesma
 * tela. `NaN` e `Infinity` são recusados.
 */
export function isPlausibleBodyWeightKg(kg: number | null | undefined): boolean {
  if (typeof kg !== "number" || !Number.isFinite(kg)) return false;
  return kg >= BODY_WEIGHT_MIN_KG && kg <= BODY_WEIGHT_MAX_KG;
}
