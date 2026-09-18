// ASCENDE — Social: O CATÁLOGO DO QUE PODE SER COMPARTILHADO.
//
// ─── ISTO É REGRA ÉTICA COMO CÓDIGO, NO MESMO ESPÍRITO DE lib/mokari.ts ───
//
// O parecer do Fiel da Balança (17/09/2026) é contrato, não sugestão, e o
// item 1 do anexo "o que eu preciso ver antes de assinar" é literalmente este
// arquivo: "a função isShareable e seus testes, escritos como o lib/mokari.ts
// foi: regra ética como função pura com teste que falha quando alguém a
// remove". Regra que depende de alguém lembrar é regra que uma refatoração
// apaga sem ninguém ver.
//
// ─── O TESTE DO ZERO: A RÉGUA QUE DECIDE TODA ADIÇÃO FUTURA ───
//
// Uma métrica só entra no catálogo se o ZERO dela for uma informação que a
// pessoa não se importaria de ouvir LIDA EM VOZ ALTA pelo grupo.
//
//   treino,             zero = "não treinou esta semana"     -> tolerável, entra
//   água/comida/sono,   zero = "não registrou"               -> tolerável, entra
//   gratidão,           zero = "não registrou"               -> tolerável, entra
//   humor,              zero = "parou de conseguir se olhar" -> NÃO ENTRA
//   prática espiritual, zero = "se afastou da fé"            -> NÃO ENTRA
//   batalha,            zero = "recaiu"                      -> NÃO ENTRA
//   peso,               zero = "não subiu na balança"        -> NÃO ENTRA
//   qualquer financeiro                                      -> NÃO ENTRA
//
// Por que essa régua e não "classificar por sensibilidade do conteúdo": no
// agregado o conteúdo já não existe. O que vaza é sempre A AUSÊNCIA. Quem for
// acrescentar métrica um dia: a pergunta não é "este dado é sensível?", é
// "o zero dele é uma frase que eu leria em voz alta para os amigos dela?".
//
// ─── ALLOWLIST, NUNCA DENYLIST ───
//
// Um `kind` novo que apareça amanhã não vira métrica compartilhável — ele
// simplesmente não tem para onde ir. Uma denylist ("todos menos transaction")
// nasce ABERTA, e foi assim que o financeiro entraria: não por decisão, por um
// `kind` novo num sábado. FORBIDDEN_SIGNALS existe só para EXPLICAR uma recusa
// com a frase certa; quem DECIDE é SHAREABLE_SIGNALS, e nada mais.
//
// ─── PUREZA ───
//
// Sem Supabase, sem Date.now(), sem import de lib/battles e sem import de
// lib/xp. As duas últimas são travadas por socialIsolation.test.ts, que lê o
// código-fonte — porque um import é exatamente o tipo de coisa que um teste de
// unidade não pega.

/** Um sinal CRU: o ato registrado que alimenta uma métrica. Corresponde ao
 *  `kind` de `life_events`, e é só por isso que a tradução é trivial. */
export type SocialSignal =
  | "workout" | "sleep" | "nap" | "meal" | "water" | "gratitude";

/**
 * A ALLOWLIST. Um sinal fora desta lista não é compartilhável, e ponto — não
 * existe caminho, flag ou configuração que o torne. Acrescentar um item aqui é
 * uma decisão de produto que passa pela mesa do Fiel, e o teste do zero acima
 * é a pergunta que ela responde.
 */
export const SHAREABLE_SIGNALS: readonly SocialSignal[] = [
  "workout", "sleep", "nap", "meal", "water", "gratitude",
];

/**
 * Os sinais recusados, com a frase que o ZERO de cada um diz sobre a pessoa.
 *
 * Este mapa NÃO decide nada — a allowlist decide. Ele existe para que a recusa
 * saia com o motivo junto, tanto na mensagem de um teste quanto para quem
 * abrir este arquivo daqui a um ano querendo saber por que falta algo.
 */
