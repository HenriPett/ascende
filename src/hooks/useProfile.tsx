import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface WaterBottle {
  label: string;
  ml: number;
}

export const DEFAULT_WATER_GOAL_ML = 2000;
export const DEFAULT_WATER_BOTTLES: WaterBottle[] = [
  { label: "Copo", ml: 250 },
  { label: "Garrafa", ml: 500 },
  { label: "Garrafão", ml: 1000 },
];

export const JOURNAL_COLORS: { id: string; label: string; hsl: string }[] = [
  { id: "violeta", label: "Violeta", hsl: "258 30% 50%" },
  { id: "oceano", label: "Oceano", hsl: "205 60% 42%" },
  { id: "floresta", label: "Floresta", hsl: "150 35% 34%" },
  { id: "terracota", label: "Terracota", hsl: "12 58% 46%" },
  { id: "ouro", label: "Ouro", hsl: "41 62% 42%" },
  { id: "rosa", label: "Rosa", hsl: "335 55% 52%" },
  { id: "grafite", label: "Grafite", hsl: "220 10% 38%" },
];
export const journalColorHsl = (id?: string | null) =>
  (JOURNAL_COLORS.find((c) => c.id === id) ?? JOURNAL_COLORS[0]).hsl;

/**
 * A tinta legível sobre uma cor de diário.
 *
 * O botão "Guardar no diário" pinta o fundo com a cor escolhida pela pessoa e
 * mantinha a tinta escura do botão padrão: sobre violeta isso dava 3,36:1,
 * abaixo do mínimo AA de 4,5:1 (QA visual, M2). Branco resolveria seis das sete
 * cores — e falharia justamente no ouro (3,45:1). Então a escolha é calculada:
 * ganha a tinta de maior contraste. Pior caso das sete passa a ser 4,68:1.
 *
 * Fórmula de luminância relativa da WCAG 2.1. Fica aqui, ao lado das cores que
 * ela serve; quando `src/lib` estiver livre, é candidata natural a mudar de casa.
 */
export function journalInkHsl(id?: string | null): string {
  const [h, s, l] = journalColorHsl(id).split(/\s+/).map((v) => parseFloat(v));
  const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
  const x = c * (1 - Math.abs((((h / 60) % 2) + 2) % 2 - 1));
  const m = l / 100 - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg].map((v) => v + m);
  const lum = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const Lbg = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  // Contraste contra branco (L=1) e contra a tinta escura da casa (L≈0.0086).
  const vsWhite = 1.05 / (Lbg + 0.05);
  const vsInk = (Lbg + 0.05) / (0.0086 + 0.05);
  return vsWhite >= vsInk ? "0 0% 100%" : "240 25% 10%";
}

export interface Profile {
  user_id: string;
  name: string | null;
  pillars: string[];
  spirituality_label: string | null;
  monthly_income: number | null;
  monthly_budget: number | null;
  /** Dia do mês em que o ciclo financeiro vira (1-28). Null/1 = mês civil. */
  financial_cycle_day: number | null;
  goal: string | null;
  onboarded: boolean;
  water_goal_ml: number | null;
  water_bottles: WaterBottle[] | null;
  journal_color: string | null;
  has_religion: boolean | null;
  weight_goal_kg: number | null;
  health_conditions: string[] | null;
  medications: string[] | null;
  birth_year: number | null;
  sex: string | null;
  height_cm: number | null;
  activity_level: string | null;
  dietary_restrictions: string[] | null;
  calorie_goal_kcal: number | null;
  protein_goal_g: number | null;
  daily_spend_limit: number | null;
  weekly_workouts_goal: number | null;
  sleep_goal_h: number | null;
  /** Raio-X de Vitalidade: estimativas declaradas (não são registros). */
  est_workouts_week: number | null;
  est_sleep_h: number | null;
  guides_seen: string[] | null;
  /** Rotina de sono declarada (estilo iPhone): "HH:MM[:SS]" ou null. */
  sleep_bedtime: string | null;
  sleep_waketime: string | null;
  /** Modularidade por tracker: só guarda o desligado ({"water": false}). */
  tracking_prefs: Record<string, boolean> | null;
  /** Gasto mensal aproximado com comida (Blueprint do onboarding). */
  est_food_spend: number | null;
  /** Quando o Blueprint da Subida foi gerado (cortesia, 1x por conta). */
  blueprint_generated_at: string | null;
  /** Mokari: TRÊS estados num campo anulável, e a anulabilidade É o dado.
   *  null = nunca perguntamos (o convite aparece uma vez na Jornada) ·
   *  false = ela disse não, ou desligou depois (silêncio) · true = ligado.
   *  Não troque por `not null default false`: isso apagaria a diferença
   *  entre "nunca perguntei" e "ela recusou", e o convite passaria a
   *  aparecer para sempre ou nunca. */
  mokari_enabled: boolean | null;
}

export function useProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles").select("*").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      // O trigger do banco cria o perfil no cadastro; se ainda não existir, cria aqui.
      if (!data) {
        const { data: created } = await supabase
          .from("profiles")
          .insert({ user_id: user!.id, name: user!.user_metadata?.name ?? "" })
          .select().maybeSingle();
        return created as Profile | null;
      }
      return data as Profile;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["profile", user?.id] });
  // `profile: null` tinha DOIS significados — "ainda não carregou/não existe" e
  // "a leitura falhou" — e quem consome não tinha como separar. Formulário em
  // branco por falha de rede parece perfil vazio, e a tela age em cima disso.
  // O contrato antigo continua igual; `isError` é adição.
  return {
    profile: query.data ?? null,
    loading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,
    refresh,
  };
}