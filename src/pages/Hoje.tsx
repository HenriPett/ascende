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
import {
  Sunrise, ChevronRight, CircleCheck, Circle, Flame, Droplet, Dumbbell, Moon, Smile,
  BookOpen, Camera, X, UserRound, ListChecks, MessageCircle,
} from "lucide-react";
import { DEFAULT_WATER_GOAL_ML, DEFAULT_WATER_BOTTLES } from "@/hooks/useProfile";
import { useEffect, useRef, useState } from "react";
import { greet, todayISO } from "@/lib/format";
import { pillarById } from "@/lib/pillars";
import { cn } from "@/lib/utils";

/** Sequência de dias ativos. Regra gentil: 1 dia de descanso por semana não quebra. */
function useActiveStreak() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["active-streak", user?.id, todayISO()],
    enabled: !!user,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 864e5).toISOString();
      const { data } = await supabase.from("life_events")
        .select("occurred_at").eq("user_id", user!.id)
        .gte("occurred_at", since).limit(2000);
      return new Set((data ?? []).map((e) => String(e.occurred_at).slice(0, 10)));
    },
  });
  if (!data) return 0;

  const dayIso = (offset: number) => {
    const d = new Date(); d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  // Hoje ainda em andamento: não quebra se vazio; começa de hoje se ativo, senão de ontem
  let streak = 0;
  let offset = data.has(dayIso(0)) ? 0 : 1;
  let restUsedInWindow = 0;
  let windowCount = 0;
  while (offset <= 90) {
    if (windowCount === 7) { windowCount = 0; restUsedInWindow = 0; }
    if (data.has(dayIso(offset))) {
      streak++;
    } else if (restUsedInWindow === 0 && streak > 0) {
      restUsedInWindow++; // descanso da semana: mantém a sequência
    } else break;
    windowCount++;
    offset++;
  }
  return streak;
}

/* ── Ações rápidas (3.1): água, humor e foto em 1 toque ── */
const QUICK_MOODS = [
  { score: 1, emoji: "😞", label: "péssimo" },
  { score: 2, emoji: "🙁", label: "ruim" },
  { score: 3, emoji: "😐", label: "ok" },
  { score: 4, emoji: "🙂", label: "bem" },
  { score: 5, emoji: "😄", label: "ótimo" },
];

function QuickActions() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const bottles = profile?.water_bottles?.length ? profile.water_bottles : DEFAULT_WATER_BOTTLES;

  const insert = async (key: string, row: Record<string, unknown>, okMsg: string) => {
    if (!user || savingKey) return;
    setSavingKey(key);
    const { error } = await supabase.from("life_events").insert({ user_id: user.id, source: "form", ...row });
    setSavingKey(null);
    if (error) { toast.error("Não consegui registrar."); return; }
    toast.success(okMsg);
    qc.invalidateQueries();
  };

  const addWater = (ml: number, label: string) =>
    insert(`w${ml}`, { pillar: "alimentacao", kind: "water", payload: { ml, summary: `Água: ${ml} ml` } },
      `${label} registrada (+${ml} ml). +2 XP`);

  const logMood = (score: number, emoji: string, label: string) =>
    insert(`m${score}`, { pillar: "mente", kind: "mood", payload: { score, label, summary: `Humor: ${label}` } },
      `Humor ${emoji} registrado. +5 XP`);

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground px-0.5">Registro em 1 toque</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
        {bottles.slice(0, 3).map((b) => (
          <button
            key={`${b.ml}-${b.label}`}
            onClick={() => addWater(b.ml, b.label)}
            disabled={!!savingKey}
            className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-60"
          >
            <Droplet className="w-3.5 h-3.5" style={{ color: "hsl(205 70% 55%)" }} />
            {b.label} <span className="text-muted-foreground">{b.ml}ml</span>
          </button>
        ))}
        <span className="shrink-0 w-px bg-border my-1.5" aria-hidden />
        {QUICK_MOODS.map((m) => (
          <button
            key={m.score}
            onClick={() => logMood(m.score, m.emoji, m.label)}
            disabled={!!savingKey}
            className="shrink-0 h-11 w-11 rounded-full border bg-card text-lg grid place-items-center hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-60"
            aria-label={`Registrar humor ${m.label}`}
            title={`Humor: ${m.label}`}
          >
            {m.emoji}
          </button>
        ))}
        <span className="shrink-0 w-px bg-border my-1.5" aria-hidden />
        <Link
          to="/app/alimentacao"
          className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all"
        >
          <Camera className="w-3.5 h-3.5" style={{ color: "hsl(var(--alimentacao))" }} /> Refeição
        </Link>
      </div>
    </div>
  );
}

