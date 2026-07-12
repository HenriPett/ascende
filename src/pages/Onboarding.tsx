// Onboarding mínimo (2 passos + 1 vivencial): meta + porta de entrada +
// PRIMEIRA CAPTURA GUIADA (análise UX P0.2) — o "uau" prometido na landing
// acontece DENTRO do onboarding, não depois dele. Se a pessoa testou a demo
// da landing, a frase dela vem pré-preenchida (continuidade via sessionStorage).
//
// Decisão de posicionamento (POSICIONAMENTO.md): a porta de entrada padrão é
// o cliente-alavanca "corpo + dinheiro" (Prosperidade, Vitalidade e
// Alimentação pré-selecionados; Mente & Espírito é opt-in). A pessoa ajusta
// como quiser aqui e depois em Ajustes — foco radical é de marca/discurso,
// não mutilação do produto.
//
// Coleta progressiva: renda, teto de gastos, ano de nascimento, sexo, altura,
// nível de atividade e o nome da prática espiritual NÃO são pedidos na porta.
// O Conselheiro já sabe pedir o que falta quando precisar (regras de "plano
// definitivo" + ferramenta atualizar_perfil em ai-chat), e tudo pode ser
// preenchido em Ajustes. Cada campo removido daqui é fricção a menos na
// janela curta de atenção (plano de posicionamento, Fase 4.2).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { PILLARS, type PillarId } from "@/lib/pillars";
import CaptureBar from "@/components/core/CaptureBar";
import { Check, Loader2, ArrowRight, ArrowLeft, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// Hábitos iniciais sugeridos por pilar (a pessoa pode mudar depois)
const SEED_HABITS: Record<PillarId, string[]> = {
  prosperidade: ["Registrar os gastos do dia"],
  vitalidade: ["Movimentar o corpo", "Dormir antes das 23h"],
  alimentacao: ["Fazer uma refeição de verdade"],
  mente: ["Momento de prática"],
};

// Nome padrão da prática do pilar Mente & Espírito. Não perguntamos na porta:
// a pessoa renomeia em Ajustes ou na primeira conversa com o Conselheiro.
const DEFAULT_PRACTICE = "Momento de prática";

// A porta de entrada da maioria: corpo + dinheiro (cliente-alavanca).
const DEFAULT_PILLARS: PillarId[] = ["prosperidade", "vitalidade", "alimentacao"];

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
  const { profile, refresh } = useProfile();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [goal, setGoal] = useState("");
  const [selected, setSelected] = useState<PillarId[]>(DEFAULT_PILLARS);
  const [landingPhrase] = useState(consumeLandingPhrase);
  const [captured, setCaptured] = useState(false);

  const togglePillar = (id: PillarId) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const withMente = selected.includes("mente");
      const { error } = await supabase.from("profiles").update({
        goal: goal.trim() || null,
        pillars: selected,
        spirituality_label: withMente ? DEFAULT_PRACTICE : null,
        onboarded: true,
      }).eq("user_id", user.id);
      if (error) throw error;

      // Hábitos iniciais dos pilares escolhidos
      const habits = selected.flatMap((p) =>
        SEED_HABITS[p].map((name) => ({
          user_id: user.id,
          name,
          pillar: p,
        }))
      );
      if (habits.length) await supabase.from("habits").insert(habits);

      // Atualiza o cache do perfil na hora, para o guard já ler onboarded=true
      // (evita o redirecionamento de volta ao onboarding).
      qc.setQueryData(["profile", user.id], (old: typeof profile) =>
        old
          ? {
              ...old,
              goal: goal.trim() || null,
              pillars: selected,
              spirituality_label: withMente ? DEFAULT_PRACTICE : null,
              onboarded: true,
            }
          : old
      );
      refresh();
      // Perfil salvo e onboarded=true: se a pessoa abandonar aqui, já está
      // dentro. O passo 3 é o momento de valor, não mais um formulário.
      setStep(2);
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

    // 1 — porta de entrada (pilares, com o padrão corpo + dinheiro)
    <div key="pillars" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Por onde você quer começar?</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          A maioria começa por <strong>corpo + dinheiro</strong> (já deixamos selecionado) —
          é onde o Ascende faz o que nenhum outro app faz. Ajuste como quiser; dá para
          ativar ou pausar qualquer pilar depois, em Ajustes.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2.5">
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
      <p className="text-xs text-muted-foreground rounded-lg border p-3">
        Renda, altura, metas? O Conselheiro pergunta quando precisar — nada de formulário
        na porta. E uma promessa: o Ascende nunca vai te dar bronca por notificação.
        Semana ruim não apaga a subida.
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setStep(0)}><ArrowLeft className="w-4 h-4" /></Button>
        <Button className="flex-1" disabled={!selected.length || saving} onClick={finish}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (<>Continuar <ArrowRight className="w-4 h-4 ml-1" /></>)}
        </Button>
      </div>
    </div>,
    // 2 — a mágica: primeira captura guiada (o "uau" da landing, garantido)
    <div key="capture" className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-gold" /> Agora, a mágica
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
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
      <Button className="w-full" onClick={() => { toast.success("Bem-vindo(a) à subida!"); navigate("/app", { replace: true }); }}>
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