/* ASCENDE — A regra C do Fiel, provada linha a linha.
 *
 * O que estes testes travam é a diferença entre NULL e 0, que é a diferença
 * entre "não há direito ao número" e "há direito, e ele é zero". Colapsar os
 * dois é o erro mais fácil de cometer aqui — `feito ?? 0` é UM caractere — e é
 * também o mais caro: escreve zero ao lado do nome de quem só não compartilha.
 */
import { describe, it, expect } from "vitest";
import {
  linhaDaSemana, semanasDoCiclo, metaDoCiclo, diasEntre,
  porNomeDoGrupo, tintaDaMetrica, diaLocal, proximaViradaDeDia,
} from "@/lib/socialSemana";

describe("regra C — quem aparece, com que número", () => {
  it("feito NULL some da métrica: nunca vira zero, nunca vira 'sem registro'", () => {
    expect(linhaDaSemana({ feito: null, combinado: 6 })).toEqual({ tipo: "oculta" });
    expect(linhaDaSemana({ feito: null, combinado: null })).toEqual({ tipo: "oculta" });
  });

  it("feito 0 com meta declarada é '0 de 6', para todos — inclusive terceiros", () => {
    expect(linhaDaSemana({ feito: 0, combinado: 6 }))
      .toEqual({ tipo: "contagem", feito: 0, meta: 6, cumpriu: false });
  });

  it("o denominador é a meta DELA, e o cumprimento é contra ela", () => {
    expect(linhaDaSemana({ feito: 5, combinado: 5 }))
      .toEqual({ tipo: "contagem", feito: 5, meta: 5, cumpriu: true });
    expect(linhaDaSemana({ feito: 1, combinado: 6 }))
      .toEqual({ tipo: "contagem", feito: 1, meta: 6, cumpriu: false });
  });

  it("consentida sem meta não ganha denominador inventado (A.4)", () => {
    expect(linhaDaSemana({ feito: 0, combinado: null }))
      .toEqual({ tipo: "sem-meta", texto: "sem registro" });
    expect(linhaDaSemana({ feito: 3, combinado: null }))
      .toEqual({ tipo: "sem-meta", texto: "sem meta combinada" });
  });

  it("'sem registro' NUNCA sai para quem tem meta — nem com zero feito", () => {
    /* A frase é reservada a um caso só. Se ela vazar para o zero-com-meta, a
       tela volta a acusar ausência exatamente onde o parecer mandou situar. */
    for (const feito of [0, 1, 4, 9]) {
      const l = linhaDaSemana({ feito, combinado: 6 });
      expect(l.tipo).toBe("contagem");
    }
  });
});

describe("a geometria saiu, e sair é o conserto", () => {
  it("o módulo não exporta mais escala de recipiente nenhuma", async () => {
    /* A trilha de bolinhas ordenava as pessoas antes de qualquer número ser
       lido: numa coluna só, as trilhas da mesma métrica começam no mesmo x, e
       o comprimento do bloco cheio é canal pré-atento. Se alguém reintroduzir
       uma escala aqui, este teste cai — e o teste para quem for fazer isso é o
       do Adendo 2: dá para ordenar as pessoas em menos de um segundo, sem ler?
       Se dá, é régua, e régua comum entre pessoas está vetada. */
    const mod = await import("@/lib/socialSemana");
    for (const proibido of ["formaDaTrilha", "MAX_DOTS", "PX_POR_META", "LARGURA_MAXIMA"]) {
      expect(proibido in mod, `${proibido} voltou — ver o Adendo 2 do parecer`).toBe(false);
    }
  });
});

