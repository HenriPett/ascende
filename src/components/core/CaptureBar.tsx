import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Sparkles, Loader2, Check, X, Mic, MicOff, Camera, ClipboardCheck, Image as ImageIcon } from "lucide-react";
import { pillarById } from "@/lib/pillars";
import { useProfile } from "@/hooks/useProfile";
import { saveProposedEvents, type ProposedEvent } from "@/lib/captureEvents";
import { xpForKind, xpToastSuffix } from "@/lib/xp";
import { sleepWindowHours, timeForInput } from "@/lib/sleep";
import { useDictation } from "@/hooks/useDictation";
import LearnedInsights from "@/components/core/LearnedInsights";
import type { LearnedMemory } from "@/lib/memories";
import FirstTimeTip from "@/components/core/FirstTimeTip";
import { useGuides } from "@/hooks/useGuides";
import Paywall from "@/components/core/Paywall";
import { readFnError, isPlanLimit, type PlanLimitError } from "@/lib/fnError";
import { captureExamplesForTrackers, proposedEventChecked, trackerForEventKind } from "@/lib/trackers";
import { imageToBase64 } from "@/lib/files";
import { invalidateKeys, LIFE_DATA_KEYS } from "@/lib/queryKeys";
import type { ProposedStatementTx } from "@/lib/prosperidade";
import StatementReview from "@/components/core/StatementReview";
import { findStatementDuplicates } from "@/lib/statementImport";
import { useStatementConfirm } from "@/hooks/useStatementConfirm";

