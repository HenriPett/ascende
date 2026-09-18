/* ASCENDE — Testes das regras puras do canal WhatsApp (Deno).
 *
 * Rode com:  deno test --allow-env --allow-net --allow-read supabase/functions/
 *
 * O bug coberto aqui foi relatado pelo fundador: um item que a pessoa não
 * confirmou volta a ser proposto em toda mensagem curta seguinte. A fronteira
 * que o impede tem DUAS pontas — o desfecho por botão e o desfecho por TEMPO —
 * e as duas moram em funções puras, o que permite prová-las sem banco e sem
 * relógio. (A regra do dia do sono vive em lib.ts e tem teste em lib.test.ts.)
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  textForExtraction, isPendingExpired, CAPTURE_OUTCOME_PREFIX, SHORT_REPLY_CHARS,
  saveEventsServer,
} from "./whatsapp.ts";

/** Histórico como o webhook o lê: DECRESCENTE, mais recente primeiro. */
const h = (...turns: [string, string][]) =>
  turns.map(([role, content]) => ({ role, content }));

const desfecho = (texto: string) => `${CAPTURE_OUTCOME_PREFIX}12/09 08:30] ${texto}`;
const DESCARTADO = desfecho("Você descartou a proposta: NADA foi registrado.");
const REGISTRADO = desfecho("Registrei para você:\n• Jantar: 3 pães franceses");
const EXPIRADO = desfecho("A proposta expirou sem confirmação: NADA foi registrado.");

Deno.test("textForExtraction · o caso legítimo continua de pé", () => {
  // "Foi jantar" complementa a pergunta do Conselheiro logo antes. Nada foi
  // resolvido no meio, então o relato anterior AINDA é o contexto desta fala.
  const hist = h(
    ["assistant", "Era almoço ou jantar?"],
    ["user", "Comi 3 pães franceses com requeijão"],
  );
  assertEquals(
    textForExtraction("Foi jantar", hist),
    "Comi 3 pães franceses com requeijão\nFoi jantar",
  );
});

Deno.test("textForExtraction · item descartado NÃO volta (o bug do fundador)", () => {
  // A pessoa descartou. Qualquer mensagem curta depois disso não pode
  // ressuscitar o relato: a fronteira está entre ela e o relato antigo.
  const hist = h(
    ["assistant", DESCARTADO],
    ["assistant", "A propósito, isso dá para registrar:"],
    ["user", "Comi 3 pães franceses com requeijão"],
  );
  assertEquals(textForExtraction("E hoje?", hist), "E hoje?");
});

Deno.test("textForExtraction · registrado e expirado também fecham a fronteira", () => {
  for (const linha of [REGISTRADO, EXPIRADO]) {
    const hist = h(["assistant", linha], ["user", "Dormi 6h"]);
    assertEquals(textForExtraction("Ok", hist), "Ok");
  }
});

Deno.test("textForExtraction · a fronteira não apaga o que veio DEPOIS dela", () => {
  // Desfecho antigo lá atrás, relato novo depois: o relato novo continua
  // sendo contexto legítimo. A fronteira para a varredura, não a proíbe.
  const hist = h(
    ["assistant", "Quantas horas?"],
    ["user", "Dormi mal essa noite"],
    ["assistant", DESCARTADO],
    ["user", "Comi 3 pães franceses"],
  );
  assertEquals(textForExtraction("Umas 5", hist), "Dormi mal essa noite\nUmas 5");
});

Deno.test("textForExtraction · mensagem longa se explica sozinha", () => {
  const longa = "a".repeat(SHORT_REPLY_CHARS + 1);
  const hist = h(["user", "Comi 3 pães franceses"]);
  assertEquals(textForExtraction(longa, hist), longa);
});

Deno.test("textForExtraction · histórico vazio e fala repetida não duplicam", () => {
  assertEquals(textForExtraction("Foi jantar", []), "Foi jantar");
  assertEquals(textForExtraction("Foi jantar", h(["user", "Foi jantar"])), "Foi jantar");
});

/* ─── A segunda ponta da fronteira: o desfecho por TEMPO ──────────────

   Fechar só por botão deixava de fora o caso mais comum de todos: a pessoa
   simplesmente ignora o cartão. Sem desfecho, o relato era herdado para
   sempre E a pendente velha travava a guarda `if (!pending)` — nenhuma
   proposta nova voltava a aparecer na rota conversacional. */

const MIN = 60_000;
const AGORA = Date.parse("2026-09-12T12:00:00-03:00");
const TTL = 60;

Deno.test("isPendingExpired · proposta recente está viva", () => {
  assertEquals(isPendingExpired(new Date(AGORA - 5 * MIN).toISOString(), AGORA, TTL), false);
  assertEquals(isPendingExpired(new Date(AGORA).toISOString(), AGORA, TTL), false);
});

