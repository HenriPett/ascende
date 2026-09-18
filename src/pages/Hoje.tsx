import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, DEFAULT_WATER_GOAL_ML } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import CaptureBar from "@/components/core/CaptureBar";
import { WhatsappHojeCard } from "@/components/core/WhatsappCard";
import BattleCheckinCard from "@/components/core/BattleCheckin";
import QuickActions from "@/components/core/QuickActions";
import { toast } from "sonner";
import {
  Sunrise, ChevronRight, CircleCheck, Circle, Flame, Droplet, Dumbbell, Moon, Smile,
  BookOpen, X, UserRound, ListChecks, MessageCircle, Trophy, CalendarHeart,
  HandHeart, ClipboardList, Trash2, Plus,
} from "lucide-react";
import { PLAN_KIND_META } from "@/lib/blueprint";
import { appPath } from "@/lib/routes";
import { focusCaptureElement, useProvideCaptureFocus } from "@/hooks/useCaptureFocus";
import {
  useSleepZoneVisible, useBattleZoneVisible, useWhatsappZoneVisible,
} from "@/hooks/useHojeZones";
import { useCallback, useEffect, useRef, useState } from "react";
import { greet, todayISO } from "@/lib/format";
import { focusLine } from "@/lib/dailyFocus";
import { dateISOInSP, daysAgoISOInSP } from "@/lib/dates";
import { PILLARS, pillarById, type PillarId } from "@/lib/pillars";
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
  if (!data) return { streak: 0, daysRegistered: 0 };

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
  /* `daysRegistered` sai junto porque a linha de retorno precisa de um número
     PRESERVADO para abrir — nunca de um número de falta. Ele vem do mesmo
     conjunto que a sequência já carregou: nenhuma leitura a mais. */
  return { streak, daysRegistered: data.size };
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

/* Ações rápidas (água, humor, gasto, refeição, treino) vivem em
   components/core/QuickActions.tsx: elas agora também aparecem na folha do
   REGISTRAR, que existe em toda tela do app. Ver o cabeçalho de lá. */

/* ── Complete seu retrato (1.2): completude do perfil com atalhos ── */
/** UMA definição da query, usada pelo componente E pelo hook de
 *  visibilidade. Duas definições com a mesma queryKey e formas
 *  diferentes envenenariam o cache uma da outra: quem resolvesse
 *  primeiro ditaria o formato para as duas. */
