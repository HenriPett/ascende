import { useEffect, useMemo, useRef, useState } from "react";
import { prefersReducedMotion, useReducedMotion } from "@/hooks/useReducedMotion";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody,
} from "@/components/ui/drawer";
import {
  Folha, FolhaContent, FolhaHeader, FolhaTitle, FolhaDescription, FolhaBody, FolhaFooter,
} from "@/components/ui/folha";
import GoalInput from "@/components/core/GoalInput";
import QueryError from "@/components/core/QueryError";
import SleepSchedule from "@/components/core/SleepSchedule";
import { toast } from "sonner";
import {
  Plus, Trash2, Moon, Dumbbell, BarChart3, HeartPulse, X, Zap, Sparkles,
  Camera, Loader2, Check, Flame, Droplet, Settings2, Undo2, Scale, Pencil,
  TrendingUp, UtensilsCrossed, Target, Lightbulb, BedDouble, ChevronDown,
} from "lucide-react";
import { activeTrackerSet } from "@/lib/trackers";
import { sleepWindowHours, timeForInput, formatWindowHours } from "@/lib/sleep";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";

/* ─── VITALIDADE — corpo, sono, treino e o que você come ────────────────────
 *
 * Esta tela absorveu a antiga Alimentação. Não é uma soma: eram 16 cartões
 * visíveis nas duas telas e aqui são 9 — 10 enquanto o Raio-X não for
 * respondido, e ele existe justamente para se aposentar. Uma fusão que só
 * REALOCA superfície dobra a percepção de complexidade enquanto reduz um
 * pilar, e aí a culpa não seria de quem vier depois.
 *
 * Os nove, na ordem: registrar (a dobra) · comida · água · treino · sono ·
 * evolução corporal · corpo treinado · minha saúde · histórico.
 *
 * A REGRA QUE MANDA NO DESENHO: **Hoje é o dono do dia; Vitalidade é a mesa de
 * trabalho.** A tela Hoje já tem o painel "Seu dia em números" (kcal, proteína,
 * água, treinos, sono, teto de gasto, com celebração). Se esta tela abrisse com
 * barras de progresso, o app passaria a ter dois painéis do mesmo dia — por
 * isso a dobra aqui não tem barra de progresso nenhuma: tem REGISTRAR.
 *
 * O que foi cortado, e por quê (cada corte responde a uma duplicação real):
 *  1. Dois cartões-assinatura ("Plano que cabe no seu bolso" + "Raio-X de
 *     Vitalidade") eram a mesma peça na mesma posição → viraram um. O convite
 *     ao plano no bolso continua vivo, como linha, dentro do cartão de comida.
 *  2. O radar de 7 categorias e a barra ordenada eram dois gráficos da MESMA
 *     tabela → ficou a barra, que é a que responde "o que ficou de fora".
 *  3. Seis GoalInput espalhados por dois pilares → uma folha "Minhas metas".
 *     Caçar meta em seis cartões de duas telas era o desenho, não o acidente.
 *  4. "Registro rápido em texto" era a CaptureBar com menos poder, e a
 *     CaptureBar está em toda tela.
 *  5. "Hábitos diários" saiu: o próprio <Select> dele oferecia os 4 pilares —
 *     é transversal, e já tem dono ("Compromissos de hoje", na tela Hoje).
 *  6. Três históricos de janelas diferentes (14 dias de refeição, 28 de
 *     hábitos, série de peso) → um só, de 28 dias, com o heatmap dentro.
 *
 * TRÊS ENDEREÇOS, UMA TELA: /app/vitalidade, /app/alimentacao (rota congelada
 * que continua RENDERIZANDO, nunca redirecionando) e a query `?s=`. Toda a
 * lógica de aba e âncora tolera os três — ver `estadoInicial()`.
 */

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
interface VitalEvent {
  id: string;
  occurred_at: string;
  kind: string;
  payload: MealPayload & { ml?: number; hours?: number; muscles?: string[] };
}
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

const MUSCLES = ["Peito", "Costas", "Pernas", "Ombros", "Braços", "Core", "Cardio"] as const;

/** Janela única do histórico e do heatmap. Era 14 dias numa tela e 28 na
 *  outra — a mesma pessoa via duas memórias de tamanhos diferentes. */
const JANELA_DIAS = 28;

/* ─── As seções endereçáveis ────────────────────────────────────────────────
   O inventário de links externos (`EXTERNALLY_LINKED`, em routes.ts) manda
   mensagens de WhatsApp para estes caminhos, e mensagem já enviada não se
   corrige. Por isso a âncora é um dado, não um if espalhado. */
type SectionId = "comida" | "agua" | "treino" | "sono" | "corpo" | "historico";
type TabId = "dia" | "corpo" | "historico";

const TAB_OF: Record<SectionId, TabId> = {
  comida: "dia", agua: "dia", treino: "dia", sono: "dia",
  corpo: "corpo", historico: "historico",
};

/** O que a query `?s=` aceita. Três valores para seção, os mesmos que o
 *  webhook do WhatsApp passa a mandar — nada de dialeto novo em cada chamador.
 *  `?s=metas` é o quarto e não é seção: abre a folha de metas, e existe porque
 *  a tela Hoje promete "Definir meta" e a meta mora numa folha, não num
 *  cartão. Link que promete e entrega outra coisa é pior que link nenhum. */
const QUERY_SECTION: Record<string, SectionId> = {
  comida: "comida", treino: "treino", corpo: "corpo",
};
const QUERY_METAS = "metas";

/* ─── A aba mora no ENDEREÇO, não só na memória do componente ──────────────
   `?s=` é âncora de ENTRADA: ela é consumida uma vez e some. `?aba=` é o
   estado da tela, e ele precisa sobreviver ao F5, ao link colado e ao app
   reaberto — sem isso, quem estava no Histórico e recarregou voltava para
   "Meu dia" sem entender por quê.

   São dois parâmetros e não um porque fazem coisas opostas: manter o `s` ao
   trocar de aba faria a tela rolar e focar um campo a cada toque. */
const QUERY_ABA = "aba";
const TABS: readonly TabId[] = ["dia", "corpo", "historico"];
const abaValida = (v: string | null): TabId | null =>
  TABS.includes(v as TabId) ? (v as TabId) : null;

/**
 * Aba e âncora de entrada, a partir do endereço.
 *
 * SEM QUERY a porta decide, e ela decide pelo que a pessoa foi buscar:
 * quem digitou/guardou `/app/alimentacao` quer comida; quem veio por
 * `/app/vitalidade` quer treino e sono. Os dois caem na MESMA aba, então
 * ninguém aterrissa em lugar vazio — só muda o cartão que fica sob o olho.
 */
function estadoInicial(pathname: string, search: string): {
  tab: TabId; foco: SectionId | null; vindoDeAlimentacao: boolean; abrirMetas: boolean;
} {
  const params = new URLSearchParams(search);
  const s = params.get("s") ?? "";
  const vindoDeAlimentacao = pathname.includes("/alimentacao");
  const alvo = QUERY_SECTION[s] ?? (vindoDeAlimentacao ? "comida" : "treino");
  const abrirMetas = s === QUERY_METAS;
  const temAncora = s !== "";
  const abaGravada = abaValida(params.get(QUERY_ABA));
  /* A ÂNCORA GANHA DA ABA GRAVADA, e é a ordem certa: um link novo
     (`?s=corpo`, do WhatsApp) tem de levar a pessoa aonde ele promete, mesmo
     que a última aba dela tenha sido outra. Sem `s`, manda a aba do endereço;
     sem as duas, manda a porta pela qual ela entrou. */
  const tab = temAncora ? TAB_OF[alvo] : (abaGravada ?? TAB_OF[alvo]);
  /* Rolar até um cartão é resposta a um PEDIDO — a âncora, ou a porta na
     primeira entrada. Num F5 com aba gravada, ninguém pediu nada: mover a
     tela ali seria o app se mexendo sozinho. E com a folha de metas aberta,
     rolar atrás dela é movimento que ninguém vê e todo mundo perde. */
  const foco = abrirMetas ? null : (temAncora || !abaGravada) ? alvo : null;
  return { tab, foco, vindoDeAlimentacao, abrirMetas };
}

const confidenceLabel: Record<Estimate["confidence"], string> = {
  baixa: "confiança baixa", media: "confiança média", alta: "confiança alta",
};

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

/* ─── A linha de reorientação ───────────────────────────────────────────────
   Mesma anatomia do FirstTimeTip (borda dourada, "Entendi", some para sempre),
   mas com memória local própria: ela não é a dica de uma função nova, é o
   aviso de uma MUDANÇA DE ENDEREÇO, e só aparece para quem chegou pela porta
   antiga. Some com um toque — e some sozinha quando a mudança envelhecer e a
   rota legada deixar de existir.

   Não adivinhamos o que a mensagem antiga prometia: oferecemos o caminho. */
const CHAVE_REORIENTACAO = "ascende-vitalidade-absorveu-alimentacao";

