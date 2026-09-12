import { supabase } from "@/integrations/supabase/client";
import { todayISO } from "@/lib/format";
import { localDay } from "@/lib/localDays";
import { isPlausibleBodyWeightKg, BODY_WEIGHT_RANGE_LABEL } from "@/lib/bodyWeight";
import { existingRecordKeys, isDuplicateError } from "@/lib/dataSources";

/** Evento PROPOSTO pela IA (capture / ai-chat). Só vira registro após o usuário confirmar. */
export interface ProposedEvent {
  kind: string;
  pillar: string;
  summary: string;
  amount?: number;
  tx_kind?: "income" | "expense";
  category?: string;
  hours?: number;
  description?: string;
  meal_type?: string;
  duration_min?: number;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  muscles?: string[];
  ml?: number;
  kg?: number;
  mood_label?: string;
  mood_score?: number;
  /** sleep: a pessoa disse que seguiu a rotina declarada ("dormi no horário"). */
  followed_schedule?: boolean;
  /** Instante REAL do registro, com fuso ("2022-08-03T08:15:39-03:00").
   *  Ausente = agora, que é o caso de tudo que vem da captura por texto.
   *  A importação de CSV histórico depende disto: sem a data verdadeira, 555
   *  noites de sono cairiam todas no dia de hoje. */
  occurred_at?: string;
  /** Chave estável do registro dentro da FONTE que o trouxe
   *  ("sleep|2022-08-03"). Só a importação preenche: é o par
   *  (data_source_id, source_record_key) que o índice único de life_events
   *  usa para reimportar sem duplicar. Quem vem da captura por texto não tem
   *  arquivo nenhum, e fica sem chave mesmo. */
  record_key?: string;
}

/** Contexto opcional da rotina de sono (para preencher horas quando a
 *  pessoa só disse "segui minha rotina"). Vem do perfil, via lib/sleep. */
export interface SleepScheduleCtx {
  hours: number;
  bedtime?: string;
  waketime?: string;
}

/* ── O que a gravação RECUSOU, em linguagem de usuário ───────────────────────
   As duas funções abaixo são puras e existem porque o `buildEventPayload`
   descarta valor em silêncio, e o toast de sucesso não sabe disso. A regra da
   casa (buildReceiptSummary, em dataSourcesPure) é a mesma aqui: o que não
   entrou tem de ser dito, e dito sem adivinhar a causa. */

/** Faixa que o payload exige para aceitar cada número. Mora ao lado da frase
 *  de propósito: o que o payload recusa é exatamente o que a pessoa precisa
 *  ouvir que não entrou, e separar as duas coisas em arquivos diferentes é
 *  como elas se desencontram na próxima mudança de faixa. */
const VALUE_RULES: {
  field: "kg" | "calories" | "protein_g" | "carbs_g" | "fat_g" | "duration_min" | "ml" | "mood_score";
  label: string;
  unit: string;
  accepts: (v: number) => boolean;
  range: string;
}[] = [
  /* A faixa de peso vem de lib/bodyWeight, e o RÓTULO vem de lá também: a
     mensagem antiga era uma string solta que dizia "de 20 a 400 kg" enquanto o
     código recusava exatamente 20 e 400 — o app negava citando uma faixa que
     promete aceitar o valor. Fronteiras INCLUSIVAS, e agora o parser da
     importação e esta gravação concordam valor por valor. */
  { field: "kg", label: "o peso", unit: "kg", accepts: isPlausibleBodyWeightKg, range: BODY_WEIGHT_RANGE_LABEL },
  { field: "calories", label: "as calorias", unit: "kcal", accepts: (v) => v > 0, range: "acima de zero" },
  { field: "protein_g", label: "a proteína", unit: "g", accepts: (v) => v > 0, range: "acima de zero" },
  { field: "carbs_g", label: "os carboidratos", unit: "g", accepts: (v) => v > 0, range: "acima de zero" },
  { field: "fat_g", label: "a gordura", unit: "g", accepts: (v) => v > 0, range: "acima de zero" },
  { field: "duration_min", label: "a duração", unit: "min", accepts: (v) => v > 0, range: "acima de zero" },
  { field: "ml", label: "a quantidade de água", unit: "ml", accepts: (v) => v > 0, range: "acima de zero" },
  { field: "mood_score", label: "a nota do humor", unit: "", accepts: (v) => v >= 1, range: "de 1 a 5" },
];

