// ASCENDE — Testes da regra de leitura da memória (Fase 2).
//
// O que está em jogo: uma memória rejeitada ou vencida que escapa para o
// retrato faz o Conselheiro afirmar sobre a vida da pessoa algo que ela já
// negou. O critério de pronto da fase ("corrigi e ele usou a correção no
// turno seguinte") depende inteiramente destas funções.
//
// Módulo puro: nada aqui toca banco, rede ou relógio — `now` entra por
// parâmetro justamente para o teste não depender da hora em que roda.
import { describe, it, expect } from "vitest";
import {
  isMemoryVigente, compareMemoriesForSnapshot, selectMemoriesForSnapshot,
  validateMemoryContent, memoryValidityLabel, validUntilFromPreset, memorySourceLine,
  MEMORY_STATUS_LABEL, MEMORY_CONTENT_MAX, semOrigemTexto,} from "@/lib/memories";

const AGORA = new Date("2026-09-03T12:00:00-03:00");
const ONTEM = "2026-09-02T12:00:00-03:00";
const AMANHA = "2026-09-04T12:00:00-03:00";

describe("isMemoryVigente", () => {
  it("deixa entrar o que está ativo ou confirmado, sem prazo", () => {
    expect(isMemoryVigente({ status: "ativa" }, AGORA)).toBe(true);
    expect(isMemoryVigente({ status: "confirmada", valid_until: null }, AGORA)).toBe(true);
  });

  it("barra o que a pessoa rejeitou", () => {
    expect(isMemoryVigente({ status: "rejeitada" }, AGORA)).toBe(false);
    // Rejeitada com prazo no futuro continua rejeitada: a palavra dela vence.
    expect(isMemoryVigente({ status: "rejeitada", valid_until: AMANHA }, AGORA)).toBe(false);
  });

  it("barra o que já está marcado como expirado", () => {
    expect(isMemoryVigente({ status: "expirada" }, AGORA)).toBe(false);
  });

  it("barra o que passou do prazo, mesmo ainda marcado como ativo", () => {
    // É este caso que mantém "dieta até o casamento de dezembro" fora de
    // março, sem depender de nenhuma varredura ter rodado.
    expect(isMemoryVigente({ status: "ativa", valid_until: ONTEM }, AGORA)).toBe(false);
    expect(isMemoryVigente({ status: "confirmada", valid_until: ONTEM }, AGORA)).toBe(false);
  });

  it("deixa entrar o que ainda está dentro do prazo", () => {
    expect(isMemoryVigente({ status: "ativa", valid_until: AMANHA }, AGORA)).toBe(true);
  });

  it("na dúvida (data ilegível), mantém a memória em vez de sumir com ela", () => {
    expect(isMemoryVigente({ status: "ativa", valid_until: "qualquer coisa" }, AGORA)).toBe(true);
  });
});

describe("compareMemoriesForSnapshot", () => {
  it("põe o confirmado pela pessoa antes do deduzido pela IA", () => {
    const ia = { status: "ativa", created_at: "2026-09-03T10:00:00Z" };
    const pessoa = { status: "confirmada", created_at: "2020-01-01T00:00:00Z" };
    // Mesmo sendo MUITO mais antiga, a memória confirmada vem primeiro.
    expect([ia, pessoa].sort(compareMemoriesForSnapshot)[0]).toBe(pessoa);
  });

  it("dentro do mesmo peso, o mais recente primeiro", () => {
    const velha = { status: "ativa", created_at: "2026-01-01T00:00:00Z" };
    const nova = { status: "ativa", created_at: "2026-09-01T00:00:00Z" };
    expect([velha, nova].sort(compareMemoriesForSnapshot)).toEqual([nova, velha]);
  });
});

describe("selectMemoriesForSnapshot", () => {
  it("filtra e ordena de uma vez — é o que o retrato deve chamar", () => {
    const lista = [
      { id: "a", status: "ativa", created_at: "2026-09-01T00:00:00Z" },
      { id: "b", status: "rejeitada", created_at: "2026-09-02T00:00:00Z" },
      { id: "c", status: "confirmada", created_at: "2026-08-01T00:00:00Z" },
      { id: "d", status: "ativa", created_at: "2026-09-03T00:00:00Z", valid_until: ONTEM },
      { id: "e", status: "ativa", created_at: "2026-09-02T00:00:00Z", valid_until: AMANHA },
    ];
    expect(selectMemoriesForSnapshot(lista, AGORA).map((m) => m.id)).toEqual(["c", "e", "a"]);
  });

  it("não deixa passar nada quando tudo foi negado ou venceu", () => {
    const lista = [
      { id: "a", status: "rejeitada", created_at: "2026-09-01T00:00:00Z" },
      { id: "b", status: "ativa", created_at: "2026-09-01T00:00:00Z", valid_until: ONTEM },
    ];
    expect(selectMemoriesForSnapshot(lista, AGORA)).toEqual([]);
  });
});

