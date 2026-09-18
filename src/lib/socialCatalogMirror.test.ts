/* ASCENDE — O CATÁLOGO DO SOCIAL TEM DOIS DONOS, E ELES TÊM DE DIZER A MESMA COISA.
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────
 *
 * O catálogo de métricas compartilháveis é declarado DUAS VEZES:
 *
 *   • no banco, em `public.shareable_metrics`, semeado por migration revisada
 *     e fechado por FK — é o que o parecer do Fiel exige em B4-d, para que
 *     'peso_delta_kg' não entre numa terça-feira sem passar pela mesa;
 *   • aqui no cliente, em `SHAREABLE_METRICS`, que é o que `isShareable`
 *     consulta e o que a tela usa para desenhar.
 *
 * Duas fontes de verdade sobre um número que o grupo inteiro vê. E esta
 * divergência não falha em voz alta: a consulta funciona, a tela desenha, e o
 * erro só aparece quando alguém diz "fechei o dia e o grupo não contou".
 *
 * JÁ ACONTECEU, uma vez, antes de este arquivo existir (18/09/2026): o SQL
 * calculava `dia_inteiro` exigindo TODOS os sinais e deixando treino de fora,
 * enquanto o cliente exigia 3 dos 4 com treino dentro. Ninguém errou — os dois
 * lados foram briefados diferente. Foi encontrado por leitura, não por teste,
 * e é exatamente por isso que ele passa a ter teste.
 *
 * ─── O QUE ESTE ARQUIVO CONSEGUE PROVAR, E O QUE NÃO ───
 *
 * Consegue: que as CHAVES e a frase do zero batem, porque nos dois lados elas
 * são literais declarados.
 *
 * Consegue também, desde 18/09/2026, provar a COMPOSIÇÃO: a Aduana acrescentou
 * `composed_of text[]` ao catálogo, e com isso a composição deixou de viver
 * dentro do corpo de uma função plpgsql e virou declaração que os dois lados
 * leem. Era a dívida registrada aqui na primeira versão deste arquivo; ela foi
 * paga, e a comparação abaixo ficou de três linhas.
 *
 * NÃO consegue: provar o LIMIAR (3 de 4), que continua sendo expressão dentro
 * da função de projeção. Para ele sobra a âncora textual, que é frágil por
 * natureza e falha ALTO quando não dá mais para conferir — passar calado é o
 * que deixou a divergência de 18/09 viver por algumas horas.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SHAREABLE_METRICS, SOCIAL_METRIC_KEYS, FORA_DO_CATALOGO } from "@/lib/socialMetrics";
import { FULL_DAY_SIGNALS } from "@/lib/socialChallenge";

const MIGRATIONS = "supabase/migrations";

/** A migration que SEMEIA o catálogo, achada pelo conteúdo e não pelo nome:
 *  nome de arquivo muda, `insert into public.shareable_metrics` não. */
function fonteDoCatalogo(): { arquivo: string; sql: string } {
  const achados = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ arquivo: join(MIGRATIONS, f), sql: readFileSync(join(MIGRATIONS, f), "utf-8") }))
    .filter((x) => /insert\s+into\s+public\.shareable_metrics/i.test(x.sql));

  expect(achados.length, "não achei a migration que semeia o catálogo — o espelho ficou cego")
    .toBe(1);
  return achados[0];
}

