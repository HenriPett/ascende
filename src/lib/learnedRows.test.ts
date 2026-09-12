// ASCENDE — Testes da correção quente: o bloco "Aprendi sobre você" no chat.
//
// O que está em jogo: este bloco é o único lugar do app onde a pessoa mexe na
// memória SEM uma tela de confirmação por trás. Uma recusa que a rede engoliu
// e a tela comemorou deixa no retrato exatamente a frase que ela acabou de
// negar — e ela não tem como saber. Por isso metade destes testes é sobre
// falha, não sobre sucesso.
//
// Módulo puro: nada aqui toca banco, rede ou relógio. O tempo entra por
// `tick(ms)`, que é o que permite testar a janela de 8 segundos sem esperar 8
// segundos nem mockar Date.
import { describe, it, expect } from "vitest";
import {
  initLearnedBlock, learnedBlockReducer, pedidoDeCorrecao,
  rowOutcome, rowAceitaMenu, rowSaindo, blocoCongelado, blocoVazio,
  UNDO_WINDOW_MS, UNDO_FADE_MS,
  type LearnedBlockAction, type LearnedBlockState,
} from "@/lib/learnedRows";
import { MEMORY_CONTENT_MAX } from "@/lib/memories";

const ITENS = [
  { id: "m1", content: "Você treina de manhã", category: "rotina" },
  { id: "m2", content: "Você prefere jantar cedo", category: "preferencia" },
];

const inicial = () => initLearnedBlock(ITENS);

/** Aplica uma sequência de ações — os estados desta linha são um caminho, e
 *  testar o caminho é o ponto. */
const run = (state: LearnedBlockState, ...acoes: LearnedBlockAction[]) =>
  acoes.reduce(learnedBlockReducer, state);

const linha = (state: LearnedBlockState, id: string) => state.rows.find((r) => r.id === id)!;

describe("initLearnedBlock", () => {
  it("abre toda linha parada, intacta e sem menu", () => {
    const s = inicial();
    expect(s.menu).toBeNull();
    expect(s.rows.map((r) => r.id)).toEqual(["m1", "m2"]);
    expect(s.rows.every((r) => r.phase === "parada")).toBe(true);
    expect(s.rows.map(rowOutcome)).toEqual(["intacta", "intacta"]);
    expect(blocoCongelado(s)).toBe(false);
    expect(blocoVazio(s)).toBe(false);
  });

  it("aguenta uma lista vazia sem dizer que o bloco acabou", () => {
    // blocoVazio significa "as linhas foram embora", não "nunca houve linha".
    // Se confundisse os dois, um bloco sem itens se auto-dispensaria.
    expect(blocoVazio(initLearnedBlock([]))).toBe(false);
  });
});

describe("corrigir — o caminho feliz", () => {
  it("abre o campo com o texto atual dentro, e não em branco", () => {
    // É correção, não redação: o campo já vem com a frase que ela quer mexer.
    const s = run(inicial(), { type: "editar", id: "m1" });
    expect(linha(s, "m1").phase).toBe("editando");
    expect(linha(s, "m1").draft).toBe("Você treina de manhã");
  });

  it("troca o texto da linha e passa a dizer que foi a pessoa", () => {
    const s = run(inicial(),
      { type: "editar", id: "m1" },
      { type: "rascunho", id: "m1", draft: "Você treina à noite" },
      { type: "salvando", id: "m1", acao: "corrigir" },
      { type: "corrigido", id: "m1", content: "Você treina à noite" },
    );
    const r = linha(s, "m1");
    expect(r.phase).toBe("parada");
    expect(r.content).toBe("Você treina à noite");
    expect(rowOutcome(r)).toBe("corrigida");
    expect(r.error).toBeNull();
    // A linha corrigida continua tocável: ninguém acerta de primeira sempre.
    expect(rowAceitaMenu(r)).toBe(true);
  });

  it("não encosta nas outras linhas do bloco", () => {
    const antes = inicial();
    const s = run(antes,
      { type: "editar", id: "m1" },
      { type: "rascunho", id: "m1", draft: "Outra coisa" },
    );
    expect(linha(s, "m2")).toBe(linha(antes, "m2"));
  });

  it("cancelar devolve a linha ao que era, sem salvar nada", () => {
    const s = run(inicial(),
      { type: "editar", id: "m1" },
      { type: "rascunho", id: "m1", draft: "texto que ela desistiu de salvar" },
      { type: "cancelar", id: "m1" },
    );
    const r = linha(s, "m1");
    expect(r.phase).toBe("parada");
    expect(r.content).toBe("Você treina de manhã");
    expect(rowOutcome(r)).toBe("intacta");
  });

  it("cancelar a SEGUNDA correção devolve a primeira, não o texto da IA", () => {
    // O detalhe que um `outcome` guardado à mão erraria: `corrigida` não
    // volta a ser falso só porque a pessoa desistiu de mexer de novo.
    const s = run(inicial(),
      { type: "editar", id: "m1" },
      { type: "salvando", id: "m1", acao: "corrigir" },
      { type: "corrigido", id: "m1", content: "Você treina à noite" },
      { type: "editar", id: "m1" },
      { type: "rascunho", id: "m1", draft: "sei lá" },
      { type: "cancelar", id: "m1" },
    );
    const r = linha(s, "m1");
    expect(r.content).toBe("Você treina à noite");
    expect(rowOutcome(r)).toBe("corrigida");
  });
});

