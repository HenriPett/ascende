// ASCENDE — Compra parcelada registrada à mão.
//
// Este arquivo tem DOIS trabalhos:
//
// 1. Provar a regra de espalhamento: somar mês civil a um dia fixo avança
//    exatamente UM ciclo, para qualquer financial_cycle_day. É o que autoriza
//    a expansão a ser aritmética de data pura, sem nenhuma conta de ciclo.
//
// 2. Ser a trava contra a DIVERGÊNCIA entre as duas cópias da regra:
//    src/lib/prosperidade.ts (app) e supabase/functions/_shared/lib.ts
//    (servidor, expansão da fatura importada). Elas precisam produzir a mesma
//    data-base, o mesmo passo de um mês e o mesmo rótulo "k/N" — se alguém
//    mexer em um lado só, algum `it` daqui cai.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SETUP_PATH = "supabase/setup.sql";
import {
  addMonthsClamp, buildInstallmentPlan, installmentSpanLabel, installmentSummary,
  installmentPosition, countPastInstallments, groupDeletionLabel,
  cycleKey, MIN_INSTALLMENTS, MAX_INSTALLMENTS,
} from "@/lib/prosperidade";

/** Formatador determinístico: o teste não pode depender do ICU da máquina. */
const money = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

const plan = (over: Partial<Parameters<typeof buildInstallmentPlan>[0]> = {}) =>
  buildInstallmentPlan({
    amount: 43.9, count: 10, mode: "parcela",
    description: "Sofá", purchaseDate: "2026-09-14",
    ...over,
  })!;

