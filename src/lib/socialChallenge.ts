// ASCENDE — Social: "A SEMANA INTEIRA" e o placar que não ordena ninguém.
//
// ─── POR QUE ESTE DESAFIO, E NÃO UM DE TREINO ───
//
// O GymRats pode copiar um ranking de treino numa sprint. Não pode copiar um
// desafio que exige sono, comida e água na mesma conta, porque ele não tem
// esses dados. É a única forma de o Social ser PROVA da caixinha em vez de
// diluição dela.
//
// ─── AS DUAS REGRAS QUE ESTE ARQUIVO CARREGA, E QUE SÃO DE ÉTICA ───
//
// 1. O DIA INTEIRO É 3 DE 4, NUNCA 4 DE 4. Dia de descanso ainda conta pelos
//    outros três, e quem desligou um tracker não fica de fora do desafio por
//    causa de uma escolha de privacidade. A folga é da REGRA, não um perdão
//    excepcional concedido depois.
// 2. NINGUÉM É ORDENADO POR DESEMPENHO. Ordinal público entre pessoas está
//    vetado (§4 do parecer). O que fica é a barra coletiva e a linha de cada um
//    contra a META DELA. Soma é monotônica em presença — todo ranking de soma é
//    um ranking de frequência disfarçado, e o rótulo "sem registro" conserta a
//    PALAVRA, não a POSIÇÃO.
//
// ─── PUREZA (mesma regra de lib/mokari.ts) ───
//
// Sem Supabase, sem Date.now(), sem `new Date()` sem argumento. A data de
// referência ENTRA como parâmetro, então a mesma semana produz sempre o mesmo
// placar. Sem import de lib/battles e sem import de lib/xp — travado por
// socialIsolation.test.ts, que lê o código-fonte.
import {
  SHAREABLE_METRICS, isShareable, type SocialMetricKey, type SocialSignal,
} from "@/lib/socialMetrics";

export type { SocialSignal };

/* ═══ A UNIDADE: UM DIA INTEIRO ═══════════════════════════════════════ */

/** Os quatro sinais do dia. Saem da composição declarada de `dia_inteiro` no
 *  catálogo, e não de uma segunda lista escrita aqui: duas listas viram duas
 *  verdades, e a que o Fiel auditou é a do catálogo. */
export const FULL_DAY_SIGNALS: readonly SocialSignal[] =
  SHAREABLE_METRICS.dia_inteiro.composedOf.map(
    (k) => SHAREABLE_METRICS[k].signals[0],
  );

/** Os sinais que ESTA pessoa acompanha, e o que ela registrou no dia. */
export interface DaySignals {
  /** Sinais ligados para ela (tracker ativo). Quem desligou água tem 3. */
  tracked: readonly SocialSignal[];
  /** Sinais que ela de fato registrou naquele dia. */
  done: readonly SocialSignal[];
}

/**
 * Quantos sinais fecham um dia inteiro para quem acompanha `tracked`.
 *
 * É `tracked − 1`, com piso em 1: quatro sinais pedem três, três pedem dois.
 * Uma folga por dia, SEMPRE, e proporcional — não uma tabela de exceções.
 *
 * O piso em 1 existe para o caso degenerado: com um único sinal acompanhado,
 * `tracked − 1` seria zero, e um dia inteiro sem registro nenhum tornaria o
 * desafio uma mentira educada. Com zero sinais acompanhados não há dia inteiro
 * possível — e isso é a verdade, não uma punição.
 */
export function fullDayThreshold(trackedCount: number): number {
  const n = Number.isFinite(trackedCount) ? Math.floor(trackedCount) : 0;
  if (n <= 0) return 0;
  return Math.max(1, n - 1);
}

/** O dia fechou? Só conta sinal que ela ACOMPANHA e que é do dia inteiro —
 *  registrar gratidão não fecha um dia de "A Semana Inteira". */
