import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { todayISO } from "@/lib/format";
import { daysAgoISOInSP } from "@/lib/dates";
import type { Battle, BattleCheckin } from "@/lib/battles";

/* Queries compartilhadas pelas zonas da Hoje que vivem em componentes próprios.
 *
 * POR QUE EXISTE, E É IMPORTANTE
 * A Fase 4 precisa saber se uma zona TEM conteúdo antes de renderizá-la. A
 * primeira versão dos hooks de visibilidade repetia a query com a mesma
 * `queryKey` mas um `queryFn` diferente — e isso não é duplicação inofensiva:
 * no React Query a chave é a identidade do cache, então quem resolvesse
 * primeiro ditaria o FORMATO do dado para os dois consumidores. O
 * `HabitsToday` quebraria em `data.logs` porque o hook de visibilidade tinha
 * gravado no cache um objeto só com `habits`.
 *
 * A regra que sai disso: uma queryKey, um queryFn, um lugar. Componente e hook
 * de visibilidade importam DAQUI. */

export interface WhatsappLink {
  phone: string | null;
  linked_at: string | null;
  notify_retro: boolean;
  notify_briefing: boolean;
  notify_return: boolean;
}

/** A pessoa já registrou sono hoje? */
export function useSleepTodayQuery(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["sleep-today", user?.id, todayISO()],
    enabled: enabled && !!user,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const { count } = await supabase.from("life_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id).eq("kind", "sleep")
        .gte("occurred_at", dayStart.toISOString());
      return (count ?? 0) > 0;
    },
  });
}

/** Batalhas ativas + check-ins dos últimos 120 dias. */
export function useBattlesTodayQuery() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["battles-today", user?.id, todayISO()],
    enabled: !!user,
    queryFn: async () => {
      const [batalhas, checkins] = await Promise.all([
        supabase.from("battles").select("*").eq("user_id", user!.id)
          .eq("active", true).order("created_at"),
        supabase.from("battle_checkins").select("*").eq("user_id", user!.id)
          .gte("checkin_date", daysAgoISOInSP(120)),
      ]);
      // Vazio só pode significar vazio: sem isto, uma falha de leitura fazia
      // o hub dizer "Nenhuma batalha declarada" e CONVIDAR a declarar uma —
      // para quem já está no meio de uma.
      if (batalhas.error) throw batalhas.error;
      if (checkins.error) throw checkins.error;
      const battles = batalhas.data;
      return {
        battles: (battles ?? []) as Battle[],
        checkins: (checkins.data ?? []) as BattleCheckin[],
      };
    },
  });
}

/** Vínculo do WhatsApp. `pollingWhileCode` acelera a revalidação enquanto o
 *  código de pareamento está na tela. */
export function useWhatsappLinkQuery(pollingWhileCode: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["whatsapp-link", user?.id],
    enabled: !!user,
    refetchInterval: (q) =>
      pollingWhileCode && !(q.state.data as WhatsappLink | null)?.linked_at ? 4000 : false,
    queryFn: async (): Promise<WhatsappLink | null> => {
      const { data } = await supabase.from("whatsapp_links")
        .select("phone, linked_at, notify_retro, notify_briefing, notify_return")
        .maybeSingle();
      return (data as WhatsappLink | null) ?? null;
    },
  });
}

/** Já existe algum registro na conta? (o convite do WhatsApp não compete com
 *  o dia 1 do onboarding). */
export function useHasAnyEventQuery(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["wa-hoje-has-events", user?.id],
    enabled: enabled && !!user,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { count } = await supabase.from("life_events")
        .select("id", { count: "exact", head: true }).eq("user_id", user!.id);
      return (count ?? 0) > 0;
    },
  });
}
