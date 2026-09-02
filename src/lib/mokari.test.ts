// ASCENDE — Testes do Mokari (Fase 5).
//
// As quatro regras éticas do contrato são CÓDIGO, e é aqui que elas param de
// depender de alguém lembrar. Cada teste deste arquivo existe para falhar no
// dia em que uma refatoração bem-intencionada apagar uma delas:
//
//   1. NUNCA REGRIDE      → describe("regra 1 ...")
//   2. NUNCA PUNE         → describe("regra 2 ...")
//   3. NUNCA RIDICULARIZA → describe("regra 3 ...")
//   4. NUNCA NOTIFICA     → describe("regra 4 ...")
//   5. DESLIGAR NÃO AFETA → describe("regra 5 ...")
//
// Padrão herdado de src/lib/insights.test.ts: fixtures explícitas, embaralhamento
// determinístico (sem Math.random, senão o próprio teste deixa de ser
// reproduzível) e uma verificação da pureza do módulo lendo o próprio código.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  computeMokari, mokariStage, mokariAffinity, mokariState, mokariEnvironment,
  highWaterMark, daysBetween,
  MOKARI_STATES, MOKARI_CALC_VERSION, MOKARI_DEFAULT_ENABLED,
  IGNORED_KINDS, IGNORED_XP_REASONS, RECENT_WINDOW_DAYS,
  type XpEntry, type MokariEvent,
} from "@/lib/mokari";
import { addDays } from "@/lib/insights";

/* ─── Fixtures ────────────────────────────────────────────────────────── */

const BASE = "2026-03-01";
const REF = "2026-06-01";

const ev = (offset: number, pillar: string, kind = "habit_done"): MokariEvent =>
  ({ occurred_at: `${addDays(BASE, offset)}T12:00:00Z`, pillar, kind });

const xp = (offset: number, points: number, reason = "Hábito concluído"): XpEntry =>
  ({ created_at: `${addDays(BASE, offset)}T12:00:00Z`, points, reason });

/**
 * Três meses de vida registrada: 60 dias de atividade em quatro pilares, com
 * XP suficiente para passar do primeiro estágio. É a "história construída" que
 * as regras protegem.
 */
function tresMeses(): { xp: XpEntry[]; events: MokariEvent[] } {
  const pilares = ["prosperidade", "vitalidade", "alimentacao", "mente"];
  const events: MokariEvent[] = [];
  const pontos: XpEntry[] = [];
  for (let d = 0; d < 60; d++) {
    for (let i = 0; i < 3; i++) {
      const p = pilares[(d + i) % 4];
      events.push(ev(d, p, i === 0 ? "habit_done" : "workout"));
      pontos.push(xp(d, 10));
    }
  }
  return { xp: pontos, events };
}

/** Embaralhamento determinístico (LCG), igual ao da Fase 3. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const fonte = readFileSync("src/lib/mokari.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

/* ═══ REGRA 1: NUNCA REGRIDE O CONQUISTADO ════════════════════════════ */