export function isFullDay(day: DaySignals): boolean {
  const consideraveis = new Set(
    day.tracked.filter((s) => FULL_DAY_SIGNALS.includes(s)),
  );
  if (!consideraveis.size) return false;
  const feitos = new Set(
    day.done.filter((s) => consideraveis.has(s)),
  );
  return feitos.size >= fullDayThreshold(consideraveis.size);
}

/** Quantos dias inteiros nesta lista de dias. A lista é SEMPRE de uma pessoa
 *  só — ver o comentário de `MemberTotals` sobre série diária de terceiro. */
export const countFullDays = (days: readonly DaySignals[]): number =>
  days.reduce((n, d) => n + (isFullDay(d) ? 1 : 0), 0);

/* ═══ A META ══════════════════════════════════════════════════════════ */

/** Dias inteiros combinados por pessoa numa semana. Cinco, de sete: os dois
 *  dias de folga por pessoa JÁ ESTÃO EMBUTIDOS na meta. A regra do descanso
 *  aplicada no nível do grupo, não como perdão excepcional. */
export const WEEK_DAYS_PER_PERSON = 5;

/** A meta do grupo: pessoas × 5. */
export function groupWeekGoal(people: number): number {
  const n = Number.isFinite(people) ? Math.floor(people) : 0;
  return Math.max(0, n) * WEEK_DAYS_PER_PERSON;
}

/* ═══ O PLACAR ════════════════════════════════════════════════════════ */

/**
 * O k MÍNIMO. A barra coletiva de um metric_key só aparece com pelo menos
 * QUATRO consentimentos ativos naquele grupo.
 *
 * Agregado não é anônimo em grupo pequeno: com a barra coletiva mais as linhas
 * individuais, num grupo de 3 qualquer um deduz o número do terceiro por
 * subtração — inclusive o de quem manteve a posição privada. Abaixo do k, cada
 * um vê só o próprio número.
 */
export const COLLECTIVE_MIN_CONSENTS = 4;

/**
 * O que o placar recebe de CADA pessoa: um total do ciclo, e a meta DELA.
 *
 * REPARE NO QUE NÃO EXISTE AQUI: não há campo de série diária. É deliberado, e
 * é estrutura em vez de política — "a API do grupo nunca devolve série diária
 * de terceiro" (Fiel, B2, segunda consequência). O calendário de bolinhas de
 * outra pessoa é o artefato de vergonha mais eficiente desta categoria de app,
 * e ele não é recusado por uma regra que alguém precisa lembrar: ele não tem
 * onde caber. Uma política pode ser escrita errado; um campo que não existe,
 * não.
 *
 * `goal` é o denominador, e ele é obrigatório pelo mesmo motivo: sem a meta da
 * própria pessoa guardada junto, a tela só consegue renderizar número absoluto
 * — ou seja, a comparação absoluta ficaria assada no schema e a regra C3
 * (comparação sempre contra a meta da própria pessoa) seria impossível de
 * cumprir na tela.
 */
export interface MemberTotals {
  memberId: string;
  name: string;
  /** Dias inteiros que ELA fechou no ciclo. */
  done: number;
  /** O que ELA combinou para este ciclo. Nunca o de outra pessoa. */
  goal: number;
  /** Ordem de entrada no grupo, para `order: "entrada"`. */
  joinedAt?: string;
}

export interface ScoreboardLine {
  memberId: string;
  name: string;
  done: number;
  goal: number;
  /** É a linha de quem está olhando. A tela destaca; o placar não ordena. */
  isViewer: boolean;
}

export interface Scoreboard {
  /** A barra do grupo, ou `null` quando o k mínimo não foi alcançado. */
  collective: { done: number; goal: number } | null;
  /** Por que a barra não apareceu — para a tela poder DIZER, em vez de só
   *  omitir. Omissão sem explicação é a pessoa achando que é bug. */
  collectiveHiddenReason: "k-minimo" | null;
  lines: ScoreboardLine[];
}