/**
 * Valores que a proposta trazia e o payload NÃO aceitou — uma frase por
 * valor, pronta para a tela.
 *
 * O caso que originou isto: "me pesei: 18kg" (criança, ou 81 digitado ao
 * contrário). O evento de peso era gravado, o toast dizia registrado, o XP era
 * concedido — e o gráfico de peso não se movia, sem nada explicando por quê.
 * A faixa em si está certa e continua valendo; o que faltava era a pessoa
 * saber que o número dela ficou fora dela.
 */
interface DiscardedValue {
  label: string;
  /** O número como a pessoa o disse, já com unidade ("18 kg"). */
  shown: string;
  range: string;
}

/** As partes estruturadas, para a frase de AVISO e a de RECUSA saírem da
 *  mesma fonte — foi a duplicação de regra em dois lugares que produziu a
 *  fronteira de peso divergente (ver lib/bodyWeight). */
function discardedValues(ev: ProposedEvent): DiscardedValue[] {
  const out: DiscardedValue[] = [];
  for (const rule of VALUE_RULES) {
    const raw = ev[rule.field];
    // `undefined` é "a proposta não trouxe este valor", que não é recusa.
    if (typeof raw !== "number" || Number.isNaN(raw)) continue;
    if (rule.accepts(raw)) continue;
    out.push({
      label: rule.label,
      shown: String(raw).replace(".", ",") + (rule.unit ? ` ${rule.unit}` : ""),
      range: rule.range,
    });
  }
  return out;
}

export function discardedValueWarnings(ev: ProposedEvent): string[] {
  return discardedValues(ev).map(
    (d) => `Não registrei ${d.label}: ${d.shown} está fora do que eu aceito (${d.range}).`,
  );
}

/**
 * O registro tem substância PRÓPRIA, ou o valor recusado era tudo que ele
 * tinha?
 *
 * É a pergunta que decide entre gravar sem o campo e não gravar nada, e ela é
 * respondida pelo PAYLOAD, não por uma lista de `kind`. Uma lista
 * ("weight e water são só o número") seria escrita hoje e ficaria errada na
 * primeira vez que alguém acrescentasse um campo a um tipo de evento — e o
 * erro voltaria calado, que é exatamente a falha que este arquivo já teve três
 * vezes.
 *
 * `summary` não conta como substância: é a frase que a IA montou a partir do
 * número, não um dado. Uma pesagem sem `kg` é uma linha na história da pessoa
 * que não diz nada sobre o corpo dela.
 */
export function eventHasOwnSubstance(
  ev: ProposedEvent, sleepSchedule?: SleepScheduleCtx | null,
): boolean {
  const payload = buildEventPayload(ev, sleepSchedule);
  return Object.keys(payload).some((k) => k !== "summary");
}

/**
 * Recusa de um registro cujo ÚNICO dado foi rejeitado — um aviso só, e nada
 * gravado.
 *
 * O bug que isto fecha (Sentinela): proposta `{kind:'weight', kg:18}` gerava
 * DOIS toasts ao mesmo tempo — "Não registrei o peso: 18 kg está fora do que
 * eu aceito" e, na linha seguinte, "Peso: 18 kg · +3 XP" —, com o XP subindo
 * de verdade (706 → 709) e o peso não aparecendo em Corpo. O app avisava que
 * não registrou e cobrava XP pelo registro na mesma respiração.
 *
 * A régua é a mesma já aplicada à transação sem valor: se o dado não pode ser
 * gravado, a pessoa recebe o motivo e ZERO XP.
 */
function onlyValueRefusal(ev: ProposedEvent, discarded: DiscardedValue[]): string {
  const d = discarded[0];
  return `Não registrei "${ev.summary}": ${d.shown} está fora do que eu aceito `
    + `(${d.range}), e era o único dado desse registro. Confira o número e eu registro.`;
}

