import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Check, ChevronDown, Pencil, Clock, ThumbsDown, Trash2, Undo2, Loader2,
  AlertTriangle, RefreshCw, Quote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MEMORY_CATEGORY_LABEL, MEMORY_VALIDITY_PRESET_LABEL,
  MEMORY_CONTENT_MAX, isMemoryVigente, memorySourceLine, memoryValidityLabel,
  validUntilFromPreset, validateMemoryContent,
  type MemoryValidityPreset, semOrigemTexto,} from "@/lib/memories";
import {
  listMemoriesWithSources, confirmMemory, updateMemoryContent, setMemoryValidity,
  rejectMemory, reactivateMemory, deleteMemory,
  type AiMemory, type MemorySourceResolved, type MemoryWithSources,
} from "@/lib/memoriesData";

/* "O que o Ascende sabe" — a memória sob controle da pessoa.
 *
 * Antes daqui, a lista só permitia APAGAR: a IA afirmava algo sobre a pessoa e
 * a única resposta possível era a destruição. Agora ela pode dizer que está
 * certo, corrigir, marcar como temporária ou recusar — e, em toda memória, VER
 * DE ONDE AQUILO SAIU.
 *
 * A origem é o coração da fase, pelo mesmo motivo do recibo da importação: "a
 * IA acha que você prefere treinar de manhã" sem dizer de onde tirou é
 * promessa sem prova. Por isso a origem aparece resumida em TODO cartão, e o
 * trecho citado fica a um toque.
 *
 * Vocabulário definido com a Prisma: "Isso está certo", "Corrigir", "Só por um
 * tempo", "Isso não é sobre mim", "Apagar". As palavras `status`, `confiança`
 * e `sensibilidade` são nossas, não dela — nenhuma aparece na tela.
 *
 * Recusar NÃO apaga: a memória sai do retrato e desce para "Descartadas", de
 * onde pode voltar. Quem quiser sumir de vez tem o botão de apagar. */

const PRESETS: MemoryValidityPreset[] = ["fim_do_mes", "3_meses", "6_meses"];

/** "há 3 dias" — sem biblioteca, e sem prometer precisão que não importa. */
function agoLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const days = Math.floor((Date.now() - t) / 864e5);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.round(days / 30);
  return months <= 1 ? "há um mês" : `há ${months} meses`;
}

/** Data por extenso, para a pessoa conferir o prazo que acabou de escolher. */
function longDay(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "numeric", month: "long",
  }).format(new Date(t));
}

/**
 * Por que esta memória está fora do retrato — e o motivo importa: recusada foi
 * DECISÃO da pessoa, vencida foi só o prazo passando. Dizer "você disse que
 * não é sobre você" sobre uma memória que apenas venceu seria colocar na boca
 * dela uma coisa que ela não falou.
 */
function discardReason(m: { status: string; valid_until: string | null }): string {
  if (m.status === "rejeitada") return "Você disse que não é sobre você";
  return memoryValidityLabel(m) ?? "Fora do prazo";
}

/** A origem detalhada: rótulo, trecho citado e data. Sem trecho (registro
 *  apagado desde então), mostra menos — e verdadeiro. */
function SourceDetail({ source }: { source: MemorySourceResolved }) {
  return (
    <li className="text-xs">
      <p className="text-muted-foreground">{memorySourceLine(source)}</p>
      {source.excerpt && (
        <p className="mt-1 flex items-start gap-1.5 rounded-md border bg-muted/40 p-2">
          <Quote className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
          <span className="min-w-0 break-words italic">{source.excerpt}</span>
        </p>
      )}
    </li>
  );
}

