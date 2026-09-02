import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { CATEGORIES } from "@/lib/prosperidade";
import CaptureBar from "@/components/core/CaptureBar";
import { WhatsappHojeCard } from "@/components/core/WhatsappCard";
import BattleCheckinCard from "@/components/core/BattleCheckin";
import { toast } from "sonner";
import {
  Sunrise, ChevronRight, CircleCheck, Circle, Flame, Droplet, Dumbbell, Moon, Smile,
  BookOpen, Camera, X, UserRound, ListChecks, MessageCircle, Trophy, CalendarHeart,
  HandHeart, ClipboardList,
} from "lucide-react";
import { PLAN_KIND_META } from "@/lib/blueprint";
import { invalidateKeys, FINANCE_KEYS, LIFE_DATA_KEYS } from "@/lib/queryKeys";
import { levelFromXp, levelTitle, xpToastSuffix } from "@/lib/xp";
import { DEFAULT_WATER_GOAL_ML, DEFAULT_WATER_BOTTLES } from "@/hooks/useProfile";
import { useEffect, useRef, useState } from "react";
import { greet, todayISO } from "@/lib/format";
import { dateISOInSP, daysAgoISOInSP } from "@/lib/dates";
import { pillarById, activePillarSet } from "@/lib/pillars";
import { activeTrackerSet } from "@/lib/trackers";
import SleepCheckin from "@/components/core/SleepCheckin";
import { cn } from "@/lib/utils";

/** Sequência de dias ativos. Regra gentil: 1 dia de descanso por semana não quebra. */
function useActiveStreak() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["active-streak", user?.id, todayISO()],
    enabled: !!user,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 864e5).toISOString();
      const { data } = await supabase.from("life_events")
        .select("occurred_at").eq("user_id", user!.id)
        .gte("occurred_at", since).limit(2000);
      // Dia calculado no fuso de São Paulo (plano §5.4)
      return new Set((data ?? []).map((e) => dateISOInSP(String(e.occurred_at))));
    },
  });
  if (!data) return 0;

  const dayIso = (offset: number) => daysAgoISOInSP(offset);
  // Hoje ainda em andamento: não quebra se vazio; começa de hoje se ativo, senão de ontem
  let streak = 0;
  let offset = data.has(dayIso(0)) ? 0 : 1;
  let restUsedInWindow = 0;
  let windowCount = 0;
  while (offset <= 90) {
    if (windowCount === 7) { windowCount = 0; restUsedInWindow = 0; }
    if (data.has(dayIso(offset))) {
      streak++;
    } else if (restUsedInWindow === 0 && streak > 0) {
      restUsedInWindow++; // descanso da semana: mantém a sequência
    } else break;
    windowCount++;
    offset++;
  }
  return streak;
}

/* ── Ritual de retorno (plano de feedbacks, Sugestão 3) ──────────────────
   "O momento do churn é o momento do produto": voltar depois de dias de
   silêncio deveria ser o momento mais bem desenhado do app, não o mais
   constrangedor. Quando detectamos silêncio (>= 7 dias sem registro, com
   histórico anterior), a tela Hoje troca o painel — sem dashboard vazio na
   cara, sem streak em destaque — por uma única pergunta: "conta numa frase
   o que aconteceu". A CaptureBar absorve. E, como serviço (não culpa),
   mostramos que NADA expirou: compromissos e planos continuam valendo. */
const RETURN_GAP_DAYS = 7;

function useReturnGap() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["return-gap", user?.id, todayISO()],
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data: last } = await supabase.from("life_events")
        .select("occurred_at").eq("user_id", user!.id)
        .order("occurred_at", { ascending: false }).limit(1);
      const lastAt = last?.[0]?.occurred_at ? new Date(String(last[0].occurred_at)).getTime() : null;
      return { lastAt };
    },
  });
  if (!data?.lastAt) return { returning: false, gapDays: 0 };
  const gapDays = Math.floor((Date.now() - data.lastAt) / 864e5);
  return { returning: gapDays >= RETURN_GAP_DAYS, gapDays };
}

function ReturnRitual({ gapDays, onShowPanel }: { gapDays: number; onShowPanel: () => void }) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const firstName = (profile?.name ?? "").split(" ")[0];

  // Serviço, não culpa: o que continua valendo, esperando a pessoa.
  const { data: standing } = useQuery({
    queryKey: ["return-standing", user?.id],
    enabled: !!user,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const [{ count: habits }, { count: plans }] = await Promise.all([
        supabase.from("habits").select("id", { count: "exact", head: true })
          .eq("user_id", user!.id).eq("active", true),
        supabase.from("plans").select("id", { count: "exact", head: true })
          .eq("user_id", user!.id).eq("status", "ativo"),
      ]);
      return { habits: habits ?? 0, plans: plans ?? 0 };
    },
  });

  const standingParts: string[] = [];
  if ((standing?.plans ?? 0) > 0) {
    standingParts.push(standing!.plans === 1 ? "seu plano continua valendo" : `seus ${standing!.plans} planos continuam valendo`);
  }
  if ((standing?.habits ?? 0) > 0) {
    standingParts.push(standing!.habits === 1 ? "seu compromisso diário está no lugar" : `seus ${standing!.habits} compromissos diários estão no lugar`);
  }

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3 border-gold/40">
        <div className="flex items-center gap-2 text-sm font-medium">
          <HandHeart className="w-4 h-4 text-gold" />
          Que bom te ver de volta{firstName ? `, ${firstName}` : ""}.
        </div>
        <p className="text-sm text-muted-foreground">
          Você ficou {gapDays} dias sem registrar — e está tudo bem. A vida acontece.
          Conta numa frase o que aconteceu nesse tempo (ou só como está hoje):
          o primeiro registro de volta vale por dez.
        </p>
        <CaptureBar />
        <p className="text-[11px] text-muted-foreground">
          {standingParts.length
            ? `Nada aqui expirou: ${standingParts.join(" e ")}. `
            : "Nada aqui expirou. "}
          Seu XP e seus dias limpos nunca diminuem — semana ruim não apaga a subida.
        </p>
      </Card>

      <Link
        to={`/app/conselheiro?q=${encodeURIComponent("Fiquei um tempo sem registrar. Me ajuda a recomeçar pequeno, a partir de onde eu parei?")}`}
        className="flex items-center justify-between rounded-lg border bg-card p-4 hover:bg-muted/50 transition-colors"
      >
        <div>
          <p className="text-sm font-semibold">Recomeçar com o Conselheiro</p>
          <p className="text-xs text-muted-foreground">
            Ele conhece seu histórico e sabe propor um recomeço pequeno, sem cobrança.
          </p>
        </div>
        <MessageCircle className="w-5 h-5 text-muted-foreground" />
      </Link>

      <button onClick={onShowPanel} className="w-full text-xs text-muted-foreground underline">
        Prefiro ver meu painel normal
      </button>
    </div>
  );
}

