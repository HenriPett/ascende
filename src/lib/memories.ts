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
