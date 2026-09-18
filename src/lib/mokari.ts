// ASCENDE — Mokari (Fase 5): O CÁLCULO.
//
// O Mokari é o espelho da jornada da pessoa. Não é bicho de estimação que
// passa fome, não é treinador, não é placar com cara de amigo: ele mostra o
// que ela CONSTRUIU.
//
// AS QUATRO REGRAS ÉTICAS SÃO CÓDIGO, NÃO TEXTO
// Regra que vive no prompt, no comentário ou na intenção de quem escreveu a
// tela é regra que uma refatoração apaga sem ninguém ver. Aqui cada uma é
// função pura com teste que falha quando alguém a remove:
//
//   1. NUNCA REGRIDE — stage e afinidade por pilar são marca-d'água ALTA
//      (máximo histórico), nunca estado atual. Ver highWaterMark().
//   2. NUNCA PUNE — os 5 estados recentes não têm nenhum termo negativo, e
//      não existe contador de dias parados na saída. Ver MOKARI_STATES.
//   3. NUNCA RIDICULARIZA O CORPO — peso e composição corporal são removidos
//      da entrada ANTES de qualquer conta, inclusive do XP. Ver IGNORED_*.
//   4. NUNCA NOTIFICA POR CULPA — este módulo não tem nada de notificação, de
//      propósito: não há o que desligar depois.
//
// E a quinta, que prova as outras: desativar o Mokari não afeta função
// nenhuma. Este módulo é uma FOLHA na árvore de dependências — ninguém em
// src/lib importa daqui, e o teste garante isso. Se o cálculo de XP ou de
// insights dependesse do Mokari, desligá-lo mudaria número, e aí ele não seria
// espelho, seria pedágio.
//
// PUREZA (mesma regra da Fase 3): sem Supabase, sem Date.now(), sem
// new Date() sem argumento. A data de referência ENTRA como parâmetro, então a
// mesma história produz o mesmo Mokari — sempre.
import { addDays } from "@/lib/insights";
import { PILLARS, pillarMatchValues, type PillarId } from "@/lib/pillars";
// A regra de "que dia é este carimbo" mora num lugar só (lib/localDays.ts):
// reimplementá-la aqui é como o `slice` errado nasceu em três telas.
import { localDay } from "@/lib/localDays";

/** Versão da regra de cálculo. Muda quando os limiares mudam, para que um
 *  Mokari lido ontem não pareça outro hoje sem explicação. */
export const MOKARI_CALC_VERSION = "mokari/2";

/**
 * O Mokari NÃO vem ligado. Um personagem que aparece sem ser convidado no app
 * de quem está tentando organizar a própria vida é atrito: o convite é feito
 * uma vez, na Jornada, e o silêncio é resposta válida.
 */
export const MOKARI_DEFAULT_ENABLED = false;

/* ═══ REGRA 3: o corpo fica fora ═══════════════════════════════════════
   O app registra peso e composição corporal, e a tentação de "refletir" isso
   no personagem é enorme — e seria cruel. Então nem o VALOR nem a EXISTÊNCIA
   desses registros entra na conta.

   O tipo de entrada abaixo nem tem `payload`: o kg não chega até aqui, não há
   como um bug futuro lê-lo. E os eventos de peso/corpo são descartados antes
   de tudo.

   O buraco menos óbvio, e o que mais importa: registrar peso CONCEDE 3 XP
   (setup.sql, award_xp_for_event). Como xp_log não tem coluna `kind`, só
   `reason`, filtrar por evento não bastaria — o XP do peso entraria pelo
   estágio, e a regra estaria quebrada pela porta dos fundos. Por isso o XP
   também é filtrado, pelo texto do motivo que o gatilho grava. */
export const IGNORED_KINDS: readonly string[] = ["weight", "body"];