export interface ScoreboardInput {
  members: readonly MemberTotals[];
  viewerId: string;
  /** Consentimentos ATIVOS naquele metric_key — não é o tamanho do grupo.
   *  Quem está no grupo mas não compartilha aquela métrica não conta para o k. */
  consentCount: number;
  /** Nunca "por desempenho". As duas opções são as do parecer, e a assinatura
   *  não oferece uma terceira de propósito: um `order` livre seria o ranking
   *  entrando por configuração. */
  order?: "alfabetica" | "entrada";
}

/**
 * O placar de um metric_key num ciclo.
 *
 * (a) a barra coletiva do grupo contra a meta do grupo;
 * (b) a linha de cada pessoa contra a META DELA, nunca número absoluto
 *     comparável — assim quem combinou 2 e cumpriu aparece completo ao lado de
 *     quem combinou 6, que é a verdade que o ordinal apaga.
 *
 * Abaixo do k mínimo devolve SÓ a linha de quem está olhando: sem a barra, e
 * também sem as linhas dos outros — porque manter as linhas e esconder a barra
 * deixaria a dedução de pé pelo outro lado.
 */
export function weekScoreboard(input: ScoreboardInput): Scoreboard {
  const membros = [...(input.members ?? [])];
  const consentimentos = Number.isFinite(input.consentCount) ? input.consentCount : 0;
  const coletivoVisivel = consentimentos >= COLLECTIVE_MIN_CONSENTS;

  const visiveis = coletivoVisivel
    ? membros
    : membros.filter((m) => m.memberId === input.viewerId);

  /* ORDEM: alfabética (padrão) ou por entrada. NUNCA por desempenho, e o
     desempate também não pode ser por desempenho — senão o ranking volta pela
     porta dos fundos toda vez que dois nomes forem iguais. Desempata por
     memberId, que é estável e não diz nada sobre ninguém. */
  const porNome = (a: MemberTotals, b: MemberTotals) =>
    a.name.localeCompare(b.name, "pt-BR") || a.memberId.localeCompare(b.memberId);
  const porEntrada = (a: MemberTotals, b: MemberTotals) =>
    String(a.joinedAt ?? "").localeCompare(String(b.joinedAt ?? "")) ||
    a.memberId.localeCompare(b.memberId);

  visiveis.sort(input.order === "entrada" ? porEntrada : porNome);

  return {
    collective: coletivoVisivel
      ? {
        done: membros.reduce((s, m) => s + (Number(m.done) || 0), 0),
        goal: membros.reduce((s, m) => s + (Number(m.goal) || 0), 0),
      }
      : null,
    collectiveHiddenReason: coletivoVisivel ? null : "k-minimo",
    // A saída carrega os mesmos quatro campos da entrada, e nada mais: nenhum
    // percentual e nenhum denominador de JANELA. "Religar deixa um buraco"
    // protege o dado e denuncia a pessoa — um vão de 3 a 20 de setembro é lido
    // pelo grupo como "aconteceu alguma coisa ali", e o controle de privacidade
    // vira sinal social. A tela nunca mostra o denominador da janela de outra
    // pessoa, nem percentual que permita derivá-lo.
    lines: visiveis.map((m) => ({
      memberId: m.memberId,
      name: m.name,
      done: Number(m.done) || 0,
      goal: Number(m.goal) || 0,
      isViewer: m.memberId === input.viewerId,
    })),
  };
}

/** Esta métrica pode aparecer numa lista ORDENADA? Nem toda métrica do
 *  catálogo pode: gratidão e constância de pesagem ficam, mas nunca ordenadas
 *  (ressalva do Fiel). Hoje nenhuma lista do Social ordena por desempenho —
 *  esta função existe para que, se um dia alguém construir uma, o `false`
 *  chegue antes da tela. */
export const canBeRanked = (key: SocialMetricKey | string): boolean =>
  isShareable(key) && !SHAREABLE_METRICS[key as SocialMetricKey]?.neverRanked;
