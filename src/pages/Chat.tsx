import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Send, Loader2, Sparkles, Paperclip, X, Mic, MicOff, FileText, Image as ImageIcon, Check, ClipboardList, Eye, Wand2 } from "lucide-react";
import { Markdown } from "@/components/core/Markdown";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { pillarById } from "@/lib/pillars";
import { saveProposedEvents, type ProposedEvent } from "@/lib/captureEvents";
import LearnedInsights, { type LearnedMemory } from "@/components/core/LearnedInsights";
import FirstTimeTip from "@/components/core/FirstTimeTip";
import { useGuides } from "@/hooks/useGuides";
import { xpForKind } from "@/lib/xp";
import { useDictation } from "@/hooks/useDictation";
import { cn } from "@/lib/utils";
import Paywall from "@/components/core/Paywall";
import { readFnError, isPlanLimit, type PlanLimitError } from "@/lib/fnError";

interface ProfileSuggestion {
  patch: Record<string, unknown>;
  merge: Record<string, string[]>;
  labels: string[];
}

interface Msg { id?: string; role: "user" | "assistant"; content: string; pending?: boolean }

interface ProposedPlan {
  title: string;
  kind: string;
  pillar: string | null;
  content: string;
  daily_calories_kcal?: number | null;
  daily_protein_g?: number | null;
  weekly_workouts?: number | null;
  sleep_hours_target?: number | null;
  daily_spend_limit?: number | null;
}

interface Attachment {
  name: string;
  kind: "image" | "pdf" | "text";
  media_type?: string;
  data?: string;   // base64 (image/pdf)
  text?: string;   // conteúdo (arquivos de texto)
}

const MAX_ATTACHMENTS = 4;
const MAX_PDF_BYTES = 4 * 1024 * 1024;   // 4 MB
const MAX_TEXT_CHARS = 20_000;

const SUGGESTIONS = [
  "Monte um plano alimentar para ganho de massa que caiba no meu orçamento",
  "Como está minha vida esta semana?",
  "O que meus dados dizem que eu deveria melhorar primeiro?",
  "Quanto posso gastar com lazer este mês sem me apertar?",
];

/** Reduz imagem no navegador e devolve base64 jpeg. */
function imageToBase64(file: File, maxDim = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const s = maxDim / Math.max(width, height);
        width = Math.round(width * s); height = Math.round(height * s);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("canvas")); return; }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img")); };
    img.src = url;
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });
}

function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read"));
    r.readAsText(file);
  });
}