function NotaDeReorientacao({ onIrParaCorpo }: { onIrParaCorpo: () => void }) {
  const [visivel, setVisivel] = useState(() => {
    try { return localStorage.getItem(CHAVE_REORIENTACAO) !== "1"; } catch { return true; }
  });
  if (!visivel) return null;
  const dispensar = () => {
    try { localStorage.setItem(CHAVE_REORIENTACAO, "1"); } catch { /* sem memória, reaparece uma vez */ }
    setVisivel(false);
  };
  return (
    <div role="note" className="rounded-xl border border-gold/40 bg-gold/5 p-3 space-y-1.5 animate-fade-up">
      <p className="text-sm font-medium flex items-center gap-1.5">
        <Lightbulb className="w-4 h-4 text-gold shrink-0" />
        Treino, sono e comida agora vivem juntos, em Vitalidade.
      </p>
      <p className="text-sm text-muted-foreground">
        Nada se perdeu: o seu histórico está inteiro, aqui.{" "}
        {/* Padding vertical num elemento em linha cresce a ÁREA DE TOQUE sem
            empurrar a linha do parágrafo — o mesmo truque do FirstTimeTip,
            adaptado a um link que vive dentro do texto. */}
        <button type="button" className="underline text-foreground py-3.5" onClick={onIrParaCorpo}>
          Procurando peso e composição corporal? Está em Meu corpo <span aria-hidden>→</span>
        </button>
      </p>
      <div className="flex justify-end pt-0.5">
        <Button size="sm" variant="outline" onClick={dispensar}>Entendi</Button>
      </div>
    </div>
  );
}

/* ─── Raio-X de Vitalidade — 60 segundos ────────────────────────────────────
   O cartão-assinatura da tela, e agora é UM só: o gold "Plano que cabe no seu
   bolso" da antiga Alimentação e este ocupavam a mesma posição e faziam o
   mesmo trabalho (valor no dia 1, antes de existir histórico). O convite ao
   plano no bolso virou linha dentro do cartão de comida, onde ele é resposta
   a uma pergunta em vez de um segundo cartão dourado.

   Duas perguntas viram um retrato estimado e honesto — marcado como
   estimativa — que o briefing e o Conselheiro cruzam com dinheiro e comida
   desde o primeiro dia. O registro real substitui a estimativa, nunca soma.

   RESPONDIDO, ELE SOME DA TELA e vira uma linha sob o título (ver
   `RetratoEstimado`): cartão de onboarding que fica para sempre é cartão que
   a pessoa aprende a pular. Refazer continua a um toque, em Minhas metas. */
