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
 * Rode com:  deno test --allow-env --allow-net supabase/functions/
 */
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractEventsAndMemories, isMemoryReadable, isUserOwnedMemory, type MemoryRow,
  sleepWakeDay, resolveSleepDays, SLEEP_MORNING_UNTIL_H,
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
    order() { return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { this.single = true; return this; }

    apply(rows: Row[]) {
      return rows.filter((r) => this.filters.every(([kind, col, val]) => {
        if (kind === "eq") return r[col] === val;
        if (kind === "neq") return r[col] !== val;
        if (kind === "in") return (val as unknown[]).includes(r[col]);
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
