import {
  SOCIAL_METRIC_KEYS, SHAREABLE_METRICS, isShareable, type SocialMetricKey,
} from "@/lib/socialMetrics";

/* ═══════════════════════════════════════════════════════════════════════════
   A FRASE LITERAL QUE O GRUPO VAI LER
   ═══════════════════════════════════════════════════════════════════════════

   Esta é a camada de COPY do Social, e ela mora em `components/` de propósito:
   `lib/socialMetrics.ts` decide o que PODE sair (a allowlist, o teste do zero,
   a composição) e não deve carregar texto de interface junto. Aqui fica a
   outra metade — o que a pessoa LÊ ao decidir.

   Por que a frase literal é o coração da folha de consentimento: "compartilhar
   treinos" não diz se sai a carga. "Registrou um treino — sem duração, sem
   carga, sem qual" diz. Consentimento com o texto real é a única forma honesta
   de pedir consentimento (condição C5 do Fiel: consentimento ENTENDIDO, não só
   coletado). Checkbox com texto legal é consentimento que ninguém leu, e
   consentimento que ninguém leu é manipulação por omissão.

   A MESMA FRASE APARECE NOS DOIS LUGARES, e isso não é reuso por economia: é o
   contrato. A folha promete "Registrou um treino"; o feed do grupo monta a
   linha a partir DESTA MESMA string. Se as duas se separarem, a folha vira
   propaganda do recurso em vez de descrição dele.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface FraseDaMetrica {
  /** Emoji do chip. Sem ícone de biblioteca: a folha é lida em diagonal, e
   *  emoji é o que sobrevive a essa leitura. */
  emoji: string;
  /** O que o grupo lê. Começa maiúscula: no feed ela vem depois do nome, e a
   *  montagem baixa a primeira letra (ver `frasePublica`). */
  frase: string;
  /** O que a frase NÃO carrega. Dizer o que sai é metade; a outra metade é
   *  dizer o que fica — e é a metade que permite confiar. */
  semOQue: string;
}

const FRASES: Record<SocialMetricKey, FraseDaMetrica> = {
  treino_registrado: {
    emoji: "🏋",
    frase: "Registrou um treino.",
    semOQue: "Sem duração, sem carga, sem qual.",
  },
  agua_fechada: {
    emoji: "💧",
    frase: "Fechou a água de hoje.",
    semOQue: "Sem litros.",
  },
  refeicao_registrada: {
    emoji: "🍽",
    frase: "Registrou uma refeição.",
    semOQue: "Sem foto, sem calorias, sem o que foi.",
  },
  sono_na_janela: {
    emoji: "🌙",
    frase: "Dormiu dentro da janela dela.",
    semOQue: "Sem horas, sem horário.",
  },
  soneca_registrada: {
    emoji: "😴",
    frase: "Tirou uma soneca.",
    semOQue: "Sem duração, sem horário.",
  },
  dia_inteiro: {
    emoji: "✦",
    frase: "Fechou um dia inteiro.",
    semOQue: "Sem dizer quais dos sinais foram.",
  },
  /* `sequencia_dias` tinha frase aqui e saiu com a chave, em 18/09/2026. O
     motivo está inteiro em lib/socialMetrics.ts, no registro do que NÃO entra:
     sequência consecutiva é perfeição num produto que vende constância, e a do
     Social não perdoava o dia de descanso que a sequência privada perdoa e que
     a /recusas promete em público. Frase sem chave é como uma métrica morta
     volta: alguém encontra o texto pronto e reconstrói o resto em volta. */
  gratidao_registrada: {
    emoji: "🙏",
    frase: "Registrou uma gratidão.",
    semOQue: "Sem o que foi.",
  },
};

export interface LinhaDoCatalogo extends FraseDaMetrica {
  key: SocialMetricKey;
  label: string;
}

/**
 * O catálogo como a folha de consentimento o mostra.
 *
 * O `filter(isShareable)` não é defensivo por hábito: é a lista NUNCA do Fiel
 * (N6) alcançando a TELA. No dia em que alguém "melhorar" uma métrica composta
 * acrescentando peso ou humor à conta, `isShareable` vira false — e a linha
 * some da folha antes de o dado sair do aparelho de alguém, em vez de o
 * problema ser descoberto num code review que pode não acontecer.
 */
export const CATALOGO_VISIVEL: readonly LinhaDoCatalogo[] = SOCIAL_METRIC_KEYS
  .filter((k) => isShareable(k))
  .map((k) => ({ key: k, label: SHAREABLE_METRICS[k].label, ...FRASES[k] }));

/**
 * O BLOCO DO NUNCA — visível, e SEM interruptor.
 *
 * Ele não está aqui para ser configurado: está aqui para a pessoa poder
 * confiar no que NÃO está na lista de cima. É a `/recusas` em miniatura, no
 * lugar exato onde a decisão acontece. Interruptor desligado diz "hoje não";
 * ausência de interruptor diz "nunca", e a diferença é o produto inteiro.
 *
 * Cada item é uma linha da lista NUNCA (N2 a N5) e do corte B3 do Fiel — mais
 * peso e corpo, que o fundador tirou do catálogo em 18/09/2026.
 */
export const NUNCA_COMPARTILHAVEL: readonly string[] = [
  "dinheiro",
  "peso e corpo",
  "humor",
  "diário",
  "prática espiritual",
  "batalhas",
  "condições de saúde",
  "medicamentos",
];

/**
 * A frase que o grupo lê, montada a partir do catálogo — nunca guardada.
 *
 * O item de feed do tipo `ato` guarda um PONTEIRO (autor, dia, métrica), não o
 * texto. Se guardasse "Ana treinou 45min" congelado num campo, revogar o
 * consentimento não alcançaria a cópia — e a promessa de revogação viraria
 * mentira dentro de uma semana, sem ninguém perceber. Montando aqui, a linha é
 * sempre a frase que a folha prometeu, palavra por palavra.
 */
export function frasePublica(
  nome: string,
  ehMinha: boolean,
  item: { kind: "ato" | "nota"; metricKey: string | null; texto: string | null },
): string {
  const quem = ehMinha ? "Você" : nome;
  if (item.kind === "nota") return `${quem}: ${item.texto ?? ""}`;
  const m = CATALOGO_VISIVEL.find((c) => c.key === item.metricKey);
  // Métrica que saiu do catálogo (ou que nunca deveria ter entrado) não vira
  // frase: o feed fica mudo sobre ela em vez de inventar um texto.
  if (!m) return `${quem} registrou uma coisa.`;
  return `${quem} ${m.frase.charAt(0).toLowerCase()}${m.frase.slice(1)}`;
}