describe("regra 1 — nunca regride o conquistado", () => {
  it("uma queda no fim devolve o MESMO estágio que a história sem a queda", () => {
    // O teste obrigatório do contrato. A "queda" é o mês de silêncio no fim:
    // é o que a vida real faz, e é onde uma implementação por JANELA ("XP dos
    // últimos 30 dias") rebaixaria o Mokari e transformaria o companheiro em
    // dívida.
    const historia = tresMeses();
    const semQueda = computeMokari(historia.xp, historia.events, addDays(BASE, 59));
    const comQueda = computeMokari(historia.xp, historia.events, addDays(BASE, 89));

    expect(comQueda.stage).toBe(semQueda.stage);
    expect(comQueda.affinity).toEqual(semQueda.affinity);
    // O ambiente é tempo: só pode crescer.
    expect(comQueda.environment).toBeGreaterThanOrEqual(semQueda.environment);

    // E a queda tem que ser REAL, senão o teste passa sem provar nada: o
    // estado recente É sensível ao agora, e é o único que pode descer.
    expect(semQueda.state).not.toBe("descanso");
    expect(comQueda.state).toBe("descanso");
  });

  it("30 dias de silêncio no fim não tiram um degrau do estágio nem da afinidade", () => {
    const { xp: pontos, events } = tresMeses();
    const antes = computeMokari(pontos, events, addDays(BASE, 59));
    for (let extra = 1; extra <= 30; extra++) {
      const depois = computeMokari(pontos, events, addDays(BASE, 59 + extra));
      expect(depois.stage, `caiu no dia +${extra}`).toBe(antes.stage);
      expect(depois.affinity, `afinidade caiu no dia +${extra}`).toEqual(antes.affinity);
    }
  });

  it("XP negativo ou corretivo não puxa o estágio para baixo", () => {
    // xp_log some junto com o evento que o gerou (cascade no banco). Se o
    // estágio viesse do total atual, uma limpeza de dados rebaixaria o Mokari.
    const subida = [xp(0, 300), xp(1, 300), xp(2, 300)]; // 900: estágio 2
    const comEstorno = [...subida, xp(3, -800, "Ajuste")];
    expect(mokariStage(comEstorno)).toBe(mokariStage(subida));
  });

  it("highWaterMark guarda o topo, não o fim da série", () => {
    expect(highWaterMark([100, 100, 100, -250], [0, 200, 1000])).toBe(2);
    expect(highWaterMark([], [0, 200])).toBe(1); // limiar 0: história vazia já conta
  });

  it("afinidade de um pilar não cai quando a pessoa passa a usar outro", () => {
    // 40 registros em prosperidade (nível 3), depois só vitalidade por meses.
    const events: MokariEvent[] = [];
    for (let d = 0; d < 40; d++) events.push(ev(d, "prosperidade"));
    const soProsperidade = mokariAffinity(events);
    for (let d = 40; d < 100; d++) events.push(ev(d, "vitalidade"));
    const depois = mokariAffinity(events);
    expect(depois.prosperidade).toBe(soProsperidade.prosperidade);
    expect(depois.prosperidade).toBe(3);
  });

  it("o ambiente nunca anda para trás com o tempo", () => {
    const { events } = tresMeses();
    let anterior = 0;
    for (let d = 0; d <= 400; d += 10) {
      const { environment } = mokariEnvironment(events, addDays(BASE, d));
      expect(environment).toBeGreaterThanOrEqual(anterior);
      anterior = environment;
    }
  });
});

/* ═══ REGRA 2: NUNCA PUNE ═════════════════════════════════════════════ */

describe("regra 2 — nunca pune", () => {
  it("nenhum dos 5 estados é negativo", () => {
    // Se alguém acrescentar "desanimado", "sozinho" ou "abandonado", isto para.
    const proibidos = [
      "triste", "doente", "abandonad", "sozinh", "solit", "desanimad", "desmotivad",
      "fraco", "murch", "seco", "morr", "morto", "fome", "faminto", "carente",
      "perdid", "atras", "parad", "falh", "fracass", "culpa", "cobran", "preguic",
      "preguiç", "esquecid", "negligen",
    ];
    for (const estado of MOKARI_STATES) {
      for (const termo of proibidos) {
        expect(estado.toLowerCase(), `o estado "${estado}" tem tom negativo`)
          .not.toContain(termo);
      }
    }
  });

  it("são exatamente 5 estados, e o mais baixo descreve em vez de acusar", () => {
    expect(MOKARI_STATES).toHaveLength(5);
    // Quem não registrou nada está em DESCANSO. Descanso não é falha.
    const vazio = computeMokari([], [], REF);
    expect(vazio.state).toBe("descanso");
  });

  it("a saída não tem contador de dias parados", () => {
    // O que existe é `active_days_recent`: contagem de PRESENÇA. Um campo de
    // ausência ("dias sem registrar") é a matéria-prima da cobrança.
    const m = computeMokari([], [], REF);
    const chaves = [...Object.keys(m), ...Object.keys(m.detail)].join(" ").toLowerCase();
    for (const proibido of ["idle", "inativ", "sem_registro", "dias_parad", "streak_lost", "missed", "ausen"]) {
      expect(chaves, `a saída expõe "${proibido}"`).not.toContain(proibido);
    }
    expect(m.detail.active_days_recent).toBe(0);
  });

  it("uma conta nova (nenhum registro) recebe um Mokari válido, não um erro", () => {
    const m = computeMokari([], [], REF);
    expect(m.stage).toBe(1);
    expect(m.environment).toBe(1);
    expect(m.affinity).toEqual({
      prosperidade: 0, vitalidade: 0, alimentacao: 0, mente: 0,
    });
  });
});

/* ═══ REGRA 3: NUNCA RIDICULARIZA O CORPO ═════════════════════════════ */

