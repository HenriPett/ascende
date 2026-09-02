import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/* Dados das linhas de estado do hub /app/jornada.
 *
 * O hub existe para responder "vale entrar?" sem entrar. Se cada seção fosse
 * só um link, ele não valeria a tela — então as quatro linhas são dado REAL.
 *
 * Regra que vale para qualquer coisa nova aqui: uma queryKey, um queryFn, um
 * lugar (ver useZoneQueries.tsx para o estrago que a alternativa causa). */

/** Registros por pilar nos últimos 14 dias. Compartilhada com a tela Pilares. */
export function usePillarActivityQuery() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pillar-activity", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data } = await supabase.from("life_events")
        .select("pillar").eq("user_id", user!.id).gte("occurred_at", since);
      const c: Record<string, number> = {};
      for (const e of data ?? []) c[e.pillar] = (c[e.pillar] ?? 0) + 1;
      return c;
    },
  });
}

/**
 * Planos ativos: contagem e o título mais recente.
 *
 * Chave PRÓPRIA, e não a de `active-plans-hoje`: aquela é limitada a 3 (é uma
 * prévia da Hoje), e usar contagem limitada aqui mostraria "3 planos" para
 * quem tem sete. O hub afirma um número, então precisa do número certo.
 */
export function useJornadaPlansQuery() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["jornada-plans", user?.id],
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data } = await supabase.from("plans")
        .select("id,title")
        .eq("user_id", user!.id).eq("status", "ativo")
        .order("created_at", { ascending: false });
      const list = (data ?? []) as { id: string; title: string }[];
      return { count: list.length, latest: list[0]?.title ?? null };
    },
  });
}

/** Compromissos diários ativos — o hub precisa do número para a linha de
 *  Planos ("2 compromissos diários · nenhum plano ainda"). Chave própria: a
 *  de `habits-today` carrega logs e sequências que aqui não servem. */
export function useJornadaHabitsQuery() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["jornada-habits", user?.id],
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { count } = await supabase.from("habits")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id).eq("active", true);
      return count ?? 0;
    },
  });
}