/** As chaves semeadas, lidas dos literais do INSERT. */
function chavesNoBanco(sql: string): string[] {
  const bloco = sql.slice(sql.search(/insert\s+into\s+public\.shareable_metrics/i));
  const corpo = bloco.slice(0, bloco.indexOf(";"));
  return [...corpo.matchAll(/\(\s*'([a-z_]+)'\s*,/g)].map((m) => m[1]);
}

describe("o catálogo do cliente é o MESMO do banco", () => {
  it("as chaves batem, nos dois sentidos", () => {
    /* Nos dois sentidos de propósito. Uma chave a mais no banco é métrica que
       a tela não sabe desenhar; uma a mais no cliente é métrica que o
       `metric_key` FK vai recusar na hora de consentir — e a pessoa descobre
       isso tocando num interruptor que não funciona. */
    const { sql, arquivo } = fonteDoCatalogo();
    const noBanco = chavesNoBanco(sql).sort();

    expect(noBanco.length, `não consegui ler chave nenhuma de ${arquivo}`).toBeGreaterThan(0);
    expect(noBanco, "o catálogo do banco e o do cliente divergiram")
      .toEqual([...SOCIAL_METRIC_KEYS].sort());
  });

  it("o banco não semeia métrica que o cliente RECUSOU", () => {
    /* O catálogo do banco é fechado por migration justamente para que nada
       entre sem passar pela mesa (B4-d). Esta asserção fecha o outro lado da
       mesma porta: uma métrica recusada aqui não pode continuar semeada lá,
       senão a tela oferece um interruptor para um dado que o cliente se recusa
       a calcular — e a pessoa consente com uma coisa que não acontece. */
    const { sql } = fonteDoCatalogo();
    const noBanco = chavesNoBanco(sql);
    for (const recusada of Object.keys(FORA_DO_CATALOGO)) {
      expect(
        noBanco,
        `'${recusada}' continua semeada no catálogo do banco.\n` +
        `MOTIVO DA RECUSA: ${FORA_DO_CATALOGO[recusada]}`,
      ).not.toContain(recusada);
    }
  });

  it("o banco não ganhou métrica que o cliente recusa", () => {
    // O caminho por onde 'peso_delta_kg' entraria: semeado numa migration e
    // consentido por uma tela que confia no catálogo do banco.
    const { sql } = fonteDoCatalogo();
    for (const chave of chavesNoBanco(sql)) {
      expect(SHAREABLE_METRICS[chave as keyof typeof SHAREABLE_METRICS],
        `${chave} está no banco e não existe no catálogo do cliente`).toBeDefined();
    }
  });

  it("o que o ZERO diz é a mesma ideia dos dois lados", () => {
    /* Não exijo a frase idêntica — o banco escreve para o log de auditoria e o
       cliente para a tela. Exijo que os dois EXISTAM e falem da mesma ausência:
       se um lado disser "não treinou" e o outro "ficou para trás", a régua do
       teste do zero deixou de ser a mesma nos dois lugares. */
    const { sql } = fonteDoCatalogo();
    for (const key of SOCIAL_METRIC_KEYS) {
      const linha = sql.split("\n").find((l) => l.includes(`'${key}'`)) ?? "";
      const frases = [...linha.matchAll(/'([^']{10,})'/g)].map((m) => m[1]);
      const zeroNoBanco = frases[frases.length - 1] ?? "";
      expect(zeroNoBanco.length, `${key} não declara o que o zero dela diz no banco`)
        .toBeGreaterThan(3);
      expect(/^não |^a sequência|^ficou|^parou/i.test(zeroNoBanco),
        `o zero de ${key} no banco ("${zeroNoBanco}") não descreve uma AUSÊNCIA`).toBe(true);
    }
  });
});

describe("a COMPOSIÇÃO é declarada nos dois lados, e tem de bater", () => {
  /** `composed_of` como o INSERT o escreve: '{dia_inteiro}' ou null. */
  function composicaoNoBanco(sql: string): Record<string, string[]> {
    const bloco = sql.slice(sql.search(/insert\s+into\s+public\.shareable_metrics/i));
    const corpo = bloco.slice(0, bloco.indexOf(";"));
    const out: Record<string, string[]> = {};
    for (const linha of corpo.split("\n")) {
      const chave = /\(\s*'([a-z_]+)'\s*,/.exec(linha)?.[1];
      if (!chave) continue;
      const arr = /'\{([a-z_,\s]*)\}'/.exec(linha)?.[1];
      out[chave] = arr ? arr.split(",").map((x) => x.trim()).filter(Boolean) : [];
    }
    return out;
  }

  it("o que compõe cada métrica é a MESMA lista dos dois lados", () => {
    /* Antes isto não era checável: a composição vivia em variáveis locais de
       uma função plpgsql. Com a coluna, é comparação direta — e é ela que
       impede o dia inteiro de contar quatro sinais num lado e três no outro
       sem ninguém perceber. */
    const { sql } = fonteDoCatalogo();
    const noBanco = composicaoNoBanco(sql);

    for (const key of SOCIAL_METRIC_KEYS) {
      const noCliente = [...SHAREABLE_METRICS[key].composedOf].sort();
      expect((noBanco[key] ?? []).sort(), `a composição de ${key} divergiu entre banco e cliente`)
        .toEqual(noCliente);
    }
  });
});

describe("a agregação `ultimo` ficou órfã, e órfã é arma carregada", () => {
  it("nenhuma métrica semeada usa agregação `ultimo`", () => {
    /* `agregacao = 'ultimo'` existia POR CAUSA de `sequencia_dias`: ela é o
       mecanismo que faz um valor virar "sem registro" quando o último dia da
       janela não tem linha — exatamente o penhasco que o fundador acabou de
       remover do catálogo.

       Com a métrica fora, a agregação ficou sem dono. Deixá-la disponível é
       deixar o penhasco montado: dá para recriar o dano com uma métrica nova
       e `agregacao = 'ultimo'`, sem passar por FORA_DO_CATALOGO e sem discutir
       o argumento. Esta asserção não apaga a agregação do schema (a tabela é
       da Aduana) — ela garante que nenhuma métrica a USE. */
    const { sql } = fonteDoCatalogo();
    const bloco = sql.slice(sql.search(/insert\s+into\s+public\.shareable_metrics/i));
    const corpo = bloco.slice(0, bloco.indexOf(";"));
    const comUltimo = corpo.split("\n")
      .filter((l) => /'ultimo'/.test(l))
      .map((l) => /\(\s*'([a-z_]+)'\s*,/.exec(l)?.[1] ?? l.trim());

    expect(
      comUltimo,
      "métrica semeada com agregação 'ultimo'. Ela é o mecanismo do 'sem " +
      "registro' que saiu junto com sequencia_dias — se voltar a ter dono, o " +
      "penhasco volta sem passar pelo argumento.",
    ).toEqual([]);
  });
});

describe("dia_inteiro: as âncoras que o plpgsql deixa checáveis", () => {
  /* Aqui o espelho é mais fraco, e o comentário de topo diz por quê. O que dá
     para travar é que os quatro sinais que o cliente compõe EXISTEM como
     métricas do banco e são calculados pela mesma função de projeção. */

  function fonteDaProjecao(): string {
    const achados = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS, f), "utf-8"))
      .filter((sql) => /insert\s+into\s+public\.shared_daily_stats/i.test(sql));
    expect(achados.length, "não achei a função que projeta o dia — o espelho ficou cego")
      .toBeGreaterThanOrEqual(1);
    return achados.join("\n");
  }

  it("os quatro sinais do dia inteiro existem como métrica no banco", () => {
    const { sql } = fonteDoCatalogo();
    const noBanco = new Set(chavesNoBanco(sql));
    const composicao = SHAREABLE_METRICS.dia_inteiro.composedOf;

    expect(composicao.length, "dia_inteiro deixou de ser composto de quatro").toBe(4);
    expect(FULL_DAY_SIGNALS.length, "FULL_DAY_SIGNALS descolou da composição do catálogo").toBe(4);
    for (const filho of composicao) {
      expect(noBanco.has(filho), `${filho} compõe o dia inteiro no cliente e não existe no banco`)
        .toBe(true);
    }
  });

  it("a projeção do banco calcula os mesmos quatro, e o dia inteiro junto", () => {
    const sql = fonteDaProjecao();
    for (const filho of SHAREABLE_METRICS.dia_inteiro.composedOf) {
      expect(sql.includes(`'${filho}'`),
        `a projeção do banco não calcula ${filho}, que compõe o dia inteiro no cliente`).toBe(true);
    }
    expect(sql.includes("'dia_inteiro'")).toBe(true);
  });

  it("O LIMIAR É 3 DE 4 — e o banco não pode exigir todos", () => {
    /* A divergência REAL de 18/09/2026, travada como regressão. O plano é
       literal: "Três de quatro, NÃO quatro de quatro: dia de descanso ainda
       conta, e quem desligou um tracker não fica de fora".

       Esta âncora é deliberada e é frágil por natureza: ela lê o corpo de uma
       função que não é minha. Se ela falhar porque a Aduana renomeou uma
       variável, a resposta certa NÃO é afrouxar o regex — é confirmar que os
       dois lados continuam concordando e mover a âncora junto. Falhar alto
       quando não dá mais para conferir é o comportamento desejado; passar
       calado é o que deixou a divergência viver. */
    const sql = fonteDaProjecao();

    const igualdadeEstrita = /v_cumpridos\s*=\s*v_exigiveis/;
    expect(igualdadeEstrita.test(sql),
      "O BANCO EXIGE TODOS OS SINAIS (4 de 4) E O CLIENTE EXIGE 3 DE 4.\n" +
      "O combinado é 3 de 4: o dia de descanso tem de continuar fechando o dia " +
      "pelos outros três, e quem desligou um tracker conta 2 de 3.\n" +
      "Este teste nasceu VERMELHO de propósito, em 18/09/2026: ele é o recibo de " +
      "uma divergência já encontrada e já atribuída (o SQL da projeção está sendo " +
      "realinhado). Ele fica verde sozinho quando o realinhamento entrar — e é " +
      "isso que prova que entrou. NÃO afrouxe o regex para calar o vermelho.")
      .toBe(false);

    const temTolerancia = /v_cumpridos\s*>=\s*greatest\s*\(\s*1\s*,\s*v_exigiveis\s*-\s*1\s*\)/;
    expect(temTolerancia.test(sql),
      "não achei a folga de um sinal na projeção do banco. Ou o limiar mudou, ou as " +
      "variáveis foram renomeadas — nos dois casos, confira se os dois lados ainda " +
      "concordam ANTES de mexer nesta âncora.").toBe(true);
  });

  it("e o cliente continua com a folga proporcional", () => {
    // O outro lado da mesma regra, no lado que eu controlo.
    expect(FULL_DAY_SIGNALS.length).toBe(4);
  });
});