/* ── Gasto rápido inline (plano de feedbacks): registrar um gasto do dia a
   dia não deveria custar uma navegação. O botão abre um diálogo de 2 toques
   (valor + categoria) e grava direto em `transactions` — o gráfico e o
   Conselheiro enxergam na hora. O pilar completo continua a um link. ── */
const QUICK_EXPENSE_CATEGORIES = CATEGORIES.filter((c) => c !== "Salário" && c !== "Extra");

function QuickExpense({ disabled }: { disabled?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("Mercado");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const value = Number(String(amount).replace(",", "."));
    if (!user || !value || value <= 0) { toast.error("Informe um valor válido."); return; }
    setSaving(true);
    const { error } = await supabase.from("transactions").insert({
      user_id: user.id, kind: "expense", amount: value,
      category, occurred_at: todayISO(), source: "manual",
    });
    setSaving(false);
    if (error) { toast.error("Não consegui registrar o gasto."); return; }
    toast.success(`Gasto de R$ ${value.toFixed(2).replace(".", ",")} · ${category} registrado. +2 XP${xpToastSuffix()}`);
    setAmount(""); setOpen(false);
    invalidateKeys(qc, FINANCE_KEYS);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-60"
      >
        <span className="text-[13px] font-semibold" style={{ color: "hsl(var(--prosperidade))" }} aria-hidden>R$</span> Gasto
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar gasto</DialogTitle>
            <DialogDescription>Valor e categoria — dois toques e pronto.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              inputMode="decimal"
              autoFocus
              placeholder="Valor (R$)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                {QUICK_EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button className="w-full" onClick={save} disabled={saving}>
              {saving ? "Registrando…" : "Registrar gasto"}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Descrição, data e entradas ficam no{" "}
              <Link to="/app/prosperidade" className="underline underline-offset-2" onClick={() => setOpen(false)}>
                pilar Prosperidade
              </Link>.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Ações rápidas (3.1): água, humor e foto em 1 toque ── */
const QUICK_MOODS = [
  { score: 1, emoji: "😞", label: "péssimo" },
  { score: 2, emoji: "🙁", label: "ruim" },
  { score: 3, emoji: "😐", label: "ok" },
  { score: 4, emoji: "🙂", label: "bem" },
  { score: 5, emoji: "😄", label: "ótimo" },
];

function QuickActions() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const bottles = profile?.water_bottles?.length ? profile.water_bottles : DEFAULT_WATER_BOTTLES;
  // Modularidade TOTAL: cada ação rápida pertence a um TRACKER (não mais só
  // ao pilar). Quem desligou "água" não vê os botões de água — desligar
  // esconde, nunca apaga (o histórico continua da pessoa).
  const trackers = activeTrackerSet(profile);
  const showWater = trackers.has("water");
  const showMood = trackers.has("mood");
  const showMeal = trackers.has("meals");
  const showExpense = activePillarSet(profile?.pillars).has("prosperidade");
  const showWorkout = trackers.has("workouts");

  const insert = async (key: string, row: Record<string, unknown>, okMsg: string) => {
    if (!user || savingKey) return;
    setSavingKey(key);
    const { error } = await supabase.from("life_events").insert({ user_id: user.id, source: "form", ...row });
    setSavingKey(null);
    if (error) { toast.error("Não consegui registrar."); return; }
    toast.success(okMsg + xpToastSuffix());
    invalidateKeys(qc, LIFE_DATA_KEYS);
  };

  const addWater = (ml: number, label: string) =>
    insert(`w${ml}`, { pillar: "alimentacao", kind: "water", payload: { ml, summary: `Água: ${ml} ml` } },
      `${label} registrada (+${ml} ml). +2 XP`);

  const logMood = (score: number, emoji: string, label: string) =>
    insert(`m${score}`, { pillar: "mente", kind: "mood", payload: { score, label, summary: `Humor: ${label}` } },
      `Humor ${emoji} registrado. +5 XP`);

  if (!showWater && !showMood && !showMeal && !showExpense && !showWorkout) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground px-0.5">Registro em 1 toque</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
        {showWater && bottles.slice(0, 3).map((b) => (
          <button
            key={`${b.ml}-${b.label}`}
            onClick={() => addWater(b.ml, b.label)}
            disabled={!!savingKey}
            className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-60"
          >
            <Droplet className="w-3.5 h-3.5" style={{ color: "hsl(205 70% 55%)" }} />
            {b.label} <span className="text-muted-foreground">{b.ml}ml</span>
          </button>
        ))}
        {showWater && (showMood || showMeal || showExpense || showWorkout) && (
          <span className="shrink-0 w-px bg-border my-1.5" aria-hidden />
        )}
        {showMood && QUICK_MOODS.map((m) => (
          <button
            key={m.score}
            onClick={() => logMood(m.score, m.emoji, m.label)}
            disabled={!!savingKey}
            className="shrink-0 h-11 w-11 rounded-full border bg-card text-lg grid place-items-center hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-60"
            aria-label={`Registrar humor ${m.label}`}
            title={`Humor: ${m.label}`}
          >
            {m.emoji}
          </button>
        ))}
        {showMood && (showMeal || showExpense || showWorkout) && (
          <span className="shrink-0 w-px bg-border my-1.5" aria-hidden />
        )}
        {showMeal && (
          <Link
            to="/app/alimentacao"
            className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all"
          >
            <Camera className="w-3.5 h-3.5" style={{ color: "hsl(var(--alimentacao))" }} /> Refeição
          </Link>
        )}
        {showExpense && <QuickExpense disabled={!!savingKey} />}
        {showWorkout && (
          <Link
            to="/app/vitalidade"
            className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all"
          >
            <Dumbbell className="w-3.5 h-3.5" style={{ color: "hsl(var(--vitalidade))" }} /> Treino
          </Link>
        )}
      </div>
    </div>
  );
}

