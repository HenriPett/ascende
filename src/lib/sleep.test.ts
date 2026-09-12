// ASCENDE — A rotina de sono (matemática pura da janela).
//
// A REGRA DO DIA DE UM REGISTRO DE SONO não é testada aqui: ela vive na
// extração (supabase/functions/_shared/lib.ts) e tem teste no runner do Deno,
// em _shared/lib.test.ts. Ver o comentário ao final de sleep.ts para o porquê.
import { describe, it, expect } from "vitest";
import { sleepWindowHours, parseTimeToMinutes } from "@/lib/sleep";

describe("sleepWindowHours", () => {
  it("trata a virada da meia-noite", () => {
    expect(sleepWindowHours("23:00", "06:30")).toBe(7.5);
    expect(sleepWindowHours("01:00", "09:00")).toBe(8);
  });

  it("horários iguais ou inválidos não viram duração", () => {
    expect(sleepWindowHours("23:00", "23:00")).toBeNull();
    expect(sleepWindowHours(null, "06:30")).toBeNull();
    expect(parseTimeToMinutes("25:00")).toBeNull();
  });
});