Deno.test("isPendingExpired · depois do TTL, venceu", () => {
  assertEquals(isPendingExpired(new Date(AGORA - 61 * MIN).toISOString(), AGORA, TTL), true);
  assertEquals(isPendingExpired(new Date(AGORA - 26 * 60 * MIN).toISOString(), AGORA, TTL), true);
});

Deno.test("isPendingExpired · a fronteira é exatamente o TTL", () => {
  // Exatamente 60min ainda vale (o botão desta proposta grava). Um ms depois, não.
  assertEquals(isPendingExpired(new Date(AGORA - 60 * MIN).toISOString(), AGORA, TTL), false);
  assertEquals(isPendingExpired(new Date(AGORA - 60 * MIN - 1).toISOString(), AGORA, TTL), true);
});

Deno.test("isPendingExpired · data ilegível conta como VENCIDA", () => {
  // Falha para o lado de liberar campo: uma pendente que ninguém consegue
  // datar não pode bloquear proposta nova para o resto da vida da conta.
  for (const lixo of [null, undefined, "", "nem data", {}]) {
    assertEquals(isPendingExpired(lixo, AGORA, TTL), true, String(lixo));
  }
});

Deno.test("a linha de expirado é a MESMA fronteira que textForExtraction conhece", () => {
  // É este acoplamento que faz uma correção fechar as duas pontas: a varredura
  // por tempo escreve captureOutcomeLine("expirado"), e a herança para nela.
  const expirado = `${CAPTURE_OUTCOME_PREFIX}12/09 08:30] A proposta expirou sem confirmação: NADA foi registrado.`;
  const hist = h(["assistant", expirado], ["user", "Comi 3 pães franceses"]);
  assertEquals(textForExtraction("E hoje?", hist), "E hoje?");
});


/* ══ O EVENTO SEM `pillar` NÃO PODE SER DESCARTADO ═════════════════════════

   Regressão real, encontrada na varredura de 17/09/2026 e pega tarde: quando
   o campo `pillar` saiu do CAPTURE_TOOL, o caminho de IMAGEM do WhatsApp
   passou a entregar eventos sem ele — e a guarda de saveEventsServer exigia
   `typeof ev.pillar === "string"`. Cada evento era descartado em silêncio,
   DEPOIS de a pessoa ler "Li a foto 📸" e tocar em confirmar.

   É a pior forma de perder captura: o app diz que entendeu, ela confirma, e
   não fica nada — sem erro, sem log, sem nada para ela desconfiar.           */

Deno.test("WhatsApp · foto de prato sem `pillar` é gravada, e com o pilar derivado", async () => {
  const gravados: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        gravados.push(row);
        return Promise.resolve({ error: null });
      },
    }),
    // deno-lint-ignore no-explicit-any
  } as any;

  // Exatamente o que o modelo devolve hoje: sem `pillar`, porque ele saiu do
  // schema. As propostas vêm do caminho de imagem, que não passa pela
  // extração de texto.
  const { saved } = await saveEventsServer(db, "u1", [
    { kind: "meal", summary: "Almoço: arroz e frango", calories: 650 },
    { kind: "workout", summary: "Treino de costas" },
    { kind: "water", summary: "Água: 500 ml", ml: 500 },
    // deno-lint-ignore no-explicit-any
  ] as any);

  assertEquals(saved, 3, "evento sem `pillar` foi descartado em silêncio");
  assertEquals(gravados.map((r) => r.pillar), ["vitalidade", "vitalidade", "vitalidade"]);
});

Deno.test("WhatsApp · o pilar que vem na proposta NÃO vence o kind", async () => {
  /* Proposta guardada ANTES do deploy e confirmada DEPOIS: ela carrega o valor
     legado. O gravador deriva de novo, então a linha entra canônica. */
  const gravados: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        gravados.push(row);
        return Promise.resolve({ error: null });
      },
    }),
    // deno-lint-ignore no-explicit-any
  } as any;

  // deno-lint-ignore no-explicit-any
  await saveEventsServer(db, "u1", [{ kind: "meal", pillar: "alimentacao", summary: "Jantar" }] as any);
  assertEquals(gravados[0].pillar, "vitalidade");
});

Deno.test("WhatsApp · evento sem `kind` continua sendo descartado", () => {
  /* A guarda afrouxou em `pillar`, não em `kind`. `kind` é o que a pessoa
     relatou e o que o pilar é derivado DE — sem ele não há o que gravar. */
  const fonte = Deno.readTextFileSync(new URL("./whatsapp.ts", import.meta.url));
  assert(
    /if \(!ev \|\| typeof ev\.kind !== "string"\) continue;/.test(fonte),
    "a guarda de `kind` saiu junto com a de `pillar`",
  );
});
