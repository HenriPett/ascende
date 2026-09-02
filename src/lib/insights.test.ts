// ASCENDE — Testes do cálculo de tendências (Fase 3).
//
// O critério de pronto da fase é reprodutibilidade: o mesmo conjunto de
// eventos tem que produzir o mesmo insight. Os quatro testes obrigatórios do
// contrato estão em "reprodutibilidade" e "mínimo de dados".
//
// O teste que realmente prova determinismo é o da ENTRADA EMBARALHADA. Rodar
// duas vezes seguidas passa mesmo com bug: a ordem de entrada é a mesma nas
// duas execuções, então um empate mal desempatado desempata igual e ninguém
// vê. Embaralhar muda a ordem de chegada e expõe exatamente esse bug — que em
// produção aparece quando o banco devolve as linhas em outra ordem.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// `import type` é apagado na compilação: o teste checa a FORMA do tipo do
// Cargo sem puxar o cliente do Supabase para dentro do runtime do teste.
import type { DailyMetrics as DailyMetricsDoCargo } from "@/lib/insightsData";
import {
  computeInsights, sono_gasto_seguinte, refeicao_gasto_comida, treino_sono,
  median, relativeDiff, addDays,
  CALC_VERSION, MIN_OVERLAP_DAYS, MIN_GROUP_DAYS,
  type DailyMetrics, type Insight,
} from "@/lib/insights";

/* ─── Fixtures ────────────────────────────────────────────────────────── */

const BASE = "2026-06-01";

/** Linha neutra: nada medido além do que o teste pedir explicitamente. */
function day(offset: number, over: Partial<DailyMetrics> = {}): DailyMetrics {
  return {
    day: addDays(BASE, offset),
    sleep_hours: null,
    workout_minutes: null,
    workout_count: 0,
    meals_logged: 0,
    food_spend: 0,
    total_spend: 0,
    has_finance: true,
    // Fixture com cobertura por extrato por padrão: o teste que quer provar a
    // ausência dela sobrescreve. Sem isso, todo teste de refeicao_gasto_comida
    // passaria a medir "sem dado" em vez do que quer medir.
    finance_from_statement: true,
    ...over,
  };
}

/**
 * 22 dias com sinal forte: 11 noites de 5h seguidas de dia caro (R$ 100) e
 * 11 noites de 8h seguidas de dia barato (R$ 50). Gera 21 pares (o último dia
 * não tem "dia seguinte"), que é exatamente o mínimo do contrato.
 */
function sonoGastoForte(): DailyMetrics[] {
  const rows: DailyMetrics[] = [];
  for (let i = 0; i <= 21; i++) {
    const dormiuPouco = i < 11;
    rows.push(day(i, {
      sleep_hours: dormiuPouco ? 5 : 8,
      // O gasto do dia i reflete a noite do dia i-1.
      total_spend: i === 0 ? 0 : (i - 1 < 11 ? 100 : 50),
    }));
  }
  return rows;
}

/** Embaralhamento determinístico (LCG): sem Math.random, o teste também
 *  precisa ser reproduzível para significar algo. */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ─── Primitivas ──────────────────────────────────────────────────────── */