export const FORBIDDEN_SIGNALS: Record<string, string> = {
  // N2 — nem derivado, nem agregado, nem booleano. "Cumpriu o teto de gasto
  // hoje: sim/não" JÁ É dado financeiro.
  transaction: "quanto ela ganha e no que ela gasta",
  spend_limit: "se o dinheiro dela acabou antes do mês",
  budget: "o tamanho do orçamento dela",
  // N4 — o Mokari já remove peso e corpo de TODA conta, inclusive do XP
  // (IGNORED_KINDS, regra 3). O Social não pode ser a exceção que desmente a
  // regra. E "não subiu na balança" é frase que alguém usa contra outra pessoa.
  weight: "não subiu na balança",
  body: "o corpo dela, medido",
  // N5 — o zero é o estado emocional, nos dois sentidos: ela registra mais
  // quando está turbulenta e para de registrar quando afunda.
  mood: "parou de conseguir se olhar",
  journal: "parou de escrever, e o grupo pergunta sobre o quê",
  // N5 — convicção religiosa é dado sensível (LGPD art. 5º, II). Devoção que
  // vira número comparável deixa de ser devoção e vira desempenho.
  practice: "se afastou da fé",
  // N3 — em forma nenhuma: nem check-in, nem dias limpos, nem marco de 30
  // dias, nem dentro de um número agregado.
  battle_checkin: "recaiu",
  battle_streak: "há quantos dias ela não recai",
};

/** As SETE chaves do catálogo (decisões de fundador, 18/09/2026).
 *  Duas saíram, e o porquê de cada uma está em FORA_DO_CATALOGO, abaixo —
 *  não aqui, porque quem vai querer recolocá-las procura pelo NOME. */
export type SocialMetricKey =
  | "treino_registrado"
  | "agua_fechada"
  | "refeicao_registrada"
  | "sono_na_janela"
  | "soneca_registrada"
  | "dia_inteiro"
  | "gratidao_registrada";

export interface SocialMetric {
  key: SocialMetricKey;
  /** Como a pessoa lê esta métrica na tela. */
  label: string;
  /** O que o ZERO desta métrica diz sobre ela, em voz alta, para o grupo.
   *  É o campo que justifica a entrada no catálogo — e o que alguém terá de
   *  escrever, e encarar, para acrescentar a nona. */
  zeroReads: string;
  /** Insumos CRUS. Vazio numa métrica COMPOSTA. */
  signals: readonly SocialSignal[];
  /** Métricas das quais esta é composta. Vazio numa métrica FOLHA.
   *  N6: nenhum número composto é compartilhável se algum insumo dele não for
   *  — e é por isso que a composição é DECLARADA aqui, e não calculada em
   *  algum lugar que `isShareable` não enxerga. */
  composedOf: readonly SocialMetricKey[];
  /** Métrica que nunca pode ser ordenada nem entrar em ranking, mesmo dentro
   *  das camadas permitidas (ressalva do Fiel em B1/B3). */
  neverRanked?: true;
}

export const SHAREABLE_METRICS: Record<SocialMetricKey, SocialMetric> = {
  treino_registrado: {
    key: "treino_registrado", label: "Treinos",
    zeroReads: "não treinou",
    signals: ["workout"], composedOf: [],
  },
  agua_fechada: {
    key: "agua_fechada", label: "Dias com a água em dia",
    zeroReads: "não registrou água",
    signals: ["water"], composedOf: [],
  },
  refeicao_registrada: {
    key: "refeicao_registrada", label: "Dias com refeição registrada",
    zeroReads: "não registrou refeição",
    signals: ["meal"], composedOf: [],
  },
  sono_na_janela: {
    key: "sono_na_janela", label: "Noites dentro da janela de sono",
    zeroReads: "não registrou sono",
    signals: ["sleep"], composedOf: [],
  },
  soneca_registrada: {
    key: "soneca_registrada", label: "Sonecas",
    zeroReads: "não registrou soneca",
    signals: ["nap"], composedOf: [],
  },
  /* A unidade do desafio "A Semana Inteira". COMPOSTA, e é o caso que o N6
     existe para proteger: no dia em que alguém quiser "melhorar" o dia inteiro
     acrescentando peso ou humor à conta, `isShareable("dia_inteiro")` vira
     false e o teste quebra ANTES de o dado sair do aparelho dela. */
  dia_inteiro: {
    key: "dia_inteiro", label: "Dias inteiros",
    zeroReads: "não fechou nenhum dia",
    signals: [],
    composedOf: ["treino_registrado", "sono_na_janela", "refeicao_registrada", "agua_fechada"],
  },
  gratidao_registrada: {
    key: "gratidao_registrada", label: "Dias com gratidão",
    zeroReads: "não registrou gratidão",
    // "Uma coisa boa por dia" é desafio de grupo real e benigno — mas contagem
    // pura, nunca ordenada (ressalva do Fiel, B3).
    signals: ["gratitude"], composedOf: [], neverRanked: true,
  },
};

