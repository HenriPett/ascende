import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  FileSpreadsheet, Receipt, MessageSquare, PenLine, Trash2, ScrollText,
  AlertTriangle, RefreshCw, Loader2, Inbox,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatSP } from "@/lib/dates";
import {
  listSourcesWithReceipts, getReceipt, deleteSource, sourceKindLabel,
  type DataSourceKind, type DataSourceStatus, type DataSourceWithReceipt,
  type ImportReceipt,
} from "@/lib/dataSources";

/* "Fontes e importações" — a tela de auditoria.
 *
 * O plano refinado é taxativo: nenhum fluxo diz "absorvido" sem recibo
 * persistente (§4.1), e a pessoa precisa CONSEGUIR ABRIR O RECIBO DEPOIS
 * (§4.4). Esta tela é onde isso acontece: para cada arquivo que entrou, o
 * que entrou, o que já existia, o que não deu para ler, e os avisos.
 *
 * Duas regras de honestidade guiam a escrita daqui:
 *   • Número que a pessoa entende, sem jargão: "555 entraram", não
 *     "accepted_rows: 555".
 *   • Fonte sem recibo é DECLARADA como tal. Preencher com zero seria dizer
 *     que nada entrou; inventar seria pior. */

const KIND_ICON: Record<DataSourceKind, LucideIcon> = {
  health_csv: FileSpreadsheet,
  financial_statement: Receipt,
  chat_attachment: MessageSquare,
  manual: PenLine,
};

const KIND_COLOR: Record<DataSourceKind, string> = {
  health_csv: "--vitalidade",
  financial_statement: "--prosperidade",
  chat_attachment: "--mente",
  manual: "--muted-foreground",
};

/** Só o que precisa de aviso ganha selo. "confirmed" é o caso normal. */
const STATUS_BADGE: Partial<Record<DataSourceStatus, { label: string; hint: string }>> = {
  previewed: {
    label: "não confirmada",
    hint: "Este arquivo foi lido, mas você não confirmou a importação — nada dele foi gravado.",
  },
  partial: {
    label: "parcial",
    hint: "Parte das linhas entrou; o resto foi recusado. Os detalhes estão no recibo.",
  },
  failed: {
    label: "falhou",
    hint: "Não deu para gravar esta importação. Nada foi salvo.",
  },
};

const shortDate = (iso: string) => formatSP(iso, { day: "2-digit", month: "short", year: "numeric" });
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

function periodLabel(source: DataSourceWithReceipt): string {
  const { period_start: from, period_end: to } = source;
  if (!from && !to) return "período não identificado";
  if (from && to) return from === to ? dayLabel(from) : `${dayLabel(from)} a ${dayLabel(to)}`;
  return dayLabel((from ?? to)!);
}

/** Os três números do recibo, em linguagem de gente. */
function Chip({ value, label, colorVar }: { value: number; label: string; colorVar?: string }) {
  return (
    <span
      className="inline-flex items-baseline gap-1 rounded-full border px-2 py-0.5 text-[11px]"
      style={colorVar ? { color: `hsl(var(${colorVar}))`, borderColor: `hsl(var(${colorVar}) / 0.35)` } : undefined}
    >
      <strong className="font-semibold">{value.toLocaleString("pt-BR")}</strong> {label}
    </span>
  );
}

/**
 * Os números do cartão.
 *
 * Cuidado que custou uma verificação ao vivo para aparecer: os chips vêm do
 * ÚLTIMO recibo, mas o olho lê o cartão como o ESTADO DA FONTE. Quem
 * reimportou o mesmo arquivo tinha o último recibo com `accepted_rows = 0`, e
 * o cartão dizia só "20 já existiam" — como se a fonte estivesse vazia,
 * exatamente o oposto da verdade.
 *
 * Então: quando nada entrou na última importação, o número em destaque passa
 * a ser quanto a fonte TEM guardado, e o que a última importação fez desce
 * para uma linha secundária. O diálogo do recibo continua contando a história
 * completa da última importação — é o papel dele.
 */
