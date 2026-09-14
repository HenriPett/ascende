/* ASCENDE — A materialização dos fixos tem de nascer no CICLO da pessoa.
 *
 * Por que este arquivo existe:
 *
 * O app tem ciclo financeiro customizável (profiles.financial_cycle_day). A
 * TELA agrupa por ciclo (cycleKey, em prosperidade.ts), mas a materialização
 * dos fixos raciocinava em MÊS CIVIL nas duas pontas — a data da linha e a
 * guarda de "já rodou". Com ciclo C e fixo no dia D, quando D < C a linha
 * nascia num dia que já pertencia ao ciclo ANTERIOR, e a pessoa abria o app,
 * lia "Entradas: R$ 0" e concluía que o mês estava no vermelho. O salário
 * dela estava lá; só estava datado no balde errado.
 *
 * A regra nova mora em SQL (ensure_month_recurrences, no setup.sql e na
 * migração 20260914120000_o_fixo_nasce_no_ciclo_da_pessoa.sql), e SQL não roda
 * nestes runners. O que dá para provar aqui — e é o que importa — é que a
 * REGRA está certa, usando o cycleKey DE VERDADE, o mesmo que a tela usa:
 * se a data escolhida cai no ciclo corrente segundo cycleKey, a tela mostra.
 *
 * O espelho em TypeScript abaixo poderia envelhecer em silêncio, então o
 * último teste prende as duas cópias do SQL uma na outra e nas fórmulas que
 * este arquivo reproduz.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cycleKey } from "./prosperidade";

const SETUP = "supabase/setup.sql";
const MIGRACAO = "supabase/migrations/20260914120000_o_fixo_nasce_no_ciclo_da_pessoa.sql";

/* ─── Espelho da aritmética do SQL ───────────────────────────────────────
   O SQL é a fonte da verdade; isto é a MESMA conta em TypeScript, para poder
   confrontá-la com o cycleKey da tela. Qualquer divergência entre os dois é
   pega pelo teste de acoplamento no fim do arquivo. */

/** Espelho de clampCycleDay() do prosperidade.ts e do `between 2 and 28` do SQL. */
const clamp = (cycleDay: number | null | undefined): number =>
  cycleDay && cycleDay >= 2 && cycleDay <= 28 ? Math.round(cycleDay) : 1;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const doIso = (s: string) => {
  const [y, m, dd] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
};

/** SQL: date_trunc('month', sp_today - (cday-1) dias)::date + (cday-1) */
function inicioDoCiclo(hoje: string, cycleDay: number | null): string {
  const c = clamp(cycleDay);
  const d = doIso(hoje);
  d.setUTCDate(d.getUTCDate() - (c - 1));
  const inicio = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  inicio.setUTCDate(inicio.getUTCDate() + (c - 1));
  return iso(inicio);
}

/** SQL: (date_trunc('month', cycle_start) + (D >= C ? 0 : 1 mês))::date + (D-1) */
function ocorrenciaDoCiclo(hoje: string, cycleDay: number | null, dayOfMonth: number): string {
  const c = clamp(cycleDay);
  const inicio = doIso(inicioDoCiclo(hoje, cycleDay));
  const base = new Date(Date.UTC(
    inicio.getUTCFullYear(),
    inicio.getUTCMonth() + (dayOfMonth >= c ? 0 : 1),
    1,
  ));
  base.setUTCDate(base.getUTCDate() + (dayOfMonth - 1));
  return iso(base);
}

