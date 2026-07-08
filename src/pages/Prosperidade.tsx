import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import GoalInput from "@/components/core/GoalInput";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Trash2, Plus, Loader2, LineChart as LineChartIcon } from "lucide-react";
import { brl, monthStartISO, todayISO } from "@/lib/format";
import {
  ResponsiveContainer, ComposedChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from "recharts";

const CATEGORIES = ["Mercado", "Alimentação fora", "Transporte", "Moradia", "Saúde", "Lazer", "Educação", "Assinaturas", "Salário", "Extra", "Outros"];

interface Tx { id: string; kind: "income" | "expense"; amount: number; category: string; description: string | null; occurred_at: string }

const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) =>
  new Date(key + "-02T00:00:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");

const tooltipStyle = {
  background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
  borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))",
} as const;
const brlShort = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")}k` : String(Math.round(v));

export default function Prosperidade() {
  const { user } = useAuth();
  const { profile, refresh: refreshProfile } = useProfile();
  const qc = useQueryClient();

  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Mercado");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [spendLimitInput, setSpendLimitInput] = useState("");

  const saveSpendLimitRaw = async (raw: string) => {
    if (!user) return;
    const v = Number(raw.replace(",", "."));
    if (!v || v <= 0) { toast.error("Informe um valor válido. Ex.: 80"); return; }
    const { error } = await supabase.from("profiles").update({ daily_spend_limit: v }).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Teto de gasto diário salvo. Acompanhe na tela Hoje.");
    setSpendLimitInput("");
    refreshProfile();
  };

  // Últimos 6 meses (para gráficos) — a lista continua mostrando só o mês atual
  const { data: txs, isLoading } = useQuery({
    queryKey: ["transactions-6m", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const start = new Date();
      start.setMonth(start.getMonth() - 5);
      start.setDate(1);
      const { data } = await supabase.from("transactions").select("*")
        .eq("user_id", user!.id).gte("occurred_at", start.toISOString().slice(0, 10))
        .order("occurred_at", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
      return (data ?? []) as Tx[];
    },
  });

  const monthTxs = (txs ?? []).filter((t) => t.occurred_at >= monthStartISO());
  const spendLimit = Number(profile?.daily_spend_limit) || 0;
  const spentToday = (txs ?? [])
    .filter((t) => t.kind === "expense" && t.occurred_at === todayISO())
    .reduce((s, t) => s + Number(t.amount), 0);
  const income = monthTxs.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expense = monthTxs.filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const budget = Number(profile?.monthly_budget ?? 0);
  const budgetPct = budget > 0 ? Math.min((expense / budget) * 100, 100) : null;

  // ── Dados dos gráficos ───────────────────────────────────────
  const nowKey = monthKey(todayISO());
  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    monthKeys.push(d.toISOString().slice(0, 7));
  }
  const evolution = monthKeys.map((k) => {
    const ms = (txs ?? []).filter((t) => monthKey(t.occurred_at) === k);
    const inc = ms.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
    const exp = ms.filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
    return { mes: monthLabel(k), key: k, Entradas: inc, Saídas: exp, Saldo: inc - exp };
  });
  const monthsWithData = evolution.filter((m) => m.Entradas > 0 || m.Saídas > 0);

  // Comparativo por categoria: mês atual vs anterior
  const prevKey = monthKeys[monthKeys.length - 2];
  const catTotals = (key: string) => {
    const map: Record<string, number> = {};
    for (const t of txs ?? []) {
      if (t.kind !== "expense" || monthKey(t.occurred_at) !== key) continue;
      map[t.category] = (map[t.category] ?? 0) + Number(t.amount);
    }
    return map;
  };
  const curCats = catTotals(nowKey);
  const prevCats = catTotals(prevKey);
  const topCatNames = [...new Set([...Object.keys(curCats), ...Object.keys(prevCats)])]
    .sort((a, b) => (curCats[b] ?? 0) + (prevCats[b] ?? 0) - ((curCats[a] ?? 0) + (prevCats[a] ?? 0)))
    .slice(0, 6);
  const catCompare = topCatNames.map((c) => ({
    categoria: c, "Mês anterior": Math.round(prevCats[c] ?? 0), "Este mês": Math.round(curCats[c] ?? 0),
  }));

  // Projeção: saldo acumulado projetado 6 meses à frente,
  // usando a média do resultado (entradas − saídas) dos últimos 3 meses com dados.
  const past = monthsWithData.filter((m) => m.key !== nowKey);
  const basis = past.slice(-3);
  const avgNet = basis.length ? basis.reduce((s, m) => s + m.Saldo, 0) / basis.length : null;
  let acc = 0;
  const projection: { mes: string; Histórico: number | null; Projeção: number | null }[] = [];
  for (const m of evolution) {
    acc += m.Saldo;
    projection.push({ mes: m.mes, Histórico: Math.round(acc), Projeção: null });
  }
  if (avgNet !== null && projection.length) {
    projection[projection.length - 1].Projeção = projection[projection.length - 1].Histórico;
    let pAcc = acc;
    for (let i = 1; i <= 6; i++) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i);
      pAcc += avgNet;
      projection.push({ mes: monthLabel(d.toISOString().slice(0, 7)), Histórico: null, Projeção: Math.round(pAcc) });
    }
  }

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
    qc.invalidateQueries();
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
        <Card className="p-3 min-w-0 overflow-hidden">
          <p className="text-[11px] text-muted-foreground">Entradas</p>
          <p className="font-semibold text-success text-[13px] sm:text-base tracking-tight">{brl(income)}</p>
        </Card>
        <Card className="p-3 min-w-0 overflow-hidden">
          <p className="text-[11px] text-muted-foreground">Saídas</p>
          <p className="font-semibold text-destructive text-[13px] sm:text-base tracking-tight">{brl(expense)}</p>
        </Card>
        <Card className="p-3 min-w-0 overflow-hidden">
          <p className="text-[11px] text-muted-foreground">Saldo do mês</p>
          <p className="font-semibold text-[13px] sm:text-base tracking-tight">{brl(income - expense)}</p>
        </Card>
      </div>

      {/* Teto de gasto do dia */}
      <Card className="p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Teto de gasto do dia</p>
          <span className="text-sm text-muted-foreground">
            <strong className="text-foreground">{brl(spentToday)}</strong>
            {spendLimit > 0 && <> / {brl(spendLimit)}</>}
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

      <p className="text-[11px] text-right -mt-2 px-1">
        <Link className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          to={`/app/conselheiro?q=${encodeURIComponent("Analisa meus gastos recentes: onde estou gastando mais e o que dá para ajustar?")}`}>
          Perguntar ao Conselheiro sobre meus gastos
        </Link>
      </p>

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

      {/* ── Gráficos ─────────────────────────────────────────── */}
      <Card className="p-4 space-y-3">
        <h2 className="font-display font-semibold flex items-center gap-1.5">
          <LineChartIcon className="w-4 h-4" style={{ color: "hsl(var(--prosperidade))" }} />
          Sua vida financeira em gráficos
        </h2>

        {monthsWithData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Registre entradas e gastos para os gráficos ganharem vida — evolução, comparativos e projeção.
          </p>
        ) : (
          <Tabs defaultValue="evolucao">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="evolucao">Evolução</TabsTrigger>
              <TabsTrigger value="categorias">Categorias</TabsTrigger>
              <TabsTrigger value="projecao">Projeção</TabsTrigger>
            </TabsList>

            <TabsContent value="evolucao" className="mt-3">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={evolution} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={brlShort} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="Entradas" stroke="hsl(var(--success))" fill="hsl(var(--success) / 0.2)" strokeWidth={2} />
                    <Area type="monotone" dataKey="Saídas" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive) / 0.15)" strokeWidth={2} />
                    <Line type="monotone" dataKey="Saldo" stroke="hsl(var(--prosperidade))" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Entradas, saídas e saldo mês a mês (últimos 6 meses).</p>
            </TabsContent>

            <TabsContent value="categorias" className="mt-3">
              {catCompare.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Registre gastos com categorias para comparar os meses.</p>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={catCompare} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="categoria" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={0} angle={-18} height={44} textAnchor="end" />
                        <YAxis tickFormatter={brlShort} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="Mês anterior" fill="hsl(var(--muted-foreground) / 0.45)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Este mês" fill="hsl(var(--prosperidade))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Onde o dinheiro foi: este mês contra o anterior, por categoria.</p>
                </>
              )}
            </TabsContent>

            <TabsContent value="projecao" className="mt-3">
              {avgNet === null ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Preciso de pelo menos um mês completo de registros para projetar. Continue registrando!
                </p>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={projection} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={brlShort} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} />
                        <ReferenceLine y={0} stroke="hsl(var(--border))" />
                        <Line type="monotone" dataKey="Histórico" stroke="hsl(var(--prosperidade))" strokeWidth={2} dot={false} connectNulls={false} />
                        <Line type="monotone" dataKey="Projeção" stroke="hsl(var(--prosperidade))" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Saldo acumulado projetado: se o padrão dos últimos meses se mantiver
                    ({avgNet >= 0 ? "+" : "−"}{brl(Math.abs(avgNet))}/mês em média), este é o caminho.
                    É uma ilustração do seu próprio padrão — não previsão nem recomendação financeira.
                  </p>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </Card>

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
        {!isLoading && !monthTxs.length && (
          <p className="text-sm text-muted-foreground">
            Nenhum lançamento ainda. Registre o primeiro acima — ou conte na tela Hoje.
          </p>
        )}
        <div className="divide-y">
          {monthTxs.map((t) => (
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