/* ── Complete seu retrato (1.2): completude do perfil com atalhos ── */
function ProfileCompleteness() {
  const { profile } = useProfile();
  if (!profile) return null;

  const items = [
    { label: "Ano de nascimento", done: !!profile.birth_year },
    { label: "Sexo", done: !!profile.sex },
    { label: "Altura", done: !!profile.height_cm },
    { label: "Nível de atividade", done: !!profile.activity_level },
  ];
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  const pct = Math.round((done / items.length) * 100);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full grid place-items-center shrink-0 bg-gold/10">
          <UserRound className="w-5 h-5 text-gold-ink" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm font-semibold">Complete seu retrato — {pct}%</p>
            <p className="text-xs text-muted-foreground">
              Com esses dados, o Conselheiro monta planos de verdade em vez de pedir informações.
            </p>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-gold transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {items.filter((i) => !i.done).map((i) => (
              <Link key={i.label} to="/app/ajustes"
                className="text-[11px] rounded-full border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
                + {i.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Seus planos ativos (análise UX item 2): o Blueprint é o clímax de um
   onboarding de 9 blocos — e sumia atrás de dois toques (Pilares > Meus
   planos). Aqui ele volta para a tela onde a pessoa vive, como atalho, sem
   duplicar a gestão: ver, abrir e acompanhar continua em Meus planos. ── */
function ActivePlans() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["active-plans-hoje", user?.id],
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data } = await supabase.from("plans")
        .select("id,title,kind")
        .eq("user_id", user!.id).eq("status", "ativo")
        .order("created_at", { ascending: false }).limit(3);
      return (data ?? []) as { id: string; title: string; kind: string }[];
    },
  });

  if (!data?.length) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <h2 className="font-display font-semibold flex items-center gap-1.5">
          <ClipboardList className="w-4 h-4 text-gold-ink" /> Seus planos ativos
        </h2>
        <Link to="/app/planos" className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0">
          Ver todos
        </Link>
      </div>
      <div className="space-y-1.5">
        {data.map((pl) => {
          const meta = PLAN_KIND_META[pl.kind];
          return (
            <Link
              key={pl.id} to="/app/planos"
              className="flex items-center gap-2.5 rounded-md border p-2.5 hover:bg-muted/50 transition-colors"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: meta ? `hsl(var(${meta.colorVar}))` : "hsl(var(--gold))" }}
                aria-hidden
              />
              <span className="text-sm flex-1 min-w-0 truncate">{pl.title}</span>
              <span className="text-[11px] text-muted-foreground shrink-0">{meta?.label ?? "Plano"}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

/* ── Primeiros passos (2.1 + análise UX P1.1): trilha da primeira semana.
   Ordem pensada para que, ao chegar na pergunta-assinatura do Conselheiro,
   o Raio-X já exista — e a resposta venha de primeira, sem anticlímax.
   Ao completar: clímax com XP de marco em vez de sumir em silêncio. ── */
const SIGNATURE_QUESTION = "Monte um plano alimentar para o meu objetivo que caiba no meu orçamento";

function FirstSteps() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("ascend-firststeps-done") === "1");
  const awarded = useRef(false);

  // Absorvida pelo Blueprint (Emenda 4): quem gerou o Blueprint da Subida no
  // onboarding já viveu o essencial da trilha (metas, plano e compromissos no
  // dia 1) — a lista some para não cobrar o que já aconteceu.
  const absorbed = !!profile?.blueprint_generated_at;

  const { data } = useQuery({
    queryKey: ["first-steps", user?.id],
    enabled: !!user && !dismissed && !absorbed,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const [{ count: events }, { count: mealCount }, { count: plansCount }, { count: estCount }, { count: recCount }] = await Promise.all([
        supabase.from("life_events").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
        supabase.from("life_events").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("kind", "meal"),
        supabase.from("plans").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
        supabase.from("category_estimates").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
        supabase.from("recurring_transactions").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
      ]);
      return {
        events: events ?? 0, meals: mealCount ?? 0, plans: plansCount ?? 0,
        raiox: (estCount ?? 0) + (recCount ?? 0),
      };
    },
  });

  const raioxDone = (data?.raiox ?? 0) > 0 || Number(profile?.monthly_income ?? 0) > 0;

  const steps = data ? [
    { label: "Conte seu dia na captura abaixo", xp: "+XP por registro", done: data.events >= 1, to: null },
    { label: "Mapeie seu mês em 60 segundos (Raio-X)", xp: "destrava o plano no seu bolso", done: raioxDone, to: "/app/prosperidade" },
    { label: "Registre uma refeição (vale foto do prato)", xp: "+4 XP", done: data.meals > 0, to: "/app/alimentacao" },
    { label: "Peça o plano que cabe no seu bolso", xp: "vira meta viva", done: data.plans > 0, to: `/app/conselheiro?q=${encodeURIComponent(SIGNATURE_QUESTION)}` },
  ] : [];
  const allDone = steps.length > 0 && steps.every((st) => st.done);

  // Clímax: XP de marco, uma vez por conta (o servidor garante a unicidade).
  useEffect(() => {
    if (!allDone || awarded.current || dismissed) return;
    awarded.current = true;
    supabase.rpc("award_first_steps_milestone").then(({ data: ok }) => {
      if (ok) {
        toast.success("Base montada · +20 XP. Agora é um degrau por dia. ✨");
        qc.invalidateQueries({ queryKey: ["xp"] });
      }
    });
  }, [allDone, dismissed, qc]);

  if (dismissed || absorbed || !data) return null;

  const dismiss = () => { localStorage.setItem("ascend-firststeps-done", "1"); setDismissed(true); };

  // Estado de conclusão: despedida com a próxima promessa (retrospectiva)
  if (allDone) {
    return (
      <Card className="p-4 border-success/40 bg-success/5">
        <div className="flex items-start gap-3">
          <Trophy className="w-5 h-5 text-gold-ink shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Base montada — primeiros passos concluídos (+20 XP)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Você já viveu o essencial: contar, mapear e planejar. Domingo chega a sua
              primeira retrospectiva da semana — quanto mais dias registrados, melhor ela fica.
            </p>
          </div>
          <button onClick={dismiss} className="shrink-0 -m-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Concluir primeiros passos">
            <X className="w-4 h-4" />
          </button>
        </div>
      </Card>
    );
  }

  if (data.events >= 25) { dismiss(); return null; }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <ListChecks className="w-4 h-4 text-gold-ink" /> Primeiros passos
        </p>
        <button
          onClick={dismiss}
          className="shrink-0 -m-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Dispensar primeiros passos"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-1.5">
        {steps.map((st) => {
          const inner = (
            <>
              {st.done
                ? <CircleCheck className="w-5 h-5 text-success shrink-0" />
                : <Circle className="w-5 h-5 text-muted-foreground shrink-0" />}
              <span className={cn("text-sm flex-1", st.done && "line-through text-muted-foreground")}>{st.label}</span>
              <span className="text-[11px] text-gold-ink shrink-0">{st.xp}</span>
            </>
          );
          return st.to && !st.done ? (
            <Link key={st.label} to={st.to} className="flex items-center gap-2.5 rounded-md border p-2.5 hover:bg-muted/50 transition-colors">
              {inner}
            </Link>
          ) : (
            <div key={st.label} className="flex items-center gap-2.5 rounded-md border p-2.5">{inner}</div>
          );
        })}
      </div>
    </Card>
  );
}

