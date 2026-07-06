import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface Profile {
  user_id: string;
  name: string | null;
  pillars: string[];
  spirituality_label: string | null;
  monthly_income: number | null;
  monthly_budget: number | null;
  goal: string | null;
  onboarded: boolean;
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