describe("regra 3 — o corpo não muda o Mokari", () => {
  /** Linha como ela vem do banco: COM payload. O tipo não o declara, e o
   *  cálculo não pode olhar para ele nem por acidente. */
  const comPayload = (offset: number, kg: number): MokariEvent =>
    ({
      occurred_at: `${addDays(BASE, offset)}T12:00:00Z`,
      pillar: "alimentacao",
      kind: "weight",
      payload: { kg },
    } as MokariEvent & { payload: unknown });

  it("injetar eventos de peso com valores absurdos não muda NADA", () => {
    // O teste obrigatório do contrato.
    const { xp: pontos, events } = tresMeses();
    const limpo = computeMokari(pontos, events, REF);

    const absurdos = [
      comPayload(1, 0), comPayload(5, 12), comPayload(9, 480),
      comPayload(20, -70), comPayload(30, 999_999), comPayload(50, Number.NaN),
    ];
    const sujo = computeMokari(pontos, [...events, ...absurdos], REF);

    expect(sujo).toEqual(limpo);
    expect(JSON.stringify(sujo)).toBe(JSON.stringify(limpo));
  });

  it("composição corporal também não muda nada", () => {
    const { xp: pontos, events } = tresMeses();
    const limpo = computeMokari(pontos, events, REF);
    const corpo: MokariEvent[] = [0, 10, 20, 30].map((d) => ({
      occurred_at: `${addDays(BASE, d)}T12:00:00Z`, pillar: "alimentacao", kind: "body",
    }));
    expect(computeMokari(pontos, [...events, ...corpo], REF)).toEqual(limpo);
  });

  it("o XP concedido por registrar peso não move o estágio", () => {
    // O buraco menos óbvio: registrar peso dá 3 XP (setup.sql), e xp_log não
    // tem coluna `kind` — só `reason`. Sem filtrar por motivo, o peso entraria
    // pelo estágio e a regra estaria quebrada pela porta dos fundos.
    const base = [xp(0, 100), xp(1, 90)]; // 190: um degrau abaixo de 200
    expect(mokariStage(base)).toBe(1);

    const cemPesagens = Array.from({ length: 100 }, (_, i) =>
      xp(i, 3, "Peso registrado"));
    expect(mokariStage([...base, ...cemPesagens])).toBe(1);

    const corpo = Array.from({ length: 50 }, (_, i) =>
      xp(i, 4, "Composição corporal registrada"));
    expect(mokariStage([...base, ...corpo])).toBe(1);

    // E o motivo no formato legado também é ignorado.
    const legado = Array.from({ length: 100 }, (_, i) => xp(i, 3, "Registro: weight"));
    expect(mokariStage([...base, ...legado])).toBe(1);

    // Prova de que o teste não é vacuoso: 100 XP de qualquer OUTRA coisa sobe.
    const outra = Array.from({ length: 10 }, (_, i) => xp(i, 10, "Treino registrado"));
    expect(mokariStage([...base, ...outra])).toBe(2);
  });

  it("peso não conta nem como atividade recente", () => {
    // Nem para o estado: quem só se pesou nesta semana está em descanso, não
    // "em movimento". Pesar-se não é a jornada.
    const pesagens: MokariEvent[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      occurred_at: `${addDays(REF, -d)}T12:00:00Z`, pillar: "alimentacao", kind: "weight",
    }));
    const { state, activeDays } = mokariState(pesagens, REF);
    expect(state).toBe("descanso");
    expect(activeDays).toBe(0);
  });

  it("o tipo de entrada não declara payload, e o cálculo nunca o lê", () => {
    // Barreira estrutural: o kg não chega até aqui, então nenhum bug futuro
    // consegue reagir a ele.
    expect(fonte).not.toContain("payload");
    expect(fonte).not.toMatch(/\bkg\b/);
    expect(fonte).not.toMatch(/body_fat|lean_mass|imc|bmi/i);
    expect(IGNORED_KINDS).toContain("weight");
    expect(IGNORED_KINDS).toContain("body");
    expect(IGNORED_XP_REASONS).toContain("Peso registrado");
  });
});

/* ═══ REGRA 4: NUNCA NOTIFICA POR CULPA ═══════════════════════════════ */

describe("regra 4 — nunca notifica", () => {
  it("o módulo não tem nada de notificação", () => {
    // Nesta fase o Mokari não dispara notificação nenhuma: não existe o que
    // desligar depois, e nenhuma mensagem pode nascer de ausência.
    for (const termo of ["notific", "push", "Notification", "sendMessage", "reminder", "lembrete"]) {
      expect(fonte.toLowerCase(), `o módulo menciona "${termo}"`)
        .not.toContain(termo.toLowerCase());
    }
  });
});

/* ═══ REGRA 5: DESLIGAR NÃO AFETA FUNÇÃO NENHUMA ══════════════════════ */

