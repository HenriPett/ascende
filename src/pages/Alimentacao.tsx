import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  useProfile, DEFAULT_WATER_BOTTLES, DEFAULT_WATER_GOAL_ML, type WaterBottle,
} from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus, Trash2, Sparkles, UtensilsCrossed, Camera, Loader2, Check, X,
  Flame, Droplet, Settings2, Undo2,
} from "lucide-react";

interface MealPayload {
  description?: string;
  summary?: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  items?: string[];
  source?: string;
}
interface MealEvent { id: string; occurred_at: string; payload: MealPayload }
interface WaterEvent { id: string; occurred_at: string; payload: { ml?: number } }

interface Estimate {
  description: string;
  items: string[];
  calories: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  confidence: "baixa" | "media" | "alta";
  note?: string;
}

/** Redimensiona a foto no navegador antes de enviar (economiza dados e tempo). */
function fileToResizedBase64(file: File, maxDim = 1024): Promise<{ data: string; media_type: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("canvas")); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      resolve({ data: dataUrl.split(",")[1], media_type: "image/jpeg" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não consegui abrir a imagem.")); };
    img.src = url;
  });
}

const confidenceLabel: Record<Estimate["confidence"], string> = {
  baixa: "confiança baixa", media: "confiança média", alta: "confiança alta",
};