/* ═══ OS QUATRO ÓRGÃOS ════════════════════════════════════════════════
   O contrato antigo dizia "cada pilar desenha uma peça e uma só". Ele era uma
   descrição, não o invariante — e a fusão de `alimentacao` em `vitalidade`
   (17/09/2026) o quebrou sem quebrar nada de verdade.

   O INVARIANTE REAL é outro, e este sobrevive intacto:
   **cada órgão tem UMA fonte, e nenhuma fonte alimenta dois órgãos.**

   Então a unidade do Mokari deixa de ser o pilar e passa a ser o ÓRGÃO: 4
   órgãos ← 4 grupos de `kind` ← 3 pilares. Escrito assim, "quatro peças para
   três pilares" para de ser anomalia e volta a ser simetria — a assimetria
   fica onde ela é verdade: Vitalidade desenha DUAS peças porque tem duas
   naturezas. A raiz sustenta (sono, soneca, treino); a folha nutre (comida,
   água). É o único par de órgãos em que a divisão é legível sem explicação.

   E a aritmética prova que ninguém regride: `sleep+nap+workout` é exatamente
   o antigo `pillar='vitalidade'`, e `meal+water` é exatamente o antigo
   `pillar='alimentacao'` (weight/body saem antes de tudo, regra 3). Mesmas
   somas ⇒ mesma densidade ⇒ mesma marca-d'água ⇒ ninguém vê uma folha a menos. */
export const MOKARI_ORGANS = ["raiz", "folha", "fruto", "flor"] as const;
export type MokariOrgan = typeof MOKARI_ORGANS[number];

/** O que alimenta a raiz e o que alimenta a folha. Fruto e flor continuam
 *  vindo do PILAR (prosperidade e mente), porque neles a fusão não mexeu. */
export const ORGAN_KINDS: Record<"raiz" | "folha", readonly string[]> = {
  raiz: ["sleep", "nap", "workout"],
  folha: ["meal", "water"],
};

/** As seis contagens cruas de que os quatro órgãos precisam. Quem consulta o
 *  banco entrega ISTO; a regra (o piso, abaixo) mora num lugar só. */
export interface MokariOrganTotals {
  /** Registros de kind `sleep|nap|workout`. */
  raizPorKind: number;
  /** Registros com `pillar='vitalidade'` que NÃO são de kind de folha. */
  raizPorPilar: number;
  /** Registros de kind `meal|water`. */
  folhaPorKind: number;
  /** Registros com `pillar='alimentacao'` que NÃO são de kind de raiz. */
  folhaPorPilar: number;
  /** Registros de `pillar='prosperidade'`. */
  fruto: number;
  /** Registros de `pillar='mente'`. */
  flor: number;
}

/**
 * PISO DE TRANSIÇÃO — contra dado sujo e contra hábito.
 *
 * Contar por `kind` só é idêntico a contar por pilar se toda linha histórica
 * tiver `pillar` coerente com `kind`. Não dá para auditar isso daqui, e há um
 * caso em que a incoerência é CERTA e não é sujeira: `habit_done`. O gatilho
 * do banco grava o pilar do HÁBITO, e `habit_done` não está em nenhum grupo de
 * kind — contar só por kind apagaria da raiz todas as vezes em que a pessoa
 * cumpriu um compromisso diário. Numa história de meses isso são dezenas de
 * marcas, e regressão do conquistado é o que a regra 1 proíbe.
 *
 * Então o desenho fica com a MAIOR das duas leituras. Mesmo espírito da prova
 * de não-regressão da densidade: a garantia é por propriedade, não por um
 * campo gravado que pode faltar.
 *
 * As duas leituras são recortadas para não se sobreporem (a de raiz exclui
 * kinds de folha, a de folha exclui kinds de raiz). Sem esse recorte, depois do
 * backfill `pillar='vitalidade'` passaria a incluir as refeições e a mesma
 * refeição alimentaria raiz E folha — que é exatamente o invariante desta
 * seção, quebrado pela porta dos fundos.
 */
export function organEventsFromCounts(t: MokariOrganTotals): Record<MokariOrgan, number> {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return {
    raiz: Math.max(n(t.raizPorKind), n(t.raizPorPilar)),
    folha: Math.max(n(t.folhaPorKind), n(t.folhaPorPilar)),
    fruto: n(t.fruto),
    flor: n(t.flor),
  };
}

/** As mesmas seis contagens, a partir da lista de eventos. Não é uma segunda
 *  implementação: é a MESMA conta com a entrada em outra forma — a regra
 *  continua só em organEventsFromCounts. */