describe("pedidoDeCorrecao", () => {
  const r = () => linha(inicial(), "m1");

  it("manda salvar o texto limpo quando mudou de verdade", () => {
    const p = pedidoDeCorrecao(r(), "  Você treina   à noite  ");
    expect(p.kind).toBe("salvar");
    expect(p.content).toBe("Você treina à noite");
    expect(p.error).toBeNull();
  });

  it("reprova o vazio e o curto demais com a frase da casa", () => {
    for (const raw of ["", "   ", "ok"]) {
      const p = pedidoDeCorrecao(r(), raw);
      expect(p.kind).toBe("invalido");
      // A mensagem vem de validateMemoryContent — não é reescrita aqui, para
      // a tela não discordar do CHECK do banco.
      expect(p.error).toBe("Escreva um pouco mais para eu guardar direito.");
    }
  });

  it("reprova o longo demais pelo mesmo limite do banco", () => {
    const p = pedidoDeCorrecao(r(), "a".repeat(MEMORY_CONTENT_MAX + 1));
    expect(p.kind).toBe("invalido");
    expect(p.error).toContain(String(MEMORY_CONTENT_MAX));
  });

  it("trata 'não mudei nada' como caso próprio, e não como salvar", () => {
    // Salvar aqui promoveria a memória a 'confirmada' — o app registraria uma
    // confirmação que a pessoa não deu, só porque ela abriu e fechou o campo.
    const p = pedidoDeCorrecao(r(), "  Você treina de manhã ");
    expect(p.kind).toBe("sem-mudanca");
  });
});

describe("recusar e desfazer", () => {
  const recusada = () => run(inicial(),
    { type: "salvando", id: "m1", acao: "recusar" },
    { type: "recusado", id: "m1" },
  );

  it("tira a linha do retrato e abre a janela de desfazer", () => {
    const r = linha(recusada(), "m1");
    expect(rowOutcome(r)).toBe("recusada");
    expect(r.undoLeftMs).toBe(UNDO_WINDOW_MS);
    // Recusada não abre menu: a única ação que ainda cabe nela é Desfazer.
    expect(rowAceitaMenu(r)).toBe(false);
  });

  it("desfazer traz a linha de volta inteira", () => {
    const s = run(recusada(),
      { type: "salvando", id: "m1", acao: "desfazer" },
      { type: "desfeito", id: "m1" },
    );
    const r = linha(s, "m1");
    expect(rowOutcome(r)).toBe("intacta");
    expect(r.phase).toBe("parada");
    expect(r.undoLeftMs).toBe(0);
  });

  it("desfazer depois de corrigir devolve a linha CORRIGIDA", () => {
    const s = run(inicial(),
      { type: "editar", id: "m1" },
      { type: "salvando", id: "m1", acao: "corrigir" },
      { type: "corrigido", id: "m1", content: "Você treina à noite" },
      { type: "salvando", id: "m1", acao: "recusar" },
      { type: "recusado", id: "m1" },
      { type: "salvando", id: "m1", acao: "desfazer" },
      { type: "desfeito", id: "m1" },
    );
    const r = linha(s, "m1");
    expect(rowOutcome(r)).toBe("corrigida");
    expect(r.content).toBe("Você treina à noite");
  });

  it("a janela vence e a linha sai do bloco", () => {
    const s = run(recusada(), { type: "tick", ms: UNDO_WINDOW_MS });
    expect(linha(s, "m1").phase).toBe("removida");
  });

  it("avisa o fade só no fim da janela, e não no começo", () => {
    const cedo = run(recusada(), { type: "tick", ms: 1000 });
    expect(rowSaindo(linha(cedo, "m1"))).toBe(false);
    const tarde = run(recusada(), { type: "tick", ms: UNDO_WINDOW_MS - UNDO_FADE_MS });
    expect(rowSaindo(linha(tarde, "m1"))).toBe(true);
  });

  it("o bloco só fica vazio quando a ÚLTIMA linha vai embora", () => {
    const uma = run(recusada(), { type: "tick", ms: UNDO_WINDOW_MS });
    expect(blocoVazio(uma)).toBe(false); // m2 ainda está lá

    const duas = run(uma,
      { type: "salvando", id: "m2", acao: "recusar" },
      { type: "recusado", id: "m2" },
      { type: "tick", ms: UNDO_WINDOW_MS },
    );
    expect(blocoVazio(duas)).toBe(true);
  });

  it("linha removida não volta a andar com mais tick", () => {
    const s = run(recusada(), { type: "tick", ms: UNDO_WINDOW_MS }, { type: "tick", ms: 5000 });
    expect(linha(s, "m1").undoLeftMs).toBe(0);
    expect(linha(s, "m1").phase).toBe("removida");
  });
});