/** Uma varredura de "hoje" que cruza viradas de mês, de ano e um fevereiro. */
function diasDeTeste(): string[] {
  const out: string[] = [];
  const d = doIso("2026-08-01");
  const fim = doIso("2027-04-01");
  while (d.getTime() < fim.getTime()) {
    out.push(iso(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const DIAS = diasDeTeste();
const CICLOS = Array.from({ length: 28 }, (_, i) => i + 1);
const FIXOS = Array.from({ length: 28 }, (_, i) => i + 1);

describe("o fixo nasce dentro do ciclo corrente", () => {
  it("a data escolhida SEMPRE cai no ciclo de hoje, para todo (ciclo, dia do fixo)", () => {
    // É esta a garantia que o fundador perdeu: se a data não cai no ciclo
    // corrente segundo cycleKey, o card "Entradas" daquele ciclo fica zerado.
    const erros: string[] = [];
    for (const hoje of DIAS) {
      for (const c of CICLOS) {
        const esperado = cycleKey(hoje, c);
        for (const d of FIXOS) {
          const data = ocorrenciaDoCiclo(hoje, c, d);
          if (cycleKey(data, c) !== esperado) {
            erros.push(`hoje=${hoje} ciclo=${c} fixo=${d} → ${data} caiu em ${cycleKey(data, c)}, esperado ${esperado}`);
          }
        }
      }
    }
    expect(erros.slice(0, 5)).toEqual([]);
  });

  it("reproduz o caso relatado: ciclo 10, salário no dia 5, hoje 14/09", () => {
    // Antes: 05/09, que cycleKey joga para o ciclo de agosto — o ciclo
    // corrente ficava com 0 de entrada até 1º de outubro.
    expect(cycleKey("2026-09-05", 10)).toBe("2026-08");
    // Agora: a ocorrência do dia 5 que cai DENTRO do ciclo 10/09–09/10.
    expect(ocorrenciaDoCiclo("2026-09-14", 10, 5)).toBe("2026-10-05");
    expect(cycleKey("2026-10-05", 10)).toBe("2026-09");
    expect(cycleKey("2026-09-14", 10)).toBe("2026-09");
  });

  it("D >= C continua no mês do próprio ciclo (não muda nada para esses)", () => {
    expect(ocorrenciaDoCiclo("2026-09-14", 10, 25)).toBe("2026-09-25");
    expect(ocorrenciaDoCiclo("2026-09-14", 10, 10)).toBe("2026-09-10");
  });

  it("atravessa a virada de ano sem inventar mês 13", () => {
    expect(ocorrenciaDoCiclo("2026-12-20", 15, 3)).toBe("2027-01-03");
    expect(cycleKey("2027-01-03", 15)).toBe(cycleKey("2026-12-20", 15));
  });
});

describe("quem não configurou ciclo não pode ver diferença nenhuma", () => {
  // A regra que o próprio prosperidade.ts declara: "cycleDay ausente/1 é
  // IDÊNTICO ao comportamento anterior". Não "equivalente": idêntico.
  const expressaoAntiga = (hoje: string, d: number) =>
    `${hoje.slice(0, 7)}-${String(d).padStart(2, "0")}`;   // make_date(ano, mês civil, D)

  for (const cicloNaoConfigurado of [1, null, 0, -3, 29, 99] as (number | null)[]) {
    it(`cycleDay=${String(cicloNaoConfigurado)} devolve a MESMA data da função antiga`, () => {
      for (const hoje of DIAS) {
        for (const d of FIXOS) {
          expect(ocorrenciaDoCiclo(hoje, cicloNaoConfigurado, d)).toBe(expressaoAntiga(hoje, d));
        }
      }
    });
  }

  it("com cycleDay=1 a chave do ciclo é o próprio mês civil (a guarda não muda)", () => {
    for (const hoje of DIAS) {
      expect(inicioDoCiclo(hoje, 1).slice(0, 7)).toBe(hoje.slice(0, 7));
      expect(inicioDoCiclo(hoje, null).slice(0, 7)).toBe(hoje.slice(0, 7));
    }
  });
});

describe("o índice único (recurring_id, mês civil) continua valendo uma linha por ciclo", () => {
  it("ciclos consecutivos caem em meses civis DIFERENTES, para todo (ciclo, fixo)", () => {
    // É deste 1-para-1 que depende o `on conflict do nothing` da função: se
    // dois ciclos caíssem no mesmo mês civil, o segundo seria silenciosamente
    // engolido e a pessoa ficaria sem o fixo daquele ciclo.
    const erros: string[] = [];
    for (const c of CICLOS) {
      for (const d of FIXOS) {
        let anterior: string | null = null;
        // doze ciclos seguidos, começando no ciclo corrente de 14/09/2026
        for (let k = 0; k < 12; k++) {
          const hoje = iso(new Date(Date.UTC(2026, 8 + k, 14)));
          const mes = ocorrenciaDoCiclo(hoje, c, d).slice(0, 7);
          if (mes === anterior) erros.push(`ciclo=${c} fixo=${d} repetiu o mês civil ${mes}`);
          anterior = mes;
        }
      }
    }
    expect(erros.slice(0, 5)).toEqual([]);
  });
});

describe("o SQL e este espelho não podem divergir em silêncio", () => {
  /** Corpo da função, sem comentários nem espaço em branco — é o que precisa
   *  ser idêntico nos dois arquivos; os comentários de cada um falam do seu
   *  próprio contexto e podem (devem) diferir. */
  const corpoDaFuncao = (caminho: string) => {
    const src = readFileSync(caminho, "utf-8");
    const i = src.indexOf("create or replace function public.ensure_month_recurrences()");
    expect(i, `${caminho} não define ensure_month_recurrences`).toBeGreaterThanOrEqual(0);
    const j = src.indexOf("end; $$;", i);
    return src.slice(i, j)
      .split("\n").map((l) => l.replace(/--.*$/, "").trim()).filter(Boolean).join(" ")
      .replace(/\s+/g, " ");
  };

  it("setup.sql e a migração definem a MESMA função", () => {
    // O setup.sql é a linha de base (um ambiente novo nasce só com ele) e a
    // migração é para quem já tem banco. Divergir aqui faz produção e staging
    // se comportarem diferente sem ninguém perceber.
    expect(corpoDaFuncao(SETUP)).toBe(corpoDaFuncao(MIGRACAO));
  });

  it("o SQL usa as fórmulas que este arquivo espelha", () => {
    const corpo = corpoDaFuncao(SETUP);
    expect(corpo).toContain(
      "cycle_start := date_trunc('month', sp_today - make_interval(days => cday - 1))::date + (cday - 1);");
    expect(corpo).toContain(
      "case when r.day_of_month >= cday then interval '0' else interval '1 month' end");
    // A guarda tem de ser por ciclo. Se alguém voltar a `month_key`, o bug
    // inteiro volta junto: ciclo novo não dispara materialização nenhuma.
    expect(corpo).toContain("and cycle_key = ckey");
    expect(corpo).not.toContain("month_key");
  });

  it("a cura da dívida só toca quem está quebrado (D < C e ciclo customizado)", () => {
    const src = readFileSync(MIGRACAO, "utf-8");
    // Fora esse recorte, o backfill ressuscitaria lançamentos que a pessoa
    // apagou — e o ledger promete, por escrito, que isso não acontece.
    expect(src).toContain("where p.financial_cycle_day between 2 and 28");
    expect(src).toContain("and r.day_of_month < c.cday");
    expect(src).toContain("on conflict (recurring_id, (date_trunc('month', occurred_at::timestamp)))");
  });
});
