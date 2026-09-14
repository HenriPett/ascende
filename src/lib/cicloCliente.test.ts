/* ASCENDE — O CLIENTE TAMBÉM MATERIALIZA FIXO, E ESTAVA NO MÊS CIVIL.
 *
 * O buraco: a função do banco (materialize_recurrences_for) só roda quando o
 * app abre. Por isso a tela materializa NA HORA o fixo que a pessoa acabou de
 * criar — em quatro pontos de src/pages/Prosperidade.tsx: o Raio-X (salário e
 * fixos sugeridos), a adoção do salário como entrada fixa, e o cadastro de um
 * recorrente novo. Os quatro datavam a linha com `currentMonthDayISO`, isto é,
 * MÊS CIVIL.
 *
 * Para quem tem o fixo num dia MENOR que o dia do ciclo (D < C), essa data já
 * pertence ao ciclo ANTERIOR: a pessoa cadastra um fixo e ele aparece no mês
 * passado. É o mesmo bug de data que o SQL consertou, de pé no cliente — e a
 * metade de dentro do relato do fundador ("meu salário fixo não entra como
 * entrada naquele ciclo, permanecendo 0"). No banco de produção eram R$ 11.500
 * de entrada que a tela nunca mostrou.
 *
 * Este arquivo prova três coisas, nesta ordem de importância:
 *
 *   1. A data que o CLIENTE escolhe é a MESMA que o BANCO escolheria — contra
 *      uma transcrição literal do SQL, não contra outra chamada da própria
 *      função.
 *   2. Essa data satisfaz a PROPRIEDADE que o SQL afirma ter: é a única
 *      ocorrência do dia D dentro da janela do ciclo corrente. Provada por
 *      força bruta, varrendo dias reais e usando o cycleKey com que a TELA
 *      agrupa — se a data cai no ciclo corrente, a tela mostra.
 *   3. Quem tem cycleDay nulo ou 1 recebe exatamente a data de antes, byte a
 *      byte. A correção não pode mexer com quem não configurou nada.
 *
 * (Os testes de que o SQL e o setup.sql não divergem entre si estão em
 *  src/lib/cicloRecorrencias.test.ts, que é do lado do banco.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cycleKey, cycleStartISO, cycleOccurrenceISO } from "./prosperidade";

const TELA = "src/pages/Prosperidade.tsx";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const doIso = (s: string) => {
  const [y, m, dd] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
};
const maisDias = (s: string, n: number) => {
  const d = doIso(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/** Dias reais, cruzando duas viradas de mês curtas, uma virada de ano e um
 *  fevereiro. Mesma janela que o teste do lado do banco varre. */
const DIAS: string[] = [];
for (let d = "2026-08-01"; d < "2027-04-01"; d = maisDias(d, 1)) DIAS.push(d);
const CICLOS = Array.from({ length: 28 }, (_, i) => i + 1);
const FIXOS = Array.from({ length: 28 }, (_, i) => i + 1);

/* ─── O ORÁCULO: o SQL transcrito, linha por linha ───────────────────────
   Transcrição literal de materialize_recurrences_for() (migração
   20260914160000 e setup.sql). É de propósito que ela NÃO chame as funções do
   prosperidade.ts: se chamasse, este arquivo estaria comparando a produção com
   ela mesma e passaria mesmo se a fórmula tivesse sido alterada na mudança de
   casa para o código do cliente.

     -- select case when p.financial_cycle_day between 2 and 28
     --             then p.financial_cycle_day else 1 end
     -- cycle_start := date_trunc('month', sp_today - make_interval(days => cday - 1))::date + (cday - 1)
     -- (date_trunc('month', cycle_start)
     --    + case when day_of_month >= cday then interval '0' else interval '1 month' end)::date
     --  + (day_of_month - 1)                                                            */
const sqlCday = (financialCycleDay: number | null | undefined): number =>
  typeof financialCycleDay === "number" && financialCycleDay >= 2 && financialCycleDay <= 28
    ? financialCycleDay : 1;

