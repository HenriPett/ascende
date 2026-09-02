import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todayISOInSP, dateISOInSP, daysAgoISOInSP } from "@/lib/dates";
import { useAuth } from "@/hooks/useAuth";
import {
  useProfile, DEFAULT_WATER_BOTTLES, DEFAULT_WATER_GOAL_ML, type WaterBottle,
} from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import QueryError from "@/components/core/QueryError";
import GoalInput from "@/components/core/GoalInput";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus, Trash2, Sparkles, UtensilsCrossed, Camera, Loader2, Check, X,
  Flame, Droplet, Settings2, Undo2, Scale, Pencil, TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { activeTrackerSet } from "@/lib/trackers";

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
  /* Modularidade total: água, peso/corpo e a própria meta calórica são
     trackers desligáveis. Desligado some da tela (e da cobrança do
     briefing); o histórico continua da pessoa. */
  const { user } = useAuth();
  const { profile, refresh: refreshProfile } = useProfile();
  const trackers = activeTrackerSet(profile);
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
  const [calorieGoalInput, setCalorieGoalInput] = useState("");
  const [savingWeight, setSavingWeight] = useState(false);
  // (composição corporal por foto suspensa — plano §4.1; estados removidos)

  // ── Edição de calorias no histórico ──────────────────────────
  const [editingMeal, setEditingMeal] = useState<MealEvent | null>(null);

  const { data: meals, isLoading, isError: mealsError, refetch: refetchMeals, isFetching: mealsFetching } = useQuery({
    queryKey: ["meals", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data, error } = await supabase.from("life_events")
        .select("id,occurred_at,payload")
        .eq("user_id", user!.id).eq("kind", "meal").gte("occurred_at", since)
        .order("occurred_at", { ascending: false }).limit(100);
      // Falha virava lista vazia, e lista vazia aqui vira "nenhuma refeição
      // registrada ainda" — a tela de quem nunca usou o app.
      if (error) throw error;
      return (data ?? []) as MealEvent[];
    },
  });

  const { data: waterToday } = useQuery({
    queryKey: ["water-today", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const { data, error } = await supabase.from("life_events")
        .select("id,occurred_at,payload")
        .eq("user_id", user!.id).eq("kind", "water").gte("occurred_at", dayStart.toISOString())
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WaterEvent[];
    },
  });

  const { data: weights } = useQuery({
    queryKey: ["weights", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 864e5).toISOString();
      const { data, error } = await supabase.from("life_events")
        .select("id,occurred_at,payload")
        .eq("user_id", user!.id).eq("kind", "weight").gte("occurred_at", since)
        .order("occurred_at", { ascending: true }).limit(200);
      if (error) throw error;
      return (data ?? []) as WeightEvent[];
    },
  });

  const addText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !meal.trim()) return;
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "alimentacao", kind: "meal",
      payload: { description: meal.trim(), summary: `Refeição: ${meal.trim()}` }, source: "form",
    });
    if (error) { toast.error("Não consegui salvar a refeição. Tente de novo."); return; }
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
    if (error) { toast.error("Não consegui salvar a refeição. Tente de novo."); return; }
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
    if (error) { toast.error("Não consegui registrar a água. Tente de novo."); return; }
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
    if (!user || !kg || kg < 20 || kg > 400) { toast.error("Informe um peso válido em kg, como 78,5."); return; }
    setSavingWeight(true);
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "alimentacao", kind: "weight",
      payload: { kg, summary: `Peso: ${kg} kg` }, source: "form",
    });
    setSavingWeight(false);
    if (error) { toast.error("Não consegui salvar o peso. Tente de novo."); return; }
    toast.success("Peso registrado. +3 XP");
    setWeightInput("");
    qc.invalidateQueries();
  };

  const saveCalorieGoalRaw = async (raw: string) => {
    if (!user) return;
    const kcal = Math.round(Number(raw.replace(/\D/g, "")));
    if (!kcal || kcal < 800 || kcal > 8000) { toast.error("Para montar seu plano com segurança, eu trabalho entre 800 e 8000 kcal por dia. Qual número, dentro disso, é o seu?"); return; }
    const { error } = await supabase.from("profiles").update({ calorie_goal_kcal: kcal }).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar a meta. Tente de novo."); return; }
    toast.success("Meta calórica diária salva. Acompanhe na tela Hoje.");
    setCalorieGoalInput("");
    refreshProfile();
  };

  const saveWeightGoal = async () => {
    if (!user) return;
    const kg = Number(weightGoalInput.replace(",", "."));
    if (!kg || kg < 20 || kg > 400) { toast.error("Só consigo guardar metas de peso entre 20 e 400 kg. Escreva assim: 75 ou 78,5."); return; }
    const { error } = await supabase.from("profiles").update({ weight_goal_kg: kg }).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar a meta. Tente de novo."); return; }
    toast.success("Meta de peso salva.");
    setWeightGoalInput("");
    refreshProfile();
  };

  // ── Análise corporal por foto: SUSPENSA (plano §4.1) ─────────
  // Handlers removidos junto com o cartão da interface; estimativas antigas
  // (kind "body") permanecem no banco, sem novo destaque.

  // ── Edição de calorias no histórico ──────────────────────────
  const saveMealCalories = async (meal: MealEvent, calories: number) => {
    const payload = { ...meal.payload, calories };
    const desc = payload.description ?? "Refeição";
    payload.summary = calories > 0 ? `Refeição (~${calories} kcal): ${desc}` : `Refeição: ${desc}`;
    const { error } = await supabase.from("life_events").update({ payload }).eq("id", meal.id);
    if (error) { toast.error("Não consegui atualizar as calorias. Tente de novo."); return; }
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
        // A chave era GRAVADA em UTC (slice) e LIDA em São Paulo (linha
        // abaixo, daysAgoISOInSP): jantar às 22:00 de 21/03 chega como
        // 2024-03-22T01:00:00Z, caía na barra do dia 22 e sumia da do 21.
        // Quem janta depois das 21:00 via o gráfico inteiro deslocado.
        const d = dateISOInSP(m.occurred_at);
        map[d] = (map[d] ?? 0) + kcal;
      }
    }
    const out: { dia: string; kcal: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      const iso = daysAgoISOInSP(i); // dia no fuso de São Paulo (plano §5.4)
      if (map[iso]) out.push({ dia: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), kcal: Math.round(map[iso]) });
    }
    return out;
  })();

  // Progresso calórico de HOJE (fuso de São Paulo — plano §5.4)
  const todayIso = todayISOInSP();
  const kcalToday = Math.round((meals ?? [])
    .filter((m) => dateISOInSP(m.occurred_at) === todayIso)
    .reduce((sum, m) => sum + (Number(m.payload?.calories) || 0), 0));
  const kcalGoal = Number(profile?.calorie_goal_kcal) || 0;

  // Agrupa refeições por dia
  const byDay: Record<string, MealEvent[]> = {};
  for (const m of meals ?? []) {
    // Mesmo fuso do filtro de "hoje" logo acima: sem isto, todo jantar
    // depois das 21:00 aparecia na lista do dia seguinte.
    const day = dateISOInSP(m.occurred_at);
    (byDay[day] ??= []).push(m);
  }

  return (
    <div className="max-w-2xl lg:max-w-4xl mx-auto space-y-4 animate-fade-up">
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

      {/* Abas: menos scroll, mais intenção */}
      <Tabs defaultValue="hoje" className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="hoje">Hoje</TabsTrigger>
          <TabsTrigger value="corpo">Corpo</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="hoje" className="space-y-4 mt-0">
        {/* ── Meta calórica do dia (tracker Refeições) ─────────── */}
        {trackers.has("meals") && (
        <Card className="p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            {/* Sem meta definida, "Meta do dia" ao lado do consumido faz o
                consumido parecer a meta (achado nº 4 do QA). */}
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Flame className="w-4 h-4" style={{ color: "hsl(var(--alimentacao))" }} />
              {kcalGoal > 0 ? "Meta do dia" : "Consumido hoje"}
            </p>
            <span className="text-sm text-muted-foreground">
              <strong className="text-foreground">{kcalToday.toLocaleString("pt-BR")}</strong>
              {kcalGoal > 0 ? <> / {kcalGoal.toLocaleString("pt-BR")}</> : null} kcal
              {kcalGoal === 0 && <> · sem meta definida</>}
            </span>
          </div>

          {kcalGoal > 0 && (
            <>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (kcalToday / kcalGoal) * 100)}%`, background: "hsl(var(--alimentacao))" }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {kcalToday < kcalGoal
                  ? `Faltam ${(kcalGoal - kcalToday).toLocaleString("pt-BR")} kcal para a meta.`
                  : "Meta do dia alcançada. 🎉"}
              </p>
            </>
          )}

          <GoalInput
            inputMode="numeric"
            placeholder="Definir meta diária (kcal)"
            currentLabel={kcalGoal > 0 ? `Meta: ${kcalGoal.toLocaleString("pt-BR")} kcal/dia` : null}
            onSubmit={(raw) => { setCalorieGoalInput(raw); saveCalorieGoalRaw(raw); }}
          />
          {kcalGoal === 0 && (
            <p className="text-[11px] text-muted-foreground">
              Dica: peça um plano alimentar ao Conselheiro — ao salvar, a meta do plano é aplicada aqui automaticamente.
            </p>
          )}
        </Card>
        )}


        {/* Foto ou descrição → calorias (tracker Refeições) */}
        {trackers.has("meals") && (<>
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Camera className="w-4 h-4" style={{ color: "hsl(var(--alimentacao))" }} />
            Manda a foto ou descreva — o Ascende estima as calorias
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


        {/* Registro rápido em texto */}
        <Card className="p-4">
          <form onSubmit={addText} className="flex gap-2">
            <Input maxLength={140} placeholder="Ou descreva: almoço — frango, arroz e salada"
              value={meal} onChange={(e) => setMeal(e.target.value)} />
            <Button type="submit" size="icon" aria-label="Registrar refeição"><Plus className="w-4 h-4" /></Button>
          </form>
        </Card>


        </>)}

        {/* Hidratação (tracker Água) */}
        {trackers.has("water") && (
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
        )}


        </TabsContent>

        <TabsContent value="corpo" className="space-y-4 mt-0">
        {/* ── Evolução corporal (tracker Peso e corpo) ─────────── */}
        {!trackers.has("weight") && (
          <p className="text-sm text-muted-foreground rounded-md border p-3">
            Você escolheu não acompanhar peso e corpo — nada aqui te cobra isso.
            Se mudar de ideia, reative em Ajustes, na seção "O que você acompanha".
          </p>
        )}
        {trackers.has("weight") && (
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

          <p className="text-[11px] text-right -mt-2">
          <Link className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            to={`/app/conselheiro?q=${encodeURIComponent("Analisa a tendência do meu peso nos últimos meses e me diz o que ela sugere.")}`}>
            Perguntar ao Conselheiro sobre essa tendência
          </Link>
        </p>

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

          <p className="text-[11px] text-right -mt-2">
          <Link className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            to={`/app/conselheiro?q=${encodeURIComponent("Como estão minhas calorias diárias em relação à minha meta nas últimas semanas?")}`}>
            Perguntar ao Conselheiro sobre minhas calorias
          </Link>
        </p>

        {/* Composição corporal por foto — SUSPENSA (plano de consolidação,
            Etapa 4.1): a estimativa exibia um ponto médio de aparência clínica
            que a fotografia não sustenta. A função volta como experimento com
            faixas + peso/altura/sexo/evolução e comparativos privados. O
            backend também está bloqueado (flags.body_photo_enabled = false). */}
        </Card>
        )}


        </TabsContent>

        <TabsContent value="historico" className="space-y-4 mt-0">
        {/* Histórico 14 dias */}
        <Card className="p-4">
          <h2 className="font-display font-semibold mb-3">Últimos 14 dias</h2>
          {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {mealsError && (
            <QueryError
              variant="plain"
              title="Não consegui carregar suas refeições."
              detail="Pode ser a conexão — o que você já registrou continua salvo."
              onRetry={() => refetchMeals()}
              retrying={mealsFetching}
            />
          )}
          {!isLoading && !mealsError && !(meals ?? []).length && (
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


        </TabsContent>
      </Tabs>

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
    if (error) { toast.error("Não consegui salvar. Tente de novo."); return; }
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
            Defina sua meta do dia e o tamanho das garrafas ou copos que você usa. Assim, registrar
            água passa a ser um toque só.
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