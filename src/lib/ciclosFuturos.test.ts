/* ASCENDE — CICLOS FUTUROS: SALÁRIO E FIXOS APARECEM, MAS NÃO SÃO GRAVADOS.
 *
 * O relato do fundador: no banco de produção dele, o ciclo corrente fecha com
 * R$ 11.500 de entrada e R$ 10.974 de saída; os ciclos seguintes, que já têm
 * parcelas reais caindo até jan/2028, abrem com "Entradas R$ 0". Ele olha e lê
 * prejuízo puro — porque salário e fixos só existem depois que a materialização
 * mensal roda, e ela só roda quando o mês chega.
 *
 * O conserto é uma camada de LEITURA. Nenhum insert: gravar no banco um salário
 * que não caiu contamina o retrato que o Conselheiro lê (ele soma as transações
 * do mês sem teto de data) e contraria a regra da casa de que histórico é o que
 * a pessoa viveu.
 *
 * Este arquivo cobre as QUATRO BORDAS onde essa camada quebra — todas quatro
 * quebram EM SILÊNCIO, com um número plausível na tela:
 *
 *   1. materializado + projetado = valor em dobro, no instante em que a rodada
 *      mensal alcança o ciclo (o único jeito de notar seria o saldo errado);
 *   2. projeção no ciclo corrente = salário duplicado na tela mais olhada;
 *   3. projeção sem teto = ficção com aparência de planilha em 2028;
 *   4. recorrente pausado projetando = a pessoa desliga e o número continua.
 *
 * E prova a propriedade que autoriza o desenho: a data projetada cai DENTRO do
 * ciclo alvo, para as 28 configurações de ciclo. É a mesma aritmética que
 * consertou o bug do salário (cycleOccurrenceISO), só que ancorada no começo do
 * ciclo alvo em vez de em hoje — não existe uma segunda regra de data aqui.
 */
import { describe, it, expect } from "vitest";
import {
  projectCycle, cycleTotals, cycleDistance, cycleStartFromKey,
  cycleKey, MAX_PROJECTION_CYCLES,
  type RecurringTx, type Tx,
} from "@/lib/prosperidade";

const HOJE_CICLO = "2026-09";

const rec = (over: Partial<RecurringTx> = {}): RecurringTx => ({
  id: "r-salario", kind: "income", amount: 11500, category: "Salário",
  description: "Salário", day_of_month: 5, active: true,
  ...over,
});

const tx = (over: Partial<Tx> = {}): Tx => ({
  id: "t1", kind: "income", amount: 11500, category: "Salário",
  description: "Salário", occurred_at: "2026-10-05", source: "recurring",
  recurring_id: "r-salario",
  ...over,
});

const projetar = (over: Partial<Parameters<typeof projectCycle>[0]> = {}) =>
  projectCycle({
    recurrings: [rec()], txs: [], targetCycle: "2026-10",
    currentCycle: HOJE_CICLO, cycleDay: 1,
    ...over,
  });

describe("a queixa original: ciclo futuro não pode abrir com Entradas R$ 0", () => {
  it("o salário do próximo ciclo aparece — com valor, categoria e data", () => {
    const linhas = projetar();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      recurring_id: "r-salario", kind: "income", amount: 11500,
      category: "Salário", description: "Salário", occurred_at: "2026-10-05",
    });
  });

  it("o id é sintético e prefixado — projeção nunca se passa por linha do banco", () => {
    expect(projetar()[0].id).toBe("proj:r-salario:2026-10");
  });

  it("salário E fixos entram, ordenados pela data em que cairiam", () => {
    const linhas = projetar({
      recurrings: [
        rec({ id: "r-net", kind: "expense", amount: 120, category: "Assinaturas", description: "Internet", day_of_month: 20 }),
        rec({ id: "r-aluguel", kind: "expense", amount: 2400, category: "Moradia", description: "Aluguel", day_of_month: 10 }),
        rec(),
      ],
    });
    expect(linhas.map((l) => l.occurred_at)).toEqual(["2026-10-05", "2026-10-10", "2026-10-20"]);
    expect(linhas.map((l) => l.recurring_id)).toEqual(["r-salario", "r-aluguel", "r-net"]);
  });

  it("recorrente sem descrição cai na categoria, nunca em linha sem nome", () => {
    expect(projetar({ recurrings: [rec({ description: null })] })[0].description).toBe("Salário");
    expect(projetar({ recurrings: [rec({ description: "   " })] })[0].description).toBe("Salário");
  });
});

