import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Moon, Dumbbell, CircleCheck, Circle } from "lucide-react";
import { todayISO } from "@/lib/format";
import { PILLARS } from "@/lib/pillars";
import { cn } from "@/lib/utils";

interface Habit { id: string; name: string; pillar: string }
interface HLog { id: string; habit_id: string; log_date: string }

export default function Vitalidade() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();
  const [newHabit, setNewHabit] = useState("");
  const [newPillar, setNewPillar] = useState("vitalidade");
  const [sleepHours, setSleepHours] = useState("");
  const [workout, setWorkout] = useState("");

  const { data } = useQuery({
    queryKey: ["vitalidade", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 27 * 864e5).toISOString().slice(0, 10);
      const [{ data: habits }, { data: logs }] = await Promise.all([
        supabase.from("habits").select("id,name,pillar").eq("user_id", user!.id).eq("active", true).order("created_at"),
        supabase.from("habit_logs").select("id,habit_id,log_date").eq("user_id", user!.id).gte("log_date", since),
      ]);
      return { habits: (habits ?? []) as Habit[], logs: (logs ?? []) as HLog[] };
    },
  });

  const invalidate = () => qc.invalidateQueries();

  const addHabit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newHabit.trim()) return;
    const { error } = await supabase.from("habits").insert({ user_id: user.id, name: newHabit.trim(), pillar: newPillar });
    if (error) { toast.error("Não consegui criar o hábito."); return; }
    toast.success("Hábito criado. Consistência constrói a subida!");
    setNewHabit("");
    invalidate();
  };

  const removeHabit = async (id: string) => {
    await supabase.from("habits").update({ active: false }).eq("id", id);
    toast.success("Hábito arquivado. O histórico dele fica guardado.");
    invalidate();
  };

  const toggleToday = async (habit: Habit) => {
    if (!user || !data) return;
    const log = data.logs.find((l) => l.habit_id === habit.id && l.log_date === today);
    if (log) await supabase.from("habit_logs").delete().eq("id", log.id);
    else {
      const { error } = await supabase.from("habit_logs").insert({ user_id: user.id, habit_id: habit.id, log_date: today });
      if (!error) toast.success("Feito! +10 XP");
    }
    invalidate();
  };

  const logSleep = async () => {
    const h = Number(sleepHours.replace(",", "."));
    if (!user || !h || h <= 0 || h > 24) { toast.error("Quantas horas você dormiu? Ex.: 7,5"); return; }
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "vitalidade", kind: "sleep",
      payload: { hours: h, summary: `Sono: ${h}h` }, source: "form",
    });
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Sono registrado. +5 XP");
    setSleepHours("");
    invalidate();
  };

  const logWorkout = async () => {
    if (!user || !workout.trim()) return;
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "vitalidade", kind: "workout",
      payload: { description: workout.trim(), summary: `Treino: ${workout.trim()}` }, source: "form",
    });
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Treino registrado. +8 XP");
    setWorkout("");
    invalidate();
  };

  // Heatmap: últimos 28 dias, % de hábitos concluídos por dia
  const heat = (() => {
    const days: { date: string; pct: number }[] = [];
    const total = data?.habits.length ?? 0;
    for (let i = 27; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const done = (data?.logs ?? []).filter((l) => l.log_date === iso).length;
      days.push({ date: iso, pct: total ? done / total : 0 });
    }
    return days;
  })();

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold" style={{ color: "hsl(var(--vitalidade))" }}>
          Vitalidade
        </h1>
        <p className="text-sm text-muted-foreground">Corpo, sono e energia. O degrau mais físico da subida.</p>
      </div>

      {/* Registro rápido: sono e treino */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <Card className="p-4 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5"><Moon className="w-4 h-4" /> Sono da última noite</p>
          <div className="flex gap-2">
            <Input inputMode="decimal" placeholder="Horas — ex.: 7,5" value={sleepHours}
              onChange={(e) => setSleepHours(e.target.value)} />
            <Button onClick={logSleep} variant="secondary">Salvar</Button>
          </div>
        </Card>
        <Card className="p-4 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5"><Dumbbell className="w-4 h-4" /> Treino de hoje</p>
          <div className="flex gap-2">
            <Input maxLength={80} placeholder="Ex.: pernas, corrida 5km" value={workout}
              onChange={(e) => setWorkout(e.target.value)} />
            <Button onClick={logWorkout} variant="secondary">Salvar</Button>
          </div>
        </Card>
      </div>

      {/* Hábitos */}
      <Card className="p-4 space-y-3">
        <h2 className="font-display font-semibold">Hábitos diários</h2>

        {!(data?.habits ?? []).length && (
          <p className="text-sm text-muted-foreground">
            Comece com UM hábito pequeno — pequeno demais para falhar. Você pode criar hábitos
            de qualquer pilar aqui.
          </p>
        )}

        <div className="space-y-1.5">
          {(data?.habits ?? []).map((h) => {
            const done = (data?.logs ?? []).some((l) => l.habit_id === h.id && l.log_date === today);
            return (
              <div key={h.id} className={cn("flex items-center gap-2 rounded-md border p-2.5", done && "bg-success/5 border-success/30")}>
                <button onClick={() => toggleToday(h)} className="flex items-center gap-3 flex-1 text-left" aria-pressed={done}>
                  {done ? <CircleCheck className="w-5 h-5 text-success" /> : <Circle className="w-5 h-5 text-muted-foreground" />}
                  <span className={cn("text-sm", done && "line-through text-muted-foreground")}>{h.name}</span>
                </button>
                <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground"
                  onClick={() => removeHabit(h.id)} aria-label={`Arquivar hábito ${h.name}`}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>

        <form onSubmit={addHabit} className="flex gap-2">
          <Input maxLength={80} placeholder="Novo hábito"
            className="min-w-0 flex-1" value={newHabit} onChange={(e) => setNewHabit(e.target.value)} />
          <Select value={newPillar} onValueChange={setNewPillar}>
            <SelectTrigger className="w-[112px] shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PILLARS.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="submit" size="icon" className="shrink-0" aria-label="Criar hábito"><Plus className="w-4 h-4" /></Button>
        </form>
      </Card>

      {/* Heatmap 28 dias */}
      {(data?.habits ?? []).length > 0 && (
        <Card className="p-4">
          <h2 className="font-display font-semibold mb-3">Últimos 28 dias</h2>
          <div className="grid grid-cols-14 gap-1" style={{ gridTemplateColumns: "repeat(14, minmax(0,1fr))" }}>
            {heat.map((d) => (
              <div
                key={d.date}
                title={`${new Date(d.date + "T00:00:00").toLocaleDateString("pt-BR")}: ${Math.round(d.pct * 100)}%`}
                className="aspect-square rounded-[4px]"
                style={{
                  background: d.pct === 0 ? "hsl(var(--muted))" : `hsl(var(--vitalidade) / ${0.25 + d.pct * 0.75})`,
                }}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">Cada quadrado é um dia. Quanto mais forte, mais hábitos concluídos.</p>
        </Card>
      )}
    </div>
  );
}