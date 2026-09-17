import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* ─────────────────────────────────────────────────────────────────
   O PASSADO É FATO, O FUTURO É COMPROMISSO — E ELES NÃO SE SOMAM

   Bug relatado: "em Seu dia em números > Gasto de hoje está aparecendo um
   valor muito acima do gasto efetivo que tive hoje."

   A causa era uma consulta sem teto:

     .gte("occurred_at", todayISO())        // Hoje.tsx

   "de hoje em diante" em vez de "hoje". Isso só não doía enquanto o app
   não criava transações com data futura — e hoje ele cria, de propósito:
   uma compra em 10x grava DEZ linhas, uma por ciclo, até um ano à frente;
   os fixos são materializados na data do ciclo; a importação de fatura
   traz as parcelas que ainda vão cair. Quem registrasse R$ 2.000 em 10x
   via "Gasto de hoje: R$ 2.000" no lugar dos R$ 200 da primeira parcela.

   O mesmo defeito estava no Score, medindo o mês corrente com o futuro
   dentro. E a Prosperidade tem a MESMA forma de consulta de propósito —
   ela existe para mostrar os ciclos à frente. Ou seja: não dá para proibir
   o `gte` sem teto; dá para exigir que cada uso declare de que lado está.

   Estes testes leem as consultas. O defeito não estava em função pura
   nenhuma: estava na CHAMADA, que é onde ele sempre esteve.
────────────────────────────────────────────────────────────────── */

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** O trecho da LEITURA de transações de um arquivo.
 *  `.select` de propósito: um `from("transactions").insert(...)` não tem
 *  janela de data, e pegá-lo por engano faz o teste afirmar bobagem. */
const consultaTx = (src: string) => {
  const i = src.indexOf('from("transactions").select');
  expect(i, "não achei a leitura de transações").toBeGreaterThan(-1);
  return src.slice(i, i + 420);
};

describe("a tela Hoje mede HOJE", () => {
  const hoje = ler("../pages/Hoje.tsx");
  const q = consultaTx(hoje);

  it("o gasto do dia usa igualdade de data, não 'de hoje em diante'", () => {
    expect(q).toContain('.eq("occurred_at", todayISO())');
    expect(q).not.toContain('.gte("occurred_at", todayISO())');
  });

  it("e é a consulta que alimenta o Gasto de hoje", () => {
    // A trava contra alguém consertar a consulta errada: o valor mostrado
    // na barra do teto vem de `spentToday`, e `spentToday` vem daqui.
    expect(hoje).toContain("spentToday: (txs ?? []).filter((t) => t.kind === \"expense\")");
    expect(hoje).toContain("Gasto de hoje");
  });
});

describe("o Score mede o mês ATÉ HOJE", () => {
  const q = consultaTx(ler("../pages/Score.tsx"));

  it("tem começo E fim — sem o fim, o futuro entra na conta do mês", () => {
    expect(q).toContain('.gte("occurred_at", monthStartISO())');
    expect(q).toContain('.lte("occurred_at", todayISO())');
  });
});

describe("a Prosperidade é a exceção, e é uma exceção DECLARADA", () => {
  const prosp = ler("../pages/Prosperidade.tsx");

  it("ela busca sem teto de propósito: é a tela que mostra os ciclos à frente", () => {
    // Se um dia alguém "consertar" esta consulta por analogia com as outras,
    // as parcelas futuras somem da tela em que elas são o produto.
    const q = consultaTx(prosp);
    expect(q).toContain('.gte("occurred_at", startIso)');
    expect(q).not.toContain('.lte("occurred_at"');
  });

  it("e o app REALMENTE grava transação com data futura — senão nada disto importa", () => {
    // A premissa de todos os testes acima, verificada na fonte: o plano de
    // parcelas produz uma linha por ciclo, com a data real de cada uma.
    const parcelas = ler("./prosperidade.ts");
    expect(parcelas).toContain("cycleOccurrenceISO");
    expect(parcelas).toContain("buildInstallmentPlan");
  });
});

/* ─────────────────────────────────────────────────────────────────
   TRÊS NOMES PARA DOIS CONCEITOS

   Segunda queixa do mesmo relato: "não consigo nem mudar o valor do
   orçamento". O campo existia em Ajustes o tempo todo — chamado "Teto de
   gastos". A Prosperidade chamava o mesmo número de "Orçamento do mês", e
   na MESMA tela havia um "Teto de gasto do dia", que é outro campo.

   Quem procurava "orçamento" encontrava "teto", concluía que era o teto
   diário que já tinha, e desistia. Para essa pessoa o valor era imutável,
   e ela estava certa sobre a experiência mesmo estando errada sobre o
   código. Vocabulário que colide é bug de produto.
────────────────────────────────────────────────────────────────── */
describe("orçamento do mês e teto do dia são coisas diferentes, e se chamam diferente", () => {
  const ajustes = ler("../pages/Ajustes.tsx");
  const prosp = ler("../pages/Prosperidade.tsx");

  it("em Ajustes, o campo do orçamento mensal se chama orçamento", () => {
    const campo = ajustes.slice(ajustes.indexOf('htmlFor="budget"') - 200, ajustes.indexOf('htmlFor="budget"') + 200);
    expect(campo).toContain("Orçamento do mês");
    expect(campo).not.toContain("Teto de gastos");
  });

  it("o mensal grava monthly_budget e o diário grava daily_spend_limit", () => {
    // A trava contra alguém "unificar" os dois por acharem que é duplicata.
    expect(prosp).toContain("monthly_budget: v");
    expect(prosp).toContain("daily_spend_limit: v");
  });

  it("o orçamento é editável NA TELA em que é mostrado", () => {
    // Sem caminho de edição ao lado, um número declarado meses atrás vira
    // régua: a pessoa não lembra de tê-lo dado e não pode corrigi-lo dali.
    const cartao = prosp.slice(prosp.indexOf("budgetPct !== null"), prosp.indexOf("Sua vida financeira em gráficos"));
    expect(cartao).toContain("saveBudgetRaw");
    expect(cartao).toContain("GoalInput");
  });

  it("e o texto não cobra: mudar o número é uma resposta válida", () => {
    const cartao = prosp.slice(prosp.indexOf("budgetPct !== null"), prosp.indexOf("Sua vida financeira em gráficos"));
    expect(cartao).toContain("Mudar o número também é uma resposta");
    expect(cartao).not.toContain("o limite que você definiu");
  });
});
