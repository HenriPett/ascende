// ASCENDE — Testes de XP/níveis e da tradução central de eventos.
import { describe, it, expect } from "vitest";
import { levelFromXp, xpForKind, xpReasonLabel, XP_BY_KIND } from "@/lib/xp";
import { kindLabel, eventLabel } from "@/lib/eventLabels";

describe("níveis derivados do XP", () => {
  it("curva √(xp/50)+1: marcos conhecidos", () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(49).level).toBe(1);
    expect(levelFromXp(50).level).toBe(2);
    expect(levelFromXp(200).level).toBe(3);
    expect(levelFromXp(450).level).toBe(4);
  });

  it("progress fica sempre entre 0 e 1", () => {
    for (const xp of [0, 10, 49, 50, 199, 5000]) {
      const { progress } = levelFromXp(xp);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });

  it("xpForKind espelha a tabela do gatilho do banco", () => {
    expect(xpForKind("habit_done")).toBe(10);
    expect(xpForKind("water")).toBe(2);
    expect(xpForKind("tipo_desconhecido")).toBe(3);
    expect(Object.keys(XP_BY_KIND)).toContain("transaction");
  });

  it('xpReasonLabel traduz o legado "Registro: <kind>"', () => {
    expect(xpReasonLabel("Registro: meal")).toBe("Refeição registrada");
    expect(xpReasonLabel("Hábito concluído")).toBe("Hábito concluído");
  });
});

describe("tradução central de tipos de evento (plano §5.2)", () => {
  it("nunca devolve o código interno cru", () => {
    expect(kindLabel("habit_done")).toBe("Hábito concluído");
    expect(kindLabel("battle_checkin")).toBe("Check-in de batalha");
    expect(kindLabel("water")).toBe("Hidratação registrada");
    expect(kindLabel("mood")).toBe("Humor registrado");
    expect(kindLabel("algo_novo_qualquer")).toBe("Registro");
  });

  it("eventLabel prefere o conteúdo do payload e cai para a tradução", () => {
    expect(eventLabel("journal", { text: "Dia bom" })).toBe("Dia bom");
    expect(eventLabel("mood", { summary: "Humor: ótimo" })).toBe("Humor: ótimo");
    expect(eventLabel("habit_done", {})).toBe("Hábito concluído");
    expect(eventLabel("habit_done", null)).toBe("Hábito concluído");
  });
});
