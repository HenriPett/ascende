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

export const pillarById = (id: string) => PILLARS.find((p) => p.id === id);

/* ── Modularidade REAL (plano de feedbacks, Sugestão 1) ──────────────────
   O toggle de pilares deixa de ser cosmético: o app inteiro se reorganiza
   em volta do que a pessoa ativou. Estes helpers são a fonte única de
   verdade para Hoje, Pilares, Score, CaptureBar e onboarding. */

/** Conjunto de pilares ativos. Sem perfil (carregando) ou lista vazia,
 *  considera todos ativos — nunca escondemos o app inteiro por engano. */
export function activePillarSet(pillars?: string[] | null): Set<PillarId> {
  const list = (pillars ?? []).filter((p): p is PillarId => PILLARS.some((x) => x.id === p));
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