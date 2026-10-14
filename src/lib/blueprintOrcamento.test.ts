import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { defaultChoices, type BlueprintProposal } from "./blueprint";

/* ─────────────────────────────────────────────────────────────────
   O TETO DE SAÍDA DO BLUEPRINT TEM QUE CABER O QUE A FERRAMENTA PEDE

   O bug: `max_tokens` foi dimensionado quando o Blueprint era UM plano.
   Depois a ferramenta passou a pedir de 2 a 4 planos SEPARADOS, cada um
   completo (## Resumo, seções, tabelas, ## Observações) — e o teto ficou
   onde estava. Quando a resposta esbarra nele, a API devolve 200 com
   `stop_reason: "max_tokens"` e o JSON da ferramenta pela metade: os
   planos não passam na validação, o servidor estorna a cortesia e a
   pessoa termina o onboarding sem plano nenhum.

   Ninguém percebeu porque é INTERMITENTE — quatro planos ricos às vezes
   cabem em 4.000 e às vezes não.

   Estes testes leem a função de borda. O defeito não está em nenhuma
   função pura: está na relação entre dois números que vivem em lugares
   diferentes do mesmo arquivo, e é essa relação que precisa de trava.
────────────────────────────────────────────────────────────────── */
const fn = readFileSync(
  new URL("../../supabase/functions/onboarding-blueprint/index.ts", import.meta.url),
  "utf8",
);

const num = (re: RegExp): number => {
  const m = fn.match(re);
  expect(m, `não achei ${re} na função de borda`).toBeTruthy();
  return Number(m![1]);
};

describe("o orçamento de saída do Blueprint", () => {
  const maxTokens = () => num(/max_tokens:\s*(\d+)/);
  const maxPlans = () => num(/maxItems:\s*(\d+)/);

  it("cabe o número de planos que a própria ferramenta pede", () => {
    // Um plano completo em markdown, dentro de JSON de ferramenta (com as
    // quebras de linha escapadas), não sai por menos de ~1.200 tokens.
    // Mais overview, hábitos e premissas. A conta é grosseira de propósito:
    // ela existe para pegar a ordem de grandeza errada, não para afinar.
    const POR_PLANO = 1200;
    const RESTO = 600;
    expect(maxTokens()).toBeGreaterThanOrEqual(maxPlans() * POR_PLANO + RESTO);
  });

  it("não voltou a ser o teto de quando havia um plano só", () => {
    // A trava literal contra a regressão: 4.000 era o número de UM plano.
    expect(maxTokens()).toBeGreaterThan(4000);
  });

  it("continua pedindo de 2 a 4 planos — se isso mudar, o teto se revê", () => {
    expect(fn).toContain("minItems: 2");
    expect(maxPlans()).toBe(4);
  });
});

