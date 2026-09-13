/* ASCENDE — Testes da cota de IA (Deno).
 *
 * Por que este arquivo existe:
 *
 * 1) RESERVA ÓRFÃ. A cota é reservada NO BANCO antes da chamada de IA e só sai
 *    da conta por código: sucesso → UPDATE da linha, falha → releaseUsage.
 *    Quando a função de borda é MORTA (relógio de parede do Edge Runtime,
 *    estouro de memória, reciclagem do worker), nenhum dos dois roda — nem
 *    `catch`, nem `finally` — e a linha ficava cobrando a pessoa para sempre.
 *    Em produção isso já tinha comido 19 mensagens do Conselheiro que nunca
 *    aconteceram. A defesa é a janela de graça; o teste abaixo dirige
 *    countUsage de verdade, contra um banco falso, para provar que ela existe
 *    e que NÃO desconta reserva viva (descontar reserva viva reabriria a
 *    corrida entre duas requisições simultâneas).
 *
 * 2) O ÁGIO DE CACHE. Escrever cache custa 1,25x a entrada e ler custa 0,1x.
 *    Quatro rotas escreviam e nunca liam, porque rodam 1x/dia, 1x/semana ou
 *    1x na vida e o TTL do cache é de 5 minutos. Elas custavam ATÉ 17,6% MAIS
 *    que não ter cache nenhum. É o tipo de linha que alguém repõe em três
 *    meses achando que está otimizando, então ela fica presa aqui.
 *
 * Rode com:  deno test --allow-env --allow-net --allow-read supabase/functions/
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { countUsage, releaseUsage, settleUsage } from "./usage.ts";

const USER = "11111111-1111-1111-1111-111111111111";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/* ─── Banco falso ────────────────────────────────────────────────────────
   Imita o encadeamento do supabase-js usado por countUsage — INCLUSIVE o
   `.or()`, que é onde mora a regra da reserva órfã. Um duble que ignorasse o
   `.or()` passaria no teste com a correção deletada, que é exatamente a
   regressão que este arquivo existe para pegar. */
