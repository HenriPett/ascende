import { useMemo, useState } from "react";
import { Pencil, Loader2, Check, X, Info } from "lucide-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/core/Markdown";
import {
  parsePlanContent, replaceSection, buildPlanContent, type PlanSection,
} from "@/lib/planSections";
import { cn } from "@/lib/utils";

/* Visualização seccionada de planos alimentares e de treino.
 *
 * O plano continua sendo um único markdown no banco — o que muda é que aqui
 * ele é lido por seção, para que a pessoa consiga mexer no almoço sem abrir
 * (e sem arriscar reescrever) o plano inteiro.
 *
 * Resumo e Observações ficam fixos e só de leitura: são o enquadramento do
 * plano, não itens do dia a dia. Cada seção do meio — uma refeição, um dia de
 * treino — vira um item de accordion editável.
 *
 * Quando o conteúdo não tem a estrutura esperada (plano antigo, escrito à mão),
 * `parsePlanContent` devolve null e caímos no documento inteiro. A tela nunca
 * fica sem conteúdo. */

/** Microcópia por tipo: "refeição" e "dia de treino" não são "seção". */
interface KindCopy {
  /** Singular do item, para rótulos e mensagens. */
  one: string;
  /** Artigo definido do singular — "da refeição", "do dia de treino". */
  article: "a" | "o";
  many: (n: number) => string;
  hint: string;
}

const KIND_COPY: Record<string, KindCopy> = {
  alimentar: {
    one: "refeição",
    article: "a",
    many: (n) => (n === 1 ? "1 refeição" : `${n} refeições`),
    hint: "Toque em uma refeição para ver os detalhes ou alterar só ela.",
  },
  treino: {
    one: "dia de treino",
    article: "o",
    many: (n) => (n === 1 ? "1 dia de treino" : `${n} dias de treino`),
    hint: "Toque em um dia para ver os detalhes ou alterar só ele.",
  },
};

const FALLBACK_COPY: KindCopy = {
  one: "seção",
  article: "a",
  many: (n) => (n === 1 ? "1 seção" : `${n} seções`),
  hint: "Toque em uma seção para ver os detalhes ou alterar só ela.",
};

/* Alimentar e treino viraram a mesma cor com a fusão, então o mapa virou
   constante: rótulo e ícone é que distinguem os dois, e sempre foram eles. */
const PLAN_VAR = "--vitalidade";

