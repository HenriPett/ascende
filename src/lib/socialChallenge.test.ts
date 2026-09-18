/* ASCENDE — "A Semana Inteira" e o placar que não ordena ninguém.
 *
 * Duas regras deste arquivo são de ÉTICA, não de aritmética, e é por isso que
 * elas têm teste próprio em vez de confiarem no bom senso de quem mexer:
 *
 *   • o dia inteiro é 3 de 4, e a folga é proporcional a quantos sinais a
 *     pessoa acompanha — quem desligou um tracker não fica de fora do desafio
 *     por causa de uma escolha de privacidade;
 *   • ninguém é ordenado por desempenho, e a barra coletiva só aparece com k
 *     mínimo de 4 consentimentos, senão num grupo de 3 qualquer um deduz o
 *     terceiro por subtração.
 */
import { describe, it, expect } from "vitest";
import {
  FULL_DAY_SIGNALS, WEEK_DAYS_PER_PERSON, COLLECTIVE_MIN_CONSENTS,
  fullDayThreshold, isFullDay, countFullDays, groupWeekGoal, weekScoreboard, canBeRanked,
  type MemberTotals, type SocialSignal,
} from "@/lib/socialChallenge";

const dia = (tracked: SocialSignal[], done: SocialSignal[]) => ({ tracked, done });
const QUATRO: SocialSignal[] = ["workout", "sleep", "meal", "water"];

describe("a unidade: um DIA INTEIRO é 3 de 4", () => {
  it("os quatro sinais saem da composição declarada no catálogo", () => {
    // Não de uma segunda lista escrita à mão aqui: duas listas viram duas
    // verdades, e a que o Fiel auditou é a do catálogo.
    expect([...FULL_DAY_SIGNALS].sort()).toEqual(["meal", "sleep", "water", "workout"]);
  });

  it("três de quatro FECHA o dia — o dia de descanso ainda conta", () => {
    expect(isFullDay(dia(QUATRO, ["sleep", "meal", "water"]))).toBe(true);
    expect(isFullDay(dia(QUATRO, ["workout", "sleep", "meal"]))).toBe(true);
  });

  it("dois de quatro não fecha", () => {
    expect(isFullDay(dia(QUATRO, ["sleep", "meal"]))).toBe(false);
  });

  it("NÃO é 4 de 4 — e este teste é a regra, não a implementação", () => {
    /* Se alguém "corrigir" para exigir os quatro, o desafio passa a punir o
       descanso: exatamente o que a regra 2 do Mokari proíbe no espelho, e não
       há motivo para o Social ser mais duro que o espelho. */
    expect(fullDayThreshold(4)).toBe(3);
    expect(fullDayThreshold(4)).not.toBe(4);
  });

  it("quem desligou um tracker conta 2 de 3, e não fica de fora", () => {
    /* A folga é PROPORCIONAL. Quem desligou água acompanha três sinais e fecha
       o dia com dois — se o limiar continuasse em 3, uma escolha de
       privacidade viraria eliminação silenciosa do desafio. */
    const tres: SocialSignal[] = ["workout", "sleep", "meal"];
    expect(fullDayThreshold(3)).toBe(2);
    expect(isFullDay(dia(tres, ["workout", "sleep"]))).toBe(true);
    expect(isFullDay(dia(tres, ["workout"]))).toBe(false);
  });

  it("com um sinal só, o limiar tem piso em 1 — nunca em zero", () => {
    // `tracked − 1` daria zero, e um dia inteiro sem registro nenhum tornaria
    // o desafio uma mentira educada.
    expect(fullDayThreshold(1)).toBe(1);
    expect(isFullDay(dia(["sleep"], []))).toBe(false);
    expect(isFullDay(dia(["sleep"], ["sleep"]))).toBe(true);
  });

  it("sem sinal nenhum acompanhado não há dia inteiro — e isso é a verdade", () => {
    expect(fullDayThreshold(0)).toBe(0);
    expect(isFullDay(dia([], []))).toBe(false);
  });

  it("sinal fora do desafio não fecha dia — gratidão não é 'a semana inteira'", () => {
    const comGratidao = { tracked: [...QUATRO, "gratitude"] as SocialSignal[], done: ["gratitude", "sleep", "meal"] as SocialSignal[] };
    // Conta os três do desafio que ela acompanha... não: só sleep e meal são do
    // desafio, então são 2 de 4 e o dia não fecha.
    expect(isFullDay(comGratidao)).toBe(false);
  });

  it("registrar o mesmo sinal duas vezes não fecha o dia sozinho", () => {
    expect(isFullDay(dia(QUATRO, ["water", "water", "water"]))).toBe(false);
  });

  it("countFullDays soma os dias que fecharam", () => {
    expect(countFullDays([
      dia(QUATRO, ["workout", "sleep", "meal"]),
      dia(QUATRO, ["sleep"]),
      dia(QUATRO, QUATRO),
    ])).toBe(2);
  });
});

