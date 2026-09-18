// ASCENDE — Social: A SEMANA DE CADA UM, E O QUE O ZERO PODE DIZER.
//
// ─── POR QUE ISTO É FUNÇÃO PURA, E NÃO UM `if` DENTRO DO JSX ────────────
//
// A regra C do parecer do Fiel (18/09/2026) decide, linha a linha, se o grupo
// tem direito de ler um número sobre uma pessoa. Ela tem três saídas, e as
// três são fáceis de confundir numa refatoração futura:
//
//   • `feito` NULL  → NÃO HÁ DIREITO AO NÚMERO (sem consentimento daquela
//     métrica, sem reciprocidade, fora da janela de visão). A pessoa
//     simplesmente NÃO APARECE naquela métrica. Nunca "sem registro" ao lado
//     do nome, nunca linha vazia: sumir é menos que ser exibido como buraco.
//   • `feito` 0 com meta declarada → "0 de 6", desde segunda, PARA TODOS,
//     inclusive terceiros. Zero com denominador declarado não acusa: situa.
//     O que a doutrina do zero sempre vetou foi inferir zero da AUSÊNCIA de
//     linha; aqui a linha existe porque a pessoa declarou a meta em voz alta.
//   • consentida SEM meta semanal → "sem registro" (e só aqui). É o único
//     lugar onde esta frase é permitida — nunca como eufemismo de zero.
//
// Escrito como função pura pelo mesmo motivo de `lib/mokari.ts` e
// `lib/socialMetrics.ts`: regra que depende de alguém lembrar é regra que uma
// refatoração apaga sem ninguém ver. Aqui ela quebra um teste.
//
// ─── PUREZA ────────────────────────────────────────────────────────────
//
// Sem Supabase, sem `Date.now()`, sem `new Date()` sem argumento. As datas
// entram como string ISO. Travado por socialIsolation.test.ts, que lê o fonte.
import type { SocialMetricKey } from "@/lib/socialMetrics";

/* ═══ A LINHA DE UMA PESSOA NUMA MÉTRICA ══════════════════════════════ */

/** O que `v_grupo_semana` devolve por pessoa por métrica. `feito` NULL e
 *  `feito` 0 são FATOS DIFERENTES, e o banco devolve os dois de propósito —
 *  colapsar um no outro é o erro que esta função existe para impedir. */
export interface LinhaCrua {
  /** NULL = não há direito ao número. 0 = há direito, e ele é zero. */
  feito: number | null;
  /** A meta SEMANAL que a própria pessoa declarou. NULL = não há meta
   *  semanal (o consentimento existe com outro período). */
  combinado: number | null;
}

export type LinhaDaSemana =
  /** Não se desenha nada: a pessoa não aparece nesta métrica. */
  | { tipo: "oculta" }
  /** "X de Y combinados", com Y sendo a meta DELA — nunca a maior do grupo,
   *  nunca a média. */
  | { tipo: "contagem"; feito: number; meta: number; cumpriu: boolean }
  /** Consentida sem meta semanal: não se inventa denominador (regra A.4). */
  | { tipo: "sem-meta"; texto: "sem registro" | "sem meta combinada" };

/** A linha que CHEGA a desenhar alguma coisa. "oculta" não é um estado
 *  visual: é a pessoa não aparecendo naquela métrica, e o tipo diz isso para
 *  o compilador — a tela não recebe a chance de desenhar um buraco. */
export type LinhaVisivel = Exclude<LinhaDaSemana, { tipo: "oculta" }>;

/** A linha é de desenhar? Guarda de tipo, para a tela filtrar sem `as`. */
export const linhaVisivel = (l: LinhaDaSemana): l is LinhaVisivel => l.tipo !== "oculta";

/**
 * A regra C, colada do parecer e transformada em código.
 *
 * REPARE NO QUE NÃO EXISTE AQUI: nenhum caminho devolve um denominador que a
 * pessoa não declarou. "Assumir 7 dias" seria o app combinando por ela, e é
 * exatamente o que a condição A.4 proíbe.
 */
