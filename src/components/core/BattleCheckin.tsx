import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Swords, ShieldCheck, Shield, CloudRain, ChevronRight } from "lucide-react";
import { todayISO } from "@/lib/format";
import { daysAgoISOInSP } from "@/lib/dates";
import {
  type Battle, type BattleCheckin as Checkin, type CheckinStatus,
  battleLabel, MILESTONES, computeBattleStats,
} from "@/lib/battles";
import { cn } from "@/lib/utils";

const STATUS_META: Record<CheckinStatus, { label: string; toastMsg: string; icon: typeof Shield }> = {
  clean: { label: "Dia limpo", toastMsg: "Dia limpo registrado. +10 XP", icon: ShieldCheck },
  resisted: { label: "Resisti à vontade", toastMsg: "Resistir vale mais. +12 XP", icon: Shield },
  relapsed: { label: "Recaí", toastMsg: "Obrigado pela honestidade — é ela que constrói a subida. +5 XP", icon: CloudRain },
};

export function CheckinRow({ battle, todayCheckin }: { battle: Battle; todayCheckin?: Checkin }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [pendingStatus, setPendingStatus] = useState<CheckinStatus | null>(null);
  const [trigger, setTrigger] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (status: CheckinStatus, triggerLabel: string | null, noteText: string) => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("battle_checkins").upsert(
      {
        user_id: user.id, battle_id: battle.id, checkin_date: todayISO(),
        status, trigger_label: triggerLabel, note: noteText.trim() || null,
      },
      { onConflict: "battle_id,checkin_date" }
    );
    setSaving(false);
    if (error) { toast.error("Não consegui salvar. Tente de novo."); return; }
    toast.success(STATUS_META[status].toastMsg);
    setPendingStatus(null); setTrigger(null); setNote("");
    qc.invalidateQueries();
  };

  const pick = (status: CheckinStatus) => {
    if (status === "clean") { save("clean", null, ""); return; }
    setPendingStatus(status); // resisted/relapsed pedem o gatilho
  };

  if (todayCheckin && !pendingStatus) {
    const M = STATUS_META[todayCheckin.status];
    return (
      <div className="flex items-center gap-2.5 rounded-md border bg-success/5 border-success/20 p-3">
        <M.icon className="w-4 h-4 text-success shrink-0" />
        <p className="text-sm flex-1">
          <span className="font-medium">{battleLabel(battle)}</span>
          <span className="text-muted-foreground"> — {M.label.toLowerCase()} registrado hoje</span>
        </p>
        <button className="text-xs text-muted-foreground underline" onClick={() => setPendingStatus(todayCheckin.status)}>
          mudar
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border p-3 space-y-2.5">
      <p className="text-sm font-medium">{battleLabel(battle)}</p>

      {!pendingStatus && (
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(STATUS_META) as CheckinStatus[]).map((s) => {
            const M = STATUS_META[s];
            return (
              <button
                key={s}
                onClick={() => pick(s)}
                disabled={saving}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md border py-2.5 px-1 text-center transition-colors hover:bg-muted/60",
                  s === "clean" && "hover:border-success/50",
                  s === "relapsed" && "hover:border-warning/50"
                )}
              >
                <M.icon className="w-4 h-4" />
                <span className="text-[11px] leading-tight">{M.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {pendingStatus && (
        <div className="space-y-2 animate-fade-up">
          <p className="text-xs text-muted-foreground">
            {pendingStatus === "relapsed" ? "Sem julgamento — o que estava acontecendo?" : "O que bateu?"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...battle.triggers, "outro"].map((t) => (
              <button
                key={t}
                onClick={() => setTrigger(t)}
                className={cn(
                  "text-xs rounded-full border px-2.5 py-1 transition-colors",
                  trigger === t ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                )}
              >
                {t}
              </button>
            ))}
          </div>
          {pendingStatus === "relapsed" && (
            <Input maxLength={200} placeholder="Anotar o contexto ajuda a IA a achar o padrão (opcional)"
              value={note} onChange={(e) => setNote(e.target.value)} className="text-sm" />
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setPendingStatus(null); setTrigger(null); }}>
              Voltar
            </Button>
            <Button size="sm" disabled={saving} onClick={() => save(pendingStatus, trigger, note)}>
              Registrar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Card "Suas batalhas" da tela Hoje. Some se a pessoa não tem batalhas ativas. */
export default function BattleCheckinCard() {
  const { user } = useAuth();
  const today = todayISO();

  const { data } = useQuery({
    queryKey: ["battles-today", user?.id, today],
    enabled: !!user,
    queryFn: async () => {
      const [{ data: battles }, { data: checkins }] = await Promise.all([
        supabase.from("battles").select("*").eq("user_id", user!.id).eq("active", true).order("created_at"),
        supabase.from("battle_checkins").select("*").eq("user_id", user!.id)
          .gte("checkin_date", daysAgoISOInSP(120)),
      ]);
      return { battles: (battles ?? []) as Battle[], checkins: (checkins ?? []) as Checkin[] };
    },
  });

  if (!data?.battles.length) return null;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-semibold flex items-center gap-2">
          <Swords className="w-4 h-4 text-gold" /> Suas batalhas
        </h2>
        <Link to="/app/batalhas" className="text-xs text-muted-foreground flex items-center hover:text-foreground">
          ver tudo <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      <div className="space-y-2">
        {data.battles.map((b) => {
          const cks = data.checkins.filter((c) => c.battle_id === b.id);
          const stats = computeBattleStats(cks);
          const milestoneToday = MILESTONES.includes(stats.currentStreak);
          return (
            <div key={b.id}>
              {milestoneToday && (
                <p className="text-xs text-gold font-medium mb-1">
                  ✦ {stats.currentStreak} dias — marco alcançado. Isso é subida de verdade.
                </p>
              )}
              <CheckinRow battle={b} todayCheckin={cks.find((c) => c.checkin_date === today)} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}