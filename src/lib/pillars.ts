import { Coins, HeartPulse, Apple, Sparkles, type LucideIcon } from "lucide-react";

export type PillarId = "prosperidade" | "vitalidade" | "alimentacao" | "mente";

export interface PillarMeta {
  id: PillarId;
  name: string;
  attribute: string;   // nome do atributo no "jogo de vida"
  desc: string;
  icon: LucideIcon;
  colorVar: string;    // CSS var
  route: string;
}

export const PILLARS: PillarMeta[] = [
  { id: "prosperidade", name: "Prosperidade", attribute: "Prosperidade", desc: "Dinheiro sob controle, sem ansiedade", icon: Coins, colorVar: "--prosperidade", route: "/app/prosperidade" },
  { id: "vitalidade", name: "Vitalidade", attribute: "Vitalidade", desc: "Corpo, sono, treino e energia", icon: HeartPulse, colorVar: "--vitalidade", route: "/app/vitalidade" },
  { id: "alimentacao", name: "Alimentação", attribute: "Nutrição", desc: "Comer bem, dentro do seu orçamento", icon: Apple, colorVar: "--alimentacao", route: "/app/alimentacao" },
  { id: "mente", name: "Mente & Espírito", attribute: "Serenidade", desc: "Humor, gratidão e sua prática espiritual", icon: Sparkles, colorVar: "--mente", route: "/app/mente" },
];

/* ── FUSÃO DE 17/09/2026 — `alimentacao` foi ABSORVIDO por `vitalidade` ───
   Não é renomeação de dois num terceiro: é uma direção só. `alimentacao`
   continua no banco em linha antiga, em perfil não migrado e em proposta
   gravada por uma instância anterior ao deploy. As funções desta seção são o
   inteiro do que o front sabe sobre isso — em vez de um `|| "alimentacao"`
   espalhado por cada consulta, que é como um apelido temporário vira eterno
   sem ninguém conseguir listar onde ele está.

   A REGRA, e ela resolve três bugs do mesmo tipo em lugares diferentes: toda
   leitura de `pillar` vinda do BANCO passa por uma destas funções. Escrita
   grava só o id canônico; leitura aceita os dois. Comparar
   `linha.pillar === "vitalidade"` na mão é o bug — ele não falha em voz alta,
   só devolve zero para quem mais registrou. */

/** Gêmeo de `canonicalPillar` de supabase/functions/_shared/lib.ts, que o
 *  navegador não consegue importar (aquele arquivo é Deno, com imports por
 *  URL). A tabela é a mesma; se uma mudar, a outra muda junto.
 *
 *  Este é o SEGUNDO CINTO da fusão: mesmo recebendo `alimentacao` de uma
 *  função velha ainda no ar, a linha entra no banco como `vitalidade`. Com o
 *  cinto do servidor, é o que faz a ordem do deploy não importar. */
const PILLAR_BY_KIND: Record<string, PillarId> = {
  transaction: "prosperidade",
  sleep: "vitalidade", nap: "vitalidade", workout: "vitalidade",
  meal: "vitalidade", water: "vitalidade", weight: "vitalidade", body: "vitalidade",
  mood: "mente", gratitude: "mente", practice: "mente", journal: "mente",
  note: "mente",
};
const PILLAR_ALIASES: Record<string, PillarId> = { alimentacao: "vitalidade" };

export function canonicalPillar(kind: string, raw?: string | null): PillarId {
  const byKind = PILLAR_BY_KIND[String(kind)];
  if (byKind) return byKind;
  const r = String(raw ?? "");
  return PILLAR_ALIASES[r] ?? (PILLARS.some((p) => p.id === r) ? (r as PillarId) : "mente");
}

/** Os valores que uma coluna `pillar` do banco pode ter para ESTE pilar.
 *  Leitor tolerante: enquanto existir linha histórica não migrada, contar só
 *  `vitalidade` zeraria a contagem de quem mais registrou — e contagem zerada
 *  por refatoração é o app apagando o que a pessoa construiu. */
export const pillarMatchValues = (id: PillarId): string[] =>
  id === "vitalidade" ? ["vitalidade", "alimentacao"] : [id];

/**
 * A lista de `profiles.pillars` traduzida e limpa: apelido resolvido, id
 * desconhecido descartado, sem repetição, na ordem de PILLARS.
 *
 * MESMA DOUTRINA DA LEITURA DERIVADA DOS ESCOPOS, e ela faltava aqui.
 * `profiles.pillars` de um perfil não migrado ainda diz `alimentacao`, e a
 * migration é otimização, não correção — então quem traduz é o CLIENTE, na
 * leitura. Sem esta tradução, `activePillarSet` descartava `alimentacao` no
 * filtro e caía num de dois desfechos, os dois errados em direções opostas:
 *
 *   ["alimentacao"]          → lista vazia → o fallback devolvia os TRÊS
 *                              pilares, e quem pausou Prosperidade e Mente de
 *                              propósito as recebia de volta sem pedir;
 *   ["alimentacao","mente"]  → ["mente"], e a pessoa PERDIA a Vitalidade que
 *                              tinha.
 *
 * O fallback "nunca escondemos o app inteiro por engano" continua existindo e
 * continua certo — o que estava errado era chegar nele com uma lista que só
 * ficou vazia porque o tradutor não rodou.
 *
 * Serve à LEITURA e à ESCRITA pelo mesmo motivo: a tela que monta o estado dos
 * interruptores a partir da lista crua mostra Vitalidade DESLIGADA para quem a
 * tem ligada — e grava de volta um array em que ela nunca esteve. Quem grava
 * `profiles.pillars` passa por aqui primeiro.
 */
