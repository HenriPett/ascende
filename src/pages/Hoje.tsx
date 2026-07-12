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
  BookOpen, Camera, X, UserRound, ListChecks, MessageCircle, Trophy, CalendarHeart,
} from "lucide-react";
import { xpToastSuffix } from "@/components/core/CaptureBar";
import { levelFromXp, levelTitle } from "@/lib/xp";
import { DEFAULT_WATER_GOAL_ML, DEFAULT_WATER_BOTTLES } from "@/hooks/useProfile";
import { useEffect, useRef, useState } from "react";
import { greet, todayISO } from "@/lib/format";
import { dateISOInSP, daysAgoISOInSP } from "@/lib/dates";
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
      // Dia calculado no fuso de São Paulo (plano §5.4)
      return new Set((data ?? []).map((e) => dateISOInSP(String(e.occurred_at))));
    },
  });
  if (!data) return 0;

  const dayIso = (offset: number) => daysAgoISOInSP(offset);
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
    toast.success(okMsg + xpToastSuffix());
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

/* ── Primeiros passos (2.1 + análise UX P1.1): trilha da primeira semana.
   Ordem pensada para que, ao chegar na pergunta-assinatura do Conselheiro,
   o Raio-X já exista — e a resposta venha de primeira, sem anticlímax.
   Ao completar: clímax com XP de marco em vez de sumir em silêncio. ── */
const SIGNATURE_QUESTION = "Monte um plano alimentar para o meu objetivo que caiba no meu orçamento";

function FirstSteps() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("ascend-firststeps-done") === "1");
  const awarded = useRef(false);

  const { data } = useQuery({
    queryKey: ["first-steps", user?.id],
    enabled: !!user && !dismissed,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const [{ count: events }, { count: mealCount }, { count: plansCount }, { count: estCount }, { count: recCount }] = await Promise.all([
        supabase.from("life_events").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
        supabase.from("life_events").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("kind", "meal"),
        supabase.from("plans").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
        supabase.from("category_estimates").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
        supabase.from("recurring_transactions").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
      ]);
      return {
        events: events ?? 0, meals: mealCount ?? 0, plans: plansCount ?? 0,
        raiox: (estCount ?? 0) + (recCount ?? 0),
      };
    },
  });

  const raioxDone = (data?.raiox ?? 0) > 0 || Number(profile?.monthly_income ?? 0) > 0;

  const steps = data ? [
    { label: "Conte seu dia na captura abaixo", xp: "+XP por registro", done: data.events >= 1, to: null },
    { label: "Mapeie seu mês em 60 segundos (Raio-X)", xp: "destrava o plano no seu bolso", done: raioxDone, to: "/app/prosperidade" },
    { label: "Registre uma refeição (vale foto do prato)", xp: "+4 XP", done: data.meals > 0, to: "/app/alimentacao" },
    { label: "Peça o plano que cabe no seu bolso", xp: "vira meta viva", done: data.plans > 0, to: `/app/conselheiro?q=${encodeURIComponent(SIGNATURE_QUESTION)}` },
  ] : [];
  const allDone = steps.length > 0 && steps.every((st) => st.done);

  // Clímax: XP de marco, uma vez por conta (o servidor garante a unicidade).
  useEffect(() => {
    if (!allDone || awarded.current || dismissed) return;
    awarded.current = true;
    supabase.rpc("award_first_steps_milestone").then(({ data: ok }) => {
      if (ok) {
        toast.success("Base montada · +20 XP. Agora é um degrau por dia. ✨");
        qc.invalidateQueries({ queryKey: ["xp"] });
      }
    });
  }, [allDone, dismissed, qc]);

  if (dismissed || !data) return null;

  const dismiss = () => { localStorage.setItem("ascend-firststeps-done", "1"); setDismissed(true); };

  // Estado de conclusão: despedida com a próxima promessa (retrospectiva)
  if (allDone) {
    return (
      <Card className="p-4 border-success/40 bg-success/5">
        <div className="flex items-start gap-3">
          <Trophy className="w-5 h-5 text-gold-ink shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Base montada — primeiros passos concluídos (+20 XP)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Você já viveu o essencial: contar, mapear e planejar. Domingo chega a sua
              primeira retrospectiva da semana — quanto mais dias registrados, melhor ela fica.
            </p>
          </div>
          <button onClick={dismiss} className="text-muted-foreground hover:text-foreground" aria-label="Concluir primeiros passos">
            <X className="w-4 h-4" />
          </button>
        </div>
      </Card>
    );
  }

  if (data.events >= 25) { dismiss(); return null; }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <ListChecks className="w-4 h-4 text-gold-ink" /> Primeiros passos
        </p>
        <button
          onClick={dismiss}
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

