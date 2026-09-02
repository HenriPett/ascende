import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import Mokari from "@/components/core/Mokari";
import MokariInvite from "@/components/core/MokariInvite";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, Layers, BarChart3, ClipboardList, Swords } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { useXp } from "@/hooks/useXp";
import { useTrendInsights } from "@/hooks/useTrendInsights";
import { useBattlesTodayQuery } from "@/hooks/useZoneQueries";
import {
  usePillarActivityQuery, useJornadaPlansQuery, useJornadaHabitsQuery,
} from "@/hooks/useJornadaData";
import { PILLARS, activePillarSet } from "@/lib/pillars";
import { computeBattleStats } from "@/lib/battles";
import { levelTitle } from "@/lib/xp";
import { MIN_OVERLAP_DAYS } from "@/lib/insights";
import { appPath } from "@/lib/routes";
import { todayISO } from "@/lib/format";

/* /app/jornada — o hub da Fase 4.
 *
 * A regra que define esta tela: um hub que é só uma lista de quatro links não
 * vale a tela que ocupa. Se a pessoa precisa entrar para saber se tem algo
 * lá, o hub não resolveu nada. Então cada seção mostra o ESTADO ATUAL em uma
 * linha, com dado real, e seção vazia mostra o convite curto NO LUGAR da
 * linha — nunca card apagado, nunca "você ainda não tem nada aqui".
 *
 * E o mais importante: este hub é uma porta A MAIS, não a única porta.
 * /app/pilares, /app/score, /app/planos e /app/batalhas continuam abrindo as
 * telas inteiras direto, sem passar por aqui — quem clica num link do
 * WhatsApp quer chegar onde o link prometeu. */

const SIGNATURE_QUESTION =
  "Monte um plano alimentar para o meu objetivo que caiba no meu orçamento";

/** Uma seção do hub. `state` é a linha de estado; `invite` a substitui quando
 *  não há nada — mesmo lugar, mesmo tamanho. */
function HubSection({
  to, title, icon: Icon, loading, state, invite, dots,
}: {
  to: string;
  title: string;
  icon: LucideIcon;
  loading?: boolean;
  state?: string;
  invite?: { line: string; label: string; to: string };
  /** Só Pilares usa cor, e como pontinhos: quatro seções com quatro cores
   *  viram semáforo. */
  dots?: string[];
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <Link
        to={to}
        className="flex items-center gap-3 p-4 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="w-9 h-9 rounded-md grid place-items-center shrink-0 bg-muted">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold">{title}</p>
            {dots?.length ? (
              <span className="flex items-center gap-0.5" aria-hidden>
                {dots.map((v, i) => (
                  <span
                    key={`${v}-${i}`}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: `hsl(var(${v}))` }}
                  />
                ))}
              </span>
            ) : null}
          </div>
          {/* Esqueleto do tamanho EXATO da linha: se o card pular de altura ao
              carregar, a tela treme na entrada. */}
          {loading
            ? <Skeleton className="h-5 w-3/4 mt-0.5" />
            : (
              <p className="text-sm text-muted-foreground truncate">
                {invite ? invite.line : state}
              </p>
            )}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </Link>
      {!loading && invite && (
        <div className="px-4 pb-3 -mt-1">
          <Link
            to={invite.to}
            className="text-sm underline underline-offset-2 text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {invite.label}
          </Link>
        </div>
      )}
    </Card>
  );
}