function useActivePlansQuery() {
  const { user } = useAuth();
  return useQuery({
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
}

function ActivePlans() {
  const { user } = useAuth();
  const { data } = useActivePlansQuery();

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

/** Uma definição só (ver useActivePlansQuery). */
function useFirstStepsQuery() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const dismissed = readLocalFlag("ascend-firststeps-done");
  const absorbed = !!profile?.blueprint_activated_at;
  return useQuery({
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
}

function FirstSteps() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("ascend-firststeps-done") === "1");
  const awarded = useRef(false);

  // Absorvida pelo Blueprint (Emenda 4): quem ATIVOU o Blueprint da Subida no
  // onboarding já viveu o essencial da trilha (metas, plano e compromissos no
  // dia 1) — a lista some para não cobrar o que já aconteceu.
  //
  // ATIVOU, não "gerou". A leitura anterior era `blueprint_generated_at`, que
  // claim_blueprint carimba ANTES da chamada do modelo: ele diz que a IA
  // rodou, não que a pessoa quis. Quem usou a saída "Agora não — quero
  // explorar primeiro" (Onboarding.tsx:821) ficava sem plano, sem meta, sem
  // compromisso E sem esta trilha — ou seja, a pessoa mais cautelosa do funil
  // recebia o app mais vazio, com o paywall como única zona. Ver a migração
  // 20260913120000.
  const absorbed = !!profile?.blueprint_activated_at;

  const { data } = useFirstStepsQuery();

  const raioxDone = (data?.raiox ?? 0) > 0 || Number(profile?.monthly_income ?? 0) > 0;

  const steps = data ? [
    { label: "Conte seu dia na captura abaixo", xp: "+XP por registro", done: data.events >= 1, to: null },
    { label: "Mapeie seu mês em 60 segundos (Raio-X)", xp: "destrava o plano no seu bolso", done: raioxDone, to: "/app/prosperidade" },
    { label: "Registre uma refeição (vale foto do prato)", xp: "+4 XP", done: data.meals > 0, to: "/app/vitalidade?s=comida" },
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
              Você já viveu o essencial: contar, mapear e planejar. No domingo chega a sua
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
/** Uma definição só (ver useActivePlansQuery). */
function useRetroPreviewQuery() {
  const { user } = useAuth();
  const dismissed = readLocalFlag("ascend-retro-preview-done");
  const ageDays = user?.created_at
    ? Math.floor((Date.now() - Date.parse(user.created_at)) / 864e5) : 0;
  const eligible = !dismissed && new Date().getDay() !== 0 && ageDays >= 1 && ageDays <= 6;
  return useQuery({
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
}

function RetroCountdown() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("ascend-retro-preview-done") === "1");

  const createdAt = user?.created_at ? new Date(user.created_at).getTime() : 0;
  const ageDays = createdAt ? Math.floor((Date.now() - createdAt) / 864e5) : 0;
  const isSunday = new Date().getDay() === 0;
  const eligible = !dismissed && !isSunday && ageDays >= 1 && ageDays <= 6;

  const { data } = useRetroPreviewQuery();

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
              ? `O Conselheiro vai cruzar ${data.weekEvents === 1 ? "o seu registro" : `os seus ${data.weekEvents} registros`} da semana e contar a história dela. Cada dia registrado deixa a leitura mais nítida.`
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
        /* HOJE É UM DIA, NÃO "DE HOJE EM DIANTE".
           `gte(hoje)` sem teto somava todo gasto com data futura junto com o
           do dia — e o app CRIA gastos futuros de propósito: uma compra em
           10x grava dez linhas, uma por ciclo, até um ano à frente. Quem
           registrasse R$ 2.000 em 10x via "Gasto de hoje: R$ 2.000" no lugar
           dos R$ 200 da primeira parcela, e a barra do teto do dia estourava
           por um dinheiro que ainda não saiu do bolso. O mesmo valia para os
           fixos materializados à frente e para as parcelas importadas.

           `occurred_at` é `date` (setup.sql:188), então a igualdade é exata:
           o dia inteiro e só ele. */
        supabase.from("transactions").select("kind,amount")
          .eq("user_id", user!.id).eq("occurred_at", todayISO()).limit(200),
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
    { label: "Treino", done: has("workout"), icon: Dumbbell, to: "/app/vitalidade?s=treino", colorVar: "--vitalidade", show: trackers.has("workouts") },
    { label: "Sono", done: has("sleep") || has("nap"), icon: Moon, to: "/app/vitalidade?s=treino", colorVar: "--vitalidade", show: trackers.has("sleep") || trackers.has("naps") },
    { label: "Humor", done: has("mood"), icon: Smile, to: "/app/mente", colorVar: "--mente", show: trackers.has("mood") },
    { label: "Mente", done: has("practice") || has("journal") || has("gratitude"), icon: BookOpen, to: "/app/mente", colorVar: "--mente", show: trackers.has("practice") || trackers.has("journal") || trackers.has("gratitude") },
  ].filter((pt) => pt.show);

  /* ── COR POR DOMÍNIO, NÃO POR LINHA ─────────────────────────────────────
     Com a fusão, kcal, proteína, treinos e sono passaram a ser o mesmo pilar —
     e quatro barras sálvia empilhadas viram uma parede, não um painel. A regra
     que vale aqui: uma cor por DOMÍNIO, e cada cor responde a uma pergunta
     diferente.
       sálvia → kcal, proteína, treinos, sono   (Vitalidade)
       azul   → água                            (hsl(205 70% 55%), desde antes)
       ouro   → teto de gasto                   (Prosperidade)
     Rótulo e ícone distinguem as linhas dentro do domínio, como já distinguiam.
     De quebra, a incoerência velha se conserta sozinha: a barra de proteína era
     pintada de --vitalidade sendo tracker de alimentação. */
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
            <Flame className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} /> Calorias
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
            <Bar value={kcal} goal={kcalGoal} color="hsl(var(--vitalidade))" celebrating={celebrate === "kcal"} />
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
            <Link to="/app/vitalidade?s=metas" className="underline text-foreground">Definir meta</Link>
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
              : `${workoutsGoal - workoutsWeek === 1 ? "Falta 1 treino" : `Faltam ${workoutsGoal - workoutsWeek} treinos`} até domingo.`}
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

/* DAILY_FOCUS e a regra da linha do cabeçalho vivem em lib/dailyFocus.ts:
   a frase passou a depender do ESTADO do dia (o que já foi registrado, o que
   ainda perece), e essa decisão é testável — então ela sai do componente. */

/** Quantos registros entraram HOJE. Chave própria de propósito: a query do
 *  DayProgress traz as linhas inteiras, e repetir a chave dela com uma forma
 *  diferente envenenaria o cache do outro consumidor (ver useZoneQueries). */
function useEventsTodayCount(): number {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["events-today-count", user?.id, todayISO()],
    enabled: !!user,
    staleTime: 1000 * 30,
    queryFn: async () => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const { count } = await supabase.from("life_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id).gte("occurred_at", dayStart.toISOString());
      return count ?? 0;
    },
  });
  // Enquanto não sabemos, tratamos como "ainda não registrou": o convite do
  // dia é o texto certo para quem começa, e é o menos errado dos dois quando
  // a leitura falha — nunca dizemos "dia registrado" sem ter visto registro.
  return data ?? 0;
}

