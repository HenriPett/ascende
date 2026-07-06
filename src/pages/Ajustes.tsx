import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Download, LogOut, Loader2, Smartphone, Share } from "lucide-react";
import { PILLARS, type PillarId } from "@/lib/pillars";

export default function Ajustes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, refresh } = useProfile();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [income, setIncome] = useState("");
  const [budget, setBudget] = useState("");
  const [spirit, setSpirit] = useState("");
  const [pillars, setPillars] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? "");
    setGoal(profile.goal ?? "");
    setIncome(profile.monthly_income != null ? String(profile.monthly_income) : "");
    setBudget(profile.monthly_budget != null ? String(profile.monthly_budget) : "");
    setSpirit(profile.spirituality_label ?? "");
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
      spirituality_label: spirit.trim() || null,
      pillars,
    }).eq("user_id", user.id);
    setSaving(false);
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Ajustes salvos.");
    refresh();
  };

  const exportData = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const [profileQ, events, txs, habits, logs, chat, xp] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("life_events").select("*").eq("user_id", user.id),
        supabase.from("transactions").select("*").eq("user_id", user.id),
        supabase.from("habits").select("*").eq("user_id", user.id),
        supabase.from("habit_logs").select("*").eq("user_id", user.id),
        supabase.from("chat_messages").select("*").eq("user_id", user.id),
        supabase.from("xp_log").select("*").eq("user_id", user.id),
      ]);
      const dump = {
        exportado_em: new Date().toISOString(),
        perfil: profileQ.data,
        linha_do_tempo: events.data,
        transacoes: txs.data,
        habitos: habits.data,
        registros_de_habitos: logs.data,
        conversas: chat.data,
        xp: xp.data,
      };
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ascende-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Seus dados foram exportados.");
    } catch {
      toast.error("Não consegui exportar agora.");
    } finally {
      setExporting(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <h1 className="font-display text-2xl font-semibold">Ajustes</h1>

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
        <div className="space-y-1.5">
          <Label htmlFor="spirit">Nome da sua prática (Mente & Espírito)</Label>
          <Input id="spirit" maxLength={60} value={spirit} onChange={(e) => setSpirit(e.target.value)}
            placeholder="oração, meditação, silêncio..." />
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

      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold">Seus dados são seus</h2>
          <p className="text-xs text-muted-foreground">
            Exporte tudo o que o Ascende sabe sobre você em um arquivo. Para excluir sua conta e
            todos os dados definitivamente, escreva para o suporte — a exclusão apaga tudo, sem cópias.
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={exportData} disabled={exporting}>
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Download className="w-4 h-4 mr-1.5" /> Exportar meus dados (JSON)</>)}
        </Button>
      </Card>

      <Button variant="ghost" className="w-full text-muted-foreground" onClick={signOut}>
        <LogOut className="w-4 h-4 mr-1.5" /> Sair da conta
      </Button>
    </div>
  );
}