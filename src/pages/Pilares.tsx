import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PILLARS } from "@/lib/pillars";
import { ChevronRight, Swords, ClipboardList } from "lucide-react";

export default function Pilares() {
  const { user } = useAuth();
  const { profile } = useProfile();

  const { data: counts } = useQuery({
    queryKey: ["pillar-activity", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data } = await supabase.from("life_events")
        .select("pillar").eq("user_id", user!.id).gte("occurred_at", since);
      const c: Record<string, number> = {};
      for (const e of data ?? []) c[e.pillar] = (c[e.pillar] ?? 0) + 1;
      return c;
    },
  });

  const active = new Set(profile?.pillars ?? []);

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold">Pilares</h1>
        <p className="text-sm text-muted-foreground">
          Cada área da vida, no mesmo lugar. Ative novos pilares em Ajustes quando estiver pronto.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {PILLARS.map((p) => {
          const isActive = active.has(p.id);
          const n = counts?.[p.id] ?? 0;
          return (
            <Card key={p.id} className={!isActive ? "opacity-70" : undefined}>
              <Link to={p.route} className="flex items-center gap-4 p-4">
                <div
                  className="w-11 h-11 rounded-md grid place-items-center shrink-0"
                  style={{ background: `hsl(var(${p.colorVar}) / 0.12)` }}
                >
                  <p.icon className="w-5 h-5" style={{ color: `hsl(var(${p.colorVar}))` }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{p.name}</p>
                    {!isActive && <Badge variant="secondary" className="text-[10px]">inativo</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {n > 0 ? `${n} registros nos últimos 14 dias` : p.desc}
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
              </Link>
            </Card>
          );
        })}

        {/* Batalhas: transversal aos pilares */}
        <Card className="border-gold/30">
          <Link to="/app/batalhas" className="flex items-center gap-4 p-4">
            <div className="w-11 h-11 rounded-md grid place-items-center shrink-0 bg-gold/10">
              <Swords className="w-5 h-5 text-gold" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">Batalhas</p>
              <p className="text-xs text-muted-foreground truncate">
                As lutas que você escolheu enfrentar — sem julgamento, com método
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
          </Link>
        </Card>

        {/* Planos salvos do Conselheiro */}
        <Card className="border-gold/30">
          <Link to="/app/planos" className="flex items-center gap-4 p-4">
            <div className="w-11 h-11 rounded-md grid place-items-center shrink-0 bg-gold/10">
              <ClipboardList className="w-5 h-5 text-gold" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">Meus planos</p>
              <p className="text-xs text-muted-foreground truncate">
                Planos alimentares, de treino e financeiros que o Conselheiro montou para você
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
          </Link>
        </Card>
      </div>
    </div>
  );
}