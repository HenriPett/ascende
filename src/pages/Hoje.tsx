import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import CaptureBar from "@/components/core/CaptureBar";
import { toast } from "sonner";
import { Sunrise, ChevronRight, CircleCheck, Circle } from "lucide-react";
import { greet, todayISO } from "@/lib/format";
import { pillarById } from "@/lib/pillars";
import { cn } from "@/lib/utils";

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
      <CaptureBar />
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
