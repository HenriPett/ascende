/* AÇÕES RÁPIDAS — registrar em 1 toque: água, humor, gasto, refeição, treino.
 *
 * POR QUE ISTO SAIU DE Hoje.tsx
 *
 * REGISTRAR é o alvo central da barra de navegação e existe em TODA tela do
 * app (AppLayout.tsx). Mas a folha que ele abre continha só a CaptureBar — o
 * caminho de IA. Quem estava na Prosperidade e queria marcar um copo de água
 * pagava: abrir a folha, digitar, tocar Registrar, esperar a chamada de rede
 * do `capture`, ler a proposta e confirmar. Quatro interações e uma espera,
 * para um copo de água. O caminho de 1 toque para a MESMA água existia,
 * funcionava, e estava a duas telas de distância.
 *
 * A confirmação em duas etapas da captura por IA é contrato (a IA nunca grava
 * sozinha) e não se toca nela. O que se corrigiu foi a ausência do atalho onde
 * ele não custa contrato nenhum: estas ações escrevem direto, porque foi a
 * própria pessoa que escolheu o valor no botão — não há nada a confirmar.
 *
 * O componente já se esconde sozinho quando nenhum tracker relevante está
 * ativo, então na folha de quem desligou tudo nada muda.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, DEFAULT_WATER_GOAL_ML, DEFAULT_WATER_BOTTLES } from "@/hooks/useProfile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Droplet, Camera, Dumbbell } from "lucide-react";
import { CATEGORIES } from "@/lib/prosperidade";
import { activePillarSet } from "@/lib/pillars";
import { activeTrackerSet } from "@/lib/trackers";
import { invalidateKeys, FINANCE_KEYS, LIFE_DATA_KEYS } from "@/lib/queryKeys";
import { xpToastSuffix } from "@/lib/xp";
import { todayISO } from "@/lib/format";

/* ── Gasto rápido inline (plano de feedbacks): registrar um gasto do dia a
   dia não deveria custar uma navegação. O botão abre um diálogo de 2 toques
   (valor + categoria) e grava direto em `transactions` — o gráfico e o
   Conselheiro enxergam na hora. O pilar completo continua a um link. ── */
const QUICK_EXPENSE_CATEGORIES = CATEGORIES.filter((c) => c !== "Salário" && c !== "Extra");

