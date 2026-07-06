import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Plus, Trash2, Sparkles, UtensilsCrossed } from "lucide-react";

interface MealEvent { id: string; occurred_at: string; payload: { description?: string; summary?: string } }

export default function Alimentacao() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [meal, setMeal] = useState("");

  const { data: meals, isLoading } = useQuery({
    queryKey: ["meals", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data } = await supabase.from("life_events")
        .select("id,occurred_at,payload")
        .eq("user_id", user!.id).eq("kind", "meal").gte("occurred_at", since)
        .order("occurred_at", { ascending: false }).limit(100);
      return (data ?? []) as MealEvent[];
    },
  });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !meal.trim()) return;
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "alimentacao", kind: "meal",
      payload: { description: meal.trim(), summary: `Refeição: ${meal.trim()}` }, source: "form",
    });
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Refeição registrada. +4 XP");
    setMeal("");
    qc.invalidateQueries();
  };

  const remove = async (id: string) => {
    await supabase.from("life_events").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["meals"] });
  };

  // Agrupa por dia
  const byDay: Record<string, MealEvent[]> = {};
  for (const m of meals ?? []) {
    const day = m.occurred_at.slice(0, 10);
    (byDay[day] ??= []).push(m);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold" style={{ color: "hsl(var(--alimentacao))" }}>
          Alimentação
        </h1>
        <p className="text-sm text-muted-foreground">
          Registre o que come — sem contar calorias, sem culpa. Padrão importa mais que perfeição.
        </p>
      </div>

      {/* O recurso-símbolo: plano alimentar que cabe no orçamento */}
      <Card className="p-4 border-gold/30 bg-gold/5">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-gold mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Plano alimentar que cabe no seu bolso</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              O Conselheiro conhece seu orçamento, seus gastos com comida e seus objetivos.
              Peça um plano que respeite os três — nenhum app de dieta consegue isso.
            </p>
            <Button asChild size="sm" className="mt-2.5">
              <Link to="/app/conselheiro">Montar meu plano</Link>
            </Button>
          </div>
        </div>
      </Card>

      {/* Registro rápido */}
      <Card className="p-4">
        <form onSubmit={add} className="flex gap-2">
          <Input maxLength={140} placeholder="O que você comeu? Ex.: almoço — frango, arroz e salada"
            value={meal} onChange={(e) => setMeal(e.target.value)} />
          <Button type="submit" size="icon" aria-label="Registrar refeição"><Plus className="w-4 h-4" /></Button>
        </form>
      </Card>

      {/* Histórico 14 dias */}
      <Card className="p-4">
        <h2 className="font-display font-semibold mb-3">Últimos 14 dias</h2>
        {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
        {!isLoading && !(meals ?? []).length && (
          <div className="text-center py-6">
            <UtensilsCrossed className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Nenhuma refeição registrada ainda.<br />Registre acima — ou conte na tela Hoje: "almocei frango com arroz".
            </p>
          </div>
        )}
        <div className="space-y-4">
          {Object.entries(byDay).map(([day, items]) => (
            <div key={day}>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                {new Date(day + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" })}
              </p>
              <div className="space-y-1">
                {items.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-md border p-2.5">
                    <span className="text-sm flex-1">{m.payload?.description ?? m.payload?.summary ?? "Refeição"}</span>
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground"
                      onClick={() => remove(m.id)} aria-label="Excluir refeição">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
