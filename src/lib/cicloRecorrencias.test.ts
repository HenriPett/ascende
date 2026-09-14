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
 * Depois veio a SEGUNDA metade, achada no banco de produção: consertada a
 * data, o salário de uma pessoa continuava sem aparecer. A guarda registrava
 * o fato errado — "o ciclo K rodou", e não "o recorrente R foi materializado
 * no ciclo K". Quem criasse um recorrente DEPOIS da rodada perdia o ciclo
 * inteiro, sem segunda chance; no caso real isso somou três ciclos e R$ 11.500
 * de entrada que nunca entraram. A guarda virou um livro-caixa por
 * (recorrente, ciclo) — recurrence_materializations.
 *
 * As duas regras moram em SQL (materialize_recurrences_for, no setup.sql e nas
 * migrações 20260914120000 e 20260914160000), e SQL não roda nestes runners.
 * A divisão de trabalho deste arquivo:
 *   • a ARITMÉTICA DE DATA é provada de verdade, contra o cycleKey que a tela
 *     usa — se a data cai no ciclo corrente, a tela mostra;
 *   • a MECÂNICA DA GUARDA (por recorrente, ato gravado mesmo em conflito) é
 *     presa pelo texto do SQL, e validada em Postgres de verdade na revisão.
 *
 * ATUALIZAÇÃO: a aritmética de data deixou de ser espelho deste arquivo.
 * Descobriu-se que o CLIENTE tinha o mesmo bug de pé — src/pages/Prosperidade.tsx
 * materializa recorrente em quatro pontos (Raio-X, adoção do salário, criação
 * de fixo), porque a função do banco só roda quando o app abre, e fazia isso
 * em MÊS CIVIL. As fórmulas mudaram de casa para src/lib/prosperidade.ts
 * (cycleStartISO / cycleOccurrenceISO) e este arquivo passou a importá-las.
 * O ganho é grande: os testes abaixo deixaram de provar uma cópia escrita para
 * o teste e passaram a provar a função que roda de verdade no app.
 *
 * Os últimos testes continuam prendendo as cópias do SQL uma na outra e nas
 * fórmulas que a produção agora executa.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cycleKey, cycleStartISO, cycleOccurrenceISO } from "./prosperidade";

const SETUP = "supabase/setup.sql";
const MIGRACAO_DATA = "supabase/migrations/20260914120000_o_fixo_nasce_no_ciclo_da_pessoa.sql";
const MIGRACAO_GUARDA = "supabase/migrations/20260914160000_o_fixo_criado_depois_da_rodada_perdia_o_ciclo.sql";

/* ─── A aritmética, agora vinda do código de PRODUÇÃO ────────────────────
   Estes dois nomes eram funções locais deste arquivo. Hoje são apelidos das
   funções que o app executa: a mesma conta do SQL, provada contra o cycleKey
   que a tela usa para agrupar. A transcrição independente do SQL — o oráculo
   que garante que a mudança de casa não alterou a fórmula — vive em
   src/lib/cicloCliente.test.ts. */
