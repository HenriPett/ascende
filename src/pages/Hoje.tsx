import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import CaptureBar from "@/components/core/CaptureBar";
import BattleCheckinCard from "@/components/core/BattleCheckin";
import { toast } from "sonner";
import { Sunrise, ChevronRight, CircleCheck, Circle, Flame, Droplet, Dumbbell, Moon, Smile, BookOpen } from "lucide-react";
import { DEFAULT_WATER_GOAL_ML } from "@/hooks/useProfile";
import { greet, todayISO } from "@/lib/format";
import { pillarById } from "@/lib/pillars";
import { cn } from "@/lib/utils";

/** Painel do dia: consumido vs. meta (calorias, água, proteína) + pilares tocados. */
function DayProgress() {
  const { user } = useAuth();
  const { profile } = useProfile();

  const { data } = useQuery({
    queryKey: ["day-progress", user?.id, todayISO()],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // segunda-feira
      weekStart.setHours(0, 0, 0, 0);
      const [{ data: events }, { data: weekWorkouts }, { data: txs }] = await Promise.all([
        supabase.from("life_events").select("kind,payload")
          .eq("user_id", user!.id).gte("occurred_at", dayStart.toISOString()).limit(300),
        supabase.from("life_events").select("id")
          .eq("user_id", user!.id).eq("kind", "workout")
          .gte("occurred_at", weekStart.toISOString()).limit(50),
        supabase.from("transactions").select("kind,amount")
          .eq("user_id", user!.id).gte("occurred_at", todayISO()).limit(200),
      ]);
      return {
        events: (events ?? []) as { kind: string; payload: Record<string, unknown> }[],
        workoutsWeek: (weekWorkouts ?? []).length,
        spentToday: (txs ?? []).filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0),
      };
    },
  });

  const events = data?.events ?? [];
  const num = (v: unknown) => Number(v) || 0;
  const kcal = Math.round(events.filter((e) => e.kind === "meal").reduce((s, e) => s + num(e.payload?.calories), 0));
  const prot = Math.round(events.filter((e) => e.kind === "meal").reduce((s, e) => s + num(e.payload?.protein_g), 0));
  const water = events.filter((e) => e.kind === "water").reduce((s, e) => s + num(e.payload?.ml), 0);

  const kcalGoal = Number(profile?.calorie_goal_kcal) || 0;
  const protGoal = Number(profile?.protein_goal_g) || 0;
  const waterGoal = Number(profile?.water_goal_ml) || DEFAULT_WATER_GOAL_ML;
  const spendLimit = Number(profile?.daily_spend_limit) || 0;
  const workoutsGoal = Number(profile?.weekly_workouts_goal) || 0;
  const sleepGoal = Number(profile?.sleep_goal_h) || 0;
  const spentToday = data?.spentToday ?? 0;
  const workoutsWeek = data?.workoutsWeek ?? 0;
  const sleptToday = (() => {
    const e = events.find((ev) => ev.kind === "sleep");
    return e ? Number(e.payload?.hours) || 0 : null;
  })();
  const brlFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  const has = (k: string) => events.some((e) => e.kind === k);
  const pillarsTouched = [
    { label: "Treino", done: has("workout"), icon: Dumbbell, to: "/app/vitalidade", colorVar: "--vitalidade" },
    { label: "Sono", done: has("sleep") || has("nap"), icon: Moon, to: "/app/vitalidade", colorVar: "--vitalidade" },
    { label: "Humor", done: has("mood"), icon: Smile, to: "/app/mente", colorVar: "--mente" },
    { label: "Mente", done: has("practice") || has("journal") || has("gratitude"), icon: BookOpen, to: "/app/mente", colorVar: "--mente" },
  ];

  const Bar = ({ value, goal, color }: { value: number; goal: number; color: string }) => (
    <div className="h-2 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, (value / goal) * 100)}%`, background: color }}
      />
    </div>
  );

  const fmt = (n: number) => n.toLocaleString("pt-BR");

  return (
    <Card className="p-4 space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold">Seu dia em números</h2>
        <span className="text-[11px] text-muted-foreground">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" })}
        </span>
      </div>

      {/* Calorias */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <Flame className="w-4 h-4" style={{ color: "hsl(var(--alimentacao))" }} /> Calorias
          </span>
          {kcalGoal > 0 ? (
            <span className="text-muted-foreground">
              <strong className="text-foreground">{fmt(kcal)}</strong> / {fmt(kcalGoal)} kcal
            </span>
          ) : (
            <span className="text-muted-foreground">{fmt(kcal)} kcal</span>
          )}
        </div>
        {kcalGoal > 0 ? (
          <>
            <Bar value={kcal} goal={kcalGoal} color="hsl(var(--alimentacao))" />
            <p className="text-[11px] text-muted-foreground">
              {kcal < kcalGoal
                ? `Faltam ${fmt(kcalGoal - kcal)} kcal para a meta do dia.`
                : kcal - kcalGoal <= Math.max(100, kcalGoal * 0.05)
                  ? "Meta do dia alcançada. 🎉"
                  : `Meta alcançada (${fmt(kcal - kcalGoal)} kcal acima).`}
            </p>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Sem meta diária definida.{" "}
            <Link to="/app/alimentacao" className="underline text-foreground">Definir meta</Link>
            {" "}ou peça um plano alimentar ao Conselheiro — a meta do plano é aplicada aqui.
          </p>
        )}
      </div>

      {/* Proteína (só com meta) */}
      {protGoal > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Proteína</span>
            <span className="text-muted-foreground">
              <strong className="text-foreground">{fmt(prot)}</strong> / {fmt(protGoal)} g
            </span>
          </div>
          <Bar value={prot} goal={protGoal} color="hsl(var(--vitalidade))" />
        </div>
      )}

      {/* Água */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <Droplet className="w-4 h-4" style={{ color: "hsl(205 70% 55%)" }} /> Água
          </span>
          <span className="text-muted-foreground">
            <strong className="text-foreground">{(water / 1000).toFixed(1).replace(".", ",")}</strong> / {(waterGoal / 1000).toFixed(1).replace(".", ",")} L
          </span>
        </div>
        <Bar value={water} goal={waterGoal} color="hsl(205 70% 55%)" />
      </div>

      {/* Gasto do dia (Prosperidade) */}
      {spendLimit > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-4 h-4 grid place-items-center text-[13px]" style={{ color: "hsl(var(--prosperidade))" }} aria-hidden>R$</span>
              Gasto de hoje
            </span>
            <span className="text-muted-foreground">
              <strong className="text-foreground">{brlFmt(spentToday)}</strong> / {brlFmt(spendLimit)}
            </span>
          </div>
          <Bar value={spentToday} goal={spendLimit} color="hsl(var(--prosperidade))" />
          <p className="text-[11px] text-muted-foreground">
            {spentToday <= spendLimit
              ? `${brlFmt(spendLimit - spentToday)} disponíveis dentro do teto do dia.`
              : `${brlFmt(spentToday - spendLimit)} acima do teto de hoje — o Conselheiro pode ajudar a reequilibrar a semana.`}
          </p>
        </div>
      )}

      {/* Treinos na semana (Vitalidade) */}
      {workoutsGoal > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <Dumbbell className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} /> Treinos na semana
            </span>
            <span className="text-muted-foreground">
              <strong className="text-foreground">{workoutsWeek}</strong> / {workoutsGoal}
            </span>
          </div>
          <Bar value={workoutsWeek} goal={workoutsGoal} color="hsl(var(--vitalidade))" />
          <p className="text-[11px] text-muted-foreground">
            {workoutsWeek >= workoutsGoal
              ? "Meta da semana batida. 💪"
              : `Faltam ${workoutsGoal - workoutsWeek} treino(s) até domingo.`}
          </p>
        </div>
      )}

      {/* Sono (Vitalidade) */}
      {sleepGoal > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <Moon className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} /> Sono da última noite
            </span>
            <span className="text-muted-foreground">
              {sleptToday !== null
                ? (<><strong className="text-foreground">{String(sleptToday).replace(".", ",")}h</strong> / {String(sleepGoal).replace(".", ",")}h</>)
                : "não registrado"}
            </span>
          </div>
          {sleptToday !== null && <Bar value={sleptToday} goal={sleepGoal} color="hsl(var(--vitalidade))" />}
        </div>
      )}

      {/* Pilares tocados hoje */}
      <div className="grid grid-cols-4 gap-1.5 pt-0.5">
        {pillarsTouched.map((pt) => (
          <Link
            key={pt.label} to={pt.to}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] transition-colors",
              pt.done ? "border-transparent" : "text-muted-foreground hover:bg-muted/60"
            )}
            style={pt.done ? { background: `hsl(var(${pt.colorVar}) / 0.12)`, color: `hsl(var(${pt.colorVar}))` } : undefined}
          >
            <pt.icon className="w-4 h-4" />
            {pt.label} {pt.done && "✓"}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function Briefing() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["briefing", todayISO()],
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("briefing", { body: {} });
      if (error || data?.error) throw new Error(data?.error ?? "erro");
      return data.briefing as string;
    },
  });

  return (
    <Card className="p-5 bg-primary text-primary-foreground">
      <div className="flex items-center gap-2 text-sm font-medium mb-2 opacity-90">
        <Sunrise className="w-4 h-4" /> Seu briefing de hoje
      </div>
      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full bg-primary-foreground/20" />
          <Skeleton className="h-4 w-4/5 bg-primary-foreground/20" />
          <Skeleton className="h-4 w-3/5 bg-primary-foreground/20" />
        </div>
      )}
      {isError && (
        <p className="text-sm opacity-90">
          O briefing não carregou agora — sem problema, o resto do app segue normal.
          Ele volta ao recarregar a página. (Se for a primeira vez, confira se as funções
          de IA foram publicadas — passo 4 do README.)
        </p>
      )}
      {data && <p className="text-sm leading-relaxed whitespace-pre-line">{data}</p>}
    </Card>
  );
}

