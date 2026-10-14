// Onboarding "Blueprint da Subida" (Emenda 4 do POSICIONAMENTO.md).
//
// A Emenda 1 condenava fricção de formulário sem payoff; a Emenda 4 (decisão
// de fundador) libera o formato longo COM três condições, todas honradas aqui:
//   (a) cada resposta muda algo que a pessoa VÊ na hora — o painel
//       "Seu retrato" vai se montando (pilar, faixa calórica pela TMB,
//       janela de sono, orçamento de comida);
//   (b) TODO bloco é pulável sem punição — pular vira "premissa que assumi";
//   (c) o resultado final é PROPOSTA confirmável (cards desmarcáveis) —
//       a IA nunca grava sozinha, nem no onboarding.
//
// Estrutura: 7 blocos + geração + a mágica (primeira captura guiada, que
// era o fecho do onboarding antigo e continua sendo o primeiro momento do
// app). onboarded=true é gravado ao fim do bloco 1 (meta): abandono no meio
// nunca tranca a pessoa fora do app.
//
// Custo de IA: UMA chamada Sonnet por conta (cortesia), com unicidade
// garantida no servidor (claim_blueprint) e fallback local por TMB quando a
// função estiver indisponível — o onboarding nunca quebra por IA.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useEntitlements } from "@/hooks/useEntitlements";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/core/Markdown";
import { toast } from "sonner";
import { PILLARS, inferPillarFromGoal, pillarById, type PillarId } from "@/lib/pillars";
import { TRACKERS, activeTrackerSet } from "@/lib/trackers";
import {
  tmbMifflin, tdee, kcalRangeLabel, PLAN_KIND_META,
  retomadaDaLinha, retomadaDaResposta, interpretarAtivacao, resumoDaAtivacao,
  goalKeysFor, itensEfetivos, contaComoRetomada, proximoPassoDaEspera, ESPERA_ENTRE_LEITURAS_MS,
  type BlueprintProposal, type BlueprintPlan, type BlueprintChoices, type Retomada,
  type ActivationResult,
} from "@/lib/blueprint";
import { sleepWindowHours, formatWindowHours, timeForInput } from "@/lib/sleep";
import SleepSchedule from "@/components/core/SleepSchedule";
import CaptureBar from "@/components/core/CaptureBar";
import { readFnError } from "@/lib/fnError";
import {
  Check, Loader2, ArrowRight, ArrowLeft, Sparkles, X, Plus, Eye, Mountain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";

/* Tinta do chip aceso, por pilar. Branco sobre a cor cheia reprovava o mínimo
   AA de 4,5:1 em prosperidade (2,74:1) e em vitalidade — 3,79:1 quando ela era
   coral, 4,04:1 agora que é sálvia, e por pouco continua reprovando. A tinta
   escura da casa resolve os dois (6,71:1 e 4,55:1). Mente é o caso em que
   NENHUMA das duas passa (branco 4,49, tinta 4,10): fica no branco, que é o
   melhor disponível, e o token --mente é que precisa escurecer. */
const CHIP_INK: Record<PillarId, string> = {
  prosperidade: "text-primary-foreground",
  vitalidade: "text-primary-foreground",
  mente: "text-white",
};

const DEFAULT_PRACTICE = "Momento de prática";
const FALLBACK_PILLAR: PillarId = "prosperidade";
const TOTAL_STEPS = 9;
/* Os dois passos para onde a retomada pula. Nomeados porque a retomada salta
   para eles a partir do passo 0 — com o número solto, mudar a ordem dos blocos
   faria uma pessoa que recarregou cair no bloco errado sem nenhum erro. */
const PASSO_DO_BLUEPRINT = 7;
const PASSO_DA_MAGICA = 8;

/** Frase digitada na demo da landing (TryItDemo) — lida uma vez e descartada. */
function consumeLandingPhrase(): string {
  try {
    const v = sessionStorage.getItem("ascende-landing-phrase") ?? "";
    sessionStorage.removeItem("ascende-landing-phrase");
    return v;
  } catch { return ""; }
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, refresh, loading: profileLoading, isError: profileError } = useProfile();
  /* QUANTOS PLANOS A CONTA AGUENTA ATIVOS AO MESMO TEMPO.
     O Blueprint propõe de 2 a 4 planos e vinha com TODOS marcados; o app
     mandava os quatro num insert só e o gatilho `enforce_active_plans_cap`
     derrubava o LOTE INTEIRO (`PLAN_LIMIT_REACHED`, a conta grátis segura 1
     ativo). Resultado: na conta grátis a ativação falhava 100% das vezes —
     nem plano, nem meta, nem compromisso — e o `catch` genérico dizia
     "Tente de novo", que nunca ia funcionar porque o limite é estrutural.
     O clímax do onboarding era um botão que não funcionava.

     Este número é só para EXIBIÇÃO e para marcar as caixas certas; quem
     decide continua sendo o servidor. Por isso o `activate` abaixo não
     confia nele: se vier errado ou desatualizado, a rede de segurança
     (arquivar em vez de derrubar) segura do mesmo jeito. */
  const { data: ent } = useEntitlements();
  const maxActivePlans = Math.max(1, Number(ent?.limits?.max_active_plans ?? 1));
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [landingPhrase] = useState(consumeLandingPhrase);

  // ── Bloco 1: meta ──
  const [goal, setGoal] = useState("");
  const [displayName, setDisplayName] = useState("");
  // `!profileError`: com a leitura falhando o perfil vem null e o nome parece
  // vazio — pedir o nome de novo a quem acabou de informá-lo no cadastro é a
  // mesma decisão-a-partir-de-vazio que a rodada 2 tirou das outras telas.
  const needsName = !profileLoading && !profileError && !(profile?.name ?? "").trim();
  const [inferred, setInferred] = useState<PillarId | null>(null);

  // ── Bloco 2: corpo ──
  const [birthYear, setBirthYear] = useState("");
  const [sex, setSex] = useState("nao_informar");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");

  // ── Bloco 3: rotina física ──
  const [activity, setActivity] = useState("nao_informar");
  const [workoutsWeek, setWorkoutsWeek] = useState("");
  const [conditions, setConditions] = useState<string[]>([]);
  const [conditionInput, setConditionInput] = useState("");

  // ── Bloco 4: sono ── (o SleepSchedule salva sozinho; guardamos o eco)
  const [sleepSaved, setSleepSaved] = useState<number | null>(null);

  // ── Bloco 5: comida & bolso ──
  const [restrictions, setRestrictions] = useState<string[]>([]);
  const [restrictionInput, setRestrictionInput] = useState("");
  const [foodSpend, setFoodSpend] = useState("");
  const [income, setIncome] = useState("");
  const [budget, setBudget] = useState("");

  // ── Bloco 6: batalha (opcional, sensível) ──
  const [battleName, setBattleName] = useState("");
  const [battleCreated, setBattleCreated] = useState<string | null>(null);

  // ── Bloco 7: pilares + trackers ──
  const [pillars, setPillars] = useState<PillarId[]>([]);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});

  // ── Bloco 8: geração ──
  const [generating, setGenerating] = useState(false);
  const [blueprint, setBlueprint] = useState<BlueprintProposal | null>(null);
  const [bpFallback, setBpFallback] = useState(false);
  // Falha RECUPERÁVEL é diferente de Blueprint indisponível. O servidor
  // estorna a cortesia em toda falha de geração (`refund()`), então tentar de
  // novo funciona de verdade — mas a tela tratava tudo como fim de linha e
  // oferecia só um consolo. Prometer "a cortesia não foi consumida" sem dar
  // o botão de tentar é prometer no vazio.
  const [bpRetry, setBpRetry] = useState(false);
  const [plansChecked, setPlansChecked] = useState<boolean[]>([]);
  const [activateGoals, setActivateGoals] = useState(true);
  const [habitsChecked, setHabitsChecked] = useState<boolean[]>([]);
  const [planOpen, setPlanOpen] = useState<BlueprintPlan | null>(null);
  const [activating, setActivating] = useState(false);
  const [activatedPlans, setActivatedPlans] = useState<string[]>([]);
  // Os que não couberam ativos e ficaram guardados em Meus planos.
  const [archivedPlans, setArchivedPlans] = useState<string[]>([]);
  const [activatedGoals, setActivatedGoals] = useState<string[]>([]);
  const [activatedHabits, setActivatedHabits] = useState(0);

  const [captured, setCaptured] = useState(false);

  // ── O retrato que se monta (Emenda 4, condição "a") ──────────
  const numeric = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const tmb = tmbMifflin({
    birthYear: numeric(birthYear), sex: sex === "nao_informar" ? null : sex,
    heightCm: numeric(heightCm), weightKg: numeric(weightKg),
  });
  const gastoDiario = tdee(tmb, activity === "nao_informar" ? null : activity);
  const kcalLabel = kcalRangeLabel(gastoDiario ?? tmb);
  const sleepHrs = sleepSaved ??
    sleepWindowHours(profile?.sleep_bedtime, profile?.sleep_waketime);
  const portrait: { label: string; value: string }[] = useMemo(() => {
    const out: { label: string; value: string }[] = [];
    const pillarMeta = inferred ? pillarById(inferred) : null;
    if (goal.trim()) out.push({ label: "Meta", value: goal.trim().slice(0, 60) });
    if (pillarMeta) out.push({ label: "Ponto de partida", value: pillarMeta.name });
    if (kcalLabel) out.push({ label: "Seu gasto energético", value: kcalLabel });
    if (workoutsWeek !== "" && Number(workoutsWeek) >= 0) out.push({ label: "Treinos hoje", value: `${Math.round(Number(workoutsWeek))}x/semana` });
    if (sleepHrs) out.push({ label: "Janela de sono", value: formatWindowHours(sleepHrs) });
    if (numeric(foodSpend)) out.push({ label: "Comida/mês", value: brl(Number(numeric(foodSpend))) });
    if (battleCreated) out.push({ label: "Batalha", value: battleCreated });
    return out;
  }, [goal, inferred, kcalLabel, workoutsWeek, sleepHrs, foodSpend, battleCreated]);

  // Trackers ativos segundo as escolhas do bloco 7 (fonte local: o perfil
  // pode não ter recarregado quando o Blueprint é ativado).
  //
  // Na RETOMADA o estado local está vazio — a página recarregou, ou a pessoa
  // voltou pelos Primeiros passos dias depois —, e a escolha dela já está
  // salva no perfil. Aí a fonte é o perfil, pela mesma regra do resto do app.
  // Sem isto, quem recarregava via "nenhuma meta para as áreas que você
  // acompanha" e perdia as metas da proposta.
  const activeTrackers = useMemo(() => {
    if (!pillars.length) return activeTrackerSet(profile) as Set<string>;
    const set = new Set<string>();
    for (const t of TRACKERS) {
      if (!pillars.includes(t.pillar)) continue;
      if (prefs[t.id] === false) continue;
      set.add(t.id);
    }
    return set;
  }, [pillars, prefs, profile]);

  const patchProfile = async (patch: Record<string, unknown>) => {
    if (!user) return false;
    const { error } = await supabase.from("profiles").update(patch).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar. Tente de novo."); return false; }
    toast.dismiss("Não consegui salvar. Tente de novo.");
    return true;
  };

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  // Bloco 1 → 2: a meta revela o pilar; onboarded=true JÁ AQUI (abandono
  // no meio nunca tranca a pessoa fora do app).
  const finishGoal = async (skip = false) => {
    if (!user) return;
    setSaving(true);
    try {
      const fromGoal = skip ? null : inferPillarFromGoal(goal);
      setInferred(fromGoal ?? FALLBACK_PILLAR);
      const startPillars = [fromGoal ?? FALLBACK_PILLAR];
      setPillars(startPillars);
      const patch: Record<string, unknown> = {
        goal: skip ? null : (goal.trim() || null),
        pillars: startPillars,
        onboarded: true,
      };
      if (needsName && displayName.trim()) patch.name = displayName.trim().slice(0, 80);
      const ok = await patchProfile(patch);
      if (!ok) return;
      qc.setQueryData(["profile", user.id], (old: typeof profile) =>
        old ? { ...old, ...patch } : old);
      refresh();
      next();
    } finally { setSaving(false); }
  };

  // Bloco 2 → 3: corpo (peso vira life_event, regra do app: registro real)
  const finishBody = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const by = numeric(birthYear);
      const h = numeric(heightCm);
      const w = numeric(weightKg);
      const patch: Record<string, unknown> = {};
      if (by && by > 1900 && by <= new Date().getFullYear()) patch.birth_year = Math.round(by);
      if (sex !== "nao_informar") patch.sex = sex;
      if (h && h > 80 && h < 250) patch.height_cm = h;
      if (Object.keys(patch).length && !(await patchProfile(patch))) return;
      if (w && w > 20 && w < 400) {
        await supabase.from("life_events").insert({
          // O pilar da linha é derivado do `kind` (canonicalPillar, no
          // servidor): peso é Vitalidade desde a fusão de 17/09/2026.
          user_id: user.id, pillar: "vitalidade", kind: "weight",
          payload: { kg: w, summary: `Peso: ${String(w).replace(".", ",")} kg` }, source: "form",
        });
      }
      refresh();
      next();
    } finally { setSaving(false); }
  };

  // Bloco 3 → 4: rotina física
  const finishActivity = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (activity !== "nao_informar") patch.activity_level = activity;
      const w = Math.round(Number(workoutsWeek));
      if (workoutsWeek !== "" && w >= 0 && w <= 14) patch.est_workouts_week = w;
      if (conditions.length) patch.health_conditions = conditions;
      if (Object.keys(patch).length && !(await patchProfile(patch))) return;
      refresh();
      next();
    } finally { setSaving(false); }
  };

  // Bloco 5 → 6: comida & bolso
  const finishFood = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (restrictions.length) patch.dietary_restrictions = restrictions;
      const fs = numeric(foodSpend); if (fs && fs > 0) patch.est_food_spend = fs;
      const inc = numeric(income); if (inc && inc > 0) patch.monthly_income = inc;
      const bud = numeric(budget); if (bud && bud > 0) patch.monthly_budget = bud;
      if (Object.keys(patch).length && !(await patchProfile(patch))) return;
      refresh();
      next();
    } finally { setSaving(false); }
  };

  // Bloco 6 → 7: batalha opcional
  const finishBattle = async () => {
    if (!user) { next(); return; }
    const name = battleName.trim().slice(0, 80);
    if (!name) { next(); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("battles").insert({ user_id: user.id, name });
      if (error) { toast.error("Não consegui criar a batalha agora — dá para criar depois, em Batalhas."); }
      // A batalha entra no resumo do Blueprint (`battleCreated`): é ali que a
      // pessoa vê que deu certo, sem um toast por cima repetindo.
      else {
        toast.dismiss("Não consegui criar a batalha agora — dá para criar depois, em Batalhas.");
        setBattleCreated(name);
      }
      next();
    } finally { setSaving(false); }
  };

  const togglePillar = (id: PillarId, on: boolean) =>
    setPillars((p) => (on ? [...new Set([...p, id])] : p.filter((x) => x !== id)));

  // Sugestão honesta de pilares: o que a pessoa PREENCHEU acende.
  const suggestPillars = () => {
    setPillars((cur) => {
      const s = new Set<PillarId>(cur);
      /* Uma auto-ativação só, e é o que conserta o empate antigo: "quero
         emagrecer comendo melhor" acendia Vitalidade por acidente de ordem do
         array. Agora comida e corpo são o mesmo pilar, e o empate some. */
      if (tmb || workoutsWeek !== "" || sleepHrs || numeric(foodSpend) || restrictions.length) s.add("vitalidade");
      if (numeric(income) || numeric(budget)) s.add("prosperidade");
      return [...s];
    });
  };

  // Bloco 7 → 8: pilares + trackers
  const finishTrackers = async () => {
    if (!pillars.length) { toast.error("Escolha pelo menos um pilar para começar."); return; }
    toast.dismiss("Escolha pelo menos um pilar para começar.");
    setSaving(true);
    try {
      const withMente = pillars.includes("mente");
      const cleanPrefs: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prefs)) if (v === false) cleanPrefs[k] = false;
      const ok = await patchProfile({
        pillars,
        tracking_prefs: cleanPrefs,
        ...(withMente && !profile?.spirituality_label ? { spirituality_label: DEFAULT_PRACTICE } : {}),
      });
      if (!ok) return;
      refresh();
      next();
      generate(); // a geração começa sozinha: a tela 8 é o clímax, não um botão
    } finally { setSaving(false); }
  };

  /* ═══ O BLUEPRINT GUARDADO ═══════════════════════════════════════════════
     A proposta não vive mais só nesta tela. Antes ela ficava em `useState`:
     recarregar a página depois de gerar (ou o iPhone matar a aba em segundo
     plano) perdia a proposta E a cortesia — a função passava a responder
     `409 already` para sempre, e a pessoa perdia a única vez em que a IA
     escreve um plano sobre a vida dela.

     Agora a função grava a proposta em `blueprint_proposals` ANTES de
     responder, e esta tela só lê. O que cada estado da linha significa é
     decidido em lib/blueprint.ts (`retomadaDaLinha`), com teste — aqui só se
     desenha. Contrato: scratchpad/blueprint/PLANO.md. */

  /** As escolhas como o banco as tem da última vez que salvamos — `null`
   *  quando ainda é preciso salvar (proposta nova, ou escolhas completadas). */
  const ultimaSalva = useRef<string | null>(null);
  /** Desde quando a tela espera outra aba terminar de gerar (`null`: não espera). */
  const [esperandoDesde, setEsperandoDesde] = useState<number | null>(null);
  /** A proposta já foi ativada: as escolhas deixam de ser salvas. */
  const [bpAtivado, setBpAtivado] = useState(false);
  /** A última tentativa de ativar falhou — dito na tela, ao lado do botão. */
  const [ativacaoFalhou, setAtivacaoFalhou] = useState(false);

  const escolhas: BlueprintChoices = useMemo(
    () => ({ plans: plansChecked, habits: habitsChecked, goals: activateGoals }),
    [plansChecked, habitsChecked, activateGoals],
  );

  const aplicarResumo = (r: ActivationResult) => {
    const resumo = resumoDaAtivacao(r);
    setActivatedPlans(resumo.planosAtivos);
    setArchivedPlans(resumo.planosGuardados);
    setActivatedGoals(resumo.metas);
    setActivatedHabits(resumo.habitos);
    return resumo;
  };

  /** Quando a pessoa não consegue ler a própria proposta, isso vira medida
   *  (falhas de recuperação) — e nunca trava a tela: a falha de registrar a
   *  falha é só um log. */
  const reportarFalha = (motivo: string) => {
    void supabase.rpc("report_blueprint_resume_failure", { p_reason: motivo.slice(0, 120) })
      .then(({ error }) => { if (error) console.error("report_blueprint_resume_failure", error.message); });
  };

  /** Põe na tela o que a linha (ou a resposta da função) diz. Devolve se havia
   *  algo a mostrar. */
  const hidratar = (r: Retomada): boolean => {
    if (r.kind === "nenhuma" || r.kind === "invalida") return false;
    setBpFallback(false);
    setBpRetry(false);
    if (r.kind === "gerando") {
      // Outra aba (ou esta, antes de recarregar) está gerando. NÃO se gera de
      // novo: a tela espera a linha ficar pronta.
      setBlueprint(null);
      setGenerating(true);
      setEsperandoDesde((d) => d ?? Date.now());
      return true;
    }
    setGenerating(false);
    setEsperandoDesde(null);
    if (r.kind === "ativada") {
      if (r.proposal) setBlueprint(r.proposal);
      aplicarResumo(r.result);
      setBpAtivado(true);
      return true;
    }
    setBlueprint(r.proposal);
    setPlansChecked(r.choices.plans);
    setHabitsChecked(r.choices.habits);
    setActivateGoals(r.choices.goals);
    // Escolhas intactas já estão no banco: hidratar não regrava. Completadas
    // aqui (cota da conta, linha recém-gerada): o efeito abaixo salva.
    ultimaSalva.current = r.escolhasIntactas ? JSON.stringify(r.choices) : null;
    return true;
  };
  // As funções acima mudam a cada render; os efeitos leem sempre a atual.
  const hidratarRef = useRef(hidratar);
  hidratarRef.current = hidratar;

  /* A RETOMADA VIRA MEDIDA. A métrica de "falhou e não voltou" precisa saber
     que a pessoa VOLTOU — e a volta de verdade não passa pela função (que
     grava o próprio `resumed`): é esta tela lendo a linha. Uma vez por
     montagem; o servidor ainda segura a 1 evento a cada 30 min por pessoa,
     para recarregar não inflar a conta. Falhar aqui é só log. */
  const retomadaRegistrada = useRef(false);
  const registrarRetomada = (r: Retomada) => {
    if (retomadaRegistrada.current || !contaComoRetomada(r)) return;
    retomadaRegistrada.current = true;
    void supabase.rpc("report_blueprint_resumed")
      .then(({ error }) => { if (error) console.error("report_blueprint_resumed", error.message); });
  };
  const registrarRetomadaRef = useRef(registrarRetomada);
  registrarRetomadaRef.current = registrarRetomada;

  const lerMinhaLinha = async () =>
    supabase.from("blueprint_proposals")
      .select("status, proposal, choices, choices_updated_at, activation_result")
      .eq("user_id", user!.id)
      .maybeSingle();

  /* ── AO MONTAR: a proposta guardada, se houver ───────────────────────
     Recarregar no passo do Blueprint volta à MESMA proposta e às MESMAS
     escolhas, sem nova chamada ao modelo — mesmo com o `step` voltando a 0.
     E é por aqui que se volta pelos Primeiros passos, dias depois. */
  const leuAoMontar = useRef(false);
  useEffect(() => {
    if (!user || leuAoMontar.current) return;
    leuAoMontar.current = true;
    void (async () => {
      const { data, error } = await lerMinhaLinha();
      if (error) { reportarFalha(`leitura_falhou:${error.code ?? "rede"}`); return; }
      const r = retomadaDaLinha(data, maxActivePlans);
      if (r.kind === "invalida") { reportarFalha(r.motivo); return; }
      if (!hidratarRef.current(r)) return;
      registrarRetomada(r);
      setStep(r.kind === "ativada" ? PASSO_DA_MAGICA : PASSO_DO_BLUEPRINT);
    })();
    // `lerMinhaLinha` e `reportarFalha` só leem `user`, que está nas deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, maxActivePlans]);

  // ── Geração do Blueprint (1 chamada Sonnet por conta, cortesia) ──
  //
  // A função decide pelo estado da linha: `ready` devolve a proposta guardada
  // SEM chamar o modelo; `activated` devolve o resumo; `generating` responde
  // que outra aba está gerando. Só sem linha ela gera de verdade.
  const generate = async () => {
    setGenerating(true);
    setBpFallback(false);
    setBpRetry(false);
    try {
      const { data, error } = await supabase.functions.invoke("onboarding-blueprint", { body: {} });
      if (error) {
        const body = await readFnError(error);
        // Legado: gerado antes desta mudança, quando a proposta ainda não era
        // guardada — ela se perdeu e não há como recuperá-la.
        if (body?.already) { setBpFallback(true); setGenerating(false); return; }
        // O servidor distingue "não deu certo agora, a cortesia voltou" de
        // "o Blueprint está desligado". Só o primeiro vale um botão de
        // tentar — no segundo, tentar de novo é enganar a pessoa.
        if (body?.recoverable) { setBpRetry(true); setGenerating(false); return; }
        throw new Error(typeof body?.error === "string" ? body.error : "erro");
      }
      if (data?.error) throw new Error(String(data.error));
      const r = retomadaDaResposta(data, maxActivePlans);
      if (r.kind === "invalida") reportarFalha(r.motivo);
      if (!hidratar(r)) throw new Error("erro");
      if (r.kind === "ativada") next();
    } catch {
      // Fallback local honesto (Emenda 4: o onboarding nunca quebra por IA):
      // a TMB já dá o retrato; o plano completo fica com o Conselheiro.
      setBpFallback(true);
      setGenerating(false);
    }
  };
  const generateRef = useRef(generate);
  generateRef.current = generate;

  /* ── ESPERANDO OUTRA ABA ─────────────────────────────────────────────
     Relê a linha a cada ~2 s. Com teto: passado ele, chama a função de novo,
     e ELA decide — se a geração da outra aba ainda é recente, responde
     "gerando" e a espera recomeça; se envelheceu (a função morreu no meio),
     reivindica e gera. A tela nunca chama o modelo por conta própria. */
  useEffect(() => {
    if (esperandoDesde === null || !user) return;
    let viva = true;
    const timer = setInterval(async () => {
      if (proximoPassoDaEspera(Date.now() - esperandoDesde) === "chamar-a-funcao") {
        clearInterval(timer);
        setEsperandoDesde(null);
        void generateRef.current();
        return;
      }
      const { data, error } = await lerMinhaLinha();
      // Erro de rede no meio da espera não é fim de linha: o próximo tique tenta.
      if (!viva || error) return;
      const r = retomadaDaLinha(data, maxActivePlans);
      if (r.kind === "gerando") return;
      clearInterval(timer);
      setEsperandoDesde(null);
      if (r.kind === "nenhuma") {
        // A linha sumiu: a geração da outra aba falhou, e o servidor desfez a
        // linha e estornou a cortesia. Tentar de novo funciona de verdade.
        setGenerating(false);
        setBpRetry(true);
        return;
      }
      if (r.kind === "invalida") {
        reportarFalha(r.motivo);
        setGenerating(false);
        setBpFallback(true);
        return;
      }
      hidratarRef.current(r);
      registrarRetomadaRef.current(r);
      if (r.kind === "ativada") setStep(PASSO_DA_MAGICA);
    }, ESPERA_ENTRE_LEITURAS_MS);
    return () => { viva = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esperandoDesde, user, maxActivePlans]);

  /* ── AS ESCOLHAS SÃO SALVAS ENQUANTO A PESSOA ESCOLHE ────────────────
     Com uma janela de 400 ms, para um clique-clique-clique virar uma chamada.
     Falhar aqui não trava nada: a ativação manda as escolhas de qualquer jeito
     (`p_choices`), então o pior caso de uma falha é recarregar e ver a última
     escolha salva, não a última feita. Por isso é log, não aviso na tela. */
  useEffect(() => {
    if (!blueprint || bpAtivado || generating) return;
    const json = JSON.stringify(escolhas);
    if (json === ultimaSalva.current) return;
    const timer = setTimeout(async () => {
      const { error } = await supabase.rpc("save_blueprint_choices", { p_choices: escolhas });
      if (error) { console.error("save_blueprint_choices", error.message); return; }
      ultimaSalva.current = json;
    }, 400);
    return () => clearTimeout(timer);
  }, [escolhas, blueprint, bpAtivado, generating]);

  /* ── ATIVAR ───────────────────────────────────────────────────────────
     Antes a tela fazia N inserts um a um, e interromper no meio e tentar de
     novo DUPLICAVA planos e compromissos. Agora é UMA chamada, numa transação
     no servidor: ou aplica tudo, ou nada — e a segunda chamada devolve o que
     a primeira aplicou (`already`) sem gravar de novo. Tentar de novo passou a
     ser seguro, e é por isso que a falha agora oferece tentar.

     A tela manda só as ESCOLHAS e as CHAVES de meta; os valores (o texto dos
     planos, a meta de calorias) o servidor tira da proposta guardada. E a
     regra da cota continua lá: plano que não cabe ativo é GUARDADO como
     arquivado, nunca descartado — e o resumo, que agora vem do servidor, diz
     onde ele foi parar. */
  const nadaParaAtivar = !!blueprint && itensEfetivos(escolhas, blueprint, activeTrackers) === 0;

  const activate = async () => {
    if (!user || !blueprint) return;
    setActivating(true);
    setAtivacaoFalhou(false);
    try {
      const { data, error } = await supabase.rpc("activate_blueprint", {
        p_choices: escolhas,
        p_goal_keys: activateGoals ? goalKeysFor(blueprint, activeTrackers) : [],
      });
      // Erro de transporte e `ok:false` são a mesma coisa para a pessoa: não
      // ativou, nada ficou pela metade, dá para tentar de novo.
      const r = error ? null : interpretarAtivacao(data);
      if (!r || !r.ok) {
        setAtivacaoFalhou(true);
        return;
      }
      // Defesa: a tela não oferece "Ativar" sem nada efetivo, mas se as
      // escolhas mudaram entre o clique e o servidor (outra aba), a resposta
      // é "nada aplicado, a proposta segue guardada" — o mesmo "agora não".
      if (r.nada === true) { explorarPrimeiro(); return; }
      const resumo = aplicarResumo(r.result);
      setBpAtivado(true);
      qc.invalidateQueries();
      refresh();
      toast.success(resumo.frase);
      next();
    } catch {
      setAtivacaoFalhou(true);
    } finally {
      setActivating(false);
    }
  };

  /* "Agora não — quero explorar primeiro": o carimbo `dismissed_at` é só
     medida; a proposta CONTINUA guardada e retomável (Primeiros passos, na
     Hoje). A pessoa não espera a chamada para seguir — dispensar é um gesto,
     e travar a saída esperando a rede seria cobrar pelo "agora não". */
  const explorarPrimeiro = () => {
    void supabase.rpc("dismiss_blueprint")
      .then(({ error }) => { if (error) console.error("dismiss_blueprint", error.message); });
    next();
  };

  const addChip = (
    value: string, list: string[], setList: (v: string[]) => void, clear: () => void,
  ) => {
    const v = value.trim().slice(0, 60);
    if (!v || list.some((x) => x.toLowerCase() === v.toLowerCase()) || list.length >= 15) return;
    setList([...list, v]);
    clear();
  };

  const chipInput = (
    list: string[], setList: (v: string[]) => void,
    value: string, setValue: (v: string) => void, placeholder: string,
    /** id do <Label> que descreve o campo (associação para leitor de tela) */
    inputId?: string,
  ) => (
    <div className="space-y-1.5">
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((r, i) => (
            <span key={`${r}-${i}`} className="inline-flex items-center gap-1.5 text-xs rounded-full border bg-muted/60 px-2.5 py-1 max-w-full">
              <span className="truncate">{r}</span>
              <button type="button" onClick={() => setList(list.filter((_, j) => j !== i))}
                aria-label={`Remover ${r}`} className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input id={inputId} maxLength={60} placeholder={placeholder} className="min-w-0 flex-1"
          value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChip(value, list, setList, () => setValue("")); } }} />
        <Button type="button" size="icon" variant="secondary" className="shrink-0" aria-label="Adicionar à lista"
          onClick={() => addChip(value, list, setList, () => setValue(""))}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // "Onde isso vive agora": prova visível de que TUDO que a pessoa preencheu
  // virou algo no app. Lista só o que foi de fato salvo (nunca promete tela
  // para dado que não existe).
  const savedMap = useMemo(() => {
    const rows: string[] = [];
    if (activatedPlans.length) {
      rows.push(`${activatedPlans.length === 1 ? "Seu plano" : `Seus ${activatedPlans.length} planos`} (${activatedPlans.join(", ")}): Jornada > Planos`);
    }
    if (archivedPlans.length) {
      // Nunca some sem dizer: o plano existe, está inteiro, e a pessoa sabe
      // onde ele mora e o que fazer com ele.
      rows.push(`${archivedPlans.length === 1 ? "1 plano guardado" : `${archivedPlans.length} planos guardados`} (${archivedPlans.join(", ")}): Jornada > Planos, prontos para ativar`);
    }
    if (activatedGoals.length) rows.push(`Metas (${activatedGoals.join(", ")}): tela Hoje`);
    if (activatedHabits > 0) rows.push(`${activatedHabits === 1 ? "Seu compromisso diário" : `Seus ${activatedHabits} compromissos diários`}: tela Hoje`);
    if (sleepHrs) rows.push("Rotina de sono e check-in matinal: tela Hoje e Vitalidade");
    if (numeric(weightKg)) rows.push("Peso registrado: Vitalidade > Meu corpo");
    if (numeric(birthYear) || numeric(heightCm) || sex !== "nao_informar" || activity !== "nao_informar" || restrictions.length) {
      rows.push("Idade, corpo, atividade e restrições: Ajustes > Sobre você");
    }
    if (numeric(income) || numeric(budget) || numeric(foodSpend)) rows.push("Renda, teto e gasto com comida: Ajustes e Prosperidade");
    if (workoutsWeek !== "" || conditions.length) rows.push("Rotina física e condições de saúde: Vitalidade");
    if (battleCreated) rows.push(`Batalha "${battleCreated}": tela Batalhas`);
    rows.push("O que você acompanha: Ajustes > O que você acompanha");
    return rows;
  }, [activatedPlans, archivedPlans, activatedGoals, activatedHabits, sleepHrs, weightKg, birthYear, heightCm,
      sex, activity, restrictions, income, budget, foodSpend, workoutsWeek, conditions, battleCreated]);

  // `min-h-11`: o link media 16px de altura. Ele é o caminho de saída de
  // todo passo do onboarding — e, depois da correção, também a saída de uma
  // TELA DE ERRO, onde a pessoa toca de verdade. Alvo pequeno em rota de
  // fuga é o pior lugar para economizar pixel; o texto continua leve.
  const skipLink = (label: string, onSkip: () => void) => (
    <button className="w-full min-h-11 text-xs text-muted-foreground underline" onClick={onSkip}>
      {label}
    </button>
  );

  const navRow = (onContinue: () => void, disabled = false) => (
    <div className="flex gap-2">
      <Button variant="ghost" onClick={back} aria-label="Voltar"><ArrowLeft className="w-4 h-4" /></Button>
      <Button className="flex-1" disabled={disabled} onClick={onContinue} loading={saving}>
        Continuar <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );

  const steps = [
    // 0 — meta
    <div key="goal" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">O que "subir de nível" significa para você?</h1>
        <p className="text-subhead text-muted-foreground mt-1.5">
          Em uma frase, no seu jeito. Cada resposta daqui em diante monta o seu Blueprint:
          um plano de partida feito só para você, pronto antes de você entrar no app.
        </p>
      </div>
      {needsName && (
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80}
          placeholder="Como você quer ser chamado(a)?" aria-label="Seu nome ou apelido" />
      )}
      <Input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={200}
        aria-label="O que subir de nível significa para você"
        placeholder='Ex.: "Ganhar massa muscular sem estourar o orçamento"' />
      <Button className="w-full" onClick={() => finishGoal(false)} loading={saving}>
        Continuar <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
      {skipLink("Prefiro pular por enquanto", () => finishGoal(true))}
    </div>,

    // 1 — corpo
    <div key="body" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Seu corpo, em números básicos</h1>
        <p className="text-subhead text-muted-foreground mt-1.5">
          Com isso a gente calcula na hora o seu gasto energético — a base do plano
          alimentar. Só o que você quiser contar.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <Label htmlFor="ob-birth-year" className="text-xs">Ano de nascimento</Label>
          <Input id="ob-birth-year" inputMode="numeric" placeholder="1995" maxLength={4} value={birthYear}
            onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ""))} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ob-sex" className="text-xs">Sexo</Label>
          <Select value={sex} onValueChange={setSex}>
            <SelectTrigger id="ob-sex"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="nao_informar">Prefiro não dizer</SelectItem>
              <SelectItem value="feminino">Feminino</SelectItem>
              <SelectItem value="masculino">Masculino</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ob-height" className="text-xs">Altura (cm)</Label>
          <Input id="ob-height" inputMode="numeric" placeholder="172" value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ob-weight" className="text-xs">Peso atual (kg)</Label>
          <Input id="ob-weight" inputMode="decimal" placeholder="78" value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)} />
        </div>
      </div>
      {kcalLabel && (
        <p className="text-sm rounded-lg border border-gold/40 bg-gold/5 p-3 animate-fade-up">
          <Sparkles className="w-4 h-4 text-gold inline mr-1.5 -mt-0.5" />
          Seu gasto energético estimado: <strong>{kcalLabel}</strong>. Isso já entra no seu plano.
        </p>
      )}
      {navRow(finishBody)}
      {skipLink("Pular (o que eu já preenchi fica salvo)", finishBody)}
    </div>,

    // 2 — rotina física
    <div key="activity" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Como está a sua rotina física HOJE?</h1>
        <p className="text-subhead text-muted-foreground mt-1.5">
          Não a meta — o real. Vale chutar honesto: o plano de treino nasce do seu ponto
          de partida, não de um ideal.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ob-activity" className="text-xs">Nível de atividade</Label>
        <Select value={activity} onValueChange={setActivity}>
          <SelectTrigger id="ob-activity"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nao_informar">Não sei dizer</SelectItem>
            <SelectItem value="sedentario">Sedentário</SelectItem>
            <SelectItem value="leve">Leve (1 a 2x/semana)</SelectItem>
            <SelectItem value="moderado">Moderado (3 a 4x/semana)</SelectItem>
            <SelectItem value="intenso">Intenso (5x ou mais)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ob-workouts" className="text-xs">Treinos por semana, hoje (0 se parou)</Label>
        <Input id="ob-workouts" inputMode="numeric" placeholder="Ex.: 3" value={workoutsWeek}
          onChange={(e) => setWorkoutsWeek(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ob-conditions" className="text-xs">Condições de saúde ou lesões (opcional)</Label>
        <p className="text-caption2 text-muted-foreground">O plano respeita o seu corpo. Ex.: "hérnia de disco", "diabetes tipo 2".</p>
        {chipInput(conditions, setConditions, conditionInput, setConditionInput, "Adicionar condição", "ob-conditions")}
      </div>
      {navRow(finishActivity)}
      {skipLink("Pular (o que eu já preenchi fica salvo)", finishActivity)}
    </div>,

    // 3 — sono (o dial estilo iPhone)
    <div key="sleep" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Sua rotina de sono</h1>
        <p className="text-subhead text-muted-foreground mt-1.5">
          Arraste a lua e o sol. Depois, todo dia de manhã, um toque confirma a noite —
          e o Ascende cruza sono com dinheiro, comida e humor (é o que ninguém mais faz).
        </p>
      </div>
      <SleepSchedule compact onSaved={(h) => { setSleepSaved(h); next(); }} />
      {/* Este bloco avança sozinho ao salvar a rotina — mas voltar tem que
          existir aqui como em todos os outros (era o único passo sem saída). */}
      <div className="flex">
        <Button variant="ghost" onClick={back}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
      </div>
      {skipLink("Pular — não quero declarar horários", next)}
    </div>,

    // 4 — comida & bolso
    <div key="food" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Comida e bolso, juntos</h1>
        <p className="text-subhead text-muted-foreground mt-1.5">
          O recurso-símbolo do Ascende é o plano alimentar que cabe no SEU orçamento.
          Para isso, ele precisa conhecer os dois lados.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ob-restrictions" className="text-xs">Restrições alimentares (opcional)</Label>
        {chipInput(restrictions, setRestrictions, restrictionInput, setRestrictionInput, 'Ex.: "vegetariano", "sem lactose"', "ob-restrictions")}
      </div>
      <div className="grid grid-cols-1 gap-2.5">
        <div className="space-y-1">
          <Label htmlFor="ob-food-spend" className="text-xs">Quanto você gasta com comida por mês, mais ou menos? (R$)</Label>
          <p className="text-caption2 text-muted-foreground">Mercado + comida fora. Chute honesto — é premissa, não registro.</p>
          <Input id="ob-food-spend" inputMode="numeric" placeholder="Ex.: 800" value={foodSpend}
            onChange={(e) => setFoodSpend(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <Label htmlFor="ob-income" className="text-xs">Renda mensal (R$)</Label>
            <Input id="ob-income" inputMode="numeric" placeholder="Ex.: 3200" value={income}
              onChange={(e) => setIncome(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ob-budget" className="text-xs">Teto de gastos (R$)</Label>
            <Input id="ob-budget" inputMode="numeric" placeholder="Ex.: 2800" value={budget}
              onChange={(e) => setBudget(e.target.value)} />
          </div>
        </div>
      </div>
      {numeric(foodSpend) && kcalLabel ? (
        <p className="text-sm rounded-lg border border-gold/40 bg-gold/5 p-3 animate-fade-up">
          <Sparkles className="w-4 h-4 text-gold inline mr-1.5 -mt-0.5" />
          Com {brl(Number(numeric(foodSpend)))}/mês e {kcalLabel}, dá para montar um plano
          alimentar viável — o Blueprint mostra a conta.
        </p>
      ) : null}
      {navRow(finishFood)}
      {skipLink("Pular (o que eu já preenchi fica salvo)", finishFood)}
    </div>,

    // 5 — batalha (opcional, tom discreto)
    <div key="battle" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Existe uma batalha que você quer vencer?</h1>
        <p className="text-subhead text-muted-foreground mt-1.5">
          Redes sociais, cigarro, apostas, compras por impulso... Este bloco é opcional e
          totalmente seu: você escolhe depois se o Conselheiro pode ver. Recaída nunca zera sua
          história — o que conta é o acumulado.
        </p>
      </div>
      <Input maxLength={80} placeholder='Ex.: "Apostas" (deixe vazio para pular)'
        aria-label="Nome da batalha que você quer vencer (opcional)"
        value={battleName} onChange={(e) => setBattleName(e.target.value)} />
      {navRow(finishBattle)}
      {skipLink("Pular — batalhas podem ser criadas depois", next)}
    </div>,

    // 6 — pilares + trackers (modularidade total desde a porta)
    <div key="trackers" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">O que você quer acompanhar?</h1>
        <p className="text-subhead text-muted-foreground mt-1.5">
          O Ascende é modular de verdade: você só vê o que escolher. Dá para mudar tudo
          depois em Ajustes — desligar esconde, nunca apaga.
        </p>
      </div>
      <div className="space-y-3">
        {PILLARS.map((p) => {
          const on = pillars.includes(p.id);
          const list = TRACKERS.filter((t) => t.pillar === p.id);
          return (
            <div key={p.id} className={cn("rounded-lg border p-3 space-y-2", on && "border-primary/50 bg-primary/5")}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <p.icon className="w-4 h-4 shrink-0" style={{ color: `hsl(var(${p.colorVar}))` }} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-caption2 text-muted-foreground truncate">{p.desc}</p>
                  </div>
                </div>
                <Switch checked={on} onCheckedChange={(v) => togglePillar(p.id, !!v)}
                  aria-label={`Ativar pilar ${p.name}`} />
              </div>
              {on && list.length > 0 && (
                <div className="flex flex-wrap gap-1.5 animate-fade-up">
                  {list.map((t) => {
                    const active = prefs[t.id] !== false;
                    return (
                      <button key={t.id} type="button"
                        onClick={() => setPrefs((pr) => ({ ...pr, [t.id]: !(pr[t.id] !== false) }))}
                        className={cn(
                          "text-xs rounded-full border px-2.5 py-1 transition-colors",
                          active ? cn("border-transparent", CHIP_INK[p.id]) : "text-muted-foreground hover:bg-muted/60 line-through"
                        )}
                        style={active ? { background: `hsl(var(${p.colorVar}))` } : undefined}
                        aria-pressed={active}>
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button className="text-xs text-muted-foreground underline" onClick={suggestPillars}>
        Sugerir pelos meus dados (acende o que você preencheu)
      </button>
      {navRow(finishTrackers, !pillars.length)}
    </div>,

    // 7 — geração do Blueprint
    <div key="blueprint" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          <Mountain className="w-5 h-5 text-gold" /> Seu Blueprint da Subida
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          {generating
            ? "Montando o seu plano de partida com tudo que você contou..."
            : "Tudo abaixo é PROPOSTA: desmarque o que não quiser. Nada é ativado sem você."}
        </p>
      </div>

      {generating && (
        <div className="rounded-lg border p-6 grid place-items-center" role="status">
          <Loader2 className="w-6 h-6 animate-spin text-gold" aria-hidden />
          <p className="text-xs text-muted-foreground mt-2">Cruzando corpo, comida, sono e bolso...</p>
        </div>
      )}

      {!generating && blueprint && (
        <div className="space-y-2.5 animate-fade-up">
          {blueprint.assumptions.length > 0 && (
            <p className="text-xs text-muted-foreground rounded-md border p-2.5">
              <strong>Premissas que assumi</strong> (blocos pulados):{" "}
              {blueprint.assumptions.join("; ")}.
            </p>
          )}
          {blueprint.overview && (
            <p className="text-subhead text-muted-foreground">{blueprint.overview}</p>
          )}
          {blueprint.plans.map((pl, i) => {
            const meta = PLAN_KIND_META[pl.kind];
            return (
              <label key={pl.kind} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                <Checkbox className="mt-0.5" checked={plansChecked[i]}
                  onCheckedChange={(v) => setPlansChecked((c) => c.map((x, j) => (j === i ? !!v : x)))} />
                <span className="flex-1 min-w-0">
                  <span className="text-caption2 font-semibold uppercase tracking-wider"
                    style={{ color: meta ? `hsl(var(${meta.colorVar}))` : "hsl(var(--gold))" }}>
                    Plano de {meta?.label ?? "vida"}
                  </span>
                  <span className="text-sm font-semibold block">{pl.title}</span>
                  <button type="button" className="text-xs underline underline-offset-2 mt-1 inline-flex items-center gap-1"
                    onClick={(e) => { e.preventDefault(); setPlanOpen(pl); }}>
                    <Eye className="w-3 h-3" /> Ver plano completo
                  </button>
                </span>
              </label>
            );
          })}
          <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
            <Checkbox className="mt-0.5" checked={activateGoals} onCheckedChange={(v) => setActivateGoals(!!v)} />
            <span className="flex-1 min-w-0">
              <span className="text-sm font-semibold block">Metas vivas na tela Hoje</span>
              <span className="text-xs text-muted-foreground block mt-0.5">
                {[
                  blueprint.daily_calories_kcal && activeTrackers.has("meals") ? `${Math.round(blueprint.daily_calories_kcal).toLocaleString("pt-BR")} kcal/dia` : null,
                  blueprint.daily_protein_g && activeTrackers.has("protein") ? `${Math.round(blueprint.daily_protein_g)} g de proteína` : null,
                  blueprint.weekly_workouts && activeTrackers.has("workouts") ? `${Math.round(blueprint.weekly_workouts)} treinos/semana` : null,
                  blueprint.sleep_hours_target && activeTrackers.has("sleep") ? `${String(blueprint.sleep_hours_target).replace(".", ",")}h de sono` : null,
                  blueprint.water_goal_ml && activeTrackers.has("water") ? `${(blueprint.water_goal_ml / 1000).toString().replace(".", ",")}L de água` : null,
                  blueprint.daily_spend_limit && activeTrackers.has("spend_limit") ? `teto de ${brl(blueprint.daily_spend_limit)}/dia` : null,
                ].filter(Boolean).join(" · ") || "nenhuma meta para as áreas que você acompanha"}
              </span>
            </span>
          </label>
          {blueprint.habits.map((h, i) => {
            const meta = pillarById(h.pillar);
            return (
              <label key={i} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                <Checkbox className="mt-0.5" checked={habitsChecked[i]}
                  onCheckedChange={(v) => setHabitsChecked((c) => c.map((x, j) => (j === i ? !!v : x)))} />
                <span className="flex-1 min-w-0">
                  <span className="text-sm block">{h.name}</span>
                  {h.why && <span className="text-xs text-muted-foreground block mt-0.5">{h.why}</span>}
                </span>
                <span className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                  style={{ background: meta ? `hsl(var(${meta.colorVar}))` : "hsl(var(--muted-foreground))" }} aria-hidden />
              </label>
            );
          })}
          {/* A cota dita ANTES do clique, e só quando ela morde de fato.
              Descobrir o limite por um erro depois de escolher é a pior hora
              — e a frase não vende nada: diz o que acontece com o resto. */}
          {plansChecked.filter(Boolean).length > maxActivePlans && (
            <p className="text-xs text-muted-foreground rounded-md border p-2.5">
              Seu plano mantém {maxActivePlans === 1 ? "1 plano ativo" : `${maxActivePlans} planos ativos`} por vez.
              Os outros ficam <strong>guardados em Jornada &gt; Planos</strong>, inteiros — é só
              trocar qual está ativo quando quiser.
            </p>
          )}
          {/* A falha da ativação é dita AQUI, ao lado do botão, e não num aviso
              no topo: o servidor desfez a tentativa inteira, então o mesmo
              botão é o "tentar de novo" — e agora é seguro tentar. */}
          {ativacaoFalhou && (
            <p role="alert" className="text-xs text-destructive rounded-md border border-destructive/40 p-2.5">
              Não consegui ativar agora — e nada ficou pela metade. Dá para tentar de novo.
            </p>
          )}
          {/* Com NADA efetivo marcado, "Ativar" não tem o que ativar — e antes
              consumia a proposta à toa. Desabilitar deixaria um botão morto
              sem dizer por quê; o botão principal passa a ser a saída que a
              escolha já expressa, e o link (agora repetido) sai. */}
          {nadaParaAtivar ? (
            <Button className="w-full min-h-11" variant="outline" onClick={explorarPrimeiro}>
              Agora não — quero explorar primeiro
            </Button>
          ) : (
            <>
              <Button className="w-full min-h-11" onClick={activate} loading={activating}>
                <Check className="w-4 h-4 mr-1.5" />
                {ativacaoFalhou
                  ? "Tentar de novo"
                  : `Ativar ${plansChecked.filter(Boolean).length > 1 ? "meus planos" : "meu plano"}`}
              </Button>
              {skipLink("Agora não — quero explorar primeiro", explorarPrimeiro)}
            </>
          )}
        </div>
      )}

      {/* Deu ruim, mas dá para tentar: a cortesia voltou para a conta. O
          caminho de saída continua existindo ao lado — ninguém fica preso
          num botão de tentar no fim do onboarding. */}
      {!generating && !blueprint && bpRetry && (
        <div className="space-y-3 animate-fade-up">
          <div className="rounded-lg border p-3 space-y-1.5">
            <p className="text-sm font-semibold">Não consegui montar seu plano agora</p>
            <p className="text-xs text-muted-foreground">
              Foi uma falha nossa, e ela não gastou sua cortesia: dá para tentar
              de novo aqui mesmo.
            </p>
          </div>
          <Button className="w-full min-h-11" onClick={generate}>
            Tentar de novo
          </Button>
          {skipLink("Seguir sem o plano — o Conselheiro monta depois", next)}
        </div>
      )}

      {!generating && !blueprint && bpFallback && (
        <div className="space-y-3 animate-fade-up">
          <div className="rounded-lg border p-3 space-y-1.5">
            <p className="text-sm font-semibold">Seu retrato já está pronto</p>
            <p className="text-xs text-muted-foreground">
              {kcalLabel
                ? <>Gasto energético estimado: <strong>{kcalLabel}</strong>{sleepHrs ? <> · janela de sono de <strong>{formatWindowHours(sleepHrs)}</strong></> : null}.</>
                : "Tudo que você contou já está no seu perfil."}
              {" "}O plano completo (alimentação no orçamento + treino + compromissos) o
              Conselheiro monta com você na primeira conversa — ele já conhece tudo isso.
            </p>
          </div>
          <Button className="w-full" onClick={next}>
            Continuar <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

    </div>,

    // 8 — a mágica: primeira captura guiada (o fecho de sempre)
    <div key="capture" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-gold" /> Agora, a mágica
        </h1>
        <p className="text-subhead text-muted-foreground mt-1.5">
          {landingPhrase
            ? "Sua frase da página inicial está aqui — agora é de verdade: a IA separa e registra nos pilares certos."
            : "Conte como foi seu dia até agora, numa frase — a IA separa e registra tudo nos pilares certos. É assim que o Ascende funciona todo dia, em 10 segundos."}
        </p>
      </div>
      <CaptureBar initialText={landingPhrase || undefined} onConfirmed={() => setCaptured(true)} />
      {captured && (
        <p className="text-sm rounded-lg border border-success/40 bg-success/5 p-3 animate-fade-up">
          Primeiro registro feito — sua subida começou. É só isso, todo dia. ✨
        </p>
      )}
      <div className="rounded-lg border p-3 space-y-1.5">
        <p className="text-xs font-semibold">Tudo que você contou já está no app:</p>
        <ul className="text-caption2 text-muted-foreground space-y-1">
          {savedMap.map((row) => (
            <li key={row} className="flex gap-1.5">
              <Check className="w-3 h-3 mt-0.5 shrink-0 text-success" />
              <span>{row}</span>
            </li>
          ))}
        </ul>
      </div>
      <Button className="w-full" onClick={() => navigate("/app", { replace: true })}>
        {captured ? "Começar minha subida" : "Ir para o app"} <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
      {!captured && (
        <button className="w-full text-xs text-muted-foreground underline"
          onClick={() => navigate("/app", { replace: true })}>
          Prefiro explorar primeiro, sem registrar agora
        </button>
      )}
    </div>,
  ];

  return (
    <div className="min-h-dvh grid place-items-center bg-background px-4 py-8">
      <Card className="w-full max-w-md p-6">
        {/* Progresso legível, não só decorativo: 9 traços sem número não dizem
            quanto falta — e a landing prometeu "2 minutos". */}
        <div className="mb-4 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Passo {step + 1} de {TOTAL_STEPS}
          </p>
          <div
            className="flex gap-1"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={TOTAL_STEPS}
            aria-valuenow={step + 1}
            aria-label={`Passo ${step + 1} de ${TOTAL_STEPS}`}
          >
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div key={i} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-gold" : "bg-muted")} />
            ))}
          </div>
        </div>

        {/* Seu retrato: o valor visível de cada resposta (Emenda 4, condição a) */}
        {portrait.length > 0 && step > 0 && step < 7 && (
          <div className="flex flex-wrap gap-1.5 mb-4" aria-label="Seu retrato até agora">
            {portrait.map((f) => (
              <span key={f.label} className="text-caption2 rounded-full border bg-muted/50 px-2 py-0.5">
                <span className="text-muted-foreground">{f.label}:</span> <strong>{f.value}</strong>
              </span>
            ))}
          </div>
        )}

        {steps[step]}
      </Card>

      {/* Plano completo do Blueprint (antes de ativar) */}
      <Dialog open={!!planOpen} onOpenChange={(v) => !v && setPlanOpen(null)}>
        <DialogContent className="max-w-lg max-h-[85dvh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="pr-6 break-words font-display">{planOpen?.title}</DialogTitle>
            <DialogDescription>
              {planOpen ? `Plano de ${PLAN_KIND_META[planOpen.kind]?.label ?? "vida"} · proposta, ainda não ativado` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto text-sm pr-1">
            {planOpen && <Markdown content={planOpen.content_markdown} doc />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}