describe("regra dura do desenho: materializado é a fonte da verdade", () => {
  it("existe lançamento daquele fixo no ciclo alvo → NÃO projeta (senão duplica)", () => {
    expect(projetar({ txs: [tx({ occurred_at: "2026-10-05" })] })).toEqual([]);
  });

  it("a materialização de OUTRO ciclo não silencia o ciclo alvo", () => {
    // O salário de setembro está materializado; outubro continua projetando.
    expect(projetar({ txs: [tx({ occurred_at: "2026-09-05" })] })).toHaveLength(1);
  });

  it("a materialização de OUTRO recorrente não silencia este", () => {
    expect(projetar({ txs: [tx({ recurring_id: "r-outro" })] })).toHaveLength(1);
  });

  it("lançamento avulso no ciclo (sem recurring_id) não silencia nada", () => {
    // Uma parcela de compra à mão cai no mesmo ciclo e não tem recurring_id:
    // se ela silenciasse o salário, a queixa voltaria exatamente onde nasceu.
    expect(projetar({ txs: [tx({ recurring_id: null, source: "manual", kind: "expense" })] })).toHaveLength(1);
  });

  it("materializado silencia SÓ o recorrente materializado, os outros seguem", () => {
    const linhas = projetar({
      recurrings: [rec(), rec({ id: "r-aluguel", kind: "expense", amount: 2400, description: "Aluguel", day_of_month: 10 })],
      txs: [tx({ occurred_at: "2026-10-05" })],
    });
    expect(linhas.map((l) => l.recurring_id)).toEqual(["r-aluguel"]);
  });

  it("com ciclo customizado, a checagem usa o CICLO da transação, não o mês civil", () => {
    // cycleDay 10: o ciclo "2026-10" vai de 10/out a 09/nov. Um salário do dia
    // 5 materializado em 05/11 pertence a esse ciclo — e tem que silenciar a
    // projeção. Comparar mês civil ("2026-11" ≠ "2026-10") deixaria passar.
    expect(projetar({
      cycleDay: 10, txs: [tx({ occurred_at: "2026-11-05" })],
    })).toEqual([]);
  });
});

describe("ciclo corrente e passado nunca recebem projeção", () => {
  it("o ciclo de hoje não projeta — ele já é materializado pelo banco", () => {
    expect(projetar({ targetCycle: HOJE_CICLO })).toEqual([]);
  });

  it("ciclo passado não projeta — o passado é o que a pessoa viveu", () => {
    expect(projetar({ targetCycle: "2026-08" })).toEqual([]);
    expect(projetar({ targetCycle: "2025-12" })).toEqual([]);
  });
});

describe(`teto: projeção só até ${MAX_PROJECTION_CYCLES} ciclos à frente`, () => {
  it("o 12º ciclo à frente ainda projeta; o 13º já não", () => {
    expect(projetar({ targetCycle: "2027-09" })).toHaveLength(1); // +12
    expect(projetar({ targetCycle: "2027-10" })).toEqual([]);     // +13
  });

  it("jan/2028 (onde moram as parcelas reais do fundador) mostra só o real", () => {
    expect(projetar({ targetCycle: "2028-01" })).toEqual([]);
  });

  it("o corte é o mesmo virando o ano, não o dezembro", () => {
    for (let ahead = 1; ahead <= 18; ahead++) {
      const [y, m] = HOJE_CICLO.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 + ahead, 1));
      const alvo = d.toISOString().slice(0, 7);
      expect({ alvo, n: projetar({ targetCycle: alvo }).length })
        .toEqual({ alvo, n: ahead <= MAX_PROJECTION_CYCLES ? 1 : 0 });
    }
  });
});

describe("recorrente inativo não projeta", () => {
  it("pausar é dizer 'isto não vai cair' — e a tela tem que concordar", () => {
    expect(projetar({ recurrings: [rec({ active: false })] })).toEqual([]);
  });

  it("pausar um não apaga os outros", () => {
    const linhas = projetar({
      recurrings: [rec({ active: false }), rec({ id: "r-aluguel", kind: "expense", amount: 2400, day_of_month: 10 })],
    });
    expect(linhas.map((l) => l.recurring_id)).toEqual(["r-aluguel"]);
  });
});