function QuickExpense({ disabled }: { disabled?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("Mercado");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const value = Number(String(amount).replace(",", "."));
    if (!user || !value || value <= 0) { toast.error("Informe um valor válido em reais, como 30."); return; }
    setSaving(true);
    const { error } = await supabase.from("transactions").insert({
      user_id: user.id, kind: "expense", amount: value,
      category, occurred_at: todayISO(), source: "manual",
    });
    setSaving(false);
    if (error) { toast.error("Não consegui registrar o gasto. Tente de novo."); return; }
    toast.success(`Gasto de R$ ${value.toFixed(2).replace(".", ",")} · ${category} registrado. +2 XP${xpToastSuffix()}`);
    setAmount(""); setOpen(false);
    invalidateKeys(qc, FINANCE_KEYS);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-60"
      >
        <span className="text-[13px] font-semibold" style={{ color: "hsl(var(--prosperidade))" }} aria-hidden>R$</span> Gasto
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar gasto</DialogTitle>
            <DialogDescription>Valor e categoria — dois toques e pronto.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              inputMode="decimal"
              autoFocus
              placeholder="Valor (R$)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                {QUICK_EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button className="w-full" onClick={save} disabled={saving}>
              {saving ? "Registrando…" : "Registrar gasto"}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Descrição, data e entradas ficam no{" "}
              <Link to="/app/prosperidade" className="underline underline-offset-2" onClick={() => setOpen(false)}>
                pilar Prosperidade
              </Link>.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Ações rápidas (3.1): água, humor e foto em 1 toque ── */
const QUICK_MOODS = [
  { score: 1, emoji: "😞", label: "péssimo" },
  { score: 2, emoji: "🙁", label: "ruim" },
  { score: 3, emoji: "😐", label: "ok" },
  { score: 4, emoji: "🙂", label: "bem" },
  { score: 5, emoji: "😄", label: "ótimo" },
];

/* O sinal de que a lista rola para o lado.
 *
 * O último chip era cortado na borda seca: um corte assim lê como "acabou
 * mal desenhado", não como "tem mais coisa aqui". Um degradê que apaga o
 * conteúdo na borda direita é o sinal — e como é MÁSCARA, não um retângulo
 * colorido por cima, funciona sobre qualquer fundo (o `bg-ether` tem auras,
 * um gradiente de cor fixa denunciaria a emenda). Onde `mask-image` não
 * existe, simplesmente não há fade: nada quebra.
 *
 * Ele some ao chegar no fim e nunca aparece quando não há o que rolar —
 * um fade permanente prometeria conteúdo que não existe. */
const FADE_ROLAGEM = "linear-gradient(to right, #000 calc(100% - 2rem), transparent)";

export default function QuickActions() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const bottles = profile?.water_bottles?.length ? profile.water_bottles : DEFAULT_WATER_BOTTLES;
  // Modularidade TOTAL: cada ação rápida pertence a um TRACKER (não mais só
  // ao pilar). Quem desligou "água" não vê os botões de água — desligar
  // esconde, nunca apaga (o histórico continua da pessoa).
  const trackers = activeTrackerSet(profile);
  const showWater = trackers.has("water");
  const showMood = trackers.has("mood");
  const showMeal = trackers.has("meals");
  const showExpense = activePillarSet(profile?.pillars).has("prosperidade");
  const showWorkout = trackers.has("workouts");

  const insert = async (key: string, row: Record<string, unknown>, okMsg: string) => {
    if (!user || savingKey) return;
    setSavingKey(key);
    const { error } = await supabase.from("life_events").insert({ user_id: user.id, source: "form", ...row });
    setSavingKey(null);
    if (error) { toast.error("Não consegui registrar. Tente de novo."); return; }
    toast.success(okMsg + xpToastSuffix());
    invalidateKeys(qc, LIFE_DATA_KEYS);
  };

  const addWater = (ml: number, label: string) =>
    insert(`w${ml}`, { pillar: "alimentacao", kind: "water", payload: { ml, summary: `Água: ${ml} ml` } },
      `${label} registrada (+${ml} ml). +2 XP`);

  const logMood = (score: number, emoji: string, label: string) =>
    insert(`m${score}`, { pillar: "mente", kind: "mood", payload: { score, label, summary: `Humor: ${label}` } },
      `Humor ${emoji} registrado. +5 XP`);

  // Quais chips existem decide se sobra o que rolar — por isso entram nas
  // dependências da medição, e não só o tamanho da janela.
  const trilho = useRef<HTMLDivElement>(null);
  const [rolaMais, setRolaMais] = useState(false);
  const medir = useCallback(() => {
    const el = trilho.current;
    if (!el) return;
    // -1px de folga: navegadores devolvem scrollLeft fracionário no fim.
    setRolaMais(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  useEffect(() => {
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [medir, showWater, showMood, showMeal, showExpense, showWorkout, bottles]);

  if (!showWater && !showMood && !showMeal && !showExpense && !showWorkout) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground px-0.5">Registro em 1 toque</p>
      <div
        ref={trilho}
        onScroll={medir}
        className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
        style={{
          scrollbarWidth: "none",
          ...(rolaMais ? { maskImage: FADE_ROLAGEM, WebkitMaskImage: FADE_ROLAGEM } : {}),
        }}
      >
        {showWater && bottles.slice(0, 3).map((b) => (
          <button
            key={`${b.ml}-${b.label}`}
            onClick={() => addWater(b.ml, b.label)}
            disabled={!!savingKey}
            className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-60"
          >
            <Droplet className="w-3.5 h-3.5" style={{ color: "hsl(205 70% 55%)" }} />
            {b.label} <span className="text-muted-foreground">{b.ml}ml</span>
          </button>
        ))}
        {showWater && (showMood || showMeal || showExpense || showWorkout) && (
          <span className="shrink-0 w-px bg-border my-1.5" aria-hidden />
        )}
        {showMood && QUICK_MOODS.map((m) => (
          <button
            key={m.score}
            onClick={() => logMood(m.score, m.emoji, m.label)}
            disabled={!!savingKey}
            className="shrink-0 h-11 w-11 rounded-full border bg-card text-lg grid place-items-center hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-60"
            aria-label={`Registrar humor ${m.label}`}
            title={`Humor: ${m.label}`}
          >
            {m.emoji}
          </button>
        ))}
        {showMood && (showMeal || showExpense || showWorkout) && (
          <span className="shrink-0 w-px bg-border my-1.5" aria-hidden />
        )}
        {showMeal && (
          <Link
            to="/app/alimentacao"
            className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all"
          >
            <Camera className="w-3.5 h-3.5" style={{ color: "hsl(var(--alimentacao))" }} /> Refeição
          </Link>
        )}
        {showExpense && <QuickExpense disabled={!!savingKey} />}
        {showWorkout && (
          <Link
            to="/app/vitalidade"
            className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all"
          >
            <Dumbbell className="w-3.5 h-3.5" style={{ color: "hsl(var(--vitalidade))" }} /> Treino
          </Link>
        )}
      </div>
    </div>
  );
}