function ReceiptCounts({ receipt, storedCount }: { receipt: ImportReceipt; storedCount?: number }) {
  const nothingNew = receipt.accepted_rows === 0;

  if (nothingNew) {
    return (
      <div className="space-y-1.5">
        {storedCount !== undefined && storedCount > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Chip
              value={storedCount}
              label={storedCount === 1 ? "registro guardado desta fonte" : "registros guardados desta fonte"}
              colorVar="--success"
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Na última importação, nada novo entrou
          {receipt.duplicate_rows > 0 && (
            <> — {receipt.duplicate_rows === 1
              ? "o registro já estava no seu histórico"
              : `os ${receipt.duplicate_rows.toLocaleString("pt-BR")} registros já estavam no seu histórico`}</>
          )}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip
        value={receipt.accepted_rows}
        label={receipt.accepted_rows === 1 ? "entrou" : "entraram"}
        colorVar="--success"
      />
      {receipt.duplicate_rows > 0 && (
        <Chip
          value={receipt.duplicate_rows}
          label={receipt.duplicate_rows === 1 ? "já existia" : "já existiam"}
        />
      )}
      {receipt.rejected_rows > 0 && (
        <Chip value={receipt.rejected_rows} label="não entraram" colorVar="--warning" />
      )}
    </div>
  );
}

export default function SourcesAndImports() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [openReceipt, setOpenReceipt] = useState<DataSourceWithReceipt | null>(null);
  const [fresh, setFresh] = useState<ImportReceipt | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [toDelete, setToDelete] = useState<DataSourceWithReceipt | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: sources, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["data-sources", user?.id],
    enabled: !!user,
    queryFn: () => listSourcesWithReceipts(user!.id),
  });

  /* Quantos registros cada fonte tem de fato no histórico.
     São DUAS tabelas, porque são dois caminhos de entrada: CSV de saúde grava
     em `life_events`, e importação de fatura grava em `transactions`
     (captureEvents filtra kind='transaction' fora da importação de arquivo).
     As duas ganharam `data_source_id` nas migrações de proveniência, então a
     contagem soma os dois lados — olhar só um deixaria a fatura reimportada
     mostrando zero, que é justamente a impressão de vazio a eliminar.

     Só perguntamos pelas fontes AMBÍGUAS — aquelas cujo último recibo não
     aceitou nada, as únicas em que o cartão poderia parecer vazio. Na
     importação normal o próprio "N entraram" já responde, e cobrar contagem
     por fonte de graça seria desperdício.

     Se a contagem voltar zero de verdade (a pessoa apagou os registros
     depois), o cartão não mostra número — dizer "0 registros" seria pior que
     ficar calado. */
  const ambiguous = (sources ?? [])
    .filter((s) => s.receipt && s.receipt.accepted_rows === 0)
    .map((s) => s.id);

  const { data: storedCounts } = useQuery({
    queryKey: ["data-source-counts", user?.id, ambiguous.join(",")],
    enabled: !!user && ambiguous.length > 0,
    queryFn: async () => {
      const countIn = async (table: "life_events" | "transactions", sourceId: string) => {
        const { count } = await supabase.from(table)
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .eq("data_source_id", sourceId);
        return count ?? 0;
      };
      const entries = await Promise.all(ambiguous.map(async (id) => {
        const [events, transactions] = await Promise.all([
          countIn("life_events", id),
          countIn("transactions", id),
        ]);
        return [id, events + transactions] as const;
      }));
      return Object.fromEntries(entries) as Record<string, number>;
    },
  });

  /* §4.4: "o usuário consegue abrir o recibo depois". A lista já traz o
     recibo embutido, mas relemos ao abrir — assim o que aparece é o estado
     do banco AGORA, e não uma cópia da última vez que a lista carregou. */
  const openReceiptFor = async (source: DataSourceWithReceipt) => {
    setOpenReceipt(source);
    setFresh(source.receipt);
    if (!source.receipt) return;
    setLoadingReceipt(true);
    try {
      const latest = await getReceipt(source.id);
      if (latest) setFresh(latest);
    } finally {
      setLoadingReceipt(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteSource(toDelete.id);
      toast.success("Fonte removida da lista. Seus registros continuam no histórico.");
      setToDelete(null);
      qc.invalidateQueries({ queryKey: ["data-sources"] });
    } catch {
      toast.error("Não consegui remover a fonte. Tente de novo.");
    } finally {
      setDeleting(false);
    }
  };

  const receipt = fresh;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Cada arquivo que você trouxe fica registrado aqui com o <strong>recibo</strong> da
        importação: o que entrou, o que já estava lá e o que não deu para ler. Serve para você
        conferir depois, sem depender da nossa palavra.
      </p>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl border p-3.5 space-y-2">
              <div className="flex items-center gap-3">
                <Skeleton className="w-9 h-9 rounded-md shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
              <Skeleton className="h-5 w-2/3 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-xl border p-3.5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--warning))" }} />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-medium">Não consegui carregar suas fontes.</p>
            <p className="text-xs text-muted-foreground">
              É falha de conexão — nada foi perdido. Seus registros e recibos continuam salvos.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching
                ? (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Tentando...</>)
                : (<><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Tentar de novo</>)}
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !isError && !(sources ?? []).length && (
        <div className="rounded-xl border p-5 text-center space-y-2">
          <Inbox className="w-7 h-7 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium">Nenhuma fonte importada ainda</p>
          <p className="text-xs text-muted-foreground">
            Quando você trouxer um CSV de saúde acima, ou uma fatura em Prosperidade, o arquivo
            aparece aqui com o recibo da importação.
          </p>
        </div>
      )}

      {!isLoading && !isError && (sources ?? []).map((source) => {
        const Icon = KIND_ICON[source.kind] ?? FileSpreadsheet;
        const color = `hsl(var(${KIND_COLOR[source.kind] ?? "--muted-foreground"}))`;
        const badge = STATUS_BADGE[source.status];
        const importedAt = source.confirmed_at ?? source.created_at;

        return (
          <div key={source.id} className="rounded-xl border p-3.5 space-y-2.5">
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-md grid place-items-center shrink-0"
                style={{ background: `hsl(var(${KIND_COLOR[source.kind] ?? "--muted-foreground"}) / 0.12)` }}
              >
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold break-words">{source.display_name}</p>
                <p className="text-xs text-muted-foreground">
                  {sourceKindLabel(source.kind)} · {periodLabel(source)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {source.confirmed_at ? "Importado" : "Lido"} em {shortDate(importedAt)}
                </p>
              </div>
              {badge && (
                <Badge variant="secondary" className="text-[10px] shrink-0">{badge.label}</Badge>
              )}
            </div>

            {badge && <p className="text-xs text-muted-foreground">{badge.hint}</p>}

            {source.receipt
              ? <ReceiptCounts receipt={source.receipt} storedCount={storedCounts?.[source.id]} />
              : (
                <p className="text-xs text-muted-foreground">
                  Sem recibo para esta fonte — ela entrou antes de o recibo existir, então não
                  tenho como afirmar quanto foi gravado.
                </p>
              )}

            <div className="flex flex-wrap gap-2 pt-0.5">
              <Button
                variant="outline" size="sm"
                onClick={() => openReceiptFor(source)}
                disabled={!source.receipt}
              >
                <ScrollText className="w-3.5 h-3.5 mr-1.5" /> Ver recibo
              </Button>
              <Button
                variant="ghost" size="sm" className="text-destructive"
                onClick={() => setToDelete(source)}
                aria-label={`Excluir a fonte ${source.display_name}`}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Excluir fonte
              </Button>
            </div>
          </div>
        );
      })}

      {/* ── Recibo aberto (§4.4) ─────────────────────────────────────── */}
      <Dialog open={!!openReceipt} onOpenChange={(v) => { if (!v) { setOpenReceipt(null); setFresh(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="pr-6 break-words font-display flex items-center gap-2">
              <ScrollText className="w-4 h-4 shrink-0 text-primary" /> Recibo da importação
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-0.5">
                <p className="break-words">{openReceipt?.display_name}</p>
                {openReceipt && (
                  <p className="text-xs">
                    {sourceKindLabel(openReceipt.kind)} · {periodLabel(openReceipt)}
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {loadingReceipt && !receipt && <Skeleton className="h-20 w-full" />}

          {receipt && (
            <div className="space-y-3">
              {receipt.summary && (
                <p className="text-sm rounded-lg border bg-muted/40 p-3">{receipt.summary}</p>
              )}

              <p className="text-xs font-semibold text-muted-foreground">Conferência</p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {[
                  { label: "Linhas no arquivo", value: receipt.total_rows },
                  { label: "Entraram", value: receipt.accepted_rows },
                  { label: "Já estavam registradas", value: receipt.duplicate_rows },
                  { label: "Não entraram", value: receipt.rejected_rows },
                ].map((row) => (
                  <div key={row.label} className="rounded-lg border px-3 py-2">
                    <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
                    <dd className="font-semibold">{row.value.toLocaleString("pt-BR")}</dd>
                  </div>
                ))}
              </dl>

              {receipt.warnings.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">Avisos</p>
                  <ul className="space-y-1">
                    {receipt.warnings.map((w, i) => (
                      <li key={`${w.code}-${i}`} className="flex items-start gap-2 text-xs">
                        <AlertTriangle
                          className="w-3.5 h-3.5 shrink-0 mt-px"
                          style={{ color: "hsl(var(--warning))" }}
                        />
                        <span className="min-w-0 break-words">
                          {w.message}
                          {w.count !== undefined && w.count > 1 && (
                            <span className="text-muted-foreground"> ({w.count}×)</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                As três últimas somam o total de linhas do arquivo — é o que permite conferir
                que nada se perdeu no caminho. "Não entraram" reúne três coisas: linha ilegível
                no arquivo, parcela futura e o que você desmarcou na revisão — o recibo não
                tenta adivinhar qual foi.
                Recibo emitido em {shortDate(receipt.created_at)}
                {openReceipt?.parser_version && <> · regra de leitura {openReceipt.parser_version}</>}.
                Este recibo fica guardado: você pode reabrir quando quiser.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Excluir fonte: o que acontece, ANTES de clicar ───────────── */}
      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta fonte?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  Sai da lista <strong>"{toDelete?.display_name}"</strong> e o recibo dela deixa de
                  ficar disponível para consulta.
                </p>
                <p className="rounded-md border p-2.5 text-foreground">
                  Os registros que você já confirmou <strong>continuam no seu histórico</strong>.
                  Excluir a fonte apaga a origem, não os fatos: você viveu aquelas noites de sono
                  e aqueles treinos. Para remover os registros em si, apague-os na tela do pilar.
                </p>
                <p className="text-xs">
                  Se você importar o mesmo arquivo outra vez, ele volta para esta lista sem
                  duplicar nada do que já está gravado.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Manter fonte</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting
                ? (<><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Excluindo...</>)
                : "Excluir fonte"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