/* Exemplos coerentes com os TRACKERS ativos da pessoa (modularidade total):
   quem desligou o tracker de água não vê "Tomei 2 copos de água" como
   exemplo. A lista vem de captureExamplesForTrackers(). */

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
  /* Comentário de aderência ao plano ativo (refeição/treino), vindo do
     capture. Só existe quando a pessoa TEM plano da área e o relato
     conversa com ele; vive junto da proposta e sai com ela. */
  const [commentary, setCommentary] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  // Print de fatura/comprovante direto na captura (Fatura em toda IA):
  const [image, setImage] = useState<{ name: string; data: string } | null>(null);
  const [statementItems, setStatementItems] = useState<ProposedStatementTx[] | null>(null);
  const [stChecked, setStChecked] = useState<boolean[]>([]);
  const [stDup, setStDup] = useState<boolean[]>([]);
  const [stNote, setStNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm: confirmStatement, saving: savingStatement } = useStatementConfirm();
  const { listening, toggle: toggleMic, stop: stopMic } = useDictation(
    (t) => setText((v) => (v ? v + " " : "") + t)
  );
  const { markSeen } = useGuides();

  const pickImage = () => fileRef.current?.click();
  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Envie uma imagem (print da fatura, comprovante, foto). Para PDF de fatura completa, use \"Importar fatura\" em Prosperidade.");
      return;
    }
    try {
      const data = await imageToBase64(file, 1400);
      setImage({ name: file.name, data });
    } catch {
      toast.error(`Não consegui ler "${file.name}".`);
    }
  };

  const analyze = async () => {
    if (!text.trim() && !image) return;
    stopMic();
    markSeen("hoje-captura"); // usou a função: a dica não é mais necessária
    setLoading(true);
    setLearned(null);
    setCommentary(null);
    setStatementItems(null);
    try {
      const { data, error } = await supabase.functions.invoke("capture", {
        body: {
          text: text.trim() || (image ? "Enviei uma imagem para registrar." : ""),
          ...(image ? { image: image.data, media_type: "image/jpeg" } : {}),
        },
      });
      if (error) {
        const body = await readFnError(error);
        if (isPlanLimit(body)) { setLimitInfo(body); return; }
        throw new Error("Falha na captura");
      }
      if (data?.error) throw new Error(data.error);
      const events: ProposedEvent[] = data?.events ?? [];
      const insights = (data?.learned ?? []) as LearnedMemory[];
      const stItems = (data?.statement_items ?? []) as ProposedStatementTx[];
      if (insights.length) {
        setLearned(insights);
        qc.invalidateQueries({ queryKey: ["ai-memories"] });
      }
      if (stItems.length) {
        // A imagem era financeira: revisão em lote, igual à importação.
        const dups = user ? await findStatementDuplicates(user.id, stItems) : stItems.map(() => false);
        setStatementItems(stItems);
        setStDup(dups);
        setStChecked(stItems.map((_, i) => !dups[i]));
        setStNote((data?.statement_note as string | undefined) ?? null);
        setImage(null);
      }
      if (!events.length) {
        if (!insights.length && !stItems.length) {
          toast.info(image
            ? "Não encontrei nada registrável na imagem. Prints de fatura, comprovantes e telas de Pix funcionam melhor."
            : "Não encontrei nada para registrar nesse texto. Tente descrever o que aconteceu — um gasto, um treino, como você dormiu...");
        } else if (!stItems.length) {
          setText("");
        }
        return;
      }
      setProposed(events);
      setCommentary((data?.commentary as string | undefined)?.trim() || null);
      // Modularidade total: evento de tracker desligado chega DESMARCADO
      // (a pessoa mencionou, então propor respeita a frase dela; gravar
      // por padrão, não).
      setChecked(events.map((ev) => proposedEventChecked(profile, ev.kind)));
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
      const schedHours = sleepWindowHours(profile?.sleep_bedtime, profile?.sleep_waketime);
      await saveProposedEvents(user.id, selected, schedHours ? {
        hours: schedHours,
        bedtime: timeForInput(profile?.sleep_bedtime),
        waketime: timeForInput(profile?.sleep_waketime),
      } : null);
      const gained = selected.reduce((sum, ev) => sum + xpForKind(ev.kind), 0);
      toast.success(
        (selected.length === 1
          ? `${selected[0].summary} · +${gained} XP`
          : `${selected.length} registros feitos de uma vez · +${gained} XP`) + xpToastSuffix()
      );
      setText("");
      setImage(null);
      setProposed(null);
      setCommentary(null);
      invalidateKeys(qc, [...LIFE_DATA_KEYS, "entitlements"]);
      onConfirmed?.(selected.length);
    } catch {
      toast.error("Não consegui salvar. Tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  const confirmStatementItems = async () => {
    if (!statementItems) return;
    const selected = statementItems.filter((_, i) => stChecked[i]);
    if (!selected.length) { setStatementItems(null); return; }
    const ok = await confirmStatement(selected);
    if (ok) {
      setStatementItems(null);
      setText("");
      onConfirmed?.(selected.length);
    }
  };

  return (
    <Card className="p-4 space-y-3 border-gold/30">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="w-4 h-4 text-gold" />
        Conte como foi — eu registro tudo para você
      </div>

      {!proposed && !statementItems && (
        <>
          <FirstTimeTip id="hoje-captura" />
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={(() => {
              if (listening) return "Ouvindo... conte como foi o seu dia";
              if (image) return "Quer acrescentar algo sobre a imagem? (opcional)";
              const examples = captureExamplesForTrackers(profile);
              return `Ex.: "${examples[new Date().getDate() % examples.length]}"`;
            })()}
            rows={2}
            maxLength={2000}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); analyze(); }
            }}
          />
          {image && (
            <div className="flex items-center gap-2 text-xs rounded-full border bg-card px-2.5 py-1 w-fit max-w-full">
              <ImageIcon className="w-3 h-3 shrink-0" />
              <span className="truncate">{image.name}</span>
              <button onClick={() => setImage(null)} aria-label={`Remover ${image.name}`}
                className="text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
          <div className="flex justify-end gap-1.5">
            <Button
              variant="ghost" size="icon" className="text-muted-foreground"
              onClick={pickImage} disabled={loading}
              aria-label="Anexar print ou foto (fatura, comprovante, Pix)"
              title="Print de fatura, comprovante ou foto"
            >
              <Camera className="w-4 h-4" />
            </Button>
            <Button
              variant={listening ? "default" : "ghost"} size="icon"
              className={listening ? "animate-pulse" : "text-muted-foreground"}
              onClick={toggleMic} disabled={loading}
              aria-label={listening ? "Parar de ouvir" : "Falar por voz"}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
            <Button onClick={analyze} disabled={loading || (!text.trim() && !image)}>
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
            const trackerOff = !proposedEventChecked(profile, ev.kind);
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
                <span className="text-sm flex-1 min-w-0 break-words">
                  {ev.summary}
                  {trackerOff && (
                    <span className="block text-[11px] text-muted-foreground">
                      você não acompanha {trackerForEventKind(ev.kind)?.label.toLowerCase() ?? "isso"} — marque se quiser registrar mesmo assim
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">{meta?.name ?? ev.pillar}</span>
              </label>
            );
          })}
          {/* Aderência ao plano ativo: o plano deixa de ser documento parado e
              comenta o dia. Lida ANTES de confirmar, de propósito. */}
          {commentary && (
            <p className="flex items-start gap-2 rounded-lg border border-gold/25 bg-gold/5 px-3 py-2 text-[13px] leading-snug text-muted-foreground">
              <ClipboardCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gold" aria-hidden />
              <span className="min-w-0 break-words">{commentary}</span>
            </p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" onClick={() => { setProposed(null); setCommentary(null); }} disabled={saving}>
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button onClick={confirm} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Check className="w-4 h-4 mr-1" /> Confirmar</>)}
            </Button>
          </div>
        </div>
      )}

      {/* Imagem financeira detectada: revisão em lote (mesma UX da importação) */}
      {statementItems && (
        <div className="animate-fade-up space-y-2">
          <p className="text-sm text-muted-foreground">
            Li a imagem como lançamentos financeiros. Confirme o que quiser registrar:
          </p>
          <StatementReview
            items={statementItems} checked={stChecked} dup={stDup} note={stNote}
            saving={savingStatement}
            onToggle={(i, v) => setStChecked((arr) => arr.map((c, j) => (j === i ? v : c)))}
            onToggleAll={(v) => setStChecked(statementItems.map(() => v))}
            onCancel={() => setStatementItems(null)}
            onConfirm={confirmStatementItems}
          />
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