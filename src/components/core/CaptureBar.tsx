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
import { pillarById, captureExamplesFor } from "@/lib/pillars";
import { useProfile } from "@/hooks/useProfile";
import { saveProposedEvents, type ProposedEvent } from "@/lib/captureEvents";
import { xpForKind } from "@/lib/xp";
import { useDictation } from "@/hooks/useDictation";
import LearnedInsights, { type LearnedMemory } from "@/components/core/LearnedInsights";
import FirstTimeTip from "@/components/core/FirstTimeTip";
import { useGuides } from "@/hooks/useGuides";
import Paywall from "@/components/core/Paywall";
import { readFnError, isPlanLimit, type PlanLimitError } from "@/lib/fnError";

/* Exemplos coerentes com os pilares ATIVOS da pessoa (modularidade real,
   Sugestão 1 do plano de feedbacks): quem escolheu só Prosperidade não vê
   "treinei pernas" como exemplo. A lista vem de captureExamplesFor(). */

/** Explica o XP uma única vez, no primeiro registro da vida do usuário
 *  (análise UX P2.3): "+4 XP" sem contexto não significa nada no dia 1. */
export function xpToastSuffix(): string {
  try {
    if (localStorage.getItem("ascend-xp-explained")) return "";
    localStorage.setItem("ascend-xp-explained", "1");
    return " — cada registro sobe seu nível de vida real";
  } catch { return ""; }
}

export default function CaptureBar({
  initialText,
  onConfirmed,
}: {
  /** Pré-preenche a frase (ex.: continuidade da demo da landing no onboarding). */
  initialText?: string;
  /** Chamado após uma confirmação bem-sucedida (o onboarding usa para celebrar). */
  onConfirmed?: (count: number) => void;
} = {}) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [text, setText] = useState(initialText ?? "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposed, setProposed] = useState<ProposedEvent[] | null>(null);
  const [limitInfo, setLimitInfo] = useState<PlanLimitError | null>(null);
  const [learned, setLearned] = useState<LearnedMemory[] | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const { listening, toggle: toggleMic, stop: stopMic } = useDictation(
    (t) => setText((v) => (v ? v + " " : "") + t)
  );
  const { markSeen } = useGuides();

  const analyze = async () => {
    if (!text.trim()) return;
    stopMic();
    markSeen("hoje-captura"); // usou a função: a dica não é mais necessária
    setLoading(true);
    setLearned(null);
    try {
      const { data, error } = await supabase.functions.invoke("capture", { body: { text: text.trim() } });
      if (error) {
        const body = await readFnError(error);
        if (isPlanLimit(body)) { setLimitInfo(body); return; }
        throw new Error("Falha na captura");
      }
      if (data?.error) throw new Error(data.error);
      const events: ProposedEvent[] = data?.events ?? [];
      const insights = (data?.learned ?? []) as LearnedMemory[];
      if (insights.length) {
        setLearned(insights);
        qc.invalidateQueries({ queryKey: ["ai-memories"] });
      }
      if (!events.length) {
        if (!insights.length) {
          toast.info("Não encontrei nada para registrar nesse texto. Tente descrever o que aconteceu — um gasto, um treino, como você dormiu...");
        } else {
          setText("");
        }
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
    markSeen("confirmar-registros"); // confirmou uma vez: já sabe como funciona
    const selected = proposed.filter((_, i) => checked[i]);
    if (!selected.length) { setProposed(null); return; }
    setSaving(true);
    try {
      await saveProposedEvents(user.id, selected);
      const gained = selected.reduce((sum, ev) => sum + xpForKind(ev.kind), 0);
      toast.success(
        (selected.length === 1
          ? `${selected[0].summary} · +${gained} XP`
          : `${selected.length} registros feitos de uma vez · +${gained} XP`) + xpToastSuffix()
      );
      setText("");
      setProposed(null);
      qc.invalidateQueries();
      onConfirmed?.(selected.length);
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
          <FirstTimeTip id="hoje-captura" />
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={(() => {
              if (listening) return "Ouvindo... conte como foi o seu dia";
              const examples = captureExamplesFor(profile?.pillars);
              return `Ex.: "${examples[new Date().getDate() % examples.length]}"`;
            })()}
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
          <FirstTimeTip id="confirmar-registros" />
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

      {/* O que a IA aprendeu sobre a pessoa neste relato */}
      {learned && (
        <LearnedInsights items={learned} onDismiss={() => setLearned(null)} />
      )}

      {/* Paywall contextual: só quando o limite do plano é atingido */}
      <Paywall info={limitInfo} onClose={() => setLimitInfo(null)} />
    </Card>
  );
}