import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import Mokari from "@/components/core/Mokari";
import MokariInvite from "@/components/core/MokariInvite";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ChevronRight, Layers, BarChart3, ClipboardList, Swords, Users,
  AlertTriangle, RefreshCw, Loader2,
} from "lucide-react";
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
  to, title, icon: Icon, loading, error, state, invite, dots,
}: {
  to: string;
  title: string;
  icon: LucideIcon;
  loading?: boolean;
  /** Falha de leitura. Suprime a linha de estado E o convite: dizer
   *  "Nenhum plano ainda" — com botão para criar — a quem tem cinco é pior
   *  que não dizer nada. */
  error?: boolean;
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
                {error ? "Não consegui ler isto agora." : invite ? invite.line : state}
              </p>
            )}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </Link>
      {!loading && !error && invite && (
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

/** O estado do Social em UMA LINHA: quantos grupos, e o desafio em curso.
 *
 *  Consulta própria e barata (duas contagens), fora de `useJornadaData` porque
 *  o Social é opcional: quem nunca entrou num grupo não deve pagar nem uma
 *  consulta a mais para ver um hub que não fala dele.
 *
 *  Ela NUNCA traz contagem de não-lidos, de recados novos nem de convites
 *  pendentes — nada que possa virar bolinha. O hub diz onde as coisas estão;
 *  ele não cria urgência. */
function useSocialHubQuery() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["social-hub", user?.id],
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      /* `v_meus_grupos` em vez de `group_members`: a view já filtra o que é
         MEU e já sabe dizer o que está VIGENTE — um combinado que terminou não
         deve continuar contando como "2 grupos" no hub. */
      const { data: vinculos, error } = await supabase
        .from("v_meus_grupos").select("id,vigente");
      if (error) throw error;
      const ids = ((vinculos ?? []) as { id: string; vigente: boolean }[])
        .filter((g) => g.vigente).map((g) => g.id);
      if (!ids.length) return { grupos: 0, desafio: null as string | null };

      const hoje = todayISO();
      const { data: desafios } = await supabase
        .from("challenges").select("name,ends_on")
        .in("group_id", ids).gte("ends_on", hoje)
        .order("ends_on", { ascending: true }).limit(1);
      const d = (desafios ?? [])[0] as { name: string; ends_on: string } | undefined;
      return {
        grupos: ids.length,
        desafio: d
          ? `${d.name.toLowerCase()} termina ${new Date(d.ends_on + "T00:00:00")
            .toLocaleDateString("pt-BR", { weekday: "long" })}`
          : null,
      };
    },
  });
}

