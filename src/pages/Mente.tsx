import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, JOURNAL_COLORS, journalColorHsl } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { HeartHandshake, Send, BookOpen, Loader2, Trash2, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { eventLabel } from "@/lib/eventLabels";
import { todayISOInSP, dateISOInSP } from "@/lib/dates";

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
  const { profile, refresh: refreshProfile } = useProfile();
  const qc = useQueryClient();
  const [gratitude, setGratitude] = useState("");
  const [journalText, setJournalText] = useState("");
  const [savingJournal, setSavingJournal] = useState(false);

  // Modo sem religião: foco em desenvolvimento da mente
  const hasReligion = profile?.has_religion !== false;
  const pageTitle = hasReligion ? "Mente & Espírito" : "Mente & Foco";
  const practiceLabel = hasReligion
    ? (profile?.spirituality_label || "Momento de prática")
    : "Momento para a mente";
  const practiceHint = hasReligion
    ? "Sua prática, do seu jeito. Registrar mantém o compromisso vivo."
    : "Meditação, respiração, leitura, silêncio — qualquer pausa que treine sua mente conta.";

  const journalHsl = journalColorHsl(profile?.journal_color);

  const { data: events } = useQuery({
    queryKey: ["mind-events", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data } = await supabase.from("life_events")
        .select("id,kind,occurred_at,payload")
        .eq("user_id", user!.id).eq("pillar", "mente").gte("occurred_at", since)
        .order("occurred_at", { ascending: false }).limit(80);
      return (data ?? []) as MindEvent[];
    },
  });

  // "Hoje" SEMPRE no fuso de São Paulo (plano §5.4): perto da meia-noite,
  // toISOString() (UTC) marcava o dia errado.
  const todayIso = todayISOInSP();
  const moodToday = (events ?? []).find((e) => e.kind === "mood" && dateISOInSP(e.occurred_at) === todayIso);
  const practiceToday = (events ?? []).some((e) => e.kind === "practice" && dateISOInSP(e.occurred_at) === todayIso);
  const journalEntries = (events ?? []).filter((e) => e.kind === "journal");
  const journalToday = journalEntries.some((e) => dateISOInSP(e.occurred_at) === todayIso);

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

  // ── Diário ──────────────────────────────────────────────────
  const saveJournal = async () => {
    if (!user || !journalText.trim()) return;
    setSavingJournal(true);
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "mente", kind: "journal",
      payload: {
        text: journalText.trim(),
        summary: "Entrada no diário",
        color: profile?.journal_color ?? "violeta",
      },
      source: "form",
    });
    setSavingJournal(false);
    if (error) { toast.error("Não consegui guardar a entrada."); return; }
    toast.success("Guardado no seu diário. +6 XP");
    setJournalText("");
    qc.invalidateQueries();
  };

  const removeJournal = async (id: string) => {
    await supabase.from("life_events").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["mind-events"] });
  };

  const setJournalColor = async (colorId: string) => {
    if (!user) return;
    const { error } = await supabase.from("profiles")
      .update({ journal_color: colorId }).eq("user_id", user.id);
    if (error) { toast.error("Não consegui trocar a cor."); return; }
    refreshProfile();
  };

  const recent = (events ?? []).filter((e) => e.kind !== "journal");

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold" style={{ color: "hsl(var(--mente))" }}>
          {pageTitle}
        </h1>
        <p className="text-sm text-muted-foreground">
          {hasReligion
            ? "Aqui não existe resposta certa. Só o seu momento, registrado com honestidade."
            : "Treinar a mente também é subida: foco, clareza e emoções registradas com honestidade."}
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

      {/* ── Diário — pensamentos do dia ─────────────────────── */}
      <Card className="overflow-hidden">
        <div className="h-1.5" style={{ background: `hsl(${journalHsl})` }} />
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold flex items-center gap-1.5">
                <BookOpen className="w-4 h-4" style={{ color: `hsl(${journalHsl})` }} />
                Meu diário
              </h2>
              <p className="text-xs text-muted-foreground">
                {journalToday
                  ? "Você já escreveu hoje — pode escrever de novo quando quiser."
                  : "Um espaço só seu para os pensamentos do dia. Escrever organiza a mente."}
              </p>
            </div>
          </div>

          {/* Cor do diário */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground mr-1">Cor do diário:</span>
            {JOURNAL_COLORS.map((c) => {
              const active = (profile?.journal_color ?? "violeta") === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setJournalColor(c.id)}
                  title={c.label}
                  aria-label={`Cor ${c.label}`}
                  className={cn(
                    "w-6 h-6 rounded-full border-2 transition-transform",
                    active ? "border-foreground scale-110" : "border-transparent hover:scale-105"
                  )}
                  style={{ background: `hsl(${c.hsl})` }}
                />
              );
            })}
          </div>

          <Textarea
            value={journalText}
            onChange={(e) => setJournalText(e.target.value)}
            placeholder="O que passou pela sua cabeça hoje?"
            rows={4} maxLength={2000}
            className="resize-none journal-paper leading-7 pt-1"
            style={{ borderColor: `hsl(${journalHsl} / 0.4)` }}
          />
          <div className="flex justify-end">
            <Button onClick={saveJournal} disabled={savingJournal || !journalText.trim()}
              style={{ background: `hsl(${journalHsl})` }}>
              {savingJournal ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar no diário"}
            </Button>
          </div>

          {/* Entradas recentes */}
          {journalEntries.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-xs font-semibold text-muted-foreground">Entradas recentes</p>
              {journalEntries.slice(0, 5).map((e) => (
                <div key={e.id} className="rounded-md border p-3 text-sm"
                  style={{ borderLeft: `3px solid hsl(${journalHsl})` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="whitespace-pre-line break-words flex-1 min-w-0">{e.payload?.text}</p>
                    <Button variant="ghost" size="icon" className="w-6 h-6 shrink-0 text-muted-foreground"
                      onClick={() => removeJournal(e.id)} aria-label="Excluir entrada">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {new Date(e.occurred_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Prática — espiritual ou de desenvolvimento mental */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-semibold flex items-center gap-1.5">
              {!hasReligion && <Brain className="w-4 h-4" style={{ color: "hsl(var(--mente))" }} />}
              {practiceLabel}
            </h2>
            <p className="text-xs text-muted-foreground">{practiceHint}</p>
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
      {recent.length > 0 && (
        <Card className="p-4">
          <h2 className="font-display font-semibold mb-3">Últimos registros</h2>
          <div className="space-y-1.5">
            {recent.slice(0, 12).map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground w-14 shrink-0">
                  {new Date(e.occurred_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                </span>
                <span className="truncate min-w-0 flex-1">
                  {/* Tradução central: nenhum nome interno (habit_done etc.) na tela */}
                  {eventLabel(e.kind, e.payload)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}