describe("a data projetada cai dentro do ciclo alvo — 28 ciclos × 28 dias × 12 meses", () => {
  // A prova que autoriza reaproveitar cycleOccurrenceISO em vez de escrever
  // uma segunda aritmética de ciclo: ancorada no COMEÇO do ciclo alvo, ela
  // devolve a única ocorrência do dia D dentro daquele ciclo. Se essa
  // propriedade falhasse, a projeção apareceria no ciclo errado — o mesmo bug
  // que zerava as entradas, só que um ciclo adiante.
  it("cycleKey(data projetada) === ciclo alvo, sempre", () => {
    const falhas: string[] = [];
    for (let cycleDay = 1; cycleDay <= 28; cycleDay++) {
      for (let dia = 1; dia <= 28; dia++) {
        for (let ahead = 1; ahead <= MAX_PROJECTION_CYCLES; ahead++) {
          const [y, m] = HOJE_CICLO.split("-").map(Number);
          const alvo = new Date(Date.UTC(y, m - 1 + ahead, 1)).toISOString().slice(0, 7);
          const linha = projectCycle({
            recurrings: [rec({ day_of_month: dia })], txs: [],
            targetCycle: alvo, currentCycle: HOJE_CICLO, cycleDay,
          })[0];
          const caiu = cycleKey(linha.occurred_at, cycleDay);
          if (caiu !== alvo) falhas.push(`ciclo ${cycleDay}, dia ${dia}, +${ahead}: ${linha.occurred_at} → ${caiu} ≠ ${alvo}`);
        }
      }
    }
    expect(falhas).toEqual([]);
  });

  it("quem tem cycleDay nulo ou 1 vê a projeção no mês civil, no dia do fixo", () => {
    for (const cycleDay of [null, undefined, 1] as const) {
      expect(projetar({ cycleDay, targetCycle: "2026-12", recurrings: [rec({ day_of_month: 5 })] })[0].occurred_at)
        .toBe("2026-12-05");
      expect(projetar({ cycleDay, targetCycle: "2027-03", recurrings: [rec({ day_of_month: 28 })] })[0].occurred_at)
        .toBe("2027-03-28");
    }
  });

  it("com ciclo customizado, o fixo de dia MENOR que o do ciclo cai no mês seguinte", () => {
    // Ciclo 10 → a janela "2026-11" é 10/nov a 09/dez. O fixo do dia 5 cai em
    // 05/dez, não em 05/nov (05/nov já pertence ao ciclo anterior). Foi essa
    // escolha de data que consertou o salário do fundador.
    expect(projetar({ cycleDay: 10, targetCycle: "2026-11", recurrings: [rec({ day_of_month: 5 })] })[0].occurred_at)
      .toBe("2026-12-05");
    expect(projetar({ cycleDay: 10, targetCycle: "2026-11", recurrings: [rec({ day_of_month: 25 })] })[0].occurred_at)
      .toBe("2026-11-25");
  });

  it("cycleStartFromKey é o primeiro dia do ciclo daquela chave", () => {
    expect(cycleStartFromKey("2026-10", 1)).toBe("2026-10-01");
    expect(cycleStartFromKey("2026-10", null)).toBe("2026-10-01");
    expect(cycleStartFromKey("2026-10", 10)).toBe("2026-10-10");
    expect(cycleKey(cycleStartFromKey("2026-10", 10), 10)).toBe("2026-10");
  });
});

describe("cycleDistance", () => {
  it("conta meses, inclusive virando o ano", () => {
    expect(cycleDistance("2026-09", "2026-09")).toBe(0);
    expect(cycleDistance("2026-09", "2026-10")).toBe(1);
    expect(cycleDistance("2026-09", "2027-09")).toBe(12);
    expect(cycleDistance("2026-09", "2028-01")).toBe(16);
    expect(cycleDistance("2026-09", "2026-08")).toBe(-1);
  });
});

describe("os totais do ciclo SOMAM a projeção — é a decisão inteira", () => {
  // Projeção que aparece na lista mas não entra no total recria a queixa
  // original ("Entradas R$ 0") um ciclo adiante. Por isso soma, e por isso o
  // cabeçalho ganha o rótulo Previsão: `projected` é o gatilho dele.
  const parcelas = [
    { kind: "expense" as const, amount: 1200 },
    { kind: "expense" as const, amount: 666 },
  ];

  it("ciclo futuro: entradas deixam de ser zero e o saldo deixa de mentir", () => {
    const so_real = cycleTotals(parcelas, []);
    expect(so_real).toEqual({ income: 0, expense: 1866, net: -1866, projected: false });

    const com_projecao = cycleTotals(parcelas, [
      { kind: "income", amount: 11500 },
      { kind: "expense", amount: 2400 },
    ]);
    expect(com_projecao).toEqual({ income: 11500, expense: 4266, net: 7234, projected: true });
  });

  it("sem projeção nenhuma, os três números são os de sempre e não há rótulo", () => {
    const t = cycleTotals([{ kind: "income", amount: 300 }, ...parcelas], []);
    expect(t).toEqual({ income: 300, expense: 1866, net: -1566, projected: false });
  });

  it("valores em texto (o que o Supabase devolve em numeric) somam como número", () => {
    const t = cycleTotals(
      [{ kind: "income", amount: "100" as unknown as number }],
      [{ kind: "expense", amount: "40" as unknown as number }],
    );
    expect(t).toEqual({ income: 100, expense: 40, net: 60, projected: true });
  });
});