describe("primitivas", () => {
  it("mediana de tamanho ímpar é o valor central", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("mediana de tamanho par é a média dos dois centrais", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("mediana não é afetada por um outlier absurdo (média seria)", () => {
    const valores = [10, 10, 10, 10, 10_000];
    expect(median(valores)).toBe(10);
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    expect(media).toBeGreaterThan(2000); // é por isso que o método usa mediana
  });

  it("mediana de lista vazia é 0 e não estoura", () => {
    expect(median([])).toBe(0);
  });

  it("variação relativa é medida contra o grupo BAIXO (a referência da frase)", () => {
    expect(relativeDiff(100, 50)).toBeCloseTo(-0.5);
    expect(relativeDiff(50, 100)).toBeCloseTo(1);
  });

  it("variação relativa com referência zero nunca devolve Infinity", () => {
    expect(relativeDiff(0, 0)).toBe(0);
    expect(relativeDiff(0, 42)).toBe(1);
    expect(Number.isFinite(relativeDiff(0, 42))).toBe(true);
  });

  it("addDays atravessa a virada do mês sem depender de fuso", () => {
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

/* ─── OBRIGATÓRIO (a): rodar duas vezes ───────────────────────────────── */

describe("reprodutibilidade", () => {
  it("duas execuções sobre os mesmos dados dão resultado idêntico", () => {
    const rows = sonoGastoForte();
    const a = computeInsights(rows, "2026-06-30");
    const b = computeInsights(rows, "2026-06-30");
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  /* OBRIGATÓRIO (b): o teste que pega o empate mal desempatado. */
  it("entrada EMBARALHADA produz saída idêntica", () => {
    const rows = sonoGastoForte();
    const referencia = computeInsights(rows, "2026-06-30");

    for (const seed of [1, 7, 42, 1337, 99991]) {
      const bagunca = shuffle(rows, seed);
      // garante que o embaralhamento realmente mudou a ordem de chegada
      expect(bagunca.map((r) => r.day)).not.toEqual(rows.map((r) => r.day));
      expect(computeInsights(bagunca, "2026-06-30")).toEqual(referencia);
    }
  });

  it("embaralhar dados CHEIOS DE EMPATE também não muda a saída", () => {
    // Todos os dias com o mesmo sono e o mesmo gasto, menos a metade final:
    // é o cenário em que o desempate por dia é a única coisa que segura a
    // ordenação estável.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 29; i++) {
      rows.push(day(i, { sleep_hours: i < 15 ? 6 : 6.5, total_spend: i % 2 ? 40 : 80 }));
    }
    const referencia = sono_gasto_seguinte(rows);
    for (const seed of [3, 11, 555]) {
      expect(sono_gasto_seguinte(shuffle(rows, seed))).toEqual(referencia);
    }
  });

  it("a data de referência é parâmetro: mudá-la muda a janela, não o relógio", () => {
    const rows = sonoGastoForte();
    const a = computeInsights(rows, "2026-06-30", 90);
    const b = computeInsights(rows, "2026-06-10", 90);
    expect(a.window).toEqual({ start: "2026-04-02", end: "2026-06-30" });
    expect(b.window.end).toBe("2026-06-10");
    // Mesma função, entradas diferentes: resultados podem diferir. O que não
    // pode é a MESMA entrada dar resultados diferentes (testes acima).
    expect(a.reference_day).toBe("2026-06-30");
  });

  it("carrega a versão do cálculo em cada insight", () => {
    const run = computeInsights(sonoGastoForte(), "2026-06-30");
    expect(run.calc_version).toBe(CALC_VERSION);
    expect(CALC_VERSION).toBe("insights/1");
    for (const i of run.insights) expect(i.calc_version).toBe(CALC_VERSION);
  });
});

/* ─── OBRIGATÓRIO (c): 20 dias não, 21 dias sim ───────────────────────── */

describe("mínimo de dados", () => {
  /** N pares de sono×gasto seguinte, com sinal forte. Precisa de N+1 linhas. */
  function comPares(n: number): DailyMetrics[] {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= n; i++) {
      const metade = Math.ceil(n / 2);
      rows.push(day(i, {
        sleep_hours: i < metade ? 5 : 8,
        total_spend: i === 0 ? 0 : (i - 1 < metade ? 100 : 50),
      }));
    }
    return rows;
  }

  it(`${MIN_OVERLAP_DAYS - 1} dias pareados devolvem dados_insuficientes`, () => {
    const r = sono_gasto_seguinte(comPares(MIN_OVERLAP_DAYS - 1));
    expect(r.status).toBe("dados_insuficientes");
    if (r.status !== "dados_insuficientes") return;
    expect(r.reason).toBe("overlap");
    expect(r.sample_size).toBe(MIN_OVERLAP_DAYS - 1);
    expect(r.days_missing).toBe(1); // diz quantos faltam, não só que faltou
  });

  it(`${MIN_OVERLAP_DAYS} dias pareados já calculam`, () => {
    const r = sono_gasto_seguinte(comPares(MIN_OVERLAP_DAYS));
    expect(r.status).not.toBe("dados_insuficientes");
    expect(r.sample_size).toBe(MIN_OVERLAP_DAYS);
  });

  it("dados_insuficientes é resposta de sucesso: traz amostra e período", () => {
    const r = sono_gasto_seguinte(comPares(10));
    expect(r.status).toBe("dados_insuficientes");
    expect(r.sample_size).toBe(10);
    expect(r.period).not.toBeNull();
    expect(r.labels.left).toContain("sono");
  });

  it("sem nenhum dia devolve dados_insuficientes com período nulo", () => {
    const r = sono_gasto_seguinte([]);
    expect(r.status).toBe("dados_insuficientes");
    expect(r.sample_size).toBe(0);
    expect(r.period).toBeNull();
  });

  it("um dos grupos abaixo do mínimo devolve grupo_pequeno", () => {
    // 26 linhas -> 25 pares (o dia 25 não tem "dia seguinte"). Sono alto nos
    // dias 22, 23 e 24: o grupo alto fica com 3 dias, abaixo do mínimo de 7.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 25; i++) {
      rows.push(day(i, { sleep_hours: i >= 22 ? 9 : 6, total_spend: 10 * (i % 5) }));
    }
    const r = sono_gasto_seguinte(rows);
    expect(r.status).toBe("dados_insuficientes");
    if (r.status !== "dados_insuficientes") return;
    expect(r.reason).toBe("grupo_pequeno");
    expect(r.sample_size).toBe(25);
    expect(r.days_missing).toBe(MIN_GROUP_DAYS - 3); // faltam 4 ao grupo menor
  });

  it("lado esquerdo constante devolve sem_variacao, não 'faltam dias'", () => {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 30; i++) {
      rows.push(day(i, { sleep_hours: 7, total_spend: 10 * (i % 7) }));
    }
    const r = sono_gasto_seguinte(rows);
    expect(r.status).toBe("dados_insuficientes");
    if (r.status !== "dados_insuficientes") return;
    expect(r.reason).toBe("sem_variacao");
    expect(r.days_missing).toBe(0); // o que falta não é dia, é variação
  });

  it("lado direito todo em zero não vira 'não encontramos padrão'", () => {
    // Quem nunca registrou finanças tem total_spend 0 todo dia. Concluir
    // "nenhum padrão" a partir disso venderia uma medida que não fizemos.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 30; i++) {
      rows.push(day(i, { sleep_hours: i % 2 ? 5 : 8, total_spend: 0 }));
    }
    const r = sono_gasto_seguinte(rows);
    expect(r.status).toBe("dados_insuficientes");
    if (r.status !== "dados_insuficientes") return;
    expect(r.reason).toBe("sem_variacao");
  });
});

/* ─── OBRIGATÓRIO (d): null nunca vira 0 ──────────────────────────────── */

describe("null é NÃO MEDIDO, nunca zero", () => {
  it("dia com sono null não entra na amostra", () => {
    const rows = sonoGastoForte();
    rows[3] = { ...rows[3], sleep_hours: null };
    rows[9] = { ...rows[9], sleep_hours: null };
    const r = sono_gasto_seguinte(rows);
    expect(r.sample_size).toBe(19); // 21 pares menos os 2 dias sem medição
  });

  it("sono null NÃO é tratado como 0 horas (o que mudaria o corte)", () => {
    // 60 linhas, sono medido só nos dias PARES: 7h na primeira metade, 9h na
    // segunda. Se null virasse 0, os 30 dias ímpares entrariam como grupo
    // baixo, a amostra dobraria para 59 e a mediana do corte desabaria de 8h
    // para 0 — outra conclusão, a partir de dado que ninguém mediu.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i < 60; i++) {
      const medido = i % 2 === 0;
      rows.push(day(i, {
        sleep_hours: medido ? (i < 30 ? 7 : 9) : null,
        total_spend: 100 + (i % 3) * 10,
      }));
    }
    const r = sono_gasto_seguinte(rows);
    // 30 dias pares, todos com um dia seguinte presente no conjunto.
    expect(r.sample_size).toBe(30);
    expect(r.status).not.toBe("dados_insuficientes");
    if (r.status === "dados_insuficientes") return;
    // O corte é a mediana de [7 x15, 9 x15] = 8. Com null virando 0, seria 0.
    expect(r.split_value).toBe(8);
    expect(r.low_group_days + r.high_group_days).toBe(30);
  });

  it("workout_minutes null não entra como 0 minutos: o lado usado é workout_count", () => {
    // Dia sem treino tem minutes null e count 0. Se o cálculo usasse minutes
    // com `?? 0`, dia não medido e dia sem treino ficariam indistinguíveis.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 30; i++) {
      const treinou = i % 3 === 0;
      rows.push(day(i, {
        workout_count: treinou ? 1 : 0,
        workout_minutes: treinou ? 60 : null,
        sleep_hours: 7,
      }));
    }
    const r = treino_sono(rows);
    // Todos os dias entram (o sono do dia seguinte existe), inclusive os sem
    // treino — "não treinou" é informação medida, e é o grupo baixo.
    expect(r.sample_size).toBe(30);
    expect(r.labels.left).toContain("treino");
  });
});

/* ─── O outlier: por que mediana e não média ──────────────────────────── */

describe("robustez a outlier", () => {
  it("uma fatura absurda não vira a conclusão", () => {
    const rows = sonoGastoForte();
    const semOutlier = sono_gasto_seguinte(rows);
    expect(semOutlier.status).toBe("tendencia");
    if (semOutlier.status !== "tendencia") return;
    expect(semOutlier.direction).toBe("menor"); // dormiu mais, gastou menos

    // Um único dia do grupo "dormiu mais" recebe uma fatura de R$ 8.000.
    const comOutlier = rows.map((r, i) =>
      i === 20 ? { ...r, total_spend: 8000 } : r);
    const depois = sono_gasto_seguinte(comOutlier);

    expect(depois.status).toBe("tendencia");
    if (depois.status !== "tendencia") return;
    expect(depois.direction).toBe("menor");                 // conclusão intacta
    expect(depois.high_group_median).toBe(semOutlier.high_group_median);

    // Prova de que a média teria virado a conclusão: o grupo alto tem 10 dias
    // a R$ 50; trocar um por 8.000 leva a média a R$ 845, acima dos R$ 100 do
    // grupo baixo — a frase para a pessoa se invertria.
    const mediaComOutlier = (9 * 50 + 8000) / 10;
    expect(mediaComOutlier).toBeGreaterThan(100);
  });
});

/* ─── A decisão do treino_sono, travada em teste ──────────────────────── */

describe("treino_sono usa a noite SEGUINTE ao treino", () => {
  it("lê sleep_hours[D+1], não sleep_hours[D]", () => {
    // Treino nos dias pares. O sono do MESMO dia é sempre 4h; o sono do dia
    // SEGUINTE ao treino é sempre 9h. Se o cálculo lesse o sono do próprio
    // dia, o grupo "treinou" apareceria com mediana 4h.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 40; i++) {
      const treinou = i % 2 === 0;
      rows.push(day(i, {
        workout_count: treinou ? 1 : 0,
        workout_minutes: treinou ? 45 : null,
        // dia par (treino) dorme 4h; dia ímpar (seguinte ao treino) dorme 9h
        sleep_hours: treinou ? 4 : 9,
      }));
    }
    const r = treino_sono(rows);
    expect(r.status).toBe("tendencia");
    if (r.status !== "tendencia") return;

    // Grupo alto = dias com treino. O sono associado a eles é o do dia
    // seguinte: 9h. Se lesse o próprio dia, daria 4h.
    expect(r.high_group_median).toBe(9);
    expect(r.low_group_median).toBe(4);
    expect(r.direction).toBe("maior");
    // E o rótulo tem que dizer o que o cálculo fez.
    expect(r.labels.right).toContain("noite seguinte");
  });
});

