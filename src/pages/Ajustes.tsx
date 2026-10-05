import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import {
  LogOut, Smartphone, Share, Sun, Moon, Monitor, Plus, X, Brain, Download, ShieldAlert,
  Sparkles, Eye, Upload, FileStack, ChevronRight, MessageSquarePlus, UserRound,
  SlidersHorizontal, Database, Palette, MessageCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { PILLARS, pillarById, normalizePillars, type PillarId } from "@/lib/pillars";
import { TRACKERS } from "@/lib/trackers";
import { sleepWindowHours, timeForInput, formatWindowHours } from "@/lib/sleep";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import FirstTimeTip from "@/components/core/FirstTimeTip";
import HealthImport from "@/components/core/HealthImport";
import SourcesAndImports from "@/components/core/SourcesAndImports";
import MemoryControl from "@/components/core/MemoryControl";
import QueryError from "@/components/core/QueryError";
import { useGuides } from "@/hooks/useGuides";
import { useMokariPreference } from "@/hooks/useMokariPreference";
import FeedbackDialog from "@/components/core/FeedbackDialog";
import WhatsappCard from "@/components/core/WhatsappCard";
import { todayISOInSP } from "@/lib/dates";
import { cn } from "@/lib/utils";


/* "Automático" PRIMEIRO, e é o padrão (`useTheme`): o app acompanha o
   iPhone, que é o que o HIG pede ("Avoid offering an app-specific appearance
   setting"). O claro e o escuro fixos continuam aqui porque a noite na
   montanha é parte da identidade — mas como exceção escolhida, não como a
   primeira pergunta. E o seletor mora só aqui; saiu da folha Conta. */
const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "Automático", icon: Monitor },
  { id: "light", label: "Claro", icon: Sun },
  { id: "dark", label: "Escuro", icon: Moon },
];

/* ── AS SUBSEÇÕES ──────────────────────────────────────────────────────
   A página era uma coluna de 7 telas de rolagem. Agora o primeiro nível é um
   índice e cada subseção cabe numa tela. Elas vivem em `?secao=`, e não em
   rotas filhas, por dois motivos: o estado do formulário é UM só (dá para
   mexer no perfil, ir aos pilares e salvar tudo de uma vez, sem perder o que
   foi digitado), e um endereço com `?secao=` é um link — o "+ Ano de
   nascimento" do perfil incompleto e o "Tudo o que sei sobre você" do
   Conselheiro abrem direto onde a pessoa precisa estar. */
type SecaoId = "perfil" | "acompanha" | "conselheiro" | "dados" | "aparencia" | "conectar";
const SECOES: { id: SecaoId; titulo: string; resumo: string; icon: typeof Sun }[] = [
  { id: "perfil", titulo: "Perfil", resumo: "Nome, objetivo, dinheiro e o que embasa os planos", icon: UserRound },
  { id: "acompanha", titulo: "O que você acompanha", resumo: "Pilares ativos e os itens de cada um", icon: SlidersHorizontal },
  { id: "conselheiro", titulo: "O que o Conselheiro vê", resumo: "As áreas que ele analisa e o que ele já sabe", icon: Eye },
  { id: "dados", titulo: "Seus dados", resumo: "Importar, conferir, exportar ou excluir", icon: Database },
  { id: "aparencia", titulo: "Aparência", resumo: "Tema, Mokari e dicas de uso", icon: Palette },
  { id: "conectar", titulo: "WhatsApp e tela inicial", resumo: "Registrar por mensagem e instalar o app", icon: MessageCircle },
];

const DIAS_DO_CICLO = Array.from({ length: 28 }, (_, i) => i + 1);

/* ── REAIS EM PT-BR ────────────────────────────────────────────────────
   Lê o que a pessoa digitou do jeito brasileiro ("1.234,56", "1234,5",
   "R$ 800") e devolve número, ou `null` para vazio, ou `NaN` para o que não
   é número — e NaN não vira zero: zero é uma renda que ela não declarou.
   Um ponto sozinho seguido de três dígitos é milhar ("1.500"), não decimal:
   é assim que se escreve dinheiro aqui. */
function lerReais(bruto: string): number | null {
  const t = bruto.replace(/R\$|\s/g, "");
  if (!t) return null;
  let normal: string;
  if (t.includes(",")) normal = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, "");
  else normal = t;
  return /^\d+(\.\d+)?$/.test(normal) ? Number(normal) : NaN;
}
const formatarReais = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n)
    ? ""
    : n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** Ao sair do campo: reescreve no formato da casa, ou deixa como está se não
 *  for número (a pessoa vê o que digitou e o Salvar avisa). */
const reescreverReais = (bruto: string): string => {
  const n = lerReais(bruto);
  return n === null || Number.isNaN(n) ? bruto : formatarReais(n);
};
const mesmoValor = (a: number | null, b: number | null) =>
  a === b || (a != null && b != null && Math.abs(a - b) < 0.005);

/** O dia 1 e "nenhum dia" são o mesmo ciclo (o mês civil): os dois viram "",
 *  para que guardar 1 não apareça como alteração pendente. */
const cicloComoTexto = (d: number | null | undefined): string =>
  d != null && d >= 2 && d <= 28 ? String(d) : "";

