import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { todayISOInSP, daysAgoISOInSP } from "@/lib/dates";
import {
  computeMokari, RECENT_WINDOW_DAYS, type Mokari, type MokariEvent, type XpEntry,
} from "@/lib/mokari";

/* Os dados do Mokari — e só eles.
 *
 * A query só roda quando o Mokari está LIGADO (`enabled`). Isso não é
 * otimização: é a regra 5. Desligado, ele não custa nem uma requisição, então
 * não há como "desligar o Mokari" mudar o comportamento de qualquer outra
 * coisa — nem a latência da tela.
 *
 * DUAS LEITURAS, e o motivo é o método: estágio, afinidade e ambiente são
 * marca-d'água sobre TODA a história (precisam do começo); o estado recente
 * olha os últimos sete dias (precisa do fim). Uma leitura só, com limite, teria
 * que escolher qual das duas pontas sacrificar.
 *
 * LIMITE, declarado: 5000 linhas de cada. O PostgREST corta em `max-rows` de
 * qualquer forma, e ler em ordem CRESCENTE é o que protege a marca-d'água — os
 * limiares mais altos (3000 de XP, 40 registros por pilar) são alcançados muito
 * antes disso, então o corte não muda o resultado de ninguém real. Se um dia
 * mudar, o conserto é um agregado no banco, não um limite maior. */

export function useMokariData(enabled: boolean) {
  const { user } = useAuth();

  return useQuery<Mokari>({
    queryKey: ["mokari", user?.id, todayISOInSP()],
    enabled: enabled && !!user,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const referenceDay = todayISOInSP();
      const desde = daysAgoISOInSP(RECENT_WINDOW_DAYS - 1);

      const [historico, recentes, xpRows] = await Promise.all([
        supabase.from("life_events")
          .select("id,occurred_at,pillar,kind")
          .eq("user_id", user!.id)
          .order("occurred_at", { ascending: true }).limit(5000),
        supabase.from("life_events")
          .select("id,occurred_at,pillar,kind")
          .eq("user_id", user!.id)
          .gte("occurred_at", `${desde}T00:00:00-03:00`)
          .order("occurred_at", { ascending: true }).limit(1000),
        supabase.from("xp_log")
          .select("created_at,points,reason")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: true }).limit(5000),
      ]);

      // Deduplicação por id: um evento recente também aparece no histórico
      // quando a conta é pequena, e contá-lo duas vezes inflaria a afinidade.
      type Row = { id: string; occurred_at: string; pillar: string; kind: string };
      const porId = new Map<string, Row>();
      for (const r of [...(historico.data ?? []), ...(recentes.data ?? [])] as Row[]) {
        porId.set(r.id, r);
      }
      const events: MokariEvent[] = [...porId.values()].map((r) => ({
        occurred_at: r.occurred_at, pillar: r.pillar, kind: r.kind,
      }));

      const xp = ((xpRows.data ?? []) as XpEntry[]).map((r) => ({
        created_at: r.created_at, points: Number(r.points) || 0, reason: String(r.reason ?? ""),
      }));

      // O primeiro registro é o começo da jornada. Sem registro, o ambiente
      // fica na primeira etapa — que é o certo: o tempo conta de quando a
      // história começou, não de quando a conta foi criada.
      const journeyStart = events.length
        ? events.map((e) => e.occurred_at).sort()[0].slice(0, 10)
        : undefined;

      return computeMokari(xp, events, referenceDay, journeyStart);
    },
  });
}
