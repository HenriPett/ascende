import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { HeartHandshake, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const MOODS = [
  { score: 1, emoji: "😞", label: "péssimo" },
  { score: 2, emoji: "🙁", label: "ruim" },
  { score: 3, emoji: "😐", label: "ok" },
  { score: 4, emoji: "🙂", label: "bem" },
  { score: 5, emoji: "😄", label: "ótimo" },
];

interface MindEvent { id: string; kind: string; occurred_at: string; payload: { label?: string; score?: number; text?: string; description?: string; summary?: string } }

export default function Mente() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [gratitude, setGratitude] = useState("");
  const practiceLabel = profile?.spirituality_label || "Momento de prática";

  const { data: events } = useQuery({
    queryKey: ["mind-events", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data } = await supabase.from("life_events")
        .select("id,kind,occurred_at,payload")
        .eq("user_id", user!.id).eq("pillar", "mente").gte("occurred_at", since)
        .order("occurred_at", { ascending: false }).limit(60);
      return (data ?? []) as MindEvent[];
    },
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const moodToday = (events ?? []).find((e) => e.kind === "mood" && e.occurred_at.slice(0, 10) === todayIso);
  const practiceToday = (events ?? []).some((e) => e.kind === "practice" && e.occurred_at.slice(0, 10) === todayIso);

  const logMood = async (score: number, label: string) => {
    if (!user) return;
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "mente", kind: "mood",
      payload: { score, label, summary: `Humor: ${label}` }, source: "form",
    });
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Humor registrado. Obrigado pela honestidade. +5 XP");
    qc.invalidateQueries();
  };

  const logPractice = async () => {
    if (!user) return;
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "mente", kind: "practice",
      payload: { description: practiceLabel, summary: practiceLabel }, source: "form",
    });
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Prática registrada. +8 XP");
    qc.invalidateQueries();
  };

  const logGratitude = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !gratitude.trim()) return;
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "mente", kind: "gratitude",
      payload: { text: gratitude.trim(), summary: "Gratidão registrada" }, source: "form",
    });
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Guardado. +5 XP");
    setGratitude("");
    qc.invalidateQueries();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold" style={{ color: "hsl(var(--mente))" }}>
          Mente & Espírito
        </h1>
        <p className="text-sm text-muted-foreground">
          Aqui não existe resposta certa. Só o seu momento, registrado com honestidade.
        </p>
      </div>

      {/* Humor */}
      <Card className="p-4">
        <h2 className="font-display font-semibold mb-1">Como você está agora?</h2>
        {moodToday && (
          <p className="text-xs text-muted-foreground mb-2">
            Você já registrou "{moodToday.payload?.label}" hoje — pode registrar de novo se mudou.
          </p>
        )}
        <div className="grid grid-cols-5 gap-1.5 mt-2">
          {MOODS.map((m) => (
            <button
              key={m.score}
              onClick={() => logMood(m.score, m.label)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md border py-2.5 hover:bg-muted/60 transition-colors",
                moodToday?.payload?.score === m.score && "border-primary ring-1 ring-primary"
              )}
            >
              <span className="text-xl" aria-hidden>{m.emoji}</span>
              <span className="text-[11px] text-muted-foreground">{m.label}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Prática espiritual — no vocabulário da pessoa */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-semibold">{practiceLabel}</h2>
            <p className="text-xs text-muted-foreground">
              Sua prática, do seu jeito. Registrar mantém o compromisso vivo.
            </p>
          </div>
          <Button onClick={logPractice} variant={practiceToday ? "secondary" : "default"}>
            {practiceToday ? "Feito hoje ✓" : "Pratiquei hoje"}
          </Button>
        </div>
      </Card>

      {/* Gratidão */}
      <Card className="p-4">
        <h2 className="font-display font-semibold mb-1 flex items-center gap-1.5">
          <HeartHandshake className="w-4 h-4" /> Pelo que você é grato(a) hoje?
        </h2>
        <form onSubmit={logGratitude} className="flex gap-2 mt-2">
          <Input maxLength={200} placeholder="Uma coisa pequena já conta"
            value={gratitude} onChange={(e) => setGratitude(e.target.value)} />
          <Button type="submit" size="icon" aria-label="Guardar gratidão"><Send className="w-4 h-4" /></Button>
        </form>
      </Card>

      {/* Recentes */}
      {(events ?? []).length > 0 && (
        <Card className="p-4">
          <h2 className="font-display font-semibold mb-3">Últimos registros</h2>
          <div className="space-y-1.5">
            {(events ?? []).slice(0, 12).map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground w-14 shrink-0">
                  {new Date(e.occurred_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                </span>
                <span className="truncate">
                  {e.payload?.text ?? e.payload?.summary ?? e.payload?.description ?? e.kind}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
