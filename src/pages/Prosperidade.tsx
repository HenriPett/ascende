// Prosperidade em camadas: estimado → recorrente → real.
// O pilar deixa de ser livro-caixa (só existe o que foi digitado) e passa a
// ter valor no DIA 1: o Raio-X de 60s cria o retrato estimado, os recorrentes
// eliminam o grosso do registro manual, e cada lançamento real REFINA o
// retrato (substitui o estimado, nunca soma — regra max(real, estimativa)).
// Estimativa aparece sempre como estimativa: hachurada no gráfico e declarada
// como premissa na boca do Conselheiro. A honestidade da faixa é a marca.
import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { spParts } from "@/lib/dates";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import GoalInput from "@/components/core/GoalInput";
import FirstTimeTip from "@/components/core/FirstTimeTip";
import ImportStatement from "@/components/core/ImportStatement";
import QueryError from "@/components/core/QueryError";
import Paywall from "@/components/core/Paywall";
import type { PlanLimitError } from "@/lib/fnError";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Trash2, Plus, LineChart as LineChartIcon, Compass, Repeat,
  ArrowRight, ArrowLeft, SlidersHorizontal, Pause, Play, ChevronLeft, ChevronRight,
} from "lucide-react";
import { brl, todayISO } from "@/lib/format";
import {
  CATEGORIES, VARIABLE_CATEGORIES, FIXED_SUGGESTIONS,
  type Tx, type CategoryEstimate, type RecurringTx,
  composeVariableMonth, buildMonthMap, estimatedMonthlyNet,
  buildCalibration, expensesByCategory, cycleKey, cycleRangeLabel, daysSinceCycleStart,
  cycleOccurrenceISO,
  buildInstallmentPlan, installmentSummary, installmentPosition,
  countPastInstallments, groupDeletionLabel, MIN_INSTALLMENTS, MAX_INSTALLMENTS,
  newInstallmentGroupId, projectCycle, cycleTotals, cycleDistance,
  MAX_PROJECTION_CYCLES, type ProjectedTx,
  cycleLengthDays,
} from "@/lib/prosperidade";
import {
  ResponsiveContainer, ComposedChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from "recharts";

const monthLabel = (key: string) =>
  new Date(key + "-02T00:00:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");

const tooltipStyle = {
  background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
  borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))",
} as const;
const brlShort = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")}k` : String(Math.round(v));

const SOURCE_BADGE: Record<string, string | null> = {
  manual: null, capture: "frase", import: "fatura", recurring: "fixo",
};

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* noop */ } };

