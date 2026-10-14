// Blueprint da Subida — matemática local e tipos (Emenda 4).
// A parte que NÃO precisa de IA vive aqui: TMB (Mifflin-St Jeor) e gasto
// energético estimado, calculados no navegador enquanto a pessoa responde —
// é o "cada resposta muda algo que você VÊ na hora" da emenda. Também é o
// fallback honesto quando a função de IA estiver indisponível: o onboarding
// nunca quebra por dependência de IA.

export interface BodyInput {
  birthYear?: number | null;
  sex?: string | null;          // "feminino" | "masculino" | null
  heightCm?: number | null;
  weightKg?: number | null;
}

/** TMB por Mifflin-St Jeor. null se faltar dado essencial. */
export function tmbMifflin({ birthYear, sex, heightCm, weightKg }: BodyInput): number | null {
  const year = new Date().getFullYear();
  const age = birthYear && birthYear > 1900 ? year - birthYear : null;
  if (!age || !heightCm || !weightKg || heightCm < 80 || weightKg < 20) return null;
  // Sexo não informado: média entre as duas fórmulas (premissa declarada).
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === "masculino") return Math.round(base + 5);
  if (sex === "feminino") return Math.round(base - 161);
  return Math.round(base - 78);
}

const ACTIVITY_FACTOR: Record<string, number> = {
  sedentario: 1.2, leve: 1.375, moderado: 1.55, intenso: 1.725,
};

/** Gasto diário estimado (TDEE): TMB × fator de atividade. */
export function tdee(tmb: number | null, activityLevel?: string | null): number | null {
  if (!tmb) return null;
  const f = ACTIVITY_FACTOR[activityLevel ?? ""] ?? 1.3; // sem nível: fator conservador
  return Math.round(tmb * f);
}

/** Faixa calórica exibida no retrato ("~1.900–2.300 kcal/dia"). */
export function kcalRangeLabel(tdeeKcal: number | null): string | null {
  if (!tdeeKcal) return null;
  const lo = Math.round((tdeeKcal * 0.92) / 50) * 50;
  const hi = Math.round((tdeeKcal * 1.08) / 50) * 50;
  return `~${lo.toLocaleString("pt-BR")}–${hi.toLocaleString("pt-BR")} kcal/dia`;
}

/* ── Contrato da função onboarding-blueprint ───────────────────────────── */

export interface BlueprintHabit { name: string; pillar: string; why?: string | null }

/** Um plano do blueprint (uma área). Cada um vira uma linha própria em
 *  "Meus planos" — o blueprint nunca entrega um plano composto disfarçado. */
export interface BlueprintPlan {
  kind: "alimentar" | "treino" | "financeiro" | "rotina";
  pillar: string | null;
  title: string;
  content_markdown: string;
}

export interface BlueprintProposal {
  /** Apresentação do conjunto (o fio que liga os planos). */
  overview: string;
  /** Planos SEPARADOS, um por área. */
  plans: BlueprintPlan[];
  daily_calories_kcal: number | null;
  daily_protein_g: number | null;
  weekly_workouts: number | null;
  sleep_hours_target: number | null;
  daily_spend_limit: number | null;
  water_goal_ml: number | null;
  habits: BlueprintHabit[];
  /** Blocos pulados viram premissas declaradas (vocabulário do Conselheiro). */
  assumptions: string[];
}