function fakeDb(rows: Row[]) {
  const rpcCalls: { fn: string; args: Row }[] = [];

  class Q {
    filters: [string, string, unknown][] = [];
    ors: string[] = [];
    counting = false;
    constructor(public table: string) {}
    // deno-lint-ignore no-explicit-any
    select(_c?: string, o?: any) { if (o?.count) this.counting = true; return this; }
    eq(c: string, v: unknown) { this.filters.push(["eq", c, v]); return this; }
    in(c: string, v: unknown) { this.filters.push(["in", c, v]); return this; }
    gte(c: string, v: unknown) { this.filters.push(["gte", c, v]); return this; }
    or(expr: string) { this.ors.push(expr); return this; }

    /** `col.op.valor` — o valor pode conter pontos (um ISO tem três), então
     *  só os DOIS primeiros separam. É assim que o PostgREST lê. */
    matchTerm(r: Row, term: string) {
      const [col, op, ...rest] = term.split(".");
      const val = rest.join(".");
      if (op === "neq") return String(r[col]) !== val;
      if (op === "eq") return String(r[col]) === val;
      if (op === "gte") return String(r[col]) >= val;
      if (op === "lt") return String(r[col]) < val;
      throw new Error(`operador não coberto pelo duble: ${op}`);
    }

    run() {
      const found = rows
        .filter((r) => this.filters.every(([kind, col, val]) => {
          if (kind === "eq") return r[col] === val;
          if (kind === "in") return (val as unknown[]).includes(r[col]);
          if (kind === "gte") return String(r[col]) >= String(val);
          return true;
        }))
        .filter((r) => this.ors.every((expr) =>
          expr.split(",").some((term) => this.matchTerm(r, term))));
      return this.counting
        ? { count: found.length, data: null, error: null }
        : { data: found, error: null };
    }
    // deno-lint-ignore no-explicit-any
    then(ok: any, fail: any) { return Promise.resolve(this.run()).then(ok, fail); }
  }

  const client = {
    // deno-lint-ignore no-explicit-any
    from: (table: string) => ({ select: (c?: string, o?: any) => new Q(table).select(c, o) }),
    rpc: (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
  };
  // deno-lint-ignore no-explicit-any
  return { db: client as any, rpcCalls };
}

const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const uso = (o: Partial<Row>): Row => ({
  user_id: USER, feature: "chat-principal", model: "claude-sonnet-4-6",
  success: true, created_at: minutosAtras(1), ...o,
});

const INICIO_DA_SEMANA = new Date(Date.now() - 7 * 86_400_000).toISOString();

Deno.test("reserva aberta e VELHA não conta: é entulho de uma função morta", async () => {
  const { db } = fakeDb([
    uso({ created_at: minutosAtras(60), model: "reserva" }),
    uso({ created_at: minutosAtras(16), model: "reserva" }),
  ]);
  assertEquals(await countUsage(db, USER, ["chat-principal"], INICIO_DA_SEMANA), 0);
});

Deno.test("reserva aberta e RECENTE conta: é uma chamada em voo", async () => {
  // Descontar a reserva viva reabriria a corrida que o advisory lock existe
  // para matar: duas requisições simultâneas passariam juntas pelo teto.
  const { db } = fakeDb([
    uso({ created_at: minutosAtras(1), model: "reserva" }),
    uso({ created_at: minutosAtras(14), model: "reserva" }),
  ]);
  assertEquals(await countUsage(db, USER, ["chat-principal"], INICIO_DA_SEMANA), 2);
});

Deno.test("reserva LIQUIDADA conta para sempre: é o marcador do turno do WhatsApp", async () => {
  // O Conselheiro do WhatsApp reserva sob 'chat-principal' e registra a
  // telemetria sob 'wa-conselheiro'; a linha da reserva é o único registro de
  // que aquela conversa consumiu cota. Se a idade a derrubasse, o teto do
  // WhatsApp deixaria de existir.
  const { db } = fakeDb([
    uso({ created_at: minutosAtras(60 * 24), model: "reserva-consumida" }),
    uso({ created_at: minutosAtras(60 * 48), model: "reserva-consumida" }),
  ]);
  assertEquals(await countUsage(db, USER, ["chat-principal"], INICIO_DA_SEMANA), 2);
});

Deno.test("chamada concluída antiga continua contando (a janela é só da reserva)", async () => {
  const { db } = fakeDb([
    uso({ created_at: minutosAtras(60 * 30) }),
    uso({ created_at: minutosAtras(60 * 50) }),
    uso({ created_at: minutosAtras(60 * 2), model: "reserva" }),   // órfã
  ]);
  assertEquals(await countUsage(db, USER, ["chat-principal"], INICIO_DA_SEMANA), 2);
});

Deno.test("liquidar e devolver são operações DIFERENTES no banco", async () => {
  // Trocar uma pela outra é silencioso e caro nas duas direções: liquidar no
  // lugar de devolver cobra uma tentativa que falhou; devolver no lugar de
  // liquidar dá de graça um turno que foi entregue.
  const { db, rpcCalls } = fakeDb([]);
  await settleUsage(db, 7);
  await releaseUsage(db, 7);
  assertEquals(rpcCalls.map((c) => c.fn), ["settle_ai_usage", "release_ai_usage"]);
  assertEquals(rpcCalls[0].args, { reservation_id: 7 });

  rpcCalls.length = 0;
  await settleUsage(db, null);
  await releaseUsage(db, null);
  assertEquals(rpcCalls.length, 0, "sem reserva não há o que liquidar nem devolver");
});

/* ─── O acoplamento entre o TypeScript e o SQL ───────────────────────────
   A janela de graça existe em DOIS lugares por necessidade: o teto atômico é
   decidido em SQL (sob advisory lock) e countUsage roda via PostgREST, fora
   do banco. Se as duas divergirem, a tela mostra um número e o servidor cobra
   outro — e ninguém descobre por erro nenhum. */
Deno.test("a janela de graça é a MESMA no TypeScript e no SQL", async () => {
  const ts = await Deno.readTextFile(new URL("./usage.ts", import.meta.url));
  const sql = await Deno.readTextFile(new URL(
    "../../migrations/20260913140000_reserva_orfa_nao_pode_cobrar_cota.sql", import.meta.url));

  const minutosTs = Number(ts.match(/RESERVATION_GRACE_MS = (\d+) \* 60 \* 1000;/)?.[1]);
  assert(minutosTs > 0, "RESERVATION_GRACE_MS sumiu (ou mudou de forma) em _shared/usage.ts");

  const minutosSql = Number(sql.match(/interval '(\d+) minutes'/)?.[1]);
  assertEquals(minutosTs, minutosSql,
    "a janela de graça divergiu entre usage.ts e a migração que a define");
});

/* ─── O ágio de cache ────────────────────────────────────────────────────
   Ver o cabeçalho. Os números estão no comentário de cada ponto; aqui só
   trancamos a porta. A busca é por `cache_control:` (a CHAVE, com dois
   pontos) e não pela palavra: os comentários que explicam a ausência citam o
   nome dela, e casar com a prosa faria o teste acusar o próprio aviso. */
const fonte = (p: string) => Deno.readTextFile(new URL(`../${p}`, import.meta.url));

Deno.test("briefing e retrospectiva não escrevem cache (custavam 8,0% e 4,1% a MAIS)", async () => {
  const src = await fonte("briefing/index.ts");
  assertEquals(src.includes("cache_control:"), false);
  assertStringIncludes(src, "SEM cache_control aqui");
});

Deno.test("o Blueprint não escreve cache (roda 1x na vida e custava 17,6% a MAIS)", async () => {
  const src = await fonte("onboarding-blueprint/index.ts");
  assertEquals(src.includes("cache_control:"), false);
  assertStringIncludes(src, "SEM cache_control aqui");
});

Deno.test("no ai-chat sobra UM cache: o da chat-principal, que é 27% mais barata", async () => {
  const src = await fonte("ai-chat/index.ts");
  assertEquals((src.match(/cache_control:/g) ?? []).length, 1,
    "o chat-plano-forcado não pode voltar a cachear (115,1 contra 100), e a " +
    "chat-principal não pode parar (72,7 contra 100)");

  const [antesDaFatura] = src.split('"chat-fatura"');
  assertStringIncludes(antesDaFatura, "cache_control:",
    "o único cache_control do arquivo tem de ser o da chamada chat-principal");

  const [, doPlanoForcadoEmDiante] = src.split('"chat-plano-forcado"');
  assertEquals(doPlanoForcadoEmDiante.includes("cache_control:"), false);
});
