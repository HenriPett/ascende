/* ASCENDE — Testes da decisão do Blueprint (Deno).
 *
 * O que estes testes travam, e por que cada um:
 *
 * 1) RETOMAR NÃO CHAMA O MODELO. É a promessa inteira da mudança: quem
 *    recarregou depois de gerar recebe a MESMA proposta, de graça e na hora.
 *    O modelo aqui é um dublê que conta chamadas; se um dia alguém reordenar o
 *    fluxo e o ramo `ready` passar pela geração, o contador denuncia.
 * 2) GERANDO AGORA → 202, sem gerar. Duas abas não pagam duas vezes.
 * 3) GERANDO HÁ MAIS DE 420 s → reivindica de novo. Uma função de borda que morreu no
 *    meio não pode prender a pessoa para sempre num "gerando".
 * 4) LEGADO → 409 como antes, e o rastro registra o motivo.
 * 5) GERAR GRAVA ANTES DE RESPONDER, e falha devolve a cortesia.
 *
 * Rode com:  deno test supabase/functions/onboarding-blueprint/
 */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  atender, decidir, escolhasIniciais, GERACAO_VELHA_SEGUNDOS,
  type Dependencias, type Escolhas, type Linha, type Reivindicacao,
} from "./decide.ts";

const AGORA = Date.parse("2026-10-13T12:00:00Z");
const atras = (segundos: number) => new Date(AGORA - segundos * 1000).toISOString();

type Bp = { plans: unknown[]; habits: unknown[]; overview: string };
const BP: Bp = { overview: "o fio", plans: [{ kind: "alimentar" }, { kind: "treino" }, { kind: "rotina" }], habits: [{}, {}] };

/** Dublê de todas as dependências, contando chamadas e guardando o que foi gravado. */
function mundo(opts: {
  linha?: Linha | null;
  carimbo?: string | null;
  ligada?: boolean;
  reivindicacao?: Reivindicacao;
  gerado?: Bp | null | Error;
  maxPlanos?: number;
  linhaDepois?: Linha | null;
  /** O que o banco diz ao gravar: `false` = a geração deste token foi superada. */
  gravou?: boolean;
} = {}) {
  const chamadas = { gerar: 0, reivindicar: 0, liberar: 0, gravar: 0 };
  const tokens = { gravar: [] as string[], liberar: [] as string[] };
  const eventos: { kind: string; detail?: Record<string, unknown> }[] = [];
  let gravado: { bp: Bp; escolhas: Escolhas } | null = null;
  let leituras = 0;
  const deps: Dependencias<Bp> = {
    agora: () => AGORA,
    lerLinha: () => {
      leituras++;
      return Promise.resolve(leituras > 1 && "linhaDepois" in opts ? opts.linhaDepois ?? null : opts.linha ?? null);
    },
    carimboLegado: () => Promise.resolve(opts.carimbo ?? null),
    geracaoLigada: () => Promise.resolve(opts.ligada ?? true),
    reivindicar: () => {
      chamadas.reivindicar++;
      const resultado = opts.reivindicacao ?? "claimed";
      return Promise.resolve({ resultado, token: resultado === "claimed" ? "tok-desta-geracao" : null });
    },
    gerar: () => {
      chamadas.gerar++;
      const g = "gerado" in opts ? opts.gerado : BP;
      return g instanceof Error ? Promise.reject(g) : Promise.resolve(g ?? null);
    },
    maxPlanosAtivos: () => Promise.resolve(opts.maxPlanos ?? 1),
    gravarPronta: (bp, escolhas, token) => {
      chamadas.gravar++;
      tokens.gravar.push(token);
      if (opts.gravou === false) return Promise.resolve(false);
      gravado = { bp, escolhas };
      return Promise.resolve(true);
    },
    liberar: (token) => { chamadas.liberar++; tokens.liberar.push(token); return Promise.resolve(); },
    evento: (kind, detail) => { eventos.push({ kind, detail }); return Promise.resolve(); },
  };
  return { deps, chamadas, eventos, tokens, gravado: () => gravado };
}

const linha = (status: Linha["status"], startedSegundosAtras = 10): Linha => ({
  status,
  proposal: status === "generating" ? null : BP,
  choices: status === "generating" ? {} : { plans: [true, false, false], habits: [true, true], goals: true },
  generation_started_at: atras(startedSegundosAtras),
  activation_result: status === "activated" ? { plans_activated: ["alimentar"] } : null,
});

// ─── 1. Retomar ─────────────────────────────────────────────────────────