export function organTotalsFromEvents(events: readonly MokariEvent[]): MokariOrganTotals {
  const contaveis = events.filter((e) => !IGNORED_KINDS.includes(String(e.kind)));
  const kindOf = (e: MokariEvent) => String(e.kind);
  const ehRaiz = (e: MokariEvent) => ORGAN_KINDS.raiz.includes(kindOf(e));
  const ehFolha = (e: MokariEvent) => ORGAN_KINDS.folha.includes(kindOf(e));
  const conta = (f: (e: MokariEvent) => boolean) => contaveis.filter(f).length;
  return {
    raizPorKind: conta(ehRaiz),
    raizPorPilar: conta((e) => e.pillar === "vitalidade" && !ehFolha(e)),
    folhaPorKind: conta(ehFolha),
    folhaPorPilar: conta((e) => e.pillar === "alimentacao" && !ehRaiz(e)),
    fruto: conta((e) => e.pillar === "prosperidade"),
    flor: conta((e) => e.pillar === "mente"),
  };
}

/** Motivos de xp_log que vêm de peso/composição corporal. As duas primeiras
 *  formas são as do gatilho atual; as duas últimas cobrem linhas legadas
 *  gravadas no formato antigo ("Registro: <kind>"). */
export const IGNORED_XP_REASONS: readonly string[] = [
  "Peso registrado",
  "Composição corporal registrada",
  "Registro: weight",
  "Registro: body",
];

/* ═══ Entradas ════════════════════════════════════════════════════════ */

/** Uma linha de xp_log. Sem `id` e sem `user_id`: o cálculo não precisa. */
export interface XpEntry {
  /** Instante ISO em que o XP foi concedido. */
  created_at: string;
  points: number;
  /** Texto gravado pelo gatilho. É o único jeito de saber que o XP veio de
   *  peso, porque xp_log não tem coluna `kind`. */
  reason: string;
}

/** Um evento da linha do tempo, reduzido ao que o Mokari pode ver.
 *  NÃO tem `payload`: nenhum valor de corpo chega até aqui. */
export interface MokariEvent {
  /** Instante ISO do evento. */
  occurred_at: string;
  pillar: string;
  kind: string;
}

/* ═══ Saída ═══════════════════════════════════════════════════════════ */

/** 4 estágios globais. O número é a camada de corpo; o NOME é do Prisma. */
export type MokariStage = 1 | 2 | 3 | 4;

/** 3 níveis visuais por pilar. 0 = ainda sem marca (nada é desenhado). */
export type PillarAffinity = 0 | 1 | 2 | 3;

/** 5 ambientes, do TEMPO de jornada — nunca de desempenho. */
export type MokariEnvironment = 1 | 2 | 3 | 4 | 5;

/**
 * REGRA 2: os cinco estados recentes.
 *
 * Este é o único aspecto que pode DESCER, porque descreve o agora e não o
 * conquistado. Ainda assim nenhum é negativo: `descanso` é o estado de quem
 * não registrou nada, e descanso não é falha — é descanso. Não existe
 * "triste", "doente", "abandonado", nem contador de dias parados.
 *
 * Os ids estão aqui porque o cálculo precisa deles; os RÓTULOS visíveis são do
 * Prisma. A ordem é a de intensidade de atividade, não de valor: nenhum estado
 * é melhor que outro.
 */
export const MOKARI_STATES = ["movimento", "curioso", "atento", "sereno", "descanso"] as const;
export type MokariState = typeof MOKARI_STATES[number];

export interface Mokari {
  calc_version: string;
  /** Último dia considerado. Parâmetro, nunca relógio. */
  reference_day: string;
  stage: MokariStage;
  /** Marca-d'água por pilar. Sempre traz os três. */
  affinity: Record<PillarId, PillarAffinity>;
  state: MokariState;
  environment: MokariEnvironment;
  /** Números que a tela pode mostrar sem recalcular nada. */
  detail: {
    /** XP que contou (já sem peso/corpo). */
    xp: number;
    /** Registros que contaram (já sem peso/corpo), em toda a história. */
    events: number;
    /** Dias desde o começo da jornada. */
    journey_days: number;
    /** Dias com algum registro na janela recente. Serve ao estado, e é
     *  contagem de PRESENÇA — nunca de ausência (regra 2). */
    active_days_recent: number;
    /** Registros por pilar em toda a história (já sem peso/corpo).
     *
     *  É a entrada da DENSIDADE (mokariDensity.ts), o eixo que não satura. A
     *  `affinity` continua existindo e continua sendo marca-d'água, mas ela
     *  tem três níveis e três níveis acabam: era por isso que o desenho
     *  parava de responder por volta do dia 40. A contagem crua não acaba. */
    pillar_events: Record<PillarId, number>;
    /** Registros por ÓRGÃO (já sem peso/corpo). É ISTO que a árvore desenha:
     *  raiz, folha, fruto e flor, quatro chaves fixas. `pillar_events` continua
     *  existindo para o que fala em PILAR — a marca de destaque na legenda e
     *  os brotos —, e as duas contagens não são a mesma coisa desde que
     *  Vitalidade passou a desenhar duas peças. Ver o bloco OS QUATRO ÓRGÃOS. */
    organ_events: Record<MokariOrgan, number>;
  };
}