export function linhaDaSemana(l: LinhaCrua): LinhaDaSemana {
  const feito = l.feito === null || l.feito === undefined ? null : Number(l.feito);
  const meta = l.combinado === null || l.combinado === undefined ? null : Number(l.combinado);

  // Sem direito ao número: a pessoa não aparece nesta métrica. Esta é a
  // PRIMEIRA pergunta de propósito — qualquer ordem que a deixe para depois
  // arrisca escrever um zero sobre quem só não compartilha.
  if (feito === null || !Number.isFinite(feito)) return { tipo: "oculta" };

  if (meta === null || !Number.isFinite(meta) || meta <= 0) {
    // "sem registro" é permitido AQUI e em lugar nenhum mais. Com número
    // feito e sem meta, dizer "sem registro" seria mentira — e número solto
    // sem denominador é comparação absoluta, que a C3 veta.
    return { tipo: "sem-meta", texto: feito === 0 ? "sem registro" : "sem meta combinada" };
  }

  // Os dois normalizados ANTES de comparar: desenhar "5 de 5" sem o ✓ (ou o
  // contrário) porque a comparação olhou o valor cru é incoerência barata de
  // evitar. `numeric` aceita fração mesmo que hoje ninguém grave uma.
  const feitoInt = Math.max(0, Math.floor(feito));
  const metaInt = Math.floor(meta);
  return { tipo: "contagem", feito: feitoInt, meta: metaInt, cumpriu: feitoInt >= metaInt };
}

/* ═══ A GEOMETRIA SAIU DAQUI, E ISSO É A DECISÃO ═════════════════════
   ─────────────────────────────────────────────────────────────────────────
   Aqui moravam `formaDaTrilha`, `MAX_DOTS`, `PX_POR_META` e `LARGURA_MAXIMA`:
   a trilha de dots cujo comprimento era a meta da pessoa. Ela saiu inteira em
   18/09/2026, e o motivo é o achado mais importante desta revisão.

   O QA mediu o DOM: numa coluna só (390px), três cartões com a mesma métrica
   têm a trilha começando no MESMO x (97px, medido), porque o rótulo de uma
   mesma métrica tem sempre a mesma largura. A trava era "nada alinha em
   coluna" — e ela dependia de os rótulos terem larguras diferentes, que é
   falso justamente no caso que importa. Com os dots cheios ancorados no mesmo
   x, o olho compara o COMPRIMENTO DO BLOCO CHEIO, e lê "Bruno > Ana > Você"
   em menos de um segundo, sem ler número nenhum.

   Comprimento ancorado é canal PRÉ-ATENTO. A linha do Fiel (Adendo 2):

     > Comparação que a pessoa FAZ é dela. Comparação que a tela ENTREGA
     > PRONTA, pré-atentiva, em menos de um segundo, sem ler, é o produto
     > comparando por ela. A segunda é a régua comum, e é o que está vetado.

   Nenhum ajuste de pixel salvava a forma: a diferença entre meta 5 e meta 6
   era de 11px numa trilha de 62px (invisível), a trilha ENCOLHIA de 73px para
   64px quando a meta ia de 7 para 8, e acima de 12 todas as metas empatavam
   em 96px — que é literalmente a barra de largura fixa com preenchimento
   percentual que o desenho dizia não ser.

   Então: **a geometria sai, o número fica.** O número era o pedido do fundador
   ("0 de 6", "1 de 6") e é a forma canônica da seção D do parecer; a geometria
   não foi pedida por ninguém. Sem geometria, o alinhamento em coluna vira
   inofensivo: "Treinos 3 de 5" e "Treinos 1 de 6" no mesmo x são duas frases
   que precisam ser LIDAS, com denominadores diferentes — não duas barras que
   se varrem.

   Quem for reintroduzir qualquer recipiente aqui: o teste é o do Adendo 2 —
   dá para ordenar as pessoas em menos de um segundo, sem ler? Se dá, é régua.
   ───────────────────────────────────────────────────────────────────────── */