/** Rótulo e pilar visual de cada tipo de plano do blueprint. */
export const PLAN_KIND_META: Record<string, { label: string; colorVar: string }> = {
  // Alimentar e treino compartilham a cor porque compartilham o pilar desde a
  // fusão de 17/09/2026. A cor nunca foi o que distinguia estes dois cartões:
  // o rótulo e o ícone já fazem isso, e em "Meus planos" cada um tem seção
  // própria com título.
  alimentar: { label: "Alimentação", colorVar: "--vitalidade" },
  treino: { label: "Treino", colorVar: "--vitalidade" },
  financeiro: { label: "Financeiro", colorVar: "--prosperidade" },
  rotina: { label: "Rotina", colorVar: "--mente" },
};
/* ═══════════════════════════════════════════════════════════════════════════
   O BLUEPRINT QUE NÃO SE PERDE AO RECARREGAR
   ═══════════════════════════════════════════════════════════════════════════

   O defeito que isto conserta: a função reivindicava a cortesia ANTES de
   chamar o modelo e devolvia a proposta só no corpo da resposta, que o
   Onboarding guardava em `useState`. Recarregar a página (ou o iPhone matar a
   aba em segundo plano) depois de gerar = proposta perdida, cortesia gasta, e
   a função respondendo `409 already` para sempre. A pessoa perdia a única
   vez em que a IA escreve um plano sobre a vida dela — de graça.

   Agora a proposta mora no banco (`blueprint_proposals`, uma linha por
   pessoa), e a tela só LÊ. Tudo que é decisão sobre essa linha — o que ela
   significa, que escolhas valem, o que a ativação aplicou — fica aqui, em
   funções puras com teste. A tela só desenha.

   Contrato: scratchpad/blueprint/PLANO.md. Valores que vêm do servidor são
   tratados como NÃO CONFIÁVEIS na forma (jsonb aceita qualquer coisa): nada
   aqui confia num campo sem conferir o tipo dele. */

/** As escolhas da pessoa sobre a proposta — o que ela marcou e desmarcou. */
export interface BlueprintChoices {
  plans: boolean[];
  habits: boolean[];
  goals: boolean;
}

/** O que a ativação aplicou, como o servidor devolve em `activation_result`.
 *  Os planos vêm por TIPO (`kind`); o rótulo é decisão da tela. */
export interface ActivationResult {
  plansActivated: string[];
  plansArchived: string[];
  goals: string[];
  habits: number;
  /** A ativação já tinha acontecido: a chamada não gravou nada de novo. */
  already: boolean;
}

/** O que a tela deve fazer com a proposta guardada. */
export type Retomada =
  | { kind: "nenhuma" }
  | { kind: "gerando" }
  | {
      kind: "pronta";
      proposal: BlueprintProposal;
      choices: BlueprintChoices;
      /** As escolhas vieram do banco tal como estavam (true), ou foram
       *  completadas aqui porque faltava algo (false) — aí a tela salva. */
      escolhasIntactas: boolean;
    }
  | { kind: "ativada"; proposal: BlueprintProposal | null; result: ActivationResult }
  | { kind: "invalida"; motivo: string };

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === "string");

/**
 * A proposta tem a forma mínima para ser desenhada?
 *
 * Não revalida o que a função já validou ao gerar — confere só o que a TELA
 * usa sem perguntar. Uma linha que não passa aqui não é desenhada pela
 * metade: vira `invalida`, e a falha de recuperação é registrada.
 */
export function isBlueprintProposal(x: unknown): x is BlueprintProposal {
  if (!isObj(x)) return false;
  if (!Array.isArray(x.plans) || x.plans.length === 0) return false;
  const planosOk = x.plans.every((p) =>
    isObj(p) && typeof p.kind === "string" && typeof p.title === "string" &&
    typeof p.content_markdown === "string");
  const habitosOk = Array.isArray(x.habits) &&
    x.habits.every((h) => isObj(h) && typeof h.name === "string" && typeof h.pillar === "string");
  return planosOk && habitosOk && isStrArr(x.assumptions ?? []) &&
    (x.overview === undefined || typeof x.overview === "string");
}

/**
 * As escolhas de partida, as mesmas de antes desta mudança: planos marcados
 * só até a cota de planos ativos, hábitos todos, metas sim.
 *
 * Marcadas só as que cabem ativas. As outras continuam ali, para marcar — e
 * o que passar da cota é GUARDADO pela ativação, não perdido.
 */
export function defaultChoices(p: BlueprintProposal, maxActivePlans: number): BlueprintChoices {
  const cota = Math.max(1, Math.floor(Number(maxActivePlans) || 1));
  return {
    plans: p.plans.map((_, i) => i < cota),
    habits: p.habits.map(() => true),
    goals: true,
  };
}