/* ═══ Limiares ════════════════════════════════════════════════════════
   Escritos em UM lugar, com o porquê, para que mexer neles seja uma decisão e
   não um acidente. Mudar qualquer um exige subir MOKARI_CALC_VERSION. */

/** XP acumulado para cada estágio. A curva acompanha a do nível do app
 *  (xp.ts): o estágio 2 chega no começo da segunda semana de uso real. */
const STAGE_XP: readonly number[] = [0, 200, 1000, 3000];

/** Registros no pilar para cada nível de marca. */
const AFFINITY_EVENTS: readonly number[] = [1, 10, 40];

/** Dias de jornada para cada etapa de ambiente. */
const ENVIRONMENT_DAYS: readonly number[] = [0, 7, 30, 90, 180];

/** Janela do estado recente. Sete dias porque é a semana da pessoa: menos que
 *  isso oscila com um dia atípico, mais que isso deixa de descrever o agora. */
export const RECENT_WINDOW_DAYS = 7;

/* ═══ Primitivas ══════════════════════════════════════════════════════ */

/**
 * Dia do carimbo NO FUSO DO APP.
 *
 * Era `slice(0, 10)`, e isso estava errado pelo mesmo motivo que a revisão da
 * branch pegou em Alimentação: `occurred_at` é `timestamptz` e chega do
 * PostgREST em UTC, então o corte devolve o dia UTC — não o dia que a pessoa
 * viveu. Com São Paulo em UTC-3, tudo registrado das 21:00 em diante cai no dia
 * seguinte: um treino às 22:30 de sábado contava como domingo. Na janela de
 * sete dias do estado recente isso faz um dia ativo entrar ou sair pela borda,
 * e o Mokari alterna entre "movimento" e "atento" sem nada ter mudado na vida
 * da pessoa. No ambiente, desloca `journey_days` em um.
 *
 * `localDay` devolve `null` para carimbo ilegível; aqui isso vira "", que não
 * casa com nenhuma janela e não conta como dia — um registro corrompido não
 * pode inventar um dia nem derrubar o cálculo inteiro.
 */
const dayOf = (iso: string) => localDay(iso) ?? "";