describe("a falha do Blueprint é diagnosticável e recuperável", () => {
  it("corte no teto de saída deixa rastro: é um 200, ninguém veria sozinho", () => {
    // `logUsage` grava ok=true quando a resposta é 200, então sem este log
    // não há como distinguir "modelo respondeu mal" de "resposta cortada".
    expect(fn).toContain('stop_reason');
    expect(fn).toContain('"max_tokens"');
    expect(fn).toMatch(/console\.error\(\s*"onboarding-blueprint: resposta cortada/);
  });

  it("toda saída de falha estorna a cortesia ANTES de responder", () => {
    // A promessa "a cortesia não foi consumida" só é verdade se o estorno
    // acontecer em todos os caminhos. Desde que a proposta passou a ficar
    // guardada (migração 20261013120000), o fluxo mora em decide.ts: a
    // geração (index.ts) só devolve `null` nas falhas recuperáveis, e quem
    // responde é o fluxo — que libera (apaga a linha `generating` e devolve
    // o carimbo, na mesma transação) antes de cada saída de falha.
    // O comportamento é provado em decide.test.ts (deno test); aqui fica a
    // trava de leitura, para ninguém reintroduzir uma resposta de falha
    // direto da geração, por fora do estorno.
    const fluxo = readFileSync(
      new URL("../../supabase/functions/onboarding-blueprint/decide.ts", import.meta.url), "utf8",
    );
    const gerar = fn.slice(fn.indexOf("async function gerarBlueprint"), fn.indexOf("Deno.serve("));
    expect(gerar).not.toContain("recoverable");
    expect((gerar.match(/return null;/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // Cada `recoverable: true` do fluxo tem a liberação (da geração DESTE
    // token) logo acima — com UMA exceção legítima: a geração superada, cuja
    // linha já é de outra chamada (ou sumiu). Ali não há cortesia nossa para
    // devolver; liberar apagaria a geração nova. Ela é reconhecida pelo
    // `if (!atual)` que relê o banco antes de responder.
    const trechos = fluxo.split("recoverable: true");
    expect(trechos.length - 1).toBeGreaterThanOrEqual(1);
    for (const antes of trechos.slice(0, -1)) {
      const perto = antes.slice(-160);
      const superada = perto.includes("if (!atual)");
      expect(superada || /await d\.liberar\(token\)/.test(perto)).toBe(true);
    }
    // …e a geração que LANÇA, ou a proposta que não deu para guardar, também
    // liberam antes de o erro subir.
    expect((fluxo.match(/await d\.liberar\(token\);\s*throw e;/g) ?? []).length).toBe(2);
  });

  it("a tela oferece TENTAR DE NOVO quando o servidor diz que dá", () => {
    // Prometer "a cortesia não foi consumida" sem botão de tentar é
    // prometer no vazio: a pessoa lia o consolo e seguia sem plano.
    const tela = readFileSync(new URL("../pages/Onboarding.tsx", import.meta.url), "utf8");
    expect(tela).toContain("body?.recoverable");
    expect(tela).toContain("Tentar de novo");
    // E a saída continua existindo: ninguém fica preso num botão.
    const bloco = tela.slice(tela.indexOf("bpRetry &&"), tela.indexOf("bpFallback && ("));
    expect(bloco).toContain("skipLink");
  });
});

/* ─────────────────────────────────────────────────────────────────
   O CLÍMAX DO ONBOARDING NÃO PODE SER UM BOTÃO QUE NÃO FUNCIONA

   O segundo bug, achado no teste ao vivo: o Blueprint propõe de 2 a 4
   planos, vinha com TODOS marcados, e o app mandava os quatro num insert
   só. O gatilho `enforce_active_plans_cap` derruba o LOTE inteiro quando
   passa da cota — 1 plano ativo na conta grátis. Resultado medido: na
   conta grátis a ativação falhava 100% das vezes, e não caía nada (nem
   metas, nem compromissos, porque o `throw` abortava tudo antes).

   A correção tem três partes, e cada uma é testada aqui:
   prevenir (marcar só o que cabe), degradar (guardar em vez de derrubar)
   e contar (dizer onde o plano guardado foi parar).
────────────────────────────────────────────────────────────────── */
describe("ativar o Blueprint na conta grátis", () => {
  /* A ativação MUDOU DE LADO: era a tela inserindo plano a plano, e virou a
     RPC `activate_blueprint`, numa transação (o Blueprint que não se perde ao
     recarregar). As três partes da correção continuam valendo — só que agora
     são verificadas onde moram: o laço e a degradação na função SQL, a
     prevenção (caixas que cabem) em `defaultChoices`, e o "dizer onde foi
     parar" no resumo que vem do servidor. A migração é achada pelo CONTEÚDO,
     não pelo nome — e, se sumir, o teste falha alto em vez de passar vazio. */
  const tela = readFileSync(new URL("../pages/Onboarding.tsx", import.meta.url), "utf8");
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const migracao = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .filter((t) => t.includes("function public.activate_blueprint("))
    .pop() ?? "";
  const ini = migracao.indexOf("function public.activate_blueprint(");
  const activate = ini < 0 ? "" : migracao.slice(ini, migracao.indexOf("$$;", ini));

  it("a ativação existe no servidor — e a tela só chama ela", () => {
    expect(activate).not.toBe("");
    expect(tela).toContain('rpc("activate_blueprint"');
    // A prova de que a tela não voltou a gravar planos por conta própria.
    expect(tela).not.toMatch(/from\("plans"\)\s*\.insert/);
  });

  it("os planos entram UM DE CADA VEZ — o lote derrubava junto o que cabia", () => {
    // Cada plano no seu próprio bloco begin/exception: o erro de um não
    // desfaz os outros.
    expect(activate).toMatch(/for i in 0 \.\. jsonb_array_length\(coalesce\(r\.proposal->'plans'/);
    expect(activate).toMatch(/begin\s+insert into public\.plans/);
  });

  it("o plano que não cabe ativo é GUARDADO, nunca descartado", () => {
    expect(activate).toContain("PLAN_LIMIT_REACHED");
    expect(activate).toMatch(/'blueprint', 'arquivado'\)/);
    expect(activate).toContain("'plans_archived'");
    // E o limite não conta arquivado — é isso que faz a saída existir.
    const sql = readFileSync(new URL("../../supabase/setup.sql", import.meta.url), "utf8");
    const gatilho = sql.slice(sql.indexOf("enforce_active_plans_cap"), sql.indexOf("trg_plans_cap"));
    expect(gatilho).toContain("status = 'ativo'");
  });

  it("um erro que NÃO é o da cota continua explodindo", () => {
    // A degradação é só para o limite. Engolir qualquer erro aqui esconderia
    // falha de rede ou de permissão atrás de um "guardei seu plano".
    expect(activate).toMatch(/if sqlerrm not like 'PLAN_LIMIT_REACHED%' then raise; end if;/);
  });

  it("vêm marcadas só as caixas que cabem ativas", () => {
    // Três planos numa conta que comporta um ativo.
    const p = {
      plans: [0, 1, 2].map((i) => ({ kind: `k${i}`, title: "", pillar: "", content_markdown: "" })),
      habits: [],
    } as unknown as BlueprintProposal;
    expect(defaultChoices(p, 1).plans).toEqual([true, false, false]);
  });

  it("a cota é dita antes do clique e o destino do resto é dito depois", () => {
    expect(tela).toContain("plansChecked.filter(Boolean).length > maxActivePlans");
    expect(tela).toContain("guardados em Jornada");          // antes
    expect(tela).toContain("prontos para ativar");           // no resumo final
  });

  it("a cota é só exibição — quem decide continua sendo o servidor", () => {
    // `max_active_plans` vem do get-subscription e pode estar desatualizado.
    // Se estiver, a rede de segurança (arquivar) resolve sem erro na cara.
    expect(tela).toContain("ent?.limits?.max_active_plans");
    expect(tela).toContain("Math.max(1,");
  });
});

describe("um erro nunca manda a pessoa insistir no que não tem saída", () => {
  it("reativar com a vaga ocupada ensina a troca em vez de dizer 'tente de novo'", () => {
    // O QA achou a mesma armadilha do onboarding sobrevivendo em Meus
    // planos: o toast genérico não contava que existe limite nem que a
    // troca é possível (arquivar o ativo, reativar o outro).
    const planos = readFileSync(new URL("../pages/Planos.tsx", import.meta.url), "utf8");
    const setStatus = planos.slice(planos.indexOf("const setStatus"), planos.indexOf("const remove"));
    expect(setStatus).toContain("isPlanCapError");
    expect(setStatus).toContain("Arquive o que está ativo");
    // E o erro que NÃO é o da cota continua com a mensagem de sempre.
    expect(setStatus).toContain("Não consegui atualizar o plano.");
  });

  it("a saída da tela de erro é um alvo de toque de verdade", () => {
    const tela = readFileSync(new URL("../pages/Onboarding.tsx", import.meta.url), "utf8");
    const skip = tela.slice(tela.indexOf("const skipLink"), tela.indexOf("const navRow"));
    expect(skip).toContain("min-h-11");
  });
});