export const SOCIAL_METRIC_KEYS = Object.keys(SHAREABLE_METRICS) as SocialMetricKey[];

/**
 * ─── O QUE FOI TIRADO DO CATÁLOGO, E POR QUÊ ────────────────────────────
 *
 * Uma ausência não se defende sozinha. Uma métrica que some sem deixar
 * argumento volta em seis meses, proposta de boa-fé por alguém que leu o
 * catálogo e achou que faltava uma — e volta como acréscimo pequeno, que é
 * como as regras desta casa morrem.
 *
 * Então a recusa fica escrita, com nome e motivo, e `isShareable` continua
 * devolvendo `false` para cada uma. Quem tentar recolocar bate no argumento,
 * não no silêncio.
 *
 * Acrescentar de volta é uma decisão de fundador que passa pela mesa do Fiel —
 * e o primeiro passo é apagar a linha daqui, que é onde está escrito por que
 * não.
 */
export const FORA_DO_CATALOGO: Record<string, string> = {
  /* Ressalva BLOQUEANTE do Fiel, resolvida pelo fundador em 18/09/2026.
     SEQUÊNCIA DE DIAS CONSECUTIVOS É PERFEIÇÃO, E ESTE PRODUTO VENDE
     CONSTÂNCIA. E ela contradizia promessa pública em dois lugares: a
     sequência PRIVADA do app perdoa um dia de descanso por semana (Hoje.tsx),
     e o item 3 da /recusas promete isso em público — "a sequência tem dia de
     descanso embutido". A do Social não perdoava nenhum: um dia silencioso
     quebrava a ilha, e "sem registro" aparecia ao lado do nome da pessoa para
     os outros lerem. Nas palavras do Fiel: o app afrouxou a régua onde
     ninguém olha e apertou onde todo mundo olha.
     `dia_inteiro` por SOMA já carrega a ideia de constância sem o penhasco —
     quem fechou 5 de 7 aparece com 5, não com "sem registro". */
  sequencia_dias:
    "sequência consecutiva é perfeição num produto que vende constância, e " +
    "contradiz a sequência privada (que perdoa um dia) e a /recusas item 3. " +
    "Use dia_inteiro por soma: 5 de 7 aparece como 5, não como 'sem registro'.",

  /* Sobreviveu ao corte do delta no parecer (B1) e caiu depois, na mesa do
     fundador. */
  peso_registrado:
    "\"não subiu na balança\" é frase que alguém usa contra outra pessoa, e o " +
    "espelho do app já remove peso e corpo de TODA conta — o Social não pode " +
    "ser a exceção que desmente a regra.",
  peso_delta_kg:
    "delta é RESULTADO, não ATO: depende de ciclo, retenção de líquido, " +
    "remédio e ganho de massa. Comparar resultado que a pessoa não controla é " +
    "comparação injusta por construção, e competição de emagrecimento entre " +
    "amigos é vetor conhecido de restrição extrema.",

  /* Cortadas em B3, pelo teste do zero. */
  humor_registrado:
    "a FREQUÊNCIA de registro de humor é proxy do estado emocional nos dois " +
    "sentidos, e convida vigilância com cara de cuidado.",
  diario_escrito:
    "mesma razão do humor, com o agravante de que a contagem convida a " +
    "pergunta \"sobre o quê?\".",
  pratica_espiritual:
    "convicção religiosa é dado sensível (LGPD art. 5º, II). A contagem pura " +
    "já entrega tudo: num grupo de trabalho, \"praticou 6x\" identifica a " +
    "pessoa de fé, e a queda para zero identifica o afastamento dela.",

  /* N6: fora por CONSTRUÇÃO, não por decisão — algum insumo não passa. */
  constancia_geral:
    "número composto cujos insumos incluem prática espiritual e check-in de " +
    "batalha. Fica fora por construção (N6), não por escolha.",
  score:
    "mesma coisa: composto do app inteiro, e o app inteiro inclui dinheiro.",
};

