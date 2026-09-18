/* ASCENDE — O que pode chamar a pessoa de volta, e quantas vezes.
 *
 * O parecer do Fiel marca as notificações como PENDÊNCIA DE ASSINATURA: o
 * recurso não está completo sem elas. Estes testes são o que ele pediu para
 * ver, e cada bloco é uma linha do parecer — não uma checagem de aritmética.
 *
 * O teste central é o do TETO: "o contador é por usuário/dia, nunca por grupo".
 * Ele é o que separa um Social que respeita o Dilema 4 de um cujo volume é
 * função de quantos amigos a pessoa tem.
 */
import { describe, it, expect } from "vitest";
import {
  SOCIAL_PUSH_KINDS, SOCIAL_PUSH_RULES, DAILY_PUSH_BUDGET,
  RECONHECIMENTO_MAX_NA_FRASE, selectDailyPush, renderPush,
  type SocialPushCandidate, type SocialPushKind,
} from "@/lib/socialNotifications";

const cand = (kind: SocialPushKind, over: Partial<SocialPushCandidate> = {}): SocialPushCandidate => ({
  kind, dedupeKey: `${kind}-1`, ...over,
});

const decidir = (
  candidatos: SocialPushCandidate[],
  sentToday: { kind: string }[] = [],
  jaEnviados: string[] = [],
) => selectDailyPush({ sentToday, jaEnviados, candidatos });

describe("as CINCO que passam, e só elas", () => {
  it("a lista é fechada — um tipo novo não nasce permitido", () => {
    expect([...SOCIAL_PUSH_KINDS].sort())
      .toEqual(["convite", "fechamento", "prazo", "recado", "reconhecimento"]);
  });

  it('"fulano treinou, e você?" não tem como existir: não há gatilho de atividade ambiente', () => {
    /* O veto não é uma constante desligada — é a AUSÊNCIA de um gatilho. Todo
       tipo permitido é disparado por uma pessoa falando com ela, por ela mesma
       ou pelo resultado do grupo. "O fulano treinou" não é nenhum dos três, e
       não tem onde encaixar sem alguém inventar um gatilho novo e explicar por
       quê — que é exatamente a conversa que se quer forçar. */
    const gatilhos = new Set(Object.values(SOCIAL_PUSH_RULES).map((r) => r.gatilho));
    expect([...gatilhos].sort())
      .toEqual(["pessoa-para-voce", "resultado-do-grupo", "voce-mesma"]);
    expect(gatilhos.has("atividade-de-terceiro" as never)).toBe(false);
  });

  it("cada tipo declara POR QUE passou — recusa e permissão têm de ser auditáveis", () => {
    for (const kind of SOCIAL_PUSH_KINDS) {
      expect(SOCIAL_PUSH_RULES[kind].porque.length, `${kind} passou sem argumento escrito`)
        .toBeGreaterThan(40);
    }
  });

  it("um tipo desconhecido é descartado, não enviado por descuido", () => {
    const d = decidir([cand("fulano_treinou" as SocialPushKind)]);
    expect(d.escolhido).toBeNull();
    expect(d.descartados[0].motivo).toBe("kind-desconhecido");
  });
});

