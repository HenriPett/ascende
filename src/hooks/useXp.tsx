import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { levelFromXp } from "@/lib/xp";

export function useXp() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["xp", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("xp_log").select("points").eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).reduce((s, r) => s + r.points, 0);
    },
  });
  const xp = query.data ?? 0;
  return { xp, ...levelFromXp(xp), refresh: () => qc.invalidateQueries({ queryKey: ["xp", user?.id] }) };
}
