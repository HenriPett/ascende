// ASCENDE — Testes de quando perguntar "isso te ajudou?".
import { describe, it, expect } from "vitest";
import { canAskFeedback, pickFeedbackTarget } from "@/lib/insightFeedback";
import type { Insight, InsightKind } from "@/lib/insights";

/** Insight mínimo, só com o que a regra olha. */
const fake = (kind: InsightKind, status: Insight["status"]): Insight =>
  ({ kind, status, calc_version: "insights/1", sample_size: 30, period: null,
    labels: { left: "", right: "" } } as unknown as Insight);

describe("canAskFeedback", () => {
  it("pergunta quando houve tendência", () => {
    expect(canAskFeedback("tendencia")).toBe(true);
  });

  it("NÃO pergunta em 'sem_tendencia', apesar de o card dizer algo útil", () => {
    /* Decisão do fundador, e o motivo é a MEDIDA, não o valor da resposta:
       misturar os dois estados faria a medida 4 somar duas perguntas
       diferentes ("o padrão te ajudou?" e "saber que não há padrão te
       ajudou?"), e um número que soma duas perguntas não decide nada.
       Este teste existe para a reversão ser deliberada: quem trocar isto tem
       que passar por aqui e ler o porquê. */
    expect(canAskFeedback("sem_tendencia")).toBe(false);
  });

  it("NUNCA pergunta em 'ainda não dá para dizer'", () => {
    // Ali não ajudou nem tentou ajudar: a resposta não mediria nada, e a
    // pergunta soaria como cobrança por registrar mais.
    expect(canAskFeedback("dados_insuficientes")).toBe(false);
  });
});

describe("pickFeedbackTarget — uma pergunta por vez", () => {
  const comTendencia = fake("sono_gasto_seguinte", "tendencia");
  const semTendencia = fake("refeicao_gasto_comida", "sem_tendencia");
  const semDados = fake("treino_sono", "dados_insuficientes");

  const outraTendencia = fake("refeicao_gasto_comida", "tendencia");

  it("escolhe a primeira elegível, nunca duas", () => {
    const alvo = pickFeedbackTarget([comTendencia, outraTendencia, semDados], new Set());
    expect(alvo).toBe("sono_gasto_seguinte");
  });

  it("pula quem já foi perguntado — respondeu ou ignorou, tanto faz", () => {
    const alvo = pickFeedbackTarget(
      [comTendencia, outraTendencia, semDados], new Set(["sono_gasto_seguinte"]),
    );
    expect(alvo).toBe("refeicao_gasto_comida");
  });

  it("não pergunta nada quando só há cards sem dados", () => {
    expect(pickFeedbackTarget([semDados], new Set())).toBeNull();
  });

  it("pula cards de 'sem_tendencia' na escolha do alvo", () => {
    expect(pickFeedbackTarget([semTendencia, semDados], new Set())).toBeNull();
    expect(pickFeedbackTarget([semTendencia, comTendencia], new Set()))
      .toBe("sono_gasto_seguinte");
  });

  it("não pergunta nada quando todas as elegíveis já foram perguntadas", () => {
    const alvo = pickFeedbackTarget(
      [comTendencia, outraTendencia, semDados],
      new Set(["sono_gasto_seguinte", "refeicao_gasto_comida"]),
    );
    expect(alvo).toBeNull();
  });

  it("lista vazia não pergunta", () => {
    expect(pickFeedbackTarget([], new Set())).toBeNull();
  });

  it("é estável: a mesma entrada devolve sempre a mesma análise", () => {
    // Sem isto, a pergunta pularia de card entre dois carregamentos da tela.
    const lista = [semTendencia, comTendencia, semDados];
    const a = pickFeedbackTarget(lista, new Set());
    const b = pickFeedbackTarget(lista, new Set());
    expect(a).toBe(b);
    expect(a).toBe("sono_gasto_seguinte");
  });
});