/* ─── sem_tendencia é resposta, não ausência ──────────────────────────── */

describe("sem_tendencia", () => {
  it("diferença abaixo de 15% devolve sem_tendencia com os números", () => {
    // Grupo baixo mediana 100, grupo alto mediana 105 → 5%.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 30; i++) {
      rows.push(day(i, {
        sleep_hours: i < 15 ? 5 : 8,
        total_spend: i === 0 ? 0 : (i - 1 < 15 ? 100 : 105),
      }));
    }
    const r = sono_gasto_seguinte(rows);
    expect(r.status).toBe("sem_tendencia");
    if (r.status !== "sem_tendencia") return;
    expect(Math.abs(r.delta_pct)).toBeLessThan(15);
    // A tela precisa dos números para dizer "olhamos e não achamos padrão".
    expect(r.sample_size).toBe(30);
    expect(r.low_group_median).toBe(100);
    expect(r.high_group_median).toBe(105);
    expect(r.period).not.toBeNull();
  });

  it("exatamente no limite de 15% já é tendência", () => {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 30; i++) {
      rows.push(day(i, {
        sleep_hours: i < 15 ? 5 : 8,
        total_spend: i === 0 ? 0 : (i - 1 < 15 ? 100 : 115),
      }));
    }
    const r = sono_gasto_seguinte(rows);
    expect(r.status).toBe("tendencia");
    if (r.status !== "tendencia") return;
    expect(r.delta_pct).toBe(15);
  });
});

