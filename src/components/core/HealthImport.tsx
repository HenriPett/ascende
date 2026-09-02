import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Upload, Loader2, Check, X, FileQuestion, MessageCircle, Moon, Dumbbell, Scale,
} from "lucide-react";
import { Link } from "react-router-dom";
import { fileToText } from "@/lib/files";
import { dateISOInSP } from "@/lib/dates";
import { saveImportedEvents } from "@/lib/captureEvents";
import {
  parseHealthCsv, formatLabel, MAX_IMPORT_EVENTS,
  type ImportResult, type ImportedEvent, type HealthCsvFormat,
} from "@/lib/healthImport";

/* Importação de CSV de apps de saúde, com revisão em LOTE.
 *
 * Mesma UX do StatementReview (fatura): lista com checkboxes, marcar todos,
 * contagem, confirmar. A diferença é o que acontece ANTES da lista — aqui o
 * arquivo é lido de forma determinística no navegador, sem IA. O Conselheiro
 * dizia "absorvi seu arquivo" e não absorvia; agora a pessoa VÊ cada registro
 * antes de gravar, e o que ela vê é exatamente o que vai para o banco. */

const FORMAT_META: Record<HealthCsvFormat, { icon: typeof Moon; colorVar: string; noun: string }> = {
  sleep: { icon: Moon, colorVar: "--vitalidade", noun: "noite" },
  workout: { icon: Dumbbell, colorVar: "--vitalidade", noun: "treino" },
  measurement: { icon: Scale, colorVar: "--alimentacao", noun: "pesagem" },
};

const APPS_ACEITOS = [
  "Sono — Sleep Cycle",
  "Treinos — Hevy",
  "Peso e medidas — Hevy",
];

const longDate = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "short", day: "2-digit", month: "short", year: "2-digit",
  });

/** Detalhe curto de cada linha, por tipo. */
function eventDetail(ev: ImportedEvent): string {
  if (ev.kind === "sleep") return `${String(ev.hours ?? 0).replace(".", ",")}h de sono`;
  if (ev.kind === "weight") return `${String(ev.kg ?? 0).replace(".", ",")} kg`;
  const partes = [ev.description, ev.duration_min ? `${ev.duration_min} min` : null].filter(Boolean);
  return partes.join(" · ") || "Treino";
}