export default function Jornada() {
  const { profile } = useProfile();
  const { level } = useXp();

  const activity = usePillarActivityQuery();
  const trends = useTrendInsights();
  const plans = useJornadaPlansQuery();
  const habits = useJornadaHabitsQuery();
  const battles = useBattlesTodayQuery();

  /* ── Pilares ── */
  const active = activePillarSet(profile?.pillars);
  const activeCount = PILLARS.filter((p) => active.has(p.id)).length;
  const counts = activity.data ?? {};
  const top = PILLARS.filter((p) => active.has(p.id))
    .map((p) => ({ name: p.name, n: counts[p.id] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))[0];
  const pillarState = top && top.n > 0
    ? `${activeCount} pilares ativos · mais movimento em ${top.name} (${top.n} registros em 14 dias)`
    : `${activeCount} pilares ativos · nenhum registro nos últimos 14 dias`;

  /* ── Indicadores: a linha mais valiosa do hub — diz se vale entrar ── */
  const insights = trends.data?.insights ?? [];
  const readable = insights.filter((i) => i.status === "tendencia").length;
  const anyNoTrend = insights.some((i) => i.status === "sem_tendencia");
  const bestSample = insights.reduce(
    (max, i) => (i.status === "dados_insuficientes" ? Math.max(max, i.sample_size) : max), 0,
  );
  const trendPart = readable > 0
    ? `${readable} ${readable === 1 ? "tendência" : "tendências"} para ler`
    : anyNoTrend
      ? "nenhum padrão encontrado ainda"
      : bestSample > 0
        ? `${bestSample} de ${MIN_OVERLAP_DAYS} dias para a primeira tendência`
        : `sua primeira tendência aparece com ${MIN_OVERLAP_DAYS} dias de registro`;
  const scoreState = `Nível ${level} · ${levelTitle(level)} · ${trendPart}`;

  /* ── Planos: plano e compromissos nascem do mesmo lugar (o Conselheiro
        propõe os dois na mesma conversa), então o convite é único ── */
  const planCount = plans.data?.count ?? 0;
  const habitCount = habits.data ?? 0;
  const conselheiroComPergunta =
    `${appPath("conselheiro")}?q=${encodeURIComponent(SIGNATURE_QUESTION)}`;
  const planInvite = planCount === 0
    ? {
      line: habitCount > 0
        ? `${habitCount} ${habitCount === 1 ? "compromisso diário" : "compromissos diários"} · nenhum plano ainda`
        : "Nenhum plano ou compromisso ainda",
      label: "Peça o que cabe no seu bolso",
      to: conselheiroComPergunta,
    }
    : undefined;
  const planState = planCount > 0
    ? `${planCount} ${planCount === 1 ? "plano ativo" : "planos ativos"}${plans.data?.latest ? ` · ${plans.data.latest}` : ""}`
    : undefined;

  /* ── Batalhas: tom baixo e condicional, de propósito. É o assunto mais
        íntimo do app — "Comece agora!" ali é invasivo. ── */
  const battleList = battles.data?.battles ?? [];
  const checkins = battles.data?.checkins ?? [];
  const today = todayISO();
  const doneToday = new Set(
    checkins.filter((c) => c.checkin_date === today).map((c) => c.battle_id),
  );
  const pending = battleList.some((b) => !doneToday.has(b.id));
  const totalClean = battleList.reduce(
    (sum, b) => sum + computeBattleStats(checkins.filter((c) => c.battle_id === b.id)).totalClean, 0,
  );
  const battleLabel = `${battleList.length} ${battleList.length === 1 ? "batalha" : "batalhas"}`;
  const battleState = battleList.length > 0
    ? (pending
      ? `${battleLabel} · check-in de hoje pendente`
      : `${battleLabel} · ${totalClean} ${totalClean === 1 ? "dia limpo acumulado" : "dias limpos acumulados"}`)
    : undefined;
  const battleInvite = battleList.length === 0
    ? {
      line: "Nenhuma batalha declarada",
      label: "Declarar uma batalha, se fizer sentido",
      to: appPath("batalhas"),
    }
    : undefined;

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold">Jornada</h1>
        <p className="text-sm text-muted-foreground">
          O acumulado da sua subida. A tela Hoje é o dia; aqui é o caminho.
        </p>
      </div>

      {/* O Mokari no TOPO — e só aqui.
          Não vai para a Hoje: a Hoje é o dia e acabou de ser cortada para 5
          zonas na Fase 4; enchê-la de novo na semana seguinte desfaria a fase
          anterior. A Jornada é a tela do caminho, e é onde um espelho da
          jornada faz sentido.
          Os dois componentes são mutuamente exclusivos pela preferência:
          desligado ou recusado, NENHUM dos dois renderiza — nem card, nem
          moldura, nem "ative o Mokari". */}
      <Mokari />
      <MokariInvite />

      <div className="space-y-2.5">
        <HubSection
          to={appPath("pilares")}
          title="Pilares"
          icon={Layers}
          loading={activity.isLoading}
          state={pillarState}
          dots={PILLARS.filter((p) => active.has(p.id)).map((p) => p.colorVar)}
        />
        <HubSection
          to={appPath("score")}
          title="Indicadores"
          icon={BarChart3}
          loading={trends.isLoading}
          state={scoreState}
        />
        <HubSection
          to={appPath("planos")}
          title="Planos"
          icon={ClipboardList}
          loading={plans.isLoading || habits.isLoading}
          state={planState}
          invite={planInvite}
        />
        <HubSection
          to={appPath("batalhas")}
          title="Batalhas"
          icon={Swords}
          loading={battles.isLoading}
          state={battleState}
          invite={battleInvite}
        />
      </div>
    </div>
  );
}
