import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link2, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { brl } from "@/lib/format";
import { todayISOInSP, daysAgoISOInSP } from "@/lib/dates";
import { readDailyMetrics } from "@/lib/insightsData";
import {
  computeInsights, MIN_OVERLAP_DAYS, MIN_GROUP_DAYS,
  type Insight, type InsightKind,
} from "@/lib/insights";

/* Tendências — o que aconteceu junto na sua vida, medido pelo código.
 *
 * A regra de ouro da fase: o modelo explica, o CÓDIGO calcula. Nenhum número
 * desta tela passou por um LLM — vêm todos de `computeInsights`, função pura,
 * com a data de referência entrando por parâmetro para que rodar duas vezes dê
 * exatamente o mesmo resultado.
 *
 * Decisões de desenho da Prisma que o fundador endossou, e que parecem
 * estranhas até a gente entender por quê:
 *
 * • SEM PORCENTAGEM. Duas medianas concretas lado a lado ("R$ 62 · R$ 91"). A
 *   pessoa confere isso olhando a própria vida; "23% menor" ela decora e
 *   repete sem saber conferir.
 * • SEM VERDE/VERMELHO E SEM SETA. Pintar "gastou menos" de verde embute juízo
 *   numa associação e empurra a leitura de CAUSA — o único erro que esta fase
 *   existe para impedir. A única cor do card são os pontinhos de pilar.
 * • OS TRÊS ESTADOS APARECEM. "Não encontrei padrão" é resultado, e
 *   `dados_insuficientes` é o que a maioria vai ver no começo: usa a MESMA
 *   silhueta dos outros (card que encolhe lê como quebrado), sem vermelho, sem
 *   ícone de alerta e sem a palavra "insuficiente" — a espera virou progresso.
 *
 * Amostra e período ficam visíveis logo abaixo da manchete, sem clique: é o
 * que dá ou tira o peso da frase. */

/** Frase constante do produto. Nunca varia: constante que muda perde a função
 *  de âncora. Aparece em TODOS os cards, inclusive quando não há tendência. */
const LIMIT_PHRASE = "Isso aconteceu junto — não quer dizer que um causou o outro.";

const LOOKBACK_DAYS = 90;

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "1/jul" — dia sem zero à esquerda e mês escrito à mão (o ICU do navegador
 *  e o do Node discordam no ponto final de "ago."). */
function shortDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${Number(m[3])}/${MESES[Number(m[2]) - 1]}`;
}

const money = (v: number) => brl(v);
const hours = (v: number) => `${String(v).replace(".", ",")}h`;

interface KindCopy {
  /** Pontinhos de pilar: a única cor do card. Duas áreas = cruzamento;
   *  uma = dentro da mesma área. Dois pontinhos iguais não informariam nada. */
  pillars: string[];
  /** Manchete, nas duas direções que o cálculo pode devolver. */
  headline: Record<"maior" | "menor", string>;
  noTrend: string;
  /** Estado sem dados: a primeira linha nomeia a pergunta que ainda não dá
   *  para responder; a segunda diz o que falta. */
  waitingHeadline: string;
  waitingOverlap: (faltam: number) => string;
  /** Rótulos presos ao GRUPO, nunca ao valor (ver aviso abaixo). */
  highLabel: string;
  highSuffix?: string;
  lowLabel: string;
  lowSuffix?: string;
  format: (v: number) => string;
  /** Convite do lado que falta. Um só: dois viram lista de tarefas. */
  missing: { label: string; to: string };
}

/* ATENÇÃO, e é o erro mais caro possível nesta tela:
   `high_group_median` é a mediana do grupo ALTO DO LADO ESQUERDO — NÃO é o
   maior número da tela. Quando a associação é invertida, ele é o MENOR dos
   dois. Os rótulos abaixo são fixos por posição e amarrados ao GRUPO:
   "Depois de treinar" sempre acompanha o grupo alto, "Em dias sem treino"
   sempre o baixo. Ordenar para o maior aparecer primeiro inverteria a leitura
   da pessoa sem nenhum aviso. */
const COPY: Record<InsightKind, KindCopy> = {
  sono_gasto_seguinte: {
    pillars: ["--vitalidade", "--prosperidade"],
    headline: {
      menor: "Nos dias seguintes às noites em que você dormiu mais, seu gasto foi menor.",
      maior: "Nos dias seguintes às noites em que você dormiu mais, seu gasto foi maior.",
    },
    noTrend: "Dormindo mais ou dormindo menos, seu gasto do dia seguinte ficou parecido.",
    waitingHeadline: "Ainda não dá para dizer se o seu sono e o gasto do dia seguinte andam juntos.",
    waitingOverlap: (faltam) =>
      `Faltam ${faltam} dias com sono e gasto registrados para eu conseguir comparar.`,
    highLabel: "Depois de dormir mais",
    highSuffix: "no dia",
    lowLabel: "Depois de dormir menos",
    format: money,
    missing: { label: "Registrar o sono de hoje", to: "/app" },
  },
  refeicao_gasto_comida: {
    pillars: ["--alimentacao", "--prosperidade"],
    headline: {
      menor: "Nos dias em que você registrou mais refeições, seu gasto com comida foi menor.",
      maior: "Nos dias em que você registrou mais refeições, seu gasto com comida foi maior.",
    },
    noTrend: "Registrando mais ou menos refeições, seu gasto com comida ficou parecido.",
    waitingHeadline:
      "Ainda não dá para dizer se registrar as refeições e o seu gasto com comida andam juntos.",
    waitingOverlap: (faltam) =>
      `Faltam ${faltam} dias com refeição e gasto com comida no mesmo dia.`,
    highLabel: "Dias com mais refeições registradas",
    lowLabel: "Dias com menos",
    format: money,
    missing: { label: "Registrar uma refeição", to: "/app/alimentacao" },
  },
  treino_sono: {
    pillars: ["--vitalidade"],
    headline: {
      maior: "Nas noites dos dias em que você treinou, você dormiu mais.",
      menor: "Nas noites dos dias em que você treinou, você dormiu menos.",
    },
    noTrend: "Com treino ou sem treino, seu sono naquelas noites ficou parecido.",
    waitingHeadline: "Ainda não dá para dizer se o seu treino e o seu sono da noite andam juntos.",
    waitingOverlap: (faltam) => `Faltam ${faltam} dias com treino e sono registrados.`,
    highLabel: "Depois de treinar",
    highSuffix: "de sono",
    lowLabel: "Em dias sem treino",
    format: hours,
    missing: { label: "Registrar um treino", to: "/app/vitalidade" },
  },
};

function PillarDots({ vars }: { vars: string[] }) {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {vars.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: `hsl(var(${v}))` }}
        />
      ))}
    </div>
  );
}

/** Amostra e período, logo abaixo da manchete. Com menos de 30 dias avisa que
 *  a leitura pode mudar; com 30 ou mais, o silêncio é que comunica firmeza. */
function Evidence({ days, start, end }: { days: number; start: string; end: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      {days} dias com os dois registrados, de {shortDay(start)} a {shortDay(end)}.
      {days < 30 && " Ainda é pouco tempo: a leitura pode mudar."}
    </p>
  );
}

function LimitPhrase() {
  return (
    <p className="text-xs text-muted-foreground flex items-start gap-1.5">
      <Link2 className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
      <span>{LIMIT_PHRASE}</span>
    </p>
  );
}

/** As duas medianas lado a lado — o número que a pessoa confere olhando a
 *  própria vida. Sem porcentagem, sem seta, sem cor. */
function Medians({
  copy, high, low,
}: { copy: KindCopy; high: number; low: number }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[
        { label: copy.highLabel, value: high, suffix: copy.highSuffix },
        { label: copy.lowLabel, value: low, suffix: copy.lowSuffix },
      ].map((side) => (
        <div key={side.label} className="rounded-lg border px-3 py-2">
          <p className="text-[11px] text-muted-foreground">{side.label}</p>
          <p className="font-display text-lg font-semibold leading-tight">
            {copy.format(side.value)}
          </p>
          {side.suffix && <p className="text-[11px] text-muted-foreground">{side.suffix}</p>}
        </div>
      ))}
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const copy = COPY[insight.kind];
  if (!copy) return null;

  return (
    <Card className="p-4 space-y-2.5">
      <PillarDots vars={copy.pillars} />

      {insight.status === "tendencia" && (
        <>
          <p className="text-sm font-medium">{copy.headline[insight.direction]}</p>
          {insight.period && (
            <Evidence days={insight.sample_size} start={insight.period.start} end={insight.period.end} />
          )}
          <Medians copy={copy} high={insight.high_group_median} low={insight.low_group_median} />
        </>
      )}

      {insight.status === "sem_tendencia" && (
        <>
          <p className="text-sm font-medium">{copy.noTrend}</p>
          {insight.period && (
            <Evidence days={insight.sample_size} start={insight.period.start} end={insight.period.end} />
          )}
          <Medians copy={copy} high={insight.high_group_median} low={insight.low_group_median} />
        </>
      )}

      {insight.status === "dados_insuficientes" && (
        <>
          <p className="text-sm font-medium">{copy.waitingHeadline}</p>

          {/* A espera vira progresso, no mesmo padrão do "Complete seu retrato"
              da tela Hoje. Sem vermelho, sem ícone de alerta, sem a palavra
              "insuficiente": não há nada errado, só falta tempo. */}
          {insight.reason === "overlap" && (
            <>
              <p className="text-sm text-muted-foreground">
                {insight.sample_size} de {MIN_OVERLAP_DAYS} dias
              </p>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.round((insight.sample_size / MIN_OVERLAP_DAYS) * 100))}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {copy.waitingOverlap(insight.days_missing)}
              </p>
            </>
          )}

          {/* Estes dois casos não são falta de tempo, e dizer "faltam N dias"
              seria impreciso: aqui falta VARIEDADE de dias. */}
          {insight.reason === "grupo_pequeno" && (
            <p className="text-sm text-muted-foreground">
              Já tenho {insight.sample_size} dias, mas ainda faltam {insight.days_missing} de
              um dos dois tipos de dia — para comparar eu preciso de pelo menos
              {" "}{MIN_GROUP_DAYS} de cada lado.
            </p>
          )}
          {insight.reason === "sem_variacao" && (
            <p className="text-sm text-muted-foreground">
              Nesses {insight.sample_size} dias esse lado quase não variou. Sem dias diferentes
              entre si, não há o que comparar.
            </p>
          )}

          <Button asChild variant="outline" size="sm">
            <Link to={copy.missing.to}>{copy.missing.label}</Link>
          </Button>
        </>
      )}

      <LimitPhrase />
    </Card>
  );
}

export default function TrendInsights() {
  const { user } = useAuth();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["trend-insights", user?.id, todayISOInSP()],
    enabled: !!user,
    queryFn: async () => {
      // A data de referência é PARÂMETRO do cálculo, nunca lida do relógio lá
      // dentro: é o que permite rodar duas vezes e obter o mesmo resultado.
      const referenceDay = todayISOInSP();
      const rows = await readDailyMetrics(
        user!.id, daysAgoISOInSP(LOOKBACK_DAYS - 1), referenceDay,
      );
      return computeInsights(rows, referenceDay, LOOKBACK_DAYS);
    },
  });

  return (
    <section className="space-y-2.5" aria-label="Tendências">
      <div>
        <h2 className="font-display text-lg font-semibold">O que andou junto</h2>
        <p className="text-sm text-muted-foreground">
          Comparações calculadas sobre os seus próprios registros dos últimos três meses.
          O número vem do código, não da IA — e cada card mostra quantos dias entraram.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-4 space-y-2.5">
              <Skeleton className="h-1.5 w-8 rounded-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-14 rounded-lg" />
                <Skeleton className="h-14 rounded-lg" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {isError && (
        <Card className="p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--warning))" }} />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-medium">Não consegui calcular suas tendências agora.</p>
            <p className="text-xs text-muted-foreground">
              É falha de conexão — seus registros continuam salvos, e nenhuma leitura foi perdida.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching
                ? (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Tentando...</>)
                : (<><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Tentar de novo</>)}
            </Button>
          </div>
        </Card>
      )}

      {!isLoading && !isError && data?.insights.map((insight) => (
        <InsightCard key={insight.kind} insight={insight} />
      ))}
    </section>
  );
}