const inicioDoCiclo = cycleStartISO;
const ocorrenciaDoCiclo = cycleOccurrenceISO;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const doIso = (s: string) => {
  const [y, m, dd] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
};

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
  /** Corpo de uma função, sem comentários nem espaço em branco.
   *
   *  `lastIndexOf` de propósito: o setup.sql redefine algumas funções mais de
   *  uma vez ao longo do arquivo, e quem vale no banco é a ÚLTIMA. Procurar a
   *  primeira faria este teste aprovar uma definição que nunca roda. */
  const corpoDaFuncao = (caminho: string, nome: string) => {
    const src = readFileSync(caminho, "utf-8");
    const assinatura = `create or replace function public.${nome}`;
    const i = src.lastIndexOf(assinatura);
    expect(i, `${caminho} não define ${nome}`).toBeGreaterThanOrEqual(0);
    const j = src.indexOf("end; $$;", i);
    return src.slice(i, j)
      .split("\n").map((l) => l.replace(/--.*$/, "").trim()).filter(Boolean).join(" ")
      .replace(/\s+/g, " ");
  };

  const REGRA = "materialize_recurrences_for";
  const CASCA = "ensure_month_recurrences";

  it("setup.sql e a migração definem a MESMA regra de materialização", () => {
    // O setup.sql é a linha de base (um ambiente novo nasce só com ele) e a
    // migração é para quem já tem banco. Divergir aqui faz produção e staging
    // se comportarem diferente sem ninguém perceber.
    expect(corpoDaFuncao(SETUP, REGRA)).toBe(corpoDaFuncao(MIGRACAO_GUARDA, REGRA));
    expect(corpoDaFuncao(SETUP, CASCA)).toBe(corpoDaFuncao(MIGRACAO_GUARDA, CASCA));
  });

  it("a regra usa as fórmulas de data que este arquivo espelha", () => {
    const corpo = corpoDaFuncao(SETUP, REGRA);
    expect(corpo).toContain(
      "cycle_start := date_trunc('month', sp_today - make_interval(days => cday - 1))::date + (cday - 1);");
    expect(corpo).toContain(
      "case when p.day_of_month >= cday then interval '0' else interval '1 month' end");
  });

  it("a guarda é por (RECORRENTE, ciclo) — não por ciclo, não por mês civil", () => {
    // As três formas erradas que esta linha já teve, em ordem cronológica:
    //   month_key      → o ciclo novo não disparava materialização nenhuma;
    //   cycle_key só   → o recorrente criado depois da rodada perdia o ciclo;
    //   inferir de transactions → ressuscitaria o que a pessoa apagou.
    const corpo = corpoDaFuncao(SETUP, REGRA);
    expect(corpo).toContain("from public.recurrence_materializations m");
    expect(corpo).toContain("where m.recurring_id = r.id and m.cycle_key = ckey");
    expect(corpo).not.toContain("month_key");
    expect(corpo).not.toContain("recurrence_runs");
  });

  it("o ato é gravado mesmo quando o lançamento já existia (senão tenta para sempre)", () => {
    const corpo = corpoDaFuncao(SETUP, REGRA);
    // `pendentes`, não `gravadas`: marcar só o que entrou deixaria o conflito
    // (Raio-X já criou a linha) pedindo materialização a cada abertura do app.
    expect(corpo).toContain("select p.id, ckey, uid from pendentes p");
    expect(corpo).toContain("on conflict (recurring_id, cycle_key) do nothing");
  });

  it("o app continua chamando a mesma RPC, e ela é só a casca do auth.uid()", () => {
    // Mudar a assinatura obrigaria um deploy do front junto — e a migração
    // afirma, no cabeçalho, que não há ordem de deploy.
    expect(corpoDaFuncao(SETUP, CASCA)).toContain("return public.materialize_recurrences_for(auth.uid());");
    expect(readFileSync("src/pages/Prosperidade.tsx", "utf-8"))
      .toContain('supabase.rpc("ensure_month_recurrences")');
  });

  it("a cura da dívida chama a função, em vez de copiar a regra", () => {
    const src = readFileSync(MIGRACAO_GUARDA, "utf-8");
    expect(src).toContain("public.materialize_recurrences_for(u)");
    // Uma segunda cópia da regra seria a próxima divergência: o app conserta,
    // a cura não (ou o contrário). O único INSERT em transactions do arquivo
    // é o que está DENTRO da função.
    expect(src.match(/insert into public\.transactions/g) ?? []).toHaveLength(1);
  });

  it("a tradução da guarda antiga respeita o instante da rodada", () => {
    const src = readFileSync(MIGRACAO_GUARDA, "utf-8");
    // Sem isto, um recorrente criado DEPOIS da rodada seria carimbado como
    // materializado e a dívida ficaria marcada como paga sem ter sido.
    expect(src).toContain("where r.created_at <= run.ran_at");
    // E o ciclo corrente fica de fora da tradução, senão o caso do fundador
    // (rodada de setembro posterior ao recorrente) continuaria quebrado.
    expect(src).toContain("and run.cycle_key is distinct from coalesce(");
  });

  it("a cura da migração anterior só tocava quem estava quebrado (D < C)", () => {
    const src = readFileSync(MIGRACAO_DATA, "utf-8");
    expect(src).toContain("where p.financial_cycle_day between 2 and 28");
    expect(src).toContain("and r.day_of_month < c.cday");
  });
});