/**
 * Escolhas vindas do banco, conferidas contra a proposta.
 *
 * Cada posição só é aceita se for booleana E existir na proposta; o que faltar
 * vem das escolhas de partida. Assim uma escolha salva por uma versão antiga,
 * ou um `{}` de linha recém-criada, nunca desenha uma caixa sem estado nem
 * marca um plano que não existe.
 */
export function normalizeChoices(
  raw: unknown, p: BlueprintProposal, maxActivePlans: number,
): { choices: BlueprintChoices; intactas: boolean } {
  const base = defaultChoices(p, maxActivePlans);
  const r = isObj(raw) ? raw : {};
  let intactas = true;
  const lista = (v: unknown, padrao: boolean[]) => {
    if (!Array.isArray(v) || v.length !== padrao.length) intactas = false;
    return padrao.map((d, i) => {
      const x = Array.isArray(v) ? v[i] : undefined;
      if (typeof x === "boolean") return x;
      intactas = false;
      return d;
    });
  };
  const plans = lista(r.plans, base.plans);
  const habits = lista(r.habits, base.habits);
  const goals = typeof r.goals === "boolean" ? r.goals : (intactas = false, base.goals);
  return { choices: { plans, habits, goals }, intactas };
}

/** `activation_result` do servidor, conferido campo a campo. */
export function parseActivationResult(raw: unknown): ActivationResult {
  const r = isObj(raw) ? raw : {};
  return {
    plansActivated: isStrArr(r.plans_activated) ? r.plans_activated : [],
    plansArchived: isStrArr(r.plans_archived) ? r.plans_archived : [],
    goals: isStrArr(r.goals) ? r.goals : [],
    habits: Math.max(0, Math.floor(Number(r.habits) || 0)),
    already: r.already === true,
  };
}

/**
 * A resposta de `activate_blueprint`, que NÃO levanta erro quando a ativação
 * falha: ela desfaz a tentativa inteira no servidor, grava o evento
 * `activation_failed` lá mesmo e devolve `{ ok: false, error, message,
 * retryable }`. Sucesso (inclusive a repetição, `already`) devolve o
 * `activation_result` com `ok: true`.
 *
 * Um `ok` que não seja exatamente `true` é FALHA — inclusive resposta sem
 * forma nenhuma. Tratar o ausente como sucesso mostraria "Ativado" sobre uma
 * ativação que não aconteceu, que é a mentira mais cara desta tela.
 */
export type ResultadoDaAtivacao =
  | { ok: true; nada: false; result: ActivationResult }
  /** Nada efetivo para aplicar: o servidor NÃO consumiu a proposta — a linha
   *  continua `ready`, sem carimbo. É "agora não", não ativação. */
  | { ok: true; nada: true }
  | { ok: false; podeTentarDeNovo: boolean; codigo: string | null };

export function interpretarAtivacao(data: unknown): ResultadoDaAtivacao {
  if (!isObj(data) || data.ok !== true) {
    const r = isObj(data) ? data : {};
    return {
      ok: false,
      // Na dúvida, dá para tentar: o servidor é idempotente, e uma segunda
      // chamada ou aplica uma vez ou devolve `already`.
      podeTentarDeNovo: r.retryable !== false,
      codigo: typeof r.error === "string" ? r.error : null,
    };
  }
  if (data.nada === true) return { ok: true, nada: true };
  return { ok: true, nada: false, result: parseActivationResult(data) };
}