describe("o período da meta — a barra que aparecia 4x cheia", () => {
  it("conta os dias do ciclo de forma inclusiva", () => {
    expect(diasEntre("2026-09-14", "2026-09-20")).toBe(7);
    expect(diasEntre("2026-09-14", "2026-09-14")).toBe(1);
    expect(diasEntre("nada", "2026-09-20")).toBeNull();
  });

  it("um ciclo de quatro semanas pede quatro vezes a meta semanal", () => {
    expect(semanasDoCiclo("2026-09-14", "2026-10-11")).toBe(4);
    expect(metaDoCiclo(5, "2026-09-14", "2026-10-11")).toBe(20);
  });

  it("uma semana é uma semana, e um ciclo curto não encolhe a meta", () => {
    expect(metaDoCiclo(5, "2026-09-14", "2026-09-20")).toBe(5);
    expect(metaDoCiclo(5, "2026-09-14", "2026-09-16")).toBe(5);
  });

  it("arredonda para CIMA, igual ao `ceil(dias/7.0)` do banco", () => {
    /* As duas pontas têm de arredondar igual: meia semana de diferença faria
       a barra do grupo (que vem do SQL) e a linha da pessoa (calculada aqui)
       discordarem na mesma tela, sobre o mesmo ciclo. E o `ceil` erra para
       "não encheu", nunca para o mérito falso. */
    expect(semanasDoCiclo("2026-09-01", "2026-09-30")).toBe(5);
    expect(semanasDoCiclo("2026-09-14", "2026-09-24")).toBe(2);
  });

  it("data inválida não vira ciclo de duração zero", () => {
    expect(semanasDoCiclo("", "")).toBe(1);
    expect(metaDoCiclo(5, "", "")).toBe(5);
  });
});

describe("a ordem não diz nada sobre ninguém", () => {
  it("é alfabética, e o desempate é por id — nunca por desempenho", () => {
    const gente = [
      { userId: "z", nome: "Bruno" },
      { userId: "a", nome: "Ana" },
      { userId: "b", nome: "Ana" },
    ];
    expect([...gente].sort(porNomeDoGrupo).map((p) => p.userId)).toEqual(["a", "b", "z"]);
  });
});

describe("a tinta sai do catálogo, não de uma segunda lista", () => {
  it("gratidão é mente, o resto é vitalidade, e a composta não veste pilar", () => {
    expect(tintaDaMetrica("gratidao_registrada", false, "gratitude")).toBe("text-mente-ink");
    expect(tintaDaMetrica("treino_registrado", false, "workout")).toBe("text-vitalidade-ink");
    expect(tintaDaMetrica("dia_inteiro", true)).toBe("text-foreground/85");
  });
});

describe("o dia é o do PRODUTO, nunca o do aparelho", () => {
  /* O banco decide o dia com `hoje_sp()`. Se o front lesse o fuso do
     dispositivo, as duas pontas só coincidiriam dentro de BRT — e fora dela
     sumia o "voltou hoje", sumia o "3 de 6" de todas as linhas do feed, o
     rótulo "hoje" caía no dia errado e um desafio vivo aparecia encerrado.
     Estes testes fixam instantes UTC, então valem em qualquer máquina que os
     rode: é o fuso de SÃO PAULO que decide, não o de quem roda o teste. */

  it("22h em São Paulo ainda é o mesmo dia (em UTC já é o seguinte)", () => {
    // 2026-09-18T22:30 em SP = 2026-09-19T01:30Z
    expect(diaLocal(new Date("2026-09-19T01:30:00Z"))).toBe("2026-09-18");
  });

  it("logo depois da meia-noite em São Paulo o dia virou", () => {
    // 2026-09-19T00:10 em SP = 2026-09-19T03:10Z
    expect(diaLocal(new Date("2026-09-19T03:10:00Z"))).toBe("2026-09-19");
  });

  it("meio-dia em São Paulo é o dia óbvio", () => {
    expect(diaLocal(new Date("2026-09-18T15:00:00Z"))).toBe("2026-09-18");
  });

  it("a virada agendada cai DEPOIS da meia-noite de São Paulo, e no dia novo", () => {
    const agora = new Date("2026-09-19T01:30:00Z");          // 22:30 em SP
    const virada = proximaViradaDeDia(agora);
    expect(virada.getTime()).toBeGreaterThan(agora.getTime());
    expect(diaLocal(virada)).toBe("2026-09-19");
    // e não muito longe: ~1h30 depois, não 24h
    expect(virada.getTime() - agora.getTime()).toBeLessThan(2 * 3600_000);
  });

  it("logo depois da virada, a próxima é a de amanhã — o timer não dispara em laço", () => {
    const agora = new Date("2026-09-19T03:00:05Z");          // 00:00:05 em SP
    const virada = proximaViradaDeDia(agora);
    expect(diaLocal(virada)).toBe("2026-09-20");
    expect(virada.getTime() - agora.getTime()).toBeGreaterThan(20 * 3600_000);
  });
});