/** O catálogo como PARÂMETRO. A costura existe por um motivo só, e ele é o
 *  item mais importante deste arquivo: o N6 exige "teste que quebra quando
 *  alguém adiciona insumo novo a uma métrica composta", e um teste que
 *  reimplementa a verificação para provar isso não prova nada — ele testa a
 *  cópia. Com o catálogo entrando por parâmetro, o teste roda a FUNÇÃO DE
 *  VERDADE contra um catálogo adulterado. Ninguém em produção passa este
 *  argumento; o padrão é o catálogo real. */
export type MetricCatalog = Readonly<Record<string, SocialMetric>>;

export const socialMetric = (
  key: string, catalog: MetricCatalog = SHAREABLE_METRICS,
): SocialMetric | undefined => catalog[key];

/** Por que uma métrica foi recusada — a recusa sai com o motivo junto. */
export type ShareVerdict =
  | { ok: true; signals: SocialSignal[] }
  | { ok: false; reason: "desconhecida" | "insumo-proibido" | "composicao-circular"; offending: string; zeroReads?: string };

/**
 * Todos os sinais CRUS que uma métrica consome, resolvendo a composição até o
 * fim. É esta resolução transitiva que faz o N6 valer: uma métrica composta de
 * outra composta resolve até as FOLHAS, e o veredito olha as folhas, não o
 * rótulo. Hoje o catálogo só tem um nível de composição (`dia_inteiro`), mas a
 * travessia é testada em profundidade — a hora em que alguém acrescentar o
 * segundo nível não é a hora de descobrir que ela não funcionava.
 *
 * Devolve `null` se a composição tiver ciclo. Ciclo não é "lista vazia": lista
 * vazia passaria no allowlist por vacuidade, e uma métrica que se compõe de si
 * mesma entraria como compartilhável sem insumo nenhum.
 */
export function metricSignals(
  key: string, catalog: MetricCatalog = SHAREABLE_METRICS, seen: Set<string> = new Set(),
): SocialSignal[] | null {
  if (seen.has(key)) return null;
  const metric = socialMetric(key, catalog);
  if (!metric) return null;
  seen.add(key);
  const out = new Set<SocialSignal>(metric.signals);
  for (const filho of metric.composedOf) {
    const dele = metricSignals(filho, catalog, seen);
    if (dele === null) return null;
    for (const s of dele) out.add(s);
  }
  return [...out];
}

/**
 * O veredito completo, com o motivo. `isShareable` é o sim/não.
 *
 * ORDEM DAS PERGUNTAS, e ela importa:
 *   1. a métrica existe no catálogo?   (allowlist de métricas)
 *   2. a composição fecha?             (ciclo não vira lista vazia)
 *   3. TODO insumo está na allowlist?  (allowlist de sinais)
 *
 * Nenhuma delas pergunta "este insumo está proibido?", porque uma pergunta
 * assim nasce aberta para tudo que ainda não foi proibido.
 */
export function shareabilityOf(
  key: string, catalog: MetricCatalog = SHAREABLE_METRICS,
): ShareVerdict {
  const metric = socialMetric(key, catalog);
  if (!metric) return { ok: false, reason: "desconhecida", offending: String(key) };

  const signals = metricSignals(key, catalog);
  if (signals === null) {
    return { ok: false, reason: "composicao-circular", offending: String(key) };
  }
  // Métrica sem insumo nenhum não é "inofensiva": é indefinida, e indefinida
  // não se compartilha.
  if (!signals.length) {
    return { ok: false, reason: "insumo-proibido", offending: "(nenhum insumo declarado)" };
  }
  for (const s of signals) {
    if (!SHAREABLE_SIGNALS.includes(s)) {
      return {
        ok: false, reason: "insumo-proibido", offending: s,
        zeroReads: FORBIDDEN_SIGNALS[s],
      };
    }
  }
  return { ok: true, signals };
}

/** Esta métrica pode sair do aparelho dela? Função pura, sem exceção e sem
 *  configuração: não existe flag que transforme um `false` em `true`. */
export const isShareable = (key: string, catalog: MetricCatalog = SHAREABLE_METRICS): boolean =>
  shareabilityOf(key, catalog).ok;