describe("regra 5 — desligar não afeta nada", () => {
  it("não vem ligado por padrão", () => {
    // Personagem que aparece sem ser convidado no app de quem está tentando
    // organizar a vida é atrito. O convite é feito uma vez, na Jornada.
    expect(MOKARI_DEFAULT_ENABLED).toBe(false);
  });

  it("nenhum cálculo do app importa o Mokari (ele é folha na árvore)", () => {
    // ESTA é a garantia estrutural da regra 5. Se src/lib/xp.ts ou
    // src/lib/insights.ts importassem daqui, desligar o Mokari poderia mudar
    // XP ou insight — e aí ele não seria espelho, seria pedágio.
    // Componentes e páginas PODEM importar: é lá que ele é desenhado. E os
    // módulos DO PRÓPRIO Mokari (mokari.ts, useMokariPreference.tsx e os
    // testes) estão fora por definição: eles SÃO o Mokari, não um cálculo do
    // app que passaria a depender dele. O alvo do guarda é xp.ts, insights.ts,
    // useProfile e companhia.
    const arquivos: string[] = [];
    const anda = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) anda(caminho);
        else if (/\.tsx?$/.test(nome) && !/mokari/i.test(nome)) arquivos.push(caminho);
      }
    };
    anda("src/lib");
    anda("src/hooks");
    expect(arquivos.length).toBeGreaterThan(10); // a varredura achou algo

    for (const caminho of arquivos) {
      const conteudo = readFileSync(caminho, "utf8");
      expect(conteudo, `${caminho} importa o Mokari: desligá-lo mudaria número`)
        .not.toMatch(/from\s+["'][^"']*\/mokari["']/);
    }
  });
});

/* ═══ Idempotência (padrão da Fase 3) ═════════════════════════════════ */