/* ─── A regra de corte, travada em teste ──────────────────────────────── */

describe("corte pela mediana", () => {
  it("valores IGUAIS do lado esquerdo nunca caem em grupos diferentes", () => {
    // 30 pares com sono em {6, 6.5}: se o corte fosse por índice do meio, o
    // empate seria partido e dias idênticos iriam para grupos distintos.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 30; i++) {
      rows.push(day(i, { sleep_hours: i < 15 ? 6 : 6.5, total_spend: 50 + i }));
    }
    const r = sono_gasto_seguinte(rows);
    if (r.status === "dados_insuficientes") throw new Error("fixture inválida");
    expect(r.low_group_days).toBe(15);
    expect(r.high_group_days).toBe(15);
    expect(r.split_value).toBe(6.25); // mediana entre os dois valores
    expect(r.split_rule).toBe("acima_da_mediana");
  });

  it("contagem corta por PRESENÇA, não por mediana", () => {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i < 31; i++) {
      const registrou = i % 2 === 0; // 16 dias com 3 refeições, 15 com nenhuma
      rows.push(day(i, { meals_logged: registrou ? 3 : 0, food_spend: registrou ? 30 : 90 }));
    }
    const r = refeicao_gasto_comida(rows);
    expect(r.status).toBe("tendencia");
    if (r.status !== "tendencia") return;
    expect(r.split_rule).toBe("houve_ou_nao");
    expect(r.split_value).toBe(0);
    expect(r.high_group_days).toBe(16); // os dias que registraram
    expect(r.low_group_days).toBe(15);
  });

  it("lado esquerdo constante não é salvo pelo corte inclusivo", () => {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 30; i++) rows.push(day(i, { meals_logged: 2, food_spend: 10 * (i % 5) }));
    const r = refeicao_gasto_comida(rows);
    expect(r.status).toBe("dados_insuficientes");
    if (r.status !== "dados_insuficientes") return;
    expect(r.reason).toBe("sem_variacao");
  });
});