/* O briefing virou DUAS zonas, e isso é de propósito (Fase 4).
 *
 * Antes era um card só que renderizava SEMPRE: no plano gratuito caía no "Foco
 * de hoje" — a meta da pessoa + uma dica fixa por dia da semana — ocupando a
 * vaga nº 1 todo santo dia, com conteúdo que não muda de valor e link de
 * upgrade. Paywall permanente na primeira dobra.
 *
 * A decisão do fundador foi sobre o TRAVADO: ele não some, desce para o fim da
 * ordem. Quem tem vida registrada vê a própria vida primeiro; quem não tem
 * registro nenhum continua vendo o convite, que ali é a coisa mais útil da
 * tela. O briefing DE VERDADE é a leitura da vida da pessoa e continua na
 * posição 4.
 *
 * Daí duas entradas no HOJE_ZONES com visibilidade mutuamente exclusiva. */

interface BriefingData {
  briefing: string | null;
  locked?: boolean;
  reason?: string;
  courtesy?: boolean;
}

/** Query única das duas zonas e dos dois hooks. O React Query dedupa pela
 *  chave, então chamar em quatro lugares custa uma requisição. */
function useBriefingQuery() {
  return useQuery({
    queryKey: ["briefing", todayISO()],
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("briefing", { body: {} });
      if (error || data?.error) throw new Error(data?.error ?? "erro");
      return data as BriefingData;
    },
  });
}

/** Briefing real: só quando há texto de verdade. Enquanto carrega, NENHUMA das
 *  duas zonas aparece — esqueleto dentro de card também é moldura, e a regra da
 *  fase é que zona sem dado não ocupa espaço. */
function useBriefingRealVisible(): boolean {
  const { data, isLoading, isError } = useBriefingQuery();
  if (isLoading || isError) return false;
  return !data?.locked && !!data?.briefing;
}

/** Briefing travado: o convite ao Ascende+. */
function useBriefingLockedVisible(): boolean {
  const { data, isLoading, isError } = useBriefingQuery();
  if (isLoading || isError) return false;
  return !!data?.locked;
}

function Briefing() {
  const { data } = useBriefingQuery();
  if (!data?.briefing) return null;

  return (
    <Card className="p-5 bg-primary text-primary-foreground">
      <div className="flex items-center gap-2 text-sm font-medium mb-2 opacity-90">
        <Sunrise className="w-4 h-4" />
        {new Date().getDay() === 0 ? "Retrospectiva da semana" : "Seu briefing de hoje"}
      </div>
      <div className="space-y-2">
        <p className="text-sm leading-relaxed whitespace-pre-line">{data.briefing}</p>
        {data.courtesy && (
          <p className="text-[11px] opacity-70">
            Seus primeiros briefings são por nossa conta ✨ — depois, o briefing chega todo
            dia no Ascende+, e a retrospectiva de domingo continua gratuita para sempre.
          </p>
        )}
      </div>
    </Card>
  );
}

/* O convite ao Ascende+, último da fila.
   NÃO repete a linha de foco do dia: ela subiu para o cabeçalho, e dizer a
   mesma frase duas vezes na mesma tela é o tipo de repetição que faz a pessoa
   parar de ler. O conteúdo aqui é a bússola dela + o que o briefing entrega. */