/* ═══ O PERÍODO DA META — o bug da barra 4× cheia ═════════════════════ */

/**
 * `group_data_consents.goal_value` é uma meta SEMANAL; `total_do_ciclo` soma
 * o CICLO INTEIRO. Um desafio de quatro semanas comparava quatro semanas de
 * feito contra uma semana de combinado — e a barra aparecia 4× cheia, dizendo
 * ao grupo que ele cumpriu quatro vezes o que combinou.
 *
 * O conserto é escalar o denominador, não encolher o numerador: a meta do
 * ciclo é a meta semanal vezes as semanas do ciclo.
 *
 * ARREDONDAMENTO: `ceil`, com piso em 1 — e o `ceil` é DELIBERADO, não
 * descuido. Um ciclo de 30 dias conta 5 semanas, não 4: superestimar o
 * denominador faz a conta errar para "não encheu", nunca para o mérito falso.
 * É a mesma escolha que a Aduana escreveu dentro de `barra_do_grupo`
 * (`ceil(dias / 7.0)`), e as duas pontas TÊM de arredondar igual — meia
 * semana de diferença aqui e lá faria a barra do grupo e a linha da pessoa
 * discordarem na mesma tela, sobre o mesmo ciclo.
 *
 * Piso em 1 porque um combinado de três dias ainda é um combinado, e dividir
 * a meta dela por causa disso seria o app recombinando no lugar do grupo.
 */
export function semanasDoCiclo(comeca: string, termina: string): number {
  const dias = diasEntre(comeca, termina);
  if (dias === null) return 1;
  return Math.max(1, Math.ceil(dias / 7));
}

/** A meta do ciclo, a partir da meta semanal. */
export function metaDoCiclo(metaSemanal: number, comeca: string, termina: string): number {
  const base = Number(metaSemanal);
  if (!Number.isFinite(base) || base <= 0) return 0;
  return Math.round(base * semanasDoCiclo(comeca, termina));
}

/** Dias INCLUSIVOS entre duas datas ISO (`2026-09-18`). `null` quando alguma
 *  não é data — e `null` não vira zero: zero seria um ciclo sem duração, e a
 *  conta de cima passaria a dividir por ele. */