/* ─── refeicao_gasto_comida ───────────────────────────────────────────── */

describe("refeicao_gasto_comida", () => {
  it("mede registro de refeição, e o rótulo NÃO diz planejamento", () => {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 30; i++) {
      const registrou = i % 2 === 0;
      rows.push(day(i, {
        meals_logged: registrou ? 3 : 0,
        food_spend: registrou ? 30 : 90,
      }));
    }
    const r = refeicao_gasto_comida(rows);
    expect(r.status).toBe("tendencia");
    if (r.status !== "tendencia") return;
    expect(r.direction).toBe("menor");
    expect(r.labels.left).toBe("houve refeição registrada no dia");
    // Proibido pelo contrato: seria vender uma medida que não fizemos.
    expect(JSON.stringify(r).toLowerCase()).not.toContain("planejamento");
  });
});

/* ─── Orquestrador ────────────────────────────────────────────────────── */

describe("computeInsights", () => {
  it("devolve as três análises em ordem fixa", () => {
    const run = computeInsights(sonoGastoForte(), "2026-06-30");
    expect(run.insights.map((i) => i.kind)).toEqual([
      "sono_gasto_seguinte", "refeicao_gasto_comida", "treino_sono",
    ]);
  });

  it("descarta linhas fora da janela antes de calcular", () => {
    const antigas = Array.from({ length: 30 }, (_, i) =>
      day(-200 + i, { sleep_hours: 5, total_spend: 500 }));
    const run = computeInsights([...antigas, ...sonoGastoForte()], "2026-06-30", 90);
    const sono = run.insights.find((i) => i.kind === "sono_gasto_seguinte") as Insight;
    // As 30 linhas antigas não podem inflar a amostra nem mexer no corte.
    expect(sono.sample_size).toBe(21);
  });

  it("cada insight sempre traz amostra e período para a tela mostrar", () => {
    const run = computeInsights(sonoGastoForte(), "2026-06-30");
    for (const i of run.insights) {
      expect(typeof i.sample_size).toBe("number");
      expect(i.labels.left.length).toBeGreaterThan(0);
      expect(i.labels.right.length).toBeGreaterThan(0);
    }
  });
});

