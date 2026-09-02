import { describe, it, expect } from "vitest";
import { focusLine, DAILY_FOCUS } from "./dailyFocus";

const estado = (over: Partial<Parameters<typeof focusLine>[0]> = {}) => ({
  eventsToday: 0, pendingHabits: 0, sleepPending: false, weekday: 4, ...over,
});

describe("a linha de foco conhece o estado do dia", () => {
  it("sem nenhum registro, o convite do dia da semana continua valendo", () => {
    expect(focusLine(estado({ weekday: 4 }))).toBe(DAILY_FOCUS[4]);
  });

  it("depois do primeiro registro, PARA de pedir o que já foi feito", () => {
    // Era o bug: quem registrou o gasto às 9h relia "Conte um gasto de hoje"
    // às 20h, na linha mais visível da tela.
    const linha = focusLine(estado({ eventsToday: 1 }));
    expect(linha).not.toBe(DAILY_FOCUS[4]);
  });

  it("o que PERECE vem antes do que a pessoa prometeu", () => {
    const linha = focusLine(estado({ eventsToday: 2, sleepPending: true, pendingHabits: 3 }));
    expect(linha).toContain("noite");
  });

  it("com a noite resolvida, aponta os compromissos pendentes", () => {
    expect(focusLine(estado({ eventsToday: 2, pendingHabits: 1 }))).toBe("Falta um compromisso de hoje.");
    expect(focusLine(estado({ eventsToday: 2, pendingHabits: 3 }))).toBe("Faltam 3 compromissos de hoje.");
  });

  it("nada pendente devolve a tarde para a pessoa — e essa frase é a régua da casa", () => {
    // PRINCIPIOS.md: o Ascende ganha dinheiro quando a vida melhora, nunca
    // quando a pessoa fica mais tempo no app. Se alguém trocar esta frase por
    // um convite a continuar navegando, trocou a régua, não a redação.
    expect(focusLine(estado({ eventsToday: 5 }))).toBe("Dia registrado. Pode fechar o app — a subida é lá fora.");
  });

  it("nenhuma das frases conta dias perdidos, falta acumulada ou cobra explicação", () => {
    const todas = [
      ...DAILY_FOCUS,
      focusLine(estado({ eventsToday: 1, sleepPending: true })),
      focusLine(estado({ eventsToday: 1, pendingHabits: 2 })),
      focusLine(estado({ eventsToday: 1 })),
    ];
    for (const frase of todas) {
      expect(frase).not.toMatch(/faz \d+ dias|você não|há \d+ dias sem|deixou de|abandon|perdeu/i);
    }
  });

  it("dia da semana fora da faixa não quebra a tela", () => {
    expect(focusLine(estado({ weekday: 9 }))).toBe(DAILY_FOCUS[0]);
  });
});
