/* ASCENDE — Testes das edge functions (Deno).
 *
 * Por que este arquivo existe:
 * A garantia central da Fase 2 é que a IA NÃO sobrescreve memória confirmada
 * pela pessoa. Ela vive num único `if` dentro de persistMemories, e é o tipo
 * de linha que alguém remove em três meses "simplificando a função" sem
 * perceber o que quebrou: a correção da pessoa volta a ser apagada no turno
 * seguinte, em silêncio, e o Conselheiro volta a afirmar o que ela já negou.
 *
 * Testar só o predicado (isUserOwnedMemory) NÃO pegaria essa regressão: o
 * predicado continuaria verde com o `if` deletado. Por isso o teste dirige o
 * CAMINHO REAL de extração, com um banco falso em memória e a chamada à
 * Anthropic dublada — é o mais perto do comportamento de produção que se
 * consegue sem PostgREST.
 *
 * Rode com:  deno test --allow-env --allow-net --allow-read supabase/functions/
 *
 * O --allow-read não é opcional: os testes que provam uma regra olhando o
 * FONTE (a regra de status das memórias, o acoplamento da fronteira de
 * desfecho) leem os arquivos com Deno.readTextFile. Sem a flag são 6
 * reprovações que não têm nada a ver com o código.
 */
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractEventsAndMemories, isMemoryReadable, isUserOwnedMemory, type MemoryRow,
  sleepWakeDay, resolveSleepDays, SLEEP_MORNING_UNTIL_H,
  trendLines, INSIGHT_PILARES, type InsightRow,
  canonicalPillar, canonicalPillarId, withCanonicalPillar, buildSnapshot, CAPTURE_TOOL,
} from "./lib.ts";

const USER = "11111111-1111-1111-1111-111111111111";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/* ─── Banco falso ────────────────────────────────────────────────────────
   Imita o encadeamento do supabase-js usado por lib.ts, incluindo a view
   ai_memories_vigentes (que aplica a REGRA DE LEITURA em SQL no banco real).
   Se a view fosse ignorada aqui, o teste passaria sem provar nada. */
