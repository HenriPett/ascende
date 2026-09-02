import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useXp } from "@/hooks/useXp";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PILLARS, activePillarSet } from "@/lib/pillars";
import { activeTrackerSet } from "@/lib/trackers";
import { levelTitle, nextTitle, xpReasonLabel } from "@/lib/xp";
import { monthStartISO } from "@/lib/format";
import { daysAgoISOInSP } from "@/lib/dates";
import { distinctLocalDays } from "@/lib/localDays";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import TrendInsights from "@/components/core/TrendInsights";
import { Flame, TrendingUp, TrendingDown, Minus, CalendarCheck, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";

function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }

/** Cola a frase com espaço INQUEBRÁVEL (U+00A0), escrito como escape para o
 *  próximo leitor VER que não é espaço comum.
 *
 *  Vale só para as unidades que perdem sentido partidas em duas linhas: o NOME
 *  do título ("Ritmo de Trilha" virava "Ritmo de / Trilha") e o par de XP
 *  ("254 / 350"). A frase inteira continua podendo quebrar ENTRE as unidades —
 *  colar tudo faria o texto transbordar a coluna em vez de acomodar. */
const nbsp = (s: string) => s.replace(/ /g, "\u00A0");

/** Anel grande do nível, com brilho dourado. */
function LevelRing({ level, progress }: { level: number; progress: number }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="relative w-[132px] h-[132px] shrink-0 gold-glow">
      <svg viewBox="0 0 132 132" className="w-full h-full -rotate-90">
        <circle cx="66" cy="66" r={r} fill="none" stroke="hsl(0 0% 100% / 0.12)" strokeWidth="9" />
        <circle
          cx="66" cy="66" r={r} fill="none"
          stroke="hsl(var(--gold))" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - progress)}
          style={{ transition: "stroke-dashoffset .6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] uppercase tracking-widest text-white/60">Nível</span>
        <span className="font-display text-5xl font-semibold leading-none" style={{ color: "hsl(var(--gold))" }}>
          {level}
        </span>
      </div>
    </div>
  );
}

