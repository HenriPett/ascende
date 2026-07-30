// Rotina de sono — editor estilo iPhone (Feature A do plano).
// Um dial de 24h em SVG puro (sem lib nova; o projeto já desenha anéis de
// nível/água assim) com dois marcadores arrastáveis: lua = dormir,
// sol = acordar. A duração aparece no centro. Abaixo do dial, dois
// <input type="time"> sempre visíveis são a verdade acessível — o dial é
// o açúcar. Salvar grava sleep_bedtime/sleep_waketime e DERIVA sleep_goal_h
// (a rotina vira a fonte; o campo antigo vira derivado — nunca pedimos o
// mesmo dado duas vezes).
import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Moon, Sun, Loader2, BedDouble } from "lucide-react";
import {
  parseTimeToMinutes, minutesToTime, sleepWindowHours, formatWindowHours,
  timeForInput, timePoint, sleepArcPath, pointToMinutes,
} from "@/lib/sleep";

const SIZE = 240;
const CX = SIZE / 2, CY = SIZE / 2;
const R = 96;            // raio da trilha
const HANDLE_R = 15;     // raio dos marcadores

function Dial({
  bedMin, wakeMin, onChange,
}: {
  bedMin: number; wakeMin: number;
  onChange: (which: "bed" | "wake", minutes: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<"bed" | "wake" | null>(null);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = SIZE / rect.width;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  };

  const onPointerDown = (which: "bed" | "wake") => (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = which;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !svgRef.current) return;
    const { x, y } = toLocal(e);
    onChange(dragging.current, pointToMinutes(x, y, CX, CY));
  };
  const onPointerUp = () => { dragging.current = null; };

  const bed = timePoint(bedMin, CX, CY, R);
  const wake = timePoint(wakeMin, CX, CY, R);
  const arc = sleepArcPath(bedMin, wakeMin, CX, CY, R);
  const hours = sleepWindowHours(minutesToTime(bedMin), minutesToTime(wakeMin));

  // Marcações de hora (0, 6, 12, 18) + traços de hora em hora
  const ticks = useMemo(() => Array.from({ length: 24 }, (_, h) => {
    const p1 = timePoint(h * 60, CX, CY, R - 12);
    const p2 = timePoint(h * 60, CX, CY, R - (h % 6 === 0 ? 20 : 16));
    return { h, p1, p2, major: h % 6 === 0 };
  }), []);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="w-[220px] h-[220px] sm:w-[240px] sm:h-[240px] mx-auto touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
      aria-label={`Rotina de sono: dormir às ${minutesToTime(bedMin)}, acordar às ${minutesToTime(wakeMin)}`}
    >
      {/* Trilha de 24h */}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="22" />
      {/* Traços das horas */}
      {ticks.map((t) => (
        <line key={t.h} x1={t.p1.x} y1={t.p1.y} x2={t.p2.x} y2={t.p2.y}
          stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth={t.major ? 1.5 : 1} />
      ))}
      {/* Rótulos 00 / 06 / 12 / 18 */}
      {[0, 6, 12, 18].map((h) => {
        const p = timePoint(h * 60, CX, CY, R - 32);
        return (
          <text key={h} x={p.x} y={p.y + 3} textAnchor="middle"
            fontSize="9" fill="hsl(var(--muted-foreground))">{String(h).padStart(2, "0")}</text>
        );
      })}
      {/* Arco da janela de sono */}
      <path d={arc} fill="none" stroke="hsl(var(--gold))" strokeWidth="22" strokeLinecap="round" opacity="0.9" />
      {/* Duração no centro */}
      <text x={CX} y={CY - 4} textAnchor="middle" fontSize="22" fontWeight="600"
        fill="hsl(var(--foreground))" className="font-display">
        {hours !== null ? formatWindowHours(hours) : "—"}
      </text>
      <text x={CX} y={CY + 14} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">
        de janela de sono
      </text>
      {/* Marcador: dormir (lua) */}
      <g onPointerDown={onPointerDown("bed")} style={{ cursor: "grab" }}
        role="slider" aria-label="Horário de dormir" aria-valuetext={minutesToTime(bedMin)}
        aria-valuemin={0} aria-valuemax={1439} aria-valuenow={bedMin} tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange("bed", (bedMin - 15 + 1440) % 1440);
          if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange("bed", (bedMin + 15) % 1440);
        }}>
        <circle cx={bed.x} cy={bed.y} r={HANDLE_R} fill="hsl(var(--card))"
          stroke="hsl(var(--gold))" strokeWidth="2.5" />
        <Moon x={bed.x - 7} y={bed.y - 7} width={14} height={14}
          color="hsl(var(--gold))" strokeWidth={2.2} />
      </g>
      {/* Marcador: acordar (sol) */}
      <g onPointerDown={onPointerDown("wake")} style={{ cursor: "grab" }}
        role="slider" aria-label="Horário de acordar" aria-valuetext={minutesToTime(wakeMin)}
        aria-valuemin={0} aria-valuemax={1439} aria-valuenow={wakeMin} tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange("wake", (wakeMin - 15 + 1440) % 1440);
          if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange("wake", (wakeMin + 15) % 1440);
        }}>
        <circle cx={wake.x} cy={wake.y} r={HANDLE_R} fill="hsl(var(--card))"
          stroke="hsl(var(--gold))" strokeWidth="2.5" />
        <Sun x={wake.x - 7} y={wake.y - 7} width={14} height={14}
          color="hsl(var(--gold))" strokeWidth={2.2} />
      </g>
    </svg>
  );
}

