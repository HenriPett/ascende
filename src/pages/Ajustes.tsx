import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { LogOut, Loader2, Smartphone, Share, Sun, Moon, Monitor, Plus, X } from "lucide-react";
import { PILLARS, type PillarId } from "@/lib/pillars";
import { cn } from "@/lib/utils";

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

      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold">Instalar na tela inicial</h2>
          <p className="text-xs text-muted-foreground">
            O Ascend funciona como um app de verdade: ícone na tela inicial e abertura em
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
            <li>Toque em <strong>Adicionar</strong>. O ícone do Ascend aparece junto dos seus apps.</li>
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

      <p className="text-xs text-muted-foreground px-1">
        Seus dados são seus. Para excluir sua conta e todos os dados definitivamente, escreva
        para o suporte — a exclusão apaga tudo, sem cópias.
      </p>

      <Button variant="ghost" className="w-full text-muted-foreground" onClick={signOut}>
        <LogOut className="w-4 h-4 mr-1.5" /> Sair da conta
      </Button>
    </div>
  );
}