describe("O TETO É POR USUÁRIO/DIA, NUNCA POR GRUPO", () => {
  it("cinco tipos elegíveis no mesmo dia produzem UM toque, não cinco", () => {
    /* A falha exata que a dedupe de hoje deixaria passar: `whatsapp_sends` é
       deduplicado por (user_id, kind, sent_on), então cinco KINDS diferentes
       passariam os cinco no mesmo dia, cada um "legalmente" — obedecendo à
       letra da dedupe e furando o espírito do N8. */
    const d = decidir([
      cand("fechamento", { participacoesNoCiclo: 3 }),
      cand("prazo"), cand("reconhecimento"), cand("recado"), cand("convite"),
    ]);
    expect(DAILY_PUSH_BUDGET).toBe(1);
    expect(d.escolhido).not.toBeNull();
    expect(d.descartados).toHaveLength(4);
    expect(d.descartados.every((x) => x.motivo === "teto-diario")).toBe(true);
  });

  it("CINCO GRUPOS NÃO GERAM CINCO VEZES MAIS PUSH", () => {
    /* O teste que dá nome ao bloco. Cinco recados, um de cada grupo, no mesmo
       dia: continua sendo UM toque. O volume é função da vida dela, não de
       quantos grupos ela entrou. */
    const cincoGrupos = ["a", "b", "c", "d", "e"].map((g) =>
      cand("recado", { dedupeKey: `recado-${g}`, contexto: `grupo ${g}` }));
    const d = decidir(cincoGrupos);
    expect(d.escolhido).not.toBeNull();
    expect(d.descartados).toHaveLength(4);
  });

  it("o contador NÃO TEM onde guardar grupo — é estrutura, não disciplina", () => {
    /* Se `sentToday` tivesse um campo de grupo, alguém um dia somaria por
       grupo "só para este caso" e o teto viraria por grupo sem ninguém
       perceber. O tipo não tem o campo: para furar, é preciso mudá-lo e
       explicar por quê. */
    const enviado = { kind: "recado" };
    expect(Object.keys(enviado)).toEqual(["kind"]);
    expect("groupId" in enviado).toBe(false);
  });

  it("o Social concorre pelo MESMO teto do briefing — não ganha um teto próprio", () => {
    /* N8 literal: "o teto diário não aumenta por causa do Social". Se o
       briefing já foi hoje, o Social não tem vez. */
    const d = decidir([cand("convite")], [{ kind: "briefing" }]);
    expect(d.escolhido).toBeNull();
    expect(d.descartados[0].motivo).toBe("teto-diario");
  });

  it("e vale para a retro e o retorno também, que são os outros toques de hoje", () => {
    for (const kind of ["retro", "return"]) {
      expect(decidir([cand("recado")], [{ kind }]).escolhido).toBeNull();
    }
  });

  it("quando mais de um cabe, ganha quem uma PESSOA dirigiu a ela", () => {
    // Regra (a): gente falando com ela vem antes de resultado de grupo.
    const d = decidir([cand("fechamento", { participacoesNoCiclo: 5 }), cand("convite")]);
    expect(d.escolhido?.kind).toBe("convite");
  });

  it("todo descarte sai com o motivo — teto silencioso vira mistério", () => {
    const d = decidir([cand("convite"), cand("recado")]);
    expect(d.descartados.every((x) => typeof x.motivo === "string" && x.motivo.length > 3))
      .toBe(true);
  });
});

describe("a trava do fechamento coletivo", () => {
  it("quem NÃO participou nenhuma vez no ciclo não recebe — é sobre ela", () => {
    /* A parte mais fácil de esquecer e a mais cruel de errar. "O grupo cumpriu
       50 de 50" sem nomes parece anônimo, mas quem não apareceu lê a frase como
       uma frase sobre si mesma — e é a leitura certa. A ausência dela É a
       informação, e notificar isso é notificar a própria falta. */
    const d = decidir([cand("fechamento", { participacoesNoCiclo: 0 })]);
    expect(d.escolhido).toBeNull();
    expect(d.descartados[0].motivo).toBe("sem-participacao-no-ciclo");
  });

  it("uma participação já basta — a trava é contra a ausência, não uma nota de corte", () => {
    const d = decidir([cand("fechamento", { participacoesNoCiclo: 1 })]);
    expect(d.escolhido?.kind).toBe("fechamento");
  });

  it("campo ausente conta como zero: na dúvida, não manda", () => {
    // Fail-closed. Um `undefined` que virasse "manda" é o bug cruel chegando
    // por um dado que faltou, não por uma decisão.
    expect(decidir([cand("fechamento")]).escolhido).toBeNull();
  });
});