/** A própria linha de `blueprint_proposals`, lida pela tela ao montar. */
export function retomadaDaLinha(row: unknown, maxActivePlans: number): Retomada {
  if (row === null || row === undefined) return { kind: "nenhuma" };
  if (!isObj(row)) return { kind: "invalida", motivo: "linha_sem_forma" };
  if (row.status === "generating") return { kind: "gerando" };
  if (row.status === "activated") {
    return {
      kind: "ativada",
      proposal: isBlueprintProposal(row.proposal) ? row.proposal : null,
      result: parseActivationResult(row.activation_result),
    };
  }
  if (row.status === "ready") {
    if (!isBlueprintProposal(row.proposal)) return { kind: "invalida", motivo: "proposta_sem_forma" };
    const { choices, intactas } = normalizeChoices(row.choices, row.proposal, maxActivePlans);
    // `choices_updated_at` vazio: ninguém escolheu ainda — o banco tem as
    // escolhas de partida do servidor, que pode não saber a cota da conta.
    // A tela completa com a cota e salva.
    const escolhidas = typeof row.choices_updated_at === "string";
    return { kind: "pronta", proposal: row.proposal, choices, escolhasIntactas: intactas && escolhidas };
  }
  return { kind: "invalida", motivo: "status_desconhecido" };
}

/**
 * A resposta de `onboarding-blueprint` (POST `{}`), no mesmo vocabulário da
 * linha. O 202 de "outra aba está gerando" chega aqui como sucesso (2xx) com
 * `{ status: "generating" }`. Os erros (409 legado, 502 recuperável) são
 * tratados pela tela antes, pelo corpo do erro.
 */
export function retomadaDaResposta(data: unknown, maxActivePlans: number): Retomada {
  if (!isObj(data)) return { kind: "invalida", motivo: "resposta_sem_forma" };
  if (data.status === "generating") return { kind: "gerando" };
  if (data.status === "activated") {
    return {
      kind: "ativada",
      proposal: isBlueprintProposal(data.blueprint) ? data.blueprint : null,
      result: parseActivationResult(data.activation_result),
    };
  }
  if (data.status === "ready" || (data.status === undefined && data.blueprint)) {
    if (!isBlueprintProposal(data.blueprint)) return { kind: "invalida", motivo: "proposta_sem_forma" };
    const { choices, intactas } = normalizeChoices(data.choices, data.blueprint, maxActivePlans);
    // Proposta recém-gerada (`resumed:false`): as escolhas são as de partida
    // do servidor, então a tela confere a cota e salva. Retomada: valem como
    // estão, se estiverem inteiras.
    return {
      kind: "pronta", proposal: data.blueprint, choices,
      escolhasIntactas: intactas && data.resumed === true,
    };
  }
  return { kind: "invalida", motivo: "status_desconhecido" };
}

/* ── As metas ─────────────────────────────────────────────────────────── */

/** As metas que a ativação pode gravar, na mesma lista branca do servidor,
 *  com o campo da proposta de onde vem o valor e o acompanhamento que a
 *  pessoa precisa ter ligado para a meta fazer sentido. */
export const GOAL_SOURCES = [
  { key: "calorie_goal_kcal", field: "daily_calories_kcal", tracker: "meals", label: "calorias" },
  { key: "protein_goal_g", field: "daily_protein_g", tracker: "protein", label: "proteína" },
  { key: "weekly_workouts_goal", field: "weekly_workouts", tracker: "workouts", label: "treinos" },
  { key: "sleep_goal_h", field: "sleep_hours_target", tracker: "sleep", label: "sono" },
  { key: "daily_spend_limit", field: "daily_spend_limit", tracker: "spend_limit", label: "teto de gasto" },
  { key: "water_goal_ml", field: "water_goal_ml", tracker: "water", label: "água" },
] as const;

export type GoalKey = (typeof GOAL_SOURCES)[number]["key"];

/**
 * As chaves de meta que a ativação deve gravar: só as que a proposta tem E
 * cuja área a pessoa ACOMPANHA. Uma meta de água para quem desligou água
 * criaria cobrança invisível.
 *
 * A tela manda só as CHAVES; o VALOR o servidor tira da proposta guardada,
 * nunca do cliente — é isso que impede alguém de gravar "meta de 50.000 kcal"
 * forjando a chamada.
 */
export function goalKeysFor(p: BlueprintProposal, activeTrackers: ReadonlySet<string>): GoalKey[] {
  return GOAL_SOURCES
    .filter((g) => {
      const v = (p as unknown as Record<string, unknown>)[g.field];
      return typeof v === "number" && v > 0 && activeTrackers.has(g.tracker);
    })
    .map((g) => g.key);
}

