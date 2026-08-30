// ASCENDE — Testes do parsing/reconstrução de planos seccionados.
// A garantia que mais importa aqui é o round-trip: abrir um plano e salvar
// uma seção não pode reformatar as outras.
import { describe, it, expect } from "vitest";
import {
  parsePlanContent, buildPlanContent, replaceSection, isSectionedKind,
  editableSectionCount,
} from "@/lib/planSections";

const PLANO_ALIMENTAR = `## Resumo

- 2.100 kcal/dia, 150 g de proteína
- 5 refeições, orçamento de R$ 900/mês

## Café da manhã

### Opção 1
- 3 ovos mexidos
- 2 fatias de pão integral

### Opção 2
- Iogurte natural com aveia

## Almoço

- 150 g de frango grelhado
- Arroz, feijão e salada

## Jantar

- Omelete de 3 ovos com legumes

## Observações

- Beber 2,5 L de água por dia.
- Revisar em 4 semanas.`;

describe("parsePlanContent", () => {
  it("separa resumo, itens e observações", () => {
    const plan = parsePlanContent(PLANO_ALIMENTAR)!;
    expect(plan).not.toBeNull();
    expect(plan.headingLevel).toBe(2);
    expect(plan.sections.map((s) => s.title)).toEqual([
      "Resumo", "Café da manhã", "Almoço", "Jantar", "Observações",
    ]);
    expect(plan.sections.map((s) => s.role)).toEqual([
      "resumo", "item", "item", "item", "observacoes",
    ]);
    expect(editableSectionCount(plan)).toBe(3);
  });

  it("mantém as subdivisões ### dentro do corpo da seção", () => {
    const plan = parsePlanContent(PLANO_ALIMENTAR)!;
    const cafe = plan.sections[1];
    expect(cafe.body).toContain("### Opção 1");
    expect(cafe.body).toContain("### Opção 2");
    expect(cafe.body).not.toContain("## Café da manhã");
  });

  it("reconhece resumo/observações sem acento e com variação de nome", () => {
    const plan = parsePlanContent("## Visao geral\n\n- x\n\n## Dia A\n\n- y\n\n## Notas finais\n\n- z")!;
    expect(plan.sections[0].role).toBe("resumo");
    expect(plan.sections[2].role).toBe("observacoes");
  });

  it("só trata como resumo/observações na primeira e na última posição", () => {
    const plan = parsePlanContent("## Dia A\n\n- x\n\n## Observações\n\n- y\n\n## Dia B\n\n- z")!;
    // "Observações" no meio é conteúdo do plano, e continua editável.
    expect(plan.sections.map((s) => s.role)).toEqual(["item", "item", "item"]);
  });

  it("aceita planos antigos que usaram # em vez de ##", () => {
    const plan = parsePlanContent("# Resumo\n\n- a\n\n# Treino A\n\n- b")!;
    expect(plan.headingLevel).toBe(1);
    expect(editableSectionCount(plan)).toBe(1);
  });

  it("guarda como preâmbulo o texto antes da primeira seção", () => {
    const plan = parsePlanContent("# Plano do João\n\n## Resumo\n\n- a\n\n## Dia A\n\n- b")!;
    expect(plan.preamble).toBe("# Plano do João\n");
    expect(plan.sections).toHaveLength(2);
  });

  it("ignora cabeçalhos dentro de blocos de código", () => {
    const plan = parsePlanContent("## A\n\n```\n## não é seção\n```\n\n## B\n\n- x")!;
    expect(plan.sections.map((s) => s.title)).toEqual(["A", "B"]);
  });
});

describe("parsePlanContent — casos que devem cair no documento inteiro", () => {
  it("devolve null para conteúdo vazio", () => {
    expect(parsePlanContent("")).toBeNull();
    expect(parsePlanContent(null)).toBeNull();
    expect(parsePlanContent("   \n  ")).toBeNull();
  });

  it("devolve null para prosa corrida, sem cabeçalhos", () => {
    expect(parsePlanContent("Coma bem, treine três vezes por semana e durma cedo.")).toBeNull();
  });

  it("devolve null quando há um único cabeçalho", () => {
    expect(parsePlanContent("## Resumo\n\n- só isso")).toBeNull();
  });

  it("devolve null quando só há Resumo e Observações (nada para editar)", () => {
    expect(parsePlanContent("## Resumo\n\n- a\n\n## Observações\n\n- b")).toBeNull();
  });
});

