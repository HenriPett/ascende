import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import BatchReview, { DuplicateBadge } from "@/components/core/BatchReview";
import { toast } from "sonner";
import {
  Upload, Loader2, Check, FileQuestion, MessageCircle, Moon, Dumbbell, Scale,
} from "lucide-react";
import { Link } from "react-router-dom";
import { fileToText } from "@/lib/files";
import { dateISOInSP, formatSP } from "@/lib/dates";
import { saveImportedEvents } from "@/lib/captureEvents";
import {
  parseHealthCsv, formatLabel, MAX_IMPORT_EVENTS, PARSER_VERSION,
  type ImportResult, type ImportedEvent, type HealthCsvFormat,
} from "@/lib/healthImport";
import {
  hashFile, findSourceByHash, createSource, createReceipt, confirmSource,
  markSourcePartial, markSourceFailed, awardImportMilestone, buildReceiptSummary,
  type DataSource, type ImportReceipt, type ImportWarning,
} from "@/lib/dataSources";

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

/** Data de uma importação anterior, no fuso do app. */
const shortStamp = (iso: string) =>
  formatSP(iso, { day: "2-digit", month: "short", year: "numeric" });

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
  // Identidade do arquivo lido. O `hash` é o que reconhece a reimportação:
  // sem ele, o mesmo export abriria uma fonte nova a cada envio.
  const [file, setFile] = useState<{ name: string; hash: string } | null>(null);
  /** Quando este mesmo arquivo já entrou antes — data da importação anterior. */
  const [seenBefore, setSeenBefore] = useState<string | null>(null);

  const reset = () => {
    setResult(null); setChecked([]); setDup([]); setUnknownFile(null); setProgress(0);
    setFile(null); setSeenBefore(null);
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    reset();
    setReading(true);
    try {
      const text = await fileToText(picked);
      const parsed = parseHealthCsv(text);

      // Formato desconhecido: dizer com todas as letras. Fingir que importou
      // é exatamente a reclamação que originou esta tela.
      if (!parsed || !parsed.events.length) {
        setUnknownFile(picked.name);
        return;
      }

      // Hash do TEXTO, não dos bytes: é a leitura de texto que alimenta o
      // parser, então tem de ser sempre a mesma representação — com os bytes,
      // um mesmo arquivo salvo de outro jeito mudaria o hash e a
      // reimportação deixaria de ser reconhecida.
      const hash = await hashFile(text);
      setFile({ name: picked.name, hash });
      if (user) {
        const previous = await findSourceByHash(user.id, hash);
        setSeenBefore(previous?.created_at ?? null);
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
      toast.error(`Não consegui ler "${picked.name}". Confira se é um arquivo CSV.`);
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
    // Declarada FORA do try: se a gravação estourar no meio, o catch precisa
    // conseguir marcar esta fonte como falha em vez de deixá-la eternamente
    // em "previewed", mentindo que a importação está só aguardando.
    let source: DataSource | null = null;
    try {
      // ── 1. A fonte. Falhar aqui NÃO pode impedir a gravação: perder a
      //    trilha do arquivo é ruim, perder o histórico da pessoa é pior.
      //    Sem fonte, seguimos gravando e o recibo simplesmente não nasce.
      try {
        source = await createSource({
          userId: user.id,
          kind: "health_csv",
          displayName: file?.name ?? "Arquivo de saúde",
          fileHash: file?.hash ?? null,
          parserVersion: PARSER_VERSION,
          periodStart: result.range?.from ?? null,
          periodEnd: result.range?.to ?? null,
        });
      } catch {
        source = null;
      }

      // ── 2. Os registros.
      const { accepted, duplicates } = await saveImportedEvents(
        user.id, selected,
        (done, total) => setProgress(Math.round((done / total) * 100)),
        { dataSourceId: source?.id ?? null },
      );

      // ── 3. As contas do recibo. "Duplicado" tem três origens diferentes, e
      //    todas contam: o que já veio deste mesmo arquivo antes, o que o
      //    próprio arquivo repetia no mesmo dia, e o que a pessoa deixou
      //    desmarcado porque já estava no histórico.
      const leftOutAsExisting = result.events.filter((_, i) => dup[i] && !checked[i]).length;
      const rejectedRows = result.stats.skipped;
      const duplicateRows = duplicates + result.stats.duplicates + leftOutAsExisting;
      const summary = buildReceiptSummary({
        acceptedRows: accepted,
        duplicateRows,
        rejectedRows,
        acceptedLabel: formatLabel(result.format, accepted),
      });

      let receipt: ImportReceipt | null = null;
      if (source) {
        const warnings: ImportWarning[] = result.stats.truncated > 0
          ? [{
            code: "teto_importacao",
            message: `${result.stats.truncated} registros mais antigos ficaram de fora (teto de ${MAX_IMPORT_EVENTS.toLocaleString("pt-BR")} por importação).`,
            count: result.stats.truncated,
          }]
          : [];
        receipt = await createReceipt({
          sourceId: source.id,
          userId: user.id,
          totalRows: result.stats.rows,
          acceptedRows: accepted,
          duplicateRows,
          rejectedRows,
          warnings,
          summary,
        });
        // Linha ilegível no arquivo = importação parcial, e a fonte diz isso.
        await (rejectedRows > 0 ? markSourcePartial(source.id) : confirmSource(source.id));
      }

      // ── 4. O marco: +15 XP por importação, uma vez POR FONTE. Reimportar o
      //    mesmo arquivo não paga de novo.
      const awarded = accepted > 0 ? await awardImportMilestone(source?.id ?? null) : false;

      // §4.4: nenhum fluxo diz "absorvido" sem recibo persistente. Se o
      // recibo não nasceu, os registros ENTRARAM (isso é verdade e não vamos
      // esconder) mas não há o que auditar depois — e a tela diz isso, em vez
      // de comemorar uma importação que ficou sem comprovante.
      if (receipt) {
        toast.success(awarded ? `${summary.replace(/\.$/, "")} · +15 XP` : summary);
      } else {
        toast.warning(
          `${summary.replace(/\.$/, "")} — mas não consegui emitir o recibo desta importação. `
          + "Os registros estão no seu histórico; a trilha do arquivo, não.",
        );
      }
      reset();
      qc.invalidateQueries();
    } catch {
      // A fonte fica marcada como falha: sem isso ela apareceria em Fontes
      // como "não confirmada", sugerindo que basta confirmar.
      if (source) {
        try { await markSourceFailed(source.id); } catch { /* nada mais a fazer */ }
      }
      toast.error("Não consegui gravar tudo. Nada foi perdido — tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = checked.filter(Boolean).length;
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

      {/* ── Revisão em lote ──────────────────────────────────────────
          O esqueleto (marcar todos, contador, lista, botões) vem do
          BatchReview, o mesmo da revisão de fatura. Aqui ficam só o
          cabeçalho rico do reconhecimento, a barra de progresso da gravação
          em lotes e o desenho de cada linha. */}
      {result && meta && (
        <BatchReview
          items={result.events}
          checked={checked}
          dup={dup}
          saving={saving}
          itemsDisabled={saving}
          listClassName="max-h-80 overflow-y-auto overscroll-contain divide-y rounded-lg border"
          itemStyle={{ contentVisibility: "auto", containIntrinsicSize: "0 46px" }}
          itemKey={(ev, i) => `${ev.kind}-${ev.day}-${i}`}
          counterSuffix=" selecionados"
          confirmLabel={<>Importar {selectedCount} selecionado{selectedCount === 1 ? "" : "s"}</>}
          confirmDisabled={!selectedCount}
          onToggle={(i, v) => setChecked((c) => c.map((x, j) => (j === i ? v : x)))}
          onToggleAll={(v) => setChecked(result.events.map(() => v))}
          onCancel={reset}
          onConfirm={confirm}
          header={
            <>
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

              {seenBefore && (
                <p className="text-xs rounded-md border border-primary/30 bg-primary/5 p-2.5">
                  Você já importou este arquivo em{" "}
                  <strong>{shortStamp(seenBefore)}</strong>. Pode importar de novo sem medo:
                  o que já está gravado não entra duas vezes, e não rende XP outra vez.
                </p>
              )}

              {dup.some(Boolean) && (
                <p className="text-xs text-muted-foreground rounded-md border p-2.5">
                  {dup.filter(Boolean).length} registro{dup.filter(Boolean).length > 1 ? "s já existem" : " já existe"} no
                  seu histórico, no mesmo dia. Vieram <strong>desmarcados</strong> para não duplicar —
                  marque se quiser registrar assim mesmo.
                </p>
              )}
            </>
          }
          progress={saving ? (
            <div className="space-y-1.5">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                Gravando em lotes... {progress}%
              </p>
            </div>
          ) : null}
          footer={
            <p className="text-[11px] text-muted-foreground">
              Os registros entram com a <strong>data original</strong>, não com a de hoje — o
              histórico fica no lugar certo nos Indicadores e no Conselheiro. O arquivo não sai
              do seu aparelho.
            </p>
          }
          renderItem={(ev, _i, isDup) => (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">
                  {eventDetail(ev)}
                  {isDup && <DuplicateBadge />}
                </p>
                <p className="text-xs text-muted-foreground">{longDate(ev.day)}</p>
              </div>
              {!!ev.muscles?.length && (
                <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">
                  {ev.muscles.join(", ")}
                </span>
              )}
            </>
          )}
        />
      )}

    </div>
  );
}