export default function HealthImport() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [reading, setReading] = useState(false);
  const [unknownFile, setUnknownFile] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [dup, setDup] = useState<boolean[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);

  const reset = () => {
    setResult(null); setChecked([]); setDup([]); setUnknownFile(null); setProgress(0);
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    reset();
    setReading(true);
    try {
      const text = await fileToText(file);
      const parsed = parseHealthCsv(text);

      // Formato desconhecido: dizer com todas as letras. Fingir que importou
      // é exatamente a reclamação que originou esta tela.
      if (!parsed || !parsed.events.length) {
        setUnknownFile(file.name);
        return;
      }

      // Já registrado: mesmo tipo, mesmo dia, já no banco. Vem DESMARCADO,
      // igual à revisão de fatura — reimportar o mesmo export não duplica.
      let duplicates = parsed.events.map(() => false);
      if (user && parsed.range) {
        const kinds = [...new Set(parsed.events.map((ev) => ev.kind))];
        const { data } = await supabase.from("life_events")
          .select("kind,occurred_at")
          .eq("user_id", user.id)
          .in("kind", kinds)
          .gte("occurred_at", `${parsed.range.from}T00:00:00-03:00`)
          .lte("occurred_at", `${parsed.range.to}T23:59:59-03:00`)
          .limit(5000);
        const existentes = new Set(
          (data ?? []).map((r) => `${r.kind}|${dateISOInSP(String(r.occurred_at))}`),
        );
        duplicates = parsed.events.map((ev) => existentes.has(`${ev.kind}|${ev.day}`));
      }

      setResult(parsed);
      setDup(duplicates);
      setChecked(duplicates.map((d) => !d));
    } catch {
      toast.error(`Não consegui ler "${file.name}". Confira se é um arquivo CSV.`);
    } finally {
      setReading(false);
    }
  };

  const confirm = async () => {
    if (!user || !result) return;
    const selected = result.events.filter((_, i) => checked[i]);
    if (!selected.length) { toast.info("Marque ao menos um registro para importar."); return; }

    setSaving(true);
    setProgress(0);
    try {
      await saveImportedEvents(user.id, selected, (done, total) =>
        setProgress(Math.round((done / total) * 100)),
      );
      toast.success(`${formatLabel(result.format, selected.length)} no seu histórico.`);
      reset();
      qc.invalidateQueries();
    } catch {
      toast.error("Não consegui gravar tudo. Nada foi perdido — tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = checked.filter(Boolean).length;
  const allChecked = checked.length > 0 && checked.every(Boolean);
  const meta = result ? FORMAT_META[result.format] : null;
  const accent = meta ? `hsl(var(${meta.colorVar}))` : "hsl(var(--gold))";

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={onPick}
      />

      {/* ── Estado inicial: o que dá para trazer ─────────────────────── */}
      {!result && !unknownFile && (
        <>
          <p className="text-sm text-muted-foreground">
            Exportou seus dados de um app de sono, treino ou balança? Traga o CSV para cá.
            O arquivo é lido <strong>aqui no seu aparelho</strong>, sem passar por IA — nada é
            interpretado ou resumido, e cada registro entra com a data original.
          </p>
          <ul className="text-xs text-muted-foreground space-y-1">
            {APPS_ACEITOS.map((app) => (
              <li key={app} className="flex items-center gap-1.5">
                <Check className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--success))" }} />
                {app}
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={reading}>
            {reading
              ? (<><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Lendo arquivo...</>)
              : (<><Upload className="w-3.5 h-3.5 mr-1.5" /> Escolher arquivo CSV</>)}
          </Button>
        </>
      )}

      {/* ── Formato desconhecido: nunca fingir que importou ──────────── */}
      {unknownFile && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3.5 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <FileQuestion className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--warning))" }} />
            Não reconheci o formato de "{unknownFile}"
          </p>
          <p className="text-sm text-muted-foreground">
            Eu leio CSV de sono (Sleep Cycle), de treino e de peso (Hevy). Este arquivo não
            tem as colunas desses formatos — então <strong>não importei nada</strong>, em vez de
            adivinhar números.
          </p>
          <p className="text-sm text-muted-foreground">
            Se for um documento em texto (um exame, um plano, um relatório), leve ao Conselheiro:
            lá o conteúdo é interpretado de verdade.
          </p>
          <div className="flex flex-wrap gap-2 pt-0.5">
            <Button variant="outline" size="sm" onClick={() => { reset(); fileRef.current?.click(); }}>
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Tentar outro arquivo
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link to="/app/conselheiro">
                <MessageCircle className="w-3.5 h-3.5 mr-1.5" /> Levar ao Conselheiro
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* ── Revisão em lote ──────────────────────────────────────────── */}
      {result && meta && (
        <div className="space-y-3">
          <div className="rounded-xl border p-3.5 space-y-1.5" style={{ borderLeftWidth: 3, borderLeftColor: accent }}>
            <p className="text-sm font-medium flex items-center gap-2">
              <meta.icon className="w-4 h-4 shrink-0" style={{ color: accent }} />
              Reconheci {formatLabel(result.format, result.events.length)}
              <span className="text-muted-foreground font-normal">· {result.sourceLabel}</span>
            </p>
            {result.range && (
              <p className="text-xs text-muted-foreground">
                De {longDate(result.range.from)} a {longDate(result.range.to)}.
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              {result.stats.rows.toLocaleString("pt-BR")} linhas lidas
              {result.format === "workout" && ` · agrupadas em ${result.events.length} sessões`}
              {result.stats.duplicates > 0 && ` · ${result.stats.duplicates} do mesmo dia foram unidas`}
              {result.stats.skipped > 0 && ` · ${result.stats.skipped} sem dado aproveitável`}
              {result.stats.truncated > 0
                && ` · ${result.stats.truncated} mais antigas ficaram de fora (teto de ${MAX_IMPORT_EVENTS.toLocaleString("pt-BR")} por importação)`}
            </p>
          </div>

          {dup.some(Boolean) && (
            <p className="text-xs text-muted-foreground rounded-md border p-2.5">
              {dup.filter(Boolean).length} registro{dup.filter(Boolean).length > 1 ? "s já existem" : " já existe"} no
              seu histórico, no mesmo dia. Vieram <strong>desmarcados</strong> para não duplicar —
              marque se quiser registrar assim mesmo.
            </p>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <button
              className="underline underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => setChecked(result.events.map(() => !allChecked))}
              disabled={saving}
            >
              {allChecked ? "Desmarcar todos" : "Marcar todos"}
            </button>
            <span>{selectedCount} de {result.events.length} selecionados</span>
          </div>

          <div className="max-h-80 overflow-y-auto overscroll-contain divide-y rounded-lg border">
            {result.events.map((ev, i) => (
              <label
                key={`${ev.kind}-${ev.day}-${i}`}
                className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-muted/40"
                style={{ contentVisibility: "auto", containIntrinsicSize: "0 46px" }}
              >
                <Checkbox
                  checked={checked[i]}
                  disabled={saving}
                  onCheckedChange={(v) =>
                    setChecked((c) => c.map((x, j) => (j === i ? Boolean(v) : x)))}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {eventDetail(ev)}
                    {dup[i] && (
                      <Badge variant="outline" className="text-[10px] ml-1.5 align-middle">já registrado</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{longDate(ev.day)}</p>
                </div>
                {!!ev.muscles?.length && (
                  <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">
                    {ev.muscles.join(", ")}
                  </span>
                )}
              </label>
            ))}
          </div>

          {saving && (
            <div className="space-y-1.5">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                Gravando em lotes... {progress}%
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="ghost" onClick={reset} disabled={saving}>
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button className="flex-1" onClick={confirm} disabled={saving || !selectedCount}>
              {saving
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : (<><Check className="w-4 h-4 mr-1.5" /> Importar {selectedCount} selecionado{selectedCount === 1 ? "" : "s"}</>)}
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Os registros entram com a <strong>data original</strong>, não com a de hoje — o
            histórico fica no lugar certo nos Indicadores e no Conselheiro. O arquivo não sai
            do seu aparelho.
          </p>
        </div>
      )}
    </div>
  );
}