describe("a meta do grupo: pessoas × 5, com as folgas embutidas", () => {
  it("cinco dias por pessoa, não sete", () => {
    expect(WEEK_DAYS_PER_PERSON).toBe(5);
    expect(groupWeekGoal(4)).toBe(20);
  });

  it("os dois dias de folga por pessoa JÁ ESTÃO na meta", () => {
    // A regra do descanso aplicada no nível do grupo, não como perdão
    // excepcional concedido depois a quem pedir.
    const pessoas = 4;
    expect(groupWeekGoal(pessoas)).toBe(pessoas * 7 - pessoas * 2);
  });

  it("grupo vazio tem meta zero, e número maluco não vira meta negativa", () => {
    expect(groupWeekGoal(0)).toBe(0);
    expect(groupWeekGoal(-3)).toBe(0);
    expect(groupWeekGoal(NaN)).toBe(0);
  });
});

/* ── O placar ────────────────────────────────────────────────────────── */

const m = (memberId: string, name: string, done: number, goal: number, joinedAt?: string): MemberTotals =>
  ({ memberId, name, done, goal, joinedAt });

const CINCO = [
  m("u3", "Zuleica", 5, 5, "2026-01-01"),
  m("u1", "Ana", 2, 4, "2026-01-02"),
  m("u2", "Bruno", 4, 4, "2026-01-03"),
  m("u4", "Carla", 1, 3, "2026-01-04"),
  m("u5", "Davi", 3, 3, "2026-01-05"),
];

