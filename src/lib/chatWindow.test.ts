import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { chatInReadingOrder, CHAT_WINDOW, type ChatRow } from "./chatWindow";

const msg = (role: "user" | "assistant", content: string, created_at: string): ChatRow =>
  ({ role, content, created_at });

/** Um turno real: pergunta e resposta gravadas no MESMO insert, e por isso
 *  com o mesmo `created_at` — `now()` é o horário da transação. */
const turno = (pergunta: string, resposta: string, t: string): ChatRow[] =>
  [msg("user", pergunta, t), msg("assistant", resposta, t)];

describe("a janela da conversa olha para o FIM", () => {
  it("devolve a conversa na ordem de leitura, mais antiga primeiro", () => {
    const janela = [
      ...turno("primeira", "resposta 1", "2026-09-01T10:00:00Z"),
      ...turno("segunda", "resposta 2", "2026-09-02T10:00:00Z"),
    ];
    expect(chatInReadingOrder(janela).map((m) => m.content))
      .toEqual(["primeira", "resposta 1", "segunda", "resposta 2"]);
  });

  it("o banco devolve do mais NOVO para o mais velho — e a tela mostra ao contrário", () => {
    // É assim que a linha chega: `.order("created_at", { ascending: false })`
    // é a única forma de pedir "as últimas N" ao Postgres.
    const comoOBancoDevolve = [
      ...turno("recente", "resposta nova", "2026-09-16T10:00:00Z"),
      ...turno("antiga", "resposta velha", "2026-09-01T10:00:00Z"),
    ];
    expect(chatInReadingOrder(comoOBancoDevolve).map((m) => m.content))
      .toEqual(["antiga", "resposta velha", "recente", "resposta nova"]);
  });

  it("empate de created_at: a PERGUNTA vem antes da resposta, venha como vier", () => {
    // O risco que a correção trouxe junto. As duas linhas nascem no mesmo
    // insert, com o mesmo carimbo. Se a ordem do empate viesse do banco,
    // inverter para `descending` poria a resposta ACIMA da pergunta.
    const t = "2026-09-16T10:00:00Z";
    for (const entrada of [
      [msg("user", "p", t), msg("assistant", "r", t)],
      [msg("assistant", "r", t), msg("user", "p", t)],  // invertido
    ]) {
      expect(chatInReadingOrder(entrada).map((m) => m.role)).toEqual(["user", "assistant"]);
    }
  });

  it("vários turnos no mesmo segundo continuam cada um com sua resposta", () => {
    const a = "2026-09-16T10:00:00Z";
    const b = "2026-09-16T10:00:01Z";
    const embaralhado = [
      msg("assistant", "r2", b), msg("user", "p1", a),
      msg("assistant", "r1", a), msg("user", "p2", b),
    ];
    expect(chatInReadingOrder(embaralhado).map((m) => m.content))
      .toEqual(["p1", "r1", "p2", "r2"]);
  });

  it("não altera o array que recebeu — a lista da tela é do React", () => {
    const original = [msg("assistant", "r", "2026-09-16T10:00:01Z"), msg("user", "p", "2026-09-16T10:00:00Z")];
    const copia = [...original];
    chatInReadingOrder(original);
    expect(original).toEqual(copia);
  });

  it("linha sem created_at não quebra a ordenação", () => {
    // Mensagem otimista local nunca passa por aqui, mas um registro antigo
    // sem carimbo não pode derrubar a conversa inteira.
    const r = chatInReadingOrder([
      { role: "assistant", content: "com carimbo", created_at: "2026-09-16T10:00:00Z" },
      { role: "user", content: "sem carimbo" },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].content).toBe("sem carimbo");
  });
});

/* ─────────────────────────────────────────────────────────────────
   A TRAVA CONTRA O BUG VOLTAR

   O defeito não estava na ordenação: estava em UMA PALAVRA da consulta.
   `ascending: true` com `limit` corta pelo começo — "as 200 primeiras",
   uma janela que nunca anda. Nenhum teste de função pura pega isso,
   porque o erro mora na chamada. Então o teste lê a chamada.
────────────────────────────────────────────────────────────────── */
describe("a consulta do histórico pede as ÚLTIMAS mensagens", () => {
  const chat = readFileSync(new URL("../pages/Chat.tsx", import.meta.url), "utf8");
  const consulta = chat.slice(
    chat.indexOf('supabase.from("chat_messages")'),
    chat.indexOf(";", chat.indexOf('supabase.from("chat_messages")')),
  );

  it("ordena do mais novo para o mais velho — nunca o contrário", () => {
    expect(consulta).toContain('.order("created_at", { ascending: false })');
    expect(consulta).not.toContain("ascending: true");
  });

  it("o limite é a janela que cresce, nunca um número cravado na consulta", () => {
    expect(consulta).toContain("limit(windowSize)");
    expect(consulta).not.toMatch(/limit\(\d+\)/);
    expect(CHAT_WINDOW).toBeGreaterThanOrEqual(50);
    expect(CHAT_WINDOW).toBeLessThanOrEqual(500);
  });

  it("a janela entra na chave do cache — senão crescer não refaz a busca", () => {
    // `windowSize` fora do queryKey é o erro clássico: o botão "ver
    // anteriores" mudaria o estado, o TanStack devolveria o cache antigo e
    // nada apareceria. O sintoma seria o mesmo do bug original.
    expect(chat).toContain('queryKey: ["chat", user?.id, windowSize]');
  });

  it("traz o created_at, senão o desempate do par não tem por onde acontecer", () => {
    expect(consulta).toContain("created_at");
  });
});