/* ─── A pureza do cálculo, verificada no próprio código ───────────────── */

describe("pureza (o número não pode depender de relógio nem de I/O)", () => {
  // Só o CÓDIGO: os comentários do arquivo citam `Date.now()` justamente para
  // explicar que ele não é usado, e não podem disparar o alarme.
  const fonte = readFileSync("src/lib/insights.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")   // blocos /* ... */
    .replace(/\/\/.*$/gm, "");            // linhas // ...

  it("não importa supabase nem nada de I/O", () => {
    expect(fonte).not.toMatch(/from\s+["'][^"']*supabase/);
    expect(fonte).not.toMatch(/\bfetch\s*\(/);
  });

  it("não lê o relógio: sem Date.now() e sem new Date() sem argumento", () => {
    expect(fonte).not.toContain("Date.now(");
    // `new Date(t)` COM argumento é permitido (addDays usa para aritmética);
    // `new Date()` sem argumento leria o relógio e quebraria a reprodutibilidade.
    expect(fonte).not.toMatch(/new Date\(\s*\)/);
  });

  it("não usa Math.random", () => {
    expect(fonte).not.toContain("Math.random");
  });
});

/* ─── has_finance: nunca calcular gasto em cima de buraco ─────────────── */

describe("has_finance", () => {
  it("40 dias no período mas só 15 com has_finance: faltam 6", () => {
    // O mínimo de 21 conta sobre os pares VÁLIDOS, não sobre os dias do
    // calendário. Sem has_finance, os 25 dias descobertos entrariam com
    // total_spend 0 e o método acharia tendência onde só há buraco.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i < 41; i++) {
      const coberto = i >= 26; // 15 dias cobertos: 26..40
      rows.push(day(i, {
        sleep_hours: i % 2 ? 5 : 8,
        total_spend: coberto ? 40 + (i % 4) * 20 : 0,
        has_finance: coberto,
      }));
    }
    const r = sono_gasto_seguinte(rows);
    expect(r.status).toBe("dados_insuficientes");
    if (r.status !== "dados_insuficientes") return;
    expect(r.reason).toBe("overlap");
    expect(r.sample_size).toBe(15);
    expect(r.days_missing).toBe(6);
  });

  it("o cenário do buraco: julho sem finanças, agosto com, não inventa tendência", () => {
    // 30 dias sem cobertura financeira (zeros falsos) + 12 dias cobertos.
    // Se os zeros entrassem, o grupo de sono baixo (que cai no julho) teria
    // mediana 0 e o de sono alto mediana real — tendência de 100%, do nada.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i < 30; i++) {
      rows.push(day(i, { sleep_hours: 5, total_spend: 0, has_finance: false }));
    }
    for (let i = 30; i < 42; i++) {
      rows.push(day(i, { sleep_hours: 8, total_spend: 120, has_finance: true }));
    }
    const r = sono_gasto_seguinte(rows);
    // 11 pares válidos (dias 30..40 lidos em 31..41): abaixo do mínimo.
    expect(r.status).toBe("dados_insuficientes");
    if (r.status !== "dados_insuficientes") return;
    expect(r.sample_size).toBeLessThan(MIN_OVERLAP_DAYS);
  });

  it("dia coberto com gasto ZERO é dado bom e entra", () => {
    // É exatamente o dia que a heurística "total_spend > 0" perderia.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 30; i++) {
      rows.push(day(i, {
        sleep_hours: i < 15 ? 5 : 8,
        // dias de sono alto: metade com gasto zero real
        total_spend: i === 0 ? 0 : (i - 1 < 15 ? 100 : (i % 2 ? 0 : 20)),
        has_finance: true,
      }));
    }
    const r = sono_gasto_seguinte(rows);
    expect(r.sample_size).toBe(30); // nenhum dia perdido por ter gasto 0
    expect(r.status).toBe("tendencia");
    if (r.status !== "tendencia") return;
    expect(r.direction).toBe("menor");
  });

  it("refeicao_gasto_comida também só pareia dia coberto", () => {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i < 40; i++) {
      const coberto = i >= 25; // 15 dias
      rows.push(day(i, {
        meals_logged: i % 2 ? 0 : 3,
        food_spend: coberto ? (i % 2 ? 80 : 25) : 0,
        has_finance: coberto, finance_from_statement: coberto,
      }));
    }
    const r = refeicao_gasto_comida(rows);
    expect(r.status).toBe("dados_insuficientes");
    if (r.status !== "dados_insuficientes") return;
    expect(r.sample_size).toBe(15);
    expect(r.days_missing).toBe(MIN_OVERLAP_DAYS - 15);
  });

  it("treino_sono NÃO depende de has_finance (não olha dinheiro)", () => {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i <= 40; i++) {
      const treinou = i % 2 === 0;
      rows.push(day(i, {
        workout_count: treinou ? 1 : 0,
        workout_minutes: treinou ? 45 : null,
        sleep_hours: treinou ? 4 : 9,
        has_finance: false,   // sem nenhuma finança: irrelevante aqui
      }));
    }
    const r = treino_sono(rows);
    expect(r.status).toBe("tendencia");
    if (r.status !== "tendencia") return;
    expect(r.high_group_median).toBe(9);
  });
});