describe("idempotência", () => {
  it("duas execuções sobre a mesma história dão resultado idêntico", () => {
    const { xp: pontos, events } = tresMeses();
    const a = computeMokari(pontos, events, REF);
    const b = computeMokari(pontos, events, REF);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("entrada EMBARALHADA produz saída idêntica", () => {
    // Rodar duas vezes seguidas passa mesmo com bug: a ordem de entrada é a
    // mesma nas duas. Embaralhar é o que expõe dependência de ordem — que em
    // produção aparece quando o banco devolve as linhas em outra ordem.
    const { xp: pontos, events } = tresMeses();
    const referencia = computeMokari(pontos, events, REF);
    for (const seed of [1, 7, 42, 1337, 99991]) {
      const px = shuffle(pontos, seed);
      const pe = shuffle(events, seed * 3 + 1);
      expect(px.map((e) => e.created_at)).not.toEqual(pontos.map((e) => e.created_at));
      expect(computeMokari(px, pe, REF)).toEqual(referencia);
    }
  });

  it("a data de referência é parâmetro, não relógio", () => {
    const { xp: pontos, events } = tresMeses();
    const a = computeMokari(pontos, events, "2026-04-01");
    const b = computeMokari(pontos, events, "2026-09-01");
    expect(a.reference_day).toBe("2026-04-01");
    expect(b.reference_day).toBe("2026-09-01");
    // Mesma história, momentos diferentes: o conquistado é igual, o agora não.
    expect(b.stage).toBe(a.stage);
    expect(b.state).not.toBe(a.state);
  });

  it("carrega a versão do cálculo", () => {
    expect(computeMokari([], [], REF).calc_version).toBe(MOKARI_CALC_VERSION);
    expect(MOKARI_CALC_VERSION).toBe("mokari/1");
  });
});

/* ═══ O estado recente ════════════════════════════════════════════════ */

describe("estado recente", () => {
  const naJanela = (diasAtras: number, pillar = "vitalidade"): MokariEvent =>
    ({ occurred_at: `${addDays(REF, -diasAtras)}T10:00:00Z`, pillar, kind: "workout" });

  it("cinco dias ativos na semana é movimento", () => {
    const eventos = [0, 1, 2, 3, 4].map((d) => naJanela(d));
    expect(mokariState(eventos, REF).state).toBe("movimento");
  });

  it("três pilares diferentes é curioso", () => {
    const eventos = [
      naJanela(0, "prosperidade"), naJanela(1, "vitalidade"), naJanela(2, "mente"),
    ];
    expect(mokariState(eventos, REF).state).toBe("curioso");
  });

  it("três dias no mesmo pilar é atento", () => {
    const eventos = [0, 1, 2].map((d) => naJanela(d));
    expect(mokariState(eventos, REF).state).toBe("atento");
  });

  it("um ou dois dias é sereno", () => {
    expect(mokariState([naJanela(0)], REF).state).toBe("sereno");
    expect(mokariState([naJanela(0), naJanela(3)], REF).state).toBe("sereno");
  });

  it("consistência ganha de amplitude: quase todo dia é movimento, não curioso", () => {
    // Decisão de produto explícita. Quem apareceu 6 dos 7 dias em quatro
    // pilares está em movimento; dizer "curioso" descreveria menos.
    const eventos = [0, 1, 2, 3, 4, 5].map((d, i) =>
      naJanela(d, ["prosperidade", "vitalidade", "mente", "alimentacao"][i % 4]));
    expect(mokariState(eventos, REF).state).toBe("movimento");
  });

  it("a janela é de 7 dias: o que é mais velho não conta para o agora", () => {
    const forat = [8, 9, 10, 11, 12].map((d) => naJanela(d));
    expect(mokariState(forat, REF).state).toBe("descanso");
    expect(RECENT_WINDOW_DAYS).toBe(7);
  });
});

/* ═══ Limiares e primitivas ═══════════════════════════════════════════ */

describe("limiares", () => {
  it("os quatro estágios são alcançados nas fronteiras declaradas", () => {
    const comXp = (total: number) => mokariStage([xp(0, total)]);
    expect(comXp(0)).toBe(1);
    expect(comXp(199)).toBe(1);
    expect(comXp(200)).toBe(2);
    expect(comXp(999)).toBe(2);
    expect(comXp(1000)).toBe(3);
    expect(comXp(2999)).toBe(3);
    expect(comXp(3000)).toBe(4);
    expect(comXp(1_000_000)).toBe(4); // não passa de 4
  });

  it("os três níveis de afinidade seguem a contagem de registros do pilar", () => {
    const nivel = (n: number) => {
      const eventos = Array.from({ length: n }, (_, i) => ev(i, "mente"));
      return mokariAffinity(eventos).mente;
    };
    expect(nivel(0)).toBe(0);
    expect(nivel(1)).toBe(1);
    expect(nivel(9)).toBe(1);
    expect(nivel(10)).toBe(2);
    expect(nivel(39)).toBe(2);
    expect(nivel(40)).toBe(3);
    expect(nivel(500)).toBe(3); // não passa de 3
  });

  it("o ambiente vem do TEMPO, não do desempenho", () => {
    // Duas histórias com esforço muito diferente, mesmo tempo de jornada:
    // mesmo ambiente. É o que impede o cenário de virar placar.
    const muito = Array.from({ length: 200 }, (_, i) => ev(i % 100, "vitalidade"));
    const pouco = [ev(0, "vitalidade"), ev(99, "vitalidade")];
    const ref = addDays(BASE, 99);
    expect(mokariEnvironment(muito, ref).environment)
      .toBe(mokariEnvironment(pouco, ref).environment);
  });

  it("journeyStart explícito manda mais que o primeiro registro", () => {
    // Quem criou a conta em março e só registrou em maio está na jornada
    // desde março.
    const eventos = [ev(60, "mente")];
    const semInicio = mokariEnvironment(eventos, addDays(BASE, 70));
    const comInicio = mokariEnvironment(eventos, addDays(BASE, 70), `${BASE}T00:00:00Z`);
    expect(comInicio.journeyDays).toBe(70);
    expect(semInicio.journeyDays).toBe(10);
    expect(comInicio.environment).toBeGreaterThan(semInicio.environment);
  });

  it("daysBetween atravessa mês e ano", () => {
    expect(daysBetween("2026-06-30", "2026-07-01")).toBe(1);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-06-01", "2026-06-01")).toBe(0);
    expect(daysBetween("2026-06-02", "2026-06-01")).toBe(-1);
  });
});

/* ═══ Pureza ══════════════════════════════════════════════════════════ */

describe("pureza (a mesma história tem que dar o mesmo Mokari)", () => {
  it("não importa Supabase nem faz I/O", () => {
    expect(fonte).not.toMatch(/from\s+["'][^"']*supabase/);
    expect(fonte).not.toMatch(/\bfetch\s*\(/);
  });

  it("não lê o relógio: sem Date.now() e sem new Date() sem argumento", () => {
    expect(fonte).not.toContain("Date.now(");
    expect(fonte).not.toMatch(/new Date\(\s*\)/);
  });

  it("não usa Math.random", () => {
    expect(fonte).not.toContain("Math.random");
  });
});