export default function Chat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [local, setLocal] = useState<Msg[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [captured, setCaptured] = useState<ProposedEvent[] | null>(null);
  const [learned, setLearned] = useState<LearnedMemory[] | null>(null);
  const [proposedPlan, setProposedPlan] = useState<ProposedPlan | null>(null);
  const [limitInfo, setLimitInfo] = useState<PlanLimitError | null>(null);
  const [profileSuggestion, setProfileSuggestion] = useState<ProfileSuggestion | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planComment, setPlanComment] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  // Ganchos contextuais: /app/conselheiro?q=... pré-preenche a pergunta (a pessoa decide enviar)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      setInput(q.slice(0, 500));
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [capturedChecked, setCapturedChecked] = useState<boolean[]>([]);
  const [savingCaptured, setSavingCaptured] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { listening, toggle: toggleMic, stop: stopMic } = useDictation(
    (t) => setInput((v) => (v ? v + " " : "") + t)
  );
  const { markSeen } = useGuides();

  const { data: history, isLoading } = useQuery({
    queryKey: ["chat", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("chat_messages")
        .select("id,role,content").eq("user_id", user!.id)
        .order("created_at", { ascending: true }).limit(200);
      return (data ?? []) as Msg[];
    },
  });

  const messages = [...(history ?? []), ...local];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, captured, proposedPlan, learned]);

  // ── Anexos ───────────────────────────────────────────────────
  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) {
      if (attachments.length + 1 > MAX_ATTACHMENTS) {
        toast.error(`Máximo de ${MAX_ATTACHMENTS} anexos por mensagem.`);
        break;
      }
      try {
        if (file.type.startsWith("image/")) {
          const data = await imageToBase64(file);
          setAttachments((a) => [...a, { name: file.name, kind: "image", media_type: "image/jpeg", data }]);
        } else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          if (file.size > MAX_PDF_BYTES) { toast.error(`"${file.name}" passa de 4 MB. Envie um PDF menor.`); continue; }
          const data = await fileToBase64(file);
          setAttachments((a) => [...a, { name: file.name, kind: "pdf", media_type: "application/pdf", data }]);
        } else if (
          file.type.startsWith("text/") ||
          /\.(txt|md|csv|json)$/i.test(file.name)
        ) {
          const text = (await fileToText(file)).slice(0, MAX_TEXT_CHARS);
          setAttachments((a) => [...a, { name: file.name, kind: "text", text }]);
        } else {
          toast.error(`Tipo de arquivo não suportado: "${file.name}". Envie fotos, PDF, TXT, MD ou CSV.`);
        }
      } catch {
        toast.error(`Não consegui ler "${file.name}".`);
      }
    }
  };

  const removeAttachment = (i: number) =>
    setAttachments((a) => a.filter((_, j) => j !== i));

  // ── Envio ────────────────────────────────────────────────────
  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if ((!content && !attachments.length) || sending) return;
    stopMic();
    markSeen("conselheiro"); // usou o chat: a dica não é mais necessária
    const sentAttachments = attachments;
    const displayContent = content ||
      `Enviei ${sentAttachments.length === 1 ? "um arquivo" : `${sentAttachments.length} arquivos`} para você analisar.`;
    setInput("");
    setAttachments([]);
    setCaptured(null);
    setLearned(null);
    setSending(true);
    setLocal((l) => [...l, {
      role: "user",
      content: displayContent + (sentAttachments.length ? `\n📎 ${sentAttachments.map((a) => a.name).join(", ")}` : ""),
    }]);
    try {
      const { data, error } = await supabase.functions.invoke("ai-chat", {
        body: {
          message: displayContent,
          attachments: sentAttachments.length ? sentAttachments : undefined,
        },
      });
      if (error) {
        const body = await readFnError(error);
        if (isPlanLimit(body)) {
          // Limite do plano atingido: mostra o paywall contextual e devolve o texto
          setLimitInfo(body);
          setLocal((l) => l.slice(0, -1));
          setInput(content);
          setAttachments(sentAttachments);
          return;
        }
        throw new Error(typeof body?.error === "string" ? (body.error as string) : "erro");
      }
      if (data?.error) throw new Error(data.error);
      setLocal([]);
      const events = (data?.captured ?? []) as ProposedEvent[];
      if (events.length) {
        setCaptured(events);
        setCapturedChecked(events.map(() => true));
      }
      if (data?.plan?.title && data?.plan?.content) {
        setProposedPlan(data.plan as ProposedPlan);
      }
      const insights = (data?.learned ?? []) as LearnedMemory[];
      if (insights.length) {
        setLearned(insights);
        qc.invalidateQueries({ queryKey: ["ai-memories"] });
      }
      // Proposta de perfil: NADA é salvo sem a pessoa confirmar (cartão abaixo)
      const suggestion = data?.profile_suggestion as ProfileSuggestion | null | undefined;
      if (suggestion?.labels?.length) setProfileSuggestion(suggestion);
      qc.invalidateQueries({ queryKey: ["chat", user?.id] });
    } catch (e) {
      setLocal((l) => l.slice(0, -1));
      const msg = e instanceof Error && e.message !== "erro" ? e.message
        : "O Conselheiro não respondeu agora. Tente de novo em instantes.";
      toast.error(msg);
      setInput(content);
      setAttachments(sentAttachments);
    } finally {
      setSending(false);
    }
  };

  // ── Confirmação da proposta de perfil feita pelo Conselheiro ─
  const applyProfileSuggestion = async () => {
    if (!user || !profileSuggestion) return;
    setSavingProfile(true);
    try {
      const patch: Record<string, unknown> = { ...profileSuggestion.patch };
      const mergeKeys = Object.keys(profileSuggestion.merge ?? {});
      if (mergeKeys.length) {
        const { data: prof } = await supabase.from("profiles")
          .select("dietary_restrictions,health_conditions,medications")
          .eq("user_id", user.id).maybeSingle();
        const current = (prof ?? {}) as Record<string, string[] | null>;
        for (const k of mergeKeys) {
          const existing = current[k] ?? [];
          const seen = new Set(existing.map((v) => v.toLowerCase()));
          const merged = [...existing];
          for (const item of profileSuggestion.merge[k]) {
            if (!seen.has(item.toLowerCase())) { merged.push(item); seen.add(item.toLowerCase()); }
          }
          patch[k] = merged;
        }
      }
      const { error } = await supabase.from("profiles").update(patch).eq("user_id", user.id);
      if (error) throw error;
      toast.success(`Guardei no seu perfil: ${profileSuggestion.labels.join(", ")}.`);
      qc.invalidateQueries({ queryKey: ["profile"] });
      setProfileSuggestion(null);
    } catch {
      toast.error("Não consegui salvar no perfil. Tente de novo.");
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Confirmação dos registros detectados na conversa ─────────
  const confirmCaptured = async () => {
    if (!user || !captured) return;
    markSeen("confirmar-registros");
    const selected = captured.filter((_, i) => capturedChecked[i]);
    if (!selected.length) { setCaptured(null); return; }
    setSavingCaptured(true);
    try {
      await saveProposedEvents(user.id, selected);
      const gained = selected.reduce((sum, ev) => sum + xpForKind(ev.kind), 0);
      toast.success(selected.length === 1
        ? `${selected[0].summary} · +${gained} XP`
        : `${selected.length} registros feitos · +${gained} XP`);
      setCaptured(null);
      qc.invalidateQueries();
    } catch {
      toast.error("Não consegui salvar. Tente de novo.");
    } finally {
      setSavingCaptured(false);
    }
  };

  const PLAN_KIND_LABEL: Record<string, string> = {
    alimentar: "Alimentar", treino: "Treino", financeiro: "Financeiro", rotina: "Rotina", outro: "Plano",
  };

  // Pede ajuste no plano: vira mensagem na conversa; a versão revisada substitui a proposta
  const requestPlanAdjust = () => {
    if (!proposedPlan || !planComment.trim()) return;
    const msg = `Sobre o plano "${proposedPlan.title}": ${planComment.trim()}`;
    setPlanOpen(false);
    setPlanComment("");
    send(msg);
  };

  // ── Salvar plano proposto pelo Conselheiro ───────────────────
  const savePlan = async () => {
    if (!user || !proposedPlan) return;
    setSavingPlan(true);
    const { error } = await supabase.from("plans").insert({
      user_id: user.id,
      title: proposedPlan.title,
      kind: proposedPlan.kind,
      pillar: proposedPlan.pillar,
      content: proposedPlan.content,
    });
    setSavingPlan(false);
    if (error) { toast.error("Não consegui salvar o plano."); return; }

    // Metas definidas pelo plano viram metas vivas do app (espelhadas na tela Hoje)
    const patch: Record<string, number> = {};
    const applied: string[] = [];
    if (proposedPlan.daily_calories_kcal) { patch.calorie_goal_kcal = proposedPlan.daily_calories_kcal; applied.push(`${proposedPlan.daily_calories_kcal.toLocaleString("pt-BR")} kcal/dia`); }
    if (proposedPlan.daily_protein_g) { patch.protein_goal_g = proposedPlan.daily_protein_g; applied.push(`${proposedPlan.daily_protein_g} g de proteína/dia`); }
    if (proposedPlan.weekly_workouts) { patch.weekly_workouts_goal = proposedPlan.weekly_workouts; applied.push(`${proposedPlan.weekly_workouts} treinos/semana`); }
    if (proposedPlan.sleep_hours_target) { patch.sleep_goal_h = proposedPlan.sleep_hours_target; applied.push(`${String(proposedPlan.sleep_hours_target).replace(".", ",")}h de sono/noite`); }
    if (proposedPlan.daily_spend_limit) { patch.daily_spend_limit = proposedPlan.daily_spend_limit; applied.push(`teto de ${proposedPlan.daily_spend_limit.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}/dia`); }
    if (Object.keys(patch).length) {
      const { error: gErr } = await supabase.from("profiles").update(patch).eq("user_id", user.id);
      if (!gErr) {
        toast.success(`Metas do plano aplicadas: ${applied.join(", ")}. Acompanhe na tela Hoje.`, { duration: 6000 });
        qc.invalidateQueries({ queryKey: ["profile"] });
      }
    }

    toast.success("Plano salvo! Ele fica em Pilares > Meus planos, e o Conselheiro passa a acompanhá-lo.");
    setProposedPlan(null);
    setPlanOpen(false);
    qc.invalidateQueries({ queryKey: ["plans"] });
  };

  return (
    <div className="fixed inset-x-0 top-14 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-10 md:static md:z-auto md:h-[calc(100dvh-7.5rem)]">
      <div className="h-full w-full max-w-2xl mx-auto flex flex-col min-h-0 px-4 pt-3 md:px-0 md:pt-0">
      <div className="mb-2 shrink-0">
        <h1 className="font-display text-xl md:text-2xl font-semibold">Conselheiro</h1>
        <p className="text-xs md:text-sm text-muted-foreground">
          A única IA que enxerga suas finanças, corpo, alimentação e mente ao mesmo tempo.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-3 pb-3 pr-1">
        <FirstTimeTip id="conselheiro" />
        {isLoading && <Skeleton className="h-16 w-3/4" />}

        {!isLoading && messages.length === 0 && (
          <div className="space-y-2 pt-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-gold" /> Algumas coisas que só eu consigo responder:
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full text-left text-sm rounded-lg border bg-card p-3 hover:bg-muted/60 transition-colors"
              >
                {s}
              </button>
            ))}
            <p className="text-xs text-muted-foreground pt-1">
              Você também pode anexar fotos, PDFs e documentos (📎) ou falar por voz (🎙).
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={m.id ?? `local-${i}`} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] min-w-0 break-words rounded-2xl px-4 py-2.5 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm leading-relaxed whitespace-pre-line"
                  : "bg-card border rounded-bl-sm"
              )}
            >
              {m.role === "user" ? m.content : <Markdown content={m.content} />}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-card border rounded-2xl rounded-bl-sm px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        {/* O que a IA acabou de aprender sobre a pessoa nesta mensagem */}
        {learned && !sending && (
          <LearnedInsights items={learned} onDismiss={() => setLearned(null)} />
        )}

        {/* Plano pronto para salvar fora do chat */}
        {proposedPlan && !sending && (
          <div className="rounded-xl border border-gold/40 bg-card p-3 space-y-2 animate-fade-up">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4 text-gold" />
              Plano pronto: {proposedPlan.title}
            </p>
            <p className="text-xs text-muted-foreground">
              Veja o plano formatado, peça ajustes ("não gosto do exercício tal") ou salve.
              Salvo, ele fica em Pilares &gt; Meus planos e o Conselheiro acompanha sua adesão.
            </p>
            <div className="flex flex-wrap gap-2 justify-end pt-0.5">
              <Button variant="ghost" size="sm" onClick={() => setProposedPlan(null)} disabled={savingPlan}>
                <X className="w-4 h-4 mr-1" /> Agora não
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPlanOpen(true)} disabled={savingPlan}>
                <Eye className="w-4 h-4 mr-1" /> Ver plano
              </Button>
              <Button size="sm" onClick={savePlan} disabled={savingPlan}>
                {savingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Check className="w-4 h-4 mr-1" /> Salvar plano</>)}
              </Button>
            </div>
          </div>
        )}

        {/* Proposta de perfil — o Conselheiro sugere, VOCÊ decide salvar */}
        {profileSuggestion && !sending && (
          <div className="rounded-xl border border-gold/40 bg-card p-3 space-y-2 animate-fade-up">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-gold" />
              Quer salvar isso no seu perfil?
            </p>
            <p className="text-sm text-muted-foreground">
              Entendi na conversa: <strong>{profileSuggestion.labels.join(", ")}</strong>.
              Nada é salvo sem a sua confirmação.
            </p>
            <div className="flex gap-2 justify-end pt-0.5">
              <Button variant="ghost" size="sm" onClick={() => setProfileSuggestion(null)} disabled={savingProfile}>
                <X className="w-4 h-4 mr-1" /> Não salvar
              </Button>
              <Button size="sm" onClick={applyProfileSuggestion} disabled={savingProfile}>
                {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Check className="w-4 h-4 mr-1" /> Salvar no perfil</>)}
              </Button>
            </div>
          </div>
        )}

        {/* Registros detectados na conversa — confirmar antes de gravar */}
        {captured && !sending && (
          <div className="rounded-xl border border-gold/40 bg-card p-3 space-y-2 animate-fade-up">
            <FirstTimeTip id="confirmar-registros" />
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-gold" />
              Percebi coisas para registrar. Confirma?
            </p>
            {captured.map((ev, i) => {
              const meta = pillarById(ev.pillar);
              return (
                <label key={i} className="flex items-center gap-3 rounded-md border p-2.5 cursor-pointer">
                  <Checkbox
                    checked={capturedChecked[i]}
                    onCheckedChange={(v) => setCapturedChecked((c) => c.map((x, j) => (j === i ? !!v : x)))}
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
            <div className="flex gap-2 justify-end pt-0.5">
              <Button variant="ghost" size="sm" onClick={() => setCaptured(null)} disabled={savingCaptured}>
                <X className="w-4 h-4 mr-1" /> Agora não
              </Button>
              <Button size="sm" onClick={confirmCaptured} disabled={savingCaptured}>
                {savingCaptured ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Check className="w-4 h-4 mr-1" /> Registrar</>)}
              </Button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Anexos pendentes */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-2 shrink-0">
          {attachments.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-xs rounded-full border bg-card px-2.5 py-1 max-w-[220px]">
              {a.kind === "image" ? <ImageIcon className="w-3 h-3 shrink-0" /> : <FileText className="w-3 h-3 shrink-0" />}
              <span className="truncate">{a.name}</span>
              <button onClick={() => removeAttachment(i)} aria-label={`Remover ${a.name}`}
                className="text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 items-end pt-2 border-t shrink-0">
        <input
          ref={fileRef} type="file" multiple className="hidden"
          accept="image/*,.pdf,.txt,.md,.csv,.json"
          onChange={onPickFiles}
        />
        <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground"
          onClick={() => fileRef.current?.click()} disabled={sending}
          aria-label="Anexar arquivos">
          <Paperclip className="w-4 h-4" />
        </Button>
        <Button
          variant={listening ? "default" : "ghost"} size="icon"
          className={cn("shrink-0", listening ? "animate-pulse" : "text-muted-foreground")}
          onClick={toggleMic} disabled={sending}
          aria-label={listening ? "Parar de ouvir" : "Falar por voz"}
        >
          {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </Button>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Ouvindo... fale à vontade" : "Pergunte qualquer coisa sobre a sua vida..."}
          rows={1}
          maxLength={4000}
          className="resize-none min-h-[44px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <Button size="icon" onClick={() => send()} disabled={sending || (!input.trim() && !attachments.length)} aria-label="Enviar">
          <Send className="w-4 h-4" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground pt-1.5 pb-2 md:pb-0 shrink-0">
        O Conselheiro não substitui médicos, psicólogos, nutricionistas ou consultores de investimento.
      </p>
      </div>

      {/* Visualização do plano proposto + pedido de ajustes */}
      <Dialog open={planOpen && !!proposedPlan} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-lg max-h-[85dvh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="pr-6 break-words font-display">{proposedPlan?.title}</DialogTitle>
            <DialogDescription>
              {proposedPlan && `${PLAN_KIND_LABEL[proposedPlan.kind] ?? "Plano"} · ainda não salvo`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto text-sm pr-1">
            {proposedPlan && <Markdown content={proposedPlan.content} doc />}
          </div>

          <div className="shrink-0 border-t pt-3 space-y-2">
            <Textarea
              value={planComment}
              onChange={(e) => setPlanComment(e.target.value)}
              placeholder='Quer mudar algo? Ex.: "não gosto de agachamento, troca por outro exercício"'
              rows={2} maxLength={500}
              className="resize-none text-sm"
            />
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={requestPlanAdjust} disabled={!planComment.trim() || sending}>
                <Wand2 className="w-4 h-4 mr-1" /> Pedir ajuste
              </Button>
              <Button size="sm" onClick={savePlan} disabled={savingPlan}>
                {savingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Check className="w-4 h-4 mr-1" /> Salvar plano</>)}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Paywall contextual: aparece só quando um limite do plano é atingido */}
      <Paywall info={limitInfo} onClose={() => setLimitInfo(null)} />
    </div>
  );
}