function HabitsToday() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();

  const { data, isLoading } = useQuery({
    queryKey: ["habits-today", user?.id, today],
    enabled: !!user,
    queryFn: async () => {
      const [{ data: habits }, { data: logs }] = await Promise.all([
        supabase.from("habits").select("id,name,pillar").eq("user_id", user!.id).eq("active", true).order("created_at"),
        supabase.from("habit_logs").select("id,habit_id").eq("user_id", user!.id).eq("log_date", today),
      ]);
      return { habits: habits ?? [], logs: logs ?? [] };
    },
  });

  const toggle = async (habitId: string) => {
    if (!user || !data) return;
    const log = data.logs.find((l) => l.habit_id === habitId);
    if (log) {
      await supabase.from("habit_logs").delete().eq("id", log.id);
    } else {
      const { error } = await supabase.from("habit_logs").insert({ user_id: user.id, habit_id: habitId, log_date: today });
      if (!error) toast.success("Feito! +10 XP");
    }
    qc.invalidateQueries({ queryKey: ["habits-today"] });
    qc.invalidateQueries({ queryKey: ["xp"] });
  };

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data?.habits.length) {
    return (
      <Card className="p-5">
        <p className="text-sm text-muted-foreground">
          Você ainda não tem compromissos diários.{" "}
          <Link to="/app/vitalidade" className="underline text-foreground">Crie seu primeiro hábito</Link> — é
          ele que constrói a subida.
        </p>
      </Card>
    );
  }

  const done = data.logs.length;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-semibold">Compromissos de hoje</h2>
        <span className="text-xs text-muted-foreground">{done}/{data.habits.length}</span>
      </div>
      <div className="space-y-1.5">
        {data.habits.map((h) => {
          const isDone = data.logs.some((l) => l.habit_id === h.id);
          const meta = pillarById(h.pillar);
          return (
            <button
              key={h.id}
              onClick={() => toggle(h.id)}
              className={cn(
                "w-full flex items-center gap-3 rounded-md border p-3 text-left transition-colors",
                isDone ? "bg-success/5 border-success/30" : "hover:bg-muted/60"
              )}
              aria-pressed={isDone}
            >
              {isDone
                ? <CircleCheck className="w-5 h-5 text-success shrink-0" />
                : <Circle className="w-5 h-5 text-muted-foreground shrink-0" />}
              <span className={cn("text-sm flex-1", isDone && "line-through text-muted-foreground")}>{h.name}</span>
              {meta && (
                <span className="w-2 h-2 rounded-full" style={{ background: `hsl(var(${meta.colorVar}))` }} aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export default function Hoje() {
  const { profile } = useProfile();
  const firstName = (profile?.name ?? "").split(" ")[0];

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold">
          {greet()}{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="text-sm text-muted-foreground">Um dia de cada vez. Um degrau de cada vez.</p>
      </div>

      <Briefing />
      <DayProgress />
      <CaptureBar />
      <BattleCheckinCard />
      <HabitsToday />

      <Link
        to="/app/conselheiro"
        className="flex items-center justify-between rounded-lg border bg-card p-4 hover:bg-muted/50 transition-colors"
      >
        <div>
          <p className="text-sm font-semibold">Falar com o Conselheiro</p>
          <p className="text-xs text-muted-foreground">
            Ele conhece seus dados de todos os pilares — pergunte qualquer coisa.
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground" />
      </Link>
    </div>
  );
}