import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Trash2, Plus, Loader2 } from "lucide-react";
import { brl, monthStartISO, todayISO } from "@/lib/format";

const CATEGORIES = ["Mercado", "Alimentação fora", "Transporte", "Moradia", "Saúde", "Lazer", "Educação", "Assinaturas", "Salário", "Extra", "Outros"];

interface Tx { id: string; kind: "income" | "expense"; amount: number; category: string; description: string | null; occurred_at: string }

export default function Prosperidade() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();

  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Mercado");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: txs, isLoading } = useQuery({
    queryKey: ["transactions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("transactions").select("*")
        .eq("user_id", user!.id).gte("occurred_at", monthStartISO())
        .order("occurred_at", { ascending: false }).order("created_at", { ascending: false }).limit(200);
      return (data ?? []) as Tx[];
    },
  });

  const income = (txs ?? []).filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expense = (txs ?? []).filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const budget = Number(profile?.monthly_budget ?? 0);
  const budgetPct = budget > 0 ? Math.min((expense / budget) * 100, 100) : null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(amount.replace(",", "."));
    if (!user || !v || v <= 0) { toast.error("Informe um valor válido."); return; }
    setSaving(true);
    const { error } = await supabase.from("transactions").insert({
      user_id: user.id, kind, amount: v, category,
      description: description.trim() || null, occurred_at: todayISO(),
    });
    setSaving(false);
    if (error) { toast.error("Não consegui salvar. Tente de novo."); return; }
    toast.success(kind === "expense" ? "Gasto registrado. +XP" : "Entrada registrada. +XP");
    setAmount(""); setDescription("");
    qc.invalidateQueries();
  };

  const remove = async (id: string) => {
    await supabase.from("transactions").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["transactions"] });
    toast.success("Lançamento removido.");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold" style={{ color: "hsl(var(--prosperidade))" }}>
          Prosperidade
        </h1>
        <p className="text-sm text-muted-foreground">
          Dica: você também pode registrar gastos escrevendo na tela Hoje — "gastei 30 no almoço".
        </p>
      </div>

      {/* Resumo do mês */}
      <div className="grid grid-cols-3 gap-2.5">
        <Card className="p-3.5">
          <p className="text-[11px] text-muted-foreground">Entradas</p>
          <p className="font-semibold text-success text-sm md:text-base">{brl(income)}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-[11px] text-muted-foreground">Saídas</p>
          <p className="font-semibold text-destructive text-sm md:text-base">{brl(expense)}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-[11px] text-muted-foreground">Saldo do mês</p>
          <p className="font-semibold text-sm md:text-base">{brl(income - expense)}</p>
        </Card>
      </div>

      {budgetPct !== null && (
        <Card className="p-4">
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">Orçamento do mês</span>
            <span>{brl(expense)} de {brl(budget)}</span>
          </div>
          <Progress value={budgetPct} />
          {budgetPct >= 90 && (
            <p className="text-xs text-warning mt-1.5">
              Você está perto do limite que definiu. Sem pânico: veja com o Conselheiro onde dá para ajustar.
            </p>
          )}
        </Card>
      )}

      {/* Novo lançamento */}
      <Card className="p-4">
        <form onSubmit={add} className="space-y-3">
          <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="expense">Gasto</TabsTrigger>
              <TabsTrigger value="income">Entrada</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Valor (R$)</Label>
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
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Plus className="w-4 h-4 mr-1" /> Registrar</>)}
          </Button>
        </form>
      </Card>

      {/* Lista do mês */}
      <Card className="p-4">
        <h2 className="font-display font-semibold mb-3">Lançamentos do mês</h2>
        {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
        {!isLoading && !(txs ?? []).length && (
          <p className="text-sm text-muted-foreground">
            Nenhum lançamento ainda. Registre o primeiro acima — ou conte na tela Hoje.
          </p>
        )}
        <div className="divide-y">
          {(txs ?? []).map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{t.description || t.category}</p>
                <p className="text-xs text-muted-foreground">
                  {t.category} · {new Date(t.occurred_at + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                </p>
              </div>
              <span className={t.kind === "expense" ? "text-sm font-medium text-destructive" : "text-sm font-medium text-success"}>
                {t.kind === "expense" ? "−" : "+"}{brl(Number(t.amount))}
              </span>
              <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground"
                onClick={() => remove(t.id)} aria-label="Excluir lançamento">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
