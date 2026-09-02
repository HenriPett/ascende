import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { todayISOInSP, daysAgoISOInSP } from "@/lib/dates";
import { readDailyMetrics, upsertInsight } from "@/lib/insightsData";
import { computeInsights, type InsightRun } from "@/lib/insights";

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
      const run = computeInsights(rows, referenceDay, TREND_LOOKBACK_DAYS);
      void persistRun(user!.id, run);
      return run;
    },
  });
}

/**
 * Grava o que foi calculado. A Fase 3 pede período, amostra, versão da regra e
 * fontes PERSISTIDOS — sem isso, `insights` fica vazia e a tabela existe à toa.
 *
 * Por que só `tendencia` e `sem_tendencia`: `dados_insuficientes` não é um
 * resultado, é a ausência dele. Guardar "ainda faltam 9 dias" todo dia encheria
 * a tabela com uma contagem regressiva e não com a história de leituras.
 *
 * Uma linha por dia, por análise, e não uma por visita: o índice único inclui
 * `period_start`/`period_end`, que só mudam na virada do dia — abrir a tela dez
 * vezes hoje atualiza a mesma linha. É o que transforma a gravação no registro
 * do que a pessoa VIU naquele dia, que é exatamente o ponto de guardar a versão
 * do cálculo junto: daqui a seis meses dá para dizer que um número antigo saiu
 * de outra regra, em vez de o passado se reescrever sozinho.
 *
 * `void` de propósito: falhar aqui não pode derrubar a tela. A pessoa veio ver
 * a própria vida; o nosso registro histórico é problema nosso.
 */
async function persistRun(userId: string, run: InsightRun): Promise<void> {
  for (const insight of run.insights) {
    if (insight.status === "dados_insuficientes") continue;
    try {
      await upsertInsight({
        userId,
        kind: insight.kind,
        calcVersion: insight.calc_version,
        periodStart: insight.period?.start ?? run.window.start,
        periodEnd: insight.period?.end ?? run.window.end,
        sampleSize: insight.sample_size,
        status: insight.status,
        result: insight as unknown as Record<string, unknown>,
      });
    } catch {
      // Silêncio proposital: ver o comentário acima.
    }
  }
}
