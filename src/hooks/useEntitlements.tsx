// Permissões, limites e estado da assinatura — SÓ para exibição.
// A validação real acontece no servidor (Edge Functions).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface EntitlementsData {
  plan: "free" | "ascend_plus";
  limits: Record<string, number | boolean | null>;
  flags: Record<string, boolean>;
  subscription: {
    provider: string; status: string;
    current_period_end: string | null; cancel_at_period_end: boolean;
  } | null;
  usage: Record<string, number>;
  pricing: { monthly_label?: string; annual_label?: string } | null;
  /** Lua de mel do free (2 primeiras semanas, captura 10/dia): fim da janela. */
  honeymoon_until?: string | null;
}

export function useEntitlements() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["entitlements", user?.id],
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<EntitlementsData | null> => {
      const { data, error } = await supabase.functions.invoke("get-subscription", { body: {} });
      if (error || data?.error) return null;
      return data as EntitlementsData;
    },
  });
}