import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Moon, Dumbbell, CircleCheck, Circle, BarChart3, HeartPulse, X } from "lucide-react";
import { todayISO } from "@/lib/format";
import { PILLARS } from "@/lib/pillars";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar,
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

interface Habit { id: string; name: string; pillar: string }
interface HLog { id: string; habit_id: string; log_date: string }
interface WorkoutEvent { id: string; occurred_at: string; payload: { description?: string; muscles?: string[] } }

const MUSCLES = ["Peito", "Costas", "Pernas", "Ombros", "Braços", "Core", "Cardio"] as const;

export default function Vitalidade() {
  const { user } = useAuth();
  const { profile, refresh: refreshProfile } = useProfile();
  const qc = useQueryClient();
  const today = todayISO();
  const [newHabit, setNewHabit] = useState("");
  const [newPillar, setNewPillar] = useState("vitalidade");
  const [sleepHours, setSleepHours] = useState("");
  const [sleepType, setSleepType] = useState<"sleep" | "nap" | null>(null);
  const [workout, setWorkout] = useState("");
  const [muscles, setMuscles] = useState<string[]>([]);
  const [conditionInput, setConditionInput] = useState("");
  const [medicationInput, setMedicationInput] = useState("");

  // ── Condições de saúde e medicamentos (visíveis para o Conselheiro) ──
  const conditions = profile?.health_conditions ?? [];
  const medications = profile?.medications ?? [];

  const saveHealth = async (patch: { health_conditions?: string[]; medications?: string[] }) => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update(patch).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar."); return; }
    refreshProfile();
  };

  const addToList = async (
    value: string, list: string[], key: "health_conditions" | "medications",
    clear: () => void,
  ) => {
    const c = value.trim().slice(0, 80);
    if (!c) return;
    if (list.length >= 20) { toast.error("Máximo de 20 itens. Remova algum para adicionar outro."); return; }
    if (list.some((x) => x.toLowerCase() === c.toLowerCase())) {
      toast.info("Isso já está na sua lista."); return;
    }
    await saveHealth({ [key]: [...list, c] });
    clear();
    toast.success("Anotado. O Conselheiro vai considerar isso nas sugestões.");
  };

  const addCondition = (e: React.FormEvent) => {
    e.preventDefault();
    addToList(conditionInput, conditions, "health_conditions", () => setConditionInput(""));
  };
  const addMedication = (e: React.FormEvent) => {
    e.preventDefault();
    addToList(medicationInput, medications, "medications", () => setMedicationInput(""));
  };
  const removeCondition = (idx: number) =>
    saveHealth({ health_conditions: conditions.filter((_, i) => i !== idx) });
  const removeMedication = (idx: number) =>
    saveHealth({ medications: medications.filter((_, i) => i !== idx) });

  const { data } = useQuery({
    queryKey: ["vitalidade", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 27 * 864e5).toISOString().slice(0, 10);
      const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
      const [{ data: habits }, { data: logs }, { data: workouts }, { data: sleepToday }] = await Promise.all([
        supabase.from("habits").select("id,name,pillar").eq("user_id", user!.id).eq("active", true).order("created_at"),
        supabase.from("habit_logs").select("id,habit_id,log_date").eq("user_id", user!.id).gte("log_date", since),
        supabase.from("life_events").select("id,occurred_at,payload")
          .eq("user_id", user!.id).eq("kind", "workout").gte("occurred_at", since30)
          .order("occurred_at", { ascending: false }).limit(120),
        supabase.from("life_events").select("id")
          .eq("user_id", user!.id).eq("kind", "sleep")
          .gte("occurred_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()).limit(1),
      ]);
      return {
        habits: (habits ?? []) as Habit[],
        logs: (logs ?? []) as HLog[],
        workouts: (workouts ?? []) as WorkoutEvent[],
        sleptTonight: (sleepToday ?? []).length > 0,
      };
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

  // Tipo efetivo: o escolhido; sem escolha, noite — mas se a noite já foi registrada hoje, soneca
  const effectiveSleepType: "sleep" | "nap" = sleepType ?? (data?.sleptTonight ? "nap" : "sleep");

  const logSleep = async () => {
    const h = Number(sleepHours.replace(",", "."));
    const isNap = effectiveSleepType === "nap";
    const max = isNap ? 6 : 24;
    if (!user || !h || h <= 0 || h > max) {
      toast.error(isNap ? "Quanto durou a soneca? Ex.: 1 ou 0,5" : "Quantas horas você dormiu? Ex.: 7,5");
      return;
    }
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "vitalidade", kind: isNap ? "nap" : "sleep",
      payload: { hours: h, summary: isNap ? `Soneca: ${h}h` : `Sono: ${h}h` }, source: "form",
    });
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success(isNap ? "Soneca registrada. +2 XP" : "Sono registrado. +5 XP");
    setSleepHours("");
    setSleepType(null);
    invalidate();
  };

  const toggleMuscle = (m: string) =>
    setMuscles((ms) => (ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m]));

  const logWorkout = async () => {
    if (!user || (!workout.trim() && !muscles.length)) {
      toast.error("Descreva o treino ou marque os grupos trabalhados.");
      return;
    }
    const desc = workout.trim() || muscles.join(", ");
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "vitalidade", kind: "workout",
      payload: {
        description: desc,
        muscles,
        summary: `Treino: ${desc}${muscles.length ? ` (${muscles.join(", ")})` : ""}`,
      },
      source: "form",
    });
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Treino registrado. +8 XP");
    setWorkout("");
    setMuscles([]);
    invalidate();
  };

  // ── Relatório: partes do corpo treinadas (30 dias) ──────────
  const muscleCounts: Record<string, number> = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  let taggedWorkouts = 0;
  for (const w of data?.workouts ?? []) {
    const ms = w.payload?.muscles ?? [];
    if (ms.length) taggedWorkouts++;
    for (const m of ms) if (m in muscleCounts) muscleCounts[m]++;
  }
  const maxCount = Math.max(1, ...Object.values(muscleCounts));
  const radarData = MUSCLES.map((m) => ({ muscle: m, treinos: muscleCounts[m] }));
  const barData = [...radarData].sort((a, b) => b.treinos - a.treinos);
  const leastTrained = MUSCLES.filter((m) => muscleCounts[m] === Math.min(...MUSCLES.filter((x) => x !== "Cardio").map((x) => muscleCounts[x])) && m !== "Cardio");

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
          <p className="text-sm font-medium flex items-center gap-1.5"><Moon className="w-4 h-4" /> Sono</p>
          <div className="flex gap-1.5">
            {([["sleep", "Noite"], ["nap", "Soneca"]] as const).map(([t, label]) => (
              <button
                key={t} type="button" onClick={() => setSleepType(t)}
                className={cn(
                  "text-xs rounded-full border px-3 py-1 transition-colors",
                  effectiveSleepType === t ? "border-transparent text-white" : "text-muted-foreground hover:bg-muted/60"
                )}
                style={effectiveSleepType === t ? { background: "hsl(var(--vitalidade))" } : undefined}
                aria-pressed={effectiveSleepType === t}
              >
                {label}
              </button>
            ))}
          </div>
          {data?.sleptTonight && effectiveSleepType === "nap" && sleepType === null && (
            <p className="text-[11px] text-muted-foreground">
              Sono da noite já registrado hoje, então sugeri soneca. Pode trocar acima.
            </p>
          )}
          <div className="flex gap-2">
            <Input inputMode="decimal"
              placeholder={effectiveSleepType === "nap" ? "Duração em horas: 0,5 = 30 min" : "Horas na noite: ex. 7,5"}
              value={sleepHours}
              onChange={(e) => setSleepHours(e.target.value)} />
            <Button onClick={logSleep} variant="secondary">Salvar</Button>
          </div>
        </Card>
        <Card className="p-4 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5"><Dumbbell className="w-4 h-4" /> Treino de hoje</p>
          <Input maxLength={80} placeholder="Ex.: pernas, corrida 5km" value={workout}
            onChange={(e) => setWorkout(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {MUSCLES.map((m) => (
              <button
                key={m} type="button" onClick={() => toggleMuscle(m)}
                className={cn(
                  "text-xs rounded-full border px-2.5 py-1 transition-colors",
                  muscles.includes(m)
                    ? "border-transparent text-white"
                    : "text-muted-foreground hover:bg-muted/60"
                )}
                style={muscles.includes(m) ? { background: "hsl(var(--vitalidade))" } : undefined}
                aria-pressed={muscles.includes(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <Button onClick={logWorkout} variant="secondary" className="w-full">Salvar treino</Button>
        </Card>
      </div>

      {/* ── Relatório: partes do corpo treinadas ─────────────── */}
      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} />
            Corpo treinado — últimos 30 dias
          </h2>
          <p className="text-xs text-muted-foreground">
            Marque os grupos ao salvar o treino e este mapa mostra o equilíbrio da sua rotina.
          </p>
        </div>

        {taggedWorkouts === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Nenhum treino com grupos marcados ainda. No próximo treino, toque nos grupos
            trabalhados antes de salvar — o gráfico nasce daí.
          </p>
        ) : (
          <>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="75%">
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="muscle" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Radar dataKey="treinos" stroke="hsl(var(--vitalidade))"
                    fill="hsl(var(--vitalidade))" fillOpacity={0.35} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="muscle" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
                    contentStyle={{
                      background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                      borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))",
                    }}
                  />
                  <Bar dataKey="treinos" radius={[5, 5, 0, 0]}>
                    {barData.map((d, i) => (
                      <Cell key={i} fill={`hsl(var(--vitalidade) / ${0.35 + (d.treinos / maxCount) * 0.65})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {leastTrained.length > 0 && leastTrained.length < 6 && (
              <p className="text-xs text-muted-foreground">
                💡 {leastTrained.join(" e ")} {leastTrained.length === 1 ? "apareceu" : "apareceram"} menos
                no período — se fizer sentido para o seu objetivo, vale dar atenção.
              </p>
            )}
          </>
        )}
      </Card>

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

      {/* ── Saúde: condições para o Conselheiro considerar ──── */}
      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold flex items-center gap-1.5">
            <HeartPulse className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} />
            Minha saúde
          </h2>
          <p className="text-xs text-muted-foreground">
            Condições, alergias, lesões: o que o Conselheiro precisa saber para as sugestões
            de treino e alimentação respeitarem o seu corpo.
            Ex.: "diabetes tipo 2", "alergia a amendoim", "hérnia de disco".
          </p>
        </div>

        {conditions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {conditions.map((c, i) => (
              <span key={`${c}-${i}`} className="inline-flex items-center gap-1.5 text-xs rounded-full border bg-muted/60 px-2.5 py-1 max-w-full">
                <span className="truncate">{c}</span>
                <button onClick={() => removeCondition(i)} aria-label={`Remover ${c}`}
                  className="text-muted-foreground hover:text-foreground shrink-0">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <form onSubmit={addCondition} className="flex gap-2">
          <Input maxLength={80} placeholder="Adicionar condição de saúde"
            className="min-w-0 flex-1" value={conditionInput}
            onChange={(e) => setConditionInput(e.target.value)} />
          <Button type="submit" size="icon" className="shrink-0" aria-label="Adicionar condição">
            <Plus className="w-4 h-4" />
          </Button>
        </form>

        {/* Medicamentos em uso */}
        <div className="pt-1 space-y-2.5">
          <div>
            <p className="text-sm font-medium">Medicamentos em uso</p>
            <p className="text-xs text-muted-foreground">
              Ex.: "metformina", "losartana", "vitamina D". O Conselheiro considera nas sugestões,
              mas nunca vai mexer em dose ou uso: isso é sempre com quem prescreveu.
            </p>
          </div>

          {medications.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {medications.map((m, i) => (
                <span key={`${m}-${i}`} className="inline-flex items-center gap-1.5 text-xs rounded-full border bg-muted/60 px-2.5 py-1 max-w-full">
                  <span className="truncate">{m}</span>
                  <button onClick={() => removeMedication(i)} aria-label={`Remover ${m}`}
                    className="text-muted-foreground hover:text-foreground shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <form onSubmit={addMedication} className="flex gap-2">
            <Input maxLength={80} placeholder="Adicionar medicamento"
              className="min-w-0 flex-1" value={medicationInput}
              onChange={(e) => setMedicationInput(e.target.value)} />
            <Button type="submit" size="icon" className="shrink-0" aria-label="Adicionar medicamento">
              <Plus className="w-4 h-4" />
            </Button>
          </form>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Isso adapta as sugestões, mas não substitui acompanhamento médico — decisões clínicas
          ficam sempre com o seu profissional de saúde.
        </p>
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