export default function Ajustes() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const secaoBruta = params.get("secao");
  const secao: SecaoId | null = SECOES.some((s) => s.id === secaoBruta) ? (secaoBruta as SecaoId) : null;

  /* Abrir EMPILHA no histórico: é isso que faz o Voltar do cabeçalho, o do
     navegador e o gesto do Android levarem da subseção de volta ao índice.
     Quem chegou por link direto (o "+ Ano de nascimento" do perfil
     incompleto) volta para a tela de onde o link veio — que é onde ela
     estava antes. */
  const abrirSecao = (id: SecaoId) => setParams({ secao: id });
  // Cada subseção começa no topo, como uma tela nova (e não no meio da rolagem do índice).
  useEffect(() => { window.scrollTo(0, 0); }, [secao]);
  const { user } = useAuth();
  const { profile, refresh, isError: profileError, isFetching: profileFetching } = useProfile();
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [income, setIncome] = useState("");
  const [budget, setBudget] = useState("");
  const [cycleDay, setCycleDay] = useState("");
  const [foodSpend, setFoodSpend] = useState("");
  const [spirit, setSpirit] = useState("");
  const [hasReligion, setHasReligion] = useState(true);
  const [birthYear, setBirthYear] = useState("");
  const [sex, setSex] = useState("nao_informar");
  const [heightCm, setHeightCm] = useState("");
  const [activity, setActivity] = useState("nao_informar");
  const [restrictions, setRestrictions] = useState<string[]>([]);
  const [restrictionInput, setRestrictionInput] = useState("");
  const [pillars, setPillars] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  /* Valor em reais que não é número: o aviso mora embaixo do campo, e só
     depois de a pessoa sair dele ou tentar salvar — avisar no meio da
     digitação seria cobrar cedo demais. */
  const [mostrarErros, setMostrarErros] = useState(false);
  const erroDe = (bruto: string) => mostrarErros && Number.isNaN(lerReais(bruto));

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? "");
    setGoal(profile.goal ?? "");
    setIncome(formatarReais(profile.monthly_income));
    setBudget(formatarReais(profile.monthly_budget));
    setCycleDay(cicloComoTexto(profile.financial_cycle_day));
    setFoodSpend(formatarReais(profile.est_food_spend));
    setSpirit(profile.spirituality_label ?? "");
    setHasReligion(profile.has_religion !== false);
    setBirthYear(profile.birth_year ? String(profile.birth_year) : "");
    setSex(profile.sex ?? "nao_informar");
    setHeightCm(profile.height_cm ? String(profile.height_cm) : "");
    setActivity(profile.activity_level ?? "nao_informar");
    setRestrictions(profile.dietary_restrictions ?? []);
    /* CRU, NÃO: um perfil que ainda não passou pela migration traz
       `["alimentacao"]`, e a lista crua não casa com nenhum id de hoje. O
       efeito não era cosmético — o Switch de Vitalidade nascia DESLIGADO
       enquanto Hoje, Score, Jornada e a captura (que passam por
       `activePillarSet`) mostravam o pilar ligado, e a seção de trackers
       logo abaixo renderizava vazia por não casar com nada. Pior: como a
       Vitalidade nunca aparecia ligada, ela nunca podia ser desligada.
       Traduzir aqui é o que faz esta tela contar a MESMA história que o
       resto do app sobre uma escolha que é da pessoa. */
    setPillars(normalizePillars(profile.pillars));
  }, [profile]);

  const adicionarRestricao = () => {
    const v = restrictionInput.trim();
    if (v && !restrictions.some((x) => x.toLowerCase() === v.toLowerCase()) && restrictions.length < 15) {
      setRestrictions((rs) => [...rs, v]); setRestrictionInput("");
    }
  };

  const togglePillar = (id: PillarId, on: boolean) =>
    setPillars((p) => (on ? [...new Set([...p, id])] : p.filter((x) => x !== id)));

  /* ── Alteração não salva, visível (análise UX item 8) ──────────────────
     Metade desta página salva sozinha (tema, trackers, escopos) e a outra
     metade dependia de um botão no MEIO do scroll — com um aviso pedindo
     para a pessoa lembrar dele. Agora o formulário se compara com o perfil
     salvo e, enquanto houver diferença, uma barra fixa acompanha a rolagem:
     o estado deixa de ser invisível e não dá mais para sair sem perceber. */
  const savedSnapshot = useMemo(() => ({
    name: profile?.name ?? "",
    goal: profile?.goal ?? "",
    /* Dinheiro se compara pelo NÚMERO, não pelo texto: "1500" e "1.500"
       são a mesma renda, e a pessoa não pode ver "alteração não salva" só
       porque o campo ainda não foi reescrito no formato da casa. */
    income: profile?.monthly_income ?? null,
    budget: profile?.monthly_budget ?? null,
    cycleDay: cicloComoTexto(profile?.financial_cycle_day),
    foodSpend: profile?.est_food_spend ?? null,
    spirit: profile?.spirituality_label ?? "",
    hasReligion: profile?.has_religion !== false,
    birthYear: profile?.birth_year ? String(profile.birth_year) : "",
    sex: profile?.sex ?? "nao_informar",
    heightCm: profile?.height_cm ? String(profile.height_cm) : "",
    activity: profile?.activity_level ?? "nao_informar",
    restrictions: (profile?.dietary_restrictions ?? []).join("|"),
    /* A MESMA tradução do estado, e não é opcional: com o retrato guardando
       "alimentacao" e o estado já em "vitalidade", `dirty` nascia true e a
       pessoa via "alteração não salva" numa tela que ela acabou de abrir,
       sem ter tocado em nada. Os dois lados da comparação têm de falar a
       mesma língua. */
    pillars: normalizePillars(profile?.pillars).sort().join("|"),
  }), [profile]);

  const dirty = !!profile && (
    name !== savedSnapshot.name ||
    goal !== savedSnapshot.goal ||
    !mesmoValor(lerReais(income), savedSnapshot.income) ||
    !mesmoValor(lerReais(budget), savedSnapshot.budget) ||
    cycleDay !== savedSnapshot.cycleDay ||
    !mesmoValor(lerReais(foodSpend), savedSnapshot.foodSpend) ||
    spirit !== savedSnapshot.spirit ||
    hasReligion !== savedSnapshot.hasReligion ||
    birthYear !== savedSnapshot.birthYear ||
    sex !== savedSnapshot.sex ||
    heightCm !== savedSnapshot.heightCm ||
    activity !== savedSnapshot.activity ||
    restrictions.join("|") !== savedSnapshot.restrictions ||
    [...pillars].sort().join("|") !== savedSnapshot.pillars
  );

  const save = async () => {
    if (!user) return;
    const renda = lerReais(income), orcamento = lerReais(budget), comida = lerReais(foodSpend);
    /* Antes o `type="number"` barrava letra no próprio campo; com teclado
       decimal e texto livre, quem barra é o Salvar — e diz QUAL campo, em vez
       de gravar zero no lugar de um valor que a pessoa acha que digitou. */
    // O aviso aparece embaixo de cada campo errado (`erroDe`); aqui só se
    // leva o foco ao primeiro, para quem salvou pela barra fixa lá embaixo.
    const primeiro = ([["income", renda], ["budget", orcamento], ["food-spend", comida]] as const)
      .find(([, v]) => Number.isNaN(v));
    if (primeiro) {
      setMostrarErros(true);
      document.getElementById(primeiro[0])?.focus();
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      name: name.trim() || null,
      goal: goal.trim() || null,
      monthly_income: renda,
      monthly_budget: orcamento,
      financial_cycle_day: cycleDay && Number(cycleDay) >= 2 && Number(cycleDay) <= 28 ? Number(cycleDay) : null,
      est_food_spend: comida,
      spirituality_label: hasReligion ? (spirit.trim() || null) : null,
      has_religion: hasReligion,
      birth_year: birthYear && Number(birthYear) > 1900 && Number(birthYear) <= new Date().getFullYear() ? Number(birthYear) : null,
      sex: sex === "nao_informar" ? null : sex,
      height_cm: heightCm && Number(heightCm.replace(",", ".")) > 80 ? Number(heightCm.replace(",", ".")) : null,
      activity_level: activity === "nao_informar" ? null : activity,
      dietary_restrictions: restrictions,
      pillars,
    }).eq("user_id", user.id);
    setSaving(false);
    if (error) { toast.error("Não consegui salvar seus ajustes. Tente de novo."); return; }
    toast.dismiss("Não consegui salvar seus ajustes. Tente de novo.");
    // Sem toast de sucesso: o botão vira "Tudo salvo" e a barra de pendência
    // some — o resultado já está na tela. Toast que repete a tela é ruído.
    refresh();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  /* ── Privacidade: quais áreas o Conselheiro pode analisar ──────
     FUSÃO DE 17/09/2026: `alimentacao` saiu desta lista e o escopo de
     Vitalidade passou a cobrir as duas intimidades físicas de uma vez. */
  const SCOPES: { id: string; label: string }[] = [
    { id: "prosperidade", label: "Prosperidade (finanças)" },
    { id: "vitalidade", label: "Vitalidade (sono, treino, refeições, peso e hidratação)" },
    { id: "mente", label: "Mente & Espírito (humor, práticas, gratidão)" },
    { id: "diario", label: "Diário (trechos das suas anotações)" },
  ];
  const [scopes, setScopes] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const raw = ((profile as unknown as { ai_scopes?: Record<string, boolean> })?.ai_scopes) ?? {};
    const next: Record<string, boolean> = {};
    for (const sc of SCOPES) next[sc.id] = raw[sc.id] !== false;
    /* O interruptor fundido nasce do E das duas chaves antigas, não de uma
       delas: `ai_scopes` é registro de CONSENTIMENTO, e sob OU uma refatoração
       nossa devolveria ao Conselheiro peso, calorias, proteína e hidratação
       sem a pessoa tocar em nada. É a mesma precedência que o servidor já usa
       (`every`, não `some`) — na dúvida, o retrato fica mais pobre, nunca
       mentiroso.
       E a chave legada entra no ESTADO, não só no toggle: sem isto, mexer em
       QUALQUER outro interruptor gravaria um objeto sem `alimentacao` — e
       chave ausente significa autorizado. Ver a nota em `toggleScope`. */
    next.vitalidade = raw.vitalidade !== false && raw.alimentacao !== false;
    next.alimentacao = next.vitalidade;
    setScopes(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  const toggleScope = async (id: string, on: boolean) => {
    if (!user) return;
    const next = { ...scopes, [id]: on };
    /* ── A REGRA DA JANELA, E ELA É INEGOCIÁVEL ────────────────────────────
       Este handler grava o objeto `ai_scopes` INTEIRO, reconstruído a partir
       de SCOPES. Como `alimentacao` saiu da lista acima, o primeiro toque em
       QUALQUER interruptor desta tela apagaria a chave do banco — e para
       qualquer função ainda velha, ou num rollback, CHAVE AUSENTE SIGNIFICA
       AUTORIZADO. Ou seja: a pessoa mexe na tela de privacidade e a
       consequência é reabrir o que ela havia fechado. Não existe
       consentimento para isso, e nem aviso.
       Por isso o toggle fundido ESPELHA o valor nas duas chaves enquanto
       existir função velha em produção. O par desta linha é a leitura
       derivada no servidor (`_shared/lib.ts`: `vitalidade: raw.vitalidade
       !== false && raw.alimentacao !== false`) — as duas saem JUNTAS na
       release de contração (R3, até 30/11/2026), nunca uma sem a outra. */
    if (id === "vitalidade") next.alimentacao = on;
    setScopes(next);
    const { error } = await supabase.from("profiles").update({ ai_scopes: next }).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar a preferência. Tente de novo."); setScopes(scopes); return; }
    toast.dismiss("Não consegui salvar a preferência. Tente de novo.");
    toast.success(on ? "O Conselheiro voltará a considerar essa área." : "O Conselheiro deixará essa área de fora das análises.");
  };

  // ── Modularidade total: o que a pessoa acompanha (trackers) ───
  // Só guarda o que foi DESLIGADO; ausência = ligado. Desligar esconde
  // (telas, briefing, Conselheiro), nunca apaga o histórico.
  const [trackingPrefs, setTrackingPrefs] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setTrackingPrefs((profile?.tracking_prefs as Record<string, boolean>) ?? {});
  }, [profile]);
  const toggleTracker = async (id: string, on: boolean) => {
    if (!user) return;
    const next = { ...trackingPrefs };
    if (on) delete next[id]; else next[id] = false;
    setTrackingPrefs(next);
    const { error } = await supabase.from("profiles").update({ tracking_prefs: next }).eq("user_id", user.id);
    if (error) { toast.error("Não consegui salvar a preferência. Tente de novo."); setTrackingPrefs(trackingPrefs); return; }
    toast.dismiss("Não consegui salvar a preferência. Tente de novo.");
    toast.success(on
      ? "Reativado — tudo volta, com o histórico intacto."
      : "Desligado. Isso some das telas e das análises; nada foi apagado.");
    refresh();
  };

  // ── Exportação de dados (sempre gratuita) ─────────────────────
  const EXPORT_TABLES = [
    "profiles", "life_events", "transactions", "habits", "habit_logs",
    "chat_messages", "briefings", "plans", "battles", "battle_checkins",
    "ai_memories", "xp_log",
  ];
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const download = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };
  const exportJson = async () => {
    if (!user) return;
    setExporting("json");
    try {
      const out: Record<string, unknown[]> = {};
      for (const t of EXPORT_TABLES) {
        const { data, error } = await supabase.from(t).select("*").eq("user_id", user.id).limit(10000);
        if (error) throw error;
        out[t] = data ?? [];
      }
      download(`ascende-dados-${todayISOInSP()}.json`,
        JSON.stringify({ exported_at: new Date().toISOString(), ...out }, null, 2),
        "application/json");
      toast.dismiss("Não consegui exportar agora. Tente de novo.");
      toast.success("Exportação concluída. O arquivo JSON foi baixado.");
    } catch {
      toast.error("Não consegui exportar agora. Tente de novo.");
    } finally { setExporting(null); }
  };
  const toCsv = (rows: Record<string, unknown>[]) => {
    if (!rows.length) return "";
    const cols = Object.keys(rows[0]);
    const esc = (v: unknown) => {
      const str = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  };
  const exportCsv = async () => {
    if (!user) return;
    setExporting("csv");
    try {
      for (const t of ["life_events", "transactions"]) {
        const { data, error } = await supabase.from(t).select("*").eq("user_id", user.id).limit(10000);
        if (error) throw error;
        download(`ascende-${t}-${todayISOInSP()}.csv`,
          toCsv((data ?? []) as Record<string, unknown>[]), "text/csv");
      }
      toast.dismiss("Não consegui exportar agora. Tente de novo.");
      toast.success("Exportação concluída. Os arquivos CSV foram baixados.");
    } catch {
      toast.error("Não consegui exportar agora. Tente de novo.");
    } finally { setExporting(null); }
  };

  // ── Exclusão definitiva da conta (sempre gratuita) ────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const deleteAccount = async () => {
    if (deleteText !== "EXCLUIR") return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: { confirm: "EXCLUIR" },
      });
      if (error || data?.error) throw new Error(data?.error ?? "erro");
      toast.success("Conta excluída. Sentiremos sua falta.");
      await supabase.auth.signOut();
      navigate("/", { replace: true });
    } catch {
      toast.error("Não consegui excluir agora. Tente novamente ou fale com o suporte.");
      setDeleting(false);
    }
  };

  // ── Memória do Conselheiro: ver e apagar o que a IA aprendeu ──
  const qc = useQueryClient();
  const { resetAll: resetGuides, disableAll: disableGuides } = useGuides();
  const mokari = useMokariPreference();
  const [clearingMemories, setClearingMemories] = useState(false);
  /* A CONFIRMAÇÃO SAIU DO window.confirm NATIVO.
     Duas coisas estavam erradas, e as duas na mesma tela. (a) "Apagar TUDO"
     em maiúsculas é grito, e esta é uma ação de PRIVACIDADE — um direito da
     pessoa, não um risco do qual ela deva ser dissuadida. O app promete "seus
     dados continuam seus", e a tela que exerce essa promessa era a que mais
     parecia advertência. (b) O diálogo nativo mostra o domínio no título
     ("ascende.app diz:") e rotula os botões como "OK" e "Cancelar" — dois
     rótulos que não dizem o que acontece, justamente onde isso mais importa.
     A exclusão de conta, logo abaixo nesta página, já usava um diálogo com
     botões nomeados; esta tinha ficado para trás. */
  const [confirmClearMemories, setConfirmClearMemories] = useState(false);
  const clearMemories = async () => {
    if (!user) return;
    setConfirmClearMemories(false);
    setClearingMemories(true);
    const { error } = await supabase.from("ai_memories").delete().eq("user_id", user.id);
    setClearingMemories(false);
    if (error) { toast.error("Não consegui apagar. Tente de novo."); return; }
    toast.dismiss("Não consegui apagar. Tente de novo.");
    // A lista abaixo esvazia na hora: é ela que confirma, não um toast.
    qc.invalidateQueries({ queryKey: ["ai-memories"] });
  };


  /* ── O botão de salvar das subseções que dependem dele ─────────────────
     Perfil e "O que você acompanha" (pilares) gravam no mesmo `save`; as
     outras subseções salvam sozinhas a cada toque. O botão mora no FIM de
     cada subseção que precisa dele — e a barra fixa de "não salvo" continua
     valendo em qualquer uma, inclusive no índice: o formulário é um só, e
     trocar de subseção não descarta nada do que foi digitado. */
  const botaoSalvar = (
    <Button className="w-full" onClick={save} disabled={!dirty} loading={saving}>
      {dirty ? "Salvar ajustes" : "Tudo salvo"}
    </Button>
  );

  const atual = SECOES.find((s) => s.id === secao) ?? null;

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up [&_:is(h1,h2,h3)]:hyphens-auto [&_:is(h1,h2,h3)]:[overflow-wrap:break-word]">
      {/* Títulos podem quebrar no meio da palavra, e só quando a palavra
        não cabe: com Texto Maior a 40 pt, "Prosperidade" ou "Conselheiro"
        num `text-2xl` passam da largura da tela sozinhos. Hifeniza em
        pt-BR onde o dicionário deixa; senão, quebra onde precisar. No
        tamanho padrão nenhum título chega na borda, então nada muda. */}
      {/* SEM "‹ Ajustes" aqui dentro: o Voltar do cabeçalho (AppLayout)
          aparece em toda tela que não é raiz de aba, e esta não é. Ele volta
          pelo histórico — e abrir uma subseção EMPILHA no histórico —, então
          da subseção ele leva ao índice. Dois botões de voltar na mesma tela,
          fazendo a mesma coisa, só fariam a pessoa se perguntar qual usar. */}
      <h1 className="font-display text-2xl font-semibold">{atual ? atual.titulo : "Ajustes"}</h1>

      {/* Sem isto, a falha de leitura deixava todos os campos em branco e a
          página parecia um perfil vazio. Salvar já está protegido (o botão
          exige `dirty`, que exige perfil carregado), mas a pessoa merece saber
          por que a tela está assim. */}
      {profileError && (
        <QueryError
          title="Não consegui carregar o seu perfil."
          detail="Pode ser a conexão — nada foi alterado, e os campos abaixo voltam assim que a leitura funcionar."
          onRetry={refresh}
          retrying={profileFetching}
        />
      )}

      {/* ═══ O ÍNDICE ═══════════════════════════════════════════════════════
          A página tinha 7 telas de rolagem: perfil, pilares, 12 rastreadores,
          WhatsApp, dicas, assinatura, privacidade, importação e exclusão na
          mesma coluna. Agora o primeiro nível é uma lista curta de linhas de
          48 pt — o padrão dos Ajustes do iPhone e o mesmo da folha Conta — e
          cada uma abre uma subseção que cabe em uma tela. */}
      {!atual && (
        <>
          <Card className="divide-y overflow-hidden">
            {SECOES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => abrirSecao(s.id)}
                className="w-full flex items-center gap-3 px-4 min-h-12 py-2.5 text-left hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <s.icon className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium">{s.titulo}</span>
                  <span className="block text-xs text-muted-foreground truncate">{s.resumo}</span>
                </span>
                <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ))}
          </Card>

          <Card className="divide-y overflow-hidden">
            <Link
              to="/app/assinatura"
              className="w-full flex items-center gap-3 px-4 min-h-12 py-2.5 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <Sparkles className="w-5 h-5 shrink-0 text-gold-ink" aria-hidden />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">Assinatura</span>
                <span className="block text-xs text-muted-foreground truncate">
                  Seu plano atual, o Ascende+ e a gestão da assinatura
                </span>
              </span>
              <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
            {/* Feedback — canal TEMPORÁRIO da fase de consolidação */}
            <FeedbackDialog
              trigger={
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-4 min-h-12 py-2.5 text-left hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <MessageSquarePlus className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium">Feedback sobre a plataforma</span>
                    <span className="block text-xs text-muted-foreground truncate">
                      Um problema, uma ideia ou um elogio — vai direto para quem constrói o Ascende
                    </span>
                  </span>
                </button>
              }
            />
          </Card>

          <Button variant="ghost" className="w-full text-muted-foreground" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-1.5" /> Sair da conta
          </Button>
        </>
      )}

      {/* ═══ PERFIL ═════════════════════════════════════════════════════════ */}
      {secao === "perfil" && (
        <>
          {/* Sem `<h2>Perfil</h2>` aqui: o `<h1>` da subseção já diz "Perfil", e
              o cartão logo abaixo repetia a palavra, um título em cima do outro. */}
          <Card className="p-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" maxLength={60} autoComplete="given-name"
                value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal">Seu objetivo (a bússola do Conselheiro)</Label>
              <Input id="goal" maxLength={200} value={goal} onChange={(e) => setGoal(e.target.value)}
                placeholder='Ex.: "Ganhar massa sem estourar o orçamento"' />
            </div>
            {/* DINHEIRO NÃO É `type="number"`. Esse tipo não aceita "1.234,56"
                de forma confiável (o Safari em pt-BR recusa a vírgula em alguns
                teclados e aceita em outros) e não mostra o valor formatado. É o
                padrão que o app já usa em 33 campos: texto com teclado decimal,
                e o número é lido em pt-BR e reescrito em pt-BR ao sair do
                campo. O que o banco recebe continua sendo número. */}
            {/* Uma coluna no celular. Lado a lado, "Orçamento do mês (R$)" quebrava
                em duas linhas e o campo da direita descia 50 pt em relação ao da
                esquerda — e com Texto Maior os dois rótulos quebram. A partir de
                `sm` os dois cabem numa linha e voltam a dividir a largura. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label htmlFor="income">Renda mensal (R$)</Label>
                <Input id="income" type="text" inputMode="decimal" placeholder="0,00"
                  value={income} onChange={(e) => setIncome(e.target.value)}
                  onBlur={() => { setIncome(reescreverReais(income)); setMostrarErros(true); }}
                  aria-invalid={erroDe(income)} aria-describedby={erroDe(income) ? "income-erro" : undefined} />
                {erroDe(income) && (
                  <p id="income-erro" role="alert" className="text-caption text-destructive">
                    Use só números, como 1.234,56.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                {/* Era "Teto de gastos (R$)", e o campo grava `monthly_budget` —
                    o que a Prosperidade mostra como "Orçamento do mês". Só que a
                    MESMA tela da Prosperidade tem um "Teto de gasto do dia", que
                    é outro campo (`daily_spend_limit`). Eram três nomes para dois
                    conceitos: quem vinha procurar "orçamento" aqui encontrava
                    "teto", concluía que era o teto diário que já tinha, e ia
                    embora achando que o orçamento não dava para mudar. */}
                <Label htmlFor="budget">Orçamento do mês (R$)</Label>
                <Input id="budget" type="text" inputMode="decimal" placeholder="0,00"
                  value={budget} onChange={(e) => setBudget(e.target.value)}
                  onBlur={() => { setBudget(reescreverReais(budget)); setMostrarErros(true); }}
                  aria-invalid={erroDe(budget)} aria-describedby={erroDe(budget) ? "budget-erro" : undefined} />
                {erroDe(budget) && (
                  <p id="budget-erro" role="alert" className="text-caption text-destructive">
                    Use só números, como 1.234,56.
                  </p>
                )}
                <p className="text-caption2 text-muted-foreground">
                  Quanto você quer gastar por mês. Aparece na Prosperidade — e dá para
                  mudar por lá também. Diferente do teto do DIA, que fica na tela Hoje.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              {/* Uma lista FECHADA de 28 valores não se digita: se escolhe. O
                  dia 1 é o mês civil, e por isso as duas coisas são a mesma
                  opção — guardar "1" ou guardar nada dá o mesmo ciclo. */}
              <Label htmlFor="cycle-day">Dia de virada do ciclo financeiro</Label>
              <Select value={cycleDay || "1"} onValueChange={(v) => setCycleDay(v === "1" ? "" : v)}>
                <SelectTrigger id="cycle-day"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIAS_DO_CICLO.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d === 1 ? "Dia 1 (mês civil)" : `Dia ${d}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-caption2 text-muted-foreground">
                Se o seu "mês" financeiro não começa no dia 1 (ex.: fatura ou salário fecham
                todo dia 10), escolha o dia aqui. Gastos e gráficos passam a virar de ciclo nesse
                dia em vez do calendário civil.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="food-spend">Gasto mensal com comida (R$)</Label>
              <Input id="food-spend" type="text" inputMode="decimal" placeholder="0,00"
                value={foodSpend} onChange={(e) => setFoodSpend(e.target.value)}
                onBlur={() => { setFoodSpend(reescreverReais(foodSpend)); setMostrarErros(true); }}
                aria-invalid={erroDe(foodSpend)} aria-describedby={erroDe(foodSpend) ? "food-spend-erro" : undefined} />
              {erroDe(foodSpend) && (
                <p id="food-spend-erro" role="alert" className="text-caption text-destructive">
                  Use só números, como 1.234,56.
                </p>
              )}
              <p className="text-caption2 text-muted-foreground">
                Mercado + comida fora, na média. É a premissa do plano alimentar que cabe no seu bolso —
                estimativa declarada, não registro: o gasto real do mês substitui, nunca soma.
              </p>
            </div>

            {/* Espiritualidade / desenvolvimento da mente.
                A LINHA INTEIRA é o alvo, não o trilho de 24 pt do Switch: no
                iPhone um interruptor só existe dentro de uma linha de lista, e
                é a linha que se toca. Mesmo padrão da folha de consentimento
                do Social. */}
            <label className="flex items-center justify-between gap-3 pt-1 min-h-11 cursor-pointer">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Tenho prática espiritual/religiosa</span>
                <span className="block text-xs text-muted-foreground">
                  Desligado, o pilar vira "Mente & Foco": diário, humor e treino mental — sem vocabulário espiritual.
                </span>
              </span>
              <Switch id="has-religion" checked={hasReligion} onCheckedChange={setHasReligion} className="shrink-0" />
            </label>
            {hasReligion && (
              <div className="space-y-1.5">
                <Label htmlFor="spirit">Nome da sua prática (Mente & Espírito)</Label>
                <Input id="spirit" maxLength={60} value={spirit} onChange={(e) => setSpirit(e.target.value)}
                  placeholder="oração, meditação, silêncio..." />
              </div>
            )}
          </Card>

          {/* Sobre você: a base dos planos personalizados */}
          <Card className="p-4 space-y-3">
            <div>
              <h2 className="font-display font-semibold">Sobre você</h2>
              <p className="text-xs text-muted-foreground">
                O Conselheiro usa isso para montar planos de verdade (alimentar, treino, financeiro).
                Sem esses dados, ele pede antes de gerar.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label htmlFor="birth-year">Ano de nascimento</Label>
                <Input id="birth-year" inputMode="numeric" placeholder="1995" maxLength={4}
                  value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ""))} />
              </div>
              <div className="space-y-1.5">
                {/* `htmlFor` + `id` no gatilho: sem os dois, o leitor de tela
                    anunciava só o valor ("Prefiro não dizer"), sem dizer de quê. */}
                <Label htmlFor="sex">Sexo</Label>
                <Select value={sex} onValueChange={setSex}>
                  <SelectTrigger id="sex"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nao_informar">Prefiro não dizer</SelectItem>
                    <SelectItem value="feminino">Feminino</SelectItem>
                    <SelectItem value="masculino">Masculino</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="height">Altura (cm)</Label>
                <Input id="height" inputMode="numeric" placeholder="172"
                  value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="activity">Nível de atividade</Label>
                <Select value={activity} onValueChange={setActivity}>
                  <SelectTrigger id="activity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nao_informar">Não sei dizer</SelectItem>
                    <SelectItem value="sedentario">Sedentário</SelectItem>
                    <SelectItem value="leve">Leve (1 a 2x/semana)</SelectItem>
                    <SelectItem value="moderado">Moderado (3 a 4x/semana)</SelectItem>
                    <SelectItem value="intenso">Intenso (5x ou mais)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="restriction-input">Restrições alimentares</Label>
              {restrictions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {restrictions.map((r, i) => (
                    <span key={`${r}-${i}`} className="inline-flex items-center gap-1.5 text-xs rounded-full border bg-muted/60 pl-2.5 max-w-full">
                      <span className="truncate">{r}</span>
                      <button type="button" onClick={() => setRestrictions((rs) => rs.filter((_, j) => j !== i))}
                        aria-label={`Remover ${r}`}
                        className="grid place-items-center w-8 h-8 coarse:w-11 coarse:h-11 -my-1 rounded-full text-muted-foreground hover:text-foreground shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input id="restriction-input" maxLength={60} placeholder='Ex.: "vegetariano", "sem lactose"'
                  className="min-w-0 flex-1" value={restrictionInput} enterKeyHint="done"
                  onChange={(e) => setRestrictionInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      adicionarRestricao();
                    }
                  }} />
                <Button type="button" size="icon" variant="secondary" className="shrink-0" aria-label="Adicionar restrição"
                  onClick={adicionarRestricao}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-caption2 text-muted-foreground">
                Restrições e perfil só valem depois de tocar em Salvar. Enquanto houver
                algo pendente, o aviso acompanha você no rodapé da tela.
              </p>
            </div>
          </Card>

          {botaoSalvar}
        </>
      )}

      {/* ═══ O QUE VOCÊ ACOMPANHA ═══════════════════════════════════════════ */}
      {secao === "acompanha" && (
        <>
          <Card className="p-4 space-y-1">
            <div className="pb-2">
              <h2 className="font-display font-semibold">Pilares ativos</h2>
              <p className="text-xs text-muted-foreground">
                Ative quando estiver pronto. Os pausados saem do app e voltam em 1 toque, sem
                perder nada do histórico. Pilares só valem depois de tocar em Salvar.
              </p>
            </div>
            {PILLARS.map((p) => (
              /* `min-w-0` + `hyphens-auto` no texto: com Texto Maior, o
                 interruptor (que cresce em rem junto) e uma palavra longa como
                 "Prosperidade" não cabiam lado a lado, e a linha saía da tela
                 pela direita. Agora o texto encolhe e hifeniza; o interruptor
                 não encolhe nunca (`shrink-0` no primitivo). */
              <label key={p.id} className="flex items-center justify-between gap-3 min-h-11 cursor-pointer">
                <span className="flex items-center gap-2.5 min-w-0">
                  <p.icon className="w-4 h-4 shrink-0" style={{ color: `hsl(var(${p.colorVar}))` }} aria-hidden />
                  <span className="text-sm min-w-0 break-words hyphens-auto">{p.name}</span>
                </span>
                <Switch
                  checked={pillars.includes(p.id)}
                  onCheckedChange={(on) => togglePillar(p.id, on)}
                  aria-label={`Ativar pilar ${p.name}`}
                />
              </label>
            ))}
          </Card>

          {/* Modularidade total: liga/desliga por tracker */}
          <Card className="p-4 space-y-3">
            <div>
              <h2 className="font-display font-semibold">O que você acompanha</h2>
              <p className="text-xs text-muted-foreground">
                Não quer acompanhar água? Desligue — o anel, os botões de 1 toque e a
                lembrança no briefing somem na hora. Desligar esconde, não apaga: seu
                histórico continua seu, e religa em 1 toque.
              </p>
            </div>
            {PILLARS.filter((pl) => pillars.includes(pl.id) || pillars.length === 0).map((pl) => {
              const list = TRACKERS.filter((t) => t.pillar === pl.id);
              if (!list.length) return null;
              return (
                <div key={pl.id} className="space-y-1">
                  <p className="text-caption2 font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 min-w-0 [overflow-wrap:break-word]">
                    <pl.icon className="w-3.5 h-3.5" style={{ color: `hsl(var(${pl.colorVar}))` }} aria-hidden />
                    {pl.name}
                  </p>
                  {list.map((t) => (
                    <label key={t.id} className="flex items-center justify-between gap-3 min-h-11 cursor-pointer">
                      <span className="min-w-0">
                        <span className="block text-sm break-words hyphens-auto">{t.label}</span>
                        <span className="block text-caption2 text-muted-foreground truncate">{t.desc}</span>
                      </span>
                      <Switch id={`tracker-${t.id}`}
                        checked={trackingPrefs[t.id] !== false}
                        onCheckedChange={(v) => toggleTracker(t.id, !!v)}
                        aria-label={`Acompanhar ${t.label}`} />
                    </label>
                  ))}
                </div>
              );
            })}
            {pillars.length > 0 && PILLARS.some((pl) => !pillars.includes(pl.id)) && (
              <p className="text-caption2 text-muted-foreground">
                Pilares pausados pausam os itens deles automaticamente — ative o pilar acima para vê-los aqui.
              </p>
            )}
            {profile?.sleep_bedtime && profile?.sleep_waketime && trackingPrefs["sleep"] !== false && (
              <p className="text-caption2 text-muted-foreground border-t pt-2.5">
                Rotina de sono: {timeForInput(profile.sleep_bedtime)} <span aria-hidden>→</span><span className="sr-only">até</span> {timeForInput(profile.sleep_waketime)}
                {(() => { const h = sleepWindowHours(profile.sleep_bedtime, profile.sleep_waketime); return h ? ` (${formatWindowHours(h)})` : ""; })()}
                {" · "}
                <Link to="/app/vitalidade" className="underline underline-offset-2 inline-flex items-center min-h-11">
                  editar em Vitalidade
                </Link>
              </p>
            )}
          </Card>

          {botaoSalvar}
        </>
      )}

      {/* ═══ O QUE O CONSELHEIRO VÊ ═════════════════════════════════════════ */}
      {secao === "conselheiro" && (
        <>
          {/* Privacidade: o que o Conselheiro pode analisar */}
          <Card className="p-4 space-y-1">
            <div className="pb-2">
              <h2 className="font-display font-semibold flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-gold-ink" aria-hidden /> O que o Conselheiro pode analisar
              </h2>
              <p className="text-xs text-muted-foreground">
                Desative uma área e o Conselheiro, o briefing e as análises deixam esses dados
                de fora na hora. Seus registros continuam salvos e visíveis para você.
              </p>
            </div>
            {SCOPES.map((sc) => (
              <label key={sc.id} className="flex items-center justify-between gap-3 min-h-11 cursor-pointer">
                {/* Mesmo motivo dos pilares: o texto encolhe, o interruptor não. */}
                <span className="text-sm min-w-0 break-words hyphens-auto">{sc.label}</span>
                <Switch id={`scope-${sc.id}`} checked={scopes[sc.id] ?? true}
                  onCheckedChange={(v) => toggleScope(sc.id, !!v)} />
              </label>
            ))}
          </Card>

          {/* Memória do Conselheiro: transparência total sobre o que a IA aprendeu */}
          <Card className="p-4 space-y-3">
            <h2 className="font-display font-semibold flex items-center gap-1.5">
              <Brain className="w-4 h-4 text-gold-ink" aria-hidden /> O que o Ascende sabe sobre você
            </h2>

            <MemoryControl onClearAll={() => setConfirmClearMemories(true)} clearing={clearingMemories} />
          </Card>
        </>
      )}

      {/* ═══ SEUS DADOS ═════════════════════════════════════════════════════
          A ordem é a leitura "trouxe → confira o que entrou → leve embora →
          ou apague tudo". */}
      {secao === "dados" && (
        <>
          {/* Importar dados de saúde: o espelho da exportação logo abaixo.
              Vale para sono, treino E peso ao mesmo tempo — por isso mora aqui,
              e não dentro de um pilar só. */}
          <Card className="p-4 space-y-3">
            <div>
              <h2 className="font-display font-semibold flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-gold-ink" aria-hidden /> Importar dados de saúde
              </h2>
              <p className="text-xs text-muted-foreground">
                Traga o histórico que já existe nos seus outros aplicativos: sono, treinos e peso.
              </p>
            </div>
            {/* O medo desta seção não é de instrução, é de exposição: quem não
                sabe o que é um .zip não chega a ler o texto de dentro. A dica
                adianta a única frase que destrava — o arquivo não sobe. */}
            <FirstTimeTip id="importar" />
            <HealthImport />
          </Card>

          {/* Fontes e recibos: fica ENTRE importar e exportar de propósito.
              Sem esta seção, a importação acima seria uma afirmação sem
              comprovante (plano refinado §4.1 e §4.4). */}
          <Card className="p-4 space-y-3">
            <div>
              <h2 className="font-display font-semibold flex items-center gap-1.5">
                <FileStack className="w-4 h-4 text-gold-ink" aria-hidden /> Fontes e importações
              </h2>
              <p className="text-xs text-muted-foreground">
                De onde vieram seus registros, e o recibo de cada importação.
              </p>
            </div>
            <SourcesAndImports />
          </Card>

          {/* Seus dados: exportação e exclusão — sempre gratuitas */}
          <Card className="p-4 space-y-3">
            <div>
              <h2 className="font-display font-semibold flex items-center gap-1.5">
                <Download className="w-4 h-4 text-gold-ink" aria-hidden /> Exportar
              </h2>
              <p className="text-xs text-muted-foreground">
                Seus dados são seus. Exporte tudo quando quiser — de graça, sempre.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={exportJson} disabled={exporting !== null} loading={exporting === "json"}>
                <Download className="w-3.5 h-3.5 mr-1.5" /> Exportar tudo (JSON)
              </Button>
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting !== null} loading={exporting === "csv"}>
                <Download className="w-3.5 h-3.5 mr-1.5" /> Registros e finanças (CSV)
              </Button>
            </div>
            <div className="rounded-md border border-destructive/30 p-3 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1.5 text-destructive">
                <ShieldAlert className="w-4 h-4" aria-hidden /> Excluir minha conta
              </p>
              <p className="text-xs text-muted-foreground">
                {/* O texto mandava cancelar a assinatura à mão ANTES de excluir —
                    uma tarefa que o servidor já faz sozinho (delete-account
                    cancela no Stripe e só então apaga, abortando com mensagem
                    clara se o cancelamento falhar). Pior: insinuava que excluir a
                    conta podia deixar uma cobrança viva. Isso é sludge no caminho
                    da SAÍDA: fricção que não serve a pessoa e produz retenção por
                    confusão, mesmo sem ninguém ter querido isso. */}
                Apaga definitivamente sua conta e TODOS os dados (registros, conversas, memórias,
                planos, XP). Não tem volta. Se você assina o Ascende+, cancelamos a assinatura
                automaticamente antes de apagar tudo. Dica: exporte seus dados acima antes de excluir.
              </p>
              {/* Era `bg-[hsl(4_72%_44%)]` fixo, para compensar um token que
                  reprovava AA. No claro isso dava o ÚNICO vermelho diferente do
                  app (44% contra os 49% do token). O token agora carrega o
                  contraste sozinho, então o botão volta a ser só a variante. */}
              <Button
                variant="destructive" size="sm"
                onClick={() => { setDeleteText(""); setDeleteOpen(true); }}
              >
                Excluir conta e dados
              </Button>
            </div>
          </Card>
        </>
      )}

      {/* ═══ APARÊNCIA ══════════════════════════════════════════════════════ */}
      {secao === "aparencia" && (
        <>
          <Card className="p-4 space-y-3">
            <div>
              <h2 className="font-display font-semibold">Tema</h2>
              <p className="text-xs text-muted-foreground">
                Automático acompanha a aparência do seu aparelho — amanhecer quando ele está
                claro, noite na montanha quando está escuro.
                Se preferir, fixe um dos dois.
              </p>
            </div>
            {/* Mesma grade que cai de coluna com Texto Maior: "Automático" não
                cabe num terço da largura a 40 pt. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5.5rem),1fr))] gap-2" role="radiogroup" aria-label="Tema">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  onClick={() => setTheme(t.id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1.5 rounded-lg border py-3 min-h-11 text-sm transition-colors",
                    theme === t.id
                      ? "border-primary ring-1 ring-primary bg-primary/5 font-medium"
                      : "text-muted-foreground hover:bg-muted/60"
                  )}
                  aria-checked={theme === t.id}
                >
                  <t.icon className="w-4 h-4" aria-hidden />
                  {t.label}
                </button>
              ))}
            </div>
          </Card>

          {/* Mokari: o interruptor.
              DESLIGADO por padrão — e o campo é anulável de propósito, para o app
              distinguir "nunca perguntei" de "ela disse não". O convite aparece
              UMA vez, na Jornada, e o silêncio é respeitado: personagem que
              aparece sem ser convidado, no app de quem está tentando organizar a
              vida, é atrito.
              Desligar aqui não afeta função nenhuma do app — XP, indicadores,
              captura, planos e batalhas seguem idênticos. Isso não é promessa de
              comentário: src/lib/mokariIsolation.test.ts reprova quem quebrar. */}
          <Card className="p-4 space-y-2">
            <label className="flex items-start justify-between gap-3 min-h-11 cursor-pointer">
              <span className="min-w-0">
                <span className="block font-display font-semibold">Mokari</span>
                <span className="block text-xs text-muted-foreground">
                  Um broto que cresce com o que você registra: o retrato da sua jornada, no topo da
                  tela Jornada. Desligado, nada mais no app muda.
                </span>
              </span>
              <Switch
                id="mokari"
                checked={mokari.enabled}
                disabled={!mokari.ready}
                onCheckedChange={(v) => {
                  mokari.setEnabled(v);
                  toast.success(v
                    ? "Mokari ligado. Ele aparece no topo da Jornada."
                    : "Mokari desligado. Nada mais muda no app.");
                }}
              />
            </label>
            <p className="text-caption2 text-muted-foreground">
              Ele nunca reflete peso nem composição corporal, e não envia nenhuma notificação.
            </p>
          </Card>

          {/* Dicas de primeiras vezes */}
          <Card className="p-4 space-y-3">
            <div>
              <h2 className="font-display font-semibold">Dicas de uso</h2>
              <p className="text-xs text-muted-foreground">
                Na primeira vez em cada área, o Ascende mostra uma dica curta explicando como usar.
                Cada dica aparece uma vez só e some sozinha quando você usa a função.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                resetGuides();
                toast.success("Pronto: as dicas vão aparecer de novo em cada área.");
              }}>
                Ver as dicas de novo
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => {
                disableGuides();
                toast.success("Dicas desligadas.");
              }}>
                Desligar todas
              </Button>
            </div>
          </Card>
        </>
      )}

      {/* ═══ WHATSAPP E TELA INICIAL ════════════════════════════════════════
          As duas formas de o Ascende chegar até a pessoa fora desta aba. */}
      {secao === "conectar" && (
        <>
          {/* WhatsApp: captura por mensagem + avisos que trazem de volta ao app */}
          <WhatsappCard />

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
                <Smartphone className="w-4 h-4" aria-hidden /> iPhone / iPad
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
                <Smartphone className="w-4 h-4" aria-hidden /> Android
              </p>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Abra este site no <strong>Chrome</strong>.</li>
                <li>Toque no menu <strong>⋮</strong> (canto superior direito).</li>
                <li>Toque em <strong>"Adicionar à tela inicial"</strong> (ou "Instalar app").</li>
              </ol>
            </div>
          </Card>
        </>
      )}

      {/* Os dois diálogos ficam FORA das subseções: são abertos a partir de
          uma delas, mas não podem ser desmontados no meio por uma troca de
          `?secao=` (o voltar do navegador, por exemplo). */}
      <AlertDialog open={confirmClearMemories} onOpenChange={setConfirmClearMemories}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o que o Conselheiro aprendeu sobre você?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  Ele esquece o que deduziu das conversas: suas preferências, restrições, o que
                  você contou de passagem.
                </p>
                <p className="rounded-md border p-2.5 text-foreground">
                  Seus registros ficam. Gastos, treinos, refeições, sono, XP e dias limpos
                  continuam todos aqui.
                </p>
                <p className="text-xs">
                  A partir da próxima conversa ele começa a aprender de novo, do zero.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter o que ele aprendeu</AlertDialogCancel>
            <AlertDialogAction destrutiva onClick={clearMemories}>Apagar as memórias</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação reforçada da exclusão */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Excluir conta definitivamente</DialogTitle>
            <DialogDescription>
              Esta ação apaga TODOS os seus dados e não pode ser desfeita.
              Para confirmar, digite <strong>EXCLUIR</strong> abaixo.
            </DialogDescription>
          </DialogHeader>
          <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value.toUpperCase())}
            placeholder="EXCLUIR" aria-label="Digite EXCLUIR para confirmar"
            autoCapitalize="characters" autoComplete="off" />
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={deleteAccount} disabled={deleteText !== "EXCLUIR"} loading={deleting}>
              Excluir tudo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Barra de alterações não salvas: acompanha a rolagem e fica acima da
          navegação flutuante do mobile. Vale no índice e em toda subseção — o
          formulário é um só.
          A conta: a pílula mora em `bottom-3` + `h-16` (0,75 + 4 rem) acima da
          área segura, e só some a partir de `lg`. Esta barra fica 0,75 rem
          acima dela (5,5 rem) — o mesmo respiro que a pílula tem da borda — e
          só desce para `bottom-4` também em `lg`. Com `md`, entre 768 e 1024
          px a barra caía em cima da pílula. */}
      {dirty && (
        <div
          className="fixed inset-x-0 z-20 px-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-4"
          role="status"
        >
          <div className="max-w-2xl mx-auto flex items-center gap-3 rounded-full glass shadow-lg shadow-black/10 py-2 pl-4 pr-2 animate-fade-up">
            <p className="text-xs font-medium flex-1 min-w-0">
              Alterações não salvas
              <span className="hidden sm:inline text-muted-foreground font-normal"> — nada foi gravado ainda</span>
            </p>
            <Button size="sm" className="shrink-0 rounded-full" onClick={save} loading={saving}>
              Salvar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