describe("buildPlanContent", () => {
  it("sem edição, devolve o conteúdo original byte a byte", () => {
    const plan = parsePlanContent(PLANO_ALIMENTAR)!;
    expect(buildPlanContent(plan)).toBe(PLANO_ALIMENTAR);
  });

  it("preserva o preâmbulo no round-trip", () => {
    const original = "# Plano do João\n\n## Resumo\n\n- a\n\n## Dia A\n\n- b";
    expect(buildPlanContent(parsePlanContent(original)!)).toBe(original);
  });
});

describe("replaceSection", () => {
  it("troca só a seção alvo e não reformata as vizinhas", () => {
    const plan = parsePlanContent(PLANO_ALIMENTAR)!;
    const almoco = plan.sections[2];
    const next = replaceSection(plan, almoco.id, {
      title: "Almoço",
      body: "- 200 g de patinho\n- Batata-doce",
    });
    const out = buildPlanContent(next);

    expect(out).toContain("## Almoço\n\n- 200 g de patinho\n- Batata-doce");
    // vizinhas intactas, com a formatação original
    expect(out).toContain("### Opção 1\n- 3 ovos mexidos");
    expect(out).toContain("## Jantar\n\n- Omelete de 3 ovos com legumes");
    expect(out).toContain("## Observações\n\n- Beber 2,5 L de água por dia.");
    // e o resultado continua parseável, com a mesma quantidade de seções
    expect(parsePlanContent(out)!.sections).toHaveLength(plan.sections.length);
  });

  it("permite renomear a seção", () => {
    const plan = parsePlanContent(PLANO_ALIMENTAR)!;
    const next = replaceSection(plan, plan.sections[3].id, { title: "Ceia", body: "- Queijo" });
    expect(buildPlanContent(next)).toContain("## Ceia\n\n- Queijo");
    expect(buildPlanContent(next)).not.toContain("## Jantar");
  });

  it("limpa # e quebras de linha coladas no título", () => {
    const plan = parsePlanContent(PLANO_ALIMENTAR)!;
    const next = replaceSection(plan, plan.sections[2].id, { title: "## Almoço\nreforçado", body: "- x" });
    expect(next.sections[2].title).toBe("Almoço reforçado");
    expect(buildPlanContent(next)).toContain("## Almoço reforçado\n");
  });

  it("título vazio não gera markdown quebrado", () => {
    const plan = parsePlanContent(PLANO_ALIMENTAR)!;
    const next = replaceSection(plan, plan.sections[2].id, { title: "   ", body: "- x" });
    expect(next.sections[2].title).toBe("Sem título");
    expect(buildPlanContent(next)).toContain("## Sem título");
  });

  it("corpo vazio mantém a seção parseável", () => {
    const plan = parsePlanContent(PLANO_ALIMENTAR)!;
    const next = replaceSection(plan, plan.sections[2].id, { title: "Almoço", body: "" });
    const out = buildPlanContent(next);
    expect(parsePlanContent(out)!.sections.map((s) => s.title)).toContain("Almoço");
  });

  it("normaliza CRLF vindo de colar de fora", () => {
    const plan = parsePlanContent(PLANO_ALIMENTAR)!;
    const next = replaceSection(plan, plan.sections[2].id, { title: "Almoço", body: "- a\r\n- b" });
    expect(next.sections[2].raw).toBe("## Almoço\n\n- a\n- b\n");
  });
});

describe("isSectionedKind", () => {
  it("só alimentar e treino", () => {
    expect(isSectionedKind("alimentar")).toBe(true);
    expect(isSectionedKind("treino")).toBe(true);
    expect(isSectionedKind("financeiro")).toBe(false);
    expect(isSectionedKind("rotina")).toBe(false);
    expect(isSectionedKind("outro")).toBe(false);
    expect(isSectionedKind(null)).toBe(false);
  });
});