/* ── Sua primeira retrospectiva (análise UX P1.3): dias 2–6 de conta.
   Transforma a espera por domingo em preparação — sem culpa: mostra o que
   JÁ foi registrado e uma única sugestão, dispensável a qualquer momento. ── */
function RetroCountdown() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("ascend-retro-preview-done") === "1");

  const createdAt = user?.created_at ? new Date(user.created_at).getTime() : 0;
  const ageDays = createdAt ? Math.floor((Date.now() - createdAt) / 864e5) : 0;
  const isSunday = new Date().getDay() === 0;
  const eligible = !dismissed && !isSunday && ageDays >= 1 && ageDays <= 6;

  const { data } = useQuery({
    queryKey: ["retro-preview", user?.id, todayISO()],
    enabled: !!user && eligible,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const monday = new Date();
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      const { count } = await supabase.from("life_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id).gte("occurred_at", monday.toISOString());
      return { weekEvents: count ?? 0 };
    },
  });

  if (!eligible || !data) return null;
  const daysToSunday = (7 - new Date().getDay()) % 7 || 7;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full grid place-items-center shrink-0 bg-gold/10">
          <CalendarHeart className="w-5 h-5 text-gold-ink" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            Sua primeira retrospectiva chega {daysToSunday === 1 ? "amanhã" : `em ${daysToSunday} dias`} (domingo)
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data.weekEvents > 0
              ? `A IA vai cruzar os ${data.weekEvents} registro${data.weekEvents > 1 ? "s" : ""} da sua semana e contar a história dela. Cada dia registrado deixa a leitura mais nítida.`
              : "Ela nasce do que você registrar até lá — uma frase por dia já rende uma boa história."}
          </p>
        </div>
        <button
          onClick={() => { localStorage.setItem("ascend-retro-preview-done", "1"); setDismissed(true); }}
          className="shrink-0 -m-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Dispensar aviso da retrospectiva"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </Card>
  );
}