export default function MemoryControl({
  onClearAll, clearing = false,
}: {
  /** "Apagar tudo" continua vivendo em Ajustes: é a única ação em massa, e
   *  não faz parte do controle item a item. */
  onClearAll?: () => void;
  clearing?: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queryKey = ["ai-memories", user?.id];

  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);

  // Puxamos TUDO (inclusive recusadas e vencidas) e separamos aqui: assim
  // recusar uma memória a move de seção na hora, sem nova ida ao servidor.
  const { data: memories, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    enabled: !!user,
    queryFn: () => listMemoriesWithSources(user!.id, { includeInactive: true }),
  });

  const all = memories ?? [];
  const current = all.filter((m) => isMemoryVigente(m));
  const discarded = all.filter((m) => !isMemoryVigente(m));

  /** Aplica no cache a memória que a ação devolveu, preservando as origens. */
  const patch = (updated: AiMemory) => {
    qc.setQueryData<MemoryWithSources[]>(queryKey, (list) =>
      (list ?? []).map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
  };

  /* `ok` é OPCIONAL, e `null` é uma decisão: quando a própria linha já mostra
     o resultado ("Confirmado por você", o texto corrigido, a memória de volta à
     lista), um toast repetindo isso é só mais uma coisa para ler e fechar
     (`feedback.md`: "people typically expect their action or task to succeed,
     they only need to know when it doesn't"). Fica o toast que diz algo que a
     tela NÃO mostra: até quando vale, e para onde foi o que foi descartado. */
  /** Devolve se a ação deu certo. Quem só dispara (`onConfirm`, `onReject`…)
   *  ignora o retorno; quem tem estado na tela que depende do resultado
   *  (`onSaveEdit`) decide por ele. */
  const run = async (id: string, action: () => Promise<AiMemory>, ok: string | null): Promise<boolean> => {
    if (busy) return false;
    setBusy(id);
    try {
      patch(await action());
      toast.dismiss("memoria-acao");
      if (ok) toast.success(ok);
      return true;
    } catch (err) {
      // `id` estável: a mensagem pode vir do servidor, e a próxima ação que
      // der certo nesta lista dispensa este erro.
      toast.error(err instanceof Error ? err.message : "Não consegui salvar. Tente de novo.", { id: "memoria-acao" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const onConfirm = (m: MemoryWithSources) =>
    run(m.id, () => confirmMemory(m.id), null);

  // O erro da edição fica embaixo do texto que está sendo editado, não num
  // toast que some: é ali que ela vai corrigir.
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);

  const onSaveEdit = async (m: MemoryWithSources) => {
    const check = validateMemoryContent(draft);
    if (!check.ok) { setErroEdicao(check.error); return; }
    if (check.content === m.content) { setEditing(null); return; }
    /* Só fecha a edição se gravou. Fechar sempre fazia uma falha de rede
       levar junto o texto que a pessoa acabou de escrever: o erro aparecia, e
       o campo onde ela ia tentar de novo já não existia. */
    if (await run(m.id, () => updateMemoryContent(m.id, check.content), null)) setEditing(null);
  };

  const onPreset = async (m: MemoryWithSources, preset: MemoryValidityPreset) => {
    const until = validUntilFromPreset(preset);
    // Mesma regra da edição: só fecha a escolha de prazo se gravou — senão a
    // falha fechava o seletor e a pessoa tinha de reabri-lo para tentar de novo.
    if (await run(m.id, () => setMemoryValidity(m.id, until), `Combinado: vale até ${longDay(until)}.`)) setScheduling(null);
  };

  const onClearValidity = (m: MemoryWithSources) =>
    run(m.id, () => setMemoryValidity(m.id, null), "Prazo removido: vale por tempo indeterminado.");

  const onReject = (m: MemoryWithSources) =>
    run(m.id, () => rejectMemory(m.id), "Tirei isso do seu retrato. Está em Descartadas, se mudar de ideia.");

  const onReactivate = (m: MemoryWithSources) =>
    run(m.id, () => reactivateMemory(m.id), null);

  const onDelete = async (m: MemoryWithSources) => {
    if (busy) return;
    setBusy(m.id);
    try {
      await deleteMemory(m.id);
      qc.setQueryData<MemoryWithSources[]>(queryKey, (list) =>
        (list ?? []).filter((x) => x.id !== m.id));
      toast.dismiss("Não consegui apagar. Tente de novo.");
      toast.success("Apagado de vez.");
    } catch {
      toast.error("Não consegui apagar. Tente de novo.");
    } finally {
      setBusy(null);
    }
  };

  /* ── Um cartão ────────────────────────────────────────────────────────── */
  const MemoryCard = ({ m }: { m: MemoryWithSources }) => {
    const isOpen = expanded === m.id;
    const isEditing = editing === m.id;
    const isScheduling = scheduling === m.id;
    const working = busy === m.id;
    const confirmed = m.status === "confirmada";
    const validity = memoryValidityLabel(m);
    const primarySource = m.sources[0];

    return (
      <Collapsible
        open={isOpen}
        onOpenChange={(v) => { setExpanded(v ? m.id : null); if (!v) { setEditing(null); setScheduling(null); } }}
      >
        <div className="rounded-xl border p-3 space-y-2">
          {isEditing ? (
            <div className="space-y-2">
              <label htmlFor={`memoria-${m.id}`} className="text-caption2 font-medium text-muted-foreground">
                Como isso deveria estar escrito?
              </label>
              <Textarea
                id={`memoria-${m.id}`}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setErroEdicao(null); }}
                aria-invalid={!!erroEdicao || undefined}
                aria-describedby={erroEdicao ? `erro-memoria-${m.id}` : undefined}
                maxLength={MEMORY_CONTENT_MAX}
                rows={3}
                className="resize-none"
              />
              {erroEdicao && (
                <p id={`erro-memoria-${m.id}`} role="alert" className="text-footnote text-destructive">{erroEdicao}</p>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption2 text-muted-foreground">
                  {draft.trim().length}/{MEMORY_CONTENT_MAX}
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={working}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={() => onSaveEdit(m)} disabled={working || !draft.trim()} loading={working}>
                    <Check className="w-4 h-4 mr-1" /> Salvar
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm break-words">{m.content}</p>
          )}

          {/* Categoria e ORIGEM resumida: em toda memória, sempre visível. */}
          <p className="text-caption2 text-muted-foreground">
            {MEMORY_CATEGORY_LABEL[m.category] ?? MEMORY_CATEGORY_LABEL.outro}
            {primarySource && <> · {memorySourceLine(primarySource)}</>}
            {!primarySource && <> · aprendido {agoLabel(m.created_at)}</>}
          </p>

          {validity && (
            <p className="text-caption2 flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3 shrink-0" aria-hidden /> {validity}
            </p>
          )}

          {/* Só confirmar fica no cartão fechado. O resto vive na expansão —
              cinco ações à mostra num cartão de duas linhas viram ruído. */}
          <div className="flex items-center justify-between gap-2">
            {confirmed ? (
              <p className="text-caption2 flex items-center gap-1 text-muted-foreground">
                <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--success))" }} aria-hidden />
                Confirmado por você{m.last_verified_at && ` · ${agoLabel(m.last_verified_at)}`}
              </p>
            ) : (
              <Button size="sm" variant="outline" onClick={() => onConfirm(m)} disabled={working} loading={working}>
                <Check className="w-3.5 h-3.5 mr-1.5" /> Isso está certo
              </Button>
            )}

            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground shrink-0">
                Origem e opções
                <ChevronDown className={cn("w-3.5 h-3.5 ml-1 transition-transform", isOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <p className="text-caption2 font-semibold text-muted-foreground">De onde eu tirei isso</p>
              {m.sources.length ? (
                <ul className="space-y-2">
                  {m.sources.map((s) => <SourceDetail key={s.id} source={s} />)}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{semOrigemTexto(m.created_at)}</p>
              )}
            </div>

            {isScheduling ? (
              <div className="space-y-2">
                <p className="text-caption2 font-semibold text-muted-foreground">Vale até quando?</p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((preset) => (
                    <Button
                      key={preset} variant="outline" size="sm"
                      onClick={() => onPreset(m, preset)} disabled={working}
                    >
                      {MEMORY_VALIDITY_PRESET_LABEL[preset]}
                    </Button>
                  ))}
                </div>
                <p className="text-caption2 text-muted-foreground">
                  Passado o prazo, sai do seu retrato sozinha — sem você precisar voltar aqui.
                </p>
                <Button variant="ghost" size="sm" onClick={() => setScheduling(null)} disabled={working}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="ghost" size="sm" className="text-muted-foreground"
                  onClick={() => { setEditing(m.id); setDraft(m.content); setErroEdicao(null); }}
                  disabled={working}
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Corrigir
                </Button>
                <Button
                  variant="ghost" size="sm" className="text-muted-foreground"
                  onClick={() => setScheduling(m.id)} disabled={working}
                >
                  <Clock className="w-3.5 h-3.5 mr-1.5" /> Só por um tempo
                </Button>
                {validity && (
                  <Button
                    variant="ghost" size="sm" className="text-muted-foreground"
                    onClick={() => onClearValidity(m)} disabled={working}
                  >
                    Tirar o prazo
                  </Button>
                )}
                <Button
                  variant="ghost" size="sm" className="text-muted-foreground"
                  onClick={() => onReject(m)} disabled={working}
                >
                  <ThumbsDown className="w-3.5 h-3.5 mr-1.5" /> Isso não é sobre mim
                </Button>
                <Button
                  variant="ghost" size="sm" className="text-destructive"
                  onClick={() => onDelete(m)} disabled={working}
                  aria-label={`Apagar de vez: ${m.content}`}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Apagar
                </Button>
              </div>
            )}
          </CollapsibleContent>
        </div>
      </Collapsible>
    );
  };

  /* ── A seção ──────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          A cada conversa, o Conselheiro aprende nuances sobre você e usa isso para respostas e
          planos mais pessoais. Aqui você vê <strong>de onde ele tirou cada coisa</strong> — e
          decide o que fica: confirme o que está certo, corrija o que saiu torto, recuse o que
          não é sobre você.
        </p>
        {all.length > 0 && onClearAll && (
          <Button
            variant="ghost" size="sm" className="shrink-0 text-muted-foreground"
            onClick={onClearAll} disabled={clearing}
            loading={clearing}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Apagar tudo
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl border p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-8 w-32 rounded-md" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-xl border p-3.5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--warning))" }} />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-medium">Não consegui carregar o que eu sei sobre você.</p>
            <p className="text-xs text-muted-foreground">
              Pode ser a conexão — nada foi perdido nem alterado.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching
                ? (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Tentando…</>)
                : (<><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Tentar de novo</>)}
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !isError && !all.length && (
        <p className="text-subhead text-muted-foreground">
          Ainda não aprendi nada sobre você. Converse com o Conselheiro ou use a caixa
          "Conte como foi" na tela Hoje — o que eu aprender aparece aqui, com a origem.
        </p>
      )}

      {current.map((m) => <MemoryCard key={m.id} m={m} />)}

      {/* Descartadas: recusadas e vencidas juntas, recolhidas. Ficam fora do
          retrato, mas não riscadas nem esmaecidas — texto riscado lê como
          punição, e recusar uma dedução da IA não é erro da pessoa. */}
      {discarded.length > 0 && (
        <Collapsible open={showDiscarded} onOpenChange={setShowDiscarded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground w-full justify-between">
              <span>Descartadas ({discarded.length})</span>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showDiscarded && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">
              Fora do seu retrato: o Conselheiro não considera nada daqui. Continuam guardadas
              caso você mude de ideia.
            </p>
            {discarded.map((m) => (
              <div key={m.id} className="rounded-xl border p-3 space-y-2">
                <p className="text-sm break-words">{m.content}</p>
                <p className="text-caption2 text-muted-foreground">
                  {discardReason(m)}
                  {m.sources[0] && <> · {memorySourceLine(m.sources[0])}</>}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="outline" size="sm"
                    onClick={() => onReactivate(m)} disabled={busy === m.id}
                    loading={busy === m.id}
                  >
                    <Undo2 className="w-3.5 h-3.5 mr-1.5" /> Trazer de volta
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="text-destructive"
                    onClick={() => onDelete(m)} disabled={busy === m.id}
                    aria-label={`Apagar de vez: ${m.content}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Apagar
                  </Button>
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
