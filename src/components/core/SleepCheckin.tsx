// Check-in matinal de sono — 1 toque, estilo iPhone (Feature A do plano).
// Aparece na tela Hoje somente quando: rotina configurada E ainda não há
// evento `sleep` hoje E manhã (antes das 12h em SP) E tracker de sono ativo.
//
// Regras de tom (PRINCIPIOS.md, "Nunca" 3 e 4): é um convite que desaparece —
// some após respondido, some sozinho depois do meio-dia, nunca vira push,
// nunca acumula "dias não respondidos". "Não segui" nunca é falha: só abre
// o ajuste rápido de horas, sem juízo.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateKeys, SLEEP_KEYS } from "@/lib/queryKeys";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Moon, Check, Loader2, X } from "lucide-react";
import { todayISO } from "@/lib/format";
import { hourInSP } from "@/lib/dates";
import { sleepWindowHours, timeForInput, formatWindowHours } from "@/lib/sleep";
import { isTrackerActive } from "@/lib/trackers";

export default function SleepCheckin() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [hoursInput, setHoursInput] = useState("");
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(`ascend-sleep-checkin-${todayISO()}`) === "1"
  );

  const scheduleHours = sleepWindowHours(profile?.sleep_bedtime, profile?.sleep_waketime);
  const trackerOn = isTrackerActive(profile, "sleep");
  const morning = hourInSP() < 12; // depois do meio-dia o convite some sozinho
  const eligible = !!user && !!profile && trackerOn && scheduleHours !== null && morning && !dismissed;

  const { data: sleptToday } = useQuery({
    queryKey: ["sleep-today", user?.id, todayISO()],
    enabled: eligible,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const { count } = await supabase.from("life_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id).eq("kind", "sleep")
        .gte("occurred_at", dayStart.toISOString());
      return (count ?? 0) > 0;
    },
  });

  if (!eligible || sleptToday !== false) return null;

  const dismiss = () => {
    try { localStorage.setItem(`ascend-sleep-checkin-${todayISO()}`, "1"); } catch { /* noop */ }
    setDismissed(true);
  };

  const log = async (hours: number, followed: boolean) => {
    if (!user || saving) return;
    setSaving(true);
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "vitalidade", kind: "sleep",
      payload: {
        hours,
        followed_schedule: followed,
        bedtime: timeForInput(profile?.sleep_bedtime),
        waketime: timeForInput(profile?.sleep_waketime),
        summary: followed ? `Sono: ${String(hours).replace(".", ",")}h (rotina seguida)` : `Sono: ${String(hours).replace(".", ",")}h`,
      },
      source: "form",
    });
    setSaving(false);
    if (error) { toast.error("Não consegui registrar o sono."); return; }
    toast.success(
      followed
        ? `Rotina seguida: ${formatWindowHours(hours)} de sono. +5 XP`
        : `Sono registrado: ${formatWindowHours(hours)}. +5 XP`
    );
    dismiss();
    invalidateKeys(qc, SLEEP_KEYS);
  };

  const followedYes = () => log(scheduleHours!, true);

  const confirmAdjust = () => {
    const h = Number(hoursInput.replace(",", "."));
    if (!h || h <= 0 || h > 24) { toast.error("Quantas horas você dormiu? Ex.: 6,5"); return; }
    log(Math.round(h * 10) / 10, false);
  };

  return (
    <Card className="p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-full grid place-items-center shrink-0"
            style={{ background: "hsl(var(--vitalidade) / 0.12)" }}>
            <Moon className="w-5 h-5" style={{ color: "hsl(var(--vitalidade))" }} />
          </div>
          <div>
            <p className="text-sm font-semibold">Você seguiu sua rotina de sono?</p>
            <p className="text-xs text-muted-foreground">
              {timeForInput(profile?.sleep_bedtime)} → {timeForInput(profile?.sleep_waketime)}
              {" · "}{formatWindowHours(scheduleHours!)}
            </p>
          </div>
        </div>
        <button onClick={dismiss} className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Não registrar o sono hoje">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!adjusting ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={followedYes} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Check className="w-4 h-4 mr-1" /> Segui</>)}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setAdjusting(true)} disabled={saving}>
            Foi diferente
          </Button>
        </div>
      ) : (
        <div className="flex gap-2 animate-fade-up">
          <Input
            inputMode="decimal" autoFocus
            placeholder="Quantas horas? Ex.: 6,5"
            value={hoursInput}
            onChange={(e) => setHoursInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmAdjust(); } }}
          />
          <Button size="sm" className="h-10" onClick={confirmAdjust} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Registrar"}
          </Button>
        </div>
      )}
    </Card>
  );
}