/** Painel do dia: consumido vs. meta (calorias, água, proteína) + pilares tocados. */
function DayProgress() {
  const { user } = useAuth();
  const { profile } = useProfile();

  const { data, isLoading } = useQuery({
    queryKey: ["day-progress", user?.id, todayISO()],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // segunda-feira
      weekStart.setHours(0, 0, 0, 0);
      const [{ data: events }, { data: weekWorkouts }, { data: txs }] = await Promise.all([
        supabase.from("life_events").select("kind,payload")
          .eq("user_id", user!.id).gte("occurred_at", dayStart.toISOString()).limit(300),
        supabase.from("life_events").select("id")
          .eq("user_id", user!.id).eq("kind", "workout")
          .gte("occurred_at", weekStart.toISOString()).limit(50),
        supabase.from("transactions").select("kind,amount")
          .eq("user_id", user!.id).gte("occurred_at", todayISO()).limit(200),
      ]);
      return {
        events: (events ?? []) as { kind: string; payload: Record<string, unknown> }[],
        workoutsWeek: (weekWorkouts ?? []).length,
        spentToday: (txs ?? []).filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0),
      };
    },
  });

  const events = data?.events ?? [];
  // Modularidade TOTAL: o painel só mostra as seções dos TRACKERS que a
  // pessoa acompanha (pilar pausado pausa os trackers dele por herança).
  const trackers = activeTrackerSet(profile);
  const num = (v: unknown) => Number(v) || 0;
  const kcal = Math.round(events.filter((e) => e.kind === "meal").reduce((s, e) => s + num(e.payload?.calories), 0));
  const prot = Math.round(events.filter((e) => e.kind === "meal").reduce((s, e) => s + num(e.payload?.protein_g), 0));
  const water = events.filter((e) => e.kind === "water").reduce((s, e) => s + num(e.payload?.ml), 0);

  const kcalGoal = Number(profile?.calorie_goal_kcal) || 0;
  const protGoal = Number(profile?.protein_goal_g) || 0;
  const waterGoal = Number(profile?.water_goal_ml) || DEFAULT_WATER_GOAL_ML;
  const spendLimit = Number(profile?.daily_spend_limit) || 0;
  const workoutsGoal = Number(profile?.weekly_workouts_goal) || 0;
  const sleepGoal = Number(profile?.sleep_goal_h) || 0;
  const spentToday = data?.spentToday ?? 0;
  const workoutsWeek = data?.workoutsWeek ?? 0;
  const sleptToday = (() => {
    const e = events.find((ev) => ev.kind === "sleep");
    return e ? Number(e.payload?.hours) || 0 : null;
  })();
  const brlFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  // Celebração sutil (1x por dia) quando a primeira meta do dia é batida
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const celebrated = useRef(false);
  useEffect(() => {
    if (celebrated.current || isLoading) return;
    const key = `ascend-celebrated-${todayISO()}`;
    if (localStorage.getItem(key)) { celebrated.current = true; return; }
    const hits: [string, boolean][] = [
      ["kcal", trackers.has("meals") && kcalGoal > 0 && kcal >= kcalGoal],
      ["water", trackers.has("water") && water >= waterGoal],
      ["prot", trackers.has("protein") && protGoal > 0 && prot >= protGoal],
      ["workouts", trackers.has("workouts") && workoutsGoal > 0 && workoutsWeek >= workoutsGoal],
    ];
    const hit = hits.find(([, ok]) => ok);
    if (hit) {
      celebrated.current = true;
      localStorage.setItem(key, "1");
      setCelebrate(hit[0]);
      toast.success("Primeira meta do dia batida. Assim que se sobe. ✨");
      setTimeout(() => setCelebrate(null), 2600);
    }
    // `trackers` é um Set recriado a cada render (o efeito é protegido por
    // ref + localStorage); incluí-lo dispararia o efeito todo render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, kcal, kcalGoal, water, waterGoal, prot, protGoal, workoutsWeek, workoutsGoal]);

  const has = (k: string) => events.some((e) => e.kind === k);
  // Grid de pilares tocados: só o que está ativo (antes mostrava tudo
  // para todo mundo — era exatamente a "modularidade cosmética" do plano).
  const pillarsTouched = [
    { label: "Treino", done: has("workout"), icon: Dumbbell, to: "/app/vitalidade", colorVar: "--vitalidade", show: trackers.has("workouts") },
    { label: "Sono", done: has("sleep") || has("nap"), icon: Moon, to: "/app/vitalidade", colorVar: "--vitalidade", show: trackers.has("sleep") || trackers.has("naps") },
    { label: "Humor", done: has("mood"), icon: Smile, to: "/app/mente", colorVar: "--mente", show: trackers.has("mood") },
    { label: "Mente", done: has("practice") || has("journal") || has("gratitude"), icon: BookOpen, to: "/app/mente", colorVar: "--mente", show: trackers.has("practice") || trackers.has("journal") || trackers.has("gratitude") },
  ].filter((pt) => pt.show);

  const Bar = ({ value, goal, color, celebrating }: { value: number; goal: number; color: string; celebrating?: boolean }) => (
    <div className={cn("h-2 rounded-full bg-muted overflow-hidden", celebrating && "goal-celebrate")}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, (value / goal) * 100)}%`, background: color }}
      />
    </div>
  );

  const fmt = (n: number) => n.toLocaleString("pt-BR");

  if (isLoading) {
    return (
      <Card className="p-4 space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold">Seu dia em números</h2>
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-20" /></div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
        <div className="grid grid-cols-4 gap-1.5 pt-0.5">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      </Card>
    );
  }

  const hasAnyGoal =
    (trackers.has("meals") && kcalGoal > 0) ||
    (trackers.has("protein") && protGoal > 0) ||
    (trackers.has("spend_limit") && spendLimit > 0) ||
    (trackers.has("workouts") && workoutsGoal > 0) ||
    (trackers.has("sleep") && sleepGoal > 0);

  return (
    <Card className="p-4 space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold">Seu dia em números</h2>
        <span className="text-[11px] text-muted-foreground">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" })}
        </span>
      </div>

      {/* Sem nenhuma meta: convite único em vez de silêncio (análise UX P2.1).
          O Conselheiro já sabe propor as metas e gravar com confirmação. */}
      {!hasAnyGoal && (
        <p className="text-xs text-muted-foreground rounded-md border p-2.5">
          Metas deixam este painel vivo — e você define todas em uma frase:{" "}
          <Link
            className="underline text-foreground"
            to={`/app/conselheiro?q=${encodeURIComponent("Me ajude a definir minhas metas diárias (calorias, proteína, água, treinos na semana, sono e teto de gasto) a partir do meu objetivo")}`}
          >
            definir com o Conselheiro
          </Link>.
        </p>
      )}

      {/* Calorias (tracker Refeições) */}
      {trackers.has("meals") && (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <Flame className="w-4 h-4" style={{ color: "hsl(var(--alimentacao))" }} /> Calorias
          </span>
          {kcalGoal > 0 ? (
            <span className="text-muted-foreground">
              <strong className="text-foreground">{fmt(kcal)}</strong> / {fmt(kcalGoal)} kcal
            </span>
          ) : (
            <span className="text-muted-foreground">{fmt(kcal)} kcal</span>
          )}
        </div>
        {kcalGoal > 0 ? (
          <>
            <Bar value={kcal} goal={kcalGoal} color="hsl(var(--alimentacao))" celebrating={celebrate === "kcal"} />
            <p className="text-[11px] text-muted-foreground">
              {kcal < kcalGoal
                ? `Faltam ${fmt(kcalGoal - kcal)} kcal para a meta do dia.`
                : kcal - kcalGoal <= Math.max(100, kcalGoal * 0.05)
                  ? "Meta do dia alcançada. 🎉"
                  : `Meta alcançada (${fmt(kcal - kcalGoal)} kcal acima).`}
            </p>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Sem meta diária definida.{" "}
            <Link to="/app/alimentacao" className="underline text-foreground">Definir meta</Link>
            {" "}ou peça um plano alimentar ao Conselheiro — a meta do plano é aplicada aqui.
          </p>
        )}
      </div>
      )}

      {/* Proteína (só com meta, tracker Proteína) */}
      {trackers.has("protein") && protGoal > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Proteína</span>
            <span className="text-muted-foreground">
              <strong className="text-foreground">{fmt(prot)}</strong> / {fmt(protGoal)} g
            </span>
          </div>
          <Bar value={prot} goal={protGoal} color="hsl(var(--vitalidade))" celebrating={celebrate === "prot"} />
        </div>
      )}

      {/* Água (tracker Água) */}
      {trackers.has("water") && (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <Droplet className="w-4 h-4" style={{ color: "hsl(205 70% 55%)" }} /> Água
          </span>
          <span className="text-muted-foreground">
            <strong className="text-foreground">{(water / 1000).toFixed(1).replace(".", ",")}</strong> / {(waterGoal / 1000).toFixed(1).replace(".", ",")} L
          </span>
        </div>
        <Bar value={water} goal={waterGoal} color="hsl(205 70% 55%)" celebrating={celebrate === "water"} />
      </div>
      )}

      {/* Gasto do dia (tracker Teto de gasto) */}
      {trackers.has("spend_limit") && spendLimit > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-4 h-4 grid place-items-center text-[13px]" style={{ color: "hsl(var(--prosperidade))" }} aria-hidden>R$</span>
              Gasto de hoje
            </span>
            <span className="text-muted-foreground">
              <strong className="text-foreground">{brlFmt(spentToday)}</strong> / {brlFmt(spendLimit)}
            </span>
          </div>
          <Bar value={spentToday} goal={spendLimit} color="hsl(var(--prosperidade))" />
          <p className="text-[11px] text-muted-foreground">
            {spentToday <= spendLimit
              ? `${brlFmt(spendLimit - spentToday)} disponíveis dentro do teto do dia.`
              : (<>
                  {brlFmt(spentToday - spendLimit)} acima do teto de hoje.{" "}
                  <Link className="underline text-foreground" to={`/app/conselheiro?q=${encodeURIComponent("Estourei meu teto de gasto de hoje. Como reequilibro a semana?")}`}>
                    Reequilibrar com o Conselheiro
                  </Link>
                </>)}
          </p>
        </div>
      )}

      {/* Treinos na semana (tracker Treinos) */}
      {trackers.has("workouts") && workoutsGoal > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <Dumbbell className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} /> Treinos na semana
            </span>
            <span className="text-muted-foreground">
              <strong className="text-foreground">{workoutsWeek}</strong> / {workoutsGoal}
            </span>
          </div>
          <Bar value={workoutsWeek} goal={workoutsGoal} color="hsl(var(--vitalidade))" celebrating={celebrate === "workouts"} />
          <p className="text-[11px] text-muted-foreground">
            {workoutsWeek >= workoutsGoal
              ? "Meta da semana batida. 💪"
              : `Faltam ${workoutsGoal - workoutsWeek} treino(s) até domingo.`}
          </p>
        </div>
      )}

      {/* Sono (tracker Sono) */}
      {trackers.has("sleep") && sleepGoal > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <Moon className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} /> Sono da última noite
            </span>
            <span className="text-muted-foreground">
              {sleptToday !== null
                ? (<><strong className="text-foreground">{String(sleptToday).replace(".", ",")}h</strong> / {String(sleepGoal).replace(".", ",")}h</>)
                : "não registrado"}
            </span>
          </div>
          {sleptToday !== null && <Bar value={sleptToday} goal={sleepGoal} color="hsl(var(--vitalidade))" />}
        </div>
      )}

      {/* Pilares tocados hoje (só os ativos) */}
      {pillarsTouched.length > 0 && (
      <div className="grid gap-1.5 pt-0.5" style={{ gridTemplateColumns: `repeat(${pillarsTouched.length}, minmax(0, 1fr))` }}>
        {pillarsTouched.map((pt) => (
          <Link
            key={pt.label} to={pt.to}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] transition-colors",
              pt.done ? "border-transparent" : "text-muted-foreground hover:bg-muted/60"
            )}
            style={pt.done ? { background: `hsl(var(${pt.colorVar}) / 0.12)`, color: `hsl(var(${pt.colorVar}))` } : undefined}
          >
            <pt.icon className="w-4 h-4" />
            {pt.label} {pt.done && "✓"}
          </Link>
        ))}
      </div>
      )}
    </Card>
  );
}

/** Sugestão local do dia (custo zero, determinística por dia da semana):
 *  quando o briefing com IA não está disponível, o card muda de assunto em
 *  vez de mostrar cadeado (análise UX P0.1). */
const DAILY_FOCUS = [
  "Domingo é dia da sua retrospectiva — ela nasce do que você registrou na semana.",
  "Uma frase na captura abaixo registra o dia inteiro: gasto, treino, sono, humor.",
  "Foto do prato → calorias na hora. O registro mais rápido do app.",
  "Água e humor em 1 toque, logo abaixo. Dez segundos e o dia está vivo.",
  "Conte um gasto de hoje — o retrato do seu mês fica mais nítido a cada real.",
  "Marque um compromisso de hoje como feito: é isso que constrói a sequência.",
  "Semana fechando: cada registro de hoje aparece na retrospectiva de domingo.",
];

function Briefing() {
  const { profile } = useProfile();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["briefing", todayISO()],
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("briefing", { body: {} });
      if (error || data?.error) throw new Error(data?.error ?? "erro");
      return data as { briefing: string | null; locked?: boolean; reason?: string; courtesy?: boolean };
    },
  });

  const locked = !!data?.locked;

  return (
    <Card className="p-5 bg-primary text-primary-foreground">
      <div className="flex items-center gap-2 text-sm font-medium mb-2 opacity-90">
        <Sunrise className="w-4 h-4" />
        {locked ? "Foco de hoje" : new Date().getDay() === 0 ? "Retrospectiva da semana" : "Seu briefing de hoje"}
      </div>
      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full bg-primary-foreground/20" />
          <Skeleton className="h-4 w-4/5 bg-primary-foreground/20" />
          <Skeleton className="h-4 w-3/5 bg-primary-foreground/20" />
        </div>
      )}
      {isError && (
        <p className="text-sm opacity-90">
          O briefing não carregou agora — sem problema, o resto do app segue normal.
          Ele volta ao recarregar a página.
        </p>
      )}
      {/* Sem cadeado como primeira mensagem: o card muda de assunto e entrega
          conteúdo local — a meta da pessoa + o foco do dia. O Ascende+ vira
          uma linha discreta de rodapé, não a manchete. */}
      {locked && (
        <div className="space-y-2">
          {profile?.goal && (
            <p className="text-sm leading-relaxed">
              Sua bússola: <em>"{profile.goal}"</em>
            </p>
          )}
          <p className="text-sm leading-relaxed opacity-90">{DAILY_FOCUS[new Date().getDay()]}</p>
          <p className="text-[11px] opacity-70 pt-1">
            {data?.reason ?? "O briefing diário com IA vive no Ascende+."}{" "}
            <Link to="/app/assinatura" className="underline underline-offset-2">Conhecer</Link>
          </p>
        </div>
      )}
      {data?.briefing && (
        <div className="space-y-2">
          <p className="text-sm leading-relaxed whitespace-pre-line">{data.briefing}</p>
          {data.courtesy && (
            <p className="text-[11px] opacity-70">
              Seus primeiros briefings são por nossa conta ✨ — depois, ele chega todo dia
              no Ascende+ e toda semana na sua retrospectiva gratuita de domingo.
            </p>
          )}
        </div>
      )}
      {/* Rede de segurança (achado de QA ao vivo): query resolveu, não é locked,
          mas briefing veio vazio (ex.: ainda sem dado suficiente) — o card não
          pode ficar sem corpo nenhum, só com o título. Mesmo conteúdo local do
          modo locked, sem o convite ao Ascende+ (a pessoa já tem acesso). */}
      {!isLoading && !isError && !locked && !data?.briefing && (
        <p className="text-sm leading-relaxed opacity-90">{DAILY_FOCUS[new Date().getDay()]}</p>
      )}
    </Card>
  );
}

function HabitsToday() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();

  const { data, isLoading } = useQuery({
    queryKey: ["habits-today", user?.id, today],
    enabled: !!user,
    queryFn: async () => {
      const since60 = daysAgoISOInSP(60);
      const [{ data: habits }, { data: logs }, { data: history }] = await Promise.all([
        supabase.from("habits").select("id,name,pillar").eq("user_id", user!.id).eq("active", true).order("created_at"),
        supabase.from("habit_logs").select("id,habit_id").eq("user_id", user!.id).eq("log_date", today),
        supabase.from("habit_logs").select("habit_id,log_date").eq("user_id", user!.id).gte("log_date", since60),
      ]);
      // Sequência por hábito: dias consecutivos terminando hoje ou ontem
      const byHabit = new Map<string, Set<string>>();
      for (const l of history ?? []) {
        if (!byHabit.has(l.habit_id)) byHabit.set(l.habit_id, new Set());
        byHabit.get(l.habit_id)!.add(String(l.log_date));
      }
      const dayIso = (off: number) => daysAgoISOInSP(off);
      const streaks: Record<string, number> = {};
      for (const [id, days] of byHabit) {
        let n = 0;
        let off = days.has(dayIso(0)) ? 0 : 1; // hoje em aberto não quebra
        while (off <= 60 && days.has(dayIso(off))) { n++; off++; }
        streaks[id] = n;
      }
      return { habits: habits ?? [], logs: logs ?? [], streaks };
    },
  });

  const toggle = async (habitId: string) => {
    if (!user || !data) return;
    const log = data.logs.find((l) => l.habit_id === habitId);
    if (log) {
      await supabase.from("habit_logs").delete().eq("id", log.id);
    } else {
      const { error } = await supabase.from("habit_logs").insert({ user_id: user.id, habit_id: habitId, log_date: today });
      if (!error) toast.success("Feito! +10 XP");
    }
    qc.invalidateQueries({ queryKey: ["habits-today"] });
    qc.invalidateQueries({ queryKey: ["xp"] });
  };

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data?.habits.length) {
    // Sem compromissos ainda — de propósito: nada vem pré-definido. Eles
    // nascem da meta da pessoa, com o Conselheiro (cartão de escolha).
    return (
      <Card className="p-5 space-y-1.5">
        <p className="text-sm font-medium">Seus compromissos diários nascem da sua meta.</p>
        <p className="text-sm text-muted-foreground">
          Nada de lista pronta:{" "}
          <Link
            className="underline text-foreground"
            to={`/app/conselheiro?q=${encodeURIComponent("A partir da minha meta, proponha 2 ou 3 compromissos diários pequenos para eu começar")}`}
          >
            construa com o Conselheiro
          </Link>{" "}
          — ou <Link to="/app/vitalidade" className="underline text-foreground">crie manualmente</Link>, do seu jeito.
          É o compromisso cumprido, dia após dia, que constrói a subida (+10 XP cada).
        </p>
      </Card>
    );
  }

  const done = data.logs.length;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-semibold">Compromissos de hoje</h2>
        <span className="text-xs text-muted-foreground">{done}/{data.habits.length}</span>
      </div>
      <div className="space-y-1.5">
        {data.habits.map((h) => {
          const isDone = data.logs.some((l) => l.habit_id === h.id);
          const meta = pillarById(h.pillar);
          return (
            <button
              key={h.id}
              onClick={() => toggle(h.id)}
              className={cn(
                "w-full flex items-center gap-3 rounded-md border p-3 text-left transition-colors",
                isDone ? "bg-success/5 border-success/30" : "hover:bg-muted/60"
              )}
              aria-pressed={isDone}
            >
              {isDone
                ? <CircleCheck className="w-5 h-5 text-success shrink-0" />
                : <Circle className="w-5 h-5 text-muted-foreground shrink-0" />}
              <span className={cn("text-sm flex-1", isDone && "line-through text-muted-foreground")}>{h.name}</span>
              {(data.streaks?.[h.id] ?? 0) >= 2 && (
                <span className="text-[11px] font-semibold text-gold-ink flex items-center gap-0.5 shrink-0" title={`${data.streaks[h.id]} dias seguidos`}>
                  <Flame className="w-3 h-3" /> {data.streaks[h.id]}
                </span>
              )}
              {meta && (
                <span className="w-2 h-2 rounded-full" style={{ background: `hsl(var(${meta.colorVar}))` }} aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ── XP de metas batidas (deslocar a recompensa de "anotar" para "viver"):
   ao abrir a tela Hoje, 1x por dia, reivindica os bônus do dia de ONTEM
   (água na meta, dia dentro da meta calórica, dia dentro do teto de gasto).
   Avaliação preguiçosa no servidor (claim_goal_bonuses) — zero cron,
   unicidade garantida pelo reason datado no xp_log. ── */
function useGoalBonuses() {
  const { user } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (!user) return;
    const key = `ascend-goalbonus-${todayISO()}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* noop */ }
    supabase.rpc("claim_goal_bonuses").then(({ data }) => {
      const list = Array.isArray(data) ? data as { label: string; points: number }[] : [];
      if (!list.length) return;
      for (const b of list) toast.success(`${b.label} · +${b.points} XP 🎯`);
      qc.invalidateQueries({ queryKey: ["xp"] });
    });
  }, [user, qc]);
}