export function normalizePillars(pillars?: string[] | null): PillarId[] {
  const vistos = new Set<PillarId>();
  for (const raw of pillars ?? []) {
    const id = PILLAR_ALIASES[String(raw)] ?? String(raw);
    if (PILLARS.some((p) => p.id === id)) vistos.add(id as PillarId);
  }
  return PILLARS.filter((p) => vistos.has(p.id)).map((p) => p.id);
}

/** O pilar de um id que veio do BANCO — e por isso resolve o apelido antes de
 *  procurar. Sem isso, `pillarById("alimentacao")` devolve `undefined` e todo
 *  consumidor com `?.` degrada calado: o hábito antigo perde a cor e o rótulo
 *  na Hoje, no Chat e no Onboarding, e a proposta que veio de uma instância
 *  ainda velha da função pinta um pontinho cinza com o id cru do lado.
 *  Nenhum desses erra em voz alta — que é exatamente o motivo de a tradução
 *  morar aqui dentro, e não em cada chamador. */
export const pillarById = (id: string) => {
  const canonico = PILLAR_ALIASES[String(id)] ?? String(id);
  return PILLARS.find((p) => p.id === canonico);
};

/* ── Modularidade REAL (plano de feedbacks, Sugestão 1) ──────────────────
   O toggle de pilares deixa de ser cosmético: o app inteiro se reorganiza
   em volta do que a pessoa ativou. Estes helpers são a fonte única de
   verdade para Hoje, Pilares, Score, CaptureBar e onboarding. */

/** Conjunto de pilares ativos. Sem perfil (carregando) ou lista vazia,
 *  considera todos ativos — nunca escondemos o app inteiro por engano.
 *
 *  A tradução do apelido acontece ANTES do filtro (ver normalizePillars): é
 *  essa ordem que impede um perfil não migrado de cair no fallback por
 *  engano, que seria devolver o app inteiro a quem escolheu parte dele. */
export function activePillarSet(pillars?: string[] | null): Set<PillarId> {
  const list = normalizePillars(pillars);
  return new Set(list.length ? list : PILLARS.map((p) => p.id));
}

export const isPillarActive = (pillars: string[] | null | undefined, id: PillarId) =>
  activePillarSet(pillars).has(id);

/** Infere o pilar da meta digitada no onboarding (Sugestão 1: "comece com 1
 *  — o da meta que a pessoa digitou no passo 1"). Heurística de palavras,
 *  local e instantânea; empates resolvidos pela ordem dos padrões. */
const GOAL_PATTERNS: [PillarId, RegExp][] = [
  ["prosperidade", /dinheiro|d[íi]vida|salário|salario|orçamento|orcamento|gastar|gasto|poupar|economi|renda|financ|investir|juntar|reserva|bolso|conta/i],
  ["vitalidade", /trein|academia|muscul|massa|emagrec|peso|corr|forç|forca|energia|dormir|sono|condicionamento|shape|corpo/i],
  ["alimentacao", /comer|comida|diet|aliment|nutri|prote[íi]na|caloria|refei|cozinh|açúcar|acucar/i],
  ["mente", /ansied|estresse|medita|orar|oraç|oracao|f[ée]\b|deus|gratid|foco|clareza|paz|mente|humor|espírito|espirito|h[áa]bito de leitura/i],
];
export function inferPillarFromGoal(goal: string): PillarId | null {
  const g = (goal ?? "").trim();
  if (!g) return null;
  for (const [id, re] of GOAL_PATTERNS) if (re.test(g)) return id;
  return null;
}

/** Exemplos da CaptureBar coerentes com os pilares ativos
 *  ("Gastei 47 no mercado e treinei pernas" não faz sentido para quem
 *  desligou Vitalidade — Sugestão 1). */
const EXAMPLES_BY_PILLAR: Record<PillarId, string[]> = {
  prosperidade: ["Gastei 47 no mercado", "Recebi 250 de um freela", "Paguei 89 de internet"],
  vitalidade: ["Treinei pernas hoje", "Dormi umas 6h, tô meio cansado", "Corri 5km de manhã"],
  alimentacao: ["Almocei frango com arroz", "Tomei 2 copos de água agora", "Café da manhã: pão e ovo"],
  mente: ["Orei de manhã, tô mais leve", "Dia meio ansioso, humor ruim", "Meditei 10 minutos"],
};
const COMBO_EXAMPLES: [PillarId[], string][] = [
  [["prosperidade", "vitalidade"], "Gastei 47 no mercado e treinei pernas"],
  [["alimentacao", "mente"], "Almocei frango com arroz, orei de manhã"],
  [["vitalidade", "mente"], "Dormi mal e acordei ansioso"],
  [["prosperidade", "alimentacao"], "Gastei 32 no almoço fora"],
];
export function captureExamplesFor(pillars?: string[] | null): string[] {
  const active = activePillarSet(pillars);
  const out: string[] = [];
  for (const [combo, phrase] of COMBO_EXAMPLES) {
    if (combo.every((p) => active.has(p))) out.push(phrase);
  }
  for (const p of PILLARS) {
    if (active.has(p.id)) out.push(EXAMPLES_BY_PILLAR[p.id][out.length % 3]);
    if (out.length >= 4) break;
  }
  return out.length ? out.slice(0, 4) : EXAMPLES_BY_PILLAR.prosperidade;
}