/* ── Sua primeira retrospectiva (análise UX P1.3): dias 2–6 de conta.
   Transforma a espera por domingo em preparação — sem culpa: mostra o que
   JÁ foi registrado e uma única sugestão, dispensável a qualquer momento. ── */
function RetroCountdown() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("ascend-retro-preview-done") === "1");

  const createdAt = user?.created_at ? new Date(user.created_at).getTime() : 0;
  const ageDays = createdAt ? Math.floor((Date.now() - createdAt) / 864e5) : 0;
  const isSunday = new Date().getDay() === 0;
  const eligible = !dismissed && !isSunday && ageDays >= 1 && ageDays <= 6;

  const { data } = useQuery({
    queryKey: ["retro-preview", user?.id, todayISO()],
    enabled: !!user && eligible,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const monday = new Date();
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      const { count } = await supabase.from("life_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id).gte("occurred_at", monday.toISOString());
      return { weekEvents: count ?? 0 };
    },
  });

  if (!eligible || !data) return null;
  const daysToSunday = (7 - new Date().getDay()) % 7 || 7;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full grid place-items-center shrink-0 bg-gold/10">
          <CalendarHeart className="w-5 h-5 text-gold-ink" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            Sua primeira retrospectiva chega {daysToSunday === 1 ? "amanhã" : `em ${daysToSunday} dias`} (domingo)
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data.weekEvents > 0
              ? `A IA vai cruzar os ${data.weekEvents} registro${data.weekEvents > 1 ? "s" : ""} da sua semana e contar a história dela. Cada dia registrado deixa a leitura mais nítida.`
              : "Ela nasce do que você registrar até lá — uma frase por dia já rende uma boa história."}
          </p>
        </div>
        <button
          onClick={() => { localStorage.setItem("ascend-retro-preview-done", "1"); setDismissed(true); }}
          className="text-muted-foreground hover:text-foreground" aria-label="Dispensar aviso da retrospectiva"
        >
          <X className="w-4 h-4" />
        </button>
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

  const hasAnyGoal = kcalGoal > 0 || protGoal > 0 || spendLimit > 0 || workoutsGoal > 0 || sleepGoal > 0;

  return (
    <Card className="p-4 space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold">Seu dia em números</h2>
        <span className="text-[11px] text-muted-foreground">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" })}
        </span>
      </div>

      {/* Sem nenhuma meta: convite único em vez de silêncio (análise UX P2.1).
          O Conselheiro já sabe propor as metas e gravar com confirmação. */}
      {!hasAnyGoal && (
        <p className="text-xs text-muted-foreground rounded-md border p-2.5">
          Metas deixam este painel vivo — e você define todas em uma frase:{" "}
          <Link
            className="underline text-foreground"
            to={`/app/conselheiro?q=${encodeURIComponent("Me ajude a definir minhas metas diárias (calorias, proteína, água, treinos na semana, sono e teto de gasto) a partir do meu objetivo")}`}
          >
            definir com o Conselheiro
          </Link>.
        </p>
      )}

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

/** Sugestão local do dia (custo zero, determinística por dia da semana):
 *  quando o briefing com IA não está disponível, o card muda de assunto em
 *  vez de mostrar cadeado (análise UX P0.1). */
const DAILY_FOCUS = [
  "Domingo é dia da sua retrospectiva — ela nasce do que você registrou na semana.",
  "Uma frase na captura abaixo registra o dia inteiro: gasto, treino, sono, humor.",
  "Foto do prato → calorias na hora. O registro mais rápido do app.",
  "Água e humor em 1 toque, logo abaixo. Dez segundos e o dia está vivo.",
  "Conte um gasto de hoje — o retrato do seu mês fica mais nítido a cada real.",
  "Marque um compromisso de hoje como feito: é isso que constrói a sequência.",
  "Semana fechando: cada registro de hoje aparece na retrospectiva de domingo.",
];

function Briefing() {
  const { profile } = useProfile();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["briefing", todayISO()],
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("briefing", { body: {} });
      if (error || data?.error) throw new Error(data?.error ?? "erro");
      return data as { briefing: string | null; locked?: boolean; reason?: string; courtesy?: boolean };
    },
  });

  const locked = !!data?.locked;

  return (
    <Card className="p-5 bg-primary text-primary-foreground">
      <div className="flex items-center gap-2 text-sm font-medium mb-2 opacity-90">
        <Sunrise className="w-4 h-4" />
        {locked ? "Foco de hoje" : new Date().getDay() === 0 ? "Retrospectiva da semana" : "Seu briefing de hoje"}
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
      {/* Sem cadeado como primeira mensagem: o card muda de assunto e entrega
          conteúdo local — a meta da pessoa + o foco do dia. O Ascende+ vira
          uma linha discreta de rodapé, não a manchete. */}
      {locked && (
        <div className="space-y-2">
          {profile?.goal && (
            <p className="text-sm leading-relaxed">
              Sua bússola: <em>"{profile.goal}"</em>
            </p>
          )}
          <p className="text-sm leading-relaxed opacity-90">{DAILY_FOCUS[new Date().getDay()]}</p>
          <p className="text-[11px] opacity-70 pt-1">
            {data?.reason ?? "O briefing diário com IA vive no Ascende+."}{" "}
            <Link to="/app/assinatura" className="underline underline-offset-2">Conhecer</Link>
          </p>
        </div>
      )}
      {data?.briefing && (
        <div className="space-y-2">
          <p className="text-sm leading-relaxed whitespace-pre-line">{data.briefing}</p>
          {data.courtesy && (
            <p className="text-[11px] opacity-70">
              Seus primeiros briefings são por nossa conta ✨ — depois, ele chega todo dia
              no Ascende+ e toda semana na sua retrospectiva gratuita de domingo.
            </p>
          )}
        </div>
      )}
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
      const since60 = daysAgoISOInSP(60);
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
      const dayIso = (off: number) => daysAgoISOInSP(off);
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
    // Sem compromissos ainda — de propósito: nada vem pré-definido. Eles
    // nascem da meta da pessoa, com o Conselheiro (cartão de escolha).
    return (
      <Card className="p-5 space-y-1.5">
        <p className="text-sm font-medium">Seus compromissos diários nascem da sua meta.</p>
        <p className="text-sm text-muted-foreground">
          Nada de lista pronta:{" "}
          <Link
            className="underline text-foreground"
            to={`/app/conselheiro?q=${encodeURIComponent("A partir da minha meta, proponha 2 ou 3 compromissos diários pequenos para eu começar")}`}
          >
            construa com o Conselheiro
          </Link>{" "}
          — ou <Link to="/app/vitalidade" className="underline text-foreground">crie manualmente</Link>, do seu jeito.
          É o compromisso cumprido, dia após dia, que constrói a subida (+10 XP cada).
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
  const { user } = useAuth();
  const firstName = (profile?.name ?? "").split(" ")[0];
  const streak = useActiveStreak();

  // Nível com significado desde o dia 1 (análise UX P2.3): os títulos
  // poéticos são um ativo de marca — mostrá-los, não escondê-los.
  const { data: xpTotal } = useQuery({
    queryKey: ["xp", "total", user?.id],
    enabled: !!user,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data } = await supabase.rpc("xp_total", { uid: user!.id });
      return Number(data) || 0;
    },
  });
  const level = levelFromXp(xpTotal ?? 0).level;

  return (
    <div className="max-w-2xl lg:max-w-4xl mx-auto space-y-4 animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            {greet()}{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="text-sm text-muted-foreground">Um dia de cada vez. Um degrau de cada vez.</p>
          {streak === 2 && (
            <p className="text-[11px] text-gold-ink mt-0.5">
              Sua primeira sequência começou — e um dia de descanso por semana não quebra.
            </p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {xpTotal !== undefined && (
            <Link
              to="/app/score"
              className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title="Ver sua jornada de níveis"
            >
              Nv. {level} · {levelTitle(level)}
            </Link>
          )}
          {streak >= 2 && (
            <span
              className="flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold-ink"
              title={`${streak} dias ativos seguidos (1 descanso por semana não quebra a sequência)`}
            >
              <Flame className="w-3.5 h-3.5" /> {streak} dias
            </span>
          )}
        </div>
      </div>

      {/* Ordem da tela Hoje (plano §5.5): prioridade do dia (briefing/primeiros
          passos) → captura inteligente → compromissos → indicadores principais
          → ações rápidas → batalhas → Conselheiro → informações secundárias. */}
      <Briefing />
      <FirstSteps />
      <CaptureBar />
      <RetroCountdown />
      <HabitsToday />
      <DayProgress />
      <QuickActions />
      <BattleCheckinCard />

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

      {/* Informação secundária: completude do perfil fica por último */}
      <ProfileCompleteness />
    </div>
  );
}