function fakeDb(seed: Row[] = []) {
  const store: Record<string, Row[]> = { ai_memories: [...seed], memory_sources: [], ai_usage: [] };
  let seq = 0;

  const vigentes = () => {
    const now = Date.now();
    return store.ai_memories
      .filter((r) => r.status !== "rejeitada" && r.status !== "expirada")
      .filter((r) => r.valid_until == null || new Date(r.valid_until).getTime() > now)
      .map((r): Row => ({ ...r, trust_rank: r.status === "confirmada" ? 0 : 1 }))
      .sort((a, b) =>
        a.trust_rank - b.trust_rank || String(b.created_at).localeCompare(String(a.created_at)));
  };

  class Q {
    // deno-lint-ignore no-explicit-any
    filters: any[] = [];
    single = false;
    counting = false;
    max?: number;
    // deno-lint-ignore no-explicit-any
    constructor(public table: string, public op: string, public payload?: any) {}
    // deno-lint-ignore no-explicit-any
    select(_c?: string, o?: any) { if (o?.count) this.counting = true; return this; }
    // deno-lint-ignore no-explicit-any
    eq(c: string, v: any) { this.filters.push(["eq", c, v]); return this; }
    // deno-lint-ignore no-explicit-any
    neq(c: string, v: any) { this.filters.push(["neq", c, v]); return this; }
    // deno-lint-ignore no-explicit-any
    not(c: string, _op: string, v: any) { this.filters.push(["not_in", c, v]); return this; }
    // deno-lint-ignore no-explicit-any
    in(c: string, v: any) { this.filters.push(["in", c, v]); return this; }
    // deno-lint-ignore no-explicit-any
    gte(c: string, v: any) { this.filters.push(["gte", c, v]); return this; }
    order() { return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { this.single = true; return this; }

    apply(rows: Row[]) {
      return rows.filter((r) => this.filters.every(([kind, col, val]) => {
        if (kind === "eq") return r[col] === val;
        if (kind === "neq") return r[col] !== val;
        if (kind === "in") return (val as unknown[]).includes(r[col]);
        if (kind === "gte") return String(r[col] ?? "") >= String(val);
        if (kind === "not_in") {
          return !String(val).replace(/[()"]/g, "").split(",").includes(String(r[col]));
        }
        return true;
      }));
    }

    run() {
      const rows = store[this.table] ?? (store[this.table] = []);
      if (this.op === "select") {
        const source = this.table === "ai_memories_vigentes" ? vigentes() : rows;
        const found = this.apply(source);
        if (this.counting) return { count: found.length, data: null, error: null };
        const out = this.max ? found.slice(0, this.max) : found;
        return { data: this.single ? (out[0] ?? null) : out, error: null };
      }
      if (this.op === "insert") {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const made = list.map((r) => ({
          id: `gen-${++seq}`, created_at: new Date().toISOString(), ...r,
        }));
        rows.push(...made);
        return { data: this.single ? (made[0] ?? null) : made, error: null };
      }
      if (this.op === "update") {
        const found = this.apply(rows);
        for (const r of found) Object.assign(r, this.payload);
        return { data: found, error: null };
      }
      if (this.op === "delete") {
        const found = this.apply(rows);
        store[this.table] = rows.filter((r) => !found.includes(r));
        return { data: found, error: null };
      }
      return { data: null, error: null };
    }
    // deno-lint-ignore no-explicit-any
    then(ok: any, fail: any) { return Promise.resolve(this.run()).then(ok, fail); }
  }

  const client = {
    from: (table: string) => ({
      // deno-lint-ignore no-explicit-any
      select: (c?: string, o?: any) => new Q(table, "select").select(c, o),
      // deno-lint-ignore no-explicit-any
      insert: (p: any) => new Q(table, "insert", p),
      // deno-lint-ignore no-explicit-any
      update: (p: any) => new Q(table, "update", p),
      delete: () => new Q(table, "delete"),
    }),
    rpc: () => Promise.resolve({ data: 0, error: null }),
  };
  // deno-lint-ignore no-explicit-any
  return { db: client as any, memories: () => store.ai_memories, sources: () => store.memory_sources };
}

/** Faz a Anthropic devolver exatamente estas memórias, e devolve o prompt visto. */
// deno-lint-ignore no-explicit-any
function stubAnthropic(memories: any[], events: any[] = []) {
  const original = globalThis.fetch;
  const seen = { body: "" };
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    if (String(url).includes("api.anthropic.com")) {
      seen.body = String(init?.body ?? "");
      return Promise.resolve(new Response(JSON.stringify({
        id: "msg_test",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", name: "extrair_registros_e_memorias", input: { events, memories } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
    // deno-lint-ignore no-explicit-any
  }) as any;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

const mem = (o: Partial<Row>): Row => ({
  id: "m", user_id: USER, content: "algo", category: "outro",
  status: "ativa", created_by: "ia", created_at: "2026-09-01T10:00:00Z", ...o,
});

/* ═══ A GARANTIA DA FASE 2 ═══════════════════════════════════════════════ */

Deno.test("a IA não sobrescreve memória confirmada pela pessoa", async () => {
  const { db, memories } = fakeDb([
    mem({ id: "corrigida", content: "Voltou a correr e gosta: corre 3x por semana de manhã",
          category: "preferencia", status: "confirmada", created_by: "usuario" }),
  ]);
  const stub = stubAnthropic([
    // A IA tenta reinstalar a versão antiga e errada.
    { content: "Odeia correr e evita qualquer exercício aeróbico", category: "preferencia",
      confidence: 0.9, replaces_id: "corrigida" },
  ]);
  try {
    const r = await extractEventsAndMemories(db, USER, "Conversando sobre corrida hoje de manhã", "teste");
    const alvo = memories().find((m) => m.id === "corrigida");
    assertEquals(alvo?.content, "Voltou a correr e gosta: corre 3x por semana de manhã",
      "o texto corrigido pela pessoa foi sobrescrito");
    assertEquals(alvo?.status, "confirmada");
    assertEquals(alvo?.created_by, "usuario");
    assertFalse(memories().some((m) => m.content.startsWith("Odeia correr")),
      "a versão recusada entrou como memória nova");
    assertEquals(r.learned.length, 0, "a substituição recusada foi reportada como aprendida");
  } finally { stub.restore(); }
});

Deno.test("memória escrita pela pessoa (ainda 'ativa') também é protegida", async () => {
  const { db, memories } = fakeDb([
    mem({ id: "dela", content: "Mora em Jaraguá do Sul", category: "contexto",
          status: "ativa", created_by: "usuario" }),
  ]);
  const stub = stubAnthropic([
    { content: "Mora em Curitiba", category: "contexto", replaces_id: "dela" },
  ]);
  try {
    await extractEventsAndMemories(db, USER, "Falando de onde eu moro agora", "teste");
    assertEquals(memories().find((m) => m.id === "dela")?.content, "Mora em Jaraguá do Sul");
  } finally { stub.restore(); }
});

Deno.test("memória da própria IA continua corrigível pela IA", async () => {
  const { db, memories } = fakeDb([
    mem({ id: "palpite", content: "Gosta de corrida", category: "preferencia" }),
  ]);
  const stub = stubAnthropic([
    { content: "Não gosta mais de corrida", category: "preferencia", confidence: 0.85,
      replaces_id: "palpite" },
  ]);
  try {
    const r = await extractEventsAndMemories(db, USER, "Cansei de corrida, não gosto mais disso", "teste");
    const alvo = memories().find((m) => m.id === "palpite");
    assertEquals(alvo?.content, "Não gosta mais de corrida");
    assertEquals(alvo?.created_by, "ia");
    assertEquals(alvo?.confidence, 0.85);
    assertEquals(r.learned[0]?.id, "palpite", "o id precisa voltar para registrar a origem");
  } finally { stub.restore(); }
});

Deno.test("memória nova nasce com autoria da IA e confiança limitada a 0..1", async () => {
  const { db, memories } = fakeDb();
  const stub = stubAnthropic([
    { content: "Trabalha em escala 12x36", category: "rotina", confidence: 1.7 },
  ]);
  try {
    await extractEventsAndMemories(db, USER, "Trabalho em escala 12x36 no hospital central", "teste");
    const nova = memories().find((m) => m.content === "Trabalha em escala 12x36");
    assertEquals(nova?.created_by, "ia");
    assertEquals(nova?.status, "ativa");
    assertEquals(nova?.confidence, 1, "confidence fora de faixa deveria ser limitada");
  } finally { stub.restore(); }
});

Deno.test("despejo por teto não remove memória confirmada", async () => {
  // Quatro memórias VIVAS com teto 3: o despejo tem que disparar de verdade,
  // senão o teste não prova nada. A confirmada é a mais ANTIGA de propósito —
  // é ela que um despejo por antiguidade levaria primeiro.
  const { db, memories } = fakeDb([
    mem({ id: "confirmada", content: "Treina de manhã", status: "confirmada",
          created_by: "usuario", created_at: "2026-08-01T00:00:00Z" }),
    ...[0, 1, 2].map((i) => mem({
      id: `viva-${i}`, content: `memória viva ${i}`,
      created_at: `2026-08-0${i + 2}T00:00:00Z`,
    })),
  ]);
  const stub = stubAnthropic([{ content: "Cuida da mãe idosa", category: "contexto" }]);
  try {
    await extractEventsAndMemories(db, USER, "Eu cuido da minha mãe, ela é idosa", "teste", 3);
    assert(memories().length < 5, "o despejo por teto não rodou, o teste não provou nada");
    assert(memories().some((m) => m.id === "confirmada"),
      "a memória confirmada pela pessoa foi despejada por antiguidade");
  } finally { stub.restore(); }
});

/* Recusar precisa LIBERAR espaço, não consumir.
 *
 * O teto contava a tabela inteira, então cada "isso não é sobre mim" custava
 * uma vaga: quem recusasse dez memórias ficaria com dez vagas a menos e veria
 * memórias VIVAS serem despejadas para dar lugar a linhas que ninguém mais lê.
 * A pessoa era punida por usar exatamente o controle que a Fase 2 lhe deu. */
Deno.test("memória rejeitada não ocupa vaga no teto", async () => {
  const { db, memories } = fakeDb([
    mem({ id: "viva-a", content: "Prefere respostas curtas", created_at: "2026-08-01T00:00:00Z" }),
    mem({ id: "viva-b", content: "Mora em Jaraguá do Sul", created_at: "2026-08-02T00:00:00Z" }),
    ...[0, 1, 2, 3].map((i) => mem({
      id: `rej-${i}`, content: `descartada ${i}`, status: "rejeitada",
      created_at: `2026-08-0${i + 3}T00:00:00Z`,
    })),
  ]);
  const stub = stubAnthropic([{ content: "Cuida da mãe idosa", category: "contexto" }]);
  try {
    // Teto 3: duas vivas + a nova = 3. As quatro rejeitadas não contam.
    await extractEventsAndMemories(db, USER, "Eu cuido da minha mãe, ela é idosa", "teste", 3);
    for (const id of ["viva-a", "viva-b"]) {
      assert(memories().some((m) => m.id === id),
        `${id} foi despejada por causa de memórias que a pessoa já tinha recusado`);
    }
    assert(memories().some((m) => m.content === "Cuida da mãe idosa"),
      "a memória nova não coube, mesmo havendo vaga entre as vigentes");
  } finally { stub.restore(); }
});

Deno.test("memória rejeitada ou vencida não volta pela extração", async () => {
  const { db } = fakeDb([
    mem({ id: "ok", content: "Treina de manhã", status: "confirmada", created_by: "usuario" }),
    mem({ id: "rej", content: "Odeia academia lotada", status: "rejeitada" }),
    mem({ id: "venc", content: "Está de férias", valid_until: "2020-01-01T00:00:00Z" }),
  ]);
  const stub = stubAnthropic([]);
  try {
    await extractEventsAndMemories(db, USER, "Uma frase qualquer para disparar a extração", "teste");
    assertFalse(stub.seen.body.includes("Odeia academia"), "memória rejeitada foi mostrada à IA");
    assertFalse(stub.seen.body.includes("de férias"), "memória vencida foi mostrada à IA");
    assert(stub.seen.body.includes("Treina de manhã"));
    assert(stub.seen.body.includes("CONFIRMADA"),
      "a IA precisa ver quais memórias são intocáveis");
  } finally { stub.restore(); }
});

/* ═══ A REGRA DE LEITURA, isolada ════════════════════════════════════════ */

Deno.test("regra de leitura: status e validade", () => {
  const agora = new Date("2026-09-02T12:00:00Z");
  const m = (o: Partial<MemoryRow>): MemoryRow =>
    ({ id: "x", content: "c", category: "outro", status: "ativa", created_by: "ia", ...o });

  assert(isMemoryReadable(m({}), agora));
  assert(isMemoryReadable(m({ status: "confirmada" }), agora));
  assertFalse(isMemoryReadable(m({ status: "rejeitada" }), agora));
  assertFalse(isMemoryReadable(m({ status: "expirada" }), agora));
  assert(isMemoryReadable(m({ valid_until: "2026-12-01T00:00:00Z" }), agora));
  assertFalse(isMemoryReadable(m({ valid_until: "2026-08-01T00:00:00Z" }), agora));
  assert(isMemoryReadable(m({ valid_until: null }), agora));
  // Data ilegível não pode esconder memória válida.
  assert(isMemoryReadable(m({ valid_until: "amanhã" }), agora));
});

Deno.test("quem afirmou: só a pessoa torna a memória intocável", () => {
  assert(isUserOwnedMemory({ id: "a", content: "c", category: "o", status: "confirmada" }));
  assert(isUserOwnedMemory({ id: "a", content: "c", category: "o", created_by: "usuario" }));
  assertFalse(isUserOwnedMemory({ id: "a", content: "c", category: "o", status: "ativa", created_by: "ia" }));
  // Linha legada (antes da migração): a IA ainda pode corrigir.
  assertFalse(isUserOwnedMemory({ id: "a", content: "c", category: "o" }));
});

/* ── A porta que foi fechada, e que não pode reabrir ─────────────────────────
 *
 * selectMemories já teve um TERCEIRO nível de degradação que lia
 * "id,content,category" — sem status, sem validade, sem filtro nenhum. Ele
 * existia para a janela em que a migração da Fase 2 ainda não estava aplicada.
 * Com ele, uma memória que a pessoa REJEITOU ("isso não é sobre mim") voltava
 * para o retrato do Conselheiro em silêncio, com um console.error como único
 * aviso — a única promessa que a Fase 2 fez, quebrada pelo caminho de exceção.
 *
 * selectMemories não é exportada (e não deve ser: é detalhe de montagem do
 * retrato). Então o teste olha o FONTE. É grosseiro de propósito: pega quem
 * acrescentar um caminho de leitura sem a regra, que é exatamente a regressão
 * que aconteceria "simplificando o fallback".
 */
Deno.test("nenhuma leitura de memória escapa da regra de status", async () => {
  const fonte = await Deno.readTextFile(new URL("./lib.ts", import.meta.url));

  // Cada `.from("ai_memories")` precisa ter o filtro de status logo adiante.
  // (A view ai_memories_vigentes já aplica a regra em SQL e não entra aqui.)
  const leituras = [...fonte.matchAll(/\.from\("ai_memories"\)/g)];
  assert(leituras.length > 0, "esperava ao menos uma leitura da tabela");

  for (const m of leituras) {
    const trecho = fonte.slice(m.index ?? 0, (m.index ?? 0) + 400);
    const filtraStatus = trecho.includes('.not("status", "in"')
      || trecho.includes('.neq("status"')
      || trecho.includes('.eq("status"')
      // Escrita (insert/update/delete) não é leitura de conteúdo.
      || /\.(insert|update|upsert|delete)\(/.test(trecho);
    assert(
      filtraStatus,
      "leitura de ai_memories sem filtro de status — memória rejeitada voltaria "
        + "para o retrato do Conselheiro:\n" + trecho.slice(0, 200),
    );
  }

  // E a constante do caminho sem filtro não pode ressuscitar.
  assertFalse(
    fonte.includes("MEMORY_COLS_LEGACY"),
    "MEMORY_COLS_LEGACY voltou: era a leitura sem status nem validade",
  );
});

/* ═══ O DIA DE UM REGISTRO DE SONO ═══════════════════════════════

   Bug relatado pelo fundador: "mando mensagem para registrar o sono e às vezes
   ele não conta como registrado na interface". O "às vezes" era a frase —
   "dormi 6h" funcionava, "ONTEM dormi 6h" (a mesma noite, dita de manhã) caía
   em ontem e a tela Hoje, que pergunta por hoje, dizia que não havia sono.

   A regra vive na EXTRAÇÃO e não no gravador, para o dia entrar na proposta:
   a pessoa confirma exatamente o que vai ser gravado (POSICIONAMENTO H.4), e o
   resultado deixa de depender de quando ela apertou o botão. */

const HOJE = "2026-09-12";
const ONTEM = "2026-09-11";

Deno.test("sleepWakeDay · de manhã, 'ontem' é a noite que acabou: hoje", () => {
  for (const hora of [0, 6, 7, 11]) {
    assertEquals(sleepWakeDay(ONTEM, HOJE, hora), HOJE, `${hora}h`);
  }
});

Deno.test("sleepWakeDay · do meio-dia em diante, 'ontem' é ontem", () => {
  // Aqui as duas leituras deixam de colapsar: "ontem dormi mal" pode ser a
  // noite retrasada. Mexer na data seria trocar um chute por outro.
  for (const hora of [SLEEP_MORNING_UNTIL_H, 13, 20, 23]) {
    assertEquals(sleepWakeDay(ONTEM, HOJE, hora), ONTEM, `${hora}h`);
  }
});

Deno.test("sleepWakeDay · só 'ontem' se move", () => {
  assertEquals(sleepWakeDay(HOJE, HOJE, 7), HOJE);
  assertEquals(sleepWakeDay("2026-09-10", HOJE, 7), "2026-09-10");  // anteontem
  assertEquals(sleepWakeDay("2026-08-12", HOJE, 7), "2026-08-12");
});

Deno.test("sleepWakeDay · a fronteira é a mesma do convite matinal", () => {
  // SleepCheckin some às 12h em SP (`hourInSP() < 12`). Se as duas fronteiras
  // andarem separadas, volta a existir uma hora do dia em que a tela pergunta
  // por uma noite que a proposta mandou para outro dia.
  assertEquals(SLEEP_MORNING_UNTIL_H, 12);
  assertEquals(sleepWakeDay(ONTEM, HOJE, SLEEP_MORNING_UNTIL_H - 1), HOJE);
  assertEquals(sleepWakeDay(ONTEM, HOJE, SLEEP_MORNING_UNTIL_H), ONTEM);
});

Deno.test("sleepWakeDay · atravessa mês, ano e 29 de fevereiro", () => {
  assertEquals(sleepWakeDay("2026-08-31", "2026-09-01", 6), "2026-09-01");
  assertEquals(sleepWakeDay("2025-12-31", "2026-01-01", 6), "2026-01-01");
  assertEquals(sleepWakeDay("2024-02-29", "2024-03-01", 6), "2024-03-01");
});

Deno.test("resolveSleepDays · desloca o sono e nada mais", () => {
  const eventos = [
    { kind: "sleep", occurred_at: ONTEM, summary: "Sono: 6h" },
    { kind: "meal", occurred_at: ONTEM, summary: "Almoço" },
    { kind: "nap", occurred_at: ONTEM, summary: "Soneca" },
  ];
  const out = resolveSleepDays(eventos, HOJE, 7);
  assertEquals(out[0].occurred_at, HOJE);
  // Almoço não atravessa a meia-noite; cochilo tampouco. Sem ambiguidade,
  // sem deslocamento — alargar a regra apagaria registro retroativo legítimo.
  assertEquals(out[1].occurred_at, ONTEM);
  assertEquals(out[2].occurred_at, ONTEM);
});

Deno.test("resolveSleepDays · carimbo com HORA é instante explícito e não se move", () => {
  const out = resolveSleepDays(
    [{ kind: "sleep", occurred_at: `${ONTEM}T23:30:00-03:00` }], HOJE, 7);
  assertEquals(out[0].occurred_at, `${ONTEM}T23:30:00-03:00`);
});

Deno.test("resolveSleepDays · sono SEM carimbo continua sem carimbo", () => {
  // Data omitida = "foi agora", e o banco usa now(). É o caminho de "dormi 6h",
  // que sempre funcionou: a regra não pode inventar uma data para ele.
  const out = resolveSleepDays([{ kind: "sleep", summary: "Sono: 6h" }], HOJE, 7);
  assertEquals(out[0].occurred_at, undefined);
});

Deno.test("resolveSleepDays · não muta a resposta do modelo", () => {
  const original = { kind: "sleep", occurred_at: ONTEM };
  const out = resolveSleepDays([original], HOJE, 7);
  assertEquals(original.occurred_at, ONTEM);   // entrada intacta
  assertEquals(out[0].occurred_at, HOJE);
});

Deno.test("resolveSleepDays · lista vazia e evento nulo não derrubam a extração", () => {
  assertEquals(resolveSleepDays([], HOJE, 7), []);
  assertEquals(resolveSleepDays([null], HOJE, 7), [null]);
});

/* ─── E a regra chega à PROPOSTA, que é o ponto inteiro ───────────────

   Testar `resolveSleepDays` sozinho não pegaria a regressão que importa: se
   alguém remover a chamada de dentro de extractEventsAndMemories, a função
   continua verde e o bug volta inteiro. Estes testes dirigem o caminho real.

   O relógio é congelado porque a regra depende da hora em SP: sem isso o
   teste só provaria o deslocamento se a suíte rodasse antes do meio-dia — e
   uma suíte que só pega o bug de manhã não pega o bug. */

/** Fixa `new Date()` e `Date.now()` num instante, e devolve como desfazer. */
// deno-lint-ignore no-explicit-any
function freezeClock(iso: string): () => void {
  const Real = Date;
  const t = Real.parse(iso);
  // deno-lint-ignore no-explicit-any
  const Fake: any = function (...args: any[]) {
    // deno-lint-ignore no-explicit-any
    return args.length === 0 ? new Real(t) : new (Real as any)(...args);
  };
  Fake.now = () => t;
  Fake.parse = Real.parse;
  Fake.UTC = Real.UTC;
  Fake.prototype = Real.prototype;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Date = Fake;
  // deno-lint-ignore no-explicit-any
  return () => { (globalThis as any).Date = Real; };
}

const NOITE_DE_ONTEM = "2026-09-11";
const HOJE_SP = "2026-09-12";

Deno.test("extração · de manhã, o sono de 'ontem' já sai resolvido na PROPOSTA", async () => {
  // 07:30 em São Paulo: a pessoa acabou de acordar e conta a noite que teve.
  const unfreeze = freezeClock("2026-09-12T07:30:00-03:00");
  const { db } = fakeDb();
  const stub = stubAnthropic([], [
    { kind: "sleep", pillar: "vitalidade", summary: "Sono: 6h", hours: 6, occurred_at: NOITE_DE_ONTEM },
    { kind: "meal", pillar: "alimentacao", summary: "Jantar", occurred_at: NOITE_DE_ONTEM },
  ]);
  try {
    const r = await extractEventsAndMemories(db, USER, "ontem dormi 6h e jantei tarde", "teste");
    assertEquals(r.events[0].occurred_at, HOJE_SP, "o sono não foi resolvido na proposta");
    assertEquals(r.events[1].occurred_at, NOITE_DE_ONTEM, "o jantar não pode se mexer");
  } finally { stub.restore(); unfreeze(); }
});

Deno.test("extração · à tarde, 'ontem' continua sendo ontem", async () => {
  const unfreeze = freezeClock("2026-09-12T15:00:00-03:00");
  const { db } = fakeDb();
  const stub = stubAnthropic([], [
    { kind: "sleep", pillar: "vitalidade", summary: "Sono: 6h", hours: 6, occurred_at: NOITE_DE_ONTEM },
  ]);
  try {
    const r = await extractEventsAndMemories(db, USER, "ontem dormi mal", "teste");
    assertEquals(r.events[0].occurred_at, NOITE_DE_ONTEM);
  } finally { stub.restore(); unfreeze(); }
});

Deno.test("extração · ARQUIVO (bulk) nunca tem o dia deslocado", async () => {
  // A data vem do CSV, não de alguém falando: 555 noites exportadas são dado
  // histórico, e ninguém está chamando nenhuma delas de "ontem". Mesma hora da
  // manhã do primeiro teste, para isolar que o que muda é só o `bulk`.
  const unfreeze = freezeClock("2026-09-12T07:30:00-03:00");
  const { db } = fakeDb();
  const stub = stubAnthropic([], [
    { kind: "sleep", pillar: "vitalidade", summary: "11/09: 7h de sono", hours: 7, occurred_at: NOITE_DE_ONTEM },
  ]);
  try {
    const r = await extractEventsAndMemories(db, USER, "planilha de sono", "teste", 150, { bulk: true });
    assertEquals(r.events[0].occurred_at, NOITE_DE_ONTEM);
  } finally { stub.restore(); unfreeze(); }
});

/* ══ TENDÊNCIAS VERIFICADAS NO RETRATO ══════════════════════════════════════
 *
 * O cruzamento entre pilares é a promessa do produto, e era a única coisa que
 * o Conselheiro não recebia. Agora recebe — e junto vieram três regras que
 * ninguém percebe quebradas olhando a tela, porque quem lê este bloco é um
 * modelo, em silêncio, dentro de um prompt:
 *
 *   1. ESCOPO. Uma tendência atravessa dois pilares. Quem fechou um deles não
 *      pode vê-la vazar pelo lado aberto.
 *   2. O QUE ELA CONFIRMOU. Verdade validada por ela vale mais que dedução da
 *      IA — inclusive (e principalmente) quando a resposta dela foi "não bate".
 *   3. OS TRÊS ESTADOS. "Não encontrei padrão" precisa chegar como resposta,
 *      senão o modelo procura um — e procurar padrão sem dado é inventar a
 *      vida da pessoa.
 *
 * Tudo aqui é função pura: sem banco, sem relógio, sem rede.
 */

/* Três pilares, não quatro. Desde a fusão de 17/09/2026 a chave `alimentacao`
   não chega até aqui: quem monta os escopos (buildSnapshot) resolve a fusão
   antes, com `vitalidade && alimentacao`. Deixar a chave morta neste objeto
   faria estes testes continuarem verdes enquanto o retrato vazasse. */
const TODOS_OS_ESCOPOS = {
  prosperidade: true, vitalidade: true, mente: true, diario: true,
};

/** Uma linha de `insights` como o banco a devolve. */
const ins = (over: Partial<InsightRow> & { kind: string }): InsightRow => ({
  status: "tendencia",
  sample_size: 28,
  period_start: "2026-08-15",
  period_end: "2026-09-12",
  result: { high_group_median: 41, low_group_median: 74 },
  computed_at: "2026-09-12T10:00:00Z",
  ...over,
});

/* O BRL do retrato usa espaço NÃO SEPARÁVEL entre "R$" e o número (é o que o
   Intl devolve em pt-BR, e vale para o retrato inteiro, não só para este
   bloco). Normalizar aqui deixa a asserção legível sem esconder o formato
   real de quem lê o prompt. */
const bloco = (linhas: string[]) => linhas.join("\n").replace(/\u00a0/g, " ");

Deno.test("tendências · escopo fechado não vaza pelo pilar que ficou aberto", () => {
  const insights = [
    ins({ kind: "sono_gasto_seguinte" }),                      // vitalidade × prosperidade
    ins({ kind: "refeicao_gasto_comida" }),                    // vitalidade × prosperidade
    ins({ kind: "treino_sono", result: { high_group_median: 7.4, low_group_median: 6.8 } }),
  ];
  // Ela desligou a análise de prosperidade em Ajustes.
  const texto = bloco(trendLines(insights, [], { ...TODOS_OS_ESCOPOS, prosperidade: false }));

  // As duas que tocam dinheiro somem INTEIRAS — não basta esconder o valor.
  assertFalse(texto.includes("Sono × gasto"), "tendência com dinheiro vazou");
  assertFalse(texto.includes("gasto com comida"), "tendência com dinheiro vazou");
  assertFalse(texto.includes("R$"), "valor em reais vazou num pilar fechado");
  // A que vive inteira dentro de vitalidade continua valendo.
  assert(texto.includes("Treino × sono"), "tendência de um pilar só foi escondida à toa");
});

Deno.test("tendências · o que o escopo esconde não vira 'ainda sem leitura'", () => {
  /* A regressão que este teste pega: listar a análise escondida entre as que
     "ainda não têm leitura" parece inofensivo e é o vazamento mais fácil de
     cometer — entrega que existe uma análise sobre o pilar que ela fechou. */
  const texto = bloco(trendLines(
    [ins({ kind: "treino_sono", result: { high_group_median: 7.4, low_group_median: 6.8 } })],
    [],
    { ...TODOS_OS_ESCOPOS, prosperidade: false },
  ));
  assertFalse(texto.includes("Sono × gasto do dia seguinte"));
  assertFalse(texto.includes("Refeições × gasto com comida"));
  assert(texto.includes("Treino × sono"));
});

Deno.test("tendências · com todos os pilares fechados, o bloco não existe", () => {
  const linhas = trendLines(
    [ins({ kind: "sono_gasto_seguinte" })],
    [],
    { prosperidade: false, vitalidade: false, mente: false, diario: false },
  );
  // Nem o cabeçalho, nem a linha de "nenhuma leitura": silêncio é a resposta.
  assertEquals(linhas, []);
});

Deno.test("tendências · tipo desconhecido nunca chega ao prompt", () => {
  /* Pilar desconhecido é escopo indecidível. Uma quarta análise que chegue ao
     banco antes de chegar ao mapa INSIGHT_PILARES fica de fora até alguém
     declarar quais pilares ela atravessa. */
  const texto = bloco(trendLines(
    [ins({ kind: "humor_gasto_seguinte" }), ins({ kind: "treino_sono", result: { high_group_median: 7.4, low_group_median: 6.8 } })],
    [], TODOS_OS_ESCOPOS,
  ));
  assertFalse(texto.includes("humor_gasto_seguinte"));
  assert(texto.includes("Treino × sono"));
});

Deno.test("tendências · o 'sim' dela entra marcado, e vale mais que dedução da IA", () => {
  const texto = bloco(trendLines(
    [ins({ kind: "sono_gasto_seguinte" })],
    [{ kind: "sono_gasto_seguinte", answer: "sim", asked_status: "tendencia" }],
    TODOS_OS_ESCOPOS,
  ));
  assert(texto.includes("A PESSOA CONFIRMOU"), "a confirmação dela não chegou ao modelo");
  assert(texto.includes("vale mais que qualquer dedução sua"));
});

Deno.test("tendências · o 'não' dela pesa: o número fica, a afirmação não", () => {
  /* O caso que mais importa. O cálculo continua verdadeiro (aquilo aconteceu),
     mas ela disse que não descreve a vida dela — e repetir aquilo como verdade
     sobre ela é o mesmo erro de contradizer uma memória confirmada. */
  const texto = bloco(trendLines(
    [ins({ kind: "sono_gasto_seguinte" })],
    [{ kind: "sono_gasto_seguinte", answer: "nao", asked_status: "tendencia" }],
    TODOS_OS_ESCOPOS,
  ));
  assert(texto.includes("NÃO BATE"), "a recusa dela não chegou ao modelo");
  assert(texto.includes("pergunte antes de concluir"));
  assert(texto.includes("R$ 41,00"), "o número medido não pode sumir junto com a recusa");
});

Deno.test("tendências · resposta dada sobre OUTRO estado não é carregada", () => {
  /* O insight é atualizado no lugar a cada recálculo. Se ela confirmou um
     padrão e hoje o cálculo diz "ficou parecido", a concordância dela é sobre
     outra frase — usá-la seria colocar na boca dela algo que ela não disse. */
  const texto = bloco(trendLines(
    [ins({ kind: "sono_gasto_seguinte", status: "sem_tendencia" })],
    [{ kind: "sono_gasto_seguinte", answer: "sim", asked_status: "tendencia" }],
    TODOS_OS_ESCOPOS,
  ));
  assert(texto.includes("ficou parecido"));
  assertFalse(texto.includes("A PESSOA CONFIRMOU"), "confirmação migrou para outro estado");
});

Deno.test("tendências · perguntamos e ela não respondeu: nenhuma marca", () => {
  const texto = bloco(trendLines(
    [ins({ kind: "sono_gasto_seguinte" })],
    [{ kind: "sono_gasto_seguinte", answer: null, asked_status: "tendencia" }],
    TODOS_OS_ESCOPOS,
  ));
  assertFalse(texto.includes("A PESSOA CONFIRMOU"));
  assertFalse(texto.includes("NÃO BATE"));
});

Deno.test("tendências · os três estados chegam, cada um como ele é", () => {
  const texto = bloco(trendLines([
    ins({ kind: "sono_gasto_seguinte" }),
    ins({ kind: "refeicao_gasto_comida", status: "sem_tendencia", sample_size: 24, result: { high_group_median: 18, low_group_median: 19 } }),
    // treino_sono não tem linha nenhuma: é o estado que persistRun nunca grava.
  ], [], TODOS_OS_ESCOPOS));

  assert(texto.includes("após as noites em que dormiu mais"), "a tendência não foi dita");
  assert(texto.includes("ficou parecido"), "'não encontrei padrão' precisa chegar como resposta");
  assert(texto.includes("Ainda sem leitura: Treino × sono"), "o que não foi calculado precisa ser declarado");
  // E nunca o contrário: ausência de leitura não pode virar "não há padrão".
  assertFalse(/Treino × sono[^\n]*parecido/.test(texto));
});

Deno.test("tendências · 'dados_insuficientes' diz quantos dias faltam", () => {
  const texto = bloco(trendLines(
    [ins({
      kind: "treino_sono", status: "dados_insuficientes", sample_size: 12,
      result: { reason: "overlap", days_missing: 9 },
    })],
    [], TODOS_OS_ESCOPOS,
  ));
  assert(texto.includes("faltam 9 dias"), "a contagem que a tela mostra não chegou ao modelo");
});

Deno.test("tendências · o rótulo é preso ao GRUPO, nunca ao maior número", () => {
  /* O erro mais caro possível: `high_group_median` é a mediana do lado direito
     no grupo ALTO do lado esquerdo — NÃO é o maior número da linha. Ordenar
     para o maior aparecer primeiro inverteria a leitura sem nenhum aviso. */
  const texto = bloco(trendLines(
    [ins({ kind: "sono_gasto_seguinte", result: { high_group_median: 90, low_group_median: 30 } })],
    [], TODOS_OS_ESCOPOS,
  ));
  const dormiuMais = texto.indexOf("dormiu mais");
  const noventa = texto.indexOf("R$ 90,00");
  const trinta = texto.indexOf("R$ 30,00");
  assert(dormiuMais < noventa && noventa < trinta,
    "o valor do grupo alto precisa vir logo depois do rótulo do grupo alto");
});

Deno.test("tendências · número ilegível vira 'sem leitura', nunca número fantasma", () => {
  /* A pessoa confere esse valor olhando a própria vida. Linha com número
     quebrado é pior que linha nenhuma — é a mesma lição do "você usou as
     undefined mensagens desta semana". */
  const texto = bloco(trendLines(
    [ins({ kind: "sono_gasto_seguinte", result: { high_group_median: null, low_group_median: 74 } })],
    [], TODOS_OS_ESCOPOS,
  ));
  assertFalse(texto.includes("NaN"));
  assertFalse(texto.includes("R$ 74,00"), "meia linha com um lado só engana mais que silêncio");
  assert(texto.includes("Ainda sem leitura") || texto.includes("nenhuma leitura"));
});

Deno.test("tendências · conta sem leitura nenhuma gasta uma linha, não um bloco", () => {
  const linhas = trendLines([], [], TODOS_OS_ESCOPOS);
  assertEquals(linhas.length, 1, "conta nova não paga o cabeçalho inteiro por nada");
  assert(linhas[0].includes("ainda não concluiu nenhuma leitura"));
  assert(linhas[0].includes("Não afirme que uma área influencia outra"));
});

Deno.test("tendências · o cabeçalho proíbe causa com as palavras da tela", () => {
  const texto = bloco(trendLines([ins({ kind: "sono_gasto_seguinte" })], [], TODOS_OS_ESCOPOS));
  for (const banida of ['"porque"', '"faz com que"', '"leva a"']) {
    assert(texto.includes(banida), `o prompt precisa banir ${banida} explicitamente`);
  }
  assert(texto.includes("ASSOCIAÇÕES"));
});

/* ── O ESPELHO COM A TELA ────────────────────────────────────────────────────
 *
 * Duas superfícies dizendo a mesma coisa de jeitos diferentes confunde, e aqui
 * a divergência seria pior que confusão: os pontinhos de pilar do card são a
 * mesma informação que decide o ESCOPO deste bloco. Se alguém acrescentar um
 * pilar a uma análise na tela e esquecer do mapa aqui, a tela passa a dizer que
 * a análise toca dinheiro e a IA continua mostrando-a para quem fechou
 * dinheiro. O teste olha o FONTE das duas pontas, de propósito.
 */
Deno.test("tendências · espelho da tela: pilares e frase de limite não podem divergir", async () => {
  const tela = await Deno.readTextFile(
    new URL("../../../src/components/core/TrendInsights.tsx", import.meta.url),
  );

  // 1. Os pilares de cada análise, lidos do COPY da tela.
  const blocos = [...tela.matchAll(
    /(sono_gasto_seguinte|refeicao_gasto_comida|treino_sono):\s*\{\s*pillars:\s*\[([^\]]*)\]/g,
  )];
  assertEquals(blocos.length, 3, "não achei os três COPY da tela — o espelho precisa ser reescrito");

  for (const [, kind, lista] of blocos) {
    const naTela = [...lista.matchAll(/"--([a-z]+)"/g)].map((m) => m[1]).sort();
    const noPrompt = [...(INSIGHT_PILARES[kind] ?? [])].sort();
    assertEquals(
      noPrompt, naTela,
      `os pilares de ${kind} divergem entre a tela e o retrato — ` +
      "a IA passaria a mostrar esta análise para quem fechou um desses pilares",
    );
  }

  // 2. A frase de limite. A pessoa não pode ler uma coisa no card e ouvir
  //    outra do Conselheiro.
  const frase = /const LIMIT_PHRASE = "([^"]+)"/.exec(tela)?.[1] ?? "";
  assert(frase.length > 0, "não achei LIMIT_PHRASE na tela");
  const semTravessao = frase.replace(/\s*—\s*/g, ", ").replace(/\.$/, "").toLowerCase();
  const fonte = await Deno.readTextFile(new URL("./lib.ts", import.meta.url));
  assert(
    fonte.toLowerCase().includes(semTravessao),
    `a frase de limite da tela ("${frase}") não aparece no retrato`,
  );
});

/* ══ O PREFIXO CACHEÁVEL DA EXTRAÇÃO ═══════════════════════════════════════

   A extração é a chamada de maior volume do produto e era o maior bloco sem
   cache que existia (28,6% do gasto, cache_read = 0 nas duas features). O
   desenho está explicado no comentário longo acima de extractEventsAndMemories
   em lib.ts; aqui trancamos as quatro propriedades das quais a economia
   depende — e que são exatamente as que alguém quebra sem perceber, porque
   NADA nelas falha em voz alta: cache que para de funcionar não dá erro, não
   muda a resposta e não aparece em teste nenhum. Só na fatura, meses depois.

   O teste lê o CORPO da requisição, não o fonte: é o que a Anthropic recebe
   que decide se houve reaproveitamento. */

// deno-lint-ignore no-explicit-any
const corpoDaChamada = (body: string): any => JSON.parse(body);
const blocosCacheados = (b: string) =>
  // deno-lint-ignore no-explicit-any
  (corpoDaChamada(b).system as any[]).filter((x) => x.cache_control);
const textoDoUsuario = (b: string) => {
  const c = corpoDaChamada(b).messages[0].content;
  // deno-lint-ignore no-explicit-any
  return typeof c === "string" ? c : (c as any[]).map((x) => x.text ?? "").join("\n");
};
const HORA = "AGORA (fuso do app";

Deno.test("prefixo · o bloco global é byte a byte igual entre pessoas diferentes", async () => {
  /* É o que faz UMA entrada de cache servir o produto inteiro. Basta alguém
     interpolar o nome, o plano ou o id da pessoa nesse bloco para cada usuário
     passar a ter a sua própria entrada — e, no volume de hoje, uma entrada por
     pessoa quase nunca é relida dentro dos 5 minutos de TTL. */
  const corpos: string[] = [];
  for (const memoria of ["Treina de manhã", "Trabalha em escala 12x36"]) {
    const { db } = fakeDb([mem({ id: memoria, content: memoria })]);
    const stub = stubAnthropic([]);
    try {
      await extractEventsAndMemories(db, USER, "corri 5km hoje cedo", "teste");
      corpos.push(stub.seen.body);
    } finally { stub.restore(); }
  }
  const [a, b] = corpos.map(corpoDaChamada);
  assertEquals(a.system[0].text, b.system[0].text,
    "o bloco global da extração deixou de ser global: virou prefixo por pessoa");
  assertEquals(JSON.stringify(a.tools), JSON.stringify(b.tools),
    "tools é renderizado ANTES do system: se variar, nenhum bloco do system cacheia");
  // E o que muda entre as duas é só o bloco de memória, como tem que ser.
  assert(a.system[1].text !== b.system[1].text);
});

Deno.test("prefixo · arquivo e conversa compartilham o MESMO prefixo cacheado", async () => {
  /* As regras de arquivo já foram concatenadas no MEIO do system. Isso dava à
     chamada com arquivo um prefixo diferente da chamada normal desde o byte
     ~5.700: duas entradas que nunca se leem. Elas agora vão no FIM, depois de
     todo bloco cacheado. Se voltarem para o meio, este teste cai. */
  const corpos: boolean[] = [];
  const textos: string[][] = [];
  for (const bulk of [false, true]) {
    const { db } = fakeDb([mem({ id: "m1", content: "Treina de manhã" })]);
    const stub = stubAnthropic([]);
    try {
      await extractEventsAndMemories(db, USER, "planilha de sono", "teste", 150, { bulk });
      const c = corpoDaChamada(stub.seen.body);
      // deno-lint-ignore no-explicit-any
      textos.push((c.system as any[]).filter((x) => x.cache_control).map((x) => x.text));
      corpos.push(bulk);
    } finally { stub.restore(); }
  }
  assertEquals(textos[0], textos[1],
    "a chamada com arquivo deixou de ler o cache que a captura escreve");
});

Deno.test("prefixo · a hora nunca entra num bloco cacheado", async () => {
  /* nowInSpForPrompt() muda a cada minuto. Um relógio dentro do prefixo faria
     cada chamada escrever uma entrada nova e não ler nenhuma — o pior dos dois
     mundos, porque escrever custa 1,25x e a leitura nunca viria. Ela precisa
     continuar abrindo a MENSAGEM, que é renderizada depois de todo o system. */
  const { db } = fakeDb([mem({ id: "m1", content: "Treina de manhã" })]);
  const stub = stubAnthropic([]);
  try {
    await extractEventsAndMemories(db, USER, "dormi 7h", "teste");
    for (const bloco of blocosCacheados(stub.seen.body)) {
      assertFalse(String(bloco.text).includes(HORA),
        "a hora entrou num bloco cacheado: o cache da extração virou ágio puro");
    }
    assert(textoDoUsuario(stub.seen.body).includes(HORA),
      "a hora sumiu da mensagem — sem ela o modelo erra o tipo da refeição");
  } finally { stub.restore(); }
});

Deno.test("prefixo · dois marcadores com memória, um só sem memória", async () => {
  /* Dois breakpoints é o que faz o desenho funcionar dos DOIS lados da
     estimativa dos ~4.015 tokens do bloco global contra o mínimo de 4.096 do
     haiku-4-5: se o global não cruzar o mínimo, o segundo (global + memórias)
     cruza e carrega sozinho. Quem não tem memória nenhuma não tem o que
     reaproveitar, e aí um marcador a mais só ocuparia lugar. */
  const comMemoria = fakeDb([mem({ id: "m1", content: "Treina de manhã" })]);
  let stub = stubAnthropic([]);
  try {
    await extractEventsAndMemories(comMemoria.db, USER, "corri 5km", "teste");
    assertEquals(blocosCacheados(stub.seen.body).length, 2);
  } finally { stub.restore(); }

  const semMemoria = fakeDb([]);
  stub = stubAnthropic([]);
  try {
    await extractEventsAndMemories(semMemoria.db, USER, "corri 5km", "teste");
    assertEquals(blocosCacheados(stub.seen.body).length, 1);
  } finally { stub.restore(); }
});

Deno.test("prefixo · as memórias saíram da mensagem e entraram no system", async () => {
  /* Elas viajavam na mensagem do usuário, atrás da hora — ou seja, atrás de um
     invalidador. No system elas ficam num bloco estável por pessoa, e de
     quebra deixam de ser texto de usuário (que qualquer coisa pode forjar)
     para virar canal do operador. O que NÃO pode mudar é o modelo continuar
     vendo cada uma, e vendo quais são intocáveis. */
  const { db } = fakeDb([
    mem({ id: "ok", content: "Treina de manhã", status: "confirmada", created_by: "usuario" }),
    mem({ id: "rej", content: "Odeia academia lotada", status: "rejeitada" }),
  ]);
  const stub = stubAnthropic([]);
  try {
    await extractEventsAndMemories(db, USER, "corri 5km hoje", "teste");
    const c = corpoDaChamada(stub.seen.body);
    assert(String(c.system[1].text).includes("Treina de manhã"),
      "a memória não está no bloco cacheável por pessoa");
    assert(String(c.system[1].text).includes("CONFIRMADA"),
      "a IA precisa continuar vendo quais memórias são intocáveis");
    assertFalse(textoDoUsuario(stub.seen.body).includes("Treina de manhã"),
      "a memória voltou para a mensagem, atrás da hora que invalida o prefixo");
    assertFalse(stub.seen.body.includes("Odeia academia"),
      "a regra de leitura vale igual no system: memória rejeitada não volta");
  } finally { stub.restore(); }
});

Deno.test("prefixo · o bloco por pessoa é estável entre chamadas seguidas", async () => {
  /* A economia vem da rajada: os vários turnos de uma mesma sessão, dentro dos
     5 minutos de TTL. Se o bloco da pessoa mudar de uma chamada para a outra
     (uma ordenação instável, um contador, um "memórias em DD/MM"), cada turno
     escreve de novo e a rajada não paga nada. */
  const { db } = fakeDb([
    mem({ id: "a", content: "Treina de manhã", created_at: "2026-09-01T10:00:00Z" }),
    mem({ id: "b", content: "Não come lactose", created_at: "2026-09-02T10:00:00Z" }),
    mem({ id: "c", content: "Trabalha em escala 12x36", status: "confirmada", created_by: "usuario" }),
  ]);
  const vistos: string[] = [];
  for (const frase of ["corri 5km hoje", "almocei arroz e frango"]) {
    const stub = stubAnthropic([]);
    try {
      await extractEventsAndMemories(db, USER, frase, "teste");
      vistos.push(corpoDaChamada(stub.seen.body).system[1].text);
    } finally { stub.restore(); }
  }
  assertEquals(vistos[0], vistos[1],
    "o bloco de memórias mudou entre dois turnos da mesma sessão");
});

/* ── O FURO DO ESCOPO: universo podado não afirma ausência ───────────────────
 *
 * Achado na revisão de 13/09/2026, e é o pior tipo de bug que este bloco podia
 * ter, porque ele MENTE em vez de falhar:
 *
 * Esconder tipos por escopo encolhe a lista. Quando o que sobrava não tinha
 * leitura, o bloco escrevia "o app ainda não concluiu nenhuma leitura de padrão
 * entre as áreas desta pessoa" — falso: as leituras existiam, escondidas.
 *
 * E o agravante que fecha o caso: a TELA não consulta `ai_scopes`. A pessoa vê
 * o card do padrão, pergunta ao Conselheiro, e ele nega que exista. Das duas
 * superfícies que se contradizem sobre a vida dela, a que mente é justamente a
 * que ela não tem como conferir.
 *
 * A regra que estes testes travam: o bloco afirma PRESENÇA sempre; AUSÊNCIA,
 * só quando enxerga o universo completo.
 */

Deno.test("tendências · escopo podou e nada sobrou: silêncio, nunca 'não há leitura'", () => {
  /* O caso exato do furo: prosperidade fechada esconde as duas análises de
     dinheiro — uma delas COM tendência calculada — e a que sobra não tem
     leitura nenhuma. */
  const linhas = trendLines(
    [ins({ kind: "sono_gasto_seguinte" })],          // existe, e está escondida
    [],
    { ...TODOS_OS_ESCOPOS, prosperidade: false },
  );
  assertEquals(linhas, [], "o bloco negou uma leitura que a pessoa vê na tela");
});

Deno.test("tendências · o mesmo vale quando o escondido também não tem leitura", () => {
  /* Não dá para condicionar a correção a "existe linha escondida?": decidir
     isso já é olhar o dado que o escopo mandou não olhar. Podou, cala. */
  const linhas = trendLines([], [], { ...TODOS_OS_ESCOPOS, prosperidade: false });
  assertEquals(linhas, []);
});

Deno.test("tendências · universo podado mostra o que TEM e cala sobre o que falta", () => {
  /* A FUSÃO SIMPLIFICOU ESTE CASO, e o teste registra a simplificação.

     Antes havia DOIS caminhos podados: fechar prosperidade ou fechar
     alimentacao escondia parte do universo. Agora só resta um — `treino_sono`
     é a única análise de pilar único, e fechar prosperidade é a única forma de
     esconder parte do bloco sem esconder o bloco inteiro. Menos estado, mesma
     garantia: sobra uma leitura verdadeira, e a lista de ausências, que se lê
     como exaustiva, não aparece. */
  const texto = bloco(trendLines(
    [ins({ kind: "treino_sono", result: { high_group_median: 7.4, low_group_median: 6.8 } })],
    [],
    { ...TODOS_OS_ESCOPOS, prosperidade: false },
  ));
  assert(texto.includes("Treino × sono"), "a leitura verdadeira sumiu junto");
  assertFalse(texto.includes("Ainda sem leitura"), "afirmou ausência sobre um universo podado");
  assertFalse(texto.includes("Refeições"), "nomeou a análise escondida");
  assertFalse(texto.includes("Sono × gasto"), "nomeou a análise escondida");
  // E o cabeçalho não pode ensinar a dizer o que o bloco parou de afirmar.
  assertFalse(texto.includes('"ainda sem leitura" são respostas'));
  assert(texto.includes('"Ficou parecido" é resposta completa'));
});

Deno.test("tendências · fechar Vitalidade fecha TAMBÉM refeições × gasto com comida", () => {
  /* O contrato da fusão, do lado que importa: quem fecha o pilar do corpo
     fecha a análise de comida junto. Sob OU — a alternativa que foi recusada —
     esta análise voltaria a aparecer sozinha para quem havia fechado
     `alimentacao`, sem consentimento e sem aviso. */
  const linhas = trendLines(
    [ins({ kind: "refeicao_gasto_comida" }), ins({ kind: "treino_sono" })],
    [],
    { ...TODOS_OS_ESCOPOS, vitalidade: false },
  );
  // As três análises tocam vitalidade: com ela fechada, o bloco não existe.
  assertEquals(linhas, []);
});

Deno.test("tendências · sem poda, a ausência continua sendo dita (e com a contagem)", () => {
  /* A correção não pode virar "calar sempre": com o universo inteiro à vista,
     "o app olhou e não concluiu" é informação que impede o modelo de inventar
     padrão — o item 3 do pedido. */
  const comTudo = bloco(trendLines([ins({ kind: "sono_gasto_seguinte" })], [], TODOS_OS_ESCOPOS));
  assert(comTudo.includes("Ainda sem leitura: Refeições × gasto com comida; Treino × sono"));

  const vazio = trendLines([], [], TODOS_OS_ESCOPOS);
  assertEquals(vazio.length, 1);
  assert(vazio[0].includes("ainda não concluiu nenhuma leitura"));

  const contagem = bloco(trendLines(
    [ins({
      kind: "treino_sono", status: "dados_insuficientes", sample_size: 12,
      result: { reason: "overlap", days_missing: 9 },
    })],
    [], TODOS_OS_ESCOPOS,
  ));
  assert(contagem.includes("faltam 9 dias"));
});


/* ══ A FUSÃO: O PILAR É TABELA, E O ESCOPO É CONTRATO ══════════════════════

   Duas garantias, e as duas falham em SILÊNCIO se alguém as remover:

   1. O pilar de um evento é derivado do `kind`, no código. O campo saiu do
      CAPTURE_TOOL, então não existe mais um caminho em que o modelo o escolha.
   2. Um perfil que fechou só `alimentacao` — e que NÃO tem a chave nova —
      continua com peso, calorias, proteína e hidratação fora do retrato,
      mesmo lido pela função NOVA. É este teste que prova que a migration é
      OPCIONAL, e portanto que a ordem do deploy deixou de ser risco.          */

Deno.test("pilar · o kind manda, sempre — e o palpite do modelo é ignorado", () => {
  assertEquals(canonicalPillar("transaction"), "prosperidade");
  for (const k of ["sleep", "nap", "workout"]) assertEquals(canonicalPillar(k), "vitalidade");
  for (const k of ["meal", "water", "weight", "body"]) assertEquals(canonicalPillar(k), "vitalidade");
  for (const k of ["mood", "gratitude", "practice", "journal"]) assertEquals(canonicalPillar(k), "mente");
  // Mesmo que o modelo devolva outra coisa (prompt em cache, instância velha),
  // o kind vence: é a diferença entre derivar e confiar.
  assertEquals(canonicalPillar("meal", "prosperidade"), "vitalidade");
  assertEquals(canonicalPillar("sleep", "alimentacao"), "vitalidade");
});

Deno.test("pilar · `note` é DECISÃO, não mais chute do modelo", () => {
  /* `note` nunca esteve no mapa da descrição do tool: o modelo escolhia o
     pilar de toda anotação livre sem instrução nenhuma. Agora está escrito. */
  assertEquals(canonicalPillar("note"), "mente");
  assertEquals(canonicalPillar("note", "prosperidade"), "mente");
});

Deno.test("pilar · o apelido `alimentacao` fica para sempre", () => {
  /* Um Record de uma entrada que cobre linha antiga, cliente desatualizado e
     rollback. Ele NÃO sai na release de contração. */
  assertEquals(canonicalPillar("kind_que_nao_existe", "alimentacao"), "vitalidade");
  assertEquals(canonicalPillarId("alimentacao"), "vitalidade");
  assertEquals(canonicalPillarId("vitalidade"), "vitalidade");
  // Pilar inventado não vira pilar: plano sem pilar é caso previsto.
  assertEquals(canonicalPillarId("saude"), null);
  assertEquals(canonicalPillarId(undefined), null);
  // Já um EVENTO sempre tem pilar: sem pista nenhuma, cai onde faz menos estrago.
  assertEquals(canonicalPillar("kind_que_nao_existe", "saude"), "mente");
});

Deno.test("pilar · o campo saiu do tool — não há mais como o modelo escolher", () => {
  const ev = ((CAPTURE_TOOL.input_schema.properties as Record<string, any>)
    .events.items) as Record<string, any>;
  assertFalse("pillar" in ev.properties, "o campo `pillar` voltou ao CAPTURE_TOOL");
  assertFalse((ev.required as string[]).includes("pillar"));
  assertEquals(ev.required, ["kind", "summary"]);
});

Deno.test("pilar · toda proposta sai do servidor já canônica", () => {
  const saida = withCanonicalPillar([
    { kind: "meal", pillar: "alimentacao", summary: "Almoço" },
    { kind: "workout", summary: "Treino" },                    // sem o campo
    { kind: "transaction", pillar: "mente", summary: "Mercado" },
    null,
  ]);
  assertEquals(saida[0].pillar, "vitalidade");
  assertEquals(saida[1].pillar, "vitalidade");
  assertEquals(saida[2].pillar, "prosperidade");
  assertEquals(saida[3], null);
  assertEquals(saida[0].summary, "Almoço", "a normalização mexeu em outro campo");
});

Deno.test("escopo · quem fechou só `alimentacao`, SEM a chave nova, continua fechado", async () => {
  /* O TESTE QUE TORNA A MIGRATION OPCIONAL.

     Perfil como ele está hoje no banco de quem desligou a análise de comida
     em Ajustes: `vitalidade: true`, `alimentacao: false`, e nenhuma chave
     nova. Lido pela função NOVA, o retrato não pode conter nada do corpo — é
     a LEITURA DERIVADA que segura isso, não a migration. Se este teste passar,
     a migration pode rodar antes, depois, no meio ou nunca. */
  const hoje = new Date().toISOString();
  const retratoCom = (scopes: Record<string, unknown>) => {
    const { db } = fakeDb();
    const seed = (tabela: string, linhas: Row[]) => {
      for (const l of linhas) db.from(tabela).insert(l).run();
    };
    seed("profiles", [{
      user_id: USER, name: "Ana", ai_scopes: scopes,
      pillars: ["vitalidade", "alimentacao"],
      calorie_goal_kcal: 2000, protein_goal_g: 140, water_goal_ml: 3000,
      weight_goal_kg: 78, weekly_workouts_goal: 4, sleep_goal_h: 8,
    }]);
    seed("life_events", [
      { user_id: USER, pillar: "alimentacao", kind: "weight", occurred_at: hoje, payload: { kg: 101.5 } },
      { user_id: USER, pillar: "alimentacao", kind: "body", occurred_at: hoje, payload: { body_fat_pct: 28 } },
      { user_id: USER, pillar: "alimentacao", kind: "meal", occurred_at: hoje, payload: { calories: 650, protein_g: 40, description: "Frango com arroz" } },
      { user_id: USER, pillar: "alimentacao", kind: "water", occurred_at: hoje, payload: { ml: 1500 } },
      { user_id: USER, pillar: "vitalidade", kind: "workout", occurred_at: hoje, payload: { description: "Costas" } },
    ]);
    seed("insights", [{
      user_id: USER, kind: "refeicao_gasto_comida", status: "tendencia", sample_size: 28,
      period_start: "2026-08-15", period_end: "2026-09-12",
      result: { high_group_median: 41, low_group_median: 74 },
      computed_at: "2026-09-12T10:00:00Z",
    }]);
    return buildSnapshot(db, USER);
  };

  const proibidos = [
    "PESO:", "COMPOSIÇÃO CORPORAL", "101.5",
    "META CALÓRICA", "kcal",
    "PROTEÍNA", "HIDRATAÇÃO", "REFEIÇÕES DE HOJE", "Frango com arroz",
    "Refeições × gasto com comida",
  ];

  /* CONTROLE, e ele não é cerimônia: sem esta metade, um retrato que voltasse
     VAZIO (banco falso mudo, exceção engolida, consulta renomeada) passaria
     no teste anunciando uma privacidade que na verdade é um bug. Com o escopo
     ABERTO, cada string proibida tem de aparecer. */
  const aberto = await retratoCom({ vitalidade: true, alimentacao: true });
  for (const esperado of proibidos) {
    assert(
      aberto.includes(esperado),
      `o teste está cego: "${esperado}" não aparece nem com o escopo ABERTO`,
    );
  }

  const retrato = await retratoCom({ vitalidade: true, alimentacao: false });
  for (const proibido of proibidos) {
    assertFalse(
      retrato.includes(proibido),
      `vazou "${proibido}" para quem fechou a análise do corpo (a chave nova nem existe no perfil)`,
    );
  }

  /* E o que ela fechou some INTEIRO: sono e treino vão junto, porque o escopo
     é do pilar fundido. É o custo assumido do E — perda de utilidade,
     visível e reversível com um toque —, e não o custo do OU, que seria
     devolver a análise do corpo sem ela ter pedido. */
  assertFalse(retrato.includes("META DE TREINOS"), "meio corpo visível voltou a existir");
  assertFalse(retrato.includes("META DE SONO"), "meio corpo visível voltou a existir");

  // A linha de privacidade existe, e fala em português, não em id de banco.
  // (o rótulo virou "PRIVACIDADE — ÁREA FECHADA PELA PESSOA" no conserto do
  //  achado de QA da v67; o teste abaixo cobre o conteúdo novo)
  assert(retrato.includes("PRIVACIDADE"));
  assert(retrato.includes("Vitalidade"), "a linha de privacidade não nomeou a área");
  assertFalse(retrato.includes("alimentacao"), "id cru do sistema foi entregue ao modelo");
  /* Casa com o prefixo INTEIRO da linha ("Pilares ativos no app: ..."). A
     versão anterior prendia-se a "Pilares ativos:" com dois-pontos colados e
     ficou cega no dia em que o rótulo mudou — assertFalse contra regex que
     não casa mais passa sempre. O assert de existência acima é o antídoto. */
  const linhaPilares = retrato.split("\n").find((l) => l.startsWith("Pilares ativos"));
  assert(linhaPilares, "o teste está cego: a linha de pilares ativos sumiu do retrato");
  assertFalse(/\balimentacao\b/.test(linhaPilares), "id cru do sistema na linha de pilares");
});

Deno.test("escopo · com a chave nova já gravada, o resultado é o MESMO", () => {
  /* Idempotência da leitura derivada: `!== false && !== false`. Perfil
     migrado, perfil não migrado e perfil pós-rollback chegam ao mesmo lugar. */
  const deriva = (raw: Record<string, unknown>) =>
    raw.vitalidade !== false && raw.alimentacao !== false;
  assertFalse(deriva({ vitalidade: true, alimentacao: false }));   // não migrado
  assertFalse(deriva({ vitalidade: false, alimentacao: false }));  // migrado (E)
  assertFalse(deriva({ vitalidade: false }));                      // chave antiga já removida
  assert(deriva({ vitalidade: true, alimentacao: true }));
  assert(deriva({}));                                              // conta nova: tudo aberto
});

Deno.test("escopo · área fechada não vira pendência, e o retrato não pede para reativar", async () => {
  /* ACHADO DE QA EM PRODUÇÃO (v67). O Conselheiro escreveu, em duas respostas:
       "Se quiser reativar a análise de Vitalidade, é isso que me devolve
        visibilidade sobre sono, treino e peso."
       "Se quiser essa visão, precisaria reativar a análise de Vitalidade."
     Nada vazou: o dano é cutucar uma escolha de privacidade deliberada
     (PRINCIPIOS.md, micro-incoerência 3 — "isso é serviço ou é culpa?").

     Este teste cobre a metade do problema que é NOSSA: enquanto a linha de
     privacidade mandava não cobrar, os blocos administrativos do MESMO
     retrato cobravam. O perfil aqui é o oposto do teste acima — nenhuma meta
     definida e nenhum peso registrado —, que é exatamente quando esses blocos
     disparam. */
  const retratoCom = (scopes: Record<string, unknown>) => {
    const { db } = fakeDb();
    db.from("profiles").insert({
      user_id: USER, name: "Ana", ai_scopes: scopes,
      pillars: ["vitalidade", "prosperidade"],
      // Sem meta nenhuma e sem peso: é o gatilho de METAS AINDA SEM VALOR e
      // de DADOS AINDA NÃO INFORMADOS.
    }).run();
    return buildSnapshot(db, USER);
  };

  const fechado = await retratoCom({ vitalidade: false, alimentacao: false });

  // 1. O comportamento SUBSTITUTO chegou (é ele que desarma o impulso de ajudar).
  assert(fechado.includes("O QUE FAZER"), "a regra voltou a ser só proibição");
  assert(fechado.includes("ESTA REGRA VENCE"), "o conflito com o system não foi resolvido");

  // 2. A área fechada não aparece como pendência a preencher.
  assertFalse(
    fechado.includes("peso atual"),
    "o retrato cobrou peso de quem fechou a análise do corpo",
  );
  for (const meta of ["meta calórica diária", "meta de proteína", "meta de treinos por semana", "meta de sono"]) {
    assertFalse(fechado.includes(meta), `"${meta}" foi anunciada como pendência numa área fechada`);
  }
  assertFalse(
    /Onde preencher:[^]*aba Vitalidade/.test(fechado),
    "o retrato apontou a aba da área que ela fechou",
  );

  /* 3. CONTROLE — sem esta metade, um retrato vazio (banco falso mudo,
        consulta renomeada) passaria anunciando uma correção que é bug. Com a
        área ABERTA, cada cobrança tem de aparecer; e o pilar que continua
        aberto (prosperidade) segue cobrando nos DOIS casos. */
  const aberto = await retratoCom({});
  assert(aberto.includes("peso atual"), "o teste está cego: nem com a área aberta o peso é cobrado");
  assert(aberto.includes("meta de treinos por semana"), "o teste está cego");
  assert(aberto.includes("aba Vitalidade"), "o teste está cego");
  for (const retrato of [aberto, fechado]) {
    assert(retrato.includes("teto de gasto diário"), "a meta de um pilar ABERTO foi escondida junto");
  }
});

Deno.test("escopo · o retrato não pode dizer que a área fechada está aberta", async () => {
  /* REGRESSÃO DA CORREÇÃO ANTERIOR (v68). Pergunta INDIRETA, com o escopo de
     Vitalidade fechado: "Por que você não fala nada sobre o meu sono e os meus
     treinos?". O Conselheiro acertou o sono e errou o treino, na mesma frase:
       "Já os treinos são outra história: essa área está aberta, só que eu não
        vi nenhum registro seu de treino."
     Os dois erros, e a conta tinha 11 treinos em 30 dias:
       (a) informou à pessoa que a área estava ABERTA — mentira sobre a
           configuração que ela mesma fez;
       (b) afirmou AUSÊNCIA de registro — ele não "não viu", ele não PODE ver.
           É a doutrina do insightErr ("leitura que falhou não vira não há
           padrão") aplicada no lugar errado, e convida a pessoa a redigitar o
           que o app já tem.

     A CAUSA não foi o modelo deixar de ligar "treino" ao rótulo "Vitalidade":
     ele liga (acerta quando a pergunta é direta). Era CONTRADIÇÃO no próprio
     retrato — "ÁREA FECHADA: Vitalidade" contra "Pilares ativos: Vitalidade",
     duas linhas abaixo, mesma palavra, sentidos diferentes. */
  const retratoCom = (scopes: Record<string, unknown>) => {
    const { db } = fakeDb();
    db.from("profiles").insert({
      user_id: USER, name: "Ana", ai_scopes: scopes,
      pillars: ["vitalidade", "prosperidade", "mente"],
    }).run();
    db.from("life_events").insert({
      user_id: USER, pillar: "vitalidade", kind: "workout",
      occurred_at: new Date().toISOString(), payload: { description: "Costas" },
    }).run();
    return buildSnapshot(db, USER);
  };

  const fechado = await retratoCom({ vitalidade: false, alimentacao: false });

  // (a) As duas linhas deixam de se contradizer: onde a palavra se repete, a
  //     segunda ocorrência já chega carimbada.
  const linhaAtivos = fechado.split("\n").find((l) => l.startsWith("Pilares ativos"))!;
  assert(linhaAtivos.includes("Vitalidade"), "o teste está cego: a área nem aparece");
  assert(
    /Vitalidade \(ativo para ela, FECHADO para a sua análise\)/.test(linhaAtivos),
    "a linha de pilares ativos volta a desmentir a de privacidade",
  );
  assert(linhaAtivos.includes("NÃO é permissão"), "a distinção entre os dois sentidos sumiu");

  // (b) A área fechada é enumerada: não sobra inferência sobre o que ela cobre.
  for (const assunto of ["sono", "treinos", "peso", "refeições", "hidratação"]) {
    assert(fechado.includes(assunto), `a linha de privacidade não enumerou "${assunto}"`);
  }

  // (c) Afirmar ausência sobre área fechada é proibido na letra.
  assert(fechado.includes("VOCÊ NÃO ESTÁ SEM DADO, VOCÊ ESTÁ SEM PERMISSÃO"));
  assert(fechado.includes("PROIBIDO afirmar ausência"));

  // (d) O que já funcionava em produção (v68) continua de pé.
  assert(fechado.includes('as palavras "reativar" e "ativar"'), "a proibição que passou no scan sumiu");
  // (e) E a exceção não virou evasão.
  assert(fechado.includes("NÃO é motivo para se esquivar"));

  /* CONTROLE — quem não fechou nada não paga por nada disso: sem carimbo, sem
     cláusula extra e sem a linha de privacidade. O custo da regra fica com a
     minoria que a aciona. */
  const aberto = await retratoCom({});
  assertFalse(aberto.includes("PRIVACIDADE"), "linha de privacidade em conta sem área fechada");
  assertFalse(aberto.includes("FECHADO para a sua análise"), "carimbo cobrado de quem não fechou nada");
  assertFalse(aberto.includes("NÃO é permissão"), "cláusula extra cobrada de quem não fechou nada");
  assert(aberto.includes("Pilares ativos no app: Vitalidade, Prosperidade, Mente."));
});