/** Dias inteiros de `from` até `to`. Negativo se `to` for anterior. */
export function daysBetween(from: string, to: string): number {
  const parse = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return Date.UTC(y, (m || 1) - 1, dd || 1);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/**
 * REGRA 1, o coração dela: converte uma série cronológica de contribuições em
 * o MAIOR patamar já alcançado.
 *
 * Por que não basta olhar o total atual: `xp_log` some junto com o evento que
 * o gerou (o banco tem cascade), e um dia alguém vai poder apagar registros em
 * lote. Se o patamar viesse do total, apagar história rebaixaria o Mokari — e
 * uma semana ruim, ou uma limpeza de dados, desfaria três meses. Percorrendo a
 * série e guardando o máximo, contribuição negativa ou corretiva NUNCA puxa o
 * patamar para baixo.
 *
 * `thresholds` é crescente; devolve o índice do maior patamar atingido.
 */
/** Patamar de um valor numa escala crescente de limiares. */
function levelOf(value: number, thresholds: readonly number[]): number {
  let level = 0;
  while (level < thresholds.length && value >= thresholds[level]) level++;
  return level;
}

export function highWaterMark(
  contributions: readonly number[], thresholds: readonly number[],
): number {
  const levelFor = (running: number) => levelOf(running, thresholds);
  // O patamar do total INICIAL (zero) também conta: um limiar 0 já está
  // atingido antes da primeira contribuição. Sem esta linha, história vazia e
  // história com uma contribuição de 0 davam patamares diferentes — diferença
  // que só não aparecia porque o chamador fazia clamp por cima.
  let running = 0;
  let best = levelFor(running);
  for (const value of contributions) {
    running += value;
    const level = levelFor(running);
    if (level > best) best = level;
  }
  return best;
}

/** Ordena por dia com desempate explícito, para a série da marca-d'água ser
 *  sempre a mesma independentemente da ordem em que as linhas chegaram. */
function chronological<T extends { at: string; key: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}

/* ═══ As peças ════════════════════════════════════════════════════════ */

/**
 * Estágio (4 camadas de corpo) pelo XP acumulado — marca-d'água alta.
 * O XP de peso e composição corporal é descartado (regra 3).
 */
/**
 * Estágio a partir do XP TOTAL. É esta a versão que a produção usa.
 *
 * PRECONDIÇÃO, e o motivo de as duas versões coexistirem: o app nunca escreve
 * XP negativo (todos os inserts de xp_log são literais positivos ou o CASE de
 * award_xp_for_event, também positivo). Com contribuições não-negativas o
 * total corrido é monótono, então a marca-d'água É a soma — e uma soma vem do
 * banco exata, sem depender de trazer linha nenhuma.
 *
 * A versão por array (mokariStage) continua existindo e continua percorrendo a
 * série, porque ela é a defesa contra o dia em que aparecer um estorno: ali a
 * marca-d'água e a soma passam a divergir, e a que protege a pessoa é a
 * marca-d'água. Ver o teste "XP negativo ou corretivo não puxa o estágio".
 */
export function mokariStageFromXpTotal(total: number): MokariStage {
  const bruto = Number.isFinite(total) ? total : 0;
  return Math.min(4, Math.max(1, levelOf(bruto, STAGE_XP))) as MokariStage;
}

export function mokariStage(xp: readonly XpEntry[]): MokariStage {
  const contando = chronological(
    xp.filter((e) => !IGNORED_XP_REASONS.includes(String(e.reason)))
      .map((e) => ({ at: String(e.created_at), key: String(e.reason), points: Number(e.points) || 0 })),
  );
  const level = highWaterMark(contando.map((e) => e.points), STAGE_XP);
  // STAGE_XP começa em 0, então qualquer história (inclusive vazia) é >= 1.
  return Math.min(4, Math.max(1, level)) as MokariStage;
}

/**
 * Afinidade por pilar (3 níveis) pela contagem de registros do pilar em TODA a
 * história — marca-d'água alta, por pilar. Nunca é janela: janela regride.
 * Eventos de peso/corpo são descartados (regra 3).
 */
export function mokariAffinityFromCounts(
  counts: Readonly<Partial<Record<PillarId, number>>>,
): Record<PillarId, PillarAffinity> {
  const out = {} as Record<PillarId, PillarAffinity>;
  for (const pillar of PILLARS) {
    const n = Number(counts[pillar.id] ?? 0);
    out[pillar.id] = levelOf(Number.isFinite(n) ? n : 0, AFFINITY_EVENTS) as PillarAffinity;
  }
  return out;
}

/**
 * Afinidade a partir da lista de eventos. DELEGA para a versão por contagem:
 * como toda contribuição vale 1, a marca-d'água alta É a contagem total do
 * pilar — então as duas versões não são "duas implementações que um teste
 * mantém em sincronia", são a MESMA conta com a entrada em outra forma. É por
 * isso que elas não podem divergir em silêncio.
 *
 * Eventos de peso/corpo são descartados aqui (regra 3). Quando a entrada vem
 * por CONTAGEM, essa exclusão é responsabilidade de quem monta a consulta —
 * ver o aviso em MokariTotals.
 */
export function mokariAffinity(events: readonly MokariEvent[]): Record<PillarId, PillarAffinity> {
  const counts = {} as Record<PillarId, number>;
  for (const pillar of PILLARS) {
    counts[pillar.id] = events.filter(
      (e) => pillarMatchValues(pillar.id).includes(e.pillar)
        && !IGNORED_KINDS.includes(String(e.kind)),
    ).length;
  }
  return mokariAffinityFromCounts(counts);
}

/**
 * Ambiente (5 etapas) pelo TEMPO de jornada, não por desempenho: quem passou
 * seis meses aqui viu o ambiente mudar seis meses, independentemente de ter
 * tido um mês fraco. Como o tempo só anda para frente, isto nunca regride.
 *
 * `journeyStart` é o começo declarado (normalmente a criação da conta). Sem
 * ele, cai no primeiro registro da história.
 */
export function mokariEnvironment(
  events: readonly MokariEvent[], referenceDay: string, journeyStart?: string,
): { environment: MokariEnvironment; journeyDays: number } {
  const dias = eventDays(events);
  const inicio = journeyStart ? dayOf(journeyStart) : (dias[0] ?? referenceDay);
  const journeyDays = Math.max(0, daysBetween(inicio, referenceDay));
  return { environment: environmentForDays(journeyDays), journeyDays };
}

/** Etapa de ambiente para um número de dias de jornada. Usada pelas DUAS
 *  entradas, para o ambiente não ter duas contas. */
function environmentForDays(journeyDays: number): MokariEnvironment {
  return Math.min(5, Math.max(1, levelOf(journeyDays, ENVIRONMENT_DAYS))) as MokariEnvironment;
}

/** Dias distintos com registro que conta, em ordem. */
function eventDays(events: readonly MokariEvent[]): string[] {
  const dias = new Set(
    events.filter((e) => !IGNORED_KINDS.includes(String(e.kind)))
      .map((e) => dayOf(e.occurred_at))
      .filter(Boolean),
  );
  return [...dias].sort((a, b) => a.localeCompare(b));
}

/**
 * REGRA 2: o estado recente. O único que pode descer — e nenhum dos cinco
 * acusa.
 *
 * A ordem das perguntas é a decisão de produto aqui: consistência primeiro
 * (quem apareceu quase todo dia está "em movimento", mesmo que num só pilar),
 * depois amplitude (quem passeou por três pilares está "curioso"). Sem
 * registro na janela, `descanso` — que descreve, não cobra.
 */
export function mokariState(
  events: readonly MokariEvent[], referenceDay: string,
): { state: MokariState; activeDays: number } {
  const inicio = addDays(referenceDay, -(RECENT_WINDOW_DAYS - 1));
  const naJanela = events.filter((e) => {
    if (IGNORED_KINDS.includes(String(e.kind))) return false;
    const d = dayOf(e.occurred_at);
    return d >= inicio && d <= referenceDay;
  });

  const activeDays = new Set(
    naJanela.map((e) => dayOf(e.occurred_at)).filter(Boolean),
  ).size;
  const pilares = new Set(naJanela.map((e) => e.pillar)).size;

  if (activeDays === 0) return { state: "descanso", activeDays };
  if (activeDays >= 5) return { state: "movimento", activeDays };
  if (pilares >= 3) return { state: "curioso", activeDays };
  if (activeDays >= 3) return { state: "atento", activeDays };
  return { state: "sereno", activeDays };
}

/* ═══ Entrada por TOTAIS — é esta que a produção usa ══════════════════
   POR QUE ELA EXISTE (bug real, achado na auditoria das fases 1-6):
   a versão por array precisa da história inteira, e o hook a baixava com
   `.limit(5000)`. O PostgREST corta em max-rows=1000. Lendo em ordem
   CRESCENTE, as 1000 linhas mais antigas de quem importou 555 noites de sono
   são TODAS de vitalidade — e alimentação e prosperidade sumiam da afinidade.
   O Mokari mostrava pilar zerado de quem havia registrado nele.

   Ler em ordem crescente protege contra REGRESSÃO (a marca-d'água não cai),
   mas não contra um pilar inteiro ficar fora da janela. Esse era o furo.

   O conserto não é limite maior, é não precisar das linhas: a afinidade é
   contagem por pilar e o estágio é soma de XP. Os dois vêm agregados do banco,
   exatos, sem teto. O estado recente continua vindo de eventos porque são só
   sete dias — janela naturalmente pequena.

   O repositório já tinha sido mordido por isto antes; a história está no
   comentário de useXp.tsx. */

export interface MokariTotals {
  /**
   * XP total EXCLUINDO os IGNORED_XP_REASONS.
   *
   * ⚠ REGRA 3 DEPENDE DE QUEM MONTA A CONSULTA. Com a entrada por array o
   * filtro é feito aqui dentro; com totais, não há como este módulo verificar.
   * Use o RPC `xp_total_mokari(uid)`, que aplica a exclusão em SQL ao lado do
   * gatilho que grava esses motivos. NÃO use `xp_total(uid)`: ele soma tudo,
   * inclusive "Peso registrado", e fura a regra 3 direto.
   *
   * E não derive no cliente (`xp_total − 3×peso − 4×corpo`): isso fixaria no
   * frontend os pontos do gatilho, e no dia em que award_xp_for_event mudar o
   * XP de peso volta a vazar para o estágio em silêncio.
   */
  xpTotal: number;
  /** Registros por pilar, TAMBÉM já sem weight/body (regra 3, na consulta). */
  pillarCounts: Readonly<Partial<Record<PillarId, number>>>;
  /** Total de registros que contam, para o `detail`. */
  eventsTotal: number;
  /**
   * Começo da jornada (normalmente a criação da conta, ou o primeiro registro
   * por `occurred_at asc limit 1`). Sem ele o ambiente não tem de onde contar
   * e fica na primeira etapa — melhor do que adivinhar.
   */
  journeyStart: string | null;
  /** Eventos dos últimos RECENT_WINDOW_DAYS dias. Só o estado usa. */
  recentEvents: readonly MokariEvent[];
  /** As seis contagens dos órgãos, TAMBÉM já sem weight/body (na consulta). */
  organTotals: MokariOrganTotals;
}

/**
 * O Mokari a partir de agregados. Idêntico, para o mesmo conjunto, ao que
 * computeMokari devolve — ver o teste de equivalência, que é o que impede as
 * duas entradas de divergirem em silêncio daqui em diante.
 */
export function computeMokariFromTotals(
  totals: MokariTotals, referenceDay: string,
): Mokari {
  const journeyDays = totals.journeyStart
    ? Math.max(0, daysBetween(dayOf(totals.journeyStart), referenceDay))
    : 0;
  const { state, activeDays } = mokariState(totals.recentEvents, referenceDay);

  return {
    calc_version: MOKARI_CALC_VERSION,
    reference_day: referenceDay,
    stage: mokariStageFromXpTotal(totals.xpTotal),
    affinity: mokariAffinityFromCounts(totals.pillarCounts),
    state,
    environment: environmentForDays(journeyDays),
    detail: {
      xp: Number.isFinite(totals.xpTotal) ? totals.xpTotal : 0,
      events: totals.eventsTotal,
      journey_days: journeyDays,
      active_days_recent: activeDays,
      pillar_events: pillarEventsFromCounts(totals.pillarCounts),
      organ_events: organEventsFromCounts(totals.organTotals),
    },
  };
}

/** Normaliza a contagem por pilar: sempre os três, sempre número finito. */
export function pillarEventsFromCounts(
  counts: Readonly<Partial<Record<PillarId, number>>>,
): Record<PillarId, number> {
  const out = {} as Record<PillarId, number>;
  for (const pillar of PILLARS) {
    const n = Number(counts[pillar.id] ?? 0);
    out[pillar.id] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return out;
}

/* ═══ Orquestrador ════════════════════════════════════════════════════ */

/**
 * O Mokari inteiro. Idempotente: a mesma história, com a mesma
 * `referenceDay`, produz exatamente o mesmo objeto — inclusive se as linhas
 * chegarem embaralhadas.
 */
export function computeMokari(
  xp: readonly XpEntry[],
  events: readonly MokariEvent[],
  referenceDay: string,
  journeyStart?: string,
): Mokari {
  const contaveis = events.filter((e) => !IGNORED_KINDS.includes(String(e.kind)));
  const { environment, journeyDays } = mokariEnvironment(events, referenceDay, journeyStart);
  const { state, activeDays } = mokariState(events, referenceDay);

  return {
    calc_version: MOKARI_CALC_VERSION,
    reference_day: referenceDay,
    stage: mokariStage(xp),
    affinity: mokariAffinity(events),
    state,
    environment,
    detail: {
      xp: xp.filter((e) => !IGNORED_XP_REASONS.includes(String(e.reason)))
        .reduce((sum, e) => sum + (Number(e.points) || 0), 0),
      events: contaveis.length,
      journey_days: journeyDays,
      active_days_recent: activeDays,
      // Mesma conta da afinidade, sem os três degraus: é a contagem crua que
      // alimenta a densidade sem teto.
      pillar_events: pillarEventsFromCounts(
        Object.fromEntries(PILLARS.map((p) => [
          // Leitor TOLERANTE: enquanto houver linha histórica não migrada,
          // contar só `vitalidade` faria sumir da marca-d'água tudo o que a
          // pessoa registrou sob o pilar absorvido.
          p.id, contaveis.filter((e) => pillarMatchValues(p.id).includes(e.pillar)).length,
        ])),
      ),
      organ_events: organEventsFromCounts(organTotalsFromEvents(events)),
    },
  };
}