describe("o relógio do desfazer pausa quando o bloco está ocupado", () => {
  const recusadaEEditando = () => run(inicial(),
    { type: "salvando", id: "m1", acao: "recusar" },
    { type: "recusado", id: "m1" },
    { type: "editar", id: "m2" }, // ela parou para corrigir a OUTRA linha
  );

  it("não desconta nada enquanto a pessoa edita outra linha", () => {
    // O caso real: ela recusa a linha de cima, começa a corrigir a de baixo, e
    // ao terminar descobre que perdeu o Desfazer por ter demorado. Isso é
    // punir quem estava usando o app direito.
    const s = run(recusadaEEditando(), { type: "tick", ms: UNDO_WINDOW_MS * 2 });
    expect(linha(s, "m1").undoLeftMs).toBe(UNDO_WINDOW_MS);
    expect(linha(s, "m1").phase).toBe("parada");
  });

  it("volta a correr assim que a edição termina", () => {
    const s = run(recusadaEEditando(),
      { type: "tick", ms: 3000 },
      { type: "cancelar", id: "m2" },
      { type: "tick", ms: 3000 },
    );
    expect(linha(s, "m1").undoLeftMs).toBe(UNDO_WINDOW_MS - 3000);
  });

  it("menu aberto também segura o relógio", () => {
    const s = run(inicial(),
      { type: "salvando", id: "m1", acao: "recusar" },
      { type: "recusado", id: "m1" },
      { type: "abrirMenu", id: "m2" },
      { type: "tick", ms: UNDO_WINDOW_MS },
    );
    expect(linha(s, "m1").undoLeftMs).toBe(UNDO_WINDOW_MS);
  });
});

describe("blocoCongelado — o que segura o auto-dispensa", () => {
  it("congela com menu aberto, com edição e com salvamento em curso", () => {
    expect(blocoCongelado(run(inicial(), { type: "abrirMenu", id: "m1" }))).toBe(true);
    expect(blocoCongelado(run(inicial(), { type: "editar", id: "m1" }))).toBe(true);
    expect(blocoCongelado(run(inicial(),
      { type: "salvando", id: "m1", acao: "recusar" }))).toBe(true);
  });

  it("descongela ao fechar o menu e ao terminar a ação", () => {
    expect(blocoCongelado(run(inicial(),
      { type: "abrirMenu", id: "m1" }, { type: "fecharMenu" }))).toBe(false);
    expect(blocoCongelado(run(inicial(),
      { type: "salvando", id: "m1", acao: "recusar" },
      { type: "recusado", id: "m1" }))).toBe(false);
  });

  it("uma linha na janela de desfazer NÃO congela o bloco", () => {
    // Senão o bloco ficaria travado 8s a cada recusa, e a promessa de que
    // "ação não prende a pessoa ali" viraria mentira.
    const s = run(inicial(),
      { type: "salvando", id: "m1", acao: "recusar" }, { type: "recusado", id: "m1" });
    expect(blocoCongelado(s)).toBe(false);
  });

  it("abrir o menu de uma linha recusada não acontece", () => {
    const s = run(inicial(),
      { type: "salvando", id: "m1", acao: "recusar" },
      { type: "recusado", id: "m1" },
      { type: "abrirMenu", id: "m1" },
    );
    expect(s.menu).toBeNull();
  });

  it("editar fecha o menu — formulário aberto e menu aberto ao mesmo tempo, não", () => {
    const s = run(inicial(), { type: "abrirMenu", id: "m1" }, { type: "editar", id: "m1" });
    expect(s.menu).toBeNull();
    expect(linha(s, "m1").phase).toBe("editando");
  });
});

