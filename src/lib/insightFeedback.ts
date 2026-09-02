// ASCENDE — Quando perguntar "isso te ajudou?" (puro, testável, sem I/O).
//
// A pergunta é o único sinal novo da Fase 6. O QUE se guarda é da camada de
// dados; QUANDO se pergunta é regra de produto, e regra de produto que vive
// espalhada em `&&` dentro do JSX é regra que a próxima refatoração apaga.
//
// Duas decisões moram aqui:
//
// 1. SÓ NO ESTADO `tendencia`.
//
//    A OUTRA LEITURA É DEFENSÁVEL, e é por isso que este comentário existe:
//    alguém vai querer "consertar" isto acrescentando `sem_tendencia` de
//    volta. Um card que diz "dormindo mais ou menos, seu gasto ficou parecido"
//    também afirma algo verdadeiro e útil — saber que NÃO há padrão é
//    informação, e às vezes descartar uma hipótese vale mais que confirmá-la.
//
//    O problema não é o valor da resposta, é a MEDIDA. Misturar os dois
//    estados faz a medida 4 responder "a análise ajudou?" com duas perguntas
//    diferentes embaralhadas — "o padrão que encontrei te ajudou?" e "saber
//    que não há padrão te ajudou?" —, e um número que soma duas perguntas não
//    decide nada. A Fase 6 existe exatamente para evitar métrica que não
//    decide. Se um dia quisermos medir as duas, são duas medidas, não uma.
//
//    E `dados_insuficientes` nunca, por um motivo mais simples: ali não
//    ajudou nem tentou ajudar. Perguntar seria pedir opinião sobre uma coisa
//    que não aconteceu.
//
// 2. UMA PERGUNTA POR VEZ. Três cards elegíveis na tela seriam três perguntas
//    idênticas empilhadas, e "discreta" morre aí. A pessoa vê no máximo UMA, e
//    no máximo três na vida da conta — uma por análise.

import type { Insight, InsightKind, InsightStatus } from "@/lib/insights";

/**
 * A pergunta cabe neste estado? Só em `tendencia` — ver a decisão 1 acima
 * para o porquê de `sem_tendencia` ter ficado fora, que é a parte que alguém
 * vai querer reverter.
 */
export function canAskFeedback(status: InsightStatus): boolean {
  return status === "tendencia";
}

/**
 * De qual análise perguntar AGORA — ou `null` para não perguntar nada.
 *
 * Percorre na ordem em que os cards aparecem e devolve a primeira elegível
 * que ainda não foi perguntada. A ordem fixa importa: sem ela, a pergunta
 * pularia de card entre dois carregamentos da mesma tela.
 *
 * `alreadyAsked` são os kinds que já receberam a pergunta — tenha a pessoa
 * respondido ou não. Ignorar é resposta: quem não quis responder não é
 * perguntado de novo, porque repetir transforma uma pergunta educada em
 * cobrança.
 */
export function pickFeedbackTarget(
  insights: readonly Insight[],
  alreadyAsked: ReadonlySet<string>,
): InsightKind | null {
  for (const insight of insights) {
    if (!canAskFeedback(insight.status)) continue;
    if (alreadyAsked.has(insight.kind)) continue;
    return insight.kind;
  }
  return null;
}
