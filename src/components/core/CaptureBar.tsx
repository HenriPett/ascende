import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Sparkles, Loader2, Check, X, Mic, MicOff } from "lucide-react";
import { pillarById } from "@/lib/pillars";
import { saveProposedEvents, type ProposedEvent } from "@/lib/captureEvents";
import { useDictation } from "@/hooks/useDictation";

const EXAMPLES = [
  "Gastei 47 no mercado e treinei pernas",
  "Dormi umas 6h, tô meio cansado",
  "Almocei frango com arroz, orei de manhã",
];

export default function CaptureBar() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposed, setProposed] = useState<ProposedEvent[] | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const { listening, toggle: toggleMic, stop: stopMic } = useDictation(
    (t) => setText((v) => (v ? v + " " : "") + t)
  );

  const analyze = async () => {
    if (!text.trim()) return;
    stopMic();
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("capture", { body: { text: text.trim() } });
      if (error || data?.error) throw new Error(data?.error ?? "Falha na captura");
      const events: ProposedEvent[] = data?.events ?? [];
      if (!events.length) {
        toast.info("Não encontrei nada para registrar nesse texto. Tente descrever o que aconteceu — um gasto, um treino, como você dormiu...");
        return;
      }
      setProposed(events);
      setChecked(events.map(() => true));
    } catch {
      toast.error("Não consegui interpretar agora. Verifique sua conexão e tente de novo.");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!user || !proposed) return;
    const selected = proposed.filter((_, i) => checked[i]);
    if (!selected.length) { setProposed(null); return; }
    setSaving(true);
    try {
      await saveProposedEvents(user.id, selected);
      toast.success(
        selected.length === 1 ? "Registrado! +XP" : `${selected.length} registros feitos de uma vez. +XP`
      );
      setText("");
      setProposed(null);
      qc.invalidateQueries();
    } catch {
      toast.error("Não consegui salvar. Tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 space-y-3 border-gold/30">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="w-4 h-4 text-gold" />
        Conte como foi — eu registro tudo para você
      </div>

      {!proposed && (
        <>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={listening ? "Ouvindo... conte como foi o seu dia" : `Ex.: "${EXAMPLES[new Date().getDate() % EXAMPLES.length]}"`}
            rows={2}
            maxLength={2000}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); analyze(); }
            }}
          />
          <div className="flex justify-end gap-1.5">
            <Button
              variant={listening ? "default" : "ghost"} size="icon"
              className={listening ? "animate-pulse" : "text-muted-foreground"}
              onClick={toggleMic} disabled={loading}
              aria-label={listening ? "Parar de ouvir" : "Falar por voz"}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
            <Button onClick={analyze} disabled={loading || !text.trim()}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Registrar"}
            </Button>
          </div>
        </>
      )}

      {proposed && (
        <div className="space-y-2 animate-fade-up">
          <p className="text-sm text-muted-foreground">Encontrei isto no seu relato. Confirma?</p>
          {proposed.map((ev, i) => {
            const meta = pillarById(ev.pillar);
            return (
              <label key={i} className="flex items-center gap-3 rounded-md border p-2.5 cursor-pointer">
                <Checkbox
                  checked={checked[i]}
                  onCheckedChange={(v) => setChecked((c) => c.map((x, j) => (j === i ? !!v : x)))}
                />
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: meta ? `hsl(var(${meta.colorVar}))` : "hsl(var(--muted-foreground))" }}
                  aria-hidden
                />
                <span className="text-sm flex-1 min-w-0 break-words">{ev.summary}</span>
                <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">{meta?.name ?? ev.pillar}</span>
              </label>
            );
          })}
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" onClick={() => setProposed(null)} disabled={saving}>
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button onClick={confirm} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Check className="w-4 h-4 mr-1" /> Confirmar</>)}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}