import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { LogOut, Loader2, Smartphone, Share, Sun, Moon, Monitor, Plus, X, Brain, Trash2, Download, ShieldAlert, Sparkles, Eye, Upload, FileStack } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { PILLARS, pillarById, type PillarId } from "@/lib/pillars";
import { TRACKERS } from "@/lib/trackers";
import { sleepWindowHours, timeForInput, formatWindowHours } from "@/lib/sleep";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import FirstTimeTip from "@/components/core/FirstTimeTip";
import HealthImport from "@/components/core/HealthImport";
import SourcesAndImports from "@/components/core/SourcesAndImports";
import MemoryControl from "@/components/core/MemoryControl";
import QueryError from "@/components/core/QueryError";
import { useGuides } from "@/hooks/useGuides";
import { useMokariPreference } from "@/hooks/useMokariPreference";
import FeedbackDialog from "@/components/core/FeedbackDialog";
import WhatsappCard from "@/components/core/WhatsappCard";
import { todayISOInSP } from "@/lib/dates";
import { cn } from "@/lib/utils";


const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Claro", icon: Sun },
  { id: "dark", label: "Escuro", icon: Moon },
  { id: "system", label: "Sistema", icon: Monitor },
];

export default function Ajustes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, refresh, isError: profileError, isFetching: profileFetching } = useProfile();
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [income, setIncome] = useState("");
  const [budget, setBudget] = useState("");
  const [cycleDay, setCycleDay] = useState("");
  const [foodSpend, setFoodSpend] = useState("");
  const [spirit, setSpirit] = useState("");
  const [hasReligion, setHasReligion] = useState(true);
  const [birthYear, setBirthYear] = useState("");
  const [sex, setSex] = useState("nao_informar");
  const [heightCm, setHeightCm] = useState("");
  const [activity, setActivity] = useState("nao_informar");
  const [restrictions, setRestrictions] = useState<string[]>([]);
  const [restrictionInput, setRestrictionInput] = useState("");
  const [pillars, setPillars] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? "");
    setGoal(profile.goal ?? "");
    setIncome(profile.monthly_income != null ? String(profile.monthly_income) : "");
    setBudget(profile.monthly_budget != null ? String(profile.monthly_budget) : "");
    setCycleDay(profile.financial_cycle_day != null ? String(profile.financial_cycle_day) : "");
    setFoodSpend(profile.est_food_spend != null ? String(profile.est_food_spend) : "");
    setSpirit(profile.spirituality_label ?? "");
    setHasReligion(profile.has_religion !== false);
    setBirthYear(profile.birth_year ? String(profile.birth_year) : "");
    setSex(profile.sex ?? "nao_informar");
    setHeightCm(profile.height_cm ? String(profile.height_cm) : "");
    setActivity(profile.activity_level ?? "nao_informar");
    setRestrictions(profile.dietary_restrictions ?? []);
    setPillars(profile.pillars ?? []);
  }, [profile]);

  const togglePillar = (id: PillarId, on: boolean) =>
    setPillars((p) => (on ? [...new Set([...p, id])] : p.filter((x) => x !== id)));

  /* ── Alteração não salva, visível (análise UX item 8) ──────────────────
     Metade desta página salva sozinha (tema, trackers, escopos) e a outra
     metade dependia de um botão no MEIO do scroll — com um aviso pedindo
     para a pessoa lembrar dele. Agora o formulário se compara com o perfil
     salvo e, enquanto houver diferença, uma barra fixa acompanha a rolagem:
     o estado deixa de ser invisível e não dá mais para sair sem perceber. */
  const savedSnapshot = useMemo(() => ({
    name: profile?.name ?? "",
    goal: profile?.goal ?? "",
    income: profile?.monthly_income != null ? String(profile.monthly_income) : "",
    budget: profile?.monthly_budget != null ? String(profile.monthly_budget) : "",
    cycleDay: profile?.financial_cycle_day != null ? String(profile.financial_cycle_day) : "",
    foodSpend: profile?.est_food_spend != null ? String(profile.est_food_spend) : "",
    spirit: profile?.spirituality_label ?? "",
    hasReligion: profile?.has_religion !== false,
    birthYear: profile?.birth_year ? String(profile.birth_year) : "",
    sex: profile?.sex ?? "nao_informar",
    heightCm: profile?.height_cm ? String(profile.height_cm) : "",
    activity: profile?.activity_level ?? "nao_informar",
    restrictions: (profile?.dietary_restrictions ?? []).join("|"),
    pillars: [...(profile?.pillars ?? [])].sort().join("|"),
  }), [profile]);

  const dirty = !!profile && (
    name !== savedSnapshot.name ||
    goal !== savedSnapshot.goal ||
    income !== savedSnapshot.income ||
    budget !== savedSnapshot.budget ||
    cycleDay !== savedSnapshot.cycleDay ||
    foodSpend !== savedSnapshot.foodSpend ||
    spirit !== savedSnapshot.spirit ||
    hasReligion !== savedSnapshot.hasReligion ||
    birthYear !== savedSnapshot.birthYear ||
    sex !== savedSnapshot.sex ||
    heightCm !== savedSnapshot.heightCm ||
    activity !== savedSnapshot.activity ||
    restrictions.join("|") !== savedSnapshot.restrictions ||
    [...pillars].sort().join("|") !== savedSnapshot.pillars
  );

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      name: name.trim() || null,
      goal: goal.trim() || null,
      monthly_income: income ? Number(income) : null,
      monthly_budget: budget ? Number(budget) : null,
      financial_cycle_day: cycleDay && Number(cycleDay) >= 1 && Number(cycleDay) <= 28 ? Number(cycleDay) : null,
      est_food_spend: foodSpend ? Number(foodSpend) : null,
      spirituality_label: hasReligion ? (spirit.trim() || null) : null,
      has_religion: hasReligion,
      birth_year: birthYear && Number(birthYear) > 1900 && Number(birthYear) <= new Date().getFullYear() ? Number(birthYear) : null,
      sex: sex === "nao_informar" ? null : sex,
      height_cm: heightCm && Number(heightCm.replace(",", ".")) > 80 ? Number(heightCm.replace(",", ".")) : null,
      activity_level: activity === "nao_informar" ? null : activity,
      dietary_restrictions: restrictions,
      pillars,
    }).eq("user_id", user.id);
    setSaving(false);
    if (error) { toast.error("Não consegui salvar seus ajustes. Tente de novo."); return; }
    toast.success("Ajustes salvos.");
    refresh();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  // ── Privacidade: quais áreas o Conselheiro pode analisar ──────
  const SCOPES: { id: string; label: string }[] = [
    { id: "prosperidade", label: "Prosperidade (finanças)" },
    { id: "vitalidade", label: "Vitalidade (sono e treinos)" },
    { id: "alimentacao", label: "Alimentação (refeições, peso, hidratação)" },
    { id: "mente", label: "Mente & Espírito (humor, práticas, gratidão)" },
    { id: "diario", label: "Diário (trechos das suas anotações)" },
  ];
  const [scopes, setScopes] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const raw = ((profile as unknown as { ai_scopes?: Record<string, boolean> })?.ai_scopes) ?? {};
    const next: Record<string, boolean> = {};
    for (const sc of SCOPES) next[sc.id] = raw[sc.id] !== false;
    setScopes(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  const toggleScope = async (id: string, on: boolean) => {
    if (!user) return;
    const next = { ...scopes, [id]: on };
    setScopes(next);
    const { error } = await supabase.from("profiles").update({ ai_scopes: next }).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar a preferência. Tente de novo."); setScopes(scopes); return; }
    toast.success(on ? "O Conselheiro voltará a considerar essa área." : "O Conselheiro deixará essa área de fora das análises.");
  };

  // ── Modularidade total: o que a pessoa acompanha (trackers) ───
  // Só guarda o que foi DESLIGADO; ausência = ligado. Desligar esconde
  // (telas, briefing, Conselheiro), nunca apaga o histórico.
  const [trackingPrefs, setTrackingPrefs] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setTrackingPrefs((profile?.tracking_prefs as Record<string, boolean>) ?? {});
  }, [profile]);
  const toggleTracker = async (id: string, on: boolean) => {
    if (!user) return;
    const next = { ...trackingPrefs };
    if (on) delete next[id]; else next[id] = false;
    setTrackingPrefs(next);
    const { error } = await supabase.from("profiles").update({ tracking_prefs: next }).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar a preferência. Tente de novo."); setTrackingPrefs(trackingPrefs); return; }
    toast.success(on
      ? "Reativado — tudo volta, com o histórico intacto."
      : "Desligado. Isso some das telas e das análises; nada foi apagado.");
    refresh();
  };

  // ── Exportação de dados (sempre gratuita) ─────────────────────
  const EXPORT_TABLES = [
    "profiles", "life_events", "transactions", "habits", "habit_logs",
    "chat_messages", "briefings", "plans", "battles", "battle_checkins",
    "ai_memories", "xp_log",
  ];
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const download = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };
  const exportJson = async () => {
    if (!user) return;
    setExporting("json");
    try {
      const out: Record<string, unknown[]> = {};
      for (const t of EXPORT_TABLES) {
        const { data, error } = await supabase.from(t).select("*").eq("user_id", user.id).limit(10000);
        if (error) throw error;
        out[t] = data ?? [];
      }
      download(`ascende-dados-${todayISOInSP()}.json`,
        JSON.stringify({ exported_at: new Date().toISOString(), ...out }, null, 2),
        "application/json");
      toast.success("Exportação concluída. O arquivo JSON foi baixado.");
    } catch {
      toast.error("Não consegui exportar agora. Tente de novo.");
    } finally { setExporting(null); }
  };
  const toCsv = (rows: Record<string, unknown>[]) => {
    if (!rows.length) return "";
    const cols = Object.keys(rows[0]);
    const esc = (v: unknown) => {
      const str = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  };
  const exportCsv = async () => {
    if (!user) return;
    setExporting("csv");
    try {
      for (const t of ["life_events", "transactions"]) {
        const { data, error } = await supabase.from(t).select("*").eq("user_id", user.id).limit(10000);
        if (error) throw error;
        download(`ascende-${t}-${todayISOInSP()}.csv`,
          toCsv((data ?? []) as Record<string, unknown>[]), "text/csv");
      }
      toast.success("Exportação concluída. Os arquivos CSV foram baixados.");
    } catch {
      toast.error("Não consegui exportar agora. Tente de novo.");
    } finally { setExporting(null); }
  };

  // ── Exclusão definitiva da conta (sempre gratuita) ────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const deleteAccount = async () => {
    if (deleteText !== "EXCLUIR") return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: { confirm: "EXCLUIR" },
      });
      if (error || data?.error) throw new Error(data?.error ?? "erro");
      toast.success("Conta excluída. Sentiremos sua falta.");
      await supabase.auth.signOut();
      navigate("/", { replace: true });
    } catch {
      toast.error("Não consegui excluir agora. Tente novamente ou fale com o suporte.");
      setDeleting(false);
    }
  };

  // ── Memória do Conselheiro: ver e apagar o que a IA aprendeu ──
  const qc = useQueryClient();
  const { resetAll: resetGuides, disableAll: disableGuides } = useGuides();
  const mokari = useMokariPreference();
  const [clearingMemories, setClearingMemories] = useState(false);
  /* A CONFIRMAÇÃO SAIU DO window.confirm NATIVO.
     Duas coisas estavam erradas, e as duas na mesma tela. (a) "Apagar TUDO"
     em maiúsculas é grito, e esta é uma ação de PRIVACIDADE — um direito da
     pessoa, não um risco do qual ela deva ser dissuadida. O app promete "seus
     dados continuam seus", e a tela que exerce essa promessa era a que mais
     parecia advertência. (b) O diálogo nativo mostra o domínio no título
     ("ascende.app diz:") e rotula os botões como "OK" e "Cancelar" — dois
     rótulos que não dizem o que acontece, justamente onde isso mais importa.
     A exclusão de conta, logo abaixo nesta página, já usava um diálogo com
     botões nomeados; esta tinha ficado para trás. */
  const [confirmClearMemories, setConfirmClearMemories] = useState(false);
  const clearMemories = async () => {
    if (!user) return;
    setConfirmClearMemories(false);
    setClearingMemories(true);
    const { error } = await supabase.from("ai_memories").delete().eq("user_id", user.id);
    setClearingMemories(false);
    if (error) { toast.error("Não consegui apagar. Tente de novo."); return; }
    toast.success("Memória do Conselheiro zerada.");
    qc.invalidateQueries({ queryKey: ["ai-memories"] });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <h1 className="font-display text-2xl font-semibold">Ajustes</h1>

      {/* Sem isto, a falha de leitura deixava todos os campos em branco e a
          página parecia um perfil vazio. Salvar já está protegido (o botão
          exige `dirty`, que exige perfil carregado), mas a pessoa merece saber
          por que a tela está assim. */}
      {profileError && (
        <QueryError
          title="Não consegui carregar o seu perfil."
          detail="Pode ser a conexão — nada foi alterado, e os campos abaixo voltam assim que a leitura funcionar."
          onRetry={refresh}
          retrying={profileFetching}
        />
      )}

      {/* Aparência */}
      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold">Aparência</h2>
          <p className="text-xs text-muted-foreground">
            Amanhecer ou noite na montanha — você escolhe.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border py-3 text-sm transition-colors",
                theme === t.id
                  ? "border-primary ring-1 ring-primary bg-primary/5 font-medium"
                  : "text-muted-foreground hover:bg-muted/60"
              )}
              aria-pressed={theme === t.id}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="font-display font-semibold">Perfil</h2>
        <div className="space-y-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="goal">Seu objetivo (a bússola do Conselheiro)</Label>
          <Input id="goal" maxLength={200} value={goal} onChange={(e) => setGoal(e.target.value)}
            placeholder='Ex.: "Ganhar massa sem estourar o orçamento"' />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <Label htmlFor="income">Renda mensal (R$)</Label>
            <Input id="income" type="number" min="0" value={income} onChange={(e) => setIncome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            {/* Era "Teto de gastos (R$)", e o campo grava `monthly_budget` —
                o que a Prosperidade mostra como "Orçamento do mês". Só que a
                MESMA tela da Prosperidade tem um "Teto de gasto do dia", que
                é outro campo (`daily_spend_limit`). Eram três nomes para dois
                conceitos: quem vinha procurar "orçamento" aqui encontrava
                "teto", concluía que era o teto diário que já tinha, e ia
                embora achando que o orçamento não dava para mudar. */}
            <Label htmlFor="budget">Orçamento do mês (R$)</Label>
            <Input id="budget" type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              Quanto você quer gastar por mês. Aparece na Prosperidade — e dá para
              mudar por lá também. Diferente do teto do DIA, que fica na tela Hoje.
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cycle-day">Dia de virada do ciclo financeiro</Label>
          <Input id="cycle-day" type="number" min="1" max="28" placeholder="1 (padrão: mês civil)"
            value={cycleDay} onChange={(e) => setCycleDay(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          <p className="text-[11px] text-muted-foreground">
            Se o seu "mês" financeiro não começa no dia 1 (ex.: fatura ou salário fecham
            todo dia 10), diga o dia aqui. Gastos e gráficos passam a virar de ciclo nesse
            dia em vez do calendário civil. Deixe em branco para manter o mês civil.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="food-spend">Gasto mensal com comida (R$)</Label>
          <Input id="food-spend" type="number" min="0" value={foodSpend}
            onChange={(e) => setFoodSpend(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">
            Mercado + comida fora, na média. É a premissa do plano alimentar que cabe no seu bolso —
            estimativa declarada, não registro: o gasto real do mês substitui, nunca soma.
          </p>
        </div>

        {/* Espiritualidade / desenvolvimento da mente */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <Label htmlFor="has-religion" className="cursor-pointer">Tenho prática espiritual/religiosa</Label>
            <p className="text-xs text-muted-foreground">
              Desligado, o pilar vira "Mente & Foco": diário, humor e treino mental — sem vocabulário espiritual.
            </p>
          </div>
          <Switch id="has-religion" checked={hasReligion} onCheckedChange={setHasReligion} />
        </div>
        {hasReligion && (
          <div className="space-y-1.5">
            <Label htmlFor="spirit">Nome da sua prática (Mente & Espírito)</Label>
            <Input id="spirit" maxLength={60} value={spirit} onChange={(e) => setSpirit(e.target.value)}
              placeholder="oração, meditação, silêncio..." />
          </div>
        )}
      </Card>

      {/* Sobre você: a base dos planos personalizados */}
      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold">Sobre você</h2>
          <p className="text-xs text-muted-foreground">
            O Conselheiro usa isso para montar planos de verdade (alimentar, treino, financeiro).
            Sem esses dados, ele pede antes de gerar.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <Label htmlFor="birth-year">Ano de nascimento</Label>
            <Input id="birth-year" inputMode="numeric" placeholder="1995" maxLength={4}
              value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-1.5">
            <Label>Sexo</Label>
            <Select value={sex} onValueChange={setSex}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nao_informar">Prefiro não dizer</SelectItem>
                <SelectItem value="feminino">Feminino</SelectItem>
                <SelectItem value="masculino">Masculino</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="height">Altura (cm)</Label>
            <Input id="height" inputMode="numeric" placeholder="172"
              value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Nível de atividade</Label>
            <Select value={activity} onValueChange={setActivity}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nao_informar">Não sei dizer</SelectItem>
                <SelectItem value="sedentario">Sedentário</SelectItem>
                <SelectItem value="leve">Leve (1 a 2x/semana)</SelectItem>
                <SelectItem value="moderado">Moderado (3 a 4x/semana)</SelectItem>
                <SelectItem value="intenso">Intenso (5x ou mais)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Restrições alimentares</Label>
          {restrictions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {restrictions.map((r, i) => (
                <span key={`${r}-${i}`} className="inline-flex items-center gap-1.5 text-xs rounded-full border bg-muted/60 px-2.5 py-1 max-w-full">
                  <span className="truncate">{r}</span>
                  <button type="button" onClick={() => setRestrictions((rs) => rs.filter((_, j) => j !== i))}
                    aria-label={`Remover ${r}`} className="text-muted-foreground hover:text-foreground shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input maxLength={60} placeholder='Ex.: "vegetariano", "sem lactose"'
              className="min-w-0 flex-1" value={restrictionInput}
              onChange={(e) => setRestrictionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const v = restrictionInput.trim();
                  if (v && !restrictions.some((x) => x.toLowerCase() === v.toLowerCase()) && restrictions.length < 15) {
                    setRestrictions((rs) => [...rs, v]); setRestrictionInput("");
                  }
                }
              }} />
            <Button type="button" size="icon" variant="secondary" className="shrink-0" aria-label="Adicionar restrição"
              onClick={() => {
                const v = restrictionInput.trim();
                if (v && !restrictions.some((x) => x.toLowerCase() === v.toLowerCase()) && restrictions.length < 15) {
                  setRestrictions((rs) => [...rs, v]); setRestrictionInput("");
                }
              }}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Restrições, perfil e pilares só valem depois de tocar em Salvar. Enquanto houver
            algo pendente, o aviso acompanha você no rodapé da tela.
          </p>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold">Pilares ativos</h2>
          <p className="text-xs text-muted-foreground">
            Ative quando estiver pronto. Os pausados saem do app e voltam em 1 toque, sem
            perder nada do histórico.
          </p>
        </div>
        {PILLARS.map((p) => (
          <div key={p.id} className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <p.icon className="w-4 h-4" style={{ color: `hsl(var(${p.colorVar}))` }} />
              <span className="text-sm">{p.name}</span>
            </div>
            <Switch
              checked={pillars.includes(p.id)}
              onCheckedChange={(on) => togglePillar(p.id, on)}
              aria-label={`Ativar pilar ${p.name}`}
            />
          </div>
        ))}
      </Card>

      {/* Modularidade total: liga/desliga por tracker */}
      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold">O que você acompanha</h2>
          <p className="text-xs text-muted-foreground">
            Não quer acompanhar água? Desligue — o anel, os botões de 1 toque e a
            lembrança no briefing somem na hora. Desligar esconde, não apaga: seu
            histórico continua seu, e religa em 1 toque.
          </p>
        </div>
        {PILLARS.filter((pl) => pillars.includes(pl.id) || pillars.length === 0).map((pl) => {
          const list = TRACKERS.filter((t) => t.pillar === pl.id);
          if (!list.length) return null;
          return (
            <div key={pl.id} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <pl.icon className="w-3.5 h-3.5" style={{ color: `hsl(var(${pl.colorVar}))` }} />
                {pl.name}
              </p>
              {list.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Label htmlFor={`tracker-${t.id}`} className="text-sm font-normal">{t.label}</Label>
                    <p className="text-[11px] text-muted-foreground truncate">{t.desc}</p>
                  </div>
                  <Switch id={`tracker-${t.id}`}
                    checked={trackingPrefs[t.id] !== false}
                    onCheckedChange={(v) => toggleTracker(t.id, !!v)}
                    aria-label={`Acompanhar ${t.label}`} />
                </div>
              ))}
            </div>
          );
        })}
        {pillars.length > 0 && PILLARS.some((pl) => !pillars.includes(pl.id)) && (
          <p className="text-[11px] text-muted-foreground">
            Pilares pausados pausam os itens deles automaticamente — ative o pilar acima para vê-los aqui.
          </p>
        )}
        {profile?.sleep_bedtime && profile?.sleep_waketime && trackingPrefs["sleep"] !== false && (
          <p className="text-[11px] text-muted-foreground border-t pt-2.5">
            Rotina de sono: {timeForInput(profile.sleep_bedtime)} → {timeForInput(profile.sleep_waketime)}
            {(() => { const h = sleepWindowHours(profile.sleep_bedtime, profile.sleep_waketime); return h ? ` (${formatWindowHours(h)})` : ""; })()}
            {" · "}
            <Link to="/app/vitalidade" className="underline underline-offset-2">editar em Vitalidade</Link>
          </p>
        )}
      </Card>

      <Button className="w-full" onClick={save} disabled={saving || !dirty}>
        {saving
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : dirty ? "Salvar ajustes" : "Tudo salvo"}
      </Button>

      {/* WhatsApp: captura por mensagem + avisos que trazem de volta ao app */}
      <WhatsappCard />

      {/* Feedback — canal TEMPORÁRIO da fase de consolidação */}
      <Card className="p-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-semibold">Feedback sobre a plataforma</h2>
          <p className="text-xs text-muted-foreground">
            Encontrou um problema, teve uma ideia ou quer elogiar? Vai direto para quem constrói o Ascende.
          </p>
        </div>
        <FeedbackDialog trigger={<Button variant="outline" size="sm" className="shrink-0">Enviar feedback</Button>} />
      </Card>

      {/* Dicas de primeiras vezes */}
      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold">Dicas de uso</h2>
          <p className="text-xs text-muted-foreground">
            Na primeira vez em cada área, o Ascende mostra uma dica curta explicando como usar.
            Cada dica aparece uma vez só e some sozinha quando você usa a função.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            resetGuides();
            toast.success("Pronto: as dicas vão aparecer de novo em cada área.");
          }}>
            Ver as dicas de novo
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => {
            disableGuides();
            toast.success("Dicas desligadas.");
          }}>
            Desligar todas
          </Button>
        </div>
      </Card>

      {/* Mokari: o interruptor.
          DESLIGADO por padrão — e o campo é anulável de propósito, para o app
          distinguir "nunca perguntei" de "ela disse não". O convite aparece
          UMA vez, na Jornada, e o silêncio é respeitado: personagem que
          aparece sem ser convidado, no app de quem está tentando organizar a
          vida, é atrito.
          Desligar aqui não afeta função nenhuma do app — XP, indicadores,
          captura, planos e batalhas seguem idênticos. Isso não é promessa de
          comentário: src/lib/mokariIsolation.test.ts reprova quem quebrar. */}
      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="mokari" className="cursor-pointer font-display font-semibold">
              Mokari
            </Label>
            <p className="text-xs text-muted-foreground">
              Um broto que cresce com o que você registra: o retrato da sua jornada, no topo da
              tela Jornada. Desligado, nada mais no app muda.
            </p>
          </div>
          <Switch
            id="mokari"
            checked={mokari.enabled}
            disabled={!mokari.ready}
            onCheckedChange={(v) => {
              mokari.setEnabled(v);
              toast.success(v
                ? "Mokari ligado. Ele aparece no topo da Jornada."
                : "Mokari desligado. Nada mais muda no app.");
            }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Ele nunca reflete peso nem composição corporal, e não envia nenhuma notificação.
        </p>
      </Card>

      {/* Assinatura */}
      <Card className="p-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-semibold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-gold" /> Assinatura
          </h2>
          <p className="text-xs text-muted-foreground">
            Veja seu plano atual, conheça o Ascende+ ou gerencie sua assinatura.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to="/app/assinatura">Ver planos</Link>
        </Button>
      </Card>

      {/* Privacidade: o que o Conselheiro pode analisar */}
      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold flex items-center gap-1.5">
            <Eye className="w-4 h-4 text-primary" /> O que o Conselheiro pode analisar
          </h2>
          <p className="text-xs text-muted-foreground">
            Desative uma área e o Conselheiro, o briefing e as análises deixam esses dados
            de fora na hora. Seus registros continuam salvos e visíveis para você.
          </p>
        </div>
        {SCOPES.map((sc) => (
          <div key={sc.id} className="flex items-center justify-between gap-3">
            <Label htmlFor={`scope-${sc.id}`} className="text-sm font-normal">{sc.label}</Label>
            <Switch id={`scope-${sc.id}`} checked={scopes[sc.id] ?? true}
              onCheckedChange={(v) => toggleScope(sc.id, !!v)} />
          </div>
        ))}
      </Card>

      {/* Memória do Conselheiro: transparência total sobre o que a IA aprendeu */}
      <Card className="p-4 space-y-3">
        <h2 className="font-display font-semibold flex items-center gap-1.5">
          <Brain className="w-4 h-4 text-primary" /> O que o Ascende sabe sobre você
        </h2>

        <MemoryControl onClearAll={() => setConfirmClearMemories(true)} clearing={clearingMemories} />
      </Card>

      <AlertDialog open={confirmClearMemories} onOpenChange={setConfirmClearMemories}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o que o Conselheiro aprendeu sobre você?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  Ele esquece o que deduziu das conversas: suas preferências, restrições, o que
                  você contou de passagem.
                </p>
                <p className="rounded-md border p-2.5 text-foreground">
                  Seus registros ficam. Gastos, treinos, refeições, sono, XP e dias limpos
                  continuam todos aqui.
                </p>
                <p className="text-xs">
                  A partir da próxima conversa ele começa a aprender de novo, do zero.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter o que ele aprendeu</AlertDialogCancel>
            <AlertDialogAction onClick={clearMemories}>Apagar as memórias</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold">Instalar na tela inicial</h2>
          <p className="text-xs text-muted-foreground">
            O Ascende funciona como um app de verdade: ícone na tela inicial e abertura em
            tela cheia, sem barra do navegador.
          </p>
        </div>
        <div className="rounded-md border p-3 space-y-1.5">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Smartphone className="w-4 h-4" /> iPhone / iPad
          </p>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Abra este site no <strong>Safari</strong> (não funciona pelo Chrome no iPhone).</li>
            <li>Toque no botão <strong>Compartilhar</strong> <Share className="w-3.5 h-3.5 inline -mt-0.5" aria-label="ícone compartilhar" /> na barra inferior.</li>
            <li>Role a lista e toque em <strong>"Adicionar à Tela de Início"</strong>.</li>
            <li>Toque em <strong>Adicionar</strong>. O ícone do Ascende aparece junto dos seus apps.</li>
          </ol>
        </div>
        <div className="rounded-md border p-3 space-y-1.5">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Smartphone className="w-4 h-4" /> Android
          </p>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Abra este site no <strong>Chrome</strong>.</li>
            <li>Toque no menu <strong>⋮</strong> (canto superior direito).</li>
            <li>Toque em <strong>"Adicionar à tela inicial"</strong> (ou "Instalar app").</li>
          </ol>
        </div>
      </Card>

      {/* Importar dados de saúde: o espelho da exportação logo abaixo.
          Vale para sono, treino E peso ao mesmo tempo — por isso mora aqui,
          e não dentro de um pilar só. */}
      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold flex items-center gap-1.5">
            <Upload className="w-4 h-4 text-primary" /> Importar dados de saúde
          </h2>
          <p className="text-xs text-muted-foreground">
            Traga o histórico que já existe nos seus outros aplicativos: sono, treinos e peso.
          </p>
        </div>
        {/* O medo desta seção não é de instrução, é de exposição: quem não
            sabe o que é um .zip não chega a ler o texto de dentro. A dica
            adianta a única frase que destrava — o arquivo não sobe. */}
        <FirstTimeTip id="importar" />
        <HealthImport />
      </Card>

      {/* Fontes e recibos: fica ENTRE importar e exportar de propósito — a
          leitura da página passa a ser "trouxe → confira o que entrou →
          leve embora". Sem esta seção, a importação acima seria uma
          afirmação sem comprovante (plano refinado §4.1 e §4.4). */}
      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold flex items-center gap-1.5">
            <FileStack className="w-4 h-4 text-primary" /> Fontes e importações
          </h2>
          <p className="text-xs text-muted-foreground">
            De onde vieram seus registros, e o recibo de cada importação.
          </p>
        </div>
        <SourcesAndImports />
      </Card>

      {/* Seus dados: exportação e exclusão — sempre gratuitas */}
      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold flex items-center gap-1.5">
            <Download className="w-4 h-4 text-primary" /> Seus dados
          </h2>
          <p className="text-xs text-muted-foreground">
            Seus dados são seus. Exporte tudo quando quiser — de graça, sempre.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportJson} disabled={exporting !== null}>
            {exporting === "json" ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Download className="w-3.5 h-3.5 mr-1.5" /> Exportar tudo (JSON)</>)}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting !== null}>
            {exporting === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Download className="w-3.5 h-3.5 mr-1.5" /> Registros e finanças (CSV)</>)}
          </Button>
        </div>
        <div className="rounded-md border border-destructive/30 p-3 space-y-2">
          <p className="text-sm font-semibold flex items-center gap-1.5 text-destructive">
            <ShieldAlert className="w-4 h-4" /> Excluir minha conta
          </p>
          <p className="text-xs text-muted-foreground">
            {/* O texto mandava cancelar a assinatura à mão ANTES de excluir —
                uma tarefa que o servidor já faz sozinho (delete-account
                cancela no Stripe e só então apaga, abortando com mensagem
                clara se o cancelamento falhar). Pior: insinuava que excluir a
                conta podia deixar uma cobrança viva. Isso é sludge no caminho
                da SAÍDA: fricção que não serve a pessoa e produz retenção por
                confusão, mesmo sem ninguém ter querido isso. */}
            Apaga definitivamente sua conta e TODOS os dados (registros, conversas, memórias,
            planos, XP). Não tem volta. Se você assina o Ascende+, cancelamos a assinatura
            automaticamente antes de apagar tudo. Dica: exporte seus dados acima antes de excluir.
          </p>
          {/* O token --destructive (4 72% 52/58%) com a tinta clara dá 4,34:1
              no claro e 3,56:1 no escuro — abaixo do mínimo AA de 4,5:1 para
              texto normal (QA visual, M2). Mesma matiz e saturação da casa, só
              mais profunda: 5,62:1 no claro e 5,38:1 no escuro. O certo seria
              escurecer o token em index.css, que não é meu nesta rodada. */}
          <Button
            variant="destructive" size="sm"
            className="bg-[hsl(4_72%_44%)] hover:bg-[hsl(4_72%_38%)]"
            onClick={() => { setDeleteText(""); setDeleteOpen(true); }}
          >
            Excluir conta e dados
          </Button>
        </div>
      </Card>

      {/* Confirmação reforçada da exclusão */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Excluir conta definitivamente</DialogTitle>
            <DialogDescription>
              Esta ação apaga TODOS os seus dados e não pode ser desfeita.
              Para confirmar, digite <strong>EXCLUIR</strong> abaixo.
            </DialogDescription>
          </DialogHeader>
          <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value.toUpperCase())}
            placeholder="EXCLUIR" aria-label="Digite EXCLUIR para confirmar" />
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={deleteAccount} disabled={deleteText !== "EXCLUIR" || deleting}>
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Excluir tudo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button variant="ghost" className="w-full text-muted-foreground" onClick={signOut}>
        <LogOut className="w-4 h-4 mr-1.5" /> Sair da conta
      </Button>

      {/* Barra de alterações não salvas: acompanha a rolagem e fica acima da
          navegação flutuante do mobile (mesmo cálculo usado no Conselheiro). */}
      {dirty && (
        <div
          className="fixed inset-x-0 z-20 px-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] md:bottom-4"
          role="status"
        >
          <div className="max-w-2xl mx-auto flex items-center gap-3 rounded-full glass shadow-lg shadow-black/10 py-2 pl-4 pr-2 animate-fade-up">
            <p className="text-xs font-medium flex-1 min-w-0">
              Alterações não salvas
              <span className="hidden sm:inline text-muted-foreground font-normal"> — nada foi gravado ainda</span>
            </p>
            <Button size="sm" className="shrink-0 rounded-full" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}