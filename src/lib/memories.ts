// ASCENDE — Vocabulário das memórias que a IA guarda sobre a pessoa.
//
// Vive fora do componente porque é consumido por três lugares com finalidades
// diferentes: o bloco "Aprendi sobre você" (LearnedInsights), a captura e o
// Conselheiro, e a lista de "o que sei sobre você" em Ajustes — que não
// renderiza o bloco, só precisa dos rótulos.

/** Uma nuance que a IA acabou de aprender sobre o usuário (vinda do backend). */
export interface LearnedMemory {
  content: string;
  category: string;
}

export const MEMORY_CATEGORY_LABEL: Record<string, string> = {
  preferencia: "Preferência",
  rotina: "Rotina",
  contexto: "Contexto",
  motivacao: "Motivação",
  personalidade: "Jeito de ser",
  outro: "Sobre você",
};

/* ── Fase 2: memória controlável ──────────────────────────────────────────
   Estado, tempo e autoria. Tudo aqui é PURO (sem I/O): o cliente do Supabase
   vive em memoriesData.ts, e é essa separação que deixa a regra de leitura
   ser testada sem rede nem navegador. */

/** ativa: a IA deduziu e ninguém contestou · confirmada: a pessoa disse que
 *  está certo (vale mais) · rejeitada: a pessoa disse que não · expirada:
 *  passou do prazo. */
export type MemoryStatus = "ativa" | "confirmada" | "rejeitada" | "expirada";
export type MemorySensitivity = "normal" | "sensivel";
export type MemoryCreatedBy = "ia" | "usuario";

export const MEMORY_STATUS_LABEL: Record<MemoryStatus, string> = {
  ativa: "Aprendido",
  confirmada: "Confirmado por você",
  rejeitada: "Descartado",
  expirada: "Fora do prazo",
};

/** Limites do CHECK de `ai_memories.content` no banco. Validar aqui é o que
 *  transforma "erro 400 do PostgREST" em uma frase que a pessoa entende. */
export const MEMORY_CONTENT_MIN = 3;
export const MEMORY_CONTENT_MAX = 200;

/** Campos que a regra de leitura enxerga. Qualquer objeto com esta forma
 *  serve — inclusive as linhas cruas do banco. */
export interface MemoryValidityFields {
  status: string;
  valid_until?: string | null;
}

/**
 * REGRA DE LEITURA (a mesma da view ai_memories_vigentes, e a mesma que o
 * retrato do Conselheiro precisa respeitar):
 *   não pode estar rejeitada nem expirada, e o prazo não pode ter passado.
 *
 * `now` entra por parâmetro para o teste não depender do relógio.
 */
export function isMemoryVigente(m: MemoryValidityFields, now: Date = new Date()): boolean {
  if (m.status === "rejeitada" || m.status === "expirada") return false;
  if (!m.valid_until) return true;
  const until = Date.parse(m.valid_until);
  // Data ilegível não pode silenciosamente aposentar uma memória boa.
  return Number.isNaN(until) ? true : until > now.getTime();
}

/**
 * Ordem em que a memória entra no retrato: o que a pessoa CONFIRMOU vem
 * antes do que a IA supôs, e dentro de cada grupo o mais recente primeiro.
 * Espelha `trust_rank` da view — se mudar aqui, mude lá.
 */
export function compareMemoriesForSnapshot(
  a: { status: string; created_at?: string | null },
  b: { status: string; created_at?: string | null },
): number {
  const rank = (s: string) => (s === "confirmada" ? 0 : 1);
  const byTrust = rank(a.status) - rank(b.status);
  if (byTrust !== 0) return byTrust;
  return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
}

/** Aplica a regra de leitura e a ordem, na sequência. É esta função que
 *  qualquer lugar que monte contexto para a IA deveria chamar. */
export function selectMemoriesForSnapshot<T extends MemoryValidityFields & { created_at?: string | null }>(
  list: T[], now: Date = new Date(),
): T[] {
  return list.filter((m) => isMemoryVigente(m, now)).sort(compareMemoriesForSnapshot);
}

/** Resultado da validação. Sem união discriminada de propósito: o projeto
 *  compila com `strict: false`, e ali o TypeScript NÃO estreita
 *  `{ok:true}|{ok:false}` — quem consumisse teria que brigar com o tipo. */
export interface MemoryContentCheck {
  ok: boolean;
  /** Texto limpo. Só é confiável quando `ok`. */
  content: string;
  /** Frase pronta para a tela quando `ok` é false. */
  error: string | null;
}

/** Valida o conteúdo antes de gastar uma ida ao banco: os limites são os
 *  mesmos do CHECK de `ai_memories.content`, então falhar aqui evita um 400
 *  do PostgREST que ninguém consegue mostrar para a pessoa. */
export function validateMemoryContent(raw: string): MemoryContentCheck {
  const content = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (content.length < MEMORY_CONTENT_MIN) {
    return { ok: false, content, error: "Escreva um pouco mais para eu guardar direito." };
  }
  if (content.length > MEMORY_CONTENT_MAX) {
    return { ok: false, content, error: `Muito longo: no máximo ${MEMORY_CONTENT_MAX} caracteres.` };
  }
  return { ok: true, content, error: null };
}