function RaioXVitalidade({ onPronto }: { onPronto: () => void }) {
  const { user } = useAuth();
  const { profile, refresh } = useProfile();
  const [workoutsWeek, setWorkoutsWeek] = useState("");
  const [sleepAvg, setSleepAvg] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!user) return;
    const w = Math.round(Number(workoutsWeek));
    const sHours = Number(sleepAvg.replace(",", "."));
    const patch: Record<string, number> = {};
    if (workoutsWeek !== "" && w >= 0 && w <= 14) patch.est_workouts_week = w;
    if (sleepAvg !== "" && sHours >= 3 && sHours <= 14) patch.est_sleep_h = sHours;
    if (!Object.keys(patch).length) {
      toast.error("Preencha pelo menos um dos dois campos. Ex.: 3 treinos, 6,5 horas.");
      return;
    }
    toast.dismiss("Preencha pelo menos um dos dois campos. Ex.: 3 treinos, 6,5 horas.");
    setSaving(true);
    const { error } = await supabase.from("profiles").update(patch).eq("user_id", user.id);
    setSaving(false);
    if (error) { toast.error("Não consegui salvar o Raio-X. Tente de novo."); return; }
    toast.dismiss("Não consegui salvar o Raio-X. Tente de novo.");
    toast.success("Retrato de Vitalidade pronto. O Conselheiro e o briefing já cruzam isso com os outros pilares.");
    setWorkoutsWeek("");
    setSleepAvg("");
    refresh();
    onPronto();
  };

  if (!profile) return null;

  return (
    <Card className="p-4 space-y-3 border-gold/30 bg-gold/5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full grid place-items-center shrink-0" style={{ background: "hsl(var(--vitalidade) / 0.12)" }}>
          <Zap className="w-5 h-5" style={{ color: "hsl(var(--vitalidade))" }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Raio-X de Vitalidade — 60 segundos</p>
          <p className="text-xs text-muted-foreground">
            Como está HOJE, na média — não a meta, o real. Um chute honesto já serve: o seu
            corpo entra no retrato hoje mesmo, sem esperar semanas de registro. É estimativa,
            e a gente diz que é.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-xs font-medium">Treinos por semana, hoje</p>
          <Input inputMode="numeric" placeholder="Ex.: 3 (0 se parou)" value={workoutsWeek}
            onChange={(e) => setWorkoutsWeek(e.target.value)} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium">Horas de sono por noite, em média</p>
          <Input inputMode="decimal" placeholder="Ex.: 6,5" value={sleepAvg}
            onChange={(e) => setSleepAvg(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" className="min-h-11" onClick={onPronto} disabled={saving}>Depois</Button>
        <Button size="sm" className="min-h-11" onClick={save} disabled={saving}>Salvar retrato</Button>
      </div>
    </Card>
  );
}

/** O retrato já respondido, em UMA LINHA sob o título — não em cartão. É
 *  informação de contexto, não tarefa: quem quiser mexer vai em Minhas metas. */
function RetratoEstimado() {
  const { profile } = useProfile();
  const routineHours = sleepWindowHours(profile?.sleep_bedtime, profile?.sleep_waketime);
  if (!profile) return null;
  const parts: string[] = [];
  if (profile.est_workouts_week != null) {
    parts.push(`~${profile.est_workouts_week} treino${profile.est_workouts_week === 1 ? "" : "s"}/semana`);
  }
  if (routineHours !== null) {
    parts.push(`dorme ${timeForInput(profile.sleep_bedtime)} às ${timeForInput(profile.sleep_waketime)} (${formatWindowHours(routineHours)})`);
  } else if (profile.est_sleep_h != null) {
    parts.push(`~${String(profile.est_sleep_h).replace(".", ",")} h de sono por noite`);
  }
  if (!parts.length) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Seu retrato estimado: {parts.join(" · ")} — os registros reais vão substituindo aos poucos.
    </p>
  );
}

export default function Vitalidade() {
  /* O Recharts anima com requestAnimationFrame, fora do alcance do
     `prefers-reduced-motion` do CSS: com movimento reduzido, as barras e a
     linha aparecem já no lugar, em vez de crescerem do zero. */
  const reduzMovimento = useReducedMotion();
  const { user } = useAuth();
  const { profile, refresh: refreshProfile } = useProfile();
  /* Modularidade total: sono, sonecas, treinos, água, refeições, proteína e
     peso são trackers desligáveis. Desligado some da tela (e do briefing),
     mas o histórico continua sendo da pessoa. */
  const trackers = activeTrackerSet(profile);
  const qc = useQueryClient();
  const location = useLocation();

  const inicial = useMemo(
    () => estadoInicial(location.pathname, location.search),
    [location.pathname, location.search],
  );
  /* A ABA NÃO TEM ESTADO PRÓPRIO: ela é o endereço. Estado duplicado aqui é
     como a aba sumia no F5 — havia uma verdade na URL e outra na memória do
     componente, e a memória morre no recarregamento. */
  const tab = inicial.tab;
  /* A âncora pendente. Trocar de aba e rolar no mesmo comando não funciona: o
     cartão de destino ainda não existe no DOM quando o clique acontece. O
     efeito roda depois do commit, quando a aba nova já montou. */
  const [foco, setFoco] = useState<SectionId | null>(inicial.foco);
  const [metasAbertas, setMetasAbertas] = useState(inicial.abrirMetas);

  /* REPLACE, NÃO PUSH, e a escolha é sobre o que o Voltar significa.
     Com push, cada toque de aba vira um passo de histórico: percorrer as três
     (que é para isso que abas existem) obriga a três Voltares para sair da
     tela — num PWA, onde o Voltar é o único gesto de saída, "o Voltar não sai
     daqui" é falha pior que "o Voltar sai". Com replace, o Voltar continua
     desfazendo NAVEGAÇÃO entre telas, que é o trabalho dele, e a aba
     sobrevive ao F5, ao link colado e ao app reaberto — que era a perda real.
     Se o fundador preferir o outro contrato, é trocar `replace` por false.

     O CAMINHO É PRESERVADO de propósito: quem entrou por /app/alimentacao
     continua em /app/alimentacao. Normalizar tudo para /app/vitalidade
     trocaria a URL embaixo de quem veio pelo link antigo do WhatsApp. */
  const navigate = useNavigate();
  const trocarAba = (v: TabId) => {
    const params = new URLSearchParams(location.search);
    params.set(QUERY_ABA, v);
    // A âncora de entrada já foi cumprida. Mantê-la faria a tela rolar e
    // focar um campo de novo a cada toque de aba.
    params.delete("s");
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  };

  /* O endereço pode mudar com a tela JÁ montada — de `?s=treino` para
     `?s=comida`, porque a pessoa tocou num atalho vindo de outra tela. A aba
     acompanha sozinha (ela é derivada); o que precisa de efeito é a âncora,
     e ela só vale UMA vez por valor, senão cada troca de aba rolaria a tela. */
  const ancoraConsumida = useRef<string | null>(null);
  useEffect(() => {
    const s = new URLSearchParams(location.search).get("s");
    if (s === ancoraConsumida.current) return;
    ancoraConsumida.current = s;
    if (!s) return;
    setFoco(inicial.foco);
    if (inicial.abrirMetas) setMetasAbertas(true);
  }, [location.search, inicial]);

  useEffect(() => {
    if (!foco) return;
    // A aba do alvo ainda não está ativa: esperar o próximo commit é o que
    // impede a âncora de ser descartada antes de o cartão existir no DOM.
    if (TAB_OF[foco] !== tab) return;
    const el = document.getElementById(`v-${foco}`);
    if (el) {
      // `behavior` em JS não obedece ao @media de movimento reduzido do CSS —
      // a preferência vem do hook único, senão a rolagem animada volta para
      // quem pediu para não ter animação.
      el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      el.querySelector<HTMLElement>("[data-registro]")?.focus({ preventScroll: true });
    }
    setFoco(null);
  }, [foco, tab]);

  const irPara = (s: SectionId) => { trocarAba(TAB_OF[s]); setFoco(s); };

  // ── Estado de formulário ────────────────────────────────────
  const [sleepHours, setSleepHours] = useState("");
  const [sleepType, setSleepType] = useState<"sleep" | "nap" | null>(null);
  const [workout, setWorkout] = useState("");
  const [muscles, setMuscles] = useState<string[]>([]);
  const [conditionInput, setConditionInput] = useState("");
  const [medicationInput, setMedicationInput] = useState("");
  const [weightInput, setWeightInput] = useState("");
  const [savingWeight, setSavingWeight] = useState(false);
  const [editingMeal, setEditingMeal] = useState<VitalEvent | null>(null);
  const [garrafasAbertas, setGarrafasAbertas] = useState(false);

  // ── Foto/descrição da refeição ──────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [photoData, setPhotoData] = useState<{ data: string; media_type: string } | null>(null);
  const [photoNote, setPhotoNote] = useState("");

  // ── Raio-X: respondido some da tela ─────────────────────────
  const [raioxDispensado, setRaioxDispensado] = useState(false);
  const routineHours = sleepWindowHours(profile?.sleep_bedtime, profile?.sleep_waketime);
  const temRaiox = profile?.est_workouts_week != null || profile?.est_sleep_h != null || routineHours !== null;
  const mostrarRaiox = !!profile && !temRaiox && !raioxDispensado;

  // ── Garrafas e meta de água ─────────────────────────────────
  const bottles: WaterBottle[] = profile?.water_bottles?.length ? profile.water_bottles : DEFAULT_WATER_BOTTLES;
  const goalMl = profile?.water_goal_ml ?? DEFAULT_WATER_GOAL_ML;

  // ── Condições de saúde e medicamentos ───────────────────────
  const conditions = profile?.health_conditions ?? [];
  const medications = profile?.medications ?? [];

  const saveHealth = async (patch: { health_conditions?: string[]; medications?: string[] }) => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update(patch).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar. Tente de novo."); return; }
    toast.dismiss("Não consegui salvar. Tente de novo.");
    refreshProfile();
  };

  const addToList = async (
    value: string, list: string[], key: "health_conditions" | "medications", clear: () => void,
  ) => {
    const c = value.trim().slice(0, 80);
    if (!c) return;
    if (list.length >= 20) { toast.error("Máximo de 20 itens. Remova algum para adicionar outro."); return; }
    toast.dismiss("Máximo de 20 itens. Remova algum para adicionar outro.");
    if (list.some((x) => x.toLowerCase() === c.toLowerCase())) { toast.info("Isso já está na sua lista."); return; }
    await saveHealth({ [key]: [...list, c] });
    clear();
    toast.success("Anotado. O Conselheiro vai considerar isso nas sugestões.");
  };

  const addCondition = (e: React.FormEvent) => {
    e.preventDefault();
    addToList(conditionInput, conditions, "health_conditions", () => setConditionInput(""));
  };
  const addMedication = (e: React.FormEvent) => {
    e.preventDefault();
    addToList(medicationInput, medications, "medications", () => setMedicationInput(""));
  };
  const removeCondition = (idx: number) =>
    saveHealth({ health_conditions: conditions.filter((_, i) => i !== idx) });
  const removeMedication = (idx: number) =>
    saveHealth({ medications: medications.filter((_, i) => i !== idx) });

  /* ── UMA consulta para a tela inteira ─────────────────────────
     As duas telas antigas faziam seis. E não era só custo: eram três janelas
     diferentes (14 dias de refeição, 28 de hábito, o dia de água), o que fazia
     a mesma pessoa ter três memórias de tamanhos diferentes no mesmo assunto.
     Aqui é uma janela só (`JANELA_DIAS`) para tudo que é do DIA, e a série de
     peso à parte porque ela é do CORPO — dado que anda em meses, não em dias.

     A chave continua sendo "vitalidade" e "weights" de propósito: são as que
     `LIFE_DATA_KEYS` invalida quando a CaptureBar ou os atalhos registram
     alguma coisa. Renomear aqui quebraria a atualização vinda de fora. */
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["vitalidade", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const desde = `${daysAgoISOInSP(JANELA_DIAS - 1)}T00:00:00-03:00`; // fronteira de dia em São Paulo
      const desde90 = new Date(Date.now() - 90 * 864e5).toISOString();
      const [eventos, pesos] = await Promise.all([
        supabase.from("life_events").select("id,occurred_at,kind,payload")
          .eq("user_id", user!.id).in("kind", ["meal", "water", "workout", "sleep", "nap"])
          .gte("occurred_at", desde).order("occurred_at", { ascending: false }).limit(1000),
        supabase.from("life_events").select("id,occurred_at,payload")
          .eq("user_id", user!.id).eq("kind", "weight")
          .gte("occurred_at", desde90).order("occurred_at", { ascending: true }).limit(200),
      ]);
      /* Sem propagar, a falha vira "você não registrou nada" — a tela de quem
         nunca usou o app, mostrada para quem usa há meses. Um erro que erra
         para baixo em silêncio é pior que erro nenhum. */
      const falhou = [eventos, pesos].find((r) => r.error);
      if (falhou?.error) throw falhou.error;
      return {
        eventos: (eventos.data ?? []) as VitalEvent[],
        pesos: (pesos.data ?? []) as WeightEvent[],
      };
    },
  });

  const eventos = useMemo(() => data?.eventos ?? [], [data]);
  const pesos = useMemo(() => data?.pesos ?? [], [data]);
  const invalidate = () => qc.invalidateQueries();

  const hojeIso = todayISOInSP();
  const doDia = (e: VitalEvent) => dateISOInSP(e.occurred_at) === hojeIso;

  // ── Sono e soneca ───────────────────────────────────────────
  const dormiuHoje = eventos.some((e) => e.kind === "sleep" && doDia(e));
  // Tipo efetivo: o escolhido; sem escolha, noite — mas se a noite já foi
  // registrada hoje, soneca.
  const effectiveSleepType: "sleep" | "nap" =
    sleepType ?? (!trackers.has("sleep") ? "nap" : dormiuHoje ? "nap" : "sleep");

  const logSleep = async () => {
    const h = Number(sleepHours.replace(",", "."));
    const isNap = effectiveSleepType === "nap";
    const max = isNap ? 6 : 24;
    if (!user || !h || h <= 0 || h > max) {
      toast.error(isNap ? "Quanto durou a soneca? Ex.: 1 ou 0,5" : "Quantas horas você dormiu? Ex.: 7,5");
      return;
    }
    toast.dismiss("Quanto durou a soneca? Ex.: 1 ou 0,5");
    toast.dismiss("Quantas horas você dormiu? Ex.: 7,5");
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "vitalidade", kind: isNap ? "nap" : "sleep",
      payload: { hours: h, summary: isNap ? `Soneca: ${h}h` : `Sono: ${h}h` }, source: "form",
    });
    if (error) { toast.error("Não consegui salvar o sono. Tente de novo."); return; }
    toast.dismiss("Não consegui salvar o sono. Tente de novo.");
    toast.success(isNap ? "Soneca registrada. +2 XP" : "Sono registrado. +5 XP");
    setSleepHours("");
    setSleepType(null);
    invalidate();
  };

  // ── Treino ──────────────────────────────────────────────────
  const toggleMuscle = (m: string) =>
    setMuscles((ms) => (ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m]));

  const logWorkout = async () => {
    if (!user || (!workout.trim() && !muscles.length)) {
      toast.error("Descreva o treino ou marque os grupos trabalhados.");
      return;
    }
    toast.dismiss("Descreva o treino ou marque os grupos trabalhados.");
    const desc = workout.trim() || muscles.join(", ");
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "vitalidade", kind: "workout",
      payload: {
        description: desc,
        muscles,
        summary: `Treino: ${desc}${muscles.length ? ` (${muscles.join(", ")})` : ""}`,
      },
      source: "form",
    });
    if (error) { toast.error("Não consegui salvar o treino. Tente de novo."); return; }
    toast.dismiss("Não consegui salvar o treino. Tente de novo.");
    toast.success("Treino registrado. +8 XP");
    setWorkout("");
    setMuscles([]);
    invalidate();
  };

  /* ── Por que comida, água e peso gravam `pillar: "vitalidade"` ───────────
     O pilar da linha deixou de ser escolha: ele é derivado do `kind`, e quem
     manda é `canonicalPillar`, no servidor. Escrever "vitalidade" aqui é
     escrever o MESMO valor que o servidor escreveria pela captura, pelo
     WhatsApp e pela importação — duas portas para o mesmo evento não podem
     gravar pilares diferentes.
     As linhas antigas continuam com "alimentacao" e continuam inteiras: quem
     agrega aceita os dois valores durante a janela de transição e só para de
     aceitar o legado na contração (R3). */
  const runAnalysis = async (photo: { data: string; media_type: string } | null, note: string) => {
    setAnalyzing(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("analyze-meal", {
        body: { image: photo?.data, media_type: photo?.media_type, note: note.trim() || undefined },
      });
      if (error || res?.error) throw new Error(res?.error ?? "falha");
      if (!res?.is_food || !res?.estimate) {
        toast.info(photo
          ? "Não reconheci comida nessa foto. Tente enquadrar melhor o prato ou descreva na observação."
          : "Não entendi essa descrição como uma refeição. Tente algo como \"prato de arroz, feijão e frango grelhado\".");
        return;
      }
      setEstimate(res.estimate as Estimate);
      toast.dismiss("Não consegui analisar agora. Verifique sua conexão e tente de novo.");
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
      toast.dismiss("Não consegui abrir essa imagem. Tente outra foto.");
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

  const resetPhoto = () => { setEstimate(null); setPhotoData(null); setPhotoNote(""); };

  const setCalories = (v: string) => {
    if (!estimate) return;
    setEstimate({ ...estimate, calories: Math.max(0, Math.round(Number(v.replace(/\D/g, "")))) });
  };

  const confirmPhoto = async () => {
    if (!user || !estimate) return;
    setSavingPhoto(true);
    const note = photoNote.trim();
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "vitalidade", kind: "meal",
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
    toast.dismiss("Não consegui salvar a refeição. Tente de novo.");
    toast.success("Refeição registrada. +4 XP");
    resetPhoto();
    invalidate();
  };

  const removeMeal = async (id: string) => {
    await supabase.from("life_events").delete().eq("id", id);
    invalidate();
  };

  const saveMealCalories = async (meal: VitalEvent, calories: number) => {
    const payload = { ...meal.payload, calories };
    const desc = payload.description ?? "Refeição";
    payload.summary = calories > 0 ? `Refeição (~${calories} kcal): ${desc}` : `Refeição: ${desc}`;
    const { error } = await supabase.from("life_events").update({ payload }).eq("id", meal.id);
    if (error) { toast.error("Não consegui atualizar as calorias. Tente de novo."); return; }
    toast.dismiss("Não consegui atualizar as calorias. Tente de novo.");
    // Sem toast: a folha fecha e o número novo já aparece na refeição.
    setEditingMeal(null);
    invalidate();
  };

  // ── Água ────────────────────────────────────────────────────
  const aguaHoje = eventos.filter((e) => e.kind === "water" && doDia(e));
  const totalMl = aguaHoje.reduce((s, w) => s + (Number(w.payload?.ml) || 0), 0);
  const pct = goalMl > 0 ? Math.min(1, totalMl / goalMl) : 0;

  const addWater = async (ml: number) => {
    if (!user || ml <= 0) return;
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "vitalidade", kind: "water",
      payload: { ml, summary: `Água: ${ml} ml` }, source: "form",
    });
    if (error) { toast.error("Não consegui registrar a água. Tente de novo."); return; }
    toast.dismiss("Não consegui registrar a água. Tente de novo.");
    invalidate();
  };

  const undoWater = async () => {
    const last = aguaHoje[0]; // a consulta vem em ordem decrescente
    if (!last) return;
    await supabase.from("life_events").delete().eq("id", last.id);
    invalidate();
  };

  // ── Peso ────────────────────────────────────────────────────
  const logWeight = async () => {
    const kg = Number(weightInput.replace(",", "."));
    if (!user || !kg || kg < 20 || kg > 400) { toast.error("Informe um peso válido em kg, como 78,5."); return; }
    toast.dismiss("Informe um peso válido em kg, como 78,5.");
    setSavingWeight(true);
    const { error } = await supabase.from("life_events").insert({
      user_id: user.id, pillar: "vitalidade", kind: "weight",
      payload: { kg, summary: `Peso: ${kg} kg` }, source: "form",
    });
    setSavingWeight(false);
    if (error) { toast.error("Não consegui salvar o peso. Tente de novo."); return; }
    toast.dismiss("Não consegui salvar o peso. Tente de novo.");
    toast.success("Peso registrado. +3 XP");
    setWeightInput("");
    invalidate();
  };

  // ── Relatório: partes do corpo treinadas ────────────────────
  const treinos = eventos.filter((e) => e.kind === "workout");
  const muscleCounts: Record<string, number> = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  let taggedWorkouts = 0;
  for (const w of treinos) {
    const ms = w.payload?.muscles ?? [];
    if (ms.length) taggedWorkouts++;
    for (const m of ms) if (m in muscleCounts) muscleCounts[m]++;
  }
  const maxCount = Math.max(1, ...Object.values(muscleCounts));
  /* SÓ A BARRA ORDENADA. Havia um radar de 7 categorias e esta barra lado a
     lado — dois desenhos da mesma tabela. A barra ficou porque é a que
     responde à pergunta que a pessoa faz ("o que ficou de fora?"); o radar
     era decoração de sete pontas. */
  const barData = MUSCLES.map((m) => ({ muscle: m, treinos: muscleCounts[m] }))
    .sort((a, b) => b.treinos - a.treinos);
  const minSemCardio = Math.min(...MUSCLES.filter((x) => x !== "Cardio").map((x) => muscleCounts[x]));
  const leastTrained = MUSCLES.filter((m) => m !== "Cardio" && muscleCounts[m] === minSemCardio);

  // ── Dados dos gráficos do corpo ─────────────────────────────
  const weightGoal = Number(profile?.weight_goal_kg) || null;
  const weightSeries = pesos
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

  const refeicoes = eventos.filter((e) => e.kind === "meal");
  const caloriesByDay = (() => {
    const map: Record<string, number> = {};
    for (const m of refeicoes) {
      const kcal = Number(m.payload?.calories);
      /* A chave é GRAVADA e LIDA no fuso de São Paulo. Com `slice(0,10)` sobre
         o timestamptz, o jantar das 22:00 de 21/03 caía na barra do dia 22 —
         quem janta tarde via o gráfico inteiro deslocado. */
      if (kcal > 0) { const d = dateISOInSP(m.occurred_at); map[d] = (map[d] ?? 0) + kcal; }
    }
    const out: { dia: string; kcal: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const iso = daysAgoISOInSP(i);
      if (map[iso]) {
        out.push({
          dia: new Date(Date.now() - i * 864e5).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
          kcal: Math.round(map[iso]),
        });
      }
    }
    return out;
  })();

  /* ── O histórico ÚNICO: uma linha por dia com o que houve ─────
     Eram três (14 dias de refeição, 28 dias de hábito, série de peso). Agora
     é um: o dia, e dentro dele o que a pessoa fez. Peso e corpo ficam fora de
     propósito — são a aba "Meu corpo", e nunca entram numa lista de presença
     diária ao lado de caloria — número de corpo não vira placar de presença. */
  const dias = (() => {
    const map: Record<string, VitalEvent[]> = {};
    for (const e of eventos) (map[dateISOInSP(e.occurred_at)] ??= []).push(e);
    return Object.entries(map).sort(([a], [b]) => (a < b ? 1 : -1));
  })();

  const resumoDoDia = (evs: VitalEvent[]) => {
    const linhas: { icone: typeof Dumbbell; texto: string }[] = [];
    const ts = evs.filter((e) => e.kind === "workout");
    if (ts.length) {
      linhas.push({
        icone: Dumbbell,
        texto: ts.map((t) => t.payload?.description).filter(Boolean).join(" · ")
          || (ts.length === 1 ? "1 treino" : `${ts.length} treinos`),
      });
    }
    const ml = evs.filter((e) => e.kind === "water").reduce((s, e) => s + (Number(e.payload?.ml) || 0), 0);
    if (ml > 0) linhas.push({ icone: Droplet, texto: `${(ml / 1000).toFixed(1).replace(".", ",")} L de água` });
    const horas = evs.filter((e) => e.kind === "sleep").reduce((s, e) => s + (Number(e.payload?.hours) || 0), 0);
    if (horas > 0) linhas.push({ icone: Moon, texto: `${String(horas).replace(".", ",")} h de sono` });
    const sonecas = evs.filter((e) => e.kind === "nap").reduce((s, e) => s + (Number(e.payload?.hours) || 0), 0);
    if (sonecas > 0) linhas.push({ icone: Moon, texto: `${String(sonecas).replace(".", ",")} h de soneca` });
    return linhas;
  };

  /* Heatmap: presença, nunca ausência. O antigo media "% de hábitos
     concluídos" — e os hábitos saíram desta tela. Agora ele mede REGISTRO, que
     é o que a tela é: quanto mais forte, mais coisas do corpo entraram no dia.
     Dia vazio é cinza, e cinza não é vermelho de propósito. */
  const heat = (() => {
    const porDia: Record<string, number> = {};
    for (const e of eventos) { const d = dateISOInSP(e.occurred_at); porDia[d] = (porDia[d] ?? 0) + 1; }
    const teto = Math.max(1, ...Object.values(porDia));
    const days: { date: string; pct: number; n: number }[] = [];
    for (let i = JANELA_DIAS - 1; i >= 0; i--) {
      const iso = daysAgoISOInSP(i);
      const n = porDia[iso] ?? 0;
      days.push({ date: iso, pct: n / teto, n });
    }
    return days;
  })();

  // ── Metas (a folha "Minhas metas" é a única dona) ────────────
  const kcalGoal = Number(profile?.calorie_goal_kcal) || 0;
  const protGoal = Number(profile?.protein_goal_g) || 0;
  const kcalToday = Math.round(refeicoes.filter(doDia)
    .reduce((s, m) => s + (Number(m.payload?.calories) || 0), 0));

  const chips = ([
    { id: "comida", label: "Refeição", icone: Camera, ativo: trackers.has("meals") },
    { id: "agua", label: "Água", icone: Droplet, ativo: trackers.has("water") },
    { id: "treino", label: "Treino", icone: Dumbbell, ativo: trackers.has("workouts") },
    { id: "sono", label: "Sono", icone: Moon, ativo: trackers.has("sleep") || trackers.has("naps") },
  ] as const).filter((c) => c.ativo);

  return (
    <div className="max-w-2xl lg:max-w-4xl mx-auto space-y-4 animate-fade-up [&_:is(h1,h2,h3)]:hyphens-auto [&_:is(h1,h2,h3)]:[overflow-wrap:break-word]">
      {/* Títulos podem quebrar no meio da palavra, e só quando a palavra
        não cabe: com Texto Maior a 40 pt, "Prosperidade" ou "Conselheiro"
        num `text-2xl` passam da largura da tela sozinhos. Hifeniza em
        pt-BR onde o dicionário deixa; senão, quebra onde precisar. No
        tamanho padrão nenhum título chega na borda, então nada muda. */}
      {/* ── A DOBRA. Fora das abas, e sem barra de progresso nenhuma: a tela
             Hoje já é o painel do dia, e dois painéis do mesmo dia é a fusão
             dobrando a complexidade enquanto reduz um pilar. ────────────── */}
      <div>
        <h1 className="font-display text-2xl font-semibold text-vitalidade-ink">
          Vitalidade
        </h1>
        <p className="text-subhead text-muted-foreground">
          Corpo, sono, treino e o que você come — num lugar só. Usa Strava, balança ou app de
          dieta? Continue: aqui basta contar, e nós cruzamos com o resto da sua vida.
        </p>
        {temRaiox && <div className="mt-1"><RetratoEstimado /></div>}
      </div>

      {inicial.vindoDeAlimentacao && <NotaDeReorientacao onIrParaCorpo={() => irPara("corpo")} />}

      {isError && (
        <QueryError
          title="Não consegui carregar seus registros."
          detail="Pode ser a conexão — nada do que você registrou se perdeu."
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      )}

      {/* REGISTRAR AGORA — o único cartão da dobra. Um toque leva ao campo
          certo com o teclado já aberto; o chip não registra sozinho porque
          registro sem confirmação é registro que a pessoa não pediu. */}
      {chips.length > 0 && (
        <Card className="p-4 space-y-2.5">
          <p className="text-sm font-medium">Registrar agora</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => irPara(c.id)}
                className="min-h-11 rounded-full border bg-card px-3 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all"
              >
                <c.icone className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--vitalidade))" }} />
                {c.label}
              </button>
            ))}
          </div>
        </Card>
      )}

      <Tabs value={tab} onValueChange={(v) => trocarAba(v as TabId)} className="space-y-4">
        {/* `h-auto` + `min-h-11`: o TabsList da casa nasce com `h-10` e o
            gatilho com `py-1.5`, o que dava 32px de altura. Abas são a
            navegação DESTA tela e o alvo mais tocado dela — 32px é onde o
            dedo erra e a pessoa acha que o app travou. A altura sobe no
            celular e no desktop igual: o alvo pequeno não fica menos errado
            porque existe um mouse por perto. */}
        <TabsList className="grid grid-cols-3 w-full h-auto p-1">
          <TabsTrigger value="dia" className="min-h-11">Meu dia</TabsTrigger>
          <TabsTrigger value="corpo" className="min-h-11">Meu corpo</TabsTrigger>
          <TabsTrigger value="historico" className="min-h-11">Histórico</TabsTrigger>
        </TabsList>

        {/* ══ ABA 1 — MEU DIA: o que a captura dourada não alcança ══════ */}
        <TabsContent value="dia" className="space-y-4 mt-0">
          {mostrarRaiox && <RaioXVitalidade onPronto={() => setRaioxDispensado(true)} />}

          {/* Comida: foto ou descrição → calorias */}
          {trackers.has("meals") && (
            <Card id="v-comida" className="p-4 space-y-3 scroll-mt-20">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Camera className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} />
                Manda a foto ou descreva — o Ascende estima as calorias
              </div>

              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />

              <div className="space-y-1">
                <Textarea
                  data-registro
                  value={photoNote}
                  onChange={(e) => setPhotoNote(e.target.value)}
                  placeholder={photoData
                    ? 'Observação (opcional): "a carne é cupim", "comi um sagu junto"...'
                    : 'Descreva a refeição: "prato de arroz, feijão, bife e salada" — ou adicione uma foto'}
                  rows={2} maxLength={300}
                  className="resize-none text-sm"
                  disabled={analyzing}
                />
                <p className="text-caption2 text-muted-foreground">
                  {photoData
                    ? "Detalhes deixam a estimativa mais certeira e ficam salvos com a refeição."
                    : "Dá para estimar só pela descrição, mas a foto melhora a precisão."}
                </p>
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1 min-w-0 min-h-11"
                  onClick={() => fileRef.current?.click()} disabled={analyzing}>
                  <Camera className="w-4 h-4 mr-2 shrink-0" />
                  <span className="truncate">{photoData ? "Trocar foto" : "Adicionar foto"}</span>
                </Button>
                <Button className="flex-1 min-w-0 min-h-11" onClick={analyzeMeal}
                  disabled={analyzing || (!photoData && !photoNote.trim())}>
                  {analyzing
                    ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" aria-hidden /> Analisando...</>)
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
                      {/* Sem `shrink-0`/`nowrap`: com o Texto Maior o selo crescia
                          e empurrava a linha para fora da tela (Lince A1). Com teto
                          de 45% ele quebra linha e a descrição fica com o resto. */}
                      <span className="text-caption2 text-muted-foreground text-right max-w-[45%] rounded-full bg-muted px-2 py-0.5">
                        {confidenceLabel[estimate.confidence]}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Flame className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--vitalidade))" }} />
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
                    <Button onClick={confirmPhoto} loading={savingPhoto} disabled={analyzing}>
                      <Check className="w-4 h-4 mr-1" aria-hidden /> Registrar
                    </Button>
                  </div>
                </div>
              )}

              {/* A prova nº 1 do posicionamento, como LINHA e não como segundo
                  cartão dourado: nenhum app de dieta cruza comida com o
                  orçamento real de quem come. */}
              <p className="text-xs text-muted-foreground border-t pt-2.5">
                O Conselheiro conhece o seu orçamento, o seu gasto com comida e o seu objetivo.{" "}
                {/* `inline-flex min-h-11`: link no meio do parágrafo tinha o alvo
                    da linha de texto, 32 pt (Lince B7). Assim a linha dele cresce
                    a 44 pt e o texto em volta continua corrido. */}
                <Link className="inline-flex items-center min-h-11 underline text-foreground" to="/app/conselheiro">
                  Peça o plano alimentar que cabe no seu bolso
                </Link>{" "}
                — a meta do plano cai direto na sua tela Hoje.
                {kcalToday > 0 && <> Hoje você já registrou {kcalToday.toLocaleString("pt-BR")} kcal.</>}
              </p>
            </Card>
          )}

          {/* Água */}
          {trackers.has("water") && (
            <Card id="v-agua" className="p-4 space-y-3 scroll-mt-20">
              {/* `flex-wrap`: com Texto Maior "Minhas garrafas" desce para baixo
                  do título em vez de empurrar o cartão para fora da tela. */}
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <div className="flex items-center gap-2 text-sm font-medium min-w-0">
                  <Droplet className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--agua))" }} />
                  Hidratação de hoje
                </div>
                <Button variant="ghost" size="sm" className="min-h-11 text-muted-foreground"
                  onClick={() => setGarrafasAbertas(true)}>
                  <Settings2 className="w-4 h-4 mr-1.5" /> Minhas garrafas
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
                  {/* `min-h-11` com margem negativa, no padrão do
                      FirstTimeTip: a CAIXA passa a medir 44px de verdade
                      (auditoria mede `getBoundingClientRect`, não a intenção)
                      e a margem devolve o espaço ao layout, para a linha ao
                      lado não se mexer. */}
                  {!!aguaHoje.length && (
                    <button onClick={undoWater} className="mt-1 -my-2.5 py-2.5 min-h-11 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <Undo2 className="w-3 h-3" /> desfazer último
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {bottles.map((b, i) => (
                  <Button key={i} data-registro={i === 0 ? true : undefined}
                    variant="secondary" size="sm" className="gap-1.5 min-h-11"
                    onClick={() => addWater(b.ml)}>
                    <Plus className="w-3.5 h-3.5" />
                    {/* Rótulo e volume num ÚNICO bloco de texto: como dois itens
                        flex separados, cada um tinha o próprio piso ("Garrafa",
                        "500ml") e o chip não conseguia quebrar entre eles — a 40
                        pt passava 8 pt da tela. Juntos, quebram como frase. Sem
                        `min-w-0`: ele deixava o chip ser espremido até partir
                        "Garra / fa"; o piso natural é a maior palavra. */}
                    <span>
                      {b.label} <span className="text-muted-foreground">· {b.ml >= 1000 ? `${(b.ml / 1000).toString().replace(".", ",")}L` : `${b.ml}ml`}</span>
                    </span>
                  </Button>
                ))}
              </div>
            </Card>
          )}

          {/* Treino e sono, lado a lado: são as duas naturezas do que SUSTENTA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {trackers.has("workouts") && (
              <Card id="v-treino" className="p-4 space-y-2 scroll-mt-20">
                <p className="text-sm font-medium flex items-center gap-1.5"><Dumbbell className="w-4 h-4" /> Treino de hoje</p>
                <Input data-registro maxLength={80} placeholder="Ex.: pernas, corrida 5km" value={workout}
                  onChange={(e) => setWorkout(e.target.value)} />
                <div className="flex flex-wrap gap-1.5">
                  {MUSCLES.map((m) => (
                    <button
                      key={m} type="button" onClick={() => toggleMuscle(m)}
                      className={cn(
                        // `min-h-11`: são sete alvos em duas linhas, tocados
                        // no meio de um registro. 26px de altura é o pior
                        // lugar para economizar pixel.
                        "text-xs rounded-full border px-3 min-h-11 transition-colors",
                        /* A tinta escura da casa sobre a sálvia dá 4,55:1 no
                           claro e 8,32:1 no escuro; o branco reprova nos dois
                           (4,04:1 e 2,21:1). Era o mesmo par quando o pilar
                           era coral — só mudaram os números. */
                        muscles.includes(m)
                          ? "border-transparent text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted/60"
                      )}
                      style={muscles.includes(m) ? { background: "hsl(var(--vitalidade))" } : undefined}
                      aria-pressed={muscles.includes(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <Button onClick={logWorkout} variant="secondary" className="w-full min-h-11">Salvar treino</Button>
              </Card>
            )}

            {(trackers.has("sleep") || trackers.has("naps")) && (
              <Card id="v-sono" className="p-4 space-y-2 scroll-mt-20">
                <p className="text-sm font-medium flex items-center gap-1.5"><Moon className="w-4 h-4" /> Sono</p>
                {/* `flex-wrap`: os dois chips cabem lado a lado no tamanho
                    padrão; com Texto Maior "Soneca" desce em vez de vazar. */}
                <div className="flex flex-wrap gap-1.5">
                  {([["sleep", "Noite"], ["nap", "Soneca"]] as const)
                    .filter(([t]) => (t === "sleep" ? trackers.has("sleep") : trackers.has("naps")))
                    .map(([t, label]) => (
                      <button
                        key={t} type="button" onClick={() => setSleepType(t)}
                        className={cn(
                          // Mesma régua dos chips de músculo: 26px não é alvo.
                          "text-xs rounded-full border px-4 min-h-11 transition-colors",
                          effectiveSleepType === t
                            ? "border-transparent text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted/60"
                        )}
                        style={effectiveSleepType === t ? { background: "hsl(var(--vitalidade))" } : undefined}
                        aria-pressed={effectiveSleepType === t}
                      >
                        {label}
                      </button>
                    ))}
                </div>
                {dormiuHoje && effectiveSleepType === "nap" && sleepType === null && (
                  <p className="text-caption2 text-muted-foreground">
                    Sono da noite já registrado hoje, então sugeri soneca. Pode trocar acima.
                  </p>
                )}
                <div className="flex gap-2">
                  <Input data-registro inputMode="decimal"
                    placeholder={effectiveSleepType === "nap" ? "Duração em horas. Ex.: 0,5 = 30 min" : "Horas de sono. Ex.: 7,5"}
                    value={sleepHours}
                    onChange={(e) => setSleepHours(e.target.value)} />
                  <Button onClick={logSleep} variant="secondary" className="min-h-11">Salvar</Button>
                </div>

                {/* A rotina de sono (estilo iPhone) era um CARTÃO IRMÃO deste.
                    Horário de dormir não é um segundo tema: é ajuste do sono, e
                    ajuste que se mexe uma vez por semestre não merece a mesma
                    altura que o registro de todo dia.
                    Aberta por padrão para quem ainda não tem rotina — ali ela é
                    convite —, fechada depois de salva, quando vira ajuste. */}
                {trackers.has("sleep") && (
                  <Collapsible defaultOpen={!profile?.sleep_bedtime}>
                    <CollapsibleTrigger className="w-full min-h-11 flex items-center justify-between gap-1 text-xs text-muted-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                      <span className="flex items-center gap-1.5">
                        <BedDouble className="w-3.5 h-3.5" /> Minha rotina de sono
                        {routineHours !== null && (
                          <span className="text-foreground">· {formatWindowHours(routineHours)}</span>
                        )}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <SleepSchedule compact />
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </Card>
            )}
          </div>

          {!chips.length && (
            <p className="text-subhead text-muted-foreground rounded-md border p-3">
              Você desligou os indicadores de comida, água, treino e sono — nada aqui te cobra
              isso. Se mudar de ideia, reative em Ajustes, na seção "O que você acompanha".
            </p>
          )}

          <BotaoMetas onClick={() => setMetasAbertas(true)} />
        </TabsContent>

        {/* ══ ABA 2 — MEU CORPO: dado do corpo, não do dia ═════════════ */}
        <TabsContent value="corpo" className="space-y-4 mt-0">
          {!trackers.has("weight") && (
            <p className="text-subhead text-muted-foreground rounded-md border p-3">
              Você escolheu não acompanhar peso e corpo — nada aqui te cobra isso.
              Se mudar de ideia, reative em Ajustes, na seção "O que você acompanha".
            </p>
          )}

          {trackers.has("weight") && (
            <Card id="v-corpo" className="p-4 space-y-4 scroll-mt-20">
              <div>
                <h2 className="font-display font-semibold flex items-center gap-1.5">
                  <Scale className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} />
                  Evolução corporal
                </h2>
                <p className="text-xs text-muted-foreground">
                  Peso, tendência e composição. O número é só um dado — a direção importa mais que o dia.
                </p>
              </div>

              <div className="flex gap-2">
                <Input data-registro inputMode="decimal" placeholder="Peso de hoje (kg)" value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)} />
                <Button variant="secondary" className="min-h-11" onClick={logWeight} loading={savingWeight}>
                  Salvar
                </Button>
              </div>

              {weightSeries.length >= 2 ? (
                <>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={weightSeries} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                            borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))",
                          }}
                          formatter={(v: number) => [`${String(v).replace(".", ",")} kg`, "Peso"]}
                        />
                        {weightGoal && (
                          <ReferenceLine y={weightGoal} stroke="hsl(var(--gold))" strokeDasharray="5 4"
                            label={{ value: "meta", fontSize: 11, fill: "hsl(var(--gold))", position: "insideTopRight" }} />
                        )}
                        <Line isAnimationActive={!reduzMovimento} type="monotone" dataKey="kg" stroke="hsl(var(--vitalidade))" strokeWidth={2}
                          dot={{ r: 2.5, fill: "hsl(var(--vitalidade))" }} />
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

              <p className="text-caption2 text-right -mt-2">
                <Link className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  to={`/app/conselheiro?q=${encodeURIComponent("Analisa a tendência do meu peso nos últimos meses e me diz o que ela sugere.")}`}>
                  Perguntar ao Conselheiro sobre essa tendência
                </Link>
              </p>

              {caloriesByDay.length >= 2 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">Calorias estimadas por dia (14 dias)</p>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={caloriesByDay} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
                          contentStyle={{
                            background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                            borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))",
                          }}
                          formatter={(v: number) => [`${v} kcal`, "Total"]}
                        />
                        <Bar isAnimationActive={!reduzMovimento} dataKey="kcal" fill="hsl(var(--vitalidade) / 0.7)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-caption2 text-muted-foreground mt-1">
                    Soma das estimativas por foto — dias sem registro não aparecem.
                  </p>
                </div>
              )}

              {/* Composição corporal por foto — SUSPENSA (plano de consolidação,
                  Etapa 4.1): a estimativa exibia um ponto médio de aparência
                  clínica que a fotografia não sustenta. O backend também está
                  bloqueado (flags.body_photo_enabled = false). */}
            </Card>
          )}

          {/* Corpo treinado — o mapa que só a fusão deixa ficar ao lado do peso */}
          {trackers.has("workouts") && (
            <Card className="p-4 space-y-3">
              <div>
                <h2 className="font-display font-semibold flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} />
                  Corpo treinado — últimos {JANELA_DIAS} dias
                </h2>
                <p className="text-xs text-muted-foreground">
                  Marque os grupos ao salvar o treino e este mapa mostra o equilíbrio da sua rotina.
                </p>
              </div>

              {taggedWorkouts === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhum treino com grupos marcados ainda. No próximo treino, toque nos grupos
                  trabalhados antes de salvar — o gráfico nasce daí.
                </p>
              ) : (
                <>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="muscle" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
                          contentStyle={{
                            background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                            borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))",
                          }}
                        />
                        <Bar isAnimationActive={!reduzMovimento} dataKey="treinos" radius={[5, 5, 0, 0]}>
                          {barData.map((d, i) => (
                            <Cell key={i} fill={`hsl(var(--vitalidade) / ${0.35 + (d.treinos / maxCount) * 0.65})`} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {leastTrained.length > 0 && leastTrained.length < 6 && (
                    <p className="text-xs text-muted-foreground">
                      💡 {leastTrained.join(" e ")} {leastTrained.length === 1 ? "apareceu" : "apareceram"} menos
                      no período — se fizer sentido para o seu objetivo, vale dar atenção.
                    </p>
                  )}
                </>
              )}
            </Card>
          )}

          {/* Condições e medicamentos: o que o Conselheiro precisa respeitar */}
          <Card className="p-4 space-y-3">
            <div>
              <h2 className="font-display font-semibold flex items-center gap-1.5">
                <HeartPulse className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} />
                Minha saúde
              </h2>
              <p className="text-xs text-muted-foreground">
                Condições, alergias, lesões: o que o Conselheiro precisa saber para as sugestões
                de treino e alimentação respeitarem o seu corpo.
                Ex.: "diabetes tipo 2", "alergia a amendoim", "hérnia de disco".
              </p>
            </div>

            {conditions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {conditions.map((c, i) => (
                  <span key={`${c}-${i}`} className="inline-flex items-center gap-1.5 text-xs rounded-full border bg-muted/60 px-2.5 py-1 max-w-full">
                    <span className="truncate">{c}</span>
                    {/* O X media 12px. Cresce a CAIXA (padding + margem
                        negativa), não o ícone: o chip continua do mesmo
                        tamanho e o alvo passa a existir. */}
                    <button onClick={() => removeCondition(i)} aria-label={`Remover ${c}`}
                      className="text-muted-foreground hover:text-foreground shrink-0 px-3 py-3.5 -mx-3 -my-3.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <form onSubmit={addCondition} className="flex gap-2">
              <Input maxLength={80} placeholder="Adicionar condição de saúde"
                className="min-w-0 flex-1" value={conditionInput}
                onChange={(e) => setConditionInput(e.target.value)} />
              <Button type="submit" size="icon" className="shrink-0" aria-label="Adicionar condição">
                <Plus className="w-4 h-4" />
              </Button>
            </form>

            <div className="pt-1 space-y-2.5">
              <div>
                <p className="text-sm font-medium">Medicamentos em uso</p>
                <p className="text-xs text-muted-foreground">
                  Ex.: "metformina", "losartana", "vitamina D". O Conselheiro considera nas sugestões,
                  mas nunca vai mexer em dose ou uso: isso é sempre com quem prescreveu.
                </p>
              </div>

              {medications.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {medications.map((m, i) => (
                    <span key={`${m}-${i}`} className="inline-flex items-center gap-1.5 text-xs rounded-full border bg-muted/60 px-2.5 py-1 max-w-full">
                      <span className="truncate">{m}</span>
                      <button onClick={() => removeMedication(i)} aria-label={`Remover ${m}`}
                        className="text-muted-foreground hover:text-foreground shrink-0 px-3 py-3.5 -mx-3 -my-3.5">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <form onSubmit={addMedication} className="flex gap-2">
                <Input maxLength={80} placeholder="Adicionar medicamento"
                  className="min-w-0 flex-1" value={medicationInput}
                  onChange={(e) => setMedicationInput(e.target.value)} />
                <Button type="submit" size="icon" className="shrink-0" aria-label="Adicionar medicamento">
                  <Plus className="w-4 h-4" />
                </Button>
              </form>
            </div>

            <p className="text-caption2 text-muted-foreground">
              Isso adapta as sugestões, mas não substitui acompanhamento médico — decisões clínicas
              ficam sempre com o seu profissional de saúde.
            </p>
          </Card>

          <BotaoMetas onClick={() => setMetasAbertas(true)} />
        </TabsContent>

        {/* ══ ABA 3 — HISTÓRICO: um só, de 28 dias ═════════════════════ */}
        <TabsContent value="historico" className="space-y-4 mt-0">
          <Card id="v-historico" className="p-4 scroll-mt-20">
            <h2 className="font-display font-semibold mb-3">Últimos {JANELA_DIAS} dias</h2>

            {isLoading && <p role="status" className="text-sm text-muted-foreground">Carregando…</p>}

            {!isLoading && !isError && !eventos.length && (
              <div className="text-center py-6">
                <UtensilsCrossed className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-subhead text-muted-foreground">
                  Nada registrado ainda.<br />
                  Registre acima — ou conte na tela Hoje: "almocei frango com arroz e treinei pernas".
                </p>
              </div>
            )}

            <div className="space-y-4">
              {dias.map(([dia, evs]) => {
                const refs = evs.filter((e) => e.kind === "meal");
                return (
                  <div key={dia}>
                    <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                      {new Date(dia + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" })}
                    </p>

                    {/* O resumo do dia: treino, água e sono em uma linha cada.
                        Refeição ganha linha própria logo abaixo porque é a
                        única que a pessoa edita e apaga. */}
                    <div className="space-y-1">
                      {resumoDoDia(evs).map((l, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-md border p-2.5">
                          <l.icone className="w-4 h-4 shrink-0 text-muted-foreground" />
                          <span className="text-sm break-words min-w-0">{l.texto}</span>
                        </div>
                      ))}
                      {refs.map((m) => (
                        <div key={m.id} className="flex items-center gap-2 rounded-md border p-2.5">
                          <UtensilsCrossed className="w-4 h-4 shrink-0 text-muted-foreground" />
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
                          {/* 28x28 nos dois, e um deles APAGA um registro. A
                              regra de alvo vale em dobro num botão
                              destrutivo: errar o toque aqui não é ir para o
                              lugar errado, é perder o que a pessoa
                              registrou. */}
                          <Button variant="ghost" size="icon" className="w-11 h-11 shrink-0 text-muted-foreground"
                            onClick={() => setEditingMeal(m)} aria-label="Editar calorias">
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-11 h-11 shrink-0 text-muted-foreground"
                            onClick={() => removeMeal(m.id)} aria-label="Excluir refeição">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {eventos.length > 0 && (
              <div className="pt-4 mt-4 border-t">
                <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(14, minmax(0,1fr))" }}>
                  {heat.map((d) => (
                    <div
                      key={d.date}
                      title={`${new Date(d.date + "T00:00:00").toLocaleDateString("pt-BR")}: ${d.n} registro${d.n === 1 ? "" : "s"}`}
                      className="aspect-square rounded-[4px]"
                      style={{ background: d.n === 0 ? "hsl(var(--muted))" : `hsl(var(--vitalidade) / ${0.25 + d.pct * 0.75})` }}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Cada quadrado é um dia. Quanto mais forte, mais coisas do seu corpo entraram no dia.
                </p>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <MinhasMetas
        open={metasAbertas}
        onOpenChange={setMetasAbertas}
        trackers={trackers}
        onAbrirGarrafas={() => { setMetasAbertas(false); setGarrafasAbertas(true); }}
        onRefazerRaiox={() => { setMetasAbertas(false); setRaioxDispensado(false); trocarAba("dia"); }}
        podeRefazerRaiox={temRaiox}
      />

      <GarrafasDialog
        open={garrafasAbertas} onOpenChange={setGarrafasAbertas}
        initialBottles={bottles} onSaved={refreshProfile}
      />

      <CalorieEditDialog meal={editingMeal} onClose={() => setEditingMeal(null)} onSave={saveMealCalories} />
    </div>
  );
}

/** A porta da folha de metas. Uma linha, não um cartão: meta é ajuste, e
 *  ajuste não disputa espaço com registro. */
function BotaoMetas({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-11 text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      Minhas metas <span aria-hidden>→</span>
    </button>
  );
}

/* ─── Minhas metas: as seis num lugar só ────────────────────────────────────
   Eram seis GoalInput espalhados por dois pilares e cinco cartões (kcal,
   proteína, água, sono, treinos/semana, peso). A pessoa CAÇAVA meta. Aqui
   elas ficam juntas porque é assim que se pensa nelas — de uma vez, quando se
   decide o que perseguir — e some da tela do dia o que é ajuste, não registro.

   Cada meta mantém a validação que já tinha: a faixa é a mesma que o
   Conselheiro aceita ao propor, porque duas portas para o mesmo campo não
   podem ter réguas diferentes. */
function MinhasMetas({
  open, onOpenChange, trackers, onAbrirGarrafas, onRefazerRaiox, podeRefazerRaiox,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trackers: ReturnType<typeof activeTrackerSet>;
  onAbrirGarrafas: () => void;
  onRefazerRaiox: () => void;
  podeRefazerRaiox: boolean;
}) {
  const { user } = useAuth();
  const { profile, refresh } = useProfile();

  const salvar = async (patch: Record<string, number>, ok: string) => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update(patch).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar a meta. Tente de novo."); return; }
    toast.dismiss("Não consegui salvar a meta. Tente de novo.");
    toast.success(ok);
    refresh();
  };

  const saveCalorie = (raw: string) => {
    const kcal = Math.round(Number(raw.replace(/\D/g, "")));
    if (!kcal || kcal < 800 || kcal > 8000) {
      toast.error("Para montar seu plano com segurança, eu trabalho entre 800 e 8000 kcal por dia. Qual número, dentro disso, é o seu?");
      return;
    }
    toast.dismiss("Para montar seu plano com segurança, eu trabalho entre 800 e 8000 kcal por dia. Qual número, dentro disso, é o seu?");
    salvar({ calorie_goal_kcal: kcal }, "Meta calórica diária salva. Acompanhe na tela Hoje.");
  };

  const saveProtein = (raw: string) => {
    const g = Math.round(Number(String(raw).replace(",", ".").replace(/[^\d.]/g, "")));
    if (!g || g < 20 || g > 400) { toast.error("Trabalho com metas de proteína entre 20 e 400 g por dia. Quanto você quer?"); return; }
    toast.dismiss("Trabalho com metas de proteína entre 20 e 400 g por dia. Quanto você quer?");
    salvar({ protein_goal_g: g }, "Meta de proteína salva. Acompanhe na tela Hoje.");
  };

  const saveWater = (raw: string) => {
    const ml = Math.round(Number(raw.replace(",", ".")) * 1000);
    if (!ml || ml < 500 || ml > 8000) { toast.error("Defina uma meta de água entre 0,5 L e 8 L."); return; }
    toast.dismiss("Defina uma meta de água entre 0,5 L e 8 L.");
    salvar({ water_goal_ml: ml }, "Meta de água salva. Acompanhe na tela Hoje.");
  };

  const saveSleep = (raw: string) => {
    const h = Number(raw.replace(",", "."));
    if (!h || h < 4 || h > 12) { toast.error("Trabalho com metas de sono entre 4 e 12 horas por noite. Quantas horas você quer dormir?"); return; }
    toast.dismiss("Trabalho com metas de sono entre 4 e 12 horas por noite. Quantas horas você quer dormir?");
    salvar({ sleep_goal_h: h }, "Meta de sono salva. Acompanhe na tela Hoje.");
  };

  const saveWorkouts = (raw: string) => {
    const n = Math.round(Number(raw));
    if (!n || n < 1 || n > 14) { toast.error("Trabalho com até 14 treinos por semana. Quantos cabem na sua rotina?"); return; }
    toast.dismiss("Trabalho com até 14 treinos por semana. Quantos cabem na sua rotina?");
    salvar({ weekly_workouts_goal: n }, "Meta de treinos salva. Acompanhe na tela Hoje.");
  };

  const saveWeight = (raw: string) => {
    const kg = Number(raw.replace(",", "."));
    if (!kg || kg < 20 || kg > 400) { toast.error("Só consigo guardar metas de peso entre 20 e 400 kg. Escreva assim: 75 ou 78,5."); return; }
    toast.dismiss("Só consigo guardar metas de peso entre 20 e 400 kg. Escreva assim: 75 ou 78,5.");
    salvar({ weight_goal_kg: kg }, "Meta de peso salva.");
  };

  const kcalGoal = Number(profile?.calorie_goal_kcal) || 0;
  const protGoal = Number(profile?.protein_goal_g) || 0;
  const waterGoal = profile?.water_goal_ml ?? DEFAULT_WATER_GOAL_ML;
  const sleepGoal = Number(profile?.sleep_goal_h) || 0;
  const workoutsGoal = Number(profile?.weekly_workouts_goal) || 0;
  const weightGoal = Number(profile?.weight_goal_kg) || 0;

  const linhas: { mostrar: boolean; titulo: string; input: React.ReactNode }[] = [
    {
      mostrar: trackers.has("meals"), titulo: "Calorias por dia",
      input: <GoalInput inputMode="numeric" placeholder="Definir meta diária (kcal)"
        currentLabel={kcalGoal > 0 ? `Meta: ${kcalGoal.toLocaleString("pt-BR")} kcal/dia` : null} onSubmit={saveCalorie} />,
    },
    {
      mostrar: trackers.has("protein"), titulo: "Proteína por dia",
      input: <GoalInput inputMode="numeric" placeholder="Definir meta diária (g)"
        currentLabel={protGoal > 0 ? `Meta: ${protGoal} g/dia` : null} onSubmit={saveProtein} />,
    },
    {
      mostrar: trackers.has("water"), titulo: "Água por dia",
      input: <GoalInput placeholder="Definir meta diária (litros)"
        currentLabel={`Meta: ${(waterGoal / 1000).toString().replace(".", ",")} L/dia`} onSubmit={saveWater} />,
    },
    {
      mostrar: trackers.has("sleep"), titulo: "Sono por noite",
      input: <GoalInput placeholder="Definir meta (horas por noite)"
        currentLabel={sleepGoal > 0 ? `Meta: ${String(sleepGoal).replace(".", ",")} h/noite` : null} onSubmit={saveSleep} />,
    },
    {
      mostrar: trackers.has("workouts"), titulo: "Treinos por semana",
      input: <GoalInput inputMode="numeric" placeholder="Definir meta (treinos por semana)"
        currentLabel={workoutsGoal > 0 ? `Meta: ${workoutsGoal} treinos por semana` : null} onSubmit={saveWorkouts} />,
    },
    {
      mostrar: trackers.has("weight"), titulo: "Peso",
      input: <GoalInput placeholder="Definir meta de peso (kg)"
        currentLabel={weightGoal > 0 ? `Meta: ${String(weightGoal).replace(".", ",")} kg` : null} onSubmit={saveWeight} />,
    },
  ].filter((l) => l.mostrar);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-1.5">
            <Target className="w-4 h-4" style={{ color: "hsl(var(--vitalidade))" }} /> Minhas metas
          </DrawerTitle>
          <DrawerDescription>
            Você acompanha todas elas na tela Hoje. Só aparecem aqui as que você escolheu
            acompanhar — o resto está desligado em Ajustes, e o histórico continua seu.
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          {linhas.map((l) => (
            <div key={l.titulo} className="space-y-1.5">
              <p className="text-sm font-medium">{l.titulo}</p>
              {l.input}
            </div>
          ))}

          {!linhas.length && (
            <p className="text-subhead text-muted-foreground">
              Você desligou todos os indicadores desta área. Reative em Ajustes, na seção
              "O que você acompanha".
            </p>
          )}

          <div className="border-t pt-3 space-y-2">
            {trackers.has("water") && (
              <button type="button" onClick={onAbrirGarrafas}
                className="block w-full text-left min-h-11 text-sm text-muted-foreground hover:text-foreground underline underline-offset-2">
                Tamanho das minhas garrafas e copos <span aria-hidden>→</span>
              </button>
            )}
            {podeRefazerRaiox && (
              <button type="button" onClick={onRefazerRaiox}
                className="block w-full text-left min-h-11 text-sm text-muted-foreground hover:text-foreground underline underline-offset-2">
                Refazer o Raio-X de Vitalidade <span aria-hidden>→</span>
              </button>
            )}
            <p className="text-caption2 text-muted-foreground">
              Sem ideia de número? Peça ao Conselheiro: ele parte do seu objetivo, do seu
              orçamento e do que você já registrou.
            </p>
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

/** Diálogo para editar as calorias de uma refeição já registrada. */
function CalorieEditDialog({
  meal, onClose, onSave,
}: {
  meal: VitalEvent | null;
  onClose: () => void;
  onSave: (meal: VitalEvent, calories: number) => Promise<void>;
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
    <Folha open={!!meal} onOpenChange={(v) => { if (!v) { setValue(""); onClose(); } }}>
      <FolhaContent className="max-w-sm">
        <FolhaHeader>
          <FolhaTitle>Editar calorias</FolhaTitle>
          <FolhaDescription className="break-words">
            {meal?.payload?.description ?? "Refeição"}
          </FolhaDescription>
        </FolhaHeader>
        <FolhaBody className="flex items-center gap-2">
          <Flame className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--vitalidade))" }} />
          <Input
            inputMode="numeric" autoFocus
            className="w-28 text-base font-semibold"
            placeholder={current || "0"}
            value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            aria-label="Calorias"
          />
          <span className="text-sm text-muted-foreground">kcal</span>
        </FolhaBody>
        <FolhaFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} loading={saving}>Salvar</Button>
        </FolhaFooter>
      </FolhaContent>
    </Folha>
  );
}

/** Anel de progresso da hidratação. Azul, não sálvia: água é o domínio que já
 *  tinha cor própria antes da fusão (`hsl(205 70% 55%)`, na tela Hoje), e cor
 *  por domínio é o que impede quatro barras do mesmo tom empilhadas. */
function WaterRing({ pct }: { pct: number }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0" aria-hidden>
      <circle cx="34" cy="34" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="7" />
      <circle
        cx="34" cy="34" r={r} fill="none" stroke="hsl(var(--agua))" strokeWidth="7"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 34 34)" style={{ transition: "stroke-dashoffset .4s ease" }}
      />
      <text x="34" y="38" textAnchor="middle" className="fill-foreground" style={{ fontSize: 15, fontWeight: 600 }}>
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

/* ─── As garrafas ───────────────────────────────────────────────────────────
   A META de água saiu daqui e foi para "Minhas metas", com as outras cinco:
   duas portas para o mesmo número é como ele começa a divergir. Aqui ficou só
   o que é desta folha — o tamanho do copo que a pessoa usa, que é o que faz
   registrar água ser um toque. */
function GarrafasDialog({
  open, onOpenChange, initialBottles, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialBottles: WaterBottle[];
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<WaterBottle[]>(initialBottles.map((b) => ({ ...b })));
  const [saving, setSaving] = useState(false);

  const reset = () => setRows(initialBottles.map((b) => ({ ...b })));
  const setRow = (i: number, patch: Partial<WaterBottle>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { label: "", ml: 300 }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const save = async () => {
    if (!user) return;
    const clean = rows
      .map((r) => ({ label: r.label.trim(), ml: Math.round(Number(String(r.ml).replace(",", "."))) }))
      .filter((r) => r.label && r.ml > 0 && r.ml <= 5000);
    if (!clean.length) { toast.error("Deixe pelo menos uma garrafa válida (nome e volume)."); return; }
    toast.dismiss("Deixe pelo menos uma garrafa válida (nome e volume).");
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ water_bottles: clean }).eq("user_id", user.id);
    setSaving(false);
    if (error) { toast.error("Não consegui salvar. Tente de novo."); return; }
    toast.dismiss("Não consegui salvar. Tente de novo.");
    toast.success("Garrafas salvas.");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Folha open={open} onOpenChange={(v) => { if (v) reset(); onOpenChange(v); }}>
      <FolhaContent>
        <FolhaHeader>
          <FolhaTitle>Minhas garrafas e copos</FolhaTitle>
          <FolhaDescription>
            Cadastre o que você usa de verdade. Assim, registrar água passa a ser um toque só.
            A meta do dia fica em Minhas metas.
          </FolhaDescription>
        </FolhaHeader>

        <FolhaBody className="space-y-2">
          <Label>Garrafas / copos</Label>
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
              <Button variant="ghost" size="icon" className="w-11 h-11 shrink-0 text-muted-foreground"
                onClick={() => removeRow(i)} aria-label="Remover">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRow} className="w-full">
            <Plus className="w-4 h-4 mr-1.5" /> Adicionar garrafa
          </Button>
        </FolhaBody>

        <FolhaFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} loading={saving}>Salvar</Button>
        </FolhaFooter>
      </FolhaContent>
    </Folha>
  );
}