export default function Jornada() {
  const { profile } = useProfile();
  const { level } = useXp();

  const activity = usePillarActivityQuery();
  const trends = useTrendInsights();
  const plans = useJornadaPlansQuery();
  const habits = useJornadaHabitsQuery();
  const battles = useBattlesTodayQuery();
  const social = useSocialHubQuery();

  const algumErro = activity.isError || trends.isError || plans.isError
    || habits.isError || battles.isError || social.isError;
  const recarregando = activity.isFetching || trends.isFetching || plans.isFetching
    || habits.isFetching || battles.isFetching || social.isFetching;
  const recarregar = () => {
    void activity.refetch(); void trends.refetch(); void plans.refetch();
    void habits.refetch(); void battles.refetch(); void social.refetch();
  };

  /* ── Pilares ── */
  const active = activePillarSet(profile?.pillars);
  const activeCount = PILLARS.filter((p) => active.has(p.id)).length;
  const counts = activity.data ?? {};
  const top = PILLARS.filter((p) => active.has(p.id))
    .map((p) => ({ name: p.name, n: counts[p.id] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))[0];
  const pilarLabel = `${activeCount} ${activeCount === 1 ? "pilar ativo" : "pilares ativos"}`;
  const pillarState = top && top.n > 0
    ? `${pilarLabel} · mais movimento em ${top.name} (${top.n} ${top.n === 1 ? "registro" : "registros"} nos últimos 14 dias)`
    : `${pilarLabel} · nenhum registro nos últimos 14 dias`;

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
        ? `${bestSample} de ${MIN_OVERLAP_DAYS} dias registrados para a primeira tendência`
        : `sua primeira tendência aparece com ${MIN_OVERLAP_DAYS} dias de registro`;
  const scoreState = `Nível ${level} · ${levelTitle(level)} · ${trendPart}`;

  /* ── Planos: plano e compromissos nascem do mesmo lugar (o Conselheiro
        propõe os dois na mesma conversa), então o convite é único ── */
  const planCount = plans.data?.count ?? 0;
  const habitCount = habits.data ?? 0;
  const conselheiroComPergunta =
    `${appPath("conselheiro")}?q=${encodeURIComponent(SIGNATURE_QUESTION)}`;
  /* SEM NENHUM COMPROMISSO, este é o único lugar do app que oferece criar um.
     A lista mora na Hoje e se esconde sozinha quando está vazia — então quem
     arquivou o último, ou nunca teve, ficava sem porta nenhuma: o Conselheiro
     PROPÕE compromisso, ela não tem como PEDIR um.
     A porta não vira um convite novo: é este convite, que já existia, mudando
     de destino quando o que falta é compromisso e não plano. Com os dois
     zerados o Conselheiro continua na frente — ele propõe plano E compromissos
     na mesma conversa, e é a prova nº 1 do posicionamento. */
  const criarCompromisso = `${appPath("")}?novo=compromisso`;
  const planInvite = planCount === 0
    ? {
      line: habitCount > 0
        ? `${habitCount} ${habitCount === 1 ? "compromisso diário" : "compromissos diários"} · nenhum plano ainda`
        : "Nenhum plano ou compromisso ainda",
      label: "Peça o que cabe no seu bolso",
      to: conselheiroComPergunta,
    }
    : habitCount === 0
      ? {
        line: `${planCount} ${planCount === 1 ? "plano ativo" : "planos ativos"} · nenhum compromisso diário`,
        label: "Criar um compromisso diário",
        to: criarCompromisso,
      }
      : undefined;
  const planState = planCount > 0
    ? `${planCount} ${planCount === 1 ? "plano ativo" : "planos ativos"}${plans.data?.latest ? ` · ${plans.data.latest}` : ""}`
    : undefined;

  /* ── Social: uma linha, e nada mais ───────────────────────────────────
        Estado em uma linha, no mesmo formato das outras seções, e SEM badge,
        SEM bolinha e SEM contador de não-lidos — o `dots` do HubSection só
        carrega cor de pilar, e é para continuar assim. Bolinha vermelha é o
        motor de "abre o app", que é justamente o que o Dilema 4 proíbe.
        Quem nunca abrir o Social não deve sentir que ele existe: sem grupo,
        a linha diz o estado e o convite fica em tom baixo, como em Batalhas. */
  const grupos = social.data?.grupos ?? 0;
  const socialState = grupos > 0
    ? `${grupos} ${grupos === 1 ? "grupo" : "grupos"}${social.data?.desafio ? ` · ${social.data.desafio}` : ""}`
    : undefined;
  const socialInvite = grupos === 0
    ? {
      line: "Nenhum grupo",
      label: "Criar um grupo, se fizer sentido",
      to: appPath("social"),
    }
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

      {/* A BÚSSOLA, DE GRAÇA.
          `profile.goal` é a frase que a pessoa escreveu sobre a própria vida
          no primeiro bloco do onboarding — a razão pela qual ela está aqui. Ela
          aparecia em dois lugares no app inteiro, e um deles é o BriefingLocked
          (Hoje.tsx), ou seja, ATRÁS DO PAYWALL. A bússola dela era conteúdo
          pago: informação DELA usada como isca.

          Isso não é dark pattern por intenção, é por descuido — e o conserto é
          uma dívida, não uma melhoria. Aqui ela também ganha função: é a única
          linha da tela que dá sentido ao XP. Sem ela, "254/350 para o nível 9"
          é um número sobre nada, e um sistema de pontos extrínseco sem âncora
          na meta da própria pessoa corrói a motivação em vez de sustentá-la. */}
      {profile?.goal && (
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Sua bússola</p>
          <p className="text-sm mt-0.5">"{profile.goal}"</p>
          <Link
            to={appPath("ajustes")}
            className="text-xs text-muted-foreground underline underline-offset-2 mt-1.5 inline-block hover:text-foreground"
          >
            Mudar meu objetivo
          </Link>
        </Card>
      )}

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

      {/* Aviso ÚNICO: na falha comum (rede fora) as quatro caem juntas, e
          quatro botões de "tentar de novo" seriam mais ruído que informação. */}
      {algumErro && (
        <Card className="p-3.5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--warning))" }} />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-medium">Não consegui ler parte da sua jornada.</p>
            <p className="text-xs text-muted-foreground">
              Parece falha de conexão. Seus planos, batalhas e registros continuam salvos —
              o que falhou foi carregar a tela, não os seus dados.
            </p>
            <Button variant="outline" size="sm" onClick={recarregar} disabled={recarregando}>
              {recarregando
                ? (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Tentando...</>)
                : (<><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Tentar de novo</>)}
            </Button>
          </div>
        </Card>
      )}

      <div className="space-y-2.5">
        <HubSection
          to={appPath("pilares")}
          title="Pilares"
          icon={Layers}
          loading={activity.isLoading}
          error={activity.isError}
          state={pillarState}
          dots={PILLARS.filter((p) => active.has(p.id)).map((p) => p.colorVar)}
        />
        <HubSection
          to={appPath("score")}
          title="Indicadores"
          icon={BarChart3}
          loading={trends.isLoading}
          error={trends.isError}
          state={scoreState}
        />
        <HubSection
          to={appPath("planos")}
          title="Planos"
          icon={ClipboardList}
          loading={plans.isLoading || habits.isLoading}
          error={plans.isError || habits.isError}
          state={planState}
          invite={planInvite}
        />
        <HubSection
          to={appPath("social")}
          title="Social"
          icon={Users}
          loading={social.isLoading}
          error={social.isError}
          state={socialState}
          invite={socialInvite}
        />
        <HubSection
          to={appPath("batalhas")}
          title="Batalhas"
          icon={Swords}
          loading={battles.isLoading}
          error={battles.isError}
          state={battleState}
          invite={battleInvite}
        />
      </div>
    </div>
  );
}
