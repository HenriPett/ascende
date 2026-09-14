/* AÇÕES RÁPIDAS — registrar em 1 toque: água, humor, gasto, refeição, treino.
 *
 * POR QUE ISTO SAIU DE Hoje.tsx
 *
 * REGISTRAR é o alvo central da barra de navegação e existe em TODA tela do
 * app (AppLayout.tsx). Mas a folha que ele abre continha só a CaptureBar — o
 * caminho de IA. Quem estava na Prosperidade e queria marcar um copo de água
 * pagava: abrir a folha, digitar, tocar Registrar, esperar a chamada de rede
 * do `capture`, ler a proposta e confirmar. Quatro interações e uma espera,
 * para um copo de água. O caminho de 1 toque para a MESMA água existia,
 * funcionava, e estava a duas telas de distância.
 *
 * A confirmação em duas etapas da captura por IA é contrato (a IA nunca grava
 * sozinha) e não se toca nela. O que se corrigiu foi a ausência do atalho onde
 * ele não custa contrato nenhum: estas ações escrevem direto, porque foi a
 * própria pessoa que escolheu o valor no botão — não há nada a confirmar.
 *
 * O componente já se esconde sozinho quando nenhum tracker relevante está
 * ativo, então na folha de quem desligou tudo nada muda.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, DEFAULT_WATER_GOAL_ML, DEFAULT_WATER_BOTTLES } from "@/hooks/useProfile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Droplet, Camera, Dumbbell } from "lucide-react";
import {
  CATEGORIES, QUICK_INSTALLMENT_CHIPS, buildInstallmentPlan, newInstallmentGroupId,
  quickInstallmentSummary, shouldOfferInstallments, MIN_INSTALLMENTS, MAX_INSTALLMENTS,
} from "@/lib/prosperidade";
import { cn } from "@/lib/utils";
import { activePillarSet } from "@/lib/pillars";
import { activeTrackerSet } from "@/lib/trackers";
import { invalidateKeys, FINANCE_KEYS, LIFE_DATA_KEYS } from "@/lib/queryKeys";
import { xpToastSuffix } from "@/lib/xp";
import { brl, todayISO } from "@/lib/format";

/* ── Gasto rápido inline (plano de feedbacks): registrar um gasto do dia a
   dia não deveria custar uma navegação. O botão abre um diálogo de 2 toques
   (valor + categoria) e grava direto em `transactions` — o gráfico e o
   Conselheiro enxergam na hora. O pilar completo continua a um link.

   PARCELAR SEM DESTRUIR OS DOIS TOQUES (TODO do fundador)

   Parcelar na Prosperidade já existia; aqui não. O risco de trazer a opção
   para cá é conhecido: este diálogo existe por UM motivo — registrar o almoço
   em dois toques — e todo campo cobrado de todo mundo come essa razão.

   Por isso a opção nasce escondida e só aparece depois que existe um valor
   digitado. NÃO HÁ LIMIAR: havia um piso de R$ 200 e ele foi retirado por
   decisão de produto. Qualquer piso está errado para alguém — R$ 150 em 3x é
   uma compra parcelada tão real quanto R$ 2.000 em 10x — e quem parcelou e
   não achou a opção conclui que o app não faz aquilo. O acordo com quem só
   quer registrar o almoço continua de pé por outro caminho: enquanto o campo
   está vazio não há linha nenhuma, e quando ela aparece é UMA linha discreta
   com "À vista" já marcado, que não rouba foco e não empurra o botão salvar.

   Essa linha ("À vista · Parcelar") fica abaixo da categoria. Tocar em
   Parcelar revela os atalhos NA MESMA TELA: sem segundo passo, sem novo
   diálogo, sem campo de data (a 1ª parcela é hoje, igual à Prosperidade).

   O VALOR DIGITADO É O TOTAL, IGUAL À PROSPERIDADE. As duas telas fazem a
   mesma coisa e precisam ler o mesmo número do mesmo jeito — duas leituras
   contrárias para a mesma ação é o app falando duas línguas.

   Prevalece o TOTAL porque é como a pessoa fala da compra que acabou de
   fazer: "comprei um celular de R$ 2.000 em 10x". Digitar 2.000 e receber
   "10x de R$ 200" confere com a nota; digitar 2.000 e receber um compromisso
   de R$ 20.000 é um erro silencioso de uma ordem de grandeza — o número está
   certo na tela e errado na vida, e a pessoa só descobre no extrato.

   O risco simétrico (quem tem a parcela na mão, "10x de R$ 43,90") não
   desapareceu: continua atendido pelo mesmo link discreto de inversão que a
   Prosperidade tem — mas o padrão é TOTAL nas duas. ── */