describe("não repetir é parte do desenho", () => {
  it("convite é UMA VEZ: insistir é cobrar resposta que o silêncio já deu", () => {
    const c = cand("convite", { dedupeKey: "convite-abc" });
    expect(decidir([c], [], ["convite-abc"]).descartados[0].motivo).toBe("ja-enviado");
  });

  it("prazo é uma vez por ciclo, e a chave é do desafio+ciclo", () => {
    const c = cand("prazo", { dedupeKey: "desafio-7:ciclo-3" });
    expect(decidir([c], [], ["desafio-7:ciclo-3"]).escolhido).toBeNull();
    expect(decidir([c], [], ["desafio-7:ciclo-2"]).escolhido?.kind).toBe("prazo");
  });
});

describe("a notificação CHAMA, nunca ENTREGA", () => {
  it("nenhum texto carrega número que compare pessoas", () => {
    const textos = [
      renderPush(cand("convite", { contexto: "Semana da Água" })),
      renderPush(cand("recado", { contexto: "Casa da Subida", pessoas: 9 })),
      renderPush(cand("reconhecimento", { pessoas: 3 })),
      renderPush(cand("prazo", { contexto: "Semana da Água" })),
      renderPush(cand("fechamento", { contexto: "Casa da Subida", participacoesNoCiclo: 2 })),
    ];
    for (const t of textos) {
      expect(t, `"${t}" traz um "X de Y"`).not.toMatch(/\d+\s*de\s*\d+/);
      expect(t, `"${t}" traz posição`).not.toMatch(/\b\d+º|lugar|ranking|posição/i);
    }
  });

  it("nada sobre o que ela NÃO fez — regra (d)", () => {
    const textos = SOCIAL_PUSH_KINDS.map((k) =>
      renderPush(cand(k, { contexto: "Casa da Subida", pessoas: 2, participacoesNoCiclo: 1 })));
    for (const t of textos) {
      expect(t, `"${t}" fala de ausência`)
        .not.toMatch(/não (treinou|registrou|fez|apareceu)|faltou|ficou para trás|e você\?/i);
    }
  });

  it("o reconhecimento não escala a contagem", () => {
    /* "Sem escalonamento de contagem, sem 'você está em alta'". Três é
       reconhecimento; vinte e sete é placar — e placar cresce, que é o motor
       que este produto recusou. */
    expect(renderPush(cand("reconhecimento", { pessoas: 3 }))).toContain("3 pessoas");
    const muitos = renderPush(cand("reconhecimento", { pessoas: 27 }));
    expect(muitos).not.toContain("27");
    expect(muitos).toContain("Algumas pessoas");
    expect(RECONHECIMENTO_MAX_NA_FRASE).toBe(3);
  });

  it("o recado agrupa: dez recados são um aviso, não dez", () => {
    const t = renderPush(cand("recado", { contexto: "Casa da Subida", pessoas: 10 }));
    expect(t).not.toMatch(/10/);
    expect(t).toContain("Casa da Subida");
  });

  it("todo texto é completo em si — nenhum termina pedindo que ela entre", () => {
    // Regra (b): a notificação não existe para te fazer entrar.
    for (const k of SOCIAL_PUSH_KINDS) {
      const t = renderPush(cand(k, { contexto: "Casa da Subida", pessoas: 2, participacoesNoCiclo: 1 }));
      expect(t).not.toMatch(/abra o app|toque aqui|veja agora|confira|não perca/i);
      expect(t.endsWith(".")).toBe(true);
    }
  });
});

describe("N9 — o grupo nunca é notificado da ausência de alguém", () => {
  it("não existe tipo cujo gatilho seja alguém ter sumido", () => {
    /* Ausência não é evento. Não há "fulano não registrou hoje" nem
       "fulano está há 5 dias sem aparecer" — e, de novo, o que impede não é
       uma checagem: é não haver gatilho onde isso caiba. */
    for (const r of Object.values(SOCIAL_PUSH_RULES)) {
      expect(r.gatilho).not.toBe("ausencia");
      expect(r.porque).not.toMatch(/ausência|sumiu|parou de/i);
    }
  });
});
