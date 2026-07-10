import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { LogOut, Loader2, Smartphone, Share, Sun, Moon, Monitor, Plus, X, Brain, Trash2, Download, ShieldAlert, Sparkles, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { PILLARS, type PillarId } from "@/lib/pillars";
import { MEMORY_CATEGORY_LABEL } from "@/components/core/LearnedInsights";
import { useGuides } from "@/hooks/useGuides";
import { cn } from "@/lib/utils";

interface AiMemory { id: string; content: string; category: string; created_at: string }

const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Claro", icon: Sun },
  { id: "dark", label: "Escuro", icon: Moon },
  { id: "system", label: "Sistema", icon: Monitor },
];

export default function Ajustes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, refresh } = useProfile();
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [income, setIncome] = useState("");
  const [budget, setBudget] = useState("");
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

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      name: name.trim() || null,
      goal: goal.trim() || null,
      monthly_income: income ? Number(income) : null,
      monthly_budget: budget ? Number(budget) : null,
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
    if (error) { toast.error("Não consegui salvar."); return; }
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
    if (error) { toast.error("Não consegui salvar a preferência."); setScopes(scopes); return; }
    toast.success(on ? "O Conselheiro voltará a considerar essa área." : "O Conselheiro deixará essa área de fora das análises.");
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
      download(`ascend-dados-${new Date().toISOString().slice(0, 10)}.json`,
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
        download(`ascend-${t}-${new Date().toISOString().slice(0, 10)}.csv`,
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
  const [clearingMemories, setClearingMemories] = useState(false);
  const { data: memories, isLoading: memoriesLoading } = useQuery({
    queryKey: ["ai-memories", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("ai_memories")
        .select("id,content,category,created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      return (data ?? []) as AiMemory[];
    },
  });

  const deleteMemory = async (id: string) => {
    const { error } = await supabase.from("ai_memories").delete().eq("id", id);
    if (error) { toast.error("Não consegui apagar. Tente de novo."); return; }
    toast.success("Memória apagada. O Conselheiro não vai mais considerar isso.");
    qc.invalidateQueries({ queryKey: ["ai-memories"] });
  };

  const clearMemories = async () => {
    if (!user) return;
    if (!window.confirm("Apagar TUDO que o Conselheiro aprendeu sobre você em conversas? Isso não apaga seus registros (gastos, treinos, refeições...), só as memórias da IA.")) return;
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
          <Label htmlFor="goal">Seu objetivo (a bússola da IA)</Label>
          <Input id="goal" maxLength={200} value={goal} onChange={(e) => setGoal(e.target.value)}
            placeholder='Ex.: "Ganhar massa sem estourar o orçamento"' />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <Label htmlFor="income">Renda mensal (R$)</Label>
            <Input id="income" type="number" min="0" value={income} onChange={(e) => setIncome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="budget">Teto de gastos (R$)</Label>
            <Input id="budget" type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
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
          <p className="text-[11px] text-muted-foreground">Lembre de tocar em "Salvar ajustes" no fim da página.</p>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold">Pilares ativos</h2>
          <p className="text-xs text-muted-foreground">
            Ative quando estiver pronto — os inativos continuam acessíveis, só saem do foco.
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

      <Button className="w-full" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar ajustes"}
      </Button>

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
            toast.success("Prontinho: as dicas vão aparecer de novo em cada área.");
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
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display font-semibold flex items-center gap-1.5">
              <Brain className="w-4 h-4 text-primary" /> Memória do Conselheiro
            </h2>
            <p className="text-xs text-muted-foreground">
              A cada conversa, o Conselheiro aprende nuances sobre você (preferências, rotina,
              contexto) e usa isso para respostas e planos mais pessoais. Tudo que ele sabe está
              aqui — apague o que quiser, a qualquer momento.
            </p>
          </div>
          {(memories?.length ?? 0) > 0 && (
            <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground"
              onClick={clearMemories} disabled={clearingMemories}>
              {clearingMemories ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Trash2 className="w-3.5 h-3.5 mr-1" /> Apagar tudo</>)}
            </Button>
          )}
        </div>

        {memoriesLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

        {!memoriesLoading && (memories?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">
            Ainda não aprendi nada sobre você. Converse com o Conselheiro ou use a caixa
            "Conte como foi" na tela Hoje — o que eu aprender aparece aqui.
          </p>
        )}

        {(memories ?? []).map((m) => (
          <div key={m.id} className="flex items-start gap-3 rounded-md border p-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm break-words">{m.content}</p>
              <p className="text-[11px] text-muted-foreground">
                {MEMORY_CATEGORY_LABEL[m.category] ?? MEMORY_CATEGORY_LABEL.outro}
                {" · aprendido em "}
                {new Date(m.created_at).toLocaleDateString("pt-BR")}
              </p>
            </div>
            <button
              type="button" onClick={() => deleteMemory(m.id)}
              aria-label={`Apagar memória: ${m.content}`}
              className="text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </Card>

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
            Apaga definitivamente sua conta e TODOS os dados (registros, conversas, memórias,
            planos, XP). Não tem volta. Se tiver assinatura ativa, cancele antes pelo portal
            na página Assinatura. Dica: exporte seus dados acima antes de excluir.
          </p>
          <Button variant="destructive" size="sm" onClick={() => { setDeleteText(""); setDeleteOpen(true); }}>
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
    </div>
  );
}