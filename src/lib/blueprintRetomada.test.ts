/* ASCENDE — O Blueprint que não se perde ao recarregar.
 *
 * O defeito: a proposta vivia só em `useState`. Recarregar depois de gerar
 * perdia a proposta E a cortesia (a função respondia `409 already` para
 * sempre). Agora ela mora no banco, e estas funções decidem o que a tela faz
 * com a linha guardada. O que cada teste trava está escrito nele — e o mais
 * importante é o primeiro bloco: a MESMA proposta e as MESMAS escolhas voltam
 * depois de recarregar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  retomadaDaLinha, retomadaDaResposta, normalizeChoices, defaultChoices,
  parseActivationResult, interpretarAtivacao, resumoDaAtivacao, goalKeysFor,
  proximoPassoDaEspera, isBlueprintProposal, TETO_DA_ESPERA_MS,
  itensEfetivos, contaComoRetomada,
  type BlueprintProposal,
} from "@/lib/blueprint";

const PROPOSTA: BlueprintProposal = {
  overview: "Comer melhor sem estourar o mês.",
  plans: [
    { kind: "alimentar", pillar: "vitalidade", title: "Comida", content_markdown: "## Resumo" },
    { kind: "treino", pillar: "vitalidade", title: "Treino", content_markdown: "## Resumo" },
    { kind: "financeiro", pillar: "prosperidade", title: "Bolso", content_markdown: "## Resumo" },
  ],
  daily_calories_kcal: 2100, daily_protein_g: 120, weekly_workouts: 3,
  sleep_hours_target: 7.5, daily_spend_limit: 60, water_goal_ml: 2000,
  habits: [{ name: "Beber água", pillar: "vitalidade" }, { name: "Anotar gastos", pillar: "prosperidade" }],
  assumptions: [],
};

describe("recarregar devolve a MESMA proposta e as MESMAS escolhas", () => {
  const escolhidas = { plans: [false, true, false], habits: [true, false], goals: false };
  const linha = {
    status: "ready", proposal: PROPOSTA, choices: escolhidas,
    choices_updated_at: "2026-10-13T12:00:00Z",
  };

  it("a linha `ready` vira a proposta pronta, com as escolhas que a pessoa fez", () => {
    const r = retomadaDaLinha(linha, 1);
    expect(r.kind).toBe("pronta");
    if (r.kind !== "pronta") return;
    expect(r.proposal).toEqual(PROPOSTA);
    expect(r.choices).toEqual(escolhidas);
    // Escolhas inteiras e já salvas: a tela não regrava nada ao hidratar.
    expect(r.escolhasIntactas).toBe(true);
  });

  it("a retomada pela função (`resumed:true`) dá o mesmo resultado que a linha", () => {
    const r = retomadaDaResposta({ status: "ready", blueprint: PROPOSTA, choices: escolhidas, resumed: true }, 1);
    expect(r).toEqual(retomadaDaLinha(linha, 1));
  });

  it("a cota NÃO sobrescreve o que a pessoa já escolheu", () => {
    // Ela marcou 2 planos numa conta de 1 ativo: os dois ficam marcados. O
    // que passar da cota é guardado pela ativação, não desmarcado aqui.
    const r = retomadaDaLinha({ ...linha, choices: { plans: [true, true, false], habits: [true, true], goals: true } }, 1);
    expect(r.kind === "pronta" && r.choices.plans).toEqual([true, true, false]);
  });
});

describe("as escolhas de partida", () => {
  it("marcam só os planos que cabem ativos, todos os hábitos e as metas", () => {
    expect(defaultChoices(PROPOSTA, 1)).toEqual({ plans: [true, false, false], habits: [true, true], goals: true });
    expect(defaultChoices(PROPOSTA, 3).plans).toEqual([true, true, true]);
  });

  it("proposta recém-gerada (`resumed:false`) é marcada para a tela salvar com a cota", () => {
    const r = retomadaDaResposta({ status: "ready", blueprint: PROPOSTA, choices: { plans: [true, true, true], habits: [true, true], goals: true }, resumed: false }, 1);
    expect(r.kind === "pronta" && r.escolhasIntactas).toBe(false);
  });

  it("linha que ninguém escolheu ainda (`choices_updated_at` vazio) também é completada e salva", () => {
    const r = retomadaDaLinha({ status: "ready", proposal: PROPOSTA, choices: {} }, 2);
    expect(r.kind).toBe("pronta");
    if (r.kind !== "pronta") return;
    expect(r.choices).toEqual(defaultChoices(PROPOSTA, 2));
    expect(r.escolhasIntactas).toBe(false);
  });

  it("escolha salva com tamanho errado não desenha caixa sem estado nem plano que não existe", () => {
    const { choices, intactas } = normalizeChoices({ plans: [false], habits: [false, false, true, true], goals: "sim" }, PROPOSTA, 1);
    expect(choices).toEqual({ plans: [false, false, false], habits: [false, false], goals: true });
    expect(intactas).toBe(false);
  });
});

describe("os outros estados da linha", () => {
  it("sem linha: nada a retomar", () => {
    expect(retomadaDaLinha(null, 1)).toEqual({ kind: "nenhuma" });
  });
  it("`generating`: outra aba está gerando — esperar, não gerar de novo", () => {
    expect(retomadaDaLinha({ status: "generating" }, 1)).toEqual({ kind: "gerando" });
    expect(retomadaDaResposta({ status: "generating" }, 1)).toEqual({ kind: "gerando" });
  });
  it("`activated`: segue adiante com o resumo do que foi aplicado", () => {
    const r = retomadaDaLinha({ status: "activated", proposal: PROPOSTA, activation_result: { plans_activated: ["alimentar"], plans_archived: [], goals: ["water_goal_ml"], habits: 1 } }, 1);
    expect(r.kind).toBe("ativada");
    if (r.kind !== "ativada") return;
    expect(r.result.plansActivated).toEqual(["alimentar"]);
  });
  it("proposta sem forma não é desenhada pela metade: vira `invalida`", () => {
    expect(retomadaDaLinha({ status: "ready", proposal: { plans: [] } }, 1)).toEqual({ kind: "invalida", motivo: "proposta_sem_forma" });
    expect(retomadaDaLinha({ status: "???" }, 1).kind).toBe("invalida");
    expect(isBlueprintProposal(PROPOSTA)).toBe(true);
  });
});

describe("a ativação: o servidor diz o que aplicou", () => {
  it("`ok:true` traz o resultado; o resumo sai DELE, não do que a tela mandou", () => {
    const r = interpretarAtivacao({ ok: true, plans_activated: ["alimentar"], plans_archived: ["treino", "financeiro"], goals: ["calorie_goal_kcal", "water_goal_ml"], habits: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok || r.nada === true) throw new Error("devia ser ativação");
    const resumo = resumoDaAtivacao(r.result);
    expect(resumo.planosAtivos).toEqual(["alimentação"]);
    // O plano que não coube ativo é GUARDADO e DITO — nunca descartado em silêncio.
    expect(resumo.planosGuardados).toEqual(["treino", "financeiro"]);
    expect(resumo.frase).toContain("2 planos guardados");
    expect(resumo.metas).toEqual(["calorias", "água"]);
  });

  it("a repetição (`already`) é sucesso, sem aplicar de novo", () => {
    const r = interpretarAtivacao({ ok: true, already: true, plans_activated: ["alimentar"], plans_archived: [], goals: [], habits: 0 });
    expect(r.ok && r.nada === false && r.result.already).toBe(true);
  });

  it("`ok:false` é falha recuperável — nunca 'Ativado' sobre o que não aconteceu", () => {
    expect(interpretarAtivacao({ ok: false, error: "40001", message: "…", retryable: true }))
      .toEqual({ ok: false, podeTentarDeNovo: true, codigo: "40001" });
  });

  it("resposta sem forma, ou sem `ok`, também é falha", () => {
    expect(interpretarAtivacao(null).ok).toBe(false);
    expect(interpretarAtivacao({ plans_activated: ["alimentar"] }).ok).toBe(false);
  });

  it("nada aplicado diz que nada foi ativado", () => {
    expect(resumoDaAtivacao(parseActivationResult({})).frase).toContain("nada foi ativado");
  });
});

describe("as metas: a tela manda as CHAVES, o servidor tira o valor da proposta", () => {
  it("só as áreas que a pessoa acompanha — meta de água para quem desligou água é cobrança invisível", () => {
    expect(goalKeysFor(PROPOSTA, new Set(["meals", "water"]))).toEqual(["calorie_goal_kcal", "water_goal_ml"]);
  });
  it("valor ausente na proposta não vira chave", () => {
    expect(goalKeysFor({ ...PROPOSTA, water_goal_ml: null }, new Set(["water"]))).toEqual([]);
  });
});

describe("esperar a outra aba tem teto", () => {
  it("relê enquanto é recente; depois do teto chama a função, que decide se reivindica", () => {
    expect(proximoPassoDaEspera(0)).toBe("reler");
    expect(proximoPassoDaEspera(TETO_DA_ESPERA_MS - 1)).toBe("reler");
    expect(proximoPassoDaEspera(TETO_DA_ESPERA_MS)).toBe("chamar-a-funcao");
  });
});

/* ── Revisão Sentinela, achado 1: "Ativar" com nada consumia a proposta ── */
describe("sem nada efetivo, não há o que ativar — e a proposta não se consome", () => {
  const nada = { plans: [false, false, false], habits: [false, false], goals: false };

  it("tudo desmarcado: zero", () => {
    expect(itensEfetivos(nada, PROPOSTA, new Set(["meals", "water"]))).toBe(0);
  });

  it("'metas' marcado mas nenhuma área acompanhada: zero — a caixa sozinha não vale", () => {
    expect(itensEfetivos({ ...nada, goals: true }, PROPOSTA, new Set())).toBe(0);
  });

  it("metas contam pelas CHAVES que iriam na chamada; planos e hábitos pelas caixas", () => {
    expect(itensEfetivos({ ...nada, goals: true }, PROPOSTA, new Set(["meals", "water"]))).toBe(2);
    expect(itensEfetivos({ plans: [true, false, true], habits: [false, true], goals: false }, PROPOSTA, new Set())).toBe(3);
  });

  it("a resposta `nada:true` é sucesso SEM resultado — não é ativação nem falha", () => {
    expect(interpretarAtivacao({ ok: true, nada: true })).toEqual({ ok: true, nada: true });
    const r = interpretarAtivacao({ ok: true, plans_activated: [], plans_archived: [], goals: [], habits: 0 });
    expect(r.ok && r.nada).toBe(false);
  });

  it("na tela, o botão principal vira 'Agora não' e a resposta `nada` segue o mesmo caminho", () => {
    const tela = readFileSync(new URL("../pages/Onboarding.tsx", import.meta.url), "utf8");
    expect(tela).toContain("itensEfetivos(escolhas, blueprint, activeTrackers) === 0");
    expect(tela).toMatch(/nadaParaAtivar \? \(\s*<Button[^>]*onClick=\{explorarPrimeiro\}/);
    expect(tela).toContain("if (r.nada === true) { explorarPrimeiro(); return; }");
  });
});

/* ── Revisão Sentinela, achado 2: a volta pela tela não virava medida ── */
describe("a tela registra a retomada que ela mesma fez", () => {
  it("só proposta `ready` lida da linha conta como retomada", () => {
    expect(contaComoRetomada(retomadaDaLinha({ status: "ready", proposal: PROPOSTA, choices: {} }, 1))).toBe(true);
    expect(contaComoRetomada(retomadaDaLinha({ status: "generating" }, 1))).toBe(false);
    expect(contaComoRetomada(retomadaDaLinha(null, 1))).toBe(false);
    expect(contaComoRetomada(retomadaDaLinha({
      status: "activated", proposal: PROPOSTA,
      activation_result: { ok: true, plans_activated: [], plans_archived: [], goals: [], habits: 1 },
    }, 1))).toBe(false);
  });

  it("a tela chama `report_blueprint_resumed` uma vez por montagem, ao hidratar da linha", () => {
    const tela = readFileSync(new URL("../pages/Onboarding.tsx", import.meta.url), "utf8");
    expect(tela.match(/rpc\("report_blueprint_resumed"\)/g)).toHaveLength(1);
    expect(tela).toMatch(/if \(retomadaRegistrada\.current \|\| !contaComoRetomada\(r\)\) return;\s*retomadaRegistrada\.current = true;/);
    // Nos dois caminhos que leem a linha: ao montar e na espera.
    expect(tela).toMatch(/if \(!hidratarRef\.current\(r\)\) return;\s*registrarRetomada\(r\);/);
    expect(tela).toMatch(/hidratarRef\.current\(r\);\s*registrarRetomadaRef\.current\(r\);/);
    // E NÃO no caminho da função: ela grava o próprio `resumed` no servidor.
    const generate = tela.slice(tela.indexOf("const generate = async"), tela.indexOf("const generateRef"));
    expect(generate).not.toContain("registrarRetomada");
  });
});