describe("falha de rede — a linha volta ao que era e a pessoa fica sabendo", () => {
  it("correção que não salvou volta ao formulário COM o texto digitado", () => {
    const s = run(inicial(),
      { type: "editar", id: "m1" },
      { type: "rascunho", id: "m1", draft: "Você treina à noite" },
      { type: "salvando", id: "m1", acao: "corrigir" },
      { type: "falhou", id: "m1", error: "Não consegui salvar. Tente de novo." },
    );
    const r = linha(s, "m1");
    expect(r.phase).toBe("editando");
    // Perder o texto seria cobrar duas vezes pelo mesmo trabalho.
    expect(r.draft).toBe("Você treina à noite");
    expect(r.error).toBe("Não consegui salvar. Tente de novo.");
    // E, principalmente: a linha NÃO diz que foi corrigida.
    expect(r.content).toBe("Você treina de manhã");
    expect(rowOutcome(r)).toBe("intacta");
  });

  it("digitar de novo limpa o erro", () => {
    const s = run(inicial(),
      { type: "editar", id: "m1" },
      { type: "salvando", id: "m1", acao: "corrigir" },
      { type: "falhou", id: "m1", error: "Não consegui salvar. Tente de novo." },
      { type: "rascunho", id: "m1", draft: "Você treina à noite" },
    );
    expect(linha(s, "m1").error).toBeNull();
  });

  it("recusa que não aconteceu deixa a linha no retrato, com o aviso", () => {
    // O erro mais perigoso do bloco: dizer "Tirei isso do seu retrato" sobre
    // uma memória que continua lá.
    const s = run(inicial(),
      { type: "salvando", id: "m1", acao: "recusar" },
      { type: "falhou", id: "m1", error: "Não consegui salvar. Tente de novo." },
    );
    const r = linha(s, "m1");
    expect(rowOutcome(r)).toBe("intacta");
    expect(r.phase).toBe("parada");
    expect(r.undoLeftMs).toBe(0);
    expect(r.error).toBe("Não consegui salvar. Tente de novo.");
  });

  it("desfazer que falhou mantém a linha recusada e renova a janela", () => {
    // Se a janela seguisse correndo por baixo, o botão sumiria justo na
    // segunda tentativa — quando ela mais precisa dele.
    const s = run(inicial(),
      { type: "salvando", id: "m1", acao: "recusar" },
      { type: "recusado", id: "m1" },
      { type: "tick", ms: 7000 },
      { type: "salvando", id: "m1", acao: "desfazer" },
      { type: "falhou", id: "m1", error: "Não consegui salvar. Tente de novo." },
    );
    const r = linha(s, "m1");
    expect(rowOutcome(r)).toBe("recusada");
    expect(r.undoLeftMs).toBe(UNDO_WINDOW_MS);
    expect(r.error).toBe("Não consegui salvar. Tente de novo.");
  });

  it("uma segunda tentativa que dá certo limpa o erro", () => {
    const s = run(inicial(),
      { type: "editar", id: "m1" },
      { type: "salvando", id: "m1", acao: "corrigir" },
      { type: "falhou", id: "m1", error: "Não consegui salvar. Tente de novo." },
      { type: "salvando", id: "m1", acao: "corrigir" },
      { type: "corrigido", id: "m1", content: "Você treina à noite" },
    );
    expect(linha(s, "m1").error).toBeNull();
    expect(rowOutcome(linha(s, "m1"))).toBe("corrigida");
  });
});

describe("ações fora de hora não corrompem o estado", () => {
  it("resposta atrasada de uma linha já removida é ignorada", () => {
    // A promessa do fetch resolve depois do timer: sem a guarda, uma linha que
    // já saiu do bloco voltaria do além.
    const s = run(inicial(),
      { type: "salvando", id: "m1", acao: "recusar" },
      { type: "recusado", id: "m1" },
      { type: "tick", ms: UNDO_WINDOW_MS },
      { type: "corrigido", id: "m1", content: "ressuscitou" },
    );
    const r = linha(s, "m1");
    expect(r.phase).toBe("removida");
    expect(r.content).toBe("Você treina de manhã");
  });

  it("ação sobre id que não existe devolve o mesmo estado", () => {
    const antes = inicial();
    expect(run(antes, { type: "editar", id: "fantasma" })).toBe(antes);
    expect(run(antes, { type: "abrirMenu", id: "fantasma" })).toBe(antes);
  });

  it("rascunho e cancelar só valem com o campo aberto", () => {
    const antes = inicial();
    expect(run(antes, { type: "rascunho", id: "m1", draft: "x" })).toBe(antes);
    expect(run(antes, { type: "cancelar", id: "m1" })).toBe(antes);
  });
});
