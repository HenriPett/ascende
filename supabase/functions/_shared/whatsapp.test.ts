/* ASCENDE — Testes das regras puras do canal WhatsApp (Deno).
 *
 * Rode com:  deno test --allow-env --allow-net --allow-read supabase/functions/
 *
 * Os dois bugs cobertos aqui foram relatados pelo fundador e têm a mesma
 * assinatura: o sistema afirma para a pessoa algo diferente do que aconteceu.
 * Num, um item que ela DESCARTOU volta a ser proposto; no outro, um sono que
 * ela REGISTROU some da tela Hoje. Os dois moram em funções puras de propósito
 * — é o que permite provar a correção sem banco e sem relógio.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  textForExtraction, sleepWakeDay, CAPTURE_OUTCOME_PREFIX, SHORT_REPLY_CHARS,
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

/* ─── A regra do dia do sono ──────────────────────────────────────────── */

Deno.test("sleepWakeDay · 'ontem dormi 6h' às 7h é a noite que acabou: hoje", () => {
  assertEquals(sleepWakeDay("2026-09-11", "2026-09-12", 7), "2026-09-12");
});

Deno.test("sleepWakeDay · à tarde 'ontem' é ontem mesmo", () => {
  // Depois do meio-dia as duas leituras de "ontem à noite" deixam de
  // colapsar, e chutar seria pior que respeitar o que a pessoa disse.
  assertEquals(sleepWakeDay("2026-09-11", "2026-09-12", 12), "2026-09-11");
  assertEquals(sleepWakeDay("2026-09-11", "2026-09-12", 22), "2026-09-11");
});

Deno.test("sleepWakeDay · anteontem nunca se move", () => {
  assertEquals(sleepWakeDay("2026-09-10", "2026-09-12", 7), "2026-09-10");
});

Deno.test("sleepWakeDay · hoje continua hoje", () => {
  assertEquals(sleepWakeDay("2026-09-12", "2026-09-12", 7), "2026-09-12");
});

Deno.test("sleepWakeDay · atravessa a virada do mês e do ano", () => {
  assertEquals(sleepWakeDay("2026-08-31", "2026-09-01", 6), "2026-09-01");
  assertEquals(sleepWakeDay("2025-12-31", "2026-01-01", 6), "2026-01-01");
  assertEquals(sleepWakeDay("2026-02-28", "2026-03-01", 6), "2026-03-01");
});
