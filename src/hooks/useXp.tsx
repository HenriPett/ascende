import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { levelFromXp } from "@/lib/xp";

/**
 * XP total do usuário.
 *
 * Antes isto baixava TODA a xp_log para o navegador e somava lá. Além de
 * crescer sem teto (uma linha por registro), o PostgREST corta a resposta no
 * `max-rows` do projeto (1000 por padrão no Supabase): a partir daí o XP e o
 * nível simplesmente paravam de subir, e divergiam do que a IA via no retrato.
 * O agregado vive no banco desde sempre (`xp_total`, setup.sql §10) — é ele
 * que o buildSnapshot usa. Agora o app usa a mesma fonte.
 */
export function useXp() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["xp", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("xp_total", { uid: user!.id });
      if (error) throw error;
      // bigint pode chegar como string do PostgREST; Number() normaliza.
      return Number(data ?? 0);
    },
  });
  const xp = query.data ?? 0;
  return { xp, ...levelFromXp(xp), refresh: () => qc.invalidateQueries({ queryKey: ["xp", user?.id] }) };
}
