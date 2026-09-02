import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { todayISOInSP, daysAgoISOInSP } from "@/lib/dates";
import { readDailyMetrics } from "@/lib/insightsData";
import { computeInsights } from "@/lib/insights";

/** Janela das tendências: três meses. */
export const TREND_LOOKBACK_DAYS = 90;

/**
 * As tendências, calculadas no cliente a partir de daily_metrics.
 *
 * UMA definição só, compartilhada pela seção da tela Indicadores e pela linha
 * de estado do hub — mesma queryKey com queryFn diferente envenenaria o cache
 * de um dos dois (ver o comentário em useZoneQueries.tsx).
 *
 * A data de referência é PARÂMETRO do cálculo, nunca lida do relógio lá
 * dentro: é o que permite rodar duas vezes e obter o mesmo resultado, que é o
 * critério de pronto da Fase 3.
 */
export function useTrendInsights() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["trend-insights", user?.id, todayISOInSP()],
    enabled: !!user,
    queryFn: async () => {
      const referenceDay = todayISOInSP();
      const rows = await readDailyMetrics(
        user!.id, daysAgoISOInSP(TREND_LOOKBACK_DAYS - 1), referenceDay,
      );
      return computeInsights(rows, referenceDay, TREND_LOOKBACK_DAYS);
    },
  });
}