export default function SleepSchedule({
  compact, onSaved,
}: {
  /** compact: sem Card em volta (para viver dentro de outro card, ex.: onboarding). */
  compact?: boolean;
  onSaved?: (hours: number) => void;
} = {}) {
  const { user } = useAuth();
  const { profile, refresh } = useProfile();
  const [saving, setSaving] = useState(false);
  // Estado local nasce do perfil; padrão 23:00 → 06:30 (7,5h) para editar.
  const [bedMin, setBedMin] = useState<number>(
    () => parseTimeToMinutes(profile?.sleep_bedtime) ?? 23 * 60
  );
  const [wakeMin, setWakeMin] = useState<number>(
    () => parseTimeToMinutes(profile?.sleep_waketime) ?? 6 * 60 + 30
  );

  const hours = sleepWindowHours(minutesToTime(bedMin), minutesToTime(wakeMin));
  const hasSaved = !!profile?.sleep_bedtime && !!profile?.sleep_waketime;
  const dirty = !hasSaved ||
    timeForInput(profile?.sleep_bedtime) !== minutesToTime(bedMin) ||
    timeForInput(profile?.sleep_waketime) !== minutesToTime(wakeMin);

  const save = async () => {
    if (!user || hours === null) {
      toast.error("Defina os dois horários (dormir e acordar).");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      sleep_bedtime: minutesToTime(bedMin),
      sleep_waketime: minutesToTime(wakeMin),
      sleep_goal_h: hours, // derivado: a rotina é a fonte da meta
    }).eq("user_id", user.id);
    setSaving(false);
    if (error) { toast.error("Não consegui salvar a rotina de sono."); return; }
    toast.success(
      `Rotina salva: dormir às ${minutesToTime(bedMin)}, acordar às ${minutesToTime(wakeMin)} ` +
      `(${formatWindowHours(hours)}). De manhã, um toque confirma a noite.`
    );
    refresh();
    onSaved?.(hours);
  };

  const body = (
    <div className="space-y-3">
      {!compact && (
        <div>
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <BedDouble className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} />
            Rotina de sono
          </p>
          <p className="text-xs text-muted-foreground">
            Arraste a lua e o sol (ou use os campos abaixo). Todo dia de manhã, você
            confirma em 1 toque se seguiu — e o sono da noite se registra sozinho.
          </p>
        </div>
      )}

      <Dial
        bedMin={bedMin} wakeMin={wakeMin}
        onChange={(which, m) => (which === "bed" ? setBedMin(m) : setWakeMin(m))}
      />

      {/* A verdade acessível: inputs de hora nativos, sempre visíveis */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <p className="text-xs font-medium flex items-center gap-1"><Moon className="w-3 h-3" /> Dormir</p>
          <Input
            type="time" value={minutesToTime(bedMin)}
            onChange={(e) => { const m = parseTimeToMinutes(e.target.value); if (m !== null) setBedMin(m); }}
            aria-label="Horário de dormir"
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium flex items-center gap-1"><Sun className="w-3 h-3" /> Acordar</p>
          <Input
            type="time" value={minutesToTime(wakeMin)}
            onChange={(e) => { const m = parseTimeToMinutes(e.target.value); if (m !== null) setWakeMin(m); }}
            aria-label="Horário de acordar"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {hours !== null
            ? `${formatWindowHours(hours)} por noite — vira sua meta de sono.`
            : "Defina os dois horários."}
        </p>
        <Button size="sm" onClick={save} disabled={saving || !dirty || hours === null}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : hasSaved ? "Atualizar rotina" : "Salvar rotina"}
        </Button>
      </div>
    </div>
  );

  return compact ? body : <Card className="p-4">{body}</Card>;
}