Deno.test("ramo ready: devolve a proposta guardada e NÃO chama o modelo", async () => {
  const m = mundo({ linha: linha("ready") });
  const r = await atender(m.deps);
  assertEquals(r.status, 200);
  assertEquals(r.body.status, "ready");
  assertEquals(r.body.resumed, true);
  assertEquals(r.body.blueprint, BP);
  assertEquals(r.body.choices, { plans: [true, false, false], habits: [true, true], goals: true });
  assertEquals(m.chamadas.gerar, 0, "retomar chamou o modelo");
  assertEquals(m.chamadas.reivindicar, 0, "retomar reivindicou uma geração");
  assertEquals(m.eventos.map((e) => e.kind), ["resumed"]);
});

Deno.test("ramo ready com o modelo DESLIGADO: retoma mesmo assim (retomar não é gerar)", async () => {
  const m = mundo({ linha: linha("ready"), ligada: false });
  const r = await atender(m.deps);
  assertEquals(r.status, 200);
  assertEquals(m.chamadas.gerar, 0);
});

Deno.test("ramo activated: 200 com o resultado da ativação, sem modelo", async () => {
  const m = mundo({ linha: linha("activated") });
  const r = await atender(m.deps);
  assertEquals(r.status, 200);
  assertEquals(r.body.status, "activated");
  assertEquals(r.body.activation_result, { plans_activated: ["alimentar"] });
  assertEquals(m.chamadas.gerar, 0);
});

// ─── 2 e 3. Gerando ─────────────────────────────────────────────────────

Deno.test("generating recente → 202, sem gerar e sem reivindicar", async () => {
  const m = mundo({ linha: linha("generating", 30) });
  const r = await atender(m.deps);
  assertEquals(r.status, 202);
  assertEquals(r.body, { status: "generating" });
  assertEquals(m.chamadas.gerar, 0);
  assertEquals(m.chamadas.reivindicar, 0);
});

Deno.test("generating velho (≥ 420 s, acima do teto de 400 s da plataforma) → reivindica de novo e gera", async () => {
  const m = mundo({ linha: linha("generating", GERACAO_VELHA_SEGUNDOS + 1), reivindicacao: "claimed" });
  const r = await atender(m.deps);
  assertEquals(m.chamadas.reivindicar, 1);
  assertEquals(m.chamadas.gerar, 1);
  assertEquals(r.status, 200);
  assertEquals(r.body.resumed, false);
});

Deno.test("generating velho, mas outra aba reivindicou primeiro → 202, sem gerar", async () => {
  const m = mundo({ linha: linha("generating", GERACAO_VELHA_SEGUNDOS + 1), reivindicacao: "generating" });
  const r = await atender(m.deps);
  assertEquals(r.status, 202);
  assertEquals(m.chamadas.gerar, 0);
});

Deno.test("o limiar é 420 s, ACIMA do teto de 400 s das funções de borda", () => {
  // Abaixo do teto da plataforma uma geração viva poderia ser tida como
  // morta e a cortesia, paga duas vezes. Esta trava impede o número de
  // voltar para baixo do teto sem alguém ler o porquê em decide.ts.
  assert(GERACAO_VELHA_SEGUNDOS > 400);
  assertEquals(GERACAO_VELHA_SEGUNDOS, 420);
  // Uma geração de 6 min e meio ainda está viva: espera.
  assertEquals(decidir(linha("generating", 390), null, AGORA), "esperar");
  assertEquals(decidir(linha("generating", GERACAO_VELHA_SEGUNDOS - 1), null, AGORA), "esperar");
  assertEquals(decidir(linha("generating", GERACAO_VELHA_SEGUNDOS), null, AGORA), "reivindicar");
});

// ─── 4. Legado ──────────────────────────────────────────────────────────

Deno.test("legado (carimbo sem linha) → 409 already + evento resume_failed com o motivo", async () => {
  const m = mundo({ linha: null, carimbo: "2026-09-01T10:00:00Z" });
  const r = await atender(m.deps);
  assertEquals(r.status, 409);
  assertEquals(r.body.already, true);
  assertEquals(m.chamadas.gerar, 0);
  assertEquals(m.chamadas.reivindicar, 0);
  assertEquals(m.eventos, [{ kind: "resume_failed", detail: { reason: "legado_sem_proposta" } }]);
});

Deno.test("o banco diz 'legacy' na reivindicação (corrida) → mesmo 409", async () => {
  const m = mundo({ linha: null, carimbo: null, reivindicacao: "legacy" });
  const r = await atender(m.deps);
  assertEquals(r.status, 409);
  assertEquals(m.chamadas.gerar, 0);
});

Deno.test("o banco diz 'ready' na reivindicação (outra aba terminou) → retoma a linha relida", async () => {
  const m = mundo({ linha: null, reivindicacao: "ready", linhaDepois: linha("ready") });
  const r = await atender(m.deps);
  assertEquals(r.status, 200);
  assertEquals(r.body.resumed, true);
  assertEquals(m.chamadas.gerar, 0);
});