export default function Alimentacao() {
  const { user } = useAuth();
  const { profile, refresh: refreshProfile } = useProfile();
  const qc = useQueryClient();
  const [meal, setMeal] = useState("");

  // ── Foto da refeição ─────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);

  // ── Personalização das garrafas ──────────────────────────────
  const bottles: WaterBottle[] = profile?.water_bottles?.length ? profile.water_bottles : DEFAULT_WATER_BOTTLES;
  const goalMl = profile?.water_goal_ml ?? DEFAULT_WATER_GOAL_ML;
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: meals, isLoading } = useQuery({
    queryKey: ["meals", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data } = await supabase.from("life_events")
        .select("id,occurred_at,payload")
        .eq("user_id", user!.id).eq("kind", "meal").gte("occurred_at", since)
        .order("occurred_at", { ascending: false }).limit(100);
      return (data ?? []) as MealEvent[];
    },
  });

  const { data: waterToday } = useQuery({
    queryKey: ["water-today", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const { data } = await supabase.from("life_events")
        .select("id,occurred_at,payload")
        .eq("user_id", user!.id).eq("kind", "water").gte("occurred_at", dayStart.toISOString())
        .order("occurred_at", { ascending: false });
      return (data ?? []) as WaterEvent[];
    },
  });

  const addText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !meal.trim()) return;
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "alimentacao", kind: "meal",
      payload: { description: meal.trim(), summary: `Refeição: ${meal.trim()}` }, source: "form",
    });
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Refeição registrada. +4 XP");
    setMeal("");
    qc.invalidateQueries();
  };

  const remove = async (id: string) => {
    await supabase.from("life_events").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["meals"] });
  };

  // ── Fluxo da foto ────────────────────────────────────────────
  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher a mesma foto de novo
    if (!file) return;
    setEstimate(null);
    setAnalyzing(true);
    try {
      const { data: img, media_type } = await fileToResizedBase64(file);
      const { data, error } = await supabase.functions.invoke("analyze-meal", {
        body: { image: img, media_type },
      });
      if (error || data?.error) throw new Error(data?.error ?? "falha");
      if (!data?.is_food || !data?.estimate) {
        toast.info("Não reconheci comida nessa foto. Tente enquadrar melhor o prato.");
        return;
      }
      setEstimate(data.estimate as Estimate);
    } catch {
      toast.error("Não consegui analisar a foto agora. Verifique sua conexão e tente de novo.");
    } finally {
      setAnalyzing(false);
    }
  };

  const setCalories = (v: string) => {
    if (!estimate) return;
    const n = Math.max(0, Math.round(Number(v.replace(/\D/g, ""))));
    setEstimate({ ...estimate, calories: n });
  };

  const confirmPhoto = async () => {
    if (!user || !estimate) return;
    setSavingPhoto(true);
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "alimentacao", kind: "meal",
      payload: {
        description: estimate.description,
        summary: `Refeição (~${estimate.calories} kcal): ${estimate.description}`,
        calories: estimate.calories,
        protein_g: estimate.protein_g,
        carbs_g: estimate.carbs_g,
        fat_g: estimate.fat_g,
        items: estimate.items,
        source: "photo",
      },
      source: "photo",
    });
    setSavingPhoto(false);
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Refeição registrada pela foto. +4 XP");
    setEstimate(null);
    qc.invalidateQueries();
  };

  // ── Água ─────────────────────────────────────────────────────
  const totalMl = (waterToday ?? []).reduce((s, w) => s + (Number(w.payload?.ml) || 0), 0);
  const pct = goalMl > 0 ? Math.min(1, totalMl / goalMl) : 0;

  const addWater = async (ml: number) => {
    if (!user || ml <= 0) return;
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "alimentacao", kind: "water",
      payload: { ml, summary: `Água: ${ml} ml` }, source: "form",
    });
    if (error) { toast.error("Não consegui registrar."); return; }
    qc.invalidateQueries({ queryKey: ["water-today", user.id] });
  };

  const undoWater = async () => {
    const last = (waterToday ?? [])[0];
    if (!last) return;
    await supabase.from("life_events").delete().eq("id", last.id);
    qc.invalidateQueries({ queryKey: ["water-today", user?.id] });
  };

  // Agrupa refeições por dia
  const byDay: Record<string, MealEvent[]> = {};
  for (const m of meals ?? []) {
    const day = m.occurred_at.slice(0, 10);
    (byDay[day] ??= []).push(m);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold" style={{ color: "hsl(var(--alimentacao))" }}>
          Alimentação
        </h1>
        <p className="text-sm text-muted-foreground">
          Registre o que come pela foto ou em texto. Calorias aqui são estimativa, não obsessão —
          padrão importa mais que perfeição.
        </p>
      </div>

      {/* O recurso-símbolo: plano alimentar que cabe no orçamento */}
      <Card className="p-4 border-gold/30 bg-gold/5">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-gold mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Plano alimentar que cabe no seu bolso</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              O Conselheiro conhece seu orçamento, seus gastos com comida e seus objetivos.
              Peça um plano que respeite os três — nenhum app de dieta consegue isso.
            </p>
            <Button asChild size="sm" className="mt-2.5">
              <Link to="/app/conselheiro">Montar meu plano</Link>
            </Button>
          </div>
        </div>
      </Card>

      {/* Foto da refeição → calorias */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Camera className="w-4 h-4" style={{ color: "hsl(var(--alimentacao))" }} />
          Tire uma foto e eu estimo as calorias
        </div>

        <input
          ref={fileRef} type="file" accept="image/*" capture="environment"
          className="hidden" onChange={onPickPhoto}
        />

        {!estimate && (
          <Button
            variant="secondary" className="w-full"
            onClick={() => fileRef.current?.click()} disabled={analyzing}
          >
            {analyzing
              ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analisando a foto...</>)
              : (<><Camera className="w-4 h-4 mr-2" /> Tirar / escolher foto</>)}
          </Button>
        )}

        {estimate && (
          <div className="space-y-3 animate-fade-up">
            <div className="rounded-lg border p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">{estimate.description}</p>
                  {!!estimate.items.length && (
                    <p className="text-xs text-muted-foreground mt-0.5">{estimate.items.join(" · ")}</p>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap rounded-full bg-muted px-2 py-0.5">
                  {confidenceLabel[estimate.confidence]}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--alimentacao))" }} />
                <Input
                  inputMode="numeric"
                  className="h-9 w-24 text-base font-semibold"
                  value={String(estimate.calories)}
                  onChange={(e) => setCalories(e.target.value)}
                  aria-label="Calorias estimadas"
                />
                <span className="text-sm text-muted-foreground">kcal (ajuste se quiser)</span>
              </div>

              {(estimate.protein_g || estimate.carbs_g || estimate.fat_g) && (
                <div className="flex gap-2 text-xs text-muted-foreground">
                  {estimate.protein_g != null && <span className="rounded bg-muted px-2 py-1">Proteína {estimate.protein_g}g</span>}
                  {estimate.carbs_g != null && <span className="rounded bg-muted px-2 py-1">Carbo {estimate.carbs_g}g</span>}
                  {estimate.fat_g != null && <span className="rounded bg-muted px-2 py-1">Gordura {estimate.fat_g}g</span>}
                </div>
              )}

              {estimate.note && <p className="text-xs text-muted-foreground italic">{estimate.note}</p>}
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setEstimate(null)} disabled={savingPhoto}>
                <X className="w-4 h-4 mr-1" /> Descartar
              </Button>
              <Button onClick={confirmPhoto} disabled={savingPhoto}>
                {savingPhoto ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Check className="w-4 h-4 mr-1" /> Registrar</>)}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Hidratação */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Droplet className="w-4 h-4" style={{ color: "hsl(var(--alimentacao))" }} />
            Hidratação de hoje
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground"
            onClick={() => setSettingsOpen(true)}>
            <Settings2 className="w-4 h-4 mr-1.5" /> Personalizar
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <WaterRing pct={pct} />
          <div className="min-w-0">
            <p className="text-lg font-semibold">
              {(totalMl / 1000).toFixed(totalMl % 1000 === 0 ? 0 : 2).replace(".", ",")} L
              <span className="text-sm font-normal text-muted-foreground"> / {(goalMl / 1000).toString().replace(".", ",")} L</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {pct >= 1 ? "Meta batida hoje. Mandou bem!" : `Faltam ${((goalMl - totalMl) / 1000).toFixed(2).replace(".", ",")} L`}
            </p>
            {!!(waterToday ?? []).length && (
              <button onClick={undoWater} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <Undo2 className="w-3 h-3" /> desfazer último
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {bottles.map((b, i) => (
            <Button key={i} variant="secondary" size="sm" className="gap-1.5"
              onClick={() => addWater(b.ml)}>
              <Plus className="w-3.5 h-3.5" />
              {b.label} <span className="text-muted-foreground">· {b.ml >= 1000 ? `${(b.ml / 1000).toString().replace(".", ",")}L` : `${b.ml}ml`}</span>
            </Button>
          ))}
        </div>
      </Card>

      {/* Registro rápido em texto */}
      <Card className="p-4">
        <form onSubmit={addText} className="flex gap-2">
          <Input maxLength={140} placeholder="Ou descreva: almoço — frango, arroz e salada"
            value={meal} onChange={(e) => setMeal(e.target.value)} />
          <Button type="submit" size="icon" aria-label="Registrar refeição"><Plus className="w-4 h-4" /></Button>
        </form>
      </Card>

      {/* Histórico 14 dias */}
      <Card className="p-4">
        <h2 className="font-display font-semibold mb-3">Últimos 14 dias</h2>
        {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
        {!isLoading && !(meals ?? []).length && (
          <div className="text-center py-6">
            <UtensilsCrossed className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Nenhuma refeição registrada ainda.<br />Tire uma foto acima, descreva em texto — ou conte na tela Hoje: "almocei frango com arroz".
            </p>
          </div>
        )}
        <div className="space-y-4">
          {Object.entries(byDay).map(([day, items]) => (
            <div key={day}>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                {new Date(day + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" })}
              </p>
              <div className="space-y-1">
                {items.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-md border p-2.5">
                    <span className="text-sm flex-1 min-w-0 break-words">
                      {m.payload?.description ?? m.payload?.summary ?? "Refeição"}
                    </span>
                    {Number(m.payload?.calories) > 0 && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground rounded-full bg-muted px-2 py-0.5">
                        <Flame className="w-3 h-3" /> {Math.round(Number(m.payload!.calories))} kcal
                      </span>
                    )}
                    <Button variant="ghost" size="icon" className="w-7 h-7 shrink-0 text-muted-foreground"
                      onClick={() => remove(m.id)} aria-label="Excluir refeição">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <WaterSettingsDialog
        open={settingsOpen} onOpenChange={setSettingsOpen}
        initialGoalMl={goalMl} initialBottles={bottles}
        onSaved={refreshProfile}
      />
    </div>
  );
}

/** Anel de progresso da hidratação. */
function WaterRing({ pct }: { pct: number }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0" aria-hidden>
      <circle cx="34" cy="34" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="7" />
      <circle
        cx="34" cy="34" r={r} fill="none" stroke="hsl(var(--alimentacao))" strokeWidth="7"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 34 34)" style={{ transition: "stroke-dashoffset .4s ease" }}
      />
      <text x="34" y="38" textAnchor="middle" className="fill-foreground" style={{ fontSize: 15, fontWeight: 600 }}>
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

/** Diálogo para personalizar meta diária e as garrafas/copos. */
function WaterSettingsDialog({
  open, onOpenChange, initialGoalMl, initialBottles, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialGoalMl: number;
  initialBottles: WaterBottle[];
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [goalL, setGoalL] = useState(String(initialGoalMl / 1000).replace(".", ","));
  const [rows, setRows] = useState<WaterBottle[]>(initialBottles.map((b) => ({ ...b })));
  const [saving, setSaving] = useState(false);

  // Sincroniza ao (re)abrir
  const reset = () => {
    setGoalL(String(initialGoalMl / 1000).replace(".", ","));
    setRows(initialBottles.map((b) => ({ ...b })));
  };

  const setRow = (i: number, patch: Partial<WaterBottle>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { label: "", ml: 300 }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const save = async () => {
    if (!user) return;
    const goalMl = Math.round(Number(goalL.replace(",", ".")) * 1000);
    if (!goalMl || goalMl < 500 || goalMl > 8000) {
      toast.error("Defina uma meta entre 0,5 L e 8 L.");
      return;
    }
    const clean = rows
      .map((r) => ({ label: r.label.trim(), ml: Math.round(Number(String(r.ml).replace(",", "."))) }))
      .filter((r) => r.label && r.ml > 0 && r.ml <= 5000);
    if (!clean.length) {
      toast.error("Deixe pelo menos uma garrafa válida (nome e volume).");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("profiles")
      .update({ water_goal_ml: goalMl, water_bottles: clean })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Preferências de hidratação salvas.");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Personalizar hidratação</DialogTitle>
          <DialogDescription>
            Defina sua meta do dia e o tamanho das garrafas/copos que você usa. Isso deixa o registro
            de um toque.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="water-goal">Meta diária (litros)</Label>
            <Input id="water-goal" inputMode="decimal" value={goalL}
              onChange={(e) => setGoalL(e.target.value)} placeholder="Ex.: 2,5" className="w-32" />
          </div>

          <div className="space-y-2">
            <Label>Minhas garrafas / copos</Label>
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="flex-1 min-w-0" maxLength={20} placeholder="Nome (ex.: Garrafa)"
                  value={r.label} onChange={(e) => setRow(i, { label: e.target.value })}
                />
                <div className="flex items-center gap-1 shrink-0">
                  <Input
                    className="w-20" inputMode="numeric" placeholder="ml"
                    value={String(r.ml)}
                    onChange={(e) => setRow(i, { ml: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                  />
                  <span className="text-xs text-muted-foreground">ml</span>
                </div>
                <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0 text-muted-foreground"
                  onClick={() => removeRow(i)} aria-label="Remover">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addRow} className="w-full">
              <Plus className="w-4 h-4 mr-1.5" /> Adicionar garrafa
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}