/** Frase curta sobre o prazo, para a lista de memórias. */
export function memoryValidityLabel(
  m: MemoryValidityFields, now: Date = new Date(),
): string | null {
  if (!m.valid_until) return null;
  const until = Date.parse(m.valid_until);
  if (Number.isNaN(until)) return null;
  const dia = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(until));
  return until <= now.getTime() ? `Valeu até ${dia}` : `Vale até ${dia}`;
}

/* ── Prazo de validade: atalhos ───────────────────────────────────────────
   A conta do prazo mora aqui (e não na tela) para a data que a pessoa vê ser
   exatamente a que foi gravada — se cada lado calculasse a sua, a tela diria
   "até 31/12" e o banco guardaria outra coisa. */

export type MemoryValidityPreset = "fim_do_mes" | "3_meses" | "6_meses";

export const MEMORY_VALIDITY_PRESET_LABEL: Record<MemoryValidityPreset, string> = {
  fim_do_mes: "Até o fim do mês",
  "3_meses": "Por 3 meses",
  "6_meses": "Por 6 meses",
};

/**
 * Converte o atalho em um instante ISO para `valid_until`.
 *
 * O corte é sempre o FIM do dia escolhido, no fuso de São Paulo: uma memória
 * que vale "até o fim do mês" tem que valer o dia 31 inteiro, e não morrer
 * às 00:00 dele. (-03:00 fixo: o Brasil não tem horário de verão desde 2019.)
 */
export function validUntilFromPreset(preset: MemoryValidityPreset, now: Date = new Date()): string {
  const sp = new Date(now.getTime() - 3 * 3600_000); // relógio de SP em UTC
  const y = sp.getUTCFullYear();
  const m = sp.getUTCMonth();
  const d = sp.getUTCDate();
  const last = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  let year = y, month = m, day = d;
  if (preset === "fim_do_mes") {
    day = last(y, m);
  } else {
    const add = preset === "3_meses" ? 3 : 6;
    month = m + add;
    year = y + Math.floor(month / 12);
    month = ((month % 12) + 12) % 12;
    // 31 de janeiro + 3 meses não é 31 de abril: cai no último dia do mês.
    day = Math.min(d, last(year, month));
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month + 1)}-${p(day)}T23:59:59-03:00`;
}

/* ── Origem da memória, em linguagem de gente ────────────────────────────── */

export type MemorySourceKind = "life_event" | "chat_message" | "data_source";

export const MEMORY_SOURCE_LABEL: Record<MemorySourceKind, string> = {
  chat_message: "Do que você contou no Conselheiro",
  life_event: "De um registro no seu diário",
  data_source: "De um arquivo que você importou",
};

const MESES_CURTOS = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];

/** Linha única do cartão fechado: "Do que você contou no Conselheiro · 12/ago".
 *  Nunca mostra id — quando não há data, mostra só o rótulo. */
export function memorySourceLine(
  source: { kind: string; occurred_at?: string | null; created_at?: string | null },
): string {
  const label = MEMORY_SOURCE_LABEL[source.kind as MemorySourceKind] ?? "De algo que você registrou";
  const when = source.occurred_at ?? source.created_at ?? null;
  const t = when ? Date.parse(when) : NaN;
  if (Number.isNaN(t)) return label;
  // Mês escrito à mão, e não com Intl "short": o ICU do Node e o do navegador
  // discordam ("12 de ago." x "12 de ago"), e um teste que passa na máquina e
  // falha no CI (ou o contrário) não vale nada.
  const sp = new Date(t - 3 * 3600_000); // -03:00, como no resto do app
  const dia = String(sp.getUTCDate()).padStart(2, "0");
  return `${label} · ${dia}/${MESES_CURTOS[sp.getUTCMonth()]}`;
}

/**
 * O texto de "não tenho a origem disto".
 *
 * A versão anterior afirmava, sempre, que a memória era ANTERIOR ao momento em
 * que passamos a guardar origem (a migração da Fase 2). Para memórias antigas
 * isso é verdade. Para uma memória criada há segundos — o que acontece quando
 * a conversa produz memória mas nenhum evento, e portanto não há mensagem
 * registrada para apontar — era mentira, na tela cujo propósito inteiro é a
 * pessoa poder CONFERIR o que dizemos sobre ela.
 *
 * Afirmar uma explicação que não verificamos é pior que admitir a falha: a
 * pessoa não tem como saber que a frase é falsa, e passa a confiar menos em
 * tudo que está do lado dela.
 */
export function semOrigemTexto(createdAt: string): string {
  const nascida = new Date(createdAt).getTime();
  // Data ilegível cai no texto genérico: na dúvida, não afirme a explicação.
  const anterior = Number.isFinite(nascida) && nascida < ORIGEM_DESDE.getTime();
  return anterior
    ? "Esta memória não tem origem registrada — ela é anterior ao momento em que passei "
      + "a guardar de onde cada coisa veio. Se não fizer sentido, é só recusar."
    : "Não guardei de onde tirei esta. Acontece quando aprendo algo numa conversa "
      + "que não gerou nenhum registro. Se não fizer sentido, é só recusar.";
}

/** Quando `memory_sources` passou a existir (migração da Fase 2). Memória
 *  criada antes disto legitimamente não tem origem guardada. */
const ORIGEM_DESDE = new Date("2026-09-03T00:00:00Z");
