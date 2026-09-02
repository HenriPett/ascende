// ASCENDE — A trava que impede importação SEM proveniência.
//
// POR QUE UM TESTE QUE LÊ O CÓDIGO-FONTE
// A regra vive dentro de dois componentes/hooks de tela, e a suíte roda em
// ambiente `node`, sem DOM: montar HealthImport para provar que ele NÃO
// chamou o banco exigiria jsdom e uma biblioteca de render que o projeto não
// tem. O que dá para garantir sem isso é o formato da chamada — e é
// justamente ele que regrediu: `dataSourceId: source?.id ?? null` voltou a
// existir depois de o mesmo defeito ter sido corrigido no lado da fatura.
// Mesmo recurso de outro teste de isolamento que já existe nesta suíte e
// também varre arquivos por texto.
//
// O QUE ESTÁ EM JOGO
// O índice único que impede o mesmo registro de entrar duas vezes é PARCIAL:
// só vale quando `data_source_id` E `source_record_key` existem na linha. Sem
// fonte, as duas colunas ficam vazias, a proteção DESLIGA — e desliga no
// caminho de erro, que é exatamente onde a pessoa tenta de novo. Um CSV de
// 555 noites reimportado vira 1.110 registros, e todo indicador que soma
// noites passa a contar cada uma duas vezes, sem nada para desfazer.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ler = (caminho: string) => readFileSync(resolve(process.cwd(), caminho), "utf8");

const SAUDE = ler("src/components/core/HealthImport.tsx");
const FATURA = ler("src/hooks/useStatementConfirm.tsx");

/** Trecho entre a criação da fonte e a gravação: é aí que a desistência tem
 *  de acontecer, e não depois. */
function entre(fonte: string, de: string, ate: string): string {
  const i = fonte.indexOf(de);
  const f = fonte.indexOf(ate, i);
  expect(i, `não achei "${de}"`).toBeGreaterThan(-1);
  expect(f, `não achei "${ate}" depois de "${de}"`).toBeGreaterThan(i);
  return fonte.slice(i, f);
}

describe("importação de saúde não grava sem trilha", () => {
  it("passa o id da fonte direto, nunca opcional", () => {
    expect(SAUDE).toContain("dataSourceId: source.id");
    // As formas que desligam a proteção:
    expect(SAUDE).not.toContain("dataSourceId: source?.id");
    expect(SAUDE).not.toContain("dataSourceId: null");
  });

  it("desiste ANTES de gravar quando a fonte não nasce", () => {
    const trecho = entre(SAUDE, "await createSource(", "saveImportedEvents(");
    expect(trecho).toContain("return;");
  });

  it("avisa que NADA foi gravado — e não que só a trilha faltou", () => {
    const trecho = entre(SAUDE, "await createSource(", "saveImportedEvents(");
    expect(trecho).toMatch(/NÃO gravei nada/);
  });
});

describe("importação de fatura não grava sem trilha", () => {
  it("escreve as duas colunas de proveniência, sempre juntas", () => {
    expect(FATURA).toContain("data_source_id: source.id");
    expect(FATURA).toContain("source_record_key: keys[i]");
    // O espalhamento condicional era o que deixava a linha entrar sem par.
    expect(FATURA).not.toContain("...(source ?");
  });

  it("desiste ANTES de gravar quando a fonte não nasce", () => {
    const trecho = entre(FATURA, "await createSource(", 'from("transactions").insert(rows)');
    expect(trecho).toContain("return null;");
  });
});


describe("importação de saúde não fecha em silêncio quando nada entra", () => {
  /* O pior desfecho medido pelo QA: a tela prometia 1.010 registros, gravava
     ZERO e fechava o painel sem erro, sem toast e sem aviso. Silêncio + painel
     sumindo é lido como sucesso — a mesma classe do "a IA dizia que absorveu e
     não absorvia" que originou esta tela. */
  it("trata accepted === 0 antes de qualquer mensagem de sucesso", () => {
    const zero = SAUDE.indexOf("if (accepted === 0)");
    const sucesso = SAUDE.indexOf("toast.success(");
    expect(zero, "sumiu o tratamento de zero aceito").toBeGreaterThan(-1);
    expect(zero).toBeLessThan(sucesso);
  });

  it("mostra um bloco explicando, em vez de só um toast", () => {
    expect(SAUDE).toContain("setNothingNew(");
    expect(SAUDE).toContain("Nada novo entrou");
    // O painel some (setResult(null)) mas a explicação FICA na tela.
    const trecho = SAUDE.slice(SAUDE.indexOf("if (accepted === 0)"));
    expect(trecho.slice(0, 400)).toContain("setNothingNew(");
    expect(trecho.slice(0, 400)).not.toContain("reset()");
  });

  it("o SUCESSO também fica na tela, não só num toast de 3 s", () => {
    // Assimetria apontada pelo QA: o caso "nada entrou" ganhou bloco fixo e a
    // importação bem-sucedida voltava ao estado inicial sem resumo nenhum.
    expect(SAUDE).toContain("setImported(");
    expect(SAUDE).toContain("no seu histórico");
    // E não pode voltar a limpar tudo logo depois de gravar.
    const trecho = SAUDE.slice(SAUDE.indexOf("setImported("));
    expect(trecho.slice(0, 300)).not.toContain("reset()");
  });

  it("a revisão pergunta à FONTE quando o arquivo já foi importado", () => {
    // Se voltar a comparar só por dia quando existe fonte, a discordância
    // entre revisão e gravação volta com ela.
    expect(SAUDE).toContain("existingRecordKeys(\"life_events\"");
    expect(SAUDE).toContain("markAlreadyImported(");
  });
});