describe("o placar não ordena ninguém por desempenho", () => {
  it("a ordem padrão é alfabética, e NÃO é a do desempenho", () => {
    const { lines } = weekScoreboard({ members: CINCO, viewerId: "u1", consentCount: 5 });
    expect(lines.map((l) => l.name)).toEqual(["Ana", "Bruno", "Carla", "Davi", "Zuleica"]);

    // A prova de que não é ranking: Zuleica fez 5 e chega por último; Carla fez
    // 1 e chega no meio. Soma é monotônica em presença — todo ranking de soma
    // é um ranking de frequência disfarçado.
    const porDesempenho = [...CINCO].sort((a, b) => b.done - a.done).map((x) => x.name);
    expect(lines.map((l) => l.name)).not.toEqual(porDesempenho);
  });

  it("por entrada é a outra ordem permitida — e também não é desempenho", () => {
    const { lines } = weekScoreboard({
      members: CINCO, viewerId: "u1", consentCount: 5, order: "entrada",
    });
    expect(lines.map((l) => l.name)).toEqual(["Zuleica", "Ana", "Bruno", "Carla", "Davi"]);
  });

  it("nomes iguais desempatam por id, nunca por número", () => {
    /* O ranking voltando pela porta dos fundos: um desempate por `done` faria
       a lista ser ordinal toda vez que dois nomes coincidissem. */
    const homonimos = [m("u2", "Ana", 5, 5), m("u1", "Ana", 0, 5)];
    const { lines } = weekScoreboard({ members: homonimos, viewerId: "u1", consentCount: 4 });
    expect(lines.map((l) => l.memberId)).toEqual(["u1", "u2"]);
  });

  it("cada linha é contra a META DELA, nunca um número absoluto comparável", () => {
    /* A verdade que o ordinal apaga: quem combinou 3 e cumpriu aparece
       COMPLETO ao lado de quem combinou 5. Premia honestidade de meta, não
       tempo livre nem dinheiro — ou seja, não pune a nossa cliente. */
    const { lines } = weekScoreboard({ members: CINCO, viewerId: "u1", consentCount: 5 });
    const davi = lines.find((l) => l.name === "Davi")!;
    const zuleica = lines.find((l) => l.name === "Zuleica")!;
    expect(davi).toMatchObject({ done: 3, goal: 3 });      // completo
    expect(zuleica).toMatchObject({ done: 5, goal: 5 });   // completo também
  });

  it("a linha não carrega percentual nem denominador de janela", () => {
    /* "Religar deixa um buraco" protege o dado e denuncia a pessoa: um vão de 3
       a 20 de setembro é lido pelo grupo como "aconteceu alguma coisa ali", e o
       controle de privacidade vira sinal social. A tela nunca mostra o
       denominador da janela de terceiro, nem percentual que permita derivá-lo. */
    const { lines } = weekScoreboard({ members: CINCO, viewerId: "u1", consentCount: 5 });
    expect(Object.keys(lines[0]).sort())
      .toEqual(["done", "goal", "isViewer", "memberId", "name"]);
  });

  it("a saída NUNCA contém série diária de terceiro", () => {
    /* O calendário de bolinhas de outra pessoa é o artefato de vergonha mais
       eficiente desta categoria de app. Aqui ele não é recusado por uma regra
       que alguém precisa lembrar: não existe onde ele caber. */
    const { lines } = weekScoreboard({ members: CINCO, viewerId: "u1", consentCount: 5 });
    for (const linha of lines) {
      for (const [campo, valor] of Object.entries(linha)) {
        expect(Array.isArray(valor), `${campo} é uma lista — série diária vazou`).toBe(false);
        expect(typeof valor === "object" && valor !== null, `${campo} é um objeto aninhado`)
          .toBe(false);
      }
    }
    // E a linha inteira, serializada, não tem um único colchete: nenhum array
    // aninhado em profundidade nenhuma.
    for (const linha of lines) {
      expect(JSON.stringify(linha)).not.toMatch(/\[/);
    }
  });
});

describe("o k mínimo: agregado não é anônimo em grupo pequeno", () => {
  it("com 4 consentimentos a barra coletiva aparece", () => {
    expect(COLLECTIVE_MIN_CONSENTS).toBe(4);
    const r = weekScoreboard({ members: CINCO.slice(0, 4), viewerId: "u1", consentCount: 4 });
    expect(r.collective).toEqual({ done: 12, goal: 16 });
    expect(r.collectiveHiddenReason).toBeNull();
  });

  it("com 3, a barra some E as linhas dos outros também", () => {
    /* Esconder só a barra deixaria a dedução de pé pelo outro lado: com as
       linhas individuais à vista, o total sai de uma soma. Abaixo do k, cada um
       vê só o próprio número. */
    const r = weekScoreboard({ members: CINCO.slice(0, 3), viewerId: "u1", consentCount: 3 });
    expect(r.collective).toBeNull();
    expect(r.lines.map((l) => l.memberId)).toEqual(["u1"]);
    expect(r.lines[0].isViewer).toBe(true);
  });

  it("a barra escondida DIZ por que — omissão sem motivo a pessoa lê como bug", () => {
    const r = weekScoreboard({ members: CINCO.slice(0, 3), viewerId: "u1", consentCount: 3 });
    expect(r.collectiveHiddenReason).toBe("k-minimo");
  });

  it("o k conta CONSENTIMENTOS, não tamanho do grupo", () => {
    /* Quem está no grupo mas não compartilha aquela métrica não protege
       ninguém: ele não entra na soma, então não atrapalha a subtração. */
    const r = weekScoreboard({ members: CINCO, viewerId: "u1", consentCount: 3 });
    expect(r.collective).toBeNull();
    expect(r.lines).toHaveLength(1);
  });

  it("quem olha sempre vê a própria linha, mesmo sozinho no grupo", () => {
    const r = weekScoreboard({ members: [m("u1", "Ana", 2, 4)], viewerId: "u1", consentCount: 1 });
    expect(r.lines).toHaveLength(1);
    expect(r.collective).toBeNull();
  });
});

describe("métrica que nunca pode ser ordenada", () => {
  it("gratidão fica no catálogo, mas nunca em ranking", () => {
    // Ressalva do Fiel: contagem pura, nunca ordenada.
    expect(canBeRanked("gratidao_registrada")).toBe(false);
    expect(canBeRanked("treino_registrado")).toBe(true);
  });

  it("o que não é compartilhável também não é ordenável", () => {
    expect(canBeRanked("peso_registrado")).toBe(false);
    expect(canBeRanked("humor_registrado")).toBe(false);
  });
});