const sqlCycleStart = (spToday: string, financialCycleDay: number | null | undefined): string => {
  const cday = sqlCday(financialCycleDay);
  const recuado = doIso(maisDias(spToday, -(cday - 1)));          // sp_today - (cday-1) dias
  const truncado = `${recuado.getUTCFullYear()}-${String(recuado.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return maisDias(truncado, cday - 1);                            // + (cday - 1)
};

const sqlOccurrence = (
  spToday: string, financialCycleDay: number | null | undefined, dayOfMonth: number,
): string => {
  const cday = sqlCday(financialCycleDay);
  const inicio = sqlCycleStart(spToday, financialCycleDay);
  const [y, m] = inicio.split("-").map(Number);                   // date_trunc('month', cycle_start)
  const desloca = dayOfMonth >= cday ? 0 : 1;                     // interval '0' | '1 month'
  const mesBase = m + desloca;
  const ano = y + Math.floor((mesBase - 1) / 12);
  const mes = ((mesBase - 1) % 12) + 1;
  return maisDias(`${ano}-${String(mes).padStart(2, "0")}-01`, dayOfMonth - 1);
};

describe("1. o cliente escolhe a MESMA data que o banco escolheria", () => {
  it("cycleOccurrenceISO == a transcrição do SQL, para todo (hoje, ciclo, fixo)", () => {
    // ~191 mil combinações. Se alguém mexer num lado só, isto fica vermelho —
    // é a única defesa contra as duas metades voltarem a discordar.
    const erros: string[] = [];
    for (const hoje of DIAS) {
      for (const c of CICLOS) {
        for (const d of FIXOS) {
          const cliente = cycleOccurrenceISO(hoje, c, d);
          const banco = sqlOccurrence(hoje, c, d);
          if (cliente !== banco) erros.push(`hoje=${hoje} C=${c} D=${d}: cliente ${cliente} ≠ banco ${banco}`);
        }
      }
    }
    expect(erros.slice(0, 5)).toEqual([]);
  });

  it("o início do ciclo também bate com o SQL (é dele que sai a data)", () => {
    const erros: string[] = [];
    for (const hoje of DIAS) {
      for (const c of CICLOS) {
        if (cycleStartISO(hoje, c) !== sqlCycleStart(hoje, c)) {
          erros.push(`hoje=${hoje} C=${c}: ${cycleStartISO(hoje, c)} ≠ ${sqlCycleStart(hoje, c)}`);
        }
      }
    }
    expect(erros.slice(0, 5)).toEqual([]);
  });

  it("ciclo nulo/fora de faixa cai no mês civil dos dois lados, igualmente", () => {
    for (const c of [null, undefined, 0, 1, -3, 29, 99] as (number | null | undefined)[]) {
      expect(cycleOccurrenceISO("2026-09-14", c, 5)).toBe(sqlOccurrence("2026-09-14", c, 5));
      expect(cycleOccurrenceISO("2026-09-14", c, 28)).toBe(sqlOccurrence("2026-09-14", c, 28));
    }
  });
});

describe("2. a data cai na janela do ciclo corrente — e é a única que cabe lá", () => {
  /** A janela do ciclo de `hoje`, medida com o cycleKey que a TELA usa para
   *  agrupar: todo dia cuja chave de ciclo é a mesma de hoje. Nada aqui usa as
   *  funções sob teste. */
  const janela = (hoje: string, c: number): Map<number, string[]> => {
    const alvo = cycleKey(hoje, c);
    const porDia = new Map<number, string[]>();
    for (let k = -45; k <= 45; k++) {
      const dia = maisDias(hoje, k);
      if (cycleKey(dia, c) !== alvo) continue;
      const nd = Number(dia.slice(8, 10));
      porDia.set(nd, [...(porDia.get(nd) ?? []), dia]);
    }
    return porDia;
  };

  it("para todo (hoje, ciclo, fixo): existe UMA ocorrência do dia D no ciclo, e é a escolhida", () => {
    // Esta é a propriedade que o comentário do SQL afirma ("dentro dessa janela
    // existe EXATAMENTE UMA ocorrência do dia D"), provada por força bruta em
    // vez de aceita como verdade. É ela que garante que a regra é bem definida
    // e que a linha aparece no card "Entradas" do ciclo certo.
    const erros: string[] = [];
    for (const hoje of DIAS) {
      for (const c of CICLOS) {
        const porDia = janela(hoje, c);
        for (const d of FIXOS) {
          const candidatas = porDia.get(d) ?? [];
          if (candidatas.length !== 1) {
            erros.push(`hoje=${hoje} C=${c} D=${d}: ${candidatas.length} ocorrências no ciclo`);
            continue;
          }
          const escolhida = cycleOccurrenceISO(hoje, c, d);
          if (escolhida !== candidatas[0]) {
            erros.push(`hoje=${hoje} C=${c} D=${d}: escolheu ${escolhida}, a do ciclo é ${candidatas[0]}`);
          }
        }
      }
    }
    expect(erros.slice(0, 5)).toEqual([]);
  });

  it("o caso do fundador: ciclo 10, salário no dia 5, hoje 14/09", () => {
    // O que o cliente fazia: 05/09 — que o cycleKey joga para o ciclo de agosto.
    expect(cycleKey("2026-09-05", 10)).toBe("2026-08");
    // O que ele faz agora: a ocorrência do dia 5 dentro do ciclo 10/09–09/10.
    expect(cycleOccurrenceISO("2026-09-14", 10, 5)).toBe("2026-10-05");
    expect(cycleKey("2026-10-05", 10)).toBe(cycleKey("2026-09-14", 10));
  });
});

describe("3. quem não configurou ciclo não pode ver diferença nenhuma", () => {
  /** A expressão exata que o cliente usava antes: `currentMonthDayISO`, mês
   *  civil de hoje com o dia do fixo (que é 1..28 por CHECK no banco). */
  const formulaAntiga = (hoje: string, d: number) =>
    `${hoje.slice(0, 7)}-${String(Math.min(d, 28)).padStart(2, "0")}`;

  for (const naoConfigurado of [1, null, undefined, 0, -3, 29, 99] as (number | null | undefined)[]) {
    it(`cycleDay=${String(naoConfigurado)} devolve a MESMA data de antes, byte a byte`, () => {
      for (const hoje of DIAS) {
        for (const d of FIXOS) {
          expect(cycleOccurrenceISO(hoje, naoConfigurado, d)).toBe(formulaAntiga(hoje, d));
        }
      }
    });
  }

  it("com ciclo configurado, muda EXATAMENTE quem estava no ciclo errado", () => {
    // A varredura corrigiu a nossa própria hipótese, e o achado importa.
    //
    // Achávamos que o cliente só errava quando D < C. Não é isso: ele erra
    // quando (D < C) e (T < C) DISCORDAM, sendo T o dia em que a pessoa abre o
    // app. A razão é que a fórmula antiga usava o mês civil de HOJE, e o ciclo
    // corrente pula para o mês civil anterior assim que T < C:
    //
    //   T >= C, D >= C → mesma data. Nada muda (o caso comum).
    //   T >= C, D <  C → antiga cai no ciclo ANTERIOR  (o caso do fundador).
    //   T <  C, D <  C → mesma data. Nada muda.
    //   T <  C, D >= C → antiga cai no ciclo SEGUINTE  (o caso que faltava).
    //
    // O quarto caso não estava no diagnóstico e é igualmente invisível para a
    // pessoa: ciclo 10, fixo no dia 25, app aberto em 05/09 — a linha nascia
    // em 25/09, que já é o ciclo de setembro, enquanto o ciclo corrente é
    // 10/08–09/09. Cadastrar um fixo e ele não aparecer em lugar nenhum.
    const erros: string[] = [];
    for (const hoje of DIAS) {
      const t = Number(hoje.slice(8, 10));
      for (const c of CICLOS.filter((x) => x >= 2)) {
        for (const d of FIXOS) {
          const mudou = cycleOccurrenceISO(hoje, c, d) !== formulaAntiga(hoje, d);
          const deviaMudar = (d < c) !== (t < c);
          if (mudou !== deviaMudar) {
            erros.push(`hoje=${hoje} C=${c} D=${d}: mudou=${mudou}, esperado=${deviaMudar}`);
          }
        }
      }
    }
    expect(erros.slice(0, 5)).toEqual([]);
  });

  it("e onde a data mudou, a fórmula antiga errava o ciclo de verdade", () => {
    // O bug fixado como fato, não como teoria: sempre que a data se move, a
    // antiga caía num ciclo que NÃO é o corrente — nunca foi uma troca de
    // gosto entre duas datas igualmente válidas.
    const erros: string[] = [];
    for (const hoje of DIAS) {
      for (const c of CICLOS.filter((x) => x >= 2)) {
        for (const d of FIXOS) {
          const antiga = formulaAntiga(hoje, d);
          if (antiga === cycleOccurrenceISO(hoje, c, d)) continue;
          if (cycleKey(antiga, c) === cycleKey(hoje, c)) {
            erros.push(`hoje=${hoje} C=${c} D=${d}: a antiga mudou de data mas acertava o ciclo`);
          }
        }
      }
    }
    expect(erros.slice(0, 5)).toEqual([]);
  });

  it("os dois casos concretos, um de cada lado do ciclo", () => {
    // D < C, app aberto depois do dia do ciclo: nascia no ciclo anterior.
    expect(formulaAntiga("2026-09-14", 5)).toBe("2026-09-05");
    expect(cycleKey("2026-09-05", 10)).toBe("2026-08");        // ciclo anterior
    expect(cycleOccurrenceISO("2026-09-14", 10, 5)).toBe("2026-10-05");
    expect(cycleKey("2026-10-05", 10)).toBe("2026-09");        // o corrente

    // D >= C, app aberto ANTES do dia do ciclo: nascia no ciclo seguinte.
    expect(formulaAntiga("2026-09-05", 25)).toBe("2026-09-25");
    expect(cycleKey("2026-09-25", 10)).toBe("2026-09");        // ciclo seguinte
    expect(cycleKey("2026-09-05", 10)).toBe("2026-08");        // o corrente
    expect(cycleOccurrenceISO("2026-09-05", 10, 25)).toBe("2026-08-25");
    expect(cycleKey("2026-08-25", 10)).toBe("2026-08");
  });
});

describe("4. a tela não pode ter um quinto ponto datando em mês civil", () => {
  const src = () => readFileSync(TELA, "utf-8");

  it("todo lançamento materializado usa a regra do ciclo", () => {
    // O acoplamento que impede a regressão silenciosa: se alguém acrescentar um
    // quinto ponto de materialização e datar como o antigo fazia, as contagens
    // se descasam e este teste cai.
    const materializacoes = (src().match(/source: "recurring"/g) ?? []).length;
    const datasDeCiclo = (src().match(/occurred_at: cycleOccurrenceISO\(/g) ?? []).length;
    expect(materializacoes).toBe(4);
    expect(datasDeCiclo).toBe(materializacoes);
  });

  it("o helper de mês civil não existe mais na tela", () => {
    expect(src()).not.toContain("currentMonthDayISO");
    expect(src()).toContain("cycleOccurrenceISO");
  });
});