const QUICK_EXPENSE_CATEGORIES = CATEGORIES.filter((c) => c !== "Salário" && c !== "Extra");

/** As duas metades de "À vista · Parcelar". Alvo de 44px de altura mesmo sendo
 *  texto discreto: o toque tem que ser fácil, a linha é que tem que ser leve. */
const opcaoPagamento = (ativa: boolean) => cn(
  "min-h-11 px-3 rounded-lg transition-colors",
  ativa ? "font-medium text-foreground underline underline-offset-4"
        : "text-muted-foreground hover:text-foreground",
);

function QuickExpense({ disabled }: { disabled?: boolean }) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("Mercado");
  const [parcelar, setParcelar] = useState(false);
  const [parcelas, setParcelas] = useState("");
  // Qual dos dois números a pessoa digitou. Padrão "total", igual à
  // Prosperidade — o outro o app calcula e devolve na linha de resumo.
  const [valorMode, setValorMode] = useState<"parcela" | "total">("total");
  const [saving, setSaving] = useState(false);
  // O rótulo "última em out/2027" é o mês do CICLO da pessoa, não do mês civil.
  const cycleDay = profile?.financial_cycle_day ?? 1;

  const value = Number(String(amount).replace(",", "."));
  const offerInstallments = shouldOfferInstallments(value);

  // O campo ficou vazio ou inválido (a pessoa apagou para corrigir): a linha
  // some e o estado some junto. Sem isto, digitar de novo reencontraria um
  // parcelamento meio preenchido que ninguém pediu — e o padrão é "À vista".
  useEffect(() => {
    if (!offerInstallments && parcelar) { setParcelar(false); setParcelas(""); setValorMode("total"); }
  }, [offerInstallments, parcelar]);

  const plan = useMemo(() => {
    if (!parcelar || !offerInstallments) return null;
    return buildInstallmentPlan({
      amount: value, count: Number(parcelas), mode: valorMode,
      description: category, purchaseDate: todayISO(),
    });
  }, [parcelar, offerInstallments, value, parcelas, valorMode, category]);

  const desligarParcelamento = () => { setParcelar(false); setParcelas(""); setValorMode("total"); };
  const reset = () => { setAmount(""); desligarParcelamento(); };

  const save = async () => {
    if (!user || !value || value <= 0) { toast.error("Informe um valor válido em reais, como 30."); return; }

    // Parcelada: N linhas de uma vez, ligadas por um group_id — a mesma forma
    // que a Prosperidade grava. Cada parcela com a data real dela, para cair
    // no ciclo certo e sumir do seguinte sozinha.
    if (parcelar) {
      // Duas falhas diferentes, dois avisos diferentes — a mesma separação que
      // a Prosperidade faz. Sem o piso de R$ 200, "não dá para dividir" virou
      // um caso ALCANÇÁVEL (R$ 0,05 em 12x não tem como virar 12 parcelas), e
      // mandar a pessoa escolher outro número de parcelas nesse caso seria
      // mandá-la consertar o campo errado.
      const n = Number(parcelas);
      if (!Number.isInteger(n) || n < MIN_INSTALLMENTS || n > MAX_INSTALLMENTS) {
        toast.error(`Escolha em quantas parcelas — de ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS}.`);
        return;
      }
      if (!plan) { toast.error("Esse valor não dá para dividir nesse número de parcelas."); return; }
      setSaving(true);
      const groupId = newInstallmentGroupId();
      const { error } = await supabase.from("transactions").insert(
        plan.rows.map((r) => ({
          user_id: user.id, kind: "expense" as const, amount: r.amount, category,
          description: r.description, occurred_at: r.occurred_at,
          source: "manual" as const, group_id: groupId,
        })),
      );
      setSaving(false);
      if (error) { toast.error("Não consegui registrar as parcelas. Tente de novo."); return; }
      toast.success(`Compra em ${plan.count}x · ${category} registrada. +2 XP${xpToastSuffix()}`);
      reset(); setOpen(false);
      invalidateKeys(qc, FINANCE_KEYS);
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("transactions").insert({
      user_id: user.id, kind: "expense", amount: value,
      category, occurred_at: todayISO(), source: "manual",
    });
    setSaving(false);
    if (error) { toast.error("Não consegui registrar o gasto. Tente de novo."); return; }
    toast.success(`Gasto de R$ ${value.toFixed(2).replace(".", ",")} · ${category} registrado. +2 XP${xpToastSuffix()}`);
    reset(); setOpen(false);
    invalidateKeys(qc, FINANCE_KEYS);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-60"
      >
        <span className="text-[13px] font-semibold" style={{ color: "hsl(var(--prosperidade))" }} aria-hidden>R$</span> Gasto
      </button>
      <Dialog open={open} onOpenChange={(o) => {
        setOpen(o);
        // Fechar sem salvar devolve o padrão: "À vista". O parcelamento é a
        // exceção e nunca deve estar ligado na próxima vez que o diálogo abre.
        if (!o) desligarParcelamento();
      }}>
        {/* O DIÁLOGO CRESCE PARA CIMA, NÃO PARA BAIXO.

            Centrado (`top-50% translate-y--50%`), cada linha revelada era
            repartida: metade subia o topo, metade empurrava o botão salvar.
            Ao aparecer a linha de parcelamento o alvo descia 28px — debaixo do polegar de
            quem já estava mirando em salvar, no instante do terceiro dígito
            (achado 4 do QA).

            Reservar o espaço em branco resolveria e custaria os 56px que o
            caminho do almoço não pode pagar. Então em vez de reservar, o
            diálogo ganha o FUNDO FIXO: ancorado onde o fundo do diálogo curto
            já ficava (141px = metade da altura dele), tudo que aparece empurra
            o topo para cima e o botão não anda um pixel.

            Medido em 390px de largura, botão "Registrar gasto": deslocamento
            0px a 844, 800 e 700px de altura — contra 28px quando a linha de
            parcelamento aparecia e 93px com os chips abertos. O diálogo do almoço continua com 279px
            e no mesmo lugar (283 → 285). O `max-h`/`overflow` é a rede: numa
            janela baixa (celular deitado) o diálogo encolhe e rola por dentro
            em vez de escapar pelo topo. */}
        <DialogContent className="max-w-sm top-auto translate-y-0 bottom-[max(1rem,calc(50%_-_141px))] max-h-[calc(100%_-_max(1rem,calc(50%_-_141px))_-_1rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar gasto</DialogTitle>
            <DialogDescription>Valor e categoria — dois toques e pronto.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              inputMode="decimal"
              autoFocus
              placeholder={parcelar
                ? (valorMode === "total" ? "Valor total (R$)" : "Valor da parcela (R$)")
                : "Valor (R$)"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                {QUICK_EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* A linha aparece assim que existe um valor — não há mais
                limiar. Enquanto o campo está vazio ela não existe, e é por
                isso que abrir o diálogo continua idêntico ao de antes. */}
            {offerInstallments && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-center gap-1 text-xs" role="group"
                  aria-label="Como você pagou">
                  <button type="button" aria-pressed={!parcelar} className={opcaoPagamento(!parcelar)}
                    onClick={desligarParcelamento}>
                    À vista
                  </button>
                  <span className="text-muted-foreground" aria-hidden>·</span>
                  <button type="button" aria-pressed={parcelar} className={opcaoPagamento(parcelar)}
                    onClick={() => setParcelar(true)}>
                    Parcelar
                  </button>
                </div>

                {parcelar && (
                  <div className="space-y-2">
                    {/* Enrola em vez de espremer: num aparelho de 320px os
                        cinco atalhos mais o campo livre não cabem numa linha
                        sem cada um virar um alvo de 37px. `basis-11` fixa o
                        piso de 44px e a segunda linha aparece só onde precisa
                        — medido de 320 a 430px. */}
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_INSTALLMENT_CHIPS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          aria-pressed={Number(parcelas) === n}
                          aria-label={`${n} parcelas`}
                          onClick={() => setParcelas(String(n))}
                          className={cn(
                            "flex-1 basis-11 min-w-11 min-h-11 rounded-full border text-xs font-medium transition-colors",
                            // O selecionado INVERTE. O `bg-muted` de antes
                            // mudava 8/255 por canal e a seleção ficava por
                            // conta só do brilho do texto (achado 5 do QA).
                            // Medi as alternativas: a cor do pilar dá 11,2:1 de
                            // borda no escuro mas só 1,87:1 no claro (ouro
                            // sobre branco), abaixo dos 3:1 exigidos de um
                            // indicador não textual. A inversão é a única que
                            // passa folgado nos dois temas.
                            Number(parcelas) === n
                              ? "bg-foreground text-background border-foreground"
                              : "bg-card text-muted-foreground border-border hover:bg-muted/60",
                          )}
                        >
                          {n}x
                        </button>
                      ))}
                      {/* O campo livre cobre o que os atalhos não cobrem (4x,
                          18x) sem virar um segundo passo para quem usa 12x. */}
                      <Input
                        className="w-14 min-h-11 text-center px-1"
                        inputMode="numeric"
                        placeholder="outro"
                        aria-label="Outro número de parcelas"
                        value={(QUICK_INSTALLMENT_CHIPS as readonly number[]).includes(Number(parcelas)) ? "" : parcelas}
                        onChange={(e) => setParcelas(e.target.value.replace(/\D/g, "").slice(0, 2))}
                      />
                    </div>
                    {/* Uma linha: a parcela e, principalmente, QUANDO acaba —
                        o compromisso real que a pessoa está assumindo. */}
                    {plan && (
                      <p aria-live="polite" className="text-[11px] text-muted-foreground text-center">
                        {quickInstallmentSummary(plan, brl, cycleDay, valorMode)}
                      </p>
                    )}
                    {/* Inverte a conta para quem só tem o total na mão. Mesma
                        frase e mesmo lugar da Prosperidade, de propósito. */}
                    <button
                      type="button"
                      // SEM `aria-pressed`, de propósito. Ele esteve aqui e
                      // estava errado: o rótulo deste botão MUDA com o estado
                      // ("digitei o valor total" ↔ "digitei o valor da
                      // parcela"), então ele nomeia uma AÇÃO, não um estado
                      // ligado/desligado. Marcar `pressed` num rótulo que já
                      // virou o oposto faz o leitor de tela anunciar "digitei o
                      // valor da parcela, pressionado" para quem digitou o
                      // TOTAL — exatamente o contrário do que vale, e agora no
                      // estado PADRÃO. Quem mostra o modo é o rótulo do campo,
                      // que é o mesmo sinal que a pessoa vidente usa.
                      onClick={() => setValorMode(valorMode === "total" ? "parcela" : "total")}
                      className="w-full min-h-11 text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
                    >
                      {valorMode === "total" ? "digitei o valor da parcela" : "digitei o valor total"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* O botão nunca promete o que não vai fazer: com Parcelar
                ligado ele deixa de dizer "Registrar gasto", mesmo antes de a
                pessoa escolher o número — aí quem explica a falta é o aviso
                ao tocar, que também diz a faixa aceita. */}
            <Button className="w-full" onClick={save} disabled={saving}>
              {saving ? "Registrando…"
                : plan ? `Registrar ${plan.count} parcelas`
                : parcelar ? "Registrar parcelas"
                : "Registrar gasto"}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Descrição, data e entradas ficam no{" "}
              <Link to="/app/prosperidade" className="underline underline-offset-2" onClick={() => setOpen(false)}>
                pilar Prosperidade
              </Link>.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Ações rápidas (3.1): água, humor e foto em 1 toque ── */
const QUICK_MOODS = [
  { score: 1, emoji: "😞", label: "péssimo" },
  { score: 2, emoji: "🙁", label: "ruim" },
  { score: 3, emoji: "😐", label: "ok" },
  { score: 4, emoji: "🙂", label: "bem" },
  { score: 5, emoji: "😄", label: "ótimo" },
];

/* O sinal de que a lista rola para o lado.
 *
 * O último chip era cortado na borda seca: um corte assim lê como "acabou
 * mal desenhado", não como "tem mais coisa aqui". Um degradê que apaga o
 * conteúdo na borda direita é o sinal — e como é MÁSCARA, não um retângulo
 * colorido por cima, funciona sobre qualquer fundo (o `bg-ether` tem auras,
 * um gradiente de cor fixa denunciaria a emenda). Onde `mask-image` não
 * existe, simplesmente não há fade: nada quebra.
 *
 * Ele some ao chegar no fim e nunca aparece quando não há o que rolar —
 * um fade permanente prometeria conteúdo que não existe. */
const FADE_ROLAGEM = "linear-gradient(to right, #000 calc(100% - 2rem), transparent)";

export default function QuickActions() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const bottles = profile?.water_bottles?.length ? profile.water_bottles : DEFAULT_WATER_BOTTLES;
  // Modularidade TOTAL: cada ação rápida pertence a um TRACKER (não mais só
  // ao pilar). Quem desligou "água" não vê os botões de água — desligar
  // esconde, nunca apaga (o histórico continua da pessoa).
  const trackers = activeTrackerSet(profile);
  const showWater = trackers.has("water");
  const showMood = trackers.has("mood");
  const showMeal = trackers.has("meals");
  const showExpense = activePillarSet(profile?.pillars).has("prosperidade");
  const showWorkout = trackers.has("workouts");

  const insert = async (key: string, row: Record<string, unknown>, okMsg: string) => {
    if (!user || savingKey) return;
    setSavingKey(key);
    const { error } = await supabase.from("life_events").insert({ user_id: user.id, source: "form", ...row });
    setSavingKey(null);
    if (error) { toast.error("Não consegui registrar. Tente de novo."); return; }
    toast.success(okMsg + xpToastSuffix());
    invalidateKeys(qc, LIFE_DATA_KEYS);
  };

  const addWater = (ml: number, label: string) =>
    insert(`w${ml}`, { pillar: "alimentacao", kind: "water", payload: { ml, summary: `Água: ${ml} ml` } },
      `${label} registrada (+${ml} ml). +2 XP`);

  const logMood = (score: number, emoji: string, label: string) =>
    insert(`m${score}`, { pillar: "mente", kind: "mood", payload: { score, label, summary: `Humor: ${label}` } },
      `Humor ${emoji} registrado. +5 XP`);

  // Quais chips existem decide se sobra o que rolar — por isso entram nas
  // dependências da medição, e não só o tamanho da janela.
  const trilho = useRef<HTMLDivElement>(null);
  const [rolaMais, setRolaMais] = useState(false);
  const medir = useCallback(() => {
    const el = trilho.current;
    if (!el) return;
    // -1px de folga: navegadores devolvem scrollLeft fracionário no fim.
    setRolaMais(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  useEffect(() => {
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [medir, showWater, showMood, showMeal, showExpense, showWorkout, bottles]);

  if (!showWater && !showMood && !showMeal && !showExpense && !showWorkout) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground px-0.5">Registro em 1 toque</p>
      <div
        ref={trilho}
        onScroll={medir}
        className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
        style={{
          scrollbarWidth: "none",
          ...(rolaMais ? { maskImage: FADE_ROLAGEM, WebkitMaskImage: FADE_ROLAGEM } : {}),
        }}
      >
        {showWater && bottles.slice(0, 3).map((b) => (
          <button
            key={`${b.ml}-${b.label}`}
            onClick={() => addWater(b.ml, b.label)}
            disabled={!!savingKey}
            className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-60"
          >
            <Droplet className="w-3.5 h-3.5" style={{ color: "hsl(205 70% 55%)" }} />
            {b.label} <span className="text-muted-foreground">{b.ml}ml</span>
          </button>
        ))}
        {showWater && (showMood || showMeal || showExpense || showWorkout) && (
          <span className="shrink-0 w-px bg-border my-1.5" aria-hidden />
        )}
        {showMood && QUICK_MOODS.map((m) => (
          <button
            key={m.score}
            onClick={() => logMood(m.score, m.emoji, m.label)}
            disabled={!!savingKey}
            className="shrink-0 h-11 w-11 rounded-full border bg-card text-lg grid place-items-center hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-60"
            aria-label={`Registrar humor ${m.label}`}
            title={`Humor: ${m.label}`}
          >
            {m.emoji}
          </button>
        ))}
        {showMood && (showMeal || showExpense || showWorkout) && (
          <span className="shrink-0 w-px bg-border my-1.5" aria-hidden />
        )}
        {showMeal && (
          <Link
            to="/app/alimentacao"
            className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all"
          >
            <Camera className="w-3.5 h-3.5" style={{ color: "hsl(var(--alimentacao))" }} /> Refeição
          </Link>
        )}
        {showExpense && <QuickExpense disabled={!!savingKey} />}
        {showWorkout && (
          <Link
            to="/app/vitalidade"
            className="shrink-0 h-11 px-3 rounded-full border bg-card text-xs font-medium flex items-center gap-1.5 hover:bg-muted/60 active:scale-95 transition-all"
          >
            <Dumbbell className="w-3.5 h-3.5" style={{ color: "hsl(var(--vitalidade))" }} /> Treino
          </Link>
        )}
      </div>
    </div>
  );
}