export default function Hoje() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const firstName = (profile?.name ?? "").split(" ")[0];
  const streak = useActiveStreak();
  useGoalBonuses();

  // Ritual de retorno (Sugestão 3): silêncio detectado como serviço, não
  // culpa. Enquanto ativo, a tela troca o painel pelo ritual — a pessoa
  // pode dispensar (por hoje) e ver o painel normal quando quiser.
  const { returning, gapDays } = useReturnGap();
  const [panelForced, setPanelForced] = useState(
    () => localStorage.getItem(`ascend-return-panel-${todayISO()}`) === "1"
  );
  const showReturnRitual = returning && !panelForced;
  const forcePanel = () => {
    try { localStorage.setItem(`ascend-return-panel-${todayISO()}`, "1"); } catch { /* noop */ }
    setPanelForced(true);
  };

  // Nível com significado desde o dia 1 (análise UX P2.3): os títulos
  // poéticos são um ativo de marca — mostrá-los, não escondê-los.
  const { data: xpTotal } = useQuery({
    queryKey: ["xp", "total", user?.id],
    enabled: !!user,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data } = await supabase.rpc("xp_total", { uid: user!.id });
      return Number(data) || 0;
    },
  });
  const level = levelFromXp(xpTotal ?? 0).level;

  // Momento de retorno: sem dashboard vazio na cara, sem streak em
  // destaque — uma tela única, e a CaptureBar absorve (Sugestão 3).
  if (showReturnRitual) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            {greet()}{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="text-sm text-muted-foreground">A subida continua de onde você parou.</p>
        </div>
        <ReturnRitual gapDays={gapDays} onShowPanel={forcePanel} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl lg:max-w-4xl mx-auto space-y-4 animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            {greet()}{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="text-sm text-muted-foreground">Um dia de cada vez. Um degrau de cada vez.</p>
          {streak === 2 && (
            <p className="text-[11px] text-gold-ink mt-0.5">
              Sua primeira sequência começou — e um dia de descanso por semana não quebra.
            </p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {xpTotal !== undefined && (
            <Link
              to="/app/score"
              className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title="Ver sua jornada de níveis"
            >
              Nv. {level} · {levelTitle(level)}
            </Link>
          )}
          {streak >= 2 && (
            <span
              className="flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold-ink"
              title={`${streak} dias ativos seguidos (1 descanso por semana não quebra a sequência)`}
            >
              <Flame className="w-3.5 h-3.5" /> {streak} dias
            </span>
          )}
        </div>
      </div>

      {/* Ordem da tela Hoje (plano §5.5): prioridade do dia (briefing/primeiros
          passos) → captura inteligente → compromissos → indicadores principais
          → ações rápidas → batalhas → Conselheiro → informações secundárias.
          A ordem continua a mesma; o que mudou (análise UX item 2) é a
          HIERARQUIA: nove cartões de peso idêntico não diziam o que pede ação
          hoje e o que é só acompanhamento. Duas seções nomeadas resolvem isso
          sem mexer na lógica de nenhum cartão. */}
      <section className="space-y-4" aria-labelledby="hoje-agora">
        <h2 id="hoje-agora" className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
          Agora
          <span className="ascend-line flex-1" aria-hidden />
        </h2>
        <Briefing />
        <FirstSteps />
        <CaptureBar />
        <SleepCheckin />
        <HabitsToday />
        <ActivePlans />
      </section>

      <section className="space-y-3 pt-3" aria-labelledby="hoje-acompanhamento">
        <h2
          id="hoje-acompanhamento"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"
        >
          Acompanhamento
          <span className="h-px flex-1 bg-border" aria-hidden />
        </h2>
        <DayProgress />
        <QuickActions />
        <RetroCountdown />
        <WhatsappHojeCard />
        <BattleCheckinCard />

        <Link
          to="/app/conselheiro"
          className="flex items-center justify-between rounded-lg border bg-card p-4 hover:bg-muted/50 transition-colors"
        >
          <div>
            <p className="text-sm font-semibold">Falar com o Conselheiro</p>
            <p className="text-xs text-muted-foreground">
              Ele conhece seus dados de todos os pilares — pergunte qualquer coisa.
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </Link>

        {/* Informação secundária: completude do perfil fica por último */}
        <ProfileCompleteness />
      </section>
    </div>
  );
}