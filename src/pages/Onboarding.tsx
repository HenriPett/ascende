import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { PILLARS, type PillarId } from "@/lib/pillars";
import { Check, Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// Hábitos iniciais sugeridos por pilar (a pessoa pode mudar depois)
const SEED_HABITS: Record<PillarId, string[]> = {
  prosperidade: ["Registrar os gastos do dia"],
  vitalidade: ["Movimentar o corpo", "Dormir antes das 23h"],
  alimentacao: ["Fazer uma refeição de verdade"],
  mente: ["Momento de prática"],
};

export default function Onboarding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refresh } = useProfile();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [goal, setGoal] = useState("");
  const [selected, setSelected] = useState<PillarId[]>([]);
  const [spirit, setSpirit] = useState("");
  const [income, setIncome] = useState("");
  const [budget, setBudget] = useState("");

  const togglePillar = (id: PillarId) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 2 ? [...s, id] : s));

  const needsSpirit = selected.includes("mente");
  const needsMoney = selected.includes("prosperidade");

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("profiles").update({
        goal: goal.trim() || null,
        pillars: selected,
        spirituality_label: needsSpirit ? (spirit.trim() || "Momento de silêncio") : null,
        monthly_income: needsMoney && income ? Number(income) : null,
        monthly_budget: needsMoney && budget ? Number(budget) : null,
        onboarded: true,
      }).eq("user_id", user.id);
      if (error) throw error;

      // Hábitos iniciais dos pilares escolhidos
      const habits = selected.flatMap((p) =>
        SEED_HABITS[p].map((name) => ({
          user_id: user.id,
          name: p === "mente" && name === "Momento de prática" ? (spirit.trim() || "Momento de silêncio") : name,
          pillar: p,
        }))
      );
      if (habits.length) await supabase.from("habits").insert(habits);

      refresh();
      toast.success("Tudo pronto. Bem-vindo(a) à subida!");
      navigate("/app", { replace: true });
    } catch {
      toast.error("Algo deu errado ao salvar. Tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  const steps = [
    // 0 — objetivo
    <div key="goal" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">O que "subir de nível" significa para você?</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Em uma frase, no seu jeito. A IA vai usar isso como bússola em tudo que sugerir.
        </p>
      </div>
      <Input
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        maxLength={200}
        placeholder='Ex.: "Ganhar massa muscular sem estourar o orçamento"'
      />
      <Button className="w-full" onClick={() => setStep(1)}>
        Continuar <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
      <button className="w-full text-xs text-muted-foreground underline" onClick={() => setStep(1)}>
        Prefiro pular por enquanto
      </button>
    </div>,

    // 1 — pilares
    <div key="pillars" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Por onde você quer começar?</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Escolha até <strong>2 pilares</strong>. Ninguém organiza a vida inteira num dia — os outros
          você ativa depois, quando fizer sentido.
        </p>
      </div>
      <div className="grid gap-2.5">
        {PILLARS.map((p) => {
          const active = selected.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() => togglePillar(p.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-4 text-left transition-all",
                active ? "border-primary ring-1 ring-primary bg-primary/5" : "hover:bg-muted/60"
              )}
              aria-pressed={active}
            >
              <div
                className="w-9 h-9 rounded-md grid place-items-center shrink-0"
                style={{ background: `hsl(var(${p.colorVar}) / 0.12)` }}
              >
                <p.icon className="w-5 h-5" style={{ color: `hsl(var(${p.colorVar}))` }} />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.desc}</p>
              </div>
              {active && <Check className="w-5 h-5 text-primary" />}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setStep(0)}><ArrowLeft className="w-4 h-4" /></Button>
        <Button className="flex-1" disabled={!selected.length} onClick={() => setStep(2)}>
          Continuar <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>,

    // 2 — contexto dos pilares escolhidos
    <div key="context" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Só mais um detalhe</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Tudo aqui é opcional — mas quanto mais contexto, mais inteligente a IA fica.
        </p>
      </div>

      {needsMoney && (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-semibold">Prosperidade</p>
          <div className="space-y-1.5">
            <Label htmlFor="income">Renda mensal aproximada (R$)</Label>
            <Input id="income" type="number" min="0" inputMode="numeric" placeholder="Ex.: 8000"
              value={income} onChange={(e) => setIncome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="budget">Quanto quer gastar por mês, no máximo? (R$)</Label>
            <Input id="budget" type="number" min="0" inputMode="numeric" placeholder="Ex.: 6000"
              value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
        </div>
      )}

      {needsSpirit && (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-semibold">Mente & Espírito</p>
          <div className="space-y-1.5">
            <Label htmlFor="spirit">Como você chama a sua prática?</Label>
            <Input id="spirit" maxLength={60} placeholder="Ex.: oração, meditação, culto, silêncio, leitura..."
              value={spirit} onChange={(e) => setSpirit(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              O Ascende respeita o seu vocabulário e a sua crença — a plataforma acompanha
              a prática que <em>você</em> definiu, nunca sugere uma.
            </p>
          </div>
        </div>
      )}

      {!needsMoney && !needsSpirit && (
        <p className="text-sm text-muted-foreground rounded-lg border p-4">
          Nada a configurar para os pilares escolhidos. É só começar!
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4" /></Button>
        <Button className="flex-1" onClick={finish} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Começar minha subida"}
        </Button>
      </div>
    </div>,
  ];

  return (
    <div className="min-h-dvh grid place-items-center bg-background px-4 py-8">
      <Card className="w-full max-w-md p-6">
        <div className="flex gap-1.5 mb-6" aria-label={`Passo ${step + 1} de 3`}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-gold" : "bg-muted")} />
          ))}
        </div>
        {steps[step]}
      </Card>
    </div>
  );
}
