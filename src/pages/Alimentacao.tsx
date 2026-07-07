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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus, Trash2, Sparkles, UtensilsCrossed, Camera, Loader2, Check, X,
  Flame, Droplet, Settings2, Undo2, Scale, Pencil, ScanLine, TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";

interface MealPayload {
  description?: string;
  summary?: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  items?: string[];
  note?: string;
  source?: string;
}
interface MealEvent { id: string; occurred_at: string; payload: MealPayload }
interface WaterEvent { id: string; occurred_at: string; payload: { ml?: number } }
interface WeightEvent { id: string; occurred_at: string; payload: { kg?: number } }
interface BodyEvent { id: string; occurred_at: string; payload: { body_fat_pct?: number; body_fat_range?: string; lean_mass_kg?: number } }

interface BodyEstimate {
  body_fat_pct: number;
  body_fat_range: string;
  lean_mass_kg?: number;
  note?: string;
}

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
  const [photoData, setPhotoData] = useState<{ data: string; media_type: string } | null>(null);
  const [photoNote, setPhotoNote] = useState("");

  // ── Personalização das garrafas ──────────────────────────────
  const bottles: WaterBottle[] = profile?.water_bottles?.length ? profile.water_bottles : DEFAULT_WATER_BOTTLES;
  const goalMl = profile?.water_goal_ml ?? DEFAULT_WATER_GOAL_ML;
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Peso e composição corporal ───────────────────────────────
  const [weightInput, setWeightInput] = useState("");
  const [weightGoalInput, setWeightGoalInput] = useState("");
  const [savingWeight, setSavingWeight] = useState(false);
  const bodyFileRef = useRef<HTMLInputElement>(null);
  const [bodyAnalyzing, setBodyAnalyzing] = useState(false);
  const [bodyEstimate, setBodyEstimate] = useState<BodyEstimate | null>(null);
  const [savingBody, setSavingBody] = useState(false);

  // ── Edição de calorias no histórico ──────────────────────────
  const [editingMeal, setEditingMeal] = useState<MealEvent | null>(null);

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

  const { data: weights } = useQuery({
    queryKey: ["weights", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 864e5).toISOString();
      const { data } = await supabase.from("life_events")
        .select("id,occurred_at,payload")
        .eq("user_id", user!.id).eq("kind", "weight").gte("occurred_at", since)
        .order("occurred_at", { ascending: true }).limit(200);
      return (data ?? []) as WeightEvent[];
    },
  });

  const { data: bodyScans } = useQuery({
    queryKey: ["body-scans", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("life_events")
        .select("id,occurred_at,payload")
        .eq("user_id", user!.id).eq("kind", "body")
        .order("occurred_at", { ascending: false }).limit(5);
      return (data ?? []) as BodyEvent[];
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

  // ── Fluxo da foto/descrição ──────────────────────────────────
  const runAnalysis = async (photo: { data: string; media_type: string } | null, note: string) => {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-meal", {
        body: {
          image: photo?.data,
          media_type: photo?.media_type,
          note: note.trim() || undefined,
        },
      });
      if (error || data?.error) throw new Error(data?.error ?? "falha");
      if (!data?.is_food || !data?.estimate) {
        toast.info(photo
          ? "Não reconheci comida nessa foto. Tente enquadrar melhor o prato ou descreva na observação."
          : "Não entendi essa descrição como uma refeição. Tente algo como \"prato de arroz, feijão e frango grelhado\".");
        return;
      }
      setEstimate(data.estimate as Estimate);
    } catch {
      toast.error("Não consegui analisar agora. Verifique sua conexão e tente de novo.");
    } finally {
      setAnalyzing(false);
    }
  };

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher a mesma foto de novo
    if (!file) return;
    try {
      const photo = await fileToResizedBase64(file);
      setPhotoData(photo);
      setEstimate(null); // foto nova invalida estimativa anterior
    } catch {
      toast.error("Não consegui abrir essa imagem. Tente outra foto.");
    }
  };

  const analyzeMeal = async () => {
    if (!photoData && !photoNote.trim()) return;
    setEstimate(null);
    await runAnalysis(photoData, photoNote);
  };

  const resetPhoto = () => {
    setEstimate(null);
    setPhotoData(null);
    setPhotoNote("");
  };

  const setCalories = (v: string) => {
    if (!estimate) return;
    const n = Math.max(0, Math.round(Number(v.replace(/\D/g, ""))));
    setEstimate({ ...estimate, calories: n });
  };

  const confirmPhoto = async () => {
    if (!user || !estimate) return;
    setSavingPhoto(true);
    const note = photoNote.trim();
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "alimentacao", kind: "meal",
      payload: {
        description: estimate.description,
        summary: `Refeição (~${estimate.calories} kcal): ${estimate.description}${note ? ` — obs: ${note}` : ""}`,
        calories: estimate.calories,
        protein_g: estimate.protein_g,
        carbs_g: estimate.carbs_g,
        fat_g: estimate.fat_g,
        items: estimate.items,
        note: note || undefined,
        source: photoData ? "photo" : "text",
      },
      source: photoData ? "photo" : "text",
    });
    setSavingPhoto(false);
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Refeição registrada. +4 XP");
    resetPhoto();
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

  // ── Peso ─────────────────────────────────────────────────────
  const logWeight = async () => {
    const kg = Number(weightInput.replace(",", "."));
    if (!user || !kg || kg < 20 || kg > 400) { toast.error("Informe um peso válido em kg. Ex.: 78,5"); return; }
    setSavingWeight(true);
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "alimentacao", kind: "weight",
      payload: { kg, summary: `Peso: ${kg} kg` }, source: "form",
    });
    setSavingWeight(false);
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Peso registrado. +3 XP");
    setWeightInput("");
    qc.invalidateQueries();
  };

  const saveWeightGoal = async () => {
    if (!user) return;
    const kg = Number(weightGoalInput.replace(",", "."));
    if (!kg || kg < 20 || kg > 400) { toast.error("Meta inválida. Ex.: 75"); return; }
    const { error } = await supabase.from("profiles").update({ weight_goal_kg: kg }).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar a meta."); return; }
    toast.success("Meta de peso salva.");
    setWeightGoalInput("");
    refreshProfile();
  };

  // ── Análise corporal por foto ────────────────────────────────
  const latestWeightKg = (weights ?? []).length
    ? Number((weights ?? [])[(weights ?? []).length - 1].payload?.kg) || undefined
    : undefined;

  const onPickBodyPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBodyEstimate(null);
    setBodyAnalyzing(true);
    try {
      const { data: img, media_type } = await fileToResizedBase64(file);
      const { data, error } = await supabase.functions.invoke("analyze-body", {
        body: { image: img, media_type, weight_kg: latestWeightKg },
      });
      if (error || data?.error) throw new Error(data?.error ?? "falha");
      if (!data?.valid || !data?.estimate) {
        toast.info(data?.reason ?? "Não consegui analisar essa foto. Tente uma foto de corpo inteiro, de frente, com boa luz.");
        return;
      }
      setBodyEstimate(data.estimate as BodyEstimate);
    } catch {
      toast.error("Não consegui analisar agora. Verifique sua conexão e tente de novo.");
    } finally {
      setBodyAnalyzing(false);
    }
  };

  const confirmBody = async () => {
    if (!user || !bodyEstimate) return;
    setSavingBody(true);
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "alimentacao", kind: "body",
      payload: {
        body_fat_pct: bodyEstimate.body_fat_pct,
        body_fat_range: bodyEstimate.body_fat_range,
        lean_mass_kg: bodyEstimate.lean_mass_kg,
        summary: `Composição corporal (estimativa por foto): ~${bodyEstimate.body_fat_pct}% de gordura`,
      },
      source: "photo",
    });
    setSavingBody(false);
    if (error) { toast.error("Não consegui salvar."); return; }
    toast.success("Estimativa registrada. +4 XP");
    setBodyEstimate(null);
    qc.invalidateQueries();
  };

  // ── Edição de calorias no histórico ──────────────────────────
  const saveMealCalories = async (meal: MealEvent, calories: number) => {
    const payload = { ...meal.payload, calories };
    const desc = payload.description ?? "Refeição";
    payload.summary = calories > 0 ? `Refeição (~${calories} kcal): ${desc}` : `Refeição: ${desc}`;
    const { error } = await supabase.from("life_events").update({ payload }).eq("id", meal.id);
    if (error) { toast.error("Não consegui atualizar."); return; }
    toast.success("Calorias atualizadas.");
    setEditingMeal(null);
    qc.invalidateQueries({ queryKey: ["meals"] });
  };

  // ── Dados dos gráficos ───────────────────────────────────────
  const weightGoal = Number(profile?.weight_goal_kg) || null;
  const weightSeries = (weights ?? [])
    .map((w) => ({ t: w.occurred_at, kg: Number(w.payload?.kg) }))
    .filter((w) => w.kg > 0)
    .map((w) => ({
      dia: new Date(w.t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
      kg: w.kg,
      ts: new Date(w.t).getTime(),
    }));

  // Tendência: regressão linear simples (kg por semana)
  const trendKgWeek = (() => {
    if (weightSeries.length < 3) return null;
    const n = weightSeries.length;
    const xs = weightSeries.map((w) => w.ts / 864e5); // dias
    const ys = weightSeries.map((w) => w.kg);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    if (!den) return null;
    return (num / den) * 7; // kg/semana
  })();

  const caloriesByDay = (() => {
    const map: Record<string, number> = {};
    for (const m of meals ?? []) {
      const kcal = Number(m.payload?.calories);
      if (kcal > 0) {
        const d = m.occurred_at.slice(0, 10);
        map[d] = (map[d] ?? 0) + kcal;
      }
    }
    const out: { dia: string; kcal: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      const iso = d.toISOString().slice(0, 10);
      if (map[iso]) out.push({ dia: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), kcal: Math.round(map[iso]) });
    }
    return out;
  })();

  const latestScan = (bodyScans ?? [])[0];

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

      {/* Foto ou descrição → calorias */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Camera className="w-4 h-4" style={{ color: "hsl(var(--alimentacao))" }} />
          Foto ou descrição, eu estimo as calorias
        </div>

        <input
          ref={fileRef} type="file" accept="image/*"
          className="hidden" onChange={onPickPhoto}
        />

        {/* Descrição da refeição (obrigatória sem foto; com foto, refina a estimativa) */}
        <div className="space-y-1">
          <Textarea
            value={photoNote}
            onChange={(e) => setPhotoNote(e.target.value)}
            placeholder={photoData
              ? 'Observação (opcional): "a carne é cupim", "comi um sagu junto"...'
              : 'Descreva a refeição: "prato de arroz, feijão, bife e salada" — ou adicione uma foto'}
            rows={2} maxLength={300}
            className="resize-none text-sm"
            disabled={analyzing}
          />
          <p className="text-[11px] text-muted-foreground">
            {photoData
              ? "Detalhes deixam a estimativa mais certeira e ficam salvos com a refeição."
              : "Dá para estimar só pela descrição, mas a foto melhora a precisão."}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary" className="flex-1 min-w-0"
            onClick={() => fileRef.current?.click()} disabled={analyzing}
          >
            <Camera className="w-4 h-4 mr-2 shrink-0" />
            <span className="truncate">{photoData ? "Trocar foto" : "Adicionar foto"}</span>
          </Button>
          <Button
            className="flex-1 min-w-0"
            onClick={analyzeMeal}
            disabled={analyzing || (!photoData && !photoNote.trim())}
          >
            {analyzing
              ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" /> Analisando...</>)
              : (<><Sparkles className="w-4 h-4 mr-2 shrink-0" /> {estimate ? "Reanalisar" : "Analisar"}</>)}
          </Button>
        </div>

        {photoData && !estimate && !analyzing && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-success" /> Foto pronta. Escreva uma observação se quiser e toque em Analisar.
          </p>
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

            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="ghost" onClick={resetPhoto} disabled={savingPhoto || analyzing}>
                <X className="w-4 h-4 mr-1" /> Descartar
              </Button>
              <Button onClick={confirmPhoto} disabled={savingPhoto || analyzing}>
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

      {/* ── Evolução corporal ────────────────────────────────── */}
      <Card className="p-4 space-y-4">
        <div>
          <h2 className="font-display font-semibold flex items-center gap-1.5">
            <Scale className="w-4 h-4" style={{ color: "hsl(var(--alimentacao))" }} />
            Evolução corporal
          </h2>
          <p className="text-xs text-muted-foreground">
            Peso, tendência e composição. O número é só um dado — a direção importa mais que o dia.
          </p>
        </div>

        {/* Registro de peso + meta */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="flex gap-2">
            <Input inputMode="decimal" placeholder="Peso de hoje (kg)" value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)} />
            <Button variant="secondary" onClick={logWeight} disabled={savingWeight}>
              {savingWeight ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
          <div className="flex gap-2">
            <Input inputMode="decimal"
              placeholder={weightGoal ? `Meta: ${String(weightGoal).replace(".", ",")} kg` : "Meta de peso (kg)"}
              value={weightGoalInput} onChange={(e) => setWeightGoalInput(e.target.value)} />
            <Button variant="outline" onClick={saveWeightGoal}>Meta</Button>
          </div>
        </div>

        {/* Gráfico de peso */}
        {weightSeries.length >= 2 ? (
          <>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weightSeries} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                      borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))",
                    }}
                    formatter={(v: number) => [`${String(v).replace(".", ",")} kg`, "Peso"]}
                  />
                  {weightGoal && (
                    <ReferenceLine y={weightGoal} stroke="hsl(var(--gold))" strokeDasharray="5 4"
                      label={{ value: "meta", fontSize: 10, fill: "hsl(var(--gold))", position: "insideTopRight" }} />
                  )}
                  <Line type="monotone" dataKey="kg" stroke="hsl(var(--alimentacao))" strokeWidth={2}
                    dot={{ r: 2.5, fill: "hsl(var(--alimentacao))" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {trendKgWeek !== null && (
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Tendência: {Math.abs(trendKgWeek) < 0.05
                    ? "peso estável nas últimas semanas."
                    : `${trendKgWeek > 0 ? "ganhando" : "perdendo"} ~${Math.abs(trendKgWeek).toFixed(1).replace(".", ",")} kg/semana.`}
                  {weightGoal && weightSeries.length > 0 && (() => {
                    const cur = weightSeries[weightSeries.length - 1].kg;
                    const diff = weightGoal - cur;
                    if (Math.abs(diff) < 0.5) return " Você está na sua meta. 🎉";
                    const rightDirection = (diff > 0 && trendKgWeek > 0.05) || (diff < 0 && trendKgWeek < -0.05);
                    return rightDirection
                      ? ` Faltam ${Math.abs(diff).toFixed(1).replace(".", ",")} kg — a direção está certa, mantenha o padrão.`
                      : ` Faltam ${Math.abs(diff).toFixed(1).replace(".", ",")} kg para a meta. Quer um plano que caiba na sua rotina e no seu bolso? Pergunte ao Conselheiro.`;
                  })()}
                </span>
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-2">
            Registre seu peso pelo menos duas vezes para o gráfico aparecer.
          </p>
        )}

        {/* Calorias por dia */}
        {caloriesByDay.length >= 2 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Calorias estimadas por dia (14 dias)</p>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={caloriesByDay} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <XAxis dataKey="dia" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
                    contentStyle={{
                      background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                      borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))",
                    }}
                    formatter={(v: number) => [`${v} kcal`, "Total"]}
                  />
                  <Bar dataKey="kcal" fill="hsl(var(--alimentacao) / 0.7)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Soma das estimativas por foto — dias sem registro não aparecem.
            </p>
          </div>
        )}

        {/* Composição corporal por foto */}
        <div className="rounded-lg border p-3 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <ScanLine className="w-4 h-4" style={{ color: "hsl(var(--alimentacao))" }} />
                Composição corporal por foto
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Estimativa visual do % de gordura e massa magra. É uma aproximação com margem
                larga — para precisão, bioimpedância ou DEXA com um profissional. A foto não fica salva.
              </p>
            </div>
          </div>

          <input ref={bodyFileRef} type="file" accept="image/*"
            className="hidden" onChange={onPickBodyPhoto} />

          {latestScan && !bodyEstimate && (
            <p className="text-xs rounded-md bg-muted px-2.5 py-1.5">
              Última estimativa ({new Date(latestScan.occurred_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}):
              ~{latestScan.payload?.body_fat_pct}% de gordura
              {latestScan.payload?.lean_mass_kg ? ` · ~${String(latestScan.payload.lean_mass_kg).replace(".", ",")} kg de massa magra` : ""}
            </p>
          )}

          {!bodyEstimate && (
            <Button variant="secondary" className="w-full"
              onClick={() => bodyFileRef.current?.click()} disabled={bodyAnalyzing}>
              {bodyAnalyzing
                ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analisando...</>)
                : (<><Camera className="w-4 h-4 mr-2" /> Enviar foto de corpo inteiro</>)}
            </Button>
          )}

          {bodyEstimate && (
            <div className="space-y-2.5 animate-fade-up">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-muted px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Gordura corporal (faixa)</p>
                  <p className="text-sm font-semibold">{bodyEstimate.body_fat_range}</p>
                </div>
                <div className="rounded-md bg-muted px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Massa magra estimada</p>
                  <p className="text-sm font-semibold">
                    {bodyEstimate.lean_mass_kg
                      ? `~${String(bodyEstimate.lean_mass_kg).replace(".", ",")} kg`
                      : "registre seu peso p/ calcular"}
                  </p>
                </div>
              </div>
              {bodyEstimate.note && <p className="text-xs text-muted-foreground italic">{bodyEstimate.note}</p>}
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setBodyEstimate(null)} disabled={savingBody}>
                  <X className="w-4 h-4 mr-1" /> Descartar
                </Button>
                <Button size="sm" onClick={confirmBody} disabled={savingBody}>
                  {savingBody ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Check className="w-4 h-4 mr-1" /> Registrar</>)}
                </Button>
              </div>
            </div>
          )}
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
                    <div className="flex-1 min-w-0">
                      <span className="text-sm break-words">
                        {m.payload?.description ?? m.payload?.summary ?? "Refeição"}
                      </span>
                      {m.payload?.note && (
                        <span className="block text-xs text-muted-foreground italic break-words">obs: {m.payload.note}</span>
                      )}
                    </div>
                    {Number(m.payload?.calories) > 0 && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground rounded-full bg-muted px-2 py-0.5">
                        <Flame className="w-3 h-3" /> {Math.round(Number(m.payload!.calories))} kcal
                      </span>
                    )}
                    <Button variant="ghost" size="icon" className="w-7 h-7 shrink-0 text-muted-foreground"
                      onClick={() => setEditingMeal(m)} aria-label="Editar calorias">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
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

      <CalorieEditDialog
        meal={editingMeal}
        onClose={() => setEditingMeal(null)}
        onSave={saveMealCalories}
      />
    </div>
  );
}

/** Diálogo para editar as calorias de uma refeição já registrada. */
function CalorieEditDialog({
  meal, onClose, onSave,
}: {
  meal: MealEvent | null;
  onClose: () => void;
  onSave: (meal: MealEvent, calories: number) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Sincroniza quando abre com outra refeição
  const current = meal ? String(Math.round(Number(meal.payload?.calories) || 0)) : "";

  const save = async () => {
    if (!meal) return;
    const n = Math.max(0, Math.round(Number((value || current).replace(/\D/g, ""))));
    setSaving(true);
    await onSave(meal, n);
    setSaving(false);
    setValue("");
  };

  return (
    <Dialog open={!!meal} onOpenChange={(v) => { if (!v) { setValue(""); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar calorias</DialogTitle>
          <DialogDescription className="break-words">
            {meal?.payload?.description ?? "Refeição"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--alimentacao))" }} />
          <Input
            inputMode="numeric" autoFocus
            className="h-9 w-28 text-base font-semibold"
            placeholder={current || "0"}
            value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            aria-label="Calorias"
          />
          <span className="text-sm text-muted-foreground">kcal</span>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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