/* ─── O tipo é o mesmo do Cargo (verificado em compilação) ─────────────── */

describe("contrato de dados", () => {
  it("DailyMetrics do cálculo satisfaz o tipo lido do banco", () => {
    // Se o Cargo renomear ou trocar o tipo de qualquer campo, isto para de
    // compilar — e `tsc --noEmit` no CI pega antes de chegar em produção.
    // NOS DOIS SENTIDOS, de propósito. A checagem antiga só atribuía o tipo
    // do cálculo ao tipo do banco — e tipagem estrutural aceita campo A MAIS
    // numa variável, então um campo novo em só um dos lados passava batido.
    // Foi assim que `finance_from_statement` quase entrou em um arquivo só.
    const doCalculo = day(0);
    const paraOBanco: DailyMetricsDoCargo = doCalculo;
    const deVolta: DailyMetrics = paraOBanco;
    expect(paraOBanco.day).toBe(doCalculo.day);
    expect(deVolta.day).toBe(doCalculo.day);
    expect(typeof doCalculo.has_finance).toBe("boolean");
    expect(typeof doCalculo.finance_from_statement).toBe("boolean");
  });
});


/* ═══ O RÓTULO PRECISA DESCREVER O GRUPO QUE ELE NOMEIA ═══════════════════
 *
 * Bug real, encontrado em auditoria depois da fase pronta: com corte pela
 * mediana, quem treinava DUAS vezes em alguns dias tinha mediana 1. O corte
 * virava "acima de 1", e todos os dias com UM treino caíam no grupo baixo —
 * que a tela chama de "Em dias sem treino". A mediana estava certa para o
 * grupo; o grupo é que não era o que o rótulo dizia.
 *
 * É o pior tipo de erro deste produto: não parece errado. A pessoa lê um
 * número plausível sobre a própria vida e aprende algo falso.
 */