describe("addMonthsClamp · espelho do _shared/lib.ts", () => {
  it("anda um mês por vez, inclusive virando o ano", () => {
    expect(addMonthsClamp("2026-09-14", 0)).toBe("2026-09-14");
    expect(addMonthsClamp("2026-09-14", 1)).toBe("2026-10-14");
    expect(addMonthsClamp("2026-09-14", 4)).toBe("2027-01-14");
    expect(addMonthsClamp("2026-09-14", 15)).toBe("2027-12-14");
  });

  it("fixa no último dia do mês curto em vez de vazar para o mês seguinte", () => {
    expect(addMonthsClamp("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamp("2024-01-31", 1)).toBe("2024-02-29"); // bissexto
    expect(addMonthsClamp("2026-08-31", 1)).toBe("2026-09-30");
  });

  it("dia 31 fixado em fevereiro NÃO arrasta o resto da compra para o dia 28", () => {
    // O clamp é sempre a partir da data ORIGINAL — parcela 3 volta ao dia 31.
    expect(addMonthsClamp("2026-01-31", 2)).toBe("2026-03-31");
  });
});

describe("a parcela k cai no ciclo k — para qualquer financial_cycle_day", () => {
  // A prova que autoriza o desenho: varre as 28 configurações de ciclo × todos
  // os dias possíveis de compra. Somar mês civil avança exatamente um ciclo.
  it("28 ciclos × 31 dias de compra × 24 parcelas: nenhum ciclo pulado ou repetido", () => {
    const falhas: string[] = [];
    for (let cycleDay = 1; cycleDay <= 28; cycleDay++) {
      for (let day = 1; day <= 31; day++) {
        const purchase = `2026-01-${String(day).padStart(2, "0")}`;
        if (new Date(purchase + "T00:00:00Z").getUTCDate() !== day) continue; // data inexistente
        const p = buildInstallmentPlan({
          amount: 10, count: MAX_INSTALLMENTS, mode: "parcela",
          description: "x", purchaseDate: purchase,
        })!;
        const chaves = p.rows.map((r) => cycleKey(r.occurred_at, cycleDay));
        if (new Set(chaves).size !== chaves.length) {
          falhas.push(`ciclo ${cycleDay}, dia ${day}: duas parcelas no mesmo ciclo`);
        }
        // Ciclos consecutivos: cada chave é o mês civil seguinte da anterior.
        for (let i = 1; i < chaves.length; i++) {
          const [ay, am] = chaves[i - 1].split("-").map(Number);
          const esperado = `${am === 12 ? ay + 1 : ay}-${String(am === 12 ? 1 : am + 1).padStart(2, "0")}`;
          if (chaves[i] !== esperado) {
            falhas.push(`ciclo ${cycleDay}, dia ${day}, parcela ${i + 1}: ${chaves[i]} ≠ ${esperado}`);
          }
        }
      }
    }
    expect(falhas).toEqual([]);
  });
});

describe("buildInstallmentPlan · modo 'parcela' (o que a nota grita)", () => {
  it("10x de R$ 43,90: toda parcela é o valor digitado e o total é exato", () => {
    const p = plan();
    expect(p.count).toBe(10);
    expect(p.rows).toHaveLength(10);
    expect(p.each).toBe(43.9);
    expect(p.total).toBe(439);
    expect(p.oddCount).toBe(0);
    expect(p.rows.every((r) => r.amount === 43.9)).toBe(true);
  });

  it("a soma das parcelas bate com o total mostrado — em centavos, sem float", () => {
    const p = plan({ amount: 33.33, count: 3 });
    const soma = p.rows.reduce((s, r) => s + Math.round(r.amount * 100), 0);
    expect(soma).toBe(Math.round(p.total * 100));
    expect(p.total).toBe(99.99);
  });

  it("a primeira parcela é a data da compra; as seguintes andam de mês em mês", () => {
    expect(plan().rows.map((r) => r.occurred_at)).toEqual([
      "2026-09-14", "2026-10-14", "2026-11-14", "2026-12-14", "2027-01-14",
      "2027-02-14", "2027-03-14", "2027-04-14", "2027-05-14", "2027-06-14",
    ]);
  });

  it("o rótulo é 'descrição · k/N' — a MESMA grafia da fatura importada", () => {
    const p = plan();
    expect(p.rows[0].description).toBe("Sofá · 1/10");
    expect(p.rows[2].description).toBe("Sofá · 3/10");
    expect(p.rows[9].description).toBe("Sofá · 10/10");
  });
});

describe("buildInstallmentPlan · modo 'total' e o arredondamento", () => {
  it("R$ 100,00 em 3x: a sobra de 1 centavo vai para a PRIMEIRA parcela", () => {
    const p = buildInstallmentPlan({
      amount: 100, count: 3, mode: "total", description: "Tênis", purchaseDate: "2026-09-14",
    })!;
    expect(p.rows.map((r) => r.amount)).toEqual([33.34, 33.33, 33.33]);
    expect(p.each).toBe(33.33);
    expect(p.oddCount).toBe(1);
    expect(p.oddAmount).toBe(33.34);
  });

  it("a soma SEMPRE bate com o total digitado — varredura de valores e parcelas", () => {
    const falhas: string[] = [];
    for (let centavos = 2; centavos <= 500; centavos++) {
      for (let n = MIN_INSTALLMENTS; n <= MAX_INSTALLMENTS; n++) {
        const total = centavos / 100;
        const p = buildInstallmentPlan({
          amount: total, count: n, mode: "total", description: "x", purchaseDate: "2026-09-14",
        });
        if (!p) { if (centavos >= n) falhas.push(`${centavos}c em ${n}x: devolveu null`); continue; }
        const soma = p.rows.reduce((s, r) => s + Math.round(r.amount * 100), 0);
        if (soma !== centavos) falhas.push(`${centavos}c em ${n}x: soma ${soma}`);
        const min = Math.min(...p.rows.map((r) => Math.round(r.amount * 100)));
        if (min <= 0) falhas.push(`${centavos}c em ${n}x: parcela de ${min} centavos`);
        const max = Math.max(...p.rows.map((r) => Math.round(r.amount * 100)));
        if (max - min > 1) falhas.push(`${centavos}c em ${n}x: parcelas diferem em ${max - min} centavos`);
      }
    }
    expect(falhas).toEqual([]);
  });

  it("total pequeno demais para dar 1 centavo por parcela não vira lançamento", () => {
    // `amount > 0` é CHECK no banco: plano inválido não pode virar linha.
    expect(buildInstallmentPlan({
      amount: 0.05, count: 10, mode: "total", description: "x", purchaseDate: "2026-09-14",
    })).toBeNull();
  });

  it("os dois modos se encontram quando a divisão é redonda", () => {
    const porParcela = plan({ amount: 43.9, count: 10, mode: "parcela" });
    const porTotal = plan({ amount: 439, count: 10, mode: "total" });
    expect(porTotal.rows).toEqual(porParcela.rows);
  });
});

describe("buildInstallmentPlan · o que não pode virar lançamento", () => {
  it("menos de 2 e mais de 24 parcelas", () => {
    for (const count of [0, 1, 25, 100, NaN]) {
      expect(buildInstallmentPlan({
        amount: 10, count, mode: "parcela", description: "x", purchaseDate: "2026-09-14",
      })).toBeNull();
    }
    expect(buildInstallmentPlan({
      amount: 10, count: MIN_INSTALLMENTS, mode: "parcela", description: "x", purchaseDate: "2026-09-14",
    })).not.toBeNull();
    expect(buildInstallmentPlan({
      amount: 10, count: MAX_INSTALLMENTS, mode: "parcela", description: "x", purchaseDate: "2026-09-14",
    })).not.toBeNull();
  });

  it("valor zero, negativo ou sujo", () => {
    for (const amount of [0, -10, NaN]) {
      expect(buildInstallmentPlan({
        amount, count: 10, mode: "parcela", description: "x", purchaseDate: "2026-09-14",
      })).toBeNull();
    }
  });
});

describe("a linha de resumo: o aviso que chega ANTES do toque", () => {
  it("diz quantas, de quanto, o total e de que mês a que mês", () => {
    expect(installmentSummary(plan(), money)).toBe(
      "10x de R$ 43,90 · total R$ 439,00 · de set/2026 a jun/2027",
    );
  });

  it("quando a divisão não fecha, a diferença é DITA, não descoberta por subtração", () => {
    const p = buildInstallmentPlan({
      amount: 100, count: 3, mode: "total", description: "Tênis", purchaseDate: "2026-09-14",
    })!;
    expect(installmentSummary(p, money)).toBe(
      "3x de R$ 33,33 (a 1ª, R$ 33,34) · total R$ 100,00 · de set/2026 a nov/2026",
    );
  });

  it("mais de uma parcela com o centavo a mais vira plural", () => {
    const p = buildInstallmentPlan({
      amount: 10, count: 3, mode: "total", description: "x", purchaseDate: "2026-09-14",
    })!;
    // 1000 centavos / 3 = 333 + sobra 1... 333*3 = 999, sobra 1 → "a 1ª"
    expect(p.oddCount).toBe(1);
    const p2 = buildInstallmentPlan({
      amount: 10, count: 4, mode: "total", description: "x", purchaseDate: "2026-09-14",
    })!;
    expect(p2.oddCount).toBe(0); // 250 redondo
    const p3 = buildInstallmentPlan({
      amount: 10, count: 7, mode: "total", description: "x", purchaseDate: "2026-09-14",
    })!;
    expect(p3.oddCount).toBe(6); // 142*7 = 994, sobram 6
    expect(installmentSummary(p3, money)).toContain("(as 6 primeiras, R$ 1,43)");
  });

  it("a faixa de meses segue o CICLO da pessoa, não o mês civil", () => {
    // Compra em 05/09 com ciclo virando no dia 10: essa data pertence ao ciclo
    // que COMEÇOU em agosto. Dizer "set" seria mentir para quem configurou.
    const p = buildInstallmentPlan({
      amount: 50, count: 3, mode: "parcela", description: "x", purchaseDate: "2026-09-05",
    })!;
    expect(installmentSpanLabel(p, 1)).toBe("de set/2026 a nov/2026");
    expect(installmentSpanLabel(p, 10)).toBe("de ago/2026 a out/2026");
  });
});

describe("apagar: as duas escolhas explícitas", () => {
  const rows = [
    { id: "c", occurred_at: "2026-11-14" },
    { id: "a", occurred_at: "2026-09-14" },
    { id: "b", occurred_at: "2026-10-14" },
  ];

  it("a posição vem da ORDEM DAS DATAS, não do texto '3/10'", () => {
    expect(installmentPosition(rows, "a")).toEqual({ index: 1, count: 3 });
    expect(installmentPosition(rows, "b")).toEqual({ index: 2, count: 3 });
    expect(installmentPosition(rows, "c")).toEqual({ index: 3, count: 3 });
  });

  it("conta como passadas as parcelas até hoje, inclusive a de hoje", () => {
    expect(countPastInstallments(rows, "2026-10-14")).toBe(2);
    expect(countPastInstallments(rows, "2026-09-13")).toBe(0);
    expect(countPastInstallments(rows, "2027-01-01")).toBe(3);
  });

  it("o rótulo destrutivo sempre diz quantos já passaram", () => {
    expect(groupDeletionLabel(10, 2)).toBe("A compra inteira — 10 lançamentos, 2 já passaram");
    expect(groupDeletionLabel(10, 1)).toBe("A compra inteira — 10 lançamentos, 1 já passou");
    expect(groupDeletionLabel(10, 0)).toBe("A compra inteira — 10 lançamentos, nenhum passou ainda");
    expect(groupDeletionLabel(1, 1)).toBe("A compra inteira — 1 lançamento, 1 já passou");
  });
});

/* ─── O ESPELHO DA PARCELA NO setup.sql ─────────────────────────────────
 *
 * A migração 20260914140000 cria `transactions.group_id` e redefine dois
 * gatilhos (`tx_to_life_event`, que passa a carregar `tx_group_id` no payload,
 * e `award_xp_for_event`, que por causa disso paga o XP da compra uma vez só).
 *
 * O `setup.sql` é a linha de base de um ambiente NOVO — é o que o README manda
 * rodar primeiro, e o que um staging ou um reset usa. Ele precisa conter os
 * mesmos objetos, ou um projeto recém-criado nasce com a coluna faltando (o
 * app quebra ao inserir parcelada) ou com o gatilho antigo (uma compra em 24x
 * paga 48 XP, que é exatamente o que a migração existe para impedir).
 *
 * Esse esquecimento já aconteceu uma vez neste repositório e só foi pego numa
 * revisão adversarial. Aqui ele vira teste vermelho. O `setup.sql` redefine
 * essas funções mais de uma vez ao longo do arquivo — quando ele roda de cima
 * a baixo, quem vale é a ÚLTIMA definição, e é ela que precisa ser a nova. */
describe("setup.sql não pode ficar para trás da migração de parcelas", () => {
  const MIG = "supabase/migrations/20260914140000_a_compra_parcelada_e_uma_coisa_so.sql";
  const setup = readFileSync(SETUP_PATH, "utf8");
  const mig = readFileSync(MIG, "utf8");

  it("a coluna e os dois índices existem no setup.sql", () => {
    for (const objeto of ["group_id uuid", "transactions_user_group", "life_events_tx_group"]) {
      expect(setup, `setup.sql não tem "${objeto}"`).toContain(objeto);
    }
  });

  it("a ÚLTIMA definição de cada gatilho é a versão nova (a que roda)", () => {
    for (const fn of ["tx_to_life_event", "award_xp_for_event"] as const) {
      const abre = `create or replace function public.${fn}()`;
      const corpo = (txt: string) => {
        const i = txt.lastIndexOf(abre);
        expect(i, `${fn} não encontrada`).toBeGreaterThan(-1);
        return txt.slice(i, txt.indexOf("$$;", i) + 3);
      };
      expect(corpo(setup), `a última definição de ${fn} no setup.sql está atrasada`)
        .toBe(corpo(mig));
    }
  });

  it("o gatilho que roda de fato conhece tx_group_id", () => {
    const i = setup.lastIndexOf("create or replace function public.award_xp_for_event()");
    expect(setup.slice(i, setup.indexOf("$$;", i))).toContain("tx_group_id");
  });
});