/* ── Complete seu retrato (1.2): completude do perfil com atalhos ── */
function ProfileCompleteness() {
  const { profile } = useProfile();
  if (!profile) return null;

  const items = [
    { label: "Ano de nascimento", done: !!profile.birth_year },
    { label: "Sexo", done: !!profile.sex },
    { label: "Altura", done: !!profile.height_cm },
    { label: "Nível de atividade", done: !!profile.activity_level },
  ];
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  const pct = Math.round((done / items.length) * 100);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full grid place-items-center shrink-0 bg-gold/10">
          <UserRound className="w-5 h-5 text-gold-ink" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm font-semibold">Complete seu retrato — {pct}%</p>
            <p className="text-xs text-muted-foreground">
              Com esses dados, o Conselheiro monta planos de verdade em vez de pedir informações.
            </p>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-gold transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {items.filter((i) => !i.done).map((i) => (
              <Link key={i.label} to="/app/ajustes"
                className="text-[11px] rounded-full border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
                + {i.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Primeiros passos (2.1): checklist da primeira semana ── */
function FirstSteps() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("ascend-firststeps-done") === "1");

  const { data } = useQuery({
    queryKey: ["first-steps", user?.id],
    enabled: !!user && !dismissed,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const [{ count: events }, { count: mealCount }, { count: plansCount }] = await Promise.all([
        supabase.from("life_events").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
        supabase.from("life_events").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("kind", "meal"),
        supabase.from("plans").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
      ]);
      return { events: events ?? 0, meals: mealCount ?? 0, plans: plansCount ?? 0 };
    },
  });

  if (dismissed || !data) return null;

  const steps = [
    { label: "Registre sua primeira refeição", xp: "+4 XP", done: data.meals > 0, to: "/app/alimentacao" },
    { label: "Conte como foi seu dia na captura acima", xp: "+XP por registro", done: data.events >= 3, to: null },
    { label: "Peça um plano ao Conselheiro", xp: "vira meta viva", done: data.plans > 0, to: "/app/conselheiro" },
  ];
  const allDone = steps.every((st) => st.done);
  if (allDone || data.events >= 15) {
    if (!dismissed) localStorage.setItem("ascend-firststeps-done", "1");
    return null;
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <ListChecks className="w-4 h-4 text-gold-ink" /> Primeiros passos
        </p>
        <button
          onClick={() => { localStorage.setItem("ascend-firststeps-done", "1"); setDismissed(true); }}
          className="text-muted-foreground hover:text-foreground" aria-label="Dispensar primeiros passos"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-1.5">
        {steps.map((st) => {
          const inner = (
            <>
              {st.done
                ? <CircleCheck className="w-5 h-5 text-success shrink-0" />
                : <Circle className="w-5 h-5 text-muted-foreground shrink-0" />}
              <span className={cn("text-sm flex-1", st.done && "line-through text-muted-foreground")}>{st.label}</span>
              <span className="text-[11px] text-gold-ink shrink-0">{st.xp}</span>
            </>
          );
          return st.to && !st.done ? (
            <Link key={st.label} to={st.to} className="flex items-center gap-2.5 rounded-md border p-2.5 hover:bg-muted/50 transition-colors">
              {inner}
            </Link>
          ) : (
            <div key={st.label} className="flex items-center gap-2.5 rounded-md border p-2.5">{inner}</div>
          );
        })}
      </div>
    </Card>
  );
}

/** Painel do dia: consumido vs. meta (calorias, água, proteína) + pilares tocados. */
function DayProgress() {
  const { user } = useAuth();
  const { profile } = useProfile();

  const { data, isLoading } = useQuery({
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

  // Celebração sutil (1x por dia) quando a primeira meta do dia é batida
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const celebrated = useRef(false);
  useEffect(() => {
    if (celebrated.current || isLoading) return;
    const key = `ascend-celebrated-${todayISO()}`;
    if (localStorage.getItem(key)) { celebrated.current = true; return; }
    const hits: [string, boolean][] = [
      ["kcal", kcalGoal > 0 && kcal >= kcalGoal],
      ["water", water >= waterGoal],
      ["prot", protGoal > 0 && prot >= protGoal],
      ["workouts", workoutsGoal > 0 && workoutsWeek >= workoutsGoal],
    ];
    const hit = hits.find(([, ok]) => ok);
    if (hit) {
      celebrated.current = true;
      localStorage.setItem(key, "1");
      setCelebrate(hit[0]);
      toast.success("Primeira meta do dia batida. Assim que se sobe. ✨");
      setTimeout(() => setCelebrate(null), 2600);
    }
  }, [isLoading, kcal, kcalGoal, water, waterGoal, prot, protGoal, workoutsWeek, workoutsGoal]);

  const has = (k: string) => events.some((e) => e.kind === k);
  const pillarsTouched = [
    { label: "Treino", done: has("workout"), icon: Dumbbell, to: "/app/vitalidade", colorVar: "--vitalidade" },
    { label: "Sono", done: has("sleep") || has("nap"), icon: Moon, to: "/app/vitalidade", colorVar: "--vitalidade" },
    { label: "Humor", done: has("mood"), icon: Smile, to: "/app/mente", colorVar: "--mente" },
    { label: "Mente", done: has("practice") || has("journal") || has("gratitude"), icon: BookOpen, to: "/app/mente", colorVar: "--mente" },
  ];

  const Bar = ({ value, goal, color, celebrating }: { value: number; goal: number; color: string; celebrating?: boolean }) => (
    <div className={cn("h-2 rounded-full bg-muted overflow-hidden", celebrating && "goal-celebrate")}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, (value / goal) * 100)}%`, background: color }}
      />
    </div>
  );

  const fmt = (n: number) => n.toLocaleString("pt-BR");

  if (isLoading) {
    return (
      <Card className="p-4 space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold">Seu dia em números</h2>
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-20" /></div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
        <div className="grid grid-cols-4 gap-1.5 pt-0.5">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      </Card>
    );
  }

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
            <Bar value={kcal} goal={kcalGoal} color="hsl(var(--alimentacao))" celebrating={celebrate === "kcal"} />
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
          <Bar value={prot} goal={protGoal} color="hsl(var(--vitalidade))" celebrating={celebrate === "prot"} />
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
        <Bar value={water} goal={waterGoal} color="hsl(205 70% 55%)" celebrating={celebrate === "water"} />
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
              : (<>
                  {brlFmt(spentToday - spendLimit)} acima do teto de hoje.{" "}
                  <Link className="underline text-foreground" to={`/app/conselheiro?q=${encodeURIComponent("Estourei meu teto de gasto de hoje. Como reequilibro a semana?")}`}>
                    Reequilibrar com o Conselheiro
                  </Link>
                </>)}
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
          <Bar value={workoutsWeek} goal={workoutsGoal} color="hsl(var(--vitalidade))" celebrating={celebrate === "workouts"} />
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
      return data as { briefing: string | null; locked?: boolean; reason?: string };
    },
  });

  return (
    <Card className="p-5 bg-primary text-primary-foreground">
      <div className="flex items-center gap-2 text-sm font-medium mb-2 opacity-90">
        <Sunrise className="w-4 h-4" />
        {new Date().getDay() === 0 ? "Retrospectiva da semana" : "Seu briefing de hoje"}
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
      {data?.locked && (
        <div className="space-y-2">
          <p className="text-sm opacity-90">{data.reason ?? "O briefing diário faz parte do Ascende+."}</p>
          <Link to="/app/assinatura" className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4">
            Conhecer o Ascende+
          </Link>
        </div>
      )}
      {data?.briefing && <p className="text-sm leading-relaxed whitespace-pre-line">{data.briefing}</p>}
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
      const since60 = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
      const [{ data: habits }, { data: logs }, { data: history }] = await Promise.all([
        supabase.from("habits").select("id,name,pillar").eq("user_id", user!.id).eq("active", true).order("created_at"),
        supabase.from("habit_logs").select("id,habit_id").eq("user_id", user!.id).eq("log_date", today),
        supabase.from("habit_logs").select("habit_id,log_date").eq("user_id", user!.id).gte("log_date", since60),
      ]);
      // Sequência por hábito: dias consecutivos terminando hoje ou ontem
      const byHabit = new Map<string, Set<string>>();
      for (const l of history ?? []) {
        if (!byHabit.has(l.habit_id)) byHabit.set(l.habit_id, new Set());
        byHabit.get(l.habit_id)!.add(String(l.log_date));
      }
      const dayIso = (off: number) => {
        const d = new Date(); d.setDate(d.getDate() - off);
        return d.toISOString().slice(0, 10);
      };
      const streaks: Record<string, number> = {};
      for (const [id, days] of byHabit) {
        let n = 0;
        let off = days.has(dayIso(0)) ? 0 : 1; // hoje em aberto não quebra
        while (off <= 60 && days.has(dayIso(off))) { n++; off++; }
        streaks[id] = n;
      }
      return { habits: habits ?? [], logs: logs ?? [], streaks };
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
              {(data.streaks?.[h.id] ?? 0) >= 2 && (
                <span className="text-[11px] font-semibold text-gold-ink flex items-center gap-0.5 shrink-0" title={`${data.streaks[h.id]} dias seguidos`}>
                  <Flame className="w-3 h-3" /> {data.streaks[h.id]}
                </span>
              )}
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
  const streak = useActiveStreak();

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            {greet()}{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="text-sm text-muted-foreground">Um dia de cada vez. Um degrau de cada vez.</p>
        </div>
        {streak >= 2 && (
          <span
            className="shrink-0 flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold-ink"
            title={`${streak} dias ativos seguidos (1 descanso por semana não quebra a sequência)`}
          >
            <Flame className="w-3.5 h-3.5" /> {streak} dias
          </span>
        )}
      </div>

      <Briefing />
      <FirstSteps />
      <ProfileCompleteness />
      <DayProgress />
      <QuickActions />
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