/**
 * Por que esta proposta de lançamento financeiro foi RECUSADA — ou `null`
 * quando ela está de pé.
 *
 * DECISÃO DE COMPORTAMENTO (mudou: antes GRAVAVA, agora recusa).
 *
 * A guarda antiga era `ev.kind === "transaction" && ev.amount && ev.amount > 0`
 * e, falhando qualquer parte, a proposta caía no `else` e era inserida em
 * `life_events` com `kind: "transaction"`. O resultado era um evento fantasma:
 * aparecia na linha do tempo como lançamento, pagava XP de `transaction`, e
 * Prosperidade nunca via valor nenhum — o mês não se movia. Um "registrei" que
 * não aconteceu do lado que a pessoa foi conferir.
 *
 * POR QUE RECUSAR E NÃO LANÇAR ERRO: os dois pontos de chamada
 * (CaptureBar.tsx:159 e Chat.tsx:339) capturam com `catch { toast.error("Não
 * consegui salvar. Tente de novo.") }`, que descarta a mensagem. Lançar
 * transformaria uma recusa PERMANENTE e explicável ("não vi valor nenhum") num
 * convite a tentar de novo — instrução que não pode funcionar, porque tentar
 * de novo produz a mesma proposta sem valor. Então a proposta não é gravada, o
 * motivo volta em `warnings`, e as outras propostas do mesmo lote seguem
 * normalmente. Onde a tela precisa passar a exibir esse aviso está listado no
 * relatório desta correção.
 */
export function transactionRefusal(ev: ProposedEvent): string | null {
  if (ev.kind !== "transaction") return null;
  const amount = typeof ev.amount === "number" ? ev.amount : Number(ev.amount ?? NaN);
  if (Number.isFinite(amount) && amount > 0) return null;
  return `Não registrei "${ev.summary}": um lançamento financeiro precisa de um valor `
    + "maior que zero, e não encontrei nenhum. Diga o valor e eu registro.";
}

/* ── A DATA QUE A IA DEVOLVE NÃO É CONFIÁVEL ─────────────────────────────────

   Bug reproduzido em PRODUÇÃO (02/09/2026) e provado no banco: "ontem gastei
   22 no posto de gasolina" gravou `transactions.occurred_at = '2024-12-20'`.
   Não foi um dia de diferença — foram 621. Outras quatro reproduções deram
   '2024-12-18', '2024-12-27', '2024-12-28' e '2025-07-13', e o sono da mesma
   frase caiu no mesmo dia errado. O controle fecha o diagnóstico: frase SEM
   data ("gastei 32 no mercado") gravou 2026-09-02, correto.

   O padrão dessas datas é o de um modelo resolvendo "ontem" contra o "hoje"
   que ELE acha que é — não contra o nosso. A linha existia, o gatilho pagava
   XP, e Prosperidade — que navega por mês — nunca mostrava nada. Perda
   silenciosa com recibo de sucesso, o pior defeito que este produto pode ter.

   A CAUSA RAIZ é a função `capture` mandar uma data que ninguém confere. Mas
   a DEFESA mora aqui, e é aqui que ela tem de morar: esta camada é a última
   antes do banco, e nenhuma data vinda de modelo pode ser escrita sem passar
   por uma checagem de plausibilidade. Consertar só o prompt lá deixaria o
   próximo modelo livre para errar de novo, em silêncio.

   Regra inegociável desta correção: se a data não dá para escrever, NADA é
   gravado, a pessoa recebe o motivo, e nenhum XP é creditado. */

/** Carimbo que a IA manda hoje: só a data, sem hora ("2024-12-20"). */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Quantos dias no passado uma captura por TEXTO pode alcançar.
 *
 * Captura por texto é sobre vida recente: "ontem", "anteontem", "semana
 * passada", "no mês passado". Histórico velho de verdade entra por importação
 * de arquivo, que tem caminho próprio e cuja data vem do arquivo, não de um
 * modelo — e por isso `saveImportedEvents` NÃO passa por esta checagem (o
 * export de sono de 2023 na conta de teste é legítimo).
 *
 * Um ano e pouco é folgado para qualquer frase que alguém diga de passagem, e
 * é justamente a faixa em que o erro do modelo começa a aparecer.
 */
export const CAPTURE_MAX_PAST_DAYS = 370;

/** Dias de `a` até `b`, os dois "YYYY-MM-DD". Positivo = `a` está no passado. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * NÃO é união discriminada (`{ ok: true } | { ok: false }`), e isso é
 * deliberado: este projeto compila com `strictNullChecks: false`
 * (tsconfig.json), e sob essa flag o TypeScript NÃO estreita a união pela
 * verdade do discriminante — `if (!check.ok)` deixa `check` como a união
 * inteira e `check.reason` não compila. Verificado, não suposto.
 *
 * Então a recusa é um CAMPO, não um ramo de tipo: quem chama testa `reason`.
 */
export interface CaptureDateCheck {
  /** Motivo da recusa em linguagem de usuário, ou `null` quando a data está
   *  de pé. É o campo que decide: com `reason`, nada é gravado. */
  reason: string | null;
  /** "YYYY-MM-DD" no fuso do app — o que vai para a coluna `date`.
   *  Só tem valor quando `reason` é `null`. */
  dateISO: string | null;
  /** Instante para a coluna `timestamptz`, ou `null` para o banco usar
   *  `now()` (caso de quem não mandou carimbo nenhum). */
  instant: string | null;
}