export default function Score() {
  const { user } = useAuth();
  const { profile } = useProfile();
  // Modularidade total: componentes de trackers desligados saem das fórmulas
  // (quem não acompanha sono não é medido por sono) — e o "porquê" explica.
  const trackers = activeTrackerSet(profile);
  const { xp, level, progress, nextFloor, currentFloor } = useXp();
  const title = levelTitle(level);
  const upcoming = nextTitle(level);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["score-data", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since14 = new Date(Date.now() - 14 * 864e5).toISOString();
      const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
      const [events, txs, habits, logs, weekXp] = await Promise.all([
        supabase.from("life_events").select("pillar,kind,occurred_at,payload").eq("user_id", user!.id).gte("occurred_at", since14),
        supabase.from("transactions").select("kind,amount").eq("user_id", user!.id).gte("occurred_at", monthStartISO()),
        supabase.from("habits").select("id").eq("user_id", user!.id).eq("active", true),
        supabase.from("habit_logs").select("log_date").eq("user_id", user!.id).gte("log_date", daysAgoISOInSP(13)),
        supabase.from("xp_log").select("points,reason,created_at").eq("user_id", user!.id).gte("created_at", since7).order("created_at", { ascending: false }).limit(60),
      ]);
      // Antes o `error` de cada chamada era descartado no destructuring, e
      // uma falha virava lista vazia — indistinguível de "você não registrou
      // nada". Um indicador que erra para baixo em silêncio é pior que
      // indicador nenhum: propague e deixe a tela dizer que falhou.
      const failed = [events, txs, habits, logs, weekXp].find((r) => r.error);
      if (failed?.error) throw failed.error;
      return {
        events: events.data ?? [],
        txs: txs.data ?? [],
        habitsCount: (habits.data ?? []).length,
        logs: logs.data ?? [],
        weekXp: weekXp.data ?? [],
      };
    },
  });

  const xpWeek = (data?.weekXp ?? []).reduce((s, r) => s + r.points, 0);
  /* DIA DISTINTO NO FUSO DO APP, não o dia UTC do carimbo.
     Os três contadores de dias desta tela (aqui, `mealDays` e `practices`)
     usavam `slice(0, 10)` sobre um timestamptz, que é o dia UTC. Com SP em
     UTC-3, tudo registrado das 21:00 em diante caía no dia seguinte e dias
     vizinhos COLAPSAVAM num só — ver lib/localDays.ts para o mecanismo.

     EFEITO COLATERAL ESPERADO: os indicadores de quem registra à noite VÃO
     SUBIR com esta correção, e é para subir — o número antigo estava baixo
     porque perdia dias reais, não porque a pessoa tivesse feito menos. Se
     alguém comparar com um print antigo e achar que "inflou", é isto. */
  const activeDays = distinctLocalDays((data?.weekXp ?? []).map((r) => String(r.created_at)));

  // Feed: de onde veio o XP
  const xpFeed = (data?.weekXp ?? []).slice(0, 8);
  const timeAgo = (iso: string) => {
    const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `há ${mins} min`;
    const h = Math.round(mins / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? "ontem" : `há ${d} dias`;
  };

  // ─── Cálculo do score por pilar (0–100, transparente) ───
  const scores: Record<string, { value: number | null; why: string }> = {
    prosperidade: { value: null, why: "Registre entradas e gastos e este indicador aparece." },
    vitalidade: { value: null, why: "Crie hábitos e registre seu sono e este indicador aparece." },
    alimentacao: { value: null, why: "Registre refeições e este indicador aparece." },
    mente: { value: null, why: "Registre humor e prática e este indicador aparece." },
  };

  if (data) {
    const { events, txs, habitsCount, logs } = data;

    // Prosperidade: saldo do mês em relação às entradas
    const income = txs.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
    const expense = txs.filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
    if (income > 0 || expense > 0) {
      if (income > 0) {
        const ratio = (income - expense) / income; // 0 = gastou tudo; 0.2+ = ótimo
        scores.prosperidade = { value: clamp(50 + ratio * 250), why: "Baseado no saldo do mês em relação às entradas." };
      } else {
        scores.prosperidade = { value: 40, why: "Há gastos registrados, mas nenhuma entrada este mês." };
      }
    }

    // Vitalidade: conclusão de hábitos (14d) + sono médio vs. 7–8h.
    // O componente de sono só entra se a pessoa ACOMPANHA sono (tracker).
    const parts: number[] = [];
    const whyParts: string[] = [];
    if (habitsCount > 0) { parts.push(clamp((logs.length / (habitsCount * 14)) * 100)); whyParts.push("conclusão de hábitos"); }
    if (trackers.has("sleep")) {
      const sleeps = events.filter((e) => e.kind === "sleep").map((e) => Number((e.payload as { hours?: number })?.hours)).filter((n) => n > 0);
      if (sleeps.length) {
        const avg = sleeps.reduce((a, b) => a + b, 0) / sleeps.length;
        parts.push(clamp(100 - Math.abs(avg - 7.5) * 22));
        whyParts.push("sono médio (ideal ~7,5h)");
      }
    }
    if (parts.length) {
      scores.vitalidade = {
        value: clamp(parts.reduce((a, b) => a + b, 0) / parts.length),
        why: `Baseado em: ${whyParts.join(" e ")}.` + (trackers.has("sleep") ? "" : " Sono fora da conta: você escolheu não acompanhar."),
      };
    }

    // Alimentação: dias com refeição registrada nos últimos 14 (só se a
    // pessoa acompanha refeições — tracker).
    if (trackers.has("meals")) {
      // Dias distintos no fuso do app (ver o comentário de `activeDays`): com
      // `slice(0, 10)` o jantar de terça 22h e o almoço de quarta 12h viravam
      // o mesmo dia, e este score ficava na metade para quem janta tarde.
      const mealDays = distinctLocalDays(
        events.filter((e) => e.kind === "meal").map((e) => e.occurred_at),
      );
      if (mealDays > 0) {
        scores.alimentacao = { value: clamp((mealDays / 14) * 100), why: "Baseado em quantos dos últimos 14 dias tiveram refeições registradas." };
      }
    } else {
      scores.alimentacao = { value: null, why: "Você escolheu não acompanhar refeições — sem indicador, de propósito." };
    }

    // Mente: média de humor + frequência de prática/diário — cada componente
    // só entra se o tracker correspondente estiver ativo.
    const mparts: number[] = [];
    const mwhy: string[] = [];
    if (trackers.has("mood")) {
      const moods = events.filter((e) => e.kind === "mood").map((e) => Number((e.payload as { score?: number })?.score)).filter((n) => n >= 1);
      if (moods.length) { mparts.push(clamp(((moods.reduce((a, b) => a + b, 0) / moods.length) - 1) * 25)); mwhy.push("humor médio"); }
    }
    const practiceKinds = [
      ...(trackers.has("practice") ? ["practice"] : []),
      ...(trackers.has("journal") ? ["journal"] : []),
    ];
    if (practiceKinds.length) {
      // Dias distintos no fuso do app (ver o comentário de `activeDays`).
      const practices = distinctLocalDays(
        events.filter((e) => practiceKinds.includes(e.kind)).map((e) => e.occurred_at)
      );
      if (practices > 0) { mparts.push(clamp((practices / 14) * 100)); mwhy.push("frequência de prática e diário"); }
    }
    if (mparts.length) {
      scores.mente = { value: clamp(mparts.reduce((a, b) => a + b, 0) / mparts.length), why: `Baseado em: ${mwhy.join(" e ")}.` };
    }
  }

  // Modularidade real (Sugestão 1): os indicadores mostram só os pilares
  // ativos — antes, o pilar "inativo" aparecia esmaecido, e quem escolheu
  // "só dinheiro" continuava vendo um app de quatro áreas.
  const activePillars = activePillarSet(profile?.pillars);
  const shownPillars = PILLARS.filter((p) => activePillars.has(p.id));
  const pausedPillars = PILLARS.filter((p) => !activePillars.has(p.id));

  // Tendência por pilar: atividade dos últimos 7 dias × 7 dias anteriores.
  const trendByPillar: Record<string, "up" | "down" | "flat" | null> = {};
  if (data) {
    const now = Date.now();
    for (const p of PILLARS) {
      const evs = data.events.filter((e) => e.pillar === p.id);
      if (!evs.length) { trendByPillar[p.id] = null; continue; }
      const recent = evs.filter((e) => now - new Date(e.occurred_at).getTime() <= 7 * 864e5).length;
      const previous = evs.length - recent;
      trendByPillar[p.id] = recent > previous ? "up" : recent < previous ? "down" : "flat";
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          Indicadores
          <Badge variant="secondary" className="text-[10px] font-normal align-middle">beta</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          O XP mede a sua <strong>consistência</strong> (registrar, praticar) e nunca diminui.
          Os indicadores por pilar são aproximações em revisão: use-os como bússola, não como nota.
        </p>
      </div>

      {/* ── Herói do nível ───────────────────────────────────── */}
      <Card className="level-hero border-0 text-white overflow-hidden">
        <div className="p-5 sm:p-6">
          {/* No CELULAR o anel vai PARA CIMA e o texto ocupa a largura toda.
              Lado a lado, a coluna do texto sobrava ~163px ao lado do anel de
              132px, e nessa largura toda frase daqui quebrava no lugar errado:
              "Ritmo de / Trilha", "254 / 350 XP para o nível / 5",
              "Trilheiro no / nível 5".

              Por que empilhar em vez de só estreitar a fonte ou apertar o
              anel: o título é dado variável, não texto fixo. Os nomes vão até
              "Horizonte Infinito" e "Domador de Picos" (lib/xp), e qualquer
              largura que eu escolhesse para caber "Trilheiro" voltaria a
              quebrar no título mais longo — o sintoma da rodada 1, que só
              parou de aparecer porque o título da vez tem uma palavra. Com a
              largura inteira (~350px em 390px de tela) o nome mais longo cabe
              em uma linha, e o `sm:` preserva o lado a lado onde há espaço.

              O `nbsp` abaixo é o cinto de segurança: mesmo que um título novo
              não caiba, ele não se parte no meio do nome nem separa "nível" do
              seu número — a frase transborda ou empurra, mas não mente sobre
              onde termina o nome. */}
          <div className="flex flex-col items-center text-center gap-4 sm:flex-row sm:items-center sm:text-left sm:gap-5">
            <LevelRing level={level} progress={progress} />
            <div className="min-w-0 w-full sm:flex-1">
              <p className="text-[11px] uppercase tracking-widest text-white/55">Título da subida</p>
              <p className="font-display text-2xl sm:text-3xl font-semibold" style={{ color: "hsl(var(--gold))" }}>
                {nbsp(title)}
              </p>
              <p className="text-sm text-white/75 mt-1">
                {nbsp(`${xp - currentFloor} / ${nextFloor - currentFloor}`)} XP para o {nbsp(`nível ${level + 1}`)}
              </p>
              {upcoming && (
                <p className="text-xs text-white/55 mt-0.5">
                  Próximo título: <span className="text-white/80">{nbsp(upcoming.title)}</span>
                  {" "}no {nbsp(`nível ${upcoming.atLevel}`)}
                </p>
              )}
            </div>
          </div>

          {/* Marcos da trilha */}
          <div className="mt-5">
            <div className="relative h-2 rounded-full bg-white/10">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${progress * 100}%`,
                  background: "linear-gradient(90deg, hsl(42 88% 48%), hsl(46 96% 62%))",
                  transition: "width .6s ease",
                }}
              />
              {[0.25, 0.5, 0.75].map((m) => (
                <span key={m} className="absolute top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-white/40" style={{ left: `${m * 100}%` }} />
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-white/50 mt-1.5">
              <span>Nv {level}</span>
              <span>Nv {level + 1}</span>
            </div>
          </div>

          {/* Estatísticas rápidas */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="rounded-lg border border-white/10 px-3 py-2" style={{ background: "hsl(0 0% 100% / 0.07)" }}>
              <p className="text-[11px] text-white/55 flex items-center gap-1"><Flame className="w-3 h-3" /> XP total</p>
              <p className="text-sm font-semibold">{xp}</p>
            </div>
            <div className="rounded-lg border border-white/10 px-3 py-2" style={{ background: "hsl(0 0% 100% / 0.07)" }}>
              <p className="text-[11px] text-white/55 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> XP na semana</p>
              <p className="text-sm font-semibold">{data ? xpWeek : "—"}</p>
            </div>
            <div className="rounded-lg border border-white/10 px-3 py-2" style={{ background: "hsl(0 0% 100% / 0.07)" }}>
              <p className="text-[11px] text-white/55 flex items-center gap-1"><CalendarCheck className="w-3 h-3" /> Dias ativos (7 dias)</p>
              <p className="text-sm font-semibold">{data ? `${activeDays}/7` : "—"}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* De onde veio seu XP */}
      {isLoading && (
        <Card className="p-4">
          <h2 className="font-display font-semibold mb-3">De onde veio seu XP (7 dias)</h2>
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-5 w-[3.25rem] rounded-full shrink-0" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-3 w-14 shrink-0" />
              </div>
            ))}
          </div>
        </Card>
      )}
      {!isLoading && xpFeed.length > 0 && (
        <Card className="p-4">
          <h2 className="font-display font-semibold mb-3">De onde veio seu XP (7 dias)</h2>
          <div className="space-y-1.5">
            {xpFeed.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="shrink-0 inline-flex items-center justify-center min-w-[3.25rem] text-xs font-bold rounded-full px-2 py-0.5 text-gold-ink"
                  style={{ background: "hsl(var(--gold) / 0.15)" }}>
                  +{r.points} XP
                </span>
                <span className="flex-1 min-w-0 truncate">{xpReasonLabel(r.reason)}</span>
                <span className="text-xs text-muted-foreground shrink-0">{timeAgo(String(r.created_at))}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Nota geral removida de propósito (plano §4.2): misturar indicadores
          diferentes em um único número escondia mais do que mostrava. Cada
          pilar tem seu indicador e sua tendência, separados. */}

      {/* Por pilar (só os ativos).
          Carregando e falha têm cara própria: um dashboard de zeros é
          indistinguível de "você não registrou nada" e mente com confiança. */}
      {isError && (
        <Card className="p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-medium">Não consegui carregar seus indicadores.</p>
            <p className="text-xs text-muted-foreground">
              Parece falha de conexão — não um retrato do seu mês. Seus registros
              continuam salvos, e o XP acima não depende desta leitura.
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {isFetching
                ? (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Tentando...</>)
                : (<><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Tentar de novo</>)}
            </Button>
          </div>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-2.5">
          {shownPillars.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex items-center gap-3 mb-2">
                <Skeleton className="w-4 h-4 rounded" />
                <Skeleton className="h-4 w-24" />
                <span className="flex-1" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="h-3 w-3/4 mt-2" />
            </Card>
          ))}
        </div>
      )}

      {!isLoading && !isError && (
      <div className="space-y-2.5">
        {shownPillars.map((p) => {
          const s = scores[p.id];
          return (
            <Card key={p.id} className="p-4">
              <div className="flex items-center gap-3 mb-2">
                <p.icon className="w-4 h-4" style={{ color: `hsl(var(${p.colorVar}))` }} />
                <p className="text-sm font-semibold flex-1">{p.attribute}</p>
                {trendByPillar[p.id] === "up" && (
                  <span className="flex items-center gap-1 text-[11px] text-success" title="Mais registros nos últimos 7 dias do que nos 7 anteriores">
                    <TrendingUp className="w-3.5 h-3.5" /> em alta
                  </span>
                )}
                {trendByPillar[p.id] === "down" && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Menos registros nos últimos 7 dias do que nos 7 anteriores">
                    <TrendingDown className="w-3.5 h-3.5" /> em queda
                  </span>
                )}
                {trendByPillar[p.id] === "flat" && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Minus className="w-3.5 h-3.5" /> estável
                  </span>
                )}
                <p className="text-sm font-semibold">
                  {s.value !== null ? `${s.value}/100` : "—"}
                </p>
              </div>
              {s.value !== null ? (
                <>
                  <Progress value={s.value} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-1.5">{s.why}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {s.why} <Link to={p.route} className="underline">Ir para {p.name}</Link>
                </p>
              )}
            </Card>
          );
        })}
      </div>
      )}

      {/* Tendências: a leitura de segundo nível sobre os MESMOS registros que
          alimentam os indicadores acima. Fica aqui, e não na Hoje, porque a
          Hoje é para agir hoje — três meses de associação não competem com
          "registre seu treino". */}
      <TrendInsights />

      {/* Pilares pausados: uma linha discreta, não três cards apagados */}
      {pausedPillars.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Pausados: {pausedPillars.map((p) => p.attribute).join(", ")} — sem indicador
          de propósito. <Link to="/app/pilares" className="underline">Ativar quando quiser</Link>.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Semana ruim não apaga a subida: os indicadores olham 14 dias, e o XP nunca diminui.
        Por enquanto eles medem sobretudo a frequência de registro, não a qualidade do que
        foi registrado.
      </p>
    </div>
  );
}