export default function PlanSections({
  content,
  kind,
  onSave,
}: {
  content: string;
  kind: string;
  /** Grava o markdown completo já remontado. `true` = deu certo. */
  onSave: (nextContent: string) => Promise<boolean>;
}) {
  const parsed = useMemo(() => parsePlanContent(content), [content]);

  const items = parsed?.sections.filter((s) => s.role === "item") ?? [];
  const [openIds, setOpenIds] = useState<string[]>(() => (items.length ? [items[0].id] : []));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);

  // Plano fora do formato: documento inteiro, como sempre foi.
  if (!parsed) return <Markdown content={content} doc />;

  const copy = KIND_COPY[kind] ?? FALLBACK_COPY;
  const temCor = kind === "alimentar" || kind === "treino";
  const accent = temCor ? `hsl(var(${PLAN_VAR}))` : "hsl(var(--gold))";
  const accentSoft = temCor ? `hsl(var(${PLAN_VAR}) / 0.35)` : "hsl(var(--gold) / 0.35)";

  const resumo = parsed.sections.find((s) => s.role === "resumo");
  const observacoes = parsed.sections.find((s) => s.role === "observacoes");

  const startEdit = (section: PlanSection) => {
    setEditingId(section.id);
    setDraftTitle(section.title);
    setDraftBody(section.body);
    // Editar uma seção fechada abriria um textarea invisível.
    setOpenIds((ids) => (ids.includes(section.id) ? ids : [...ids, section.id]));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftTitle("");
    setDraftBody("");
  };

  const save = async (section: PlanSection) => {
    if (saving) return;
    setSaving(true);
    const next = replaceSection(parsed, section.id, { title: draftTitle, body: draftBody });
    const ok = await onSave(buildPlanContent(next));
    setSaving(false);
    // Sai do modo de edição sem recolher a seção: a pessoa vê o que gravou.
    if (ok) cancelEdit();
  };

  return (
    <div className="space-y-4">
      {resumo && (
        <section
          aria-label="Resumo do plano"
          className="rounded-xl border bg-muted/40 px-3.5 py-3"
        >
          <p className="font-display text-sm font-semibold mb-1">{resumo.title}</p>
          <div className="text-sm">
            <Markdown content={resumo.body} doc />
          </div>
        </section>
      )}

      <div>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <p className="font-display text-sm font-semibold">{copy.many(items.length)}</p>
          <p className="text-[11px] text-muted-foreground">toque para abrir</p>
        </div>
        <p className="text-xs text-muted-foreground mb-2.5">{copy.hint}</p>

        <Accordion type="multiple" value={openIds} onValueChange={setOpenIds} className="space-y-2">
          {items.map((section) => {
            const isEditing = editingId === section.id;
            const dirty = draftTitle !== section.title || draftBody !== section.body;

            return (
              <AccordionItem
                key={section.id}
                value={section.id}
                className="border rounded-xl bg-card overflow-hidden"
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: accent,
                  ...(isEditing ? { boxShadow: `0 0 0 2px ${accentSoft}` } : null),
                }}
              >
                <AccordionTrigger className="px-3.5 py-3 gap-2 text-left hover:no-underline">
                  <span className="font-display text-sm font-semibold min-w-0 break-words">
                    {section.title}
                  </span>
                </AccordionTrigger>

                <AccordionContent className="px-3.5 pb-3.5 pt-0">
                  {isEditing ? (
                    <div className="space-y-2.5">
                      <div className="space-y-1">
                        <label
                          htmlFor={`titulo-${section.id}`}
                          className="text-[11px] font-medium text-muted-foreground"
                        >
                          Título d{copy.article} {copy.one}
                        </label>
                        <Input
                          id={`titulo-${section.id}`}
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          className="h-9"
                        />
                      </div>

                      <div className="space-y-1">
                        <label
                          htmlFor={`corpo-${section.id}`}
                          className="text-[11px] font-medium text-muted-foreground"
                        >
                          Conteúdo
                        </label>
                        <Textarea
                          id={`corpo-${section.id}`}
                          value={draftBody}
                          onChange={(e) => setDraftBody(e.target.value)}
                          rows={10}
                          className="font-mono text-xs leading-relaxed resize-y"
                        />
                      </div>

                      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                        <span>
                          Use <code className="rounded bg-muted px-1">-</code> para itens e{" "}
                          <code className="rounded bg-muted px-1">###</code> para subdivisões.
                          O resto do plano não é alterado.
                        </span>
                      </p>

                      <div className="flex justify-end gap-2 pt-0.5">
                        <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                          <X className="w-4 h-4 mr-1" /> Cancelar
                        </Button>
                        <Button size="sm" onClick={() => save(section)} disabled={saving || !dirty}>
                          {saving
                            ? (<><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Salvando...</>)
                            : (<><Check className="w-4 h-4 mr-1" /> Salvar</>)}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className={cn("text-sm", !section.body && "text-muted-foreground")}>
                        {section.body
                          ? <Markdown content={section.body} doc />
                          : <p>Esta {copy.one} ainda está sem detalhes.</p>}
                      </div>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => startEdit(section)}
                          aria-label={`Editar ${section.title}`}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar
                        </Button>
                      </div>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>

      {observacoes && (
        <section aria-label="Observações do plano" className="pt-1">
          <p className="text-xs font-semibold text-muted-foreground mb-1">{observacoes.title}</p>
          <div className="text-xs text-muted-foreground [&_p]:my-1">
            <Markdown content={observacoes.body} />
          </div>
        </section>
      )}
    </div>
  );
}