describe("validateMemoryContent", () => {
  it("normaliza espaço e aceita o que cabe no banco", () => {
    const r = validateMemoryContent("  Treina   de manhã,\n antes do trabalho ");
    expect(r).toEqual({ ok: true, content: "Treina de manhã, antes do trabalho", error: null });
  });

  it("recusa curto demais e longo demais, com frase para a tela", () => {
    const curto = validateMemoryContent("ok");
    expect(curto.ok).toBe(false);
    expect(curto.error).toBe("Escreva um pouco mais para eu guardar direito.");
    const longo = validateMemoryContent("x".repeat(MEMORY_CONTENT_MAX + 1));
    expect(longo.ok).toBe(false);
    // O limite é o mesmo CHECK do banco: falhar aqui evita um 400 sem sentido.
    expect(longo.error).toContain(String(MEMORY_CONTENT_MAX));
  });

  it("aceita exatamente no limite", () => {
    expect(validateMemoryContent("x".repeat(MEMORY_CONTENT_MAX)).ok).toBe(true);
  });
});

describe("validUntilFromPreset", () => {
  // A conta mora na camada pura para a data da tela e a do banco serem a
  // MESMA: se cada lado calculasse a sua, a tela prometeria 31/12 e o banco
  // guardaria outra coisa.
  it("fim do mês vale o último dia inteiro", () => {
    expect(validUntilFromPreset("fim_do_mes", new Date("2026-09-03T12:00:00-03:00")))
      .toBe("2026-09-30T23:59:59-03:00");
  });

  it("3 e 6 meses contam a partir de hoje", () => {
    const agora = new Date("2026-09-03T12:00:00-03:00");
    expect(validUntilFromPreset("3_meses", agora)).toBe("2026-12-03T23:59:59-03:00");
    expect(validUntilFromPreset("6_meses", agora)).toBe("2027-03-03T23:59:59-03:00");
  });

  it("não inventa 31 de abril: cai no último dia do mês", () => {
    expect(validUntilFromPreset("3_meses", new Date("2026-01-31T12:00:00-03:00")))
      .toBe("2026-04-30T23:59:59-03:00");
  });

  it("o prazo gerado ainda está vigente agora (não nasce vencido)", () => {
    const agora = new Date("2026-09-30T22:00:00-03:00");
    const ate = validUntilFromPreset("fim_do_mes", agora);
    expect(isMemoryVigente({ status: "ativa", valid_until: ate }, agora)).toBe(true);
  });
});

describe("memorySourceLine", () => {
  it("diz de onde veio, com data, e nunca mostra id", () => {
    expect(memorySourceLine({ kind: "chat_message", occurred_at: "2026-08-12T15:00:00-03:00" }))
      .toBe("Do que você contou no Conselheiro · 12/ago");
    expect(memorySourceLine({ kind: "data_source", created_at: "2026-08-12T15:00:00-03:00" }))
      .toBe("De um arquivo que você importou · 12/ago");
  });

  it("sem data legível, mostra só o rótulo", () => {
    expect(memorySourceLine({ kind: "life_event" })).toBe("De um registro no seu diário");
    expect(memorySourceLine({ kind: "life_event", created_at: "nada disso" }))
      .toBe("De um registro no seu diário");
  });

  it("tipo desconhecido não vira uuid na cara da pessoa", () => {
    expect(memorySourceLine({ kind: "sei_la" })).toBe("De algo que você registrou");
  });
});

describe("memoryValidityLabel", () => {
  it("não diz nada quando a memória não tem prazo", () => {
    expect(memoryValidityLabel({ status: "ativa" }, AGORA)).toBeNull();
  });

  it("distingue o que ainda vale do que já valeu", () => {
    expect(memoryValidityLabel({ status: "ativa", valid_until: AMANHA }, AGORA))
      .toBe("Vale até 04/09/2026");
    expect(memoryValidityLabel({ status: "ativa", valid_until: ONTEM }, AGORA))
      .toBe("Valeu até 02/09/2026");
  });
});

describe("MEMORY_STATUS_LABEL", () => {
  it("fala em português de gente, não em nome de coluna", () => {
    expect(MEMORY_STATUS_LABEL.ativa).toBe("Aprendido");
    expect(MEMORY_STATUS_LABEL.confirmada).toBe("Confirmado por você");
    expect(MEMORY_STATUS_LABEL.rejeitada).toBe("Descartado");
    expect(MEMORY_STATUS_LABEL.expirada).toBe("Fora do prazo");
  });
});

/* ═══ "De onde eu tirei isso" não pode inventar a explicação ══════════════
 *
 * Achado de auditoria: quando a conversa produz MEMÓRIA mas nenhum evento,
 * não há mensagem registrada para a origem apontar — e a tela afirmava, para
 * uma memória de segundos atrás, que ela era "anterior ao momento em que
 * passei a guardar de onde cada coisa veio".
 *
 * É falso, e é falso justamente na tela cujo propósito é a pessoa poder
 * CONFERIR o que dizemos sobre ela. Ela não tem como saber que a frase é
 * mentira — e afirmar uma explicação não verificada custa mais confiança do
 * que admitir a falha.
 */
describe("semOrigemTexto", () => {
  it("memória antiga: a explicação da data é verdadeira e pode ser dita", () => {
    expect(semOrigemTexto("2026-08-01T10:00:00Z")).toContain("anterior ao momento");
  });

  it("memória recente: admite que não guardou, sem inventar o motivo", () => {
    const texto = semOrigemTexto("2026-09-10T10:00:00Z");
    expect(texto).not.toContain("anterior ao momento");
    expect(texto).toContain("Não guardei de onde tirei esta");
  });

  it("data ilegível cai no texto que não afirma nada", () => {
    expect(semOrigemTexto("ontem de manhã")).not.toContain("anterior ao momento");
  });
});