// ─── 5. Gerar ───────────────────────────────────────────────────────────

Deno.test("sem linha: reivindica, gera, GRAVA e só então responde", async () => {
  const m = mundo({ linha: null, maxPlanos: 1 });
  const r = await atender(m.deps);
  assertEquals(r.status, 200);
  assertEquals(r.body.status, "ready");
  assertEquals(r.body.resumed, false);
  assertEquals(m.chamadas.gravar, 1, "respondeu sem gravar");
  assertEquals(m.gravado()?.escolhas, { plans: [true, false, false], habits: [true, true], goals: true });
  assertEquals(r.body.choices, m.gravado()?.escolhas);
  assertEquals(m.eventos.map((e) => e.kind), ["generated"]);
});

Deno.test("modelo desligado e sem proposta → 503, sem reivindicar (a cortesia fica intacta)", async () => {
  const m = mundo({ linha: null, ligada: false });
  const r = await atender(m.deps);
  assertEquals(r.status, 503);
  assertEquals(r.body.disabled, true);
  assertEquals(m.chamadas.reivindicar, 0);
});

Deno.test("geração ruim (null) → 502 recuperável e a cortesia volta (pelo token DESTA geração)", async () => {
  const m = mundo({ linha: null, gerado: null });
  const r = await atender(m.deps);
  assertEquals(r.status, 502);
  assertEquals(r.body.recoverable, true);
  assertEquals(m.chamadas.liberar, 1);
  assertEquals(m.tokens.liberar, ["tok-desta-geracao"]);
  assertEquals(m.chamadas.gravar, 0);
});

// ─── 6. O token: a geração superada não manda na resposta ───────────────

Deno.test("gravar leva o token que a reivindicação devolveu", async () => {
  const m = mundo({ linha: null });
  await atender(m.deps);
  assertEquals(m.tokens.gravar, ["tok-desta-geracao"]);
});

Deno.test("geração superada (gravou 0 linhas) e a outra já entregou → responde a GUARDADA, não o próprio bp", async () => {
  const guardada: Linha = { ...linha("ready"), proposal: { overview: "a da outra aba", plans: [{}], habits: [] } };
  const m = mundo({ linha: null, gravou: false, linhaDepois: guardada });
  const r = await atender(m.deps);
  assertEquals(r.status, 200);
  assertEquals(r.body.blueprint, guardada.proposal, "respondeu o bp desta geração em vez do guardado");
  assertEquals(r.body.resumed, true);
  // Não libera: a linha é da outra geração, e liberar apagaria a proposta dela.
  assertEquals(m.chamadas.liberar, 0);
});

Deno.test("geração superada e a outra ainda gera → 202, sem liberar", async () => {
  const m = mundo({ linha: null, gravou: false, linhaDepois: linha("generating", 5) });
  const r = await atender(m.deps);
  assertEquals(r.status, 202);
  assertEquals(m.chamadas.liberar, 0);
});

Deno.test("geração superada e a linha sumiu → 502 recuperável, sem liberar nada", async () => {
  const m = mundo({ linha: null, gravou: false, linhaDepois: null });
  const r = await atender(m.deps);
  assertEquals(r.status, 502);
  assertEquals(r.body.recoverable, true);
  assertEquals(m.chamadas.liberar, 0);
});

Deno.test("geração que lança → a cortesia volta e o erro sobe", async () => {
  const m = mundo({ linha: null, gerado: new Error("rede") });
  await assertRejects(() => atender(m.deps), Error, "rede");
  assertEquals(m.chamadas.liberar, 1);
});

Deno.test("não conseguiu gravar → a cortesia volta (a próxima tentativa gera, não espera)", async () => {
  const m = mundo({ linha: null });
  m.deps.gravarPronta = () => Promise.reject(new Error("banco"));
  await assertRejects(() => atender(m.deps), Error, "banco");
  assertEquals(m.chamadas.liberar, 1);
});

Deno.test("escolhas iniciais: planos só até a cota, hábitos todos, metas sim", () => {
  assertEquals(escolhasIniciais(BP, 2), { plans: [true, true, false], habits: [true, true], goals: true });
  assertEquals(escolhasIniciais(BP, 5).plans, [true, true, true]);
  // Cota ilegível ou zero vira 1: nascer sem nenhum plano marcado esconderia
  // justamente o que a pessoa veio buscar.
  assertEquals(escolhasIniciais(BP, 0).plans, [true, false, false]);
  assert(escolhasIniciais({ plans: [], habits: [] }, 1).goals);
});