const dateOk = (dateISO: string, instant: string | null): CaptureDateCheck =>
  ({ reason: null, dateISO, instant });
const dateBad = (reason: string): CaptureDateCheck =>
  ({ reason, dateISO: null, instant: null });

/**
 * A data desta proposta dá para escrever?
 *
 * `today` entra como parâmetro (nenhuma leitura de relógio aqui) para o teste
 * poder fixar o dia — mesma disciplina de `lib/insights.ts`.
 *
 * Duas normalizações, além da recusa:
 *
 * • CARIMBO SÓ COM A DATA vira meio-dia com offset explícito. Mandar
 *   "2026-09-01" cru para uma coluna `timestamptz` dá meia-noite UTC, que em
 *   São Paulo é 21:00 do DIA ANTERIOR — o sono de "ontem" nasceria anteontem.
 *   Meio-dia é longe das duas fronteiras e sobrevive a qualquer offset.
 * • CARIMBO COM HORA é respeitado como veio, e o dia sai dele pelo fuso do
 *   app (nunca por `slice(0, 10)`, que devolve o dia UTC).
 */
export function checkCaptureDate(
  occurredAt: string | undefined, today: string,
): CaptureDateCheck {
  // Sem carimbo é "agora", e agora é sempre plausível.
  if (!occurredAt) return dateOk(today, null);

  const dateOnly = DATE_ONLY.test(occurredAt);
  const dateISO = dateOnly ? occurredAt : localDay(occurredAt);
  if (!dateISO) {
    return dateBad("não consegui entender a data desse registro");
  }

  const diasAtras = daysBetween(dateISO, today);
  if (diasAtras < 0) {
    return dateBad(`a data que entendi (${dateISO}) está no futuro`);
  }
  if (diasAtras > CAPTURE_MAX_PAST_DAYS) {
    return dateBad(`a data que entendi (${dateISO}) está ${diasAtras} dias no passado`);
  }

  // O offset fixo é seguro por causa do meio-dia: mesmo que o fuso mude, o
  // instante continua caindo no dia pretendido.
  return dateOk(dateISO, dateOnly ? `${dateISO}T12:00:00-03:00` : occurredAt);
}

/** Frase pronta para a tela quando a data inviabiliza o registro. */
function dateRefusal(ev: ProposedEvent, reason: string): string {
  return `Não registrei "${ev.summary}": ${reason}, então não dava para gravar no dia `
    + "certo. Diga a data (ou \"hoje\") e eu registro.";
}

/** O que a gravação da captura fez — e o que ela recusou. */
export interface CaptureSaveResult {
  /** Propostas efetivamente gravadas. */
  saved: number;
  /** As propostas que REALMENTE entraram. É sobre esta lista que o XP do
   *  toast tem de ser somado — somar sobre o que estava selecionado anuncia
   *  pontos que o banco não creditou. */
  savedEvents: ProposedEvent[];
  /** Frases prontas para a tela: propostas recusadas e valores descartados.
   *  Vazio no caminho feliz. */
  warnings: string[];
}

/**
 * Grava os eventos confirmados pelo usuário. Lança erro se algum insert
 * falhar. Devolve o que entrou e o que foi recusado.
 *
 * `today` é injetável só para teste; em produção é o dia em São Paulo.
 */