describe("corte por presença: o rótulo não pode mentir sobre o grupo", () => {
  it("dia com UM treino nunca cai no grupo 'sem treino'", () => {
    // 10 dias com 2 treinos, 12 com 1, 9 sem nenhum. Mediana = 1.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i < 32; i++) {
      const count = i < 10 ? 2 : i < 22 ? 1 : 0;
      rows.push(day(i, { workout_count: count, sleep_hours: count > 0 ? 8 : 6 }));
    }
    const r = treino_sono(rows);
    expect(r.status).toBe("tendencia");
    if (r.status !== "tendencia") return;
    expect(r.split_rule).toBe("houve_ou_nao");
    // 22 dias treinaram (10 com dois + 12 com um). O grupo baixo é só quem
    // não treinou. Com o corte pela mediana, o baixo tinha 21 dias — dos
    // quais 12 COM treino.
    // 31 pares (o dia 31 não tem D+1): 22 dias com treino, 9 sem.
    expect(r.high_group_days).toBe(22);
    expect(r.low_group_days).toBe(9);
  });

  it("quem treina TODO dia recebe 'ainda não dá para dizer', não um rótulo errado", () => {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i < 32; i++) rows.push(day(i, { workout_count: 1 + (i % 3), sleep_hours: 7 }));
    const r = treino_sono(rows);
    // Sem nenhum dia sem treino, não há com o que comparar. Dizer isso é
    // honesto; inventar um grupo "sem treino" cheio de dias com treino não é.
    expect(r.status).toBe("dados_insuficientes");
    if (r.status !== "dados_insuficientes") return;
    expect(r.reason).toBe("sem_variacao");
  });
});


/* ═══ COBERTURA POR EXTRATO: os dois lados precisam ser independentes ═════
 *
 * Achado de auditoria. `has_finance` é verdadeiro também quando existe um
 * lançamento MANUAL no dia — e aí, em refeicao_gasto_comida, os dois lados
 * viram o mesmo fato: ela abriu o app. Nos dias em que não abriu, nenhum dos
 * dois existe. A análise "descobre" que registrar refeição anda com gastar
 * menos, quando mediu apenas quem abriu o app.
 */
describe("refeicao_gasto_comida exige extrato, não lançamento manual", () => {
  it("dia coberto só por lançamento manual não entra na conta", () => {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i < 30; i++) {
      rows.push(day(i, {
        has_finance: true, finance_from_statement: false,
        meals_logged: i % 2 === 0 ? 2 : 0,
        food_spend: i % 2 === 0 ? 20 : 90,
      }));
    }
    const r = refeicao_gasto_comida(rows);
    // Sem extrato, nenhum par se forma — e "faltam dias" é a resposta honesta.
    expect(r.status).toBe("dados_insuficientes");
    if (r.status !== "dados_insuficientes") return;
    expect(r.sample_size).toBe(0);
  });

  it("com extrato confirmado, os mesmos dias produzem a tendência", () => {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i < 30; i++) {
      rows.push(day(i, {
        has_finance: true, finance_from_statement: true,
        meals_logged: i % 2 === 0 ? 2 : 0,
        food_spend: i % 2 === 0 ? 20 : 90,
      }));
    }
    const r = refeicao_gasto_comida(rows);
    expect(r.status).toBe("tendencia");
  });

  it("sono_gasto_seguinte CONTINUA aceitando lançamento manual", () => {
    // O lado esquerdo é o sono, que vem em boa parte de importação e não
    // depende de ela ter aberto o app. Exigir extrato aqui tiraria da análise
    // quem nunca importou fatura, por um risco que não se aplica a ela.
    const rows: DailyMetrics[] = [];
    for (let i = 0; i < 30; i++) {
      rows.push(day(i, {
        has_finance: true, finance_from_statement: false,
        sleep_hours: i % 2 === 0 ? 8.2 : 5.1,
        total_spend: i % 2 === 0 ? 110 : 45,
      }));
    }
    const r = sono_gasto_seguinte(rows);
    expect(r.status).not.toBe("dados_insuficientes");
  });
});