export function diasEntre(comeca: string, termina: string): number | null {
  const a = Date.parse(`${comeca}T00:00:00Z`);
  const b = Date.parse(`${termina}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 864e5) + 1;
}

/* ═══ A ORDEM DAS PESSOAS ═════════════════════════════════════════════ */

/** O mínimo para ordenar gente sem dizer nada sobre ela. */
export interface PessoaOrdenavel {
  userId: string;
  /** O nome DO GRUPO (`group_members.display_name`) — nunca o rótulo "Você".
   *  Ordenar pelo rótulo jogaria quem está olhando sempre para o mesmo lugar
   *  da lista, e "eu no topo" é ordinal de uma pessoa só. */
  nome: string;
}

/**
 * Ordem alfabética, desempate por id.
 *
 * NUNCA por desempenho, e o DESEMPATE também não — senão o ranking volta pela
 * porta dos fundos toda vez que dois nomes forem iguais. Mesma regra do
 * `weekScoreboard`, escrita de novo aqui porque quem ordena os cartões da tela
 * não é o placar do desafio: são duas listas, e as duas precisam da trava.
 */
export const porNomeDoGrupo = (a: PessoaOrdenavel, b: PessoaOrdenavel): number =>
  a.nome.localeCompare(b.nome, "pt-BR") || a.userId.localeCompare(b.userId);

/* ═══ A TINTA DE CADA MÉTRICA ═════════════════════════════════════════ */

/**
 * A classe de tinta do dot. DERIVADA do catálogo, nunca uma segunda lista:
 * duas listas divergem no primeiro dia em que alguém mexer numa delas.
 *
 * Ouro não entra em dot: `--gold` sobre o cartão claro dá ~1,9:1, e reprova
 * até como objeto gráfico (mínimo 3:1).
 */
export function tintaDaMetrica(
  key: SocialMetricKey | string,
  ehComposta: boolean,
  primeiroSinal?: string,
): string {
  // Composta (`dia_inteiro`) atravessa pilares: não pode vestir a cor de um só.
  if (ehComposta) return "text-foreground/85";
  if (primeiroSinal === "gratitude") return "text-mente-ink";
  return "text-vitalidade-ink";
}

/* ═══ O DIA DO PRODUTO ═══════════════════════════════════════════════ */

/** O fuso do PRODUTO. Não é o do aparelho, e a diferença é o bug inteiro. */
export const FUSO_DO_PRODUTO = "America/Sao_Paulo";

/* `en-CA` porque ele formata exatamente como `YYYY-MM-DD`, que é a forma que
   o banco devolve e com a qual a tela compara por string. Construído uma vez:
   `Intl.DateTimeFormat` é caro, e esta função roda por linha de feed. */
const FORMATO_DO_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_DO_PRODUTO, year: "numeric", month: "2-digit", day: "2-digit",
});

/**
 * O dia de HOJE em ISO, **no fuso do produto** — nunca no do aparelho.
 *
 * ─── POR QUE NÃO É O FUSO DE QUEM OLHA ────────────────────────────────
 *
 * O banco decide o dia com `hoje_sp()` (`America/Sao_Paulo`): é assim que
 * `v_grupo_hoje`, `voltou_hoje`, `total_do_ciclo` e `total_da_semana` cortam
 * a janela. Se o front usasse `getFullYear/getMonth/getDate`, ele leria o dia
 * do DISPOSITIVO — e as duas pontas só coincidiriam dentro de BRT.
 *
 * O que quebrava com o aparelho fora do fuso (medido pela revisão de código,
 * pessoa em Lisboa às 21:30, que é 17:30 em São Paulo):
 *
 *   · o "↩ voltou hoje" do cartão SOME (o banco escreveu o dia de SP);
 *   · o "3 de 6" some de TODAS as linhas do feed;
 *   · "hoje" vira um cabeçalho de data com nome de gente embaixo;
 *   · um desafio que ainda vale aparece como encerrado, por até um dia.
 *
 * E não é só quem viaja: um Android com fuso manual em UTC — mais comum do
 * que parece em aparelho reconfigurado — vira o dia às 21h de Brasília.
 *
 * A data entra por PARÂMETRO: o módulo continua puro e o mesmo instante
 * produz sempre o mesmo dia.
 */
export function diaLocal(d: Date): string {
  return FORMATO_DO_DIA.format(d);
}

/**
 * O instante em que vira o próximo dia NO FUSO DO PRODUTO.
 *
 * O timer da meia-noite agendava `new Date(ano, mes, dia + 1)` — a meia-noite
 * do NAVEGADOR. Com o aparelho fora de BRT ele virava a tela na hora errada,
 * que é o mesmo bug do `diaLocal` pela outra ponta.
 *
 * Como a conta é feita sem biblioteca de fuso: parte-se do instante atual,
 * anda-se de hora em hora até `diaLocal` mudar (no máximo ~25 saltos), e aí
 * refina-se por minuto. É bruto de propósito — não depende de saber o offset
 * de São Paulo, então continua certo se o horário de verão voltar.
 */
export function proximaViradaDeDia(agora: Date): Date {
  const diaDeHoje = diaLocal(agora);
  const cursor = new Date(agora.getTime());
  for (let i = 0; i < 26; i++) {
    cursor.setTime(cursor.getTime() + 3600_000);
    if (diaLocal(cursor) !== diaDeHoje) break;
  }
  // Recua até o primeiro minuto do dia novo.
  for (let i = 0; i < 60; i++) {
    const antes = new Date(cursor.getTime() - 60_000);
    if (diaLocal(antes) === diaDeHoje) break;
    cursor.setTime(antes.getTime());
  }
  // Cinco segundos de folga: virar exatamente no limite é pedir para reconsultar
  // um dia que o banco ainda não considera começado.
  return new Date(cursor.getTime() + 5_000);
}