/* ─────────────────────────────────────────────────────────────────
   Raio-X de 60 segundos: o novo empty state do pilar.
   3 perguntas (renda → fixos → estimativas) e o mês nasce mapeado —
   gráficos e Conselheiro com valor real no primeiro dia, sem um
   único lançamento manual.
────────────────────────────────────────────────────────────────── */
function RaioX({ initialIncome, onDone, onSkip }: {
  /** Renda já declarada (onboarding/Ajustes): entra preenchida — o Raio-X
   *  nunca pergunta de novo o que a pessoa já contou. */
  initialIncome?: number;
  onDone: () => void;
  onSkip: () => void;
}) {
  const { user } = useAuth();
  const { profile, refresh: refreshProfile } = useProfile();
  const qc = useQueryClient();
  // O Raio-X materializa na hora o que acabou de criar, e essa data precisa
  // nascer no CICLO da pessoa — não no mês civil. Ver cycleOccurrenceISO.
  const cycleDay = profile?.financial_cycle_day ?? 1;
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const knownIncome = (initialIncome ?? 0) > 0;
  const [income, setIncome] = useState(knownIncome ? String(initialIncome) : "");
  const [salaryAsRecurring, setSalaryAsRecurring] = useState(true);
  const [fixed, setFixed] = useState<Record<number, string>>({});
  const [variable, setVariable] = useState<Record<string, string>>({});

  const num = (raw: string) => {
    const v = Number(String(raw).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
  };

  const save = async () => {
    if (!user) return;
    const incomeV = num(income);
    const hasFixed = FIXED_SUGGESTIONS.some((_, i) => num(fixed[i] ?? "") > 0);
    const hasVariable = VARIABLE_CATEGORIES.some((c) => num(variable[c] ?? "") > 0);
    if (incomeV <= 0 && !hasFixed && !hasVariable) {
      toast.error("Preencha ao menos a renda ou uma estimativa — pode ser um chute honesto.");
      return;
    }
    toast.dismiss("Preencha ao menos a renda ou uma estimativa — pode ser um chute honesto.");
    setSaving(true);
    try {
      if (incomeV > 0) {
        await supabase.from("profiles").update({ monthly_income: incomeV }).eq("user_id", user.id);
        // Salário como ENTRADA FIXA: vira recorrente de entrada e já entra
        // nas Entradas do mês (senão o saldo nasce negativo e mente).
        if (salaryAsRecurring) {
          const { data: sal } = await supabase.from("recurring_transactions")
            .insert({
              user_id: user.id, kind: "income", amount: incomeV,
              category: "Salário", description: "Salário", day_of_month: 5,
            })
            .select("id,kind,amount,category,description,day_of_month").single();
          if (sal) {
            await supabase.from("transactions").insert({
              user_id: user.id, kind: sal.kind, amount: sal.amount, category: sal.category,
              description: sal.description,
              occurred_at: cycleOccurrenceISO(todayISO(), cycleDay, sal.day_of_month),
              source: "recurring", recurring_id: sal.id,
            });
          }
        }
      }

      // Fixos → recorrentes + materialização do mês corrente na hora
      // (a função ensure_month_recurrences só roda 1x/mês; recorrência
      // criada agora entra agora).
      const recRows = FIXED_SUGGESTIONS
        .map((s, i) => ({ s, v: num(fixed[i] ?? "") }))
        .filter(({ v }) => v > 0)
        .map(({ s, v }) => ({
          user_id: user.id, kind: "expense" as const, amount: v,
          category: s.category, description: s.label, day_of_month: 5,
        }));
      if (recRows.length) {
        const { data: created, error } = await supabase
          .from("recurring_transactions").insert(recRows).select("id,kind,amount,category,description,day_of_month");
        if (error) throw error;
        if (created?.length) {
          await supabase.from("transactions").insert(created.map((r) => ({
            user_id: user.id, kind: r.kind, amount: r.amount, category: r.category,
            description: r.description,
            occurred_at: cycleOccurrenceISO(todayISO(), cycleDay, r.day_of_month),
            source: "recurring", recurring_id: r.id,
          })));
        }
      }

      // Variáveis → estimativas por categoria (premissas, não registros)
      const estRows = VARIABLE_CATEGORIES
        .map((c) => ({ c, v: num(variable[c] ?? "") }))
        .filter(({ v }) => v > 0)
        .map(({ c, v }) => ({ user_id: user.id, category: c, amount: v, updated_at: new Date().toISOString() }));
      if (estRows.length) {
        const { error } = await supabase.from("category_estimates")
          .upsert(estRows, { onConflict: "user_id,category" });
        if (error) throw error;
      }

      toast.success("Mês mapeado! O Conselheiro já enxerga seu orçamento — refine registrando o dia a dia.");
      refreshProfile();
      toast.dismiss("Não consegui salvar o Raio-X. Tente de novo.");
      qc.invalidateQueries();
      onDone();
    } catch {
      toast.error("Não consegui salvar o Raio-X. Tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  const steps = [
    // 0 — renda
    <div key="income" className="space-y-3">
      <p className="text-sm font-medium">
        {knownIncome ? "Sua renda continua essa?" : "Quanto entra por mês, mais ou menos?"}
      </p>
      {knownIncome && (
        <p className="text-xs text-muted-foreground -mt-1.5">
          Você já tinha contado — deixamos preenchido. Ajuste se mudou.
        </p>
      )}
      {/* `min-w-0`: sem ele o campo entra na conta de largura mínima com o
          tamanho intrínseco de um <input> (~20 caracteres), que a 40 pt é
          mais largo que a tela. */}
      <Input className="min-w-0" inputMode="decimal" placeholder="Ex.: 4500" value={income}
        onChange={(e) => setIncome(e.target.value)} aria-label="Renda mensal aproximada (R$)" />
      {/* A caixa tem 17 pt; o alvo é a linha inteira (o <label>), que agora
          garante 44 pt de altura — antes eram 33 (Lince B7). */}
      <label className="flex items-center gap-2 min-h-11 py-1 text-xs text-muted-foreground cursor-pointer">
        <Checkbox checked={salaryAsRecurring} onCheckedChange={(v) => setSalaryAsRecurring(Boolean(v))} />
        Lançar como entrada fixa todo mês (Salário) — desmarque se sua renda variar muito
      </label>
      <p className="text-xs text-muted-foreground">
        Valor aproximado, sem centavos. É a base do "plano que cabe no seu bolso".
      </p>
      <Button className="w-full" onClick={() => setStep(1)}>
        Continuar <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </div>,

    // 1 — fixos
    <div key="fixed" className="space-y-3">
      <p className="text-sm font-medium">O que sai todo mês sem você decidir?</p>
      <p className="text-xs text-muted-foreground -mt-1.5">
        Preencha só os que existem para você. Viram <strong>recorrentes</strong>: cadastra uma vez, nunca mais digita.
      </p>
      {/* Linhas que QUEBRAM com Texto Maior: o campo tem largura fixa em
          rem (cresce junto com a fonte), então rótulo e campo lado a lado
          passavam da tela. No tamanho padrão continuam numa linha só; quando
          não cabem, o campo desce, alinhado à direita, e o rótulo quebra em
          vez de cortar. */}
      <div className="space-y-2">
        {FIXED_SUGGESTIONS.map((s, i) => (
          <div key={s.label} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm flex-1 min-w-[min(6rem,100%)] hyphens-auto [overflow-wrap:break-word]">{s.label}</span>
            <Input className="w-28 max-w-full min-w-0 ml-auto" inputMode="decimal" placeholder="R$"
              value={fixed[i] ?? ""} aria-label={`Valor mensal: ${s.label}`}
              onChange={(e) => setFixed((f) => ({ ...f, [i]: e.target.value }))} />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setStep(0)}><ArrowLeft className="w-4 h-4" /></Button>
        <Button className="flex-1" onClick={() => setStep(2)}>
          Continuar <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>,

    // 2 — variáveis (chute honesto)
    <div key="variable" className="space-y-3">
      <p className="text-sm font-medium">E no resto, quanto vai por mês? Chute com honestidade.</p>
      <p className="text-xs text-muted-foreground -mt-1.5">
        São <strong>estimativas</strong> — aparecem como estimativas nos gráficos e o Conselheiro
        as trata como premissa. Cada registro real refina o número.
      </p>
      <div className="space-y-2">
        {VARIABLE_CATEGORIES.map((c) => (
          <div key={c} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm flex-1 min-w-[min(6rem,100%)] hyphens-auto [overflow-wrap:break-word]">{c}</span>
            <Input className="w-28 max-w-full min-w-0 ml-auto" inputMode="decimal" placeholder="R$"
              value={variable[c] ?? ""} aria-label={`Estimativa mensal: ${c}`}
              onChange={(e) => setVariable((v) => ({ ...v, [c]: e.target.value }))} />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4" /></Button>
        <Button className="flex-1" onClick={save} loading={saving}>
          Mapear meu mês
        </Button>
      </div>
    </div>,
  ];

  return (
    <Card className="p-4 space-y-3 border-prosperidade/40" style={{ borderColor: "hsl(var(--prosperidade) / 0.4)" }}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg grid place-items-center shrink-0"
          style={{ background: "hsl(var(--prosperidade) / 0.12)" }}>
          <Compass className="w-5 h-5" style={{ color: "hsl(var(--prosperidade))" }} />
        </div>
        <div className="flex-1 min-w-0 break-words">
          <h2 className="font-display font-semibold">Raio-X de 60 segundos</h2>
          <p className="text-xs text-muted-foreground">
            3 perguntas e o seu mês nasce mapeado — sem registrar um gasto sequer.
            Nada de centavos: aqui vale o chute honesto.
          </p>
        </div>
      </div>
      <div className="flex gap-1.5" aria-label={`Passo ${step + 1} de 3`}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={i <= step ? "h-1 flex-1 rounded-full bg-gold" : "h-1 flex-1 rounded-full bg-muted"} />
        ))}
      </div>
      {steps[step]}
      {/* Saída do fluxo com alvo de 44 pt — o texto não muda de tamanho. */}
      <button className="w-full min-h-11 inline-flex items-center justify-center text-xs text-muted-foreground underline" onClick={onSkip} disabled={saving}>
        Prefiro registrar do meu jeito, sem o Raio-X
      </button>
    </Card>
  );
}

export default function Prosperidade() {
  /* O Recharts anima em JS, fora do `prefers-reduced-motion` do CSS: com
     movimento reduzido os gráficos nascem prontos, sem crescer do zero. */
  const reduzMovimento = useReducedMotion();
  const { user } = useAuth();
  const { profile, refresh: refreshProfile } = useProfile();
  const qc = useQueryClient();

  // Ciclo financeiro customizável (TODO do fundador): cycleDay ausente/1 é
  // IDÊNTICO ao mês civil de sempre — só quem configura um dia em Ajustes é
  // afetado. `monthKey` local substitui o antigo `iso.slice(0, 7)` cru em
  // TODOS os pontos deste arquivo que bucketizam por mês.
  const cycleDay = profile?.financial_cycle_day ?? 1;
  const monthKey = (iso: string) => cycleKey(iso, cycleDay);

  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Mercado");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  // Compra parcelada (só na aba Gasto). Desligado por padrão: quem não parcelou
  // paga uma olhada e nada mais. `valorMode` diz QUAL dos dois números a pessoa
  // digitou — o outro o app calcula e devolve na linha de resumo, para ela
  // conferir contra a nota. Nunca os dois campos ao mesmo tempo.
  const [parcelado, setParcelado] = useState(false);
  const [parcelas, setParcelas] = useState("");
  const [valorMode, setValorMode] = useState<"parcela" | "total">("total");
  const [limitInfo, setLimitInfo] = useState<PlanLimitError | null>(null);
  // Apagar uma parcela abre duas escolhas explícitas, nenhuma pré-selecionada.
  // As irmãs vêm do BANCO (não da janela de 6 meses carregada na tela): a
  // contagem de "já passaram" precisa ser verdadeira, e a compra pode ter
  // parcelas fora da janela dos gráficos.
  const [groupDel, setGroupDel] = useState<null | {
    tx: Tx; groupId: string; index: number; count: number; past: number;
  }>(null);
  const [raioxSkipped, setRaioxSkipped] = useState(() => lsGet("prosperidade-raiox-skip") === "1");
  const [calibDismissed, setCalibDismissed] = useState(false);

  // Recorrentes: novo cadastro (gasto OU entrada — salário, aluguel recebido...)
  const [recKind, setRecKind] = useState<"expense" | "income">("expense");
  const [recDesc, setRecDesc] = useState("");
  const [recAmount, setRecAmount] = useState("");
  const [recCategory, setRecCategory] = useState("Moradia");
  const [recDay, setRecDay] = useState("5");
  const [recSaving, setRecSaving] = useState(false);

  // Navegação entre meses (cards de resumo + lista de lançamentos).
  // Para trás: até a janela de 6 meses dos gráficos; para frente: até onde
  // houver lançamentos (parcelas futuras importadas da fatura, por exemplo).
  // Inicializa em mês civil (profile ainda não carregou); se a pessoa tiver
  // um ciclo customizado, o efeito abaixo corrige para o ciclo real assim
  // que o perfil chega — só na primeira vez, sem atrapalhar navegação depois.
  const [viewMonth, setViewMonth] = useState(() => todayISO().slice(0, 7));
  const [cycleSynced, setCycleSynced] = useState(false);
  useEffect(() => {
    if (cycleSynced || !profile) return;
    setCycleSynced(true);
    if (cycleDay !== 1) setViewMonth(monthKey(todayISO()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, cycleSynced]);

  // Materialização lazy dos recorrentes: roda no máximo 1x por usuário/mês
  // (a função respeita exclusões: lançamento apagado não "renasce").
  useEffect(() => {
    if (!user) return;
    supabase.rpc("ensure_month_recurrences").then(({ data }) => {
      if (typeof data === "number" && data > 0) {
        qc.invalidateQueries({ queryKey: ["transactions-6m"] });
      }
    });
  }, [user, qc]);

  // Últimos 6 meses (para gráficos) — a lista continua mostrando só o mês atual
  const { data: txs, isLoading, isError: txsError, refetch: refetchTxs, isFetching: txsFetching } = useQuery({
    queryKey: ["transactions-6m", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // 6 meses de janela para os gráficos + 1 de folga: com ciclo financeiro
      // customizado (achado do TODO), o início do ciclo mais antigo pode cair
      // até 27 dias antes do mês civil correspondente.
      const { y, m } = spParts();
      const startM = m - 6 <= 0 ? m + 6 : m - 6;
      const startY = m - 6 <= 0 ? y - 1 : y;
      const startIso = `${startY}-${String(startM).padStart(2, "0")}-01`;
      const { data, error } = await supabase.from("transactions").select("*")
        .eq("user_id", user!.id).gte("occurred_at", startIso)
        .order("occurred_at", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
      // O `error` era descartado aqui, e a falha virava lista vazia — que
      // esta tela lê como "mês em branco" e usa para DECIDIR coisas (ver
      // `loadFailed` abaixo). Propague: vazio por falha não é vazio.
      if (error) throw error;
      return (data ?? []) as Tx[];
    },
  });

  const { data: estimates, isError: estimatesError } = useQuery({
    queryKey: ["category-estimates", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("category_estimates")
        .select("id,category,amount").eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []) as CategoryEstimate[];
    },
  });

  const { data: recurrings, isError: recurringsError } = useQuery({
    queryKey: ["recurring-transactions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("recurring_transactions")
        .select("id,kind,amount,category,description,day_of_month,active")
        .eq("user_id", user!.id).order("amount", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RecurringTx[];
    },
  });

  const monthTxs = (txs ?? []).filter((t) => monthKey(t.occurred_at) === viewMonth);
  const spendLimit = Number(profile?.daily_spend_limit) || 0;
  const spentToday = (txs ?? [])
    .filter((t) => t.kind === "expense" && t.occurred_at === todayISO())
    .reduce((s, t) => s + Number(t.amount), 0);
  // Mês CORRENTE (Mapa do mês, orçamento, composição): navegação não muda a operação
  const nowKey = monthKey(todayISO());
  const curMonthTxs = (txs ?? []).filter((t) => monthKey(t.occurred_at) === nowKey);
  const curIncome = curMonthTxs.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
  const curExpense = curMonthTxs.filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const budget = Number(profile?.monthly_budget ?? 0);
  const budgetPct = budget > 0 ? Math.min((curExpense / budget) * 100, 100) : null;
  /* A PROJEÇÃO PELO RITMO — é ela que faz o número deixar de ser "jogado".
     Gasto real ÷ dias já corridos do ciclo × dias do ciclo. Usa o ciclo da
     pessoa (`daysSinceCycleStart`), não o mês civil: quem recebe no dia 5
     está no meio do ciclo no dia 20, não no fim do mês.

     Nos primeiros dias a conta é instável por construção (dividir por 1 ou 2
     dias multiplica qualquer compra grande), então ela só aparece a partir do
     terceiro dia — projeção que grita no dia 1 não informa, assusta. */
  const budgetProjection = useMemo(() => {
    if (!budget || curExpense <= 0) return null;
    const hoje = new Date();
    const corridos = daysSinceCycleStart(hoje, cycleDay);
    if (corridos < 3) return null;
    return Math.round((curExpense / corridos) * cycleLengthDays(hoje, cycleDay));
  }, [budget, curExpense, cycleDay]);

  // Navegação: limites e rótulo do mês em foco
  const shiftMonthKey = (key: string, delta: number) => {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return d.toISOString().slice(0, 7);
  };
  const maxTxKey = (txs ?? []).reduce((mx, t) => {
    const k = monthKey(t.occurred_at);
    return k > mx ? k : mx;
  }, nowKey);
  /* Até onde a seta "próximo" anda.
     Duas fronteiras, e vale a mais distante:
     • o último COMPROMISSO REAL (parcelas já registradas — no banco do
       fundador, jan/2028): elas existem e têm que aparecer, mesmo além do
       horizonte de projeção, onde o ciclo mostra só o real;
     • o horizonte de PROJEÇÃO (12 ciclos), para quem tem salário e fixos mas
       nenhuma parcela futura. Sem esta segunda fronteira a seta ficaria presa
       no ciclo corrente e a projeção não existiria para essa pessoa — que é
       justamente a maioria de quem reclamou de "Entradas R$ 0". */
  const maxProjKey = (recurrings ?? []).some((r) => r.active)
    ? shiftMonthKey(nowKey, MAX_PROJECTION_CYCLES) : nowKey;
  const maxNavKey = maxTxKey > maxProjKey ? maxTxKey : maxProjKey;
  // Rótulo do período: nome do mês civil (ciclo padrão) ou a faixa exata do
  // ciclo customizado ("10 ago – 09 set") — já sai com a maiúscula certa.
  const viewMonthLabel = cycleRangeLabel(viewMonth, cycleDay);

  /* ── Ciclos futuros: salário e fixos aparecem, sem virar linha no banco ──
     As parcelas futuras já são linhas reais e já somavam. Faltava o outro lado
     da conta: todo ciclo à frente abria com "Entradas R$ 0" e parecia prejuízo
     puro, porque salário e fixos só existem depois que a materialização mensal
     roda — e ela só roda quando o mês chega.

     A regra mora em src/lib/prosperidade.ts (pura e testada): ciclo corrente
     não recebe projeção, já materializado não projeta, inativo não projeta e
     nada passa de 12 ciclos à frente. Aqui é só desenho.

     NADA DISTO É GRAVADO. Escrever no banco um salário que não caiu contamina
     o retrato que o Conselheiro lê e contraria a regra da casa de que
     histórico é o que a pessoa viveu. Projeção nasce no render e morre nele. */
  const projectedRows = useMemo<ProjectedTx[]>(
    () => projectCycle({
      recurrings: recurrings ?? [], txs: txs ?? [],
      targetCycle: viewMonth, currentCycle: nowKey, cycleDay,
    }),
    [recurrings, txs, viewMonth, nowKey, cycleDay],
  );
  // Os três números do cabeçalho — real + projeção no mesmo total, porque um
  // saldo que ignora o salário é mentira mais cara que uma previsão assumida.
  // `projected` é o gatilho do rótulo "Previsão" que assume a previsão em voz
  // alta: um rótulo cobrindo os três, nunca legenda por número.
  const viewTotals = cycleTotals(monthTxs, projectedRows);
  // Passou dos 12 ciclos: o ciclo mostra só o real. Dizer isso é o que impede
  // a pessoa de ler o R$ 0 como "minha renda acabou" — a mesma confusão que
  // originou o pedido, um ano e meio adiante.
  const beyondProjection = cycleDistance(nowKey, viewMonth) > MAX_PROJECTION_CYCLES &&
    (recurrings ?? []).some((r) => r.active);
  const monthlyIncome = Number(profile?.monthly_income ?? 0);
  const composition = useMemo(
    () => composeVariableMonth(expensesByCategory(txs ?? [], nowKey, cycleDay), estimates ?? []),
    [txs, estimates, nowKey, cycleDay],
  );
  const monthMap = useMemo(
    () => buildMonthMap(monthlyIncome, curIncome, recurrings ?? [], composition),
    [monthlyIncome, curIncome, recurrings, composition],
  );
  // Renda declarada NÃO é o mês mapeado (análise UX: item 1). Quem só contou
  // a renda no onboarding não tem gasto nenhum no mapa — mostrar "sobra para
  // viver = renda inteira" seria mentira, e o Raio-X (o recurso que a landing
  // vende) ficava inalcançável para exatamente essa pessoa. O que destrava o
  // mapa e os gráficos é a CAMADA DE GASTO: fixos, estimativas ou lançamentos.
  const hasSpendingLayer = (estimates ?? []).length > 0 ||
    (recurrings ?? []).length > 0 || (txs ?? []).length > 0;

  // Falhou a leitura? Então NÃO SABEMOS se há camada de gasto — e as duas
  // decisões abaixo dependem disso. Com as três queries falhando, tudo vira
  // lista vazia e a tela concluía "mês em branco": oferecia o Raio-X de
  // onboarding a quem tem oito meses de histórico e ainda mostrava o mês em
  // R$ 0. Onboarding em cima de timeout é o pior estrago possível aqui.
  const loadFailed = txsError || estimatesError || recurringsError;
  const showRaiox = !isLoading && !loadFailed && !hasSpendingLayer && !raioxSkipped;

  // ── Dados dos gráficos ───────────────────────────────────────
  // Ancorado no ciclo corrente (nowKey), não no mês civil cru: com ciclo
  // customizado, os últimos 6 "meses" são os últimos 6 CICLOS.
  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i--) monthKeys.push(shiftMonthKey(nowKey, -i));
  const evolution = monthKeys.map((k) => {
    const ms = (txs ?? []).filter((t) => monthKey(t.occurred_at) === k);
    const inc = ms.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
    const exp = ms.filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
    return { mes: monthLabel(k), key: k, Entradas: inc, Saídas: exp, Saldo: inc - exp };
  });
  const monthsWithData = evolution.filter((m) => m.Entradas > 0 || m.Saídas > 0);

  // Comparativo por categoria: com 2+ meses reais, este mês × anterior;
  // antes disso, real × previsto (a estimativa é o orçamento da categoria).
  const prevKey = monthKeys[monthKeys.length - 2];
  const catTotals = (key: string) => expensesByCategory(txs ?? [], key, cycleDay);
  const curCats = catTotals(nowKey);
  const prevCats = catTotals(prevKey);
  const hasTwoRealMonths = monthsWithData.filter((m) => m.key !== nowKey).length >= 1 &&
    Object.keys(prevCats).length > 0;
  const topCatNames = [...new Set([...Object.keys(curCats), ...Object.keys(prevCats)])]
    .sort((a, b) => (curCats[b] ?? 0) + (prevCats[b] ?? 0) - ((curCats[a] ?? 0) + (prevCats[a] ?? 0)))
    .slice(0, 6);
  const catCompare = topCatNames.map((c) => ({
    categoria: c, "Mês anterior": Math.round(prevCats[c] ?? 0), "Este mês": Math.round(curCats[c] ?? 0),
  }));
  const catVsBudget = composition.slice(0, 6).map((c) => ({
    categoria: c.category, Real: Math.round(c.real), Estimado: Math.round(c.estimatedRemainder),
  }));

  // Projeção: com 3 meses de histórico usa o padrão real; sem histórico usa a
  // base estimada do Raio-X (renda − fixos − variáveis estimados), tracejada
  // e rotulada como estimativa. O gráfico deixa de exigir meses de espera.
  const past = monthsWithData.filter((m) => m.key !== nowKey);
  const basis = past.slice(-3);
  const avgNet = basis.length ? basis.reduce((s, m) => s + m.Saldo, 0) / basis.length : null;
  const estNet = estimatedMonthlyNet(monthlyIncome, recurrings ?? [], estimates ?? []);
  const projNet = avgNet ?? estNet;
  const projFromEstimates = avgNet === null && estNet !== null;
  let acc = 0;
  const projection: { mes: string; Histórico: number | null; Projeção: number | null }[] = [];
  for (const m of evolution) {
    acc += m.Saldo;
    projection.push({ mes: m.mes, Histórico: Math.round(acc), Projeção: null });
  }
  if (projNet !== null && projection.length) {
    projection[projection.length - 1].Projeção = projection[projection.length - 1].Histórico;
    let pAcc = acc;
    for (let i = 1; i <= 6; i++) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i);
      pAcc += projNet;
      projection.push({ mes: monthLabel(d.toISOString().slice(0, 7)), Histórico: null, Projeção: Math.round(pAcc) });
    }
  }

  // Calibração do fechamento: primeiros 7 dias do CICLO (não necessariamente
  // do mês civil), comparando o ciclo anterior (estimado × real). Pergunta,
  // não bronca.
  const { y: spY, m: spM, day: spDay } = spParts();
  const dayOfCycle = daysSinceCycleStart(new Date(spY, spM - 1, spDay), cycleDay);
  const calibKey = `prosperidade-calib-${nowKey}`;
  const calibration = useMemo(
    () => buildCalibration(prevCats, estimates ?? []),
    [prevCats, estimates],
  );
  const showCalibration = dayOfCycle <= 7 && calibration.length > 0 &&
    !calibDismissed && lsGet(calibKey) !== "1" && hasTwoRealMonths;

  const applyCalibration = async (categoryName: string, newAmount: number) => {
    if (!user) return;
    const { error } = await supabase.from("category_estimates")
      .upsert([{ user_id: user.id, category: categoryName, amount: newAmount, updated_at: new Date().toISOString() }],
        { onConflict: "user_id,category" });
    if (error) { toast.error("Não consegui ajustar a estimativa. Tente de novo."); return; }
    toast.dismiss("Não consegui ajustar a estimativa. Tente de novo.");
    // Sem toast: o novo valor aparece na própria linha da estimativa.
    qc.invalidateQueries({ queryKey: ["category-estimates"] });
  };

  const dismissCalibration = () => { lsSet(calibKey, "1"); setCalibDismissed(true); };

  // Self-heal: quem mapeou a renda antes do salário virar entrada fixa
  // (renda declarada, nenhum recorrente de entrada, mês sem entradas reais)
  // ganha o conserto em um toque — senão o saldo do mês nasce negativo.
  const [salaryFixDismissed, setSalaryFixDismissed] = useState(() => lsGet("prosperidade-salary-fix-dismiss") === "1");
  const [salaryFixSaving, setSalaryFixSaving] = useState(false);
  // Só faz sentido depois que o mês está mapeado: sem camada de gasto, quem
  // resolve o salário é o próprio Raio-X (checkbox "lançar como entrada fixa"),
  // e este card viraria só mais um alerta na cara de quem acabou de chegar.
  const needsSalaryFix = !isLoading && !loadFailed && hasSpendingLayer && monthlyIncome > 0 && curIncome === 0 &&
    (recurrings ?? []).every((r) => r.kind !== "income") && !salaryFixDismissed;

  const adoptSalaryRecurring = async () => {
    if (!user) return;
    setSalaryFixSaving(true);
    try {
      const { data: sal, error } = await supabase.from("recurring_transactions")
        .insert({
          user_id: user.id, kind: "income", amount: monthlyIncome,
          category: "Salário", description: "Salário", day_of_month: 5,
        })
        .select("id,kind,amount,category,description,day_of_month").single();
      if (error || !sal) throw error;
      await supabase.from("transactions").insert({
        user_id: user.id, kind: sal.kind, amount: sal.amount, category: sal.category,
        description: sal.description,
        occurred_at: cycleOccurrenceISO(todayISO(), cycleDay, sal.day_of_month),
        source: "recurring", recurring_id: sal.id,
      });
      toast.dismiss("Não consegui criar a entrada fixa. Tente de novo.");
      toast.success("Salário lançado como entrada fixa — cai todo mês, sozinho.");
      qc.invalidateQueries();
    } catch {
      toast.error("Não consegui criar a entrada fixa. Tente de novo.");
    } finally {
      setSalaryFixSaving(false);
    }
  };

  const saveSpendLimitRaw = async (raw: string) => {
    if (!user) return;
    const v = Number(raw.replace(",", "."));
    if (!v || v <= 0) { toast.error("Informe um valor válido em reais, como 80."); return; }
    toast.dismiss("Informe um valor válido em reais, como 80.");
    const { error } = await supabase.from("profiles").update({ daily_spend_limit: v }).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar. Tente de novo."); return; }
    toast.dismiss("Não consegui salvar. Tente de novo.");
    toast.success("Teto de gasto diário salvo. Acompanhe na tela Hoje.");
    refreshProfile();
  };

  /* O ORÇAMENTO PASSA A SER EDITÁVEL ONDE ELE É MOSTRADO.
     A queixa do dono foi "não consigo nem mudar o valor", e ele tinha razão
     na prática mesmo com o campo existindo em Ajustes: lá ele se chamava
     "Teto de gastos" e aqui "Orçamento do mês", com um "Teto de gasto do dia"
     logo acima — três nomes para dois conceitos. Quem procurava "orçamento"
     achava "teto", concluía que era o teto diário que já tinha, e desistia.

     Sem caminho de edição, um número declarado uma vez, meses atrás, vira
     régua: a pessoa não lembra de ter dado aquele valor e não pode corrigi-lo
     de onde o vê. É a diferença entre espelho e cobrança, e ela não está no
     dado — está na ausência do controle ao lado dele. */
  const saveBudgetRaw = async (raw: string) => {
    if (!user) return;
    const v = Number(raw.replace(",", "."));
    if (!v || v <= 0) { toast.error("Informe um valor válido em reais, como 2500."); return; }
    toast.dismiss("Informe um valor válido em reais, como 2500.");
    const { error } = await supabase.from("profiles").update({ monthly_budget: v }).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar. Tente de novo."); return; }
    toast.dismiss("Não consegui salvar. Tente de novo.");
    // Sem toast: o orçamento novo aparece no campo e no saldo do mês.
    refreshProfile();
  };

  // A compra parcelada expandida em N linhas, ao vivo, enquanto a pessoa
  // digita. A regra mora em src/lib/prosperidade.ts (pura e testada) e espelha
  // a do servidor, que faz o mesmo com a fatura importada.
  const isParcelado = kind === "expense" && parcelado;
  const installmentPlan = useMemo(() => {
    if (!isParcelado) return null;
    return buildInstallmentPlan({
      amount: Number(amount.replace(",", ".")),
      count: Number(parcelas),
      mode: valorMode,
      description: description.trim() || category,
      purchaseDate: todayISO(),
    });
  }, [isParcelado, amount, parcelas, valorMode, description, category]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(amount.replace(",", "."));
    if (!user || !v || v <= 0) { toast.error("Informe um valor válido em reais."); return; }
    toast.dismiss("Informe um valor válido em reais.");

    // Parcelada: N linhas de uma vez, ligadas por um group_id. Uma linha por
    // ciclo, cada uma com a data real da parcela — é assim que ela entra no
    // total do ciclo certo e some do seguinte sozinha.
    if (isParcelado) {
      const n = Number(parcelas);
      if (!Number.isInteger(n) || n < MIN_INSTALLMENTS || n > MAX_INSTALLMENTS) {
        toast.error(`Informe o número de parcelas, de ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS}.`);
        return;
      }
      if (!installmentPlan) {
        toast.error("Esse valor não dá para dividir nesse número de parcelas.");
        return;
      }
      toast.dismiss(`Informe o número de parcelas, de ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS}.`);
      toast.dismiss("Esse valor não dá para dividir nesse número de parcelas.");
      const groupId = newInstallmentGroupId();
      setSaving(true);
      const { error } = await supabase.from("transactions").insert(
        installmentPlan.rows.map((r) => ({
          user_id: user.id, kind: "expense" as const, amount: r.amount, category,
          description: r.description, occurred_at: r.occurred_at,
          source: "manual" as const, group_id: groupId,
        })),
      );
      setSaving(false);
      if (error) { toast.error("Não consegui salvar as parcelas. Tente de novo."); return; }
      toast.dismiss("Não consegui salvar as parcelas. Tente de novo.");
      toast.success(`Compra registrada em ${installmentPlan.count} parcelas, uma por mês. +XP`);
      setAmount(""); setDescription(""); setParcelas(""); setParcelado(false); setValorMode("total");
      qc.invalidateQueries();
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("transactions").insert({
      user_id: user.id, kind, amount: v, category,
      description: description.trim() || null, occurred_at: todayISO(), source: "manual",
    });
    setSaving(false);
    if (error) { toast.error("Não consegui salvar. Tente de novo."); return; }
    toast.dismiss("Não consegui salvar. Tente de novo.");
    toast.success(kind === "expense" ? "Gasto registrado. +XP" : "Entrada registrada. +XP");
    setAmount(""); setDescription("");
    qc.invalidateQueries();
  };

  /* Sem toast de sucesso: a linha some da lista, que é a confirmação. Mas o
     erro passou a ser checado — antes a falha era engolida e o toast dizia
     "removido" mesmo quando nada tinha sido apagado. */
  const remove = async (id: string) => {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) { toast.error("Não consegui remover o lançamento. Tente de novo."); return; }
    toast.dismiss("Não consegui remover o lançamento. Tente de novo.");
    qc.invalidateQueries();
  };

  /** Toque em apagar. Linha avulsa some direto, como sempre. Parcela de uma
   *  compra registrada à mão abre as duas escolhas — nunca cascateia sozinho.
   *  Parcelada IMPORTADA antiga não tem group_id: cai no caminho de sempre e
   *  só a linha em foco é apagada (não se inventa vínculo por texto). */
  const askRemove = async (t: Tx) => {
    const groupId = t.group_id;
    if (!groupId) { await remove(t.id); return; }
    const { data, error } = await supabase.from("transactions")
      .select("id,occurred_at").eq("group_id", groupId);
    const rows = (data ?? []) as { id: string; occurred_at: string }[];
    // Falha na busca das irmãs: não dá para perguntar com números honestos, e
    // apagar só a linha em foco é o lado seguro do erro.
    if (error || rows.length <= 1) { await remove(t.id); return; }
    const { index, count } = installmentPosition(rows, t.id);
    setGroupDel({ tx: t, groupId, index, count, past: countPastInstallments(rows, todayISO()) });
  };

  const removeGroup = async () => {
    if (!groupDel) return;
    const { count } = groupDel;
    const { error } = await supabase.from("transactions").delete().eq("group_id", groupDel.groupId);
    setGroupDel(null);
    if (error) { toast.error("Não consegui apagar a compra. Tente de novo."); return; }
    toast.dismiss("Não consegui apagar a compra. Tente de novo.");
    qc.invalidateQueries();
    toast.success(`Compra apagada — ${count} lançamentos.`);
  };

  const addRecurring = async () => {
    if (!user) return;
    const v = Number(recAmount.replace(/\./g, "").replace(",", "."));
    const day = Math.min(28, Math.max(1, Number(recDay) || 5));
    if (!v || v <= 0) { toast.error("Informe o valor do recorrente."); return; }
    toast.dismiss("Informe o valor do recorrente.");
    setRecSaving(true);
    try {
      const { data: created, error } = await supabase.from("recurring_transactions")
        .insert({
          user_id: user.id, kind: recKind, amount: v, category: recCategory,
          description: recDesc.trim() || recCategory, day_of_month: day,
        })
        .select("id,kind,amount,category,description,day_of_month").single();
      if (error || !created) throw error;
      // Materializa o mês corrente na hora (a função mensal só roda 1x/mês).
      await supabase.from("transactions").insert({
        user_id: user.id, kind: created.kind, amount: created.amount, category: created.category,
        description: created.description,
        occurred_at: cycleOccurrenceISO(todayISO(), cycleDay, created.day_of_month),
        source: "recurring", recurring_id: created.id,
      });
      toast.success(recKind === "income"
        ? "Entrada fixa criada — cai todo mês, sozinha."
        : "Recorrente criado — se repete todo mês, sozinho.");
      setRecDesc(""); setRecAmount("");
      toast.dismiss("Não consegui criar o recorrente. Tente de novo.");
      qc.invalidateQueries();
    } catch {
      toast.error("Não consegui criar o recorrente. Tente de novo.");
    } finally {
      setRecSaving(false);
    }
  };

  const toggleRecurring = async (r: RecurringTx) => {
    const { error } = await supabase.from("recurring_transactions")
      .update({ active: !r.active }).eq("id", r.id);
    if (error) { toast.error("Não consegui atualizar o recorrente. Tente de novo."); return; }
    toast.dismiss("Não consegui atualizar o recorrente. Tente de novo.");
    toast.success(r.active ? "Recorrente pausado (não entra nos próximos meses)." : "Recorrente reativado.");
    qc.invalidateQueries({ queryKey: ["recurring-transactions"] });
  };

  const removeRecurring = async (r: RecurringTx) => {
    const { error } = await supabase.from("recurring_transactions").delete().eq("id", r.id);
    if (error) { toast.error("Não consegui excluir o recorrente. Tente de novo."); return; }
    toast.dismiss("Não consegui excluir o recorrente. Tente de novo.");
    toast.success("Recorrente excluído. Lançamentos já feitos permanecem.");
    qc.invalidateQueries();
  };

  const mapTotal = Math.max(1, monthMap.incomeExpected);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / mapTotal) * 100))}%`;

  return (
    <div className="max-w-2xl lg:max-w-5xl mx-auto space-y-4 animate-fade-up [&_:is(h1,h2,h3)]:hyphens-auto [&_:is(h1,h2,h3)]:[overflow-wrap:break-word]">
      {/* Títulos podem quebrar no meio da palavra, e só quando a palavra
        não cabe: com Texto Maior a 40 pt, "Prosperidade" ou "Conselheiro"
        num `text-2xl` passam da largura da tela sozinhos. Hifeniza em
        pt-BR onde o dicionário deixa; senão, quebra onde precisar. No
        tamanho padrão nenhum título chega na borda, então nada muda. */}
      {/* No celular o botão de ação desce para a própria linha, em largura
          total: dividindo a linha com o cabeçalho, sobravam 176px para o h1 e
          a descrição (4 linhas), com espaço morto embaixo do botão. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {/* A cor que IDENTIFICA o pilar não é a que carrega tinta: o
              `--prosperidade` puro dava 2,65:1 sobre o marfim. `text-gold-ink`
              é o mesmo ouro, escurecido até passar (5,09:1). */}
          <h1 className="font-display text-2xl font-semibold text-gold-ink">
            Prosperidade
          </h1>
          <p className="text-sm text-muted-foreground">
            Dica: você também pode registrar gastos escrevendo na tela Hoje — "gastei 30 no almoço".
          </p>
        </div>
        <div className="w-full sm:w-auto [&_button]:w-full sm:[&_button]:w-auto">
          <ImportStatement onImported={() => qc.invalidateQueries()} onPlanLimit={setLimitInfo} />
        </div>
      </div>

      {/* Esta é a tela mais intimidante do app para quem tem o orçamento
          apertado: entra e vê um Raio-X pedindo renda. A dica existe para
          dizer a única frase que destrava — não precisa de número exato. */}
      <FirstTimeTip id="prosperidade" />

      {/* Falha de leitura tem cara própria e vem ANTES de tudo: sem ela, o
          mês em branco parecia real e a tela agia em cima disso. */}
      {loadFailed && (
        <QueryError
          title="Não consegui carregar suas finanças agora."
          detail="Pode ser a conexão — nada foi perdido. Seus lançamentos, fixos e estimativas continuam salvos."
          onRetry={() => refetchTxs()}
          retrying={txsFetching}
        />
      )}

      {/* ── Raio-X de 60s: o empty state que mapeia o mês ─────── */}
      {showRaiox && (
        <RaioX
          initialIncome={monthlyIncome}
          onDone={() => { /* queries já invalidadas dentro do componente */ }}
          onSkip={() => { lsSet("prosperidade-raiox-skip", "1"); setRaioxSkipped(true); }}
        />
      )}
      {!showRaiox && !isLoading && !loadFailed && !hasSpendingLayer && (
        <button
          className="w-full text-left"
          onClick={() => { lsSet("prosperidade-raiox-skip", "0"); setRaioxSkipped(false); }}
        >
          <Card className="p-3 flex items-center gap-2.5 hover:bg-muted/40 transition-colors">
            <Compass className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--prosperidade))" }} />
            <p className="text-subhead">
              {monthlyIncome > 0
                ? (<>Falta o outro lado: <strong>Raio-X de 60 segundos</strong> para mapear o que sai todo mês</>)
                : (<>Fazer o <strong>Raio-X de 60 segundos</strong> e mapear o mês sem registrar nada</>)}
            </p>
          </Card>
        </button>
      )}

      {/* ── Mapa do mês: o gráfico com valor no dia 1 ──────────── */}
      {hasSpendingLayer && monthMap.incomeExpected > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display font-semibold">Mapa do mês</h2>
            {monthMap.hasEstimates && (
              <Badge variant="secondary" className="text-caption2">contém estimativas</Badge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="min-w-0">
              <p className="text-caption2 text-muted-foreground">Entra</p>
              <p className="font-semibold text-success text-footnote sm:text-base tracking-tight">{brl(monthMap.incomeExpected)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-caption2 text-muted-foreground">Comprometido e variáveis</p>
              <p className="font-semibold text-footnote sm:text-base tracking-tight">{brl(monthMap.committed + monthMap.variableExpected)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-caption2 text-muted-foreground">Sobra para viver</p>
              <p className={monthMap.leftover >= 0
                ? "font-semibold text-footnote sm:text-base tracking-tight"
                : "font-semibold text-destructive text-footnote sm:text-base tracking-tight"}>
                {brl(monthMap.leftover)}
              </p>
            </div>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden flex" aria-hidden>
            <div style={{ width: pct(monthMap.committed), background: "hsl(var(--prosperidade))" }} title="Fixos comprometidos" />
            <div style={{ width: pct(monthMap.variableReal), background: "hsl(var(--prosperidade) / 0.55)" }} title="Variáveis (real)" />
            <div style={{
              width: pct(monthMap.variableExpected - monthMap.variableReal),
              background: "repeating-linear-gradient(45deg, hsl(var(--prosperidade) / 0.35), hsl(var(--prosperidade) / 0.35) 4px, transparent 4px, transparent 8px)",
            }} title="Variáveis (estimado)" />
          </div>
          <p className="text-xs text-muted-foreground">
            Fixos {brl(monthMap.committed)} · variáveis {brl(monthMap.variableExpected)}
            {monthMap.hasEstimates && " (a faixa listrada é estimativa — cada registro real refina)"}.
          </p>
        </Card>
      )}

      {/* ── Self-heal: renda declarada sem entrada fixa ────────── */}
      {needsSalaryFix && (
        <Card className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-subhead flex-1">
            Sua renda de <strong>{brl(monthlyIncome)}</strong> está mapeada, mas ainda não entra
            nas <strong>Entradas</strong> do mês — por isso o saldo aparece negativo.
          </p>
          {/* No celular esta linha é uma fila de dois controles, e os dois eram
              `shrink-0`/`nowrap`: com o Texto Maior (raiz 23 pt e 40 pt) o botão
              sozinho passava da largura da tela e a página rolava de lado —
              a mesma classe do achado A1 do Lince no Hoje. Agora a fila
              quebra, e o rótulo do botão quebra dentro dele, com piso de 44 pt.
              No desktop (sm:) continua uma linha só ao lado do texto. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:shrink-0">
            <Button size="sm" onClick={adoptSalaryRecurring} loading={salaryFixSaving}
              className="h-auto coarse:h-auto min-h-9 coarse:min-h-11 whitespace-normal text-left py-2">
              Lançar como entrada fixa
            </Button>
            <button className="min-h-11 text-xs text-muted-foreground underline"
              onClick={() => { lsSet("prosperidade-salary-fix-dismiss", "1"); setSalaryFixDismissed(true); }}>
              Minha renda varia
            </button>
          </div>
        </Card>
      )}

      {/* ── Calibração do fechamento (primeiros dias do mês) ──── */}
      {showCalibration && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" style={{ color: "hsl(var(--prosperidade))" }} />
            <h2 className="font-display font-semibold text-sm">Fechamento do mês: suas estimativas bateram?</h2>
          </div>
          <div className="space-y-2">
            {calibration.map((row) => (
              <div key={row.category} className="flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0 truncate">
                  {row.category}: estimou {brl(row.estimated)}, registrou {brl(row.real)}
                </span>
                <Button size="sm" variant="outline" onClick={() => applyCalibration(row.category, row.suggestion)}>
                  Ajustar para {brl(row.suggestion)}
                </Button>
              </div>
            ))}
          </div>
          <button className="text-xs text-muted-foreground underline" onClick={dismissCalibration}>
            Manter como está — concluir revisão
          </button>
        </Card>
      )}

      {/* Resumo por mês (real) — navegue para ver outros meses, inclusive
          futuros quando houver parcelas importadas da fatura */}
      <div className="flex items-center justify-between -mb-2">
        <Button variant="ghost" size="icon" className="w-8 h-8"
          disabled={viewMonth <= monthKeys[0]}
          onClick={() => setViewMonth((v) => shiftMonthKey(v, -1))}
          aria-label="Mês anterior">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        {/* `min-w-0` + `px-2`: a linha tem 390px num celular e três ocupantes.
            O rótulo encolhe em vez de empurrar, e as duas folgas de 8px
            garantem que o texto nunca encoste no alvo de toque das setas. */}
        <button className="text-sm font-medium disabled:cursor-default min-w-0 min-h-11 px-2 truncate"
          disabled={viewMonth === nowKey}
          onClick={() => setViewMonth(nowKey)}
          title={viewMonth !== nowKey ? "Voltar ao mês atual" : undefined}>
          {viewMonthLabel}
          {viewMonth !== nowKey && (
            <span className="text-xs text-muted-foreground font-normal normal-case"> · voltar ao mês atual</span>
          )}
        </button>
        <Button variant="ghost" size="icon" className="w-8 h-8"
          disabled={viewMonth >= maxNavKey}
          onClick={() => setViewMonth((v) => shiftMonthKey(v, 1))}
          aria-label="Próximo mês">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
      {/* O rótulo do ciclo mora numa LINHA PRÓPRIA, não junto do nome do mês.
          Somado à linha de navegação ele estourava os 390px de um celular:
          "Novembro de 2026 · voltar ao mês atual" + a badge quebrava em duas
          linhas, com "atual" órfã e folga zero até o alvo de toque da seta
          (achado 1 do QA — não acontecia em 768 nem em 1440).

          Aqui embaixo ele ainda faz o trabalho que tinha de fazer: fica
          encostado nos três números que rotula, e um rótulo só cobre os três.
          Legenda por número diria a mesma coisa três vezes e ainda deixaria a
          dúvida de qual deles é previsão — são todos. */}
      {viewTotals.projected && (
        <p className="flex items-center justify-center gap-1.5 flex-wrap text-caption2 text-muted-foreground -mt-1">
          <Badge variant="secondary" className="text-caption2 font-normal">Previsão</Badge>
          inclui salário e fixos que ainda não caíram
        </p>
      )}
      {beyondProjection && (
        <p className="text-caption2 text-muted-foreground text-center -mt-1">
          Sem previsão de renda daqui em diante — este ciclo mostra só o que já está assumido.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2.5">
        <Card className="p-3 min-w-0 overflow-hidden">
          <p className="text-caption2 text-muted-foreground">Entradas</p>
          <p className="font-semibold text-success text-footnote sm:text-base tracking-tight">{brl(viewTotals.income)}</p>
        </Card>
        <Card className="p-3 min-w-0 overflow-hidden">
          <p className="text-caption2 text-muted-foreground">Saídas</p>
          <p className="font-semibold text-destructive text-footnote sm:text-base tracking-tight">{brl(viewTotals.expense)}</p>
        </Card>
        <Card className="p-3 min-w-0 overflow-hidden">
          <p className="text-caption2 text-muted-foreground">Saldo do mês</p>
          <p className="font-semibold text-footnote sm:text-base tracking-tight">{brl(viewTotals.net)}</p>
        </Card>
      </div>

      {/* Teto de gasto do dia */}
      <Card className="p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          {/* Sem teto definido, o título "Teto de gasto do dia" com o número
              sozinho ao lado se lê como se o teto FOSSE aquele valor — mas o
              número é o quanto já saiu hoje. O rótulo tem que dizer o que o
              número é (achado nº 4 do QA). */}
          <p className="text-sm font-medium">
            {spendLimit > 0 ? "Teto de gasto do dia" : "Gasto de hoje"}
          </p>
          <span className="text-sm text-muted-foreground">
            <strong className="text-foreground">{brl(spentToday)}</strong>
            {spendLimit > 0 ? <> / {brl(spendLimit)}</> : <> · sem teto definido</>}
          </span>
        </div>
        {spendLimit > 0 && (
          <>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (spentToday / spendLimit) * 100)}%`, background: "hsl(var(--prosperidade))" }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {spentToday <= spendLimit
                ? `${brl(spendLimit - spentToday)} disponíveis hoje.`
                : `${brl(spentToday - spendLimit)} acima do teto de hoje.`}
            </p>
          </>
        )}
        <GoalInput
          placeholder="Definir teto diário (R$)"
          currentLabel={spendLimit > 0 ? `Teto: ${brl(spendLimit)}/dia` : null}
          onSubmit={(raw) => saveSpendLimitRaw(raw)}
        />
      </Card>

      <p className="text-caption2 text-right -mt-2 px-1">
        <Link className="inline-flex items-center min-h-11 text-muted-foreground underline underline-offset-2 hover:text-foreground"
          to={`/app/conselheiro?q=${encodeURIComponent("Analisa meus gastos recentes: onde estou gastando mais e o que dá para ajustar?")}`}>
          Perguntar ao Conselheiro sobre meus gastos
        </Link>
      </p>

      {/* O ORÇAMENTO DO MÊS. Três defeitos foram corrigidos aqui de uma vez,
          e os três vinham da mesma queixa ("não faz sentido do jeito que
          está, nem consigo mudar o valor, e é um número meio jogado"):

          1. NÃO DAVA PARA MUDAR de onde se vê — agora dá, no mesmo padrão do
             teto diário logo acima.
          2. O NÚMERO NÃO DIZIA NADA. "R$ 1.200 de R$ 2.800" no dia 8 não
             responde a pergunta que a pessoa tem, que é "o mês fecha?". A
             projeção pelo ritmo responde, e usa o gasto real dividido pelos
             dias corridos do ciclo — a mesma aritmética de ciclo do resto da
             tela, não o mês civil.
          3. O TEXTO COBRAVA. "o limite que você definiu" atribui uma intenção
             PRESENTE a uma frase dita meses atrás, sobre um número que a
             pessoa nem lembra de ter dado. Mudar o número é uma resposta tão
             legítima quanto gastar menos, e o texto passa a dizer isso. */}
      {budgetPct !== null && (
        <Card className="p-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Orçamento do mês</span>
            <span>{brl(curExpense)} de {brl(budget)}</span>
          </div>
          <Progress value={budgetPct} />
          {budgetProjection !== null && (
            <p className="text-xs text-muted-foreground">
              {budgetProjection <= budget
                ? <>No ritmo de agora, o mês fecha em <strong className="text-foreground">{brl(budgetProjection)}</strong> — dentro do que você declarou.</>
                : <>No ritmo de agora, o mês fecha em <strong className="text-foreground">{brl(budgetProjection)}</strong>, {brl(budgetProjection - budget)} acima do que você declarou. Mudar o número também é uma resposta.</>}
            </p>
          )}
          <GoalInput
            placeholder="Mudar orçamento do mês (R$)"
            currentLabel={`Declarado: ${brl(budget)}/mês`}
            onSubmit={(raw) => saveBudgetRaw(raw)}
          />
        </Card>
      )}

      {/* ── Gráficos ─────────────────────────────────────────── */}
      <Card className="p-4 space-y-3">
        <h2 className="font-display font-semibold flex items-center gap-1.5">
          <LineChartIcon className="w-4 h-4" style={{ color: "hsl(var(--prosperidade))" }} />
          Sua vida financeira em gráficos
        </h2>

        {loadFailed ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Os gráficos não carregaram. Use "Tentar de novo" no aviso acima.
          </p>
        ) : !hasSpendingLayer ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Faça o Raio-X de 60s acima (ou registre um gasto) e os gráficos ganham vida hoje mesmo.
          </p>
        ) : (
          <Tabs defaultValue="categorias">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="evolucao">Evolução</TabsTrigger>
              <TabsTrigger value="categorias">Categorias</TabsTrigger>
              <TabsTrigger value="projecao">Projeção</TabsTrigger>
            </TabsList>

            <TabsContent value="evolucao" className="mt-3">
              {monthsWithData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  A evolução mostra o histórico REAL, mês a mês — ela cresce com os seus registros.
                  Enquanto isso, as abas Categorias e Projeção já funcionam com suas estimativas.
                </p>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={evolution} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={brlShort} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Area isAnimationActive={!reduzMovimento} type="monotone" dataKey="Entradas" stroke="hsl(var(--success))" fill="hsl(var(--success) / 0.2)" strokeWidth={2} />
                        <Area isAnimationActive={!reduzMovimento} type="monotone" dataKey="Saídas" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive) / 0.15)" strokeWidth={2} />
                        <Line isAnimationActive={!reduzMovimento} type="monotone" dataKey="Saldo" stroke="hsl(var(--prosperidade))" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Entradas, saídas e saldo mês a mês (últimos 6 meses).</p>
                </>
              )}
            </TabsContent>

            <TabsContent value="categorias" className="mt-3">
              {hasTwoRealMonths && catCompare.length > 0 ? (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={catCompare} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="categoria" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={0} angle={-18} height={44} textAnchor="end" />
                        <YAxis tickFormatter={brlShort} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar isAnimationActive={!reduzMovimento} dataKey="Mês anterior" fill="hsl(var(--muted-foreground) / 0.45)" radius={[4, 4, 0, 0]} />
                        <Bar isAnimationActive={!reduzMovimento} dataKey="Este mês" fill="hsl(var(--prosperidade))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Onde o dinheiro foi: este mês contra o anterior, por categoria.</p>
                </>
              ) : catVsBudget.length > 0 ? (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={catVsBudget} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                        <defs>
                          <pattern id="estimadoHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                            <rect width="8" height="8" fill="hsl(var(--prosperidade) / 0.12)" />
                            <line x1="0" y1="0" x2="0" y2="8" stroke="hsl(var(--prosperidade) / 0.5)" strokeWidth="3" />
                          </pattern>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="categoria" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={0} angle={-18} height={44} textAnchor="end" />
                        <YAxis tickFormatter={brlShort} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar isAnimationActive={!reduzMovimento} dataKey="Real" stackId="mes" fill="hsl(var(--prosperidade))" />
                        <Bar isAnimationActive={!reduzMovimento} dataKey="Estimado" stackId="mes" fill="url(#estimadoHatch)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Este mês por categoria: a parte sólida é o que você registrou; a listrada é a
                    sua estimativa ainda não consumida. O real substitui o estimado — nunca soma.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Defina estimativas no Raio-X ou registre gastos com categorias para este gráfico ganhar vida.
                </p>
              )}
            </TabsContent>

            <TabsContent value="projecao" className="mt-3">
              {projNet === null ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Faça o Raio-X de 60 segundos (renda e estimativas) e a projeção nasce hoje —
                  ou registre um mês completo para projetar do seu padrão real.
                </p>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={projection} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={brlShort} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} />
                        <ReferenceLine y={0} stroke="hsl(var(--border))" />
                        <Line isAnimationActive={!reduzMovimento} type="monotone" dataKey="Histórico" stroke="hsl(var(--prosperidade))" strokeWidth={2} dot={false} connectNulls={false} />
                        <Line isAnimationActive={!reduzMovimento} type="monotone" dataKey="Projeção" stroke="hsl(var(--prosperidade))" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {projFromEstimates
                      ? <>Projeção <strong>com base nas suas estimativas do Raio-X</strong> ({projNet >= 0 ? "+" : "−"}{brl(Math.abs(projNet))}/mês). Ela fica mais precisa a cada mês registrado — é uma ilustração, não previsão nem recomendação financeira.</>
                      : <>Saldo acumulado projetado: se o padrão dos últimos meses se mantiver ({projNet >= 0 ? "+" : "−"}{brl(Math.abs(projNet))}/mês em média), este é o caminho. É uma ilustração do seu próprio padrão — não previsão nem recomendação financeira.</>}
                  </p>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </Card>

      {/* ── Recorrentes: cadastra uma vez, repete sozinho ──────── */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Repeat className="w-4 h-4" style={{ color: "hsl(var(--prosperidade))" }} />
          <h2 className="font-display font-semibold">Fixos do mês (recorrentes)</h2>
        </div>
        {(recurrings ?? []).length === 0 && (
          <p className="text-subhead text-muted-foreground">
            Salário, aluguel, contas, assinaturas: cadastre uma vez e o Ascende lança todo mês
            sozinho. É o que mais economiza registro manual.
          </p>
        )}
        <div className="divide-y">
          {(recurrings ?? []).map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className={r.active ? "text-sm truncate" : "text-sm truncate text-muted-foreground line-through"}>
                  {r.description || r.category}
                </p>
                <p className="text-xs text-muted-foreground">{r.category} · todo dia {r.day_of_month}</p>
              </div>
              <span className={r.kind === "income" ? "text-sm font-medium text-success" : "text-sm font-medium"}>
                {r.kind === "income" ? "+" : "−"}{brl(Number(r.amount))}
              </span>
              <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground"
                onClick={() => toggleRecurring(r)} aria-label={r.active ? "Pausar recorrente" : "Reativar recorrente"}>
                {r.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground"
                onClick={() => removeRecurring(r)} aria-label="Excluir recorrente">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Select value={recKind} onValueChange={(v) => {
            const k = v as "expense" | "income";
            setRecKind(k);
            setRecCategory(k === "income" ? "Salário" : "Moradia");
          }}>
            <SelectTrigger aria-label="Tipo do recorrente"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">Gasto</SelectItem>
              <SelectItem value="income">Entrada</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Descrição" value={recDesc} maxLength={80}
            onChange={(e) => setRecDesc(e.target.value)} aria-label="Descrição do recorrente" />
          <Input placeholder="Valor (R$)" inputMode="decimal" value={recAmount}
            onChange={(e) => setRecAmount(e.target.value)} aria-label="Valor do recorrente" />
          <Select value={recCategory} onValueChange={setRecCategory}>
            <SelectTrigger aria-label="Categoria do recorrente"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(recKind === "income"
                ? ["Salário", "Extra", "Outros"]
                : CATEGORIES.filter((c) => c !== "Salário" && c !== "Extra")
              ).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            {/* O campo nasce com "5", então o placeholder nunca aparece e o
                número ficava sem explicação nenhuma na tela — daí a legenda
                abaixo (achado nº 6 do QA). */}
            <Input className="w-16" placeholder="Dia" inputMode="numeric" value={recDay}
              onChange={(e) => setRecDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
              aria-label="Dia do mês em que repete" />
            <Button className="flex-1" onClick={addRecurring} loading={recSaving}
              aria-label="Adicionar lançamento recorrente">
              <Plus className="w-4 h-4" aria-hidden />
            </Button>
          </div>
        </div>
        <p className="text-caption2 text-muted-foreground">
          O número à esquerda do <span aria-hidden>+</span> é o dia do mês em que o
          lançamento repete (1 a 28).
        </p>
      </Card>

      {/* Novo lançamento */}
      <Card className="p-4">
        <form onSubmit={add} className="space-y-3">
          <Tabs value={kind} onValueChange={(v) => {
            setKind(v as typeof kind);
            // Entrada não parcela. Desligar aqui evita o estado fantasma de
            // voltar para Gasto e reencontrar um parcelamento meio preenchido.
            if (v !== "expense") { setParcelado(false); setParcelas(""); setValorMode("total"); }
          }}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="expense">Gasto</TabsTrigger>
              <TabsTrigger value="income">Entrada</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              {/* O rótulo do campo diz QUAL número está sendo digitado. Com
                  "Parcelei" ligado o padrão é o valor TOTAL — é como a pessoa
                  fala da compra ("um celular de R$ 2.000 em 10x"), e é a
                  leitura em que errar custa uma ordem de grandeza: digitar
                  2.000 pensando no total e registrar R$ 20.000 de compromisso
                  é um erro que só aparece no extrato. Quem tem a parcela na
                  mão inverte no link logo abaixo do resumo. */}
              <Label htmlFor="amount">
                {isParcelado ? (valorMode === "total" ? "Valor total (R$)" : "Valor da parcela (R$)") : "Valor (R$)"}
              </Label>
              <Input id="amount" inputMode="decimal" placeholder="0,00" required
                value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">Descrição (opcional)</Label>
            <Input id="desc" maxLength={120} placeholder="Ex.: feira da semana"
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {/* ── Parcelei ─────────────────────────────────────────────
              Uma linha só, abaixo da Descrição, só na aba Gasto. Desligada
              custa uma olhada; ligada abre UM campo (nº de parcelas). O outro
              número o app calcula e devolve no resumo, para conferir contra a
              nota — nunca dois campos digitados para a mesma conta. */}
          {kind === "expense" && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                {/* O rótulo é o alvo: 44px de altura medidos, largura da linha. */}
                <Label htmlFor="parcelei" className="flex-1 flex items-center min-h-11 cursor-pointer font-normal">
                  Parcelei
                </Label>
                <Switch id="parcelei" checked={parcelado} onCheckedChange={(on) => {
                  setParcelado(on);
                  if (!on) { setParcelas(""); setValorMode("total"); }
                }} />
              </div>

              {parcelado && (
                <div className="space-y-2.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="parcelas">Nº de parcelas</Label>
                    <Input id="parcelas" className="min-h-11" inputMode="numeric" placeholder="10"
                      value={parcelas}
                      onChange={(e) => setParcelas(e.target.value.replace(/\D/g, "").slice(0, 2))}
                      aria-describedby={installmentPlan ? "parcelas-resumo" : undefined} />
                  </div>
                  {/* Inverte a conta para quem só tem o total na mão. */}
                  <button type="button" className="text-xs text-muted-foreground underline underline-offset-4 min-h-11 text-left"
                    onClick={() => setValorMode(valorMode === "total" ? "parcela" : "total")}>
                    {valorMode === "total" ? "digitei o valor da parcela" : "digitei o valor total"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* A linha de resumo ao vivo: é ela que impede a surpresa de dez
              lançamentos, nove deles no futuro. Chega ANTES do toque. */}
          {installmentPlan && (
            <p id="parcelas-resumo" aria-live="polite" className="text-xs text-muted-foreground">
              {installmentSummary(installmentPlan, brl, cycleDay)}
            </p>
          )}

          {/* O botão renomeado é o aviso — por isso não há modal de
              confirmação: avisar sem cobrar um toque a mais. */}
          <Button type="submit" className="w-full" loading={saving}>
            <Plus className="w-4 h-4 mr-1" aria-hidden />
            {installmentPlan ? `Registrar ${installmentPlan.count} parcelas` : "Registrar"}
          </Button>
        </form>
      </Card>

      {/* Lista do mês */}
      <Card className="p-4">
        <h2 className="font-display font-semibold mb-3">Lançamentos · {viewMonthLabel}</h2>
        {isLoading && <p role="status" className="text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && !monthTxs.length && !projectedRows.length && (
          <p className="text-subhead text-muted-foreground">
            {/* Um mês passado vazio deixava a pessoa com duas perguntas sem
                resposta ("quebrou?" e "dá para trazer de algum lugar?"). A
                segunda o app já sabe responder: a importação de fatura entra
                com a data original de cada compra. */}
            {viewMonth === nowKey
              ? "Nenhum lançamento ainda. Registre o primeiro acima — ou conte na tela Hoje."
              : "Este mês está sem lançamentos. Se você quiser preencher o passado, a importação de fatura entra com a data original de cada compra."}
          </p>
        )}

        {/* Uma lista só, dois grupos. O subtítulo aparece quando há projeção —
            é ele que separa o que a pessoa JÁ DEVE do que ela ESPERA. Sem
            projeção (ciclo corrente, passado, ou além dos 12 ciclos) a lista é
            a de sempre, sem subtítulo nenhum a explicar. */}
        {!!projectedRows.length && !!monthTxs.length && (
          <p className="text-caption2 font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Já assumido
          </p>
        )}
        <div className="divide-y">
          {monthTxs.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                {/* Título 500 / secundária 400 é a MESMA gramática do grupo
                    "Previsto" logo abaixo. Sem isto os dois grupos marcavam a
                    hierarquia por dispositivos diferentes — o real pela cor, o
                    previsto pelo peso — e a projeção acabava tipografada com
                    mais ênfase que o lançamento que já aconteceu. O que separa
                    os grupos passa a ser só o que deve separá-los: a tinta
                    mutada e a barra tracejada do que ainda não caiu. */}
                <p className="text-sm font-medium truncate">
                  {t.description || t.category}
                  {SOURCE_BADGE[t.source] && (
                    <Badge variant="secondary" className="text-caption2 ml-1.5 align-middle">{SOURCE_BADGE[t.source]}</Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.category} · {new Date(t.occurred_at + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                </p>
              </div>
              <span className={t.kind === "expense" ? "text-sm font-medium text-destructive" : "text-sm font-medium text-success"}>
                {t.kind === "expense" ? "−" : "+"}{brl(Number(t.amount))}
              </span>
              <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground"
                onClick={() => askRemove(t)} aria-label="Excluir lançamento">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>

        {/* Previsto: salário e fixos que ainda não caíram. A legenda mora AQUI,
            no subtítulo, e não repetida em cada linha. A barra tracejada e a
            opacidade dizem o resto sem palavra nenhuma.

            Não abre detalhe e não tem lixeira — o que não existe não se edita.
            Para mudar uma destas linhas, muda-se o recorrente logo acima. */}
        {!!projectedRows.length && (
          <>
            <p className="text-caption2 font-medium text-muted-foreground uppercase tracking-wide mt-3 mb-1">
              Previsto · ainda não caiu
            </p>
            {/* A barra tracejada e a tinta mais fria são o sinal — SEM opacity
                no contêiner.

                `opacity-70` no grupo inteiro era o desenho pedido e derrubava
                a segunda linha (12px) para 3,83:1, abaixo do mínimo de 4,5:1
                (achado 2 do QA). Medido depois: NENHUM alpha que ainda leia
                como "esmaecido" mantém texto de 12-14px acima do mínimo nos
                dois temas — a saída (`text-destructive`) já cai para 2,87:1 a
                70%. Então a diferenciação sai da ESCOLHA DE COR, não do alpha:
                o título desce de `text-foreground` (16,26:1) para
                `text-muted-foreground` (6,50:1) — um degrau visível de
                verdade —, e os valores ficam na mesma tinta das linhas reais.

                A barra era `border-border` com opacity por cima: 1,1:1, um
                enfeite que ninguém enxergava (achado 3). `muted-foreground/75`
                entrega 4,21:1 no escuro e 3,16:1 no claro, ambos acima dos
                3:1 de elemento não textual. */}
            <div className="divide-y border-l-2 border-dashed border-muted-foreground/75 pl-3">
              {projectedRows.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    {/* `font-medium` devolve a hierarquia INTERNA que a
                        correção do achado 2 tirou sem querer: com título e
                        subtítulo na mesma tinta mutada, "Salário" e "Salário ·
                        05 de fev." viraram o mesmo peso visual, e o grupo
                        Previsto passou a ter uma gramática diferente da do
                        grupo real logo acima. A distinção volta pelo PESO, não
                        pela cor — abaixar a cor de novo é reabrir o 3,83:1. */}
                    <p className="text-sm font-medium truncate text-muted-foreground">{r.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.category} · {new Date(r.occurred_at + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                    </p>
                  </div>
                  <span className={r.kind === "expense" ? "text-sm font-medium text-destructive" : "text-sm font-medium text-success"}>
                    {r.kind === "expense" ? "−" : "+"}{brl(Number(r.amount))}
                  </span>
                  {/* Alinha o valor com a coluna das linhas reais, que têm a
                      lixeira ocupando esta largura. */}
                  <span className="w-8 shrink-0" aria-hidden />
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Apagar uma parcela: duas escolhas explícitas, NENHUMA pré-selecionada.
          A contagem de "já passaram" é o que impede a pessoa de apagar ciclos
          fechados achando que limpava só o futuro. */}
      <AlertDialog open={!!groupDel} onOpenChange={(o) => { if (!o) setGroupDel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Esta parcela faz parte de uma compra</AlertDialogTitle>
            <AlertDialogDescription>
              {groupDel?.tx.description || groupDel?.tx.category} — o que você quer apagar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Button variant="outline"
              className="w-full min-h-11 h-auto justify-start whitespace-normal text-left py-2.5"
              onClick={() => { const id = groupDel!.tx.id; setGroupDel(null); remove(id); }}>
              Só esta parcela ({groupDel?.index}/{groupDel?.count})
            </Button>
            <Button variant="outline"
              className="w-full min-h-11 h-auto justify-start whitespace-normal text-left py-2.5 text-destructive"
              onClick={removeGroup}>
              {groupDel ? groupDeletionLabel(groupDel.count, groupDel.past) : ""}
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Não apagar nada</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Paywall contextual: aparece só quando um limite do plano é atingido */}
      <Paywall info={limitInfo} onClose={() => setLimitInfo(null)} />
    </div>
  );
}