function BriefingLocked() {
  const { profile } = useProfile();
  const { data } = useBriefingQuery();
  if (!data?.locked) return null;

  return (
    <Card className="p-5 bg-primary text-primary-foreground">
      <div className="flex items-center gap-2 text-sm font-medium mb-2 opacity-90">
        <Sunrise className="w-4 h-4" /> Briefing diário
      </div>
      <div className="space-y-2">
        {profile?.goal && (
          <p className="text-sm leading-relaxed">
            Sua bússola: <em>"{profile.goal}"</em>
          </p>
        )}
        <p className="text-sm leading-relaxed opacity-90">
          Todas as manhãs, uma leitura do seu dia: o que os seus registros mostram,
          o que merece atenção e o próximo degrau.
        </p>
        <p className="text-[11px] opacity-70 pt-1">
          {data?.reason ?? "O briefing diário do Conselheiro faz parte do Ascende+."}{" "}
          <Link to={appPath("assinatura")} className="underline underline-offset-2">Conhecer</Link>
        </p>
      </div>
    </Card>
  );
}

/** Uma definição só (ver useActivePlansQuery). */
function useHabitsTodayQuery() {
  const { user } = useAuth();
  const today = todayISO();
  return useQuery({
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
}

/* ── A PORTA DE CRIAR UM COMPROMISSO ───────────────────────────────────────
   Ela vive AQUI, junto da lista, e não numa tela de pilar: compromisso é
   transversal (o seletor oferece os três pilares), e foi exatamente por isso
   que ele saiu da Vitalidade.

   `/app?novo=compromisso` existe para o beco sem saída: sem nenhum
   compromisso a zona inteira se esconde (`return null`, logo abaixo), e aí
   não sobra onde clicar. A saída NÃO é um quarto convite na Hoje — o hub já
   convida, na seção Planos, e convite repetido em três lugares é a superfície
   que a Fase 4 cortou. A saída é o convite que JÁ EXISTE passar a apontar
   para cá quando não há compromisso nenhum: mesmo convite, mesmo lugar, e a
   zona só aparece para quem pediu por ela. */
const QUERY_NOVO_COMPROMISSO = "compromisso";

function useQuerCriarCompromisso(): boolean {
  const { search } = useLocation();
  return new URLSearchParams(search).get("novo") === QUERY_NOVO_COMPROMISSO;
}

function HabitsToday() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();
  const querCriar = useQuerCriarCompromisso();
  const [novo, setNovo] = useState("");
  const [novoPilar, setNovoPilar] = useState<PillarId>("vitalidade");
  const [criando, setCriando] = useState(false);

  const { data, isLoading } = useHabitsTodayQuery();

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

  /* O mesmo formulário que vivia na Vitalidade, com o mesmo insert: nome livre
     e o pilar escolhido à mão, porque o pilar aqui É a escolha da pessoa (não
     dá para derivar de um `kind`, como nos eventos). */
  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !novo.trim() || criando) return;
    setCriando(true);
    const { error } = await supabase.from("habits")
      .insert({ user_id: user.id, name: novo.trim(), pillar: novoPilar });
    setCriando(false);
    if (error) { toast.error("Não consegui criar o compromisso. Tente de novo."); return; }
    toast.success("Compromisso criado. Consistência constrói a subida!");
    setNovo("");
    qc.invalidateQueries({ queryKey: ["habits-today"] });
    qc.invalidateQueries({ queryKey: ["jornada-habits"] });
  };

  /* Arquivar mudou de casa junto com a lista. Sem isto, um compromisso
     proposto pelo Conselheiro seria impossível de tirar da tela: remover uma
     função sem dar outra porta é a perda que ninguém reclama e todo mundo
     sente. */
  const archive = async (id: string, nome: string) => {
    const ultimo = (data?.habits.length ?? 0) <= 1;
    await supabase.from("habits").update({ active: false }).eq("id", id);
    toast.success(ultimo
      // Arquivar o último faz a zona inteira sumir no próximo render. Dizer
      // para onde ela foi é o que separa "sumiu" de "acabou sem aviso".
      ? `"${nome}" arquivado. Era o último: para criar outro, vá em Jornada > Planos.`
      : `"${nome}" arquivado. O histórico dele fica guardado.`);
    qc.invalidateQueries({ queryKey: ["habits-today"] });
    qc.invalidateQueries({ queryKey: ["jornada-habits"] });
  };

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  /* Sem compromissos a zona não existe — quem é conta nova recebe o convite
     pelo FirstSteps, e quem não é recebe pelo hub, na seção Planos. A exceção
     é quem chegou pelo próprio convite (`?novo=compromisso`): aí a zona é a
     resposta ao clique, não um convite a mais. */
  if (!data?.habits.length && !querCriar) return null;

  const vazio = !data?.habits.length;
  const done = data?.logs.length ?? 0;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-semibold">Compromissos de hoje</h2>
        {!vazio && <span className="text-xs text-muted-foreground">{done}/{data!.habits.length}</span>}
      </div>

      {vazio && (
        <p className="text-sm text-muted-foreground mb-3">
          Comece com um só, e pequeno o bastante para você cumprir num dia ruim:
          "beber água ao acordar", "10 flexões", "anotar o gasto do dia". O truque não é
          escolher o compromisso certo — é escolher um que não dê para falhar.
        </p>
      )}

      <div className="space-y-1.5">
        {(data?.habits ?? []).map((h) => {
          const isDone = (data?.logs ?? []).some((l) => l.habit_id === h.id);
          const meta = pillarById(h.pillar);
          return (
            <div
              key={h.id}
              className={cn(
                "flex items-center gap-1 rounded-md border pr-1.5 transition-colors",
                isDone ? "bg-success/5 border-success/30" : "hover:bg-muted/60"
              )}
            >
              <button
                onClick={() => toggle(h.id)}
                className="flex items-center gap-3 flex-1 min-w-0 p-3 text-left"
                aria-pressed={isDone}
              >
                {isDone
                  ? <CircleCheck className="w-5 h-5 text-success shrink-0" />
                  : <Circle className="w-5 h-5 text-muted-foreground shrink-0" />}
                <span className={cn("text-sm flex-1 min-w-0", isDone && "line-through text-muted-foreground")}>{h.name}</span>
                {(data?.streaks?.[h.id] ?? 0) >= 2 && (
                  <span className="text-[11px] font-semibold text-gold-ink flex items-center gap-0.5 shrink-0" title={`${data!.streaks[h.id]} dias seguidos`}>
                    <Flame className="w-3 h-3" /> {data!.streaks[h.id]}
                  </span>
                )}
                {meta && (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: `hsl(var(${meta.colorVar}))` }} aria-hidden />
                )}
              </button>
              <Button
                variant="ghost" size="icon"
                className="w-11 h-11 shrink-0 text-muted-foreground"
                onClick={() => archive(h.id, h.name)}
                aria-label={`Arquivar compromisso ${h.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          );
        })}
      </div>

      {/* Exemplo no lugar do rótulo: "Novo compromisso" repete o título do
          cartão e deixa o campo mudo; um exemplo concreto é o que faz a pessoa
          preencher sem pensar. `min-h-11` nos três controles porque esta linha
          tem campo, seletor e botão lado a lado — é onde o dedo erra. */}
      <form onSubmit={criar} className="flex gap-2 mt-3">
        <Input
          maxLength={80} placeholder='Ex.: "beber água ao acordar"'
          className="min-h-11 min-w-0 flex-1" value={novo}
          onChange={(e) => setNovo(e.target.value)}
          autoFocus={vazio}
          aria-label="Novo compromisso diário"
        />
        <Select value={novoPilar} onValueChange={(v) => setNovoPilar(v as PillarId)}>
          <SelectTrigger className="w-[112px] min-h-11 shrink-0" aria-label="Pilar do compromisso">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PILLARS.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="submit" size="icon" className="w-11 h-11 shrink-0"
          disabled={criando} aria-label="Criar este compromisso">
          <Plus className="w-4 h-4" />
        </Button>
      </form>
    </Card>
  );
}

/* ── XP de metas batidas (deslocar a recompensa de "anotar" para "viver"):
   ao abrir a tela Hoje, 1x por dia, reivindica os bônus do dia de ONTEM
   (água na meta, dia dentro da meta calórica, dia dentro do teto de gasto).
   Avaliação preguiçosa no servidor (claim_goal_bonuses) — zero cron,
   unicidade garantida pelo reason datado no xp_log. ── */
/* ═══════════════════════════════════════════════════════════════════════
   VISIBILIDADE DAS ZONAS + ORDEM DE PRIORIDADE

   As zonas se escondiam sozinhas, cada uma com um `return null` no próprio
   corpo. Funcionava para esconder, mas a página não tinha como saber QUANTAS
   teriam conteúdo antes de renderizar — e sem isso não existe teto de 5.

   Cada zona ganha um hook que responde "tenho conteúdo?" usando a MESMA query
   do componente (o React Query dedupa: custa zero requisição a mais). O
   `return null` de dentro continua lá como rede de segurança: se hook e
   guarda discordarem, a zona se esconde e a Hoje perde uma vaga naquele
   render — falha mostrando menos, nunca mostrando moldura vazia.
   ═══════════════════════════════════════════════════════════════════════ */

function useFirstStepsVisible(): boolean {
  const { profile } = useProfile();
  const { data } = useFirstStepsQuery();
  const dismissed = readLocalFlag("ascend-firststeps-done");
  const absorbed = !!profile?.blueprint_activated_at;
  // >= 25 eventos: a trilha da primeira semana já foi absorvida pelo uso.
  return !dismissed && !absorbed && !!data && data.events < 25;
}

function useHabitsTodayVisible(): boolean {
  const { data } = useHabitsTodayQuery();
  /* Chamado SEMPRE, nunca depois de um `||` que possa curto-circuitar: hook
     dentro de expressão preguiçosa quebra a ordem dos hooks na hora em que a
     lista deixa de estar vazia. */
  const querCriar = useQuerCriarCompromisso();
  return (data?.habits.length ?? 0) > 0 || querCriar;
}

function useActivePlansVisible(): boolean {
  const { data } = useActivePlansQuery();
  return (data?.length ?? 0) > 0;
}

/** A condição é a META EXISTIR, não o valor ser > 0: com meta e sem registro
 *  hoje o painel RENDERIZA, porque barra em zero ali é informação legítima
 *  ("o dia começou") e não moldura vazia. */
function useDayProgressVisible(): boolean {
  const { profile } = useProfile();
  const trackers = activeTrackerSet(profile);
  const goal = (v: unknown) => Number(v) > 0;
  return (
    (trackers.has("meals") && goal(profile?.calorie_goal_kcal))
    || (trackers.has("protein") && goal(profile?.protein_goal_g))
    || (trackers.has("spend_limit") && goal(profile?.daily_spend_limit))
    || (trackers.has("workouts") && goal(profile?.weekly_workouts_goal))
    || (trackers.has("sleep") && goal(profile?.sleep_goal_h))
  );
}

function useRetroCountdownVisible(): boolean {
  const { user } = useAuth();
  const { data } = useRetroPreviewQuery();
  const dismissed = readLocalFlag("ascend-retro-preview-done");
  const ageDays = user?.created_at
    ? Math.floor((Date.now() - Date.parse(user.created_at)) / 864e5) : 0;
  const eligible = !dismissed && new Date().getDay() !== 0 && ageDays >= 1 && ageDays <= 6;
  return eligible && !!data;
}

/** localStorage pode lançar. Sem a flag, a zona aparece: mostrar de novo é
 *  menos grave que sumir por engano. */
function readLocalFlag(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

/**
 * ORDEM DE PRIORIDADE DAS ZONAS DA HOJE. Teto: MAX_ZONES.
 *
 * Princípio: o que PERECE hoje > o que ela PROMETEU > o que JÁ ACONTECEU >
 * o que PODE ESPERAR.
 *
 * Renderiza as MAX_ZONES primeiras QUE TÊM CONTEÚDO. As demais não existem
 * naquele render e reaparecem sozinhas quando uma de cima resolve (passou do
 * meio-dia, o check-in de sono sai e abre vaga). O teto é rodízio, não corte.
 *
 * ZONA SEM DADO NÃO RENDERIZA NADA — nem título, nem card vazio, nem "você
 * ainda não registrou". Espaço vazio com moldura cobra sem oferecer.
 *
 * FORA DESTE ARRAY, de propósito: o cabeçalho, o bloco de captura
 * (CaptureBar + QuickActions — é registrar em 1 toque, não informação) e o
 * ReturnRitual, que é MODO e substitui a página inteira.
 *
 * MEXER AQUI MUDA A TELA INTEIRA. Leia o `why` de cada posição antes de
 * inserir a sexta — se ela não couber no princípio acima, ela não é zona da
 * Hoje.
 */
const MAX_ZONES = 5;

const HOJE_ZONES = [
  { id: "sleep", Component: SleepCheckin, useVisible: useSleepZoneVisible,
    why: "Perece: some ao meio-dia e a noite não volta. Um toque." },
  { id: "battle", Component: BattleCheckinCard, useVisible: useBattleZoneVisible,
    why: "Perece hoje, e é o assunto de maior peso do app. Só com check-in pendente." },
  { id: "habits", Component: HabitsToday, useVisible: useHabitsTodayVisible,
    why: "O que ela prometeu a si mesma. Só com pelo menos um hábito ativo." },
  { id: "briefing", Component: Briefing, useVisible: useBriefingRealVisible,
    why: "A leitura da própria vida — briefing do dia ou retrospectiva de domingo." },
  { id: "progress", Component: DayProgress, useVisible: useDayProgressVisible,
    why: "O que já aconteceu hoje. Só com pelo menos uma meta definida." },
  { id: "plans", Component: ActivePlans, useVisible: useActivePlansVisible,
    why: "O plano existe e é consultável; não perece." },
  { id: "first_steps", Component: FirstSteps, useVisible: useFirstStepsVisible,
    why: "Trilha da primeira semana; só conta nova sem Blueprint." },
  { id: "retro", Component: RetroCountdown, useVisible: useRetroCountdownVisible,
    why: "Expectativa, não ação. Dispensável." },
  { id: "whatsapp", Component: WhatsappHojeCard, useVisible: useWhatsappZoneVisible,
    why: "Crescimento — serve mais a nós do que a ela." },
  { id: "briefing_locked", Component: BriefingLocked, useVisible: useBriefingLockedVisible,
    why: "Convite ao Ascende+. Último por decisão do fundador: quem tem vida "
      + "registrada vê a própria vida primeiro; quem não tem registro nenhum "
      + "continua vendo o convite, que ali é o mais útil da tela." },
] as const;

/** Chama TODOS os hooks, sempre na mesma ordem (regra dos hooks), e filtra
 *  depois. O corte em MAX_ZONES acontece sobre o que sobrou. */
function useVisibleZones(returning: boolean) {
  const visible = HOJE_ZONES.map((zone) => zone.useVisible());
  return HOJE_ZONES
    /* Na volta depois de alguns dias, a zona `progress` sai daquele render.
       Barra em zero é informação legítima num dia comum e vira PLACAR DE
       AUSÊNCIA para quem acabou de voltar — a única tela em que os mesmos
       pixels mudam de significado. A vaga não se perde: vai para a próxima
       da fila, que é como o teto de 5 já funciona. */
    .filter((z, i) => visible[i] && !(returning && z.id === "progress"))
    .slice(0, MAX_ZONES);
}

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
  const { streak, daysRegistered } = useActiveStreak();
  useGoalBonuses();

  // Ritual de retorno (Sugestão 3): silêncio detectado como serviço, não
  // culpa. Enquanto ativo, a tela troca o painel pelo ritual — a pessoa
  // pode dispensar (por hoje) e ver o painel normal quando quiser.
  const { returning, gapDays } = useReturnGap();

  /* A LINHA DE FOCO, pelo estado real do dia (lib/dailyFocus.ts). */
  const eventsToday = useEventsTodayCount();
  const sleepPending = useSleepZoneVisible();
  const { data: habitsToday } = useHabitsTodayQuery();
  const pendingHabits = habitsToday
    ? habitsToday.habits.filter((h) => !habitsToday.logs.some((l) => l.habit_id === h.id)).length
    : 0;
  const focoDoDia = focusLine({
    eventsToday, pendingHabits, sleepPending, weekday: new Date().getDay(),
  });

  /* A JANELA DE 3 A 6 DIAS. Abaixo do sétimo dia o ritual não liga, e até
     agora não havia nada: a pessoa voltava para o painel normal, com o selo
     de sequência sumido sem explicação e as barras do dia em zero. O app não
     a culpava, mas também não a recebia — e vínculo é exatamente isto,
     alguém notar que você voltou.

     A frase abre pelo que foi PRESERVADO e não diz quantos dias ela ficou
     fora. Isso não é delicadeza: "conta o que aconteceu" é a gramática da
     cobrança afetuosa (é o que se diz a quem deve explicação), e funciona no
     ritual de 7 dias só porque lá vem colada em "e está tudo bem, a vida
     acontece". Numa linha só não cabe amortecedor. */
  const returnNudge = !returning && gapDays >= 3 && daysRegistered > 0
    ? `Você voltou. Seus ${daysRegistered} ${daysRegistered === 1 ? "dia registrado continua" : "dias registrados continuam"} aqui, com seu recorde e seus planos.`
    : null;

  const zones = useVisibleZones(returnNudge !== null);

  /* O REGISTRAR da barra foca ESTA caixa em vez de abrir uma segunda igual
     dois centímetros ao lado. Ao desmontar, o registro é limpo e a barra
     volta a abrir a folha — quem faz isso é o useProvideCaptureFocus. */
  const captureRef = useRef<HTMLDivElement>(null);
  const focusCapture = useCallback(() => focusCaptureElement(captureRef.current), []);
  useProvideCaptureFocus(focusCapture);
  const [panelForced, setPanelForced] = useState(
    () => localStorage.getItem(`ascend-return-panel-${todayISO()}`) === "1"
  );
  const showReturnRitual = returning && !panelForced;
  const forcePanel = () => {
    try { localStorage.setItem(`ascend-return-panel-${todayISO()}`, "1"); } catch { /* noop */ }
    setPanelForced(true);
  };


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
      {/* CABEÇALHO — fixo, fora do teto de 5.
          Saiu daqui o chip de nível: ele vive no avatar da barra agora, e
          repetir nível na Hoje era a duplicação que esta fase corta. Entrou a
          LINHA DE FOCO DO DIA, uma linha de texto sem card e sem moldura — o
          Briefing travado deixou de ser a única forma de a pessoa ver isso. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold">
            {greet()}{firstName ? `, ${firstName}` : ""}.
          </h1>
          {/* A linha de foco conhece o estado do dia: depois do primeiro
              registro ela para de pedir o que já foi feito e passa a apontar
              para o que ainda perece. A regra está em lib/dailyFocus.ts. */}
          <p className="text-sm text-muted-foreground">{focoDoDia}</p>
          {/* Voltou depois de 3 a 6 dias: uma linha, sem card e sem moldura,
              que abre pelo que foi PRESERVADO e nunca diz quantos dias ela
              ficou fora. Abaixo de 3 dias não há silêncio nenhum — há a folga
              que a própria casa concede de graça, e nomeá-la seria inventar
              uma ausência. Acima de 6 entra o ritual inteiro, que substitui a
              tela e já existe. */}
          {returnNudge && (
            <p className="text-[11px] text-gold-ink mt-0.5">{returnNudge}</p>
          )}
          {streak === 2 && (
            <p className="text-[11px] text-gold-ink mt-0.5">
              Sua primeira sequência começou — e um dia de descanso por semana não a quebra.
            </p>
          )}
        </div>
        {streak >= 2 && (
          <span
            className="shrink-0 flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold-ink"
            title={`${streak} dias ativos seguidos (1 descanso por semana não quebra a sequência)`}
          >
            <Flame className="w-3.5 h-3.5" /> {streak} dias
          </span>
        )}
      </div>

      {/* BLOCO DE CAPTURA — fixo, fora do teto.
          É a ação central do produto e a superfície que ENSINA a frase; não
          disputa espaço com informação. QuickActions vem colado porque também
          é registrar (em um toque), não é zona de leitura.
          O botão REGISTRAR da barra foca ESTA caixa quando a pessoa já está
          aqui, em vez de abrir uma segunda igual dois centímetros ao lado. */}
      <div className="space-y-3">
        <div ref={captureRef}>
          <CaptureBar />
        </div>
        <QuickActions />
      </div>

      {/* AS ZONAS — no máximo MAX_ZONES, e só as que têm conteúdo.
          A ordem e o porquê de cada posição vivem em HOJE_ZONES, acima. */}
      {zones.length > 0 && (
        <div className="space-y-4">
          {zones.map(({ id, Component }) => <Component key={id} />)}
        </div>
      )}
    </div>
  );
}