export async function saveProposedEvents(
  userId: string, events: ProposedEvent[], sleepSchedule?: SleepScheduleCtx | null,
  today: string = todayISO(),
): Promise<CaptureSaveResult> {
  const warnings: string[] = [];
  const savedEvents: ProposedEvent[] = [];

  for (const ev of events) {
    const refusal = transactionRefusal(ev);
    if (refusal) { warnings.push(refusal); continue; }

    // O dia da proposta é escrito COMO VEIO. A resolução semântica (inclusive a
    // regra do sono) acontece na extração, antes do cartão: a pessoa confirma
    // exatamente o que vai para o banco (POSICIONAMENTO H.4). Aqui só mora a
    // checagem de PLAUSIBILIDADE, que é outra coisa — ver o bloco acima.
    const date = checkCaptureDate(ev.occurred_at, today);
    if (date.reason) { warnings.push(dateRefusal(ev, date.reason)); continue; }

    if (ev.kind === "transaction") {
      // Transações vão para a tabela própria (o banco cria o evento na linha do tempo)
      const { error } = await supabase.from("transactions").insert({
        user_id: userId,
        kind: ev.tx_kind ?? "expense",
        amount: ev.amount,
        category: ev.category ?? "Outros",
        description: ev.description ?? ev.summary,
        occurred_at: date.dateISO,
        source: "capture",
      });
      if (error) throw error;
      savedEvents.push(ev);
      continue;
    }

    /* VALOR RECUSADO: grava sem o campo, ou não grava nada?
       Depende de o registro ter substância além do número recusado.
       • Pesagem de 18 kg → sobra só o resumo: NÃO grava, um aviso só, zero XP.
       • Refeição com caloria absurda mas com descrição → grava sem a caloria,
         porque a refeição em si aconteceu e a pessoa a relatou.
       Ver `eventHasOwnSubstance` para por que a pergunta é feita ao payload e
       não a uma lista de `kind`. */
    const discarded = discardedValues(ev);
    if (discarded.length && !eventHasOwnSubstance(ev, sleepSchedule)) {
      warnings.push(onlyValueRefusal(ev, discarded));
      continue;
    }
    warnings.push(...discardedValueWarnings(ev));

    const { error } = await supabase.from("life_events").insert(
      lifeEventRow(
        userId,
        // A data normalizada substitui o carimbo cru: é ela que faz o evento
        // nascer no dia que a pessoa falou. `undefined` deixa o banco usar now().
        { ...ev, occurred_at: date.instant ?? undefined },
        "chat_capture", sleepSchedule,
      ),
    );
    if (error) throw error;
    savedEvents.push(ev);
  }

  return { saved: savedEvents.length, savedEvents, warnings };
}

/** Monta o payload de um life_event. Fonte única de verdade, compartilhada
 *  pelo insert unitário da captura e pelo insert em lote da importação. */
function buildEventPayload(ev: ProposedEvent, sleepSchedule?: SleepScheduleCtx | null) {
  const payload: Record<string, unknown> = {};
  if (ev.hours) payload.hours = ev.hours;
  // "Segui minha rotina de sono": a IA não sabe as horas — o app preenche
  // com a duração da rotina declarada no perfil (Feature A).
  if (ev.kind === "sleep" && typeof ev.followed_schedule === "boolean") {
    payload.followed_schedule = ev.followed_schedule;
    if (!ev.hours && ev.followed_schedule && sleepSchedule?.hours) {
      payload.hours = sleepSchedule.hours;
      if (sleepSchedule.bedtime) payload.bedtime = sleepSchedule.bedtime;
      if (sleepSchedule.waketime) payload.waketime = sleepSchedule.waketime;
    }
  }
  if (ev.description) payload.description = ev.description;
  if (ev.muscles?.length) payload.muscles = ev.muscles;
  if (ev.meal_type) payload.meal_type = ev.meal_type;
  if (ev.calories && ev.calories > 0) payload.calories = Math.round(ev.calories);
  if (ev.protein_g && ev.protein_g > 0) payload.protein_g = Math.round(ev.protein_g);
  if (ev.carbs_g && ev.carbs_g > 0) payload.carbs_g = Math.round(ev.carbs_g);
  if (ev.fat_g && ev.fat_g > 0) payload.fat_g = Math.round(ev.fat_g);
  if (ev.duration_min && ev.duration_min > 0) payload.duration_min = Math.round(ev.duration_min);
  if (ev.ml && ev.ml > 0) payload.ml = Math.round(ev.ml);
  /* A MESMA regra do aviso (VALUE_RULES), pela MESMA função. Esta linha é a
     que de fato descarta o valor; se ela e o aviso discordarem, volta a existir
     peso que desaparece sem ninguém dizer por quê. */
  if (isPlausibleBodyWeightKg(ev.kg)) payload.kg = ev.kg;
  if (ev.mood_label) payload.label = ev.mood_label;
  if (ev.mood_score) payload.score = ev.mood_score;
  if (ev.kind === "gratitude" && ev.description) payload.text = ev.description;
  payload.summary = ev.summary;
  return payload;
}

/** Linha pronta para insert em `life_events`. Ponto ÚNICO de montagem: a
 *  captura unitária e a importação em lote passam as duas por aqui.
 *
 *  `dataSourceId` é o ARQUIVO de onde o registro veio (data_sources), e não
 *  se confunde com as colunas `source_table`/`source_id` da tabela, que
 *  apontam o REGISTRO de origem de eventos derivados (a transação que gerou
 *  o evento). Nomes diferentes, conceitos diferentes. */
export function lifeEventRow(
  userId: string, ev: ProposedEvent, source: string,
  sleepSchedule?: SleepScheduleCtx | null, dataSourceId?: string | null,
) {
  return {
    user_id: userId,
    pillar: ev.pillar,
    kind: ev.kind,
    payload: buildEventPayload(ev, sleepSchedule),
    source,
    // Só enviamos quando existe: sem a chave, o banco usa `now()`.
    ...(ev.occurred_at ? { occurred_at: ev.occurred_at } : {}),
    // A fonte entra mesmo sem chave de registro (a trilha "veio deste
    // arquivo" vale por si); a chave, essa só faz sentido com a fonte, que é
    // como o índice único parcial do banco a enxerga.
    ...(dataSourceId ? { data_source_id: dataSourceId } : {}),
    ...(dataSourceId && ev.record_key ? { source_record_key: ev.record_key } : {}),
  };
}

/** Resultado de uma importação em lote — vira o recibo (import_receipts). */
export interface ImportSaveResult {
  /** Eventos elegíveis recebidos (transações não entram por aqui). */
  total: number;
  /** Gravados agora. */
  accepted: number;
  /** Ignorados por já terem vindo desta mesma fonte antes. */
  duplicates: number;
}

/**
 * Grava eventos IMPORTADOS de arquivo, em lote.
 *
 * Diferente de `saveProposedEvents`, que insere um por vez porque a captura
 * propõe dois ou três: aqui são centenas, e 555 requisições sequenciais
 * levariam minutos. Cada pedaço é UM insert com N linhas, e `onProgress`
 * alimenta a barra para a espera ser legível.
 *
 * `source: "import"` distingue estes registros dos feitos à mão — é por ele
 * que o backend pode isentá-los de XP (importar não é viver).
 *
 * IDEMPOTÊNCIA: com `dataSourceId`, reimportar o mesmo arquivo não cria nada
 * de novo e não falha — o que já estava lá é CONTADO como duplicata e vai
 * para o recibo. Uma linha repetida nunca derruba a importação inteira.
 */
export async function saveImportedEvents(
  userId: string,
  events: ProposedEvent[],
  onProgress?: (done: number, total: number) => void,
  opts: { dataSourceId?: string | null; chunkSize?: number } = {},
): Promise<ImportSaveResult> {
  const { dataSourceId = null, chunkSize = 100 } = opts;

  // Importação de arquivo não cria lançamento financeiro — esse caminho tem
  // tela própria (Importar fatura, em Prosperidade).
  const candidates = events.filter((ev) => ev.kind !== "transaction");
  const total = candidates.length;
  let duplicates = 0;
  let accepted = 0;

  let pending = candidates;
  if (dataSourceId) {
    const already = await existingRecordKeys("life_events", userId, dataSourceId);
    if (already.size) {
      pending = candidates.filter((ev) => {
        if (ev.record_key && already.has(ev.record_key)) { duplicates++; return false; }
        return true;
      });
    }
  }

  const rows = pending.map((ev) => lifeEventRow(userId, ev, "import", null, dataSourceId));

  /* Tudo era duplicata: não há lote a percorrer, o laço abaixo não roda e
     `onProgress` nunca era chamado — a barra ficava parada em 0% até a
     importação "terminar", que é a leitura oposta do que aconteceu (não faltou
     gravar nada; não havia nada a gravar).

     (1, 1) e não (0, 0) de propósito: o chamador calcula `done / total` para a
     barra (HealthImport.tsx:174), e um total zero produziria NaN na tela. */
  if (!rows.length) onProgress?.(1, 1);

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from("life_events").insert(chunk);
    if (error) {
      if (!isDuplicateError(error)) throw error;
      // O insert do lote é uma transação só: uma duplicata derruba as 100.
      // Reenviamos linha a linha para separar o que entra do que já existia
      // (acontece quando a mesma importação roda duas vezes em paralelo, ou
      // quando a consulta de chaves acima falhou).
      for (const row of chunk) {
        const { error: rowErr } = await supabase.from("life_events").insert(row);
        if (!rowErr) { accepted++; continue; }
        if (isDuplicateError(rowErr)) { duplicates++; continue; }
        throw rowErr;
      }
    } else {
      accepted += chunk.length;
    }
    onProgress?.(Math.min(i + chunkSize, rows.length), rows.length);
  }

  return { total, accepted, duplicates };
}
