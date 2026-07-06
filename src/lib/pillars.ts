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
