import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useXp } from "@/hooks/useXp";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PILLARS } from "@/lib/pillars";
import { monthStartISO } from "@/lib/format";

function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }

export default function Score() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { xp, level, progress, nextFloor } = useXp();

  const { data } = useQuery({
    queryKey: ["score-data", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since14 = new Date(Date.now() - 14 * 864e5).toISOString();
      const [{ data: events }, { data: txs }, { data: habits }, { data: logs }] = await Promise.all([
        supabase.from("life_events").select("pillar,kind,occurred_at,payload").eq("user_id", user!.id).gte("occurred_at", since14),
        supabase.from("transactions").select("kind,amount").eq("user_id", user!.id).gte("occurred_at", monthStartISO()),
        supabase.from("habits").select("id").eq("user_id", user!.id).eq("active", true),
        supabase.from("habit_logs").select("log_date").eq("user_id", user!.id).gte("log_date", new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10)),
      ]);
      return { events: events ?? [], txs: txs ?? [], habitsCount: (habits ?? []).length, logs: logs ?? [] };
    },
  });

  // ─── Cálculo do score por pilar (0–100, transparente) ───
  const scores: Record<string, { value: number | null; why: string }> = {
    prosperidade: { value: null, why: "Registre entradas e gastos para medir." },
    vitalidade: { value: null, why: "Crie hábitos e registre sono para medir." },
    alimentacao: { value: null, why: "Registre refeições para medir." },
    mente: { value: null, why: "Registre humor e prática para medir." },
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

    // Vitalidade: conclusão de hábitos (14d) + sono médio vs. 7–8h
    const parts: number[] = [];
    if (habitsCount > 0) parts.push(clamp((logs.length / (habitsCount * 14)) * 100));
    const sleeps = events.filter((e) => e.kind === "sleep").map((e) => Number((e.payload as { hours?: number })?.hours)).filter((n) => n > 0);
    if (sleeps.length) {
      const avg = sleeps.reduce((a, b) => a + b, 0) / sleeps.length;
      parts.push(clamp(100 - Math.abs(avg - 7.5) * 22));
    }
    if (parts.length) {
      scores.vitalidade = {
        value: clamp(parts.reduce((a, b) => a + b, 0) / parts.length),
        why: "Baseado na conclusão de hábitos e no sono médio (ideal ~7,5h).",
      };
    }

    // Alimentação: dias com refeição registrada nos últimos 14
    const mealDays = new Set(events.filter((e) => e.kind === "meal").map((e) => e.occurred_at.slice(0, 10))).size;
    if (mealDays > 0) {
      scores.alimentacao = { value: clamp((mealDays / 14) * 100), why: "Baseado em quantos dos últimos 14 dias tiveram refeições registradas." };
    }

    // Mente: média de humor + frequência de prática
    const moods = events.filter((e) => e.kind === "mood").map((e) => Number((e.payload as { score?: number })?.score)).filter((n) => n >= 1);
    const practices = new Set(events.filter((e) => e.kind === "practice").map((e) => e.occurred_at.slice(0, 10))).size;
    const mparts: number[] = [];
    if (moods.length) mparts.push(clamp(((moods.reduce((a, b) => a + b, 0) / moods.length) - 1) * 25));
    if (practices > 0) mparts.push(clamp((practices / 14) * 100));
    if (mparts.length) {
      scores.mente = { value: clamp(mparts.reduce((a, b) => a + b, 0) / mparts.length), why: "Baseado no humor médio e na frequência da sua prática." };
    }
  }

  const activePillars = new Set(profile?.pillars ?? []);
  const measured = PILLARS.filter((p) => scores[p.id].value !== null);
  const overall = measured.length
    ? Math.round(measured.reduce((s, p) => s + (scores[p.id].value as number), 0) / measured.length)
    : null;

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold">Seu Score de Vida</h1>
        <p className="text-sm text-muted-foreground">
          O XP mede a sua <strong>consistência</strong> (registrar, praticar). O score mede o <strong>estado</strong> de
          cada pilar. Suba os dois no seu ritmo.
        </p>
      </div>

      {/* Nível e XP */}
      <Card className="p-5 bg-primary text-primary-foreground">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm opacity-80">Nível atual</p>
            <p className="font-display text-4xl font-semibold text-gold" style={{ color: "hsl(41 70% 62%)" }}>{level}</p>
          </div>
          <div className="text-right">
            <p className="text-sm opacity-80">{xp} XP</p>
            <p className="text-xs opacity-70">próximo nível aos {nextFloor} XP</p>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-primary-foreground/15">
          <div className="h-2 rounded-full" style={{ width: `${progress * 100}%`, background: "hsl(41 70% 62%)" }} />
        </div>
      </Card>

      {overall !== null && (
        <Card className="p-4 flex items-center justify-between">
          <p className="text-sm font-medium">Score geral (pilares com dados)</p>
          <p className="font-display text-2xl font-semibold">{overall}<span className="text-sm text-muted-foreground">/100</span></p>
        </Card>
      )}

      {/* Por pilar */}
      <div className="space-y-2.5">
        {PILLARS.map((p) => {
          const s = scores[p.id];
          const inactive = !activePillars.has(p.id);
          return (
            <Card key={p.id} className={inactive && s.value === null ? "p-4 opacity-60" : "p-4"}>
              <div className="flex items-center gap-3 mb-2">
                <p.icon className="w-4 h-4" style={{ color: `hsl(var(${p.colorVar}))` }} />
                <p className="text-sm font-semibold flex-1">{p.attribute}</p>
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

      <p className="text-xs text-muted-foreground">
        Semana ruim não apaga a subida: o score olha 14 dias, e o XP nunca diminui.
      </p>
    </div>
  );
}