/* ── Quanto a ativação aplicaria de verdade ──────────────────────────────
   Antes, "Ativar" com tudo desmarcado (ou com "metas" marcado mas nenhuma
   área acompanhada) consumia a proposta: a linha virava `activated` com
   resultado vazio, a retomada sumia e uma segunda ativação devolvia
   `already` sem criar nada. Agora o servidor recusa consumir (`nada:true`)
   e a TELA nem oferece: com zero itens efetivos, o botão principal vira
   "Agora não". "Efetivo" é o que o servidor de fato gravaria — metas contam
   pelas CHAVES que vão na chamada, não pela caixa marcada. */
export function itensEfetivos(
  choices: BlueprintChoices,
  p: BlueprintProposal,
  activeTrackers: ReadonlySet<string>,
): number {
  const marcados = (xs: boolean[]) => xs.filter(Boolean).length;
  return marcados(choices.plans) + marcados(choices.habits)
    + (choices.goals ? goalKeysFor(p, activeTrackers).length : 0);
}

/** A retomada que vale medir (evento `resumed`): a tela pôs na frente da
 *  pessoa uma proposta `ready` LIDA DA LINHA. A resposta da função não conta
 *  — a função já grava o próprio `resumed` no servidor. */
export function contaComoRetomada(r: Retomada): boolean {
  return r.kind === "pronta";
}

const LABEL_DA_META: Record<string, string> =
  Object.fromEntries(GOAL_SOURCES.map((g) => [g.key, g.label]));

/* ── O resumo da ativação ─────────────────────────────────────────────── */

export interface ResumoDaAtivacao {
  planosAtivos: string[];
  planosGuardados: string[];
  metas: string[];
  habitos: number;
  /** A frase do aviso de sucesso — a mesma de antes, agora tirada do que o
   *  SERVIDOR diz que aplicou, e não do que a tela achou que mandou. */
  frase: string;
}

const rotuloDoPlano = (kind: string) => (PLAN_KIND_META[kind]?.label ?? kind).toLowerCase();

export function resumoDaAtivacao(r: ActivationResult): ResumoDaAtivacao {
  const planosAtivos = r.plansActivated.map(rotuloDoPlano);
  const planosGuardados = r.plansArchived.map(rotuloDoPlano);
  const metas = r.goals.map((k) => LABEL_DA_META[k] ?? k);
  const partes: string[] = [];
  if (planosAtivos.length) partes.push(planosAtivos.length === 1 ? "1 plano" : `${planosAtivos.length} planos`);
  // O plano que não coube ativo é dito em voz alta: guardar em silêncio seria
  // a mesma perda de antes, só que sem o erro.
  if (planosGuardados.length) {
    partes.push(planosGuardados.length === 1 ? "1 plano guardado" : `${planosGuardados.length} planos guardados`);
  }
  if (metas.length) partes.push("metas");
  if (r.habits > 0) partes.push(r.habits === 1 ? "1 compromisso" : `${r.habits} compromissos`);
  const frase = partes.length
    ? `Ativado: ${partes.join(", ")}. Tudo isso vive na tela Hoje e em Jornada > Planos.`
    : "Tudo bem — nada foi ativado. O Blueprint continua disponível com o Conselheiro.";
  return { planosAtivos, planosGuardados, metas, habitos: r.habits, frase };
}

/* ── A espera por outra aba ───────────────────────────────────────────── */

/** De quanto em quanto tempo a tela relê a linha enquanto outra aba gera. */
export const ESPERA_ENTRE_LEITURAS_MS = 2_000;
/** Quanto tempo esperar antes de chamar a função de novo. Ela decide: se a
 *  geração da outra aba ainda é recente, responde "gerando" e a espera
 *  continua; se envelheceu (a função morreu no meio), ela reivindica e gera. */
export const TETO_DA_ESPERA_MS = 120_000;

export function proximoPassoDaEspera(esperandoHaMs: number): "reler" | "chamar-a-funcao" {
  return esperandoHaMs >= TETO_DA_ESPERA_MS ? "chamar-a-funcao" : "reler";
}
