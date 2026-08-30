// ASCENDE — Planos seccionados: parsing e reconstrução (puro, testável, sem I/O).
//
// A tabela `plans` guarda o plano como UM blob de markdown livre (`content`),
// sem estrutura por item. Mas o Conselheiro já escreve num formato fixo
// (prompt em supabase/functions/ai-chat/index.ts):
//
//   ## Resumo          → 3 a 6 bullets com os números-chave
//   ## <tema>          → uma seção por refeição (alimentar) ou por dia (treino)
//   ### <subdivisão>   → subdivisões dentro da seção
//   ## Observações     → adaptações, avisos e quando revisar
//
// Este módulo lê esse formato para que cada refeição/dia possa ser editada
// isoladamente, e reescreve o markdown inteiro depois — sem migração de banco
// e sem tocar no que a IA gera.
//
// REGRA CENTRAL: editar uma seção não pode reformatar as outras. Por isso cada
// seção guarda o próprio `raw` (o bloco original, byte a byte) e a
// reconstrução é uma concatenação. Só a seção efetivamente editada tem o texto
// regerado — as demais voltam idênticas ao que a IA escreveu.

export type SectionRole = "resumo" | "observacoes" | "item";

export interface PlanSection {
  /** Estável dentro de um parse; serve de chave de lista e de alvo de edição. */
  id: string;
  /** Texto do cabeçalho, sem os `#`. */
  title: string;
  /** Corpo em markdown, sem o cabeçalho, aparado nas pontas. */
  body: string;
  /** Bloco original exato (cabeçalho + corpo), preservado para round-trip. */
  raw: string;
  role: SectionRole;
}

export interface ParsedPlan {
  /** 2 no formato do Conselheiro; 1 em planos antigos que usaram `#`. */
  headingLevel: number;
  /** Texto antes do primeiro cabeçalho de seção. `null` quando não há. */
  preamble: string | null;
  sections: PlanSection[];
}

/** Só estes dois tipos ganham visualização seccionada. Financeiro, rotina e
 *  "outro" continuam como documento único — a estrutura por item não faz
 *  sentido para eles e regredir isso seria pior que não ter a função. */
export const SECTIONED_KINDS = ["alimentar", "treino"] as const;

export function isSectionedKind(kind: string | null | undefined): boolean {
  return (SECTIONED_KINDS as readonly string[]).includes(kind ?? "");
}

/* ── Reconhecimento de papéis ─────────────────────────────────────────────
   O prompt manda "Resumo" e "Observações", mas o modelo varia ("Visão
   geral", "Notas finais"). Comparação sem acento, sem caixa e sem
   pontuação — e sempre presa à POSIÇÃO: só a primeira seção pode ser resumo,
   só a última pode ser observações. Um "Observações" no meio do documento é
   conteúdo do plano, e continua editável. */

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeTitle(text: string): string {
  return stripAccents(text).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const RESUMO_TITLES = /^(resumo|resumo do plano|visao geral|panorama|em resumo)$/;
const OBSERVACOES_TITLES = /^(observacao|observacoes|obs|nota|notas|notas finais|avisos|consideracoes|consideracoes finais)$/;

interface HeadingHit { line: number; level: number; text: string }

/** Cabeçalhos fora de blocos de código cercados. */
function scanHeadings(lines: string[]): HeadingHit[] {
  const hits: HeadingHit[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m) hits.push({ line: i, level: m[1].length, text: m[2].replace(/\s*#+\s*$/, "").trim() });
  }
  return hits;
}

/**
 * Lê o markdown do plano em seções de primeiro nível.
 *
 * Devolve `null` quando o conteúdo não tem a estrutura esperada — plano
 * antigo, escrito à mão ou em prosa corrida. O chamador então mostra o
 * documento inteiro, como sempre fez: a tela nunca fica sem conteúdo.
 */
export function parsePlanContent(content: string | null | undefined): ParsedPlan | null {
  const text = (content ?? "").replace(/\r\n?/g, "\n");
  if (!text.trim()) return null;

  const lines = text.split("\n");
  const headings = scanHeadings(lines);

  // `##` é o formato documentado; `#` cobre planos antigos. Exigir DOIS
  // cabeçalhos no nível evita tratar um documento com um único título como
  // "seccionado" — nesse caso não haveria nada para editar separadamente.
  const level = [2, 1].find((lv) => headings.filter((h) => h.level === lv).length >= 2);
  if (!level) return null;

  const marks = headings.filter((h) => h.level === level);
  const firstLine = marks[0].line;

  const sections: PlanSection[] = marks.map((head, idx) => {
    const end = idx + 1 < marks.length ? marks[idx + 1].line : lines.length;
    return {
      id: `sec-${idx}`,
      title: head.text,
      body: lines.slice(head.line + 1, end).join("\n").replace(/^\n+/, "").replace(/\s+$/, ""),
      raw: lines.slice(head.line, end).join("\n"),
      role: "item" as SectionRole,
    };
  });

  if (RESUMO_TITLES.test(normalizeTitle(sections[0].title))) sections[0].role = "resumo";
  const last = sections[sections.length - 1];
  if (sections.length > 1 && OBSERVACOES_TITLES.test(normalizeTitle(last.title))) {
    last.role = "observacoes";
  }

  // Só Resumo + Observações e nada no meio: não há o que editar por item.
  if (!sections.some((s) => s.role === "item")) return null;

  return {
    headingLevel: level,
    preamble: firstLine > 0 ? lines.slice(0, firstLine).join("\n") : null,
    sections,
  };
}

/** Título numa linha só, sem `#` — o campo de título é um Input. */
function sanitizeTitle(title: string): string {
  return title.replace(/[\r\n]+/g, " ").replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
}

/**
 * Devolve um plano novo com UMA seção substituída. As outras mantêm o `raw`
 * original — editar o almoço não pode reescrever o café da manhã.
 */
export function replaceSection(
  plan: ParsedPlan,
  id: string,
  next: { title: string; body: string },
): ParsedPlan {
  const hashes = "#".repeat(plan.headingLevel);
  const title = sanitizeTitle(next.title) || "Sem título";
  const body = next.body.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  // O `\n` final garante a linha em branco que separa desta a próxima seção
  // quando os blocos são reunidos.
  const raw = body ? `${hashes} ${title}\n\n${body}\n` : `${hashes} ${title}\n`;

  return {
    ...plan,
    sections: plan.sections.map((s) => (s.id === id ? { ...s, title, body, raw } : s)),
  };
}

/**
 * Remonta o markdown completo. Sem edição nenhuma, devolve exatamente o
 * conteúdo original (round-trip byte a byte) — é o que garante que abrir e
 * fechar um plano não suje o histórico com reformatações fantasma.
 */
export function buildPlanContent(plan: ParsedPlan): string {
  const parts: string[] = [];
  if (plan.preamble !== null) parts.push(plan.preamble);
  for (const section of plan.sections) parts.push(section.raw);
  return parts.join("\n");
}

/** Quantas seções o usuário pode editar de fato. */
export function editableSectionCount(plan: ParsedPlan): number {
  return plan.sections.filter((s) => s.role === "item").length;
}
