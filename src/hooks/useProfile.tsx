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

export interface Profile {
  user_id: string;
  name: string | null;
  pillars: string[];
  spirituality_label: string | null;
  monthly_income: number | null;
  monthly_budget: number | null;
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
  return { profile: query.data ?? null, loading: query.isLoading, refresh };
}