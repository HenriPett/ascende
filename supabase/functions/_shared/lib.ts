// Módulo compartilhado das funções do Ascende
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicCall } from "./usage.ts";
import { spParts, spMonthStartUtc, spWeekStartUtc } from "./entitlements.ts";

// Defina o secret APP_ORIGIN para restringir quais sites chamam as funções pelo
// navegador. Aceita várias origens separadas por vírgula (ex.: produção + domínio
// próprio). Barras finais e espaços são normalizados automaticamente — o header
// Origin do navegador nunca tem barra no final. Sem o secret, fica aberto (dev).
const ALLOWED_ORIGINS = (Deno.env.get("APP_ORIGIN") ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const BASE_CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** Headers de CORS para ESTA requisição: reflete a origem se estiver na lista. */
export function corsFor(req: Request): Record<string, string> {
  if (!ALLOWED_ORIGINS.length) return { "Access-Control-Allow-Origin": "*", ...BASE_CORS };
  const origin = (req.headers.get("origin") ?? "").replace(/\/+$/, "");
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { "Access-Control-Allow-Origin": allow, ...BASE_CORS, Vary: "Origin" };
}

// Compatibilidade: headers estáticos (primeira origem da lista) para helpers sem acesso ao req.
export const corsHeaders: Record<string, string> = ALLOWED_ORIGINS.length
  ? { "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0], ...BASE_CORS, Vary: "Origin" }
  : { "Access-Control-Allow-Origin": "*", ...BASE_CORS };

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
/* Mais novo E mais barato que o sonnet-4-6 que estava aqui: US$ 2/US$ 10 por
   MTok contra US$ 3/US$ 15 — 33% a menos em entrada e em saída, sem troca de
   qualidade para baixo. O sonnet-4-6 foi a única mudança de modelo desta
   rodada; o MODEL_FAST continua no Haiku, que segue sendo o mais barato.

   DUAS COISAS QUE VÊM JUNTO COM A TROCA, e que não são opcionais:

   1. O PREÇO PRECISA ENTRAR EM usage.ts NO MESMO COMMIT. A tabela de preços
      de lá tem um fallback, e o fallback é o preço do modelo ANTIGO — trocar
      aqui sem acrescentar a linha lá faz o estimated_cost_usd superestimar em
      50%, em silêncio, para sempre. A telemetria é o que decide as próximas
      otimizações; uma telemetria inflada decide errado.

   2. NO SONNET 5, OMITIR `thinking` LIGA O RACIOCÍNIO ADAPTATIVO — o inverso
      do sonnet-4-6, onde omitir significava não pensar. E token de raciocínio
      conta dentro do max_tokens. As rotas daqui têm teto apertado (o briefing
      tem 400, a análise corporal 700): ligar raciocínio sem mexer nos tetos
      produziria resposta truncada ou vazia. Por isso anthropicCall desliga
      explicitamente — ver a nota longa lá.

   Raciocínio adaptativo e output_config.effort são a PRÓXIMA alavanca, de
   qualidade, e pedem max_tokens maior e um eval antes. Começar pelo Blueprint,
   que roda uma vez na vida e é caro de errar. */
export const MODEL_SMART = "claude-sonnet-5";    // chat e briefing
export const MODEL_FAST = "claude-haiku-4-5";    // extração de eventos (captura)

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

/** Valida o JWT do usuário e retorna o user. Lança erro 401 se inválido. */
export async function requireUser(req: Request, supabase: SupabaseClient) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Response(JSON.stringify({ error: "Não autenticado" }), {
    status: 401, headers: { ...corsFor(req), "Content-Type": "application/json" },
  });
  return data.user;
}

/**
 * Proteção de custo/abuso: no máximo `max` chamadas da função `fn` por usuário
 * na janela de `windowMin` minutos. Estourou, lança 429 com mensagem amigável.
 * Usa a tabela fn_calls (RLS sem policies: só o service role escreve/lê).
 *
 * Endurecido (auditoria, achado 3):
 * • ATÔMICO — contagem e registro acontecem sob advisory lock no banco
 *   (reserve_fn_call), então N requisições simultâneas não passam mais juntas.
 * • FAIL-CLOSED — a versão anterior fazia `if (!error && count >= max)`: erro
 *   de banco liberava a chamada. Agora erro vira 503 e interrompe.
 */
export async function assertRateLimit(
  supabase: SupabaseClient, userId: string, fn: string, max: number, windowMin: number,
) {
  const { data, error } = await supabase.rpc("reserve_fn_call", {
    uid: userId, fn_name: fn, max_calls: max, window_min: windowMin,
  });
  if (error) {
    console.error("assertRateLimit", fn, error.message ?? error);
    throw new Response(JSON.stringify({
      error: "Não consegui validar sua solicitação agora. Tente novamente em instantes.",
      code: "RATE_CHECK_UNAVAILABLE",
    }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (data !== true) {
    throw new Response(JSON.stringify({
      error: "Muitas solicitações em pouco tempo. Respire e tente de novo em alguns minutos.",
    }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

/* ═══ MEMÓRIA CONTROLÁVEL (Fase 2) ═══════════════════════════════════════
   Antes, ai_memories era uma lista plana que só a IA escrevia e ninguém podia
   corrigir: o retrato lia tudo, sem filtro, sem saber o que a pessoa havia
   confirmado ou rejeitado. O contrato da fase separa três coisas que estavam
   juntas: se a memória VALE (status/validade), o quanto ela é CONFIÁVEL
   (confidence) e QUEM a afirmou (created_by).

   REGRA DE LEITURA (única, vale para todo lugar que lê memória):
     status <> 'rejeitada' AND status <> 'expirada'
     AND (valid_until is null OR valid_until > now())

   E memória confirmada PELA PESSOA vale mais que memória inferida pela IA:
   vai na frente do retrato e é marcada como tal, para o modelo não confundir
   o que ela afirmou com o que ele deduziu. */

export interface MemoryRow {
  id: string;
  content: string;
  category: string;
  status?: string | null;
  created_by?: string | null;
  confidence?: number | null;
  valid_until?: string | null;
}

/** A REGRA DE LEITURA, num único lugar testável. Vale para o retrato e para
 *  qualquer outro ponto que leia memória. */
export function isMemoryReadable(m: MemoryRow, now = new Date()): boolean {
  if (m.status === "rejeitada" || m.status === "expirada") return false;
  if (m.valid_until == null) return true;
  const until = new Date(String(m.valid_until)).getTime();
  // Data ilegível não pode esconder memória válida: na dúvida, ela vale.
  if (!Number.isFinite(until)) return true;
  return until > now.getTime();
}

/** Memória confirmada pela pessoa (ou escrita por ela). É intocável para a IA. */
export const isUserOwnedMemory = (m: MemoryRow) =>
  m.status === "confirmada" || m.created_by === "usuario";

/** A view já ordena por trust_rank (confirmada antes de ativa). Isto refina:
 *  memória que a PRÓPRIA PESSOA escreveu (created_by='usuario') é palavra dela
 *  também, mesmo com status 'ativa', e o trust_rank olha só o status. Ordenação
 *  estável, então a ordem da view é preservada dentro de cada grupo. */
const byUserFirst = (rows: MemoryRow[]) => [
  ...rows.filter(isUserOwnedMemory),
  ...rows.filter((m) => !isUserOwnedMemory(m)),
];

/* A migração da Fase 2 (colunas status/created_by/confidence/valid_until) é
   entregue à parte. Enquanto ela não estiver aplicada, o select das colunas
   novas falha — e memória sumindo do retrato seria uma regressão silenciosa
   pior que a ausência do filtro. Então: tenta o formato novo e, se o banco
   ainda não o tiver, cai no antigo. Sai quando a migração estiver em produção. */
const MEMORY_COLS_VIEW = "id,content,category,status,created_by,confidence,valid_until,trust_rank";
const MEMORY_COLS_TABLE = "id,content,category,status,created_by,confidence,valid_until";

async function selectMemories(
  supabase: SupabaseClient, userId: string, limit: number,
): Promise<MemoryRow[]> {
  /* Fonte única: a view ai_memories_vigentes já aplica a REGRA DE LEITURA em
     SQL e traz trust_rank (0 = confirmada pela pessoa, 1 = resto). Reescrever
     o filtro aqui era a duplicação que a view existe para evitar — e deixa o
     `valid_until > now()` no banco, onde não depende de parse de data nem de
     interpolar timestamp na microssintaxe de filtro do PostgREST. */
  const view = await supabase.from("ai_memories_vigentes")
    .select(MEMORY_COLS_VIEW)
    .eq("user_id", userId)
    .order("trust_rank", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!view.error) return (view.data ?? []) as MemoryRow[];

  /* Rede de segurança de UM passo, e só um. A view pode falhar por algo
     transitório, e memória sumindo do retrato é uma regressão real — então
     lemos a tabela aplicando a MESMA regra, duas vezes: no SQL e no filtro
     abaixo (a validade, que sem a view volta a ser decidida aqui).

     O QUE FOI REMOVIDO DAQUI, E POR QUE NUNCA DEVE VOLTAR: havia um terceiro
     nível que lia `id,content,category` — sem status, sem validade, sem filtro
     nenhum. Ele existia para a janela em que a migração da Fase 2 ainda não
     estava em produção. Agora ela está, e o que sobrou era uma porta pela qual
     uma memória REJEITADA voltava para o retrato do Conselheiro, em silêncio,
     com um console.error como único aviso.

     Uma pessoa que abre "Isso não é sobre mim" está dizendo algo sobre a
     própria vida. Ver aquilo de volta na conversa é pior que o Conselheiro não
     ter memória nenhuma: quebra a única promessa que a Fase 2 fez. Se as duas
     leituras falharem, o certo é o retrato sair SEM memória — o Conselheiro
     fica mais pobre naquele turno, e nada indevido é dito. */
  console.error("memories: view vigentes indisponível, degradando", view.error.message ?? view.error);
  const table = await supabase.from("ai_memories")
    .select(MEMORY_COLS_TABLE)
    .eq("user_id", userId)
    .not("status", "in", '("rejeitada","expirada")')
    .order("created_at", { ascending: false }).limit(limit);
  if (!table.error) {
    return ((table.data ?? []) as MemoryRow[]).filter((m) => isMemoryReadable(m));
  }

  console.error("memories: falha ao ler ai_memories", table.error.message ?? table.error);
  return [];
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/* ─── O relógio do modelo ──────────────────────────────────────────────
   Sem esta linha, "ontem", "na segunda" e "semana passada" são CHUTE: o
   modelo não tem relógio nem fuso. Caso reproduzido em produção: "ontem
   gastei 22 no posto" devolvia data errada, o app dizia ter salvo, creditava
   XP e nada era gravado. A guarda de janela no app é remendo; a raiz é o
   modelo saber que dia é hoje ao interpretar a referência relativa.

   Uma função só, usada pela captura E pelo retrato, para as duas superfícies
   dizerem a MESMA coisa no mesmo formato. O cálculo de fuso continua todo em
   spParts() (_shared/entitlements.ts): aqui não há aritmética de data nova.
   spParts devolve weekday em inglês (Sun..Sat) e o prompt é em português, por
   isso a tradução — "na segunda" precisa casar com "segunda-feira". */
const WEEKDAY_PT: Record<string, string> = {
  Sun: "domingo", Mon: "segunda-feira", Tue: "terça-feira", Wed: "quarta-feira",
  Thu: "quinta-feira", Fri: "sexta-feira", Sat: "sábado",
};

/** Data e hora de AGORA em São Paulo, escritas para o modelo ler. */
export function nowInSpForPrompt(): string {
  const n = spParts();
  const dia = WEEKDAY_PT[n.weekday] ?? n.weekday;
  return `AGORA (fuso do app, America/Sao_Paulo): hoje é ${dia}, ${n.dateIso}, e são ${n.timeHm}.`;
}

/* ═══ TENDÊNCIAS VERIFICADAS NO RETRATO ═══════════════════════════════════

   O CRUZAMENTO ENTRE PILARES É A RAZÃO DE EXISTIR DO PRODUTO — e até aqui ele
   era a única coisa que o Conselheiro NÃO recebia.

   O app já calcula o cruzamento: `daily_metrics` pareia os dias, src/lib/
   insights.ts compara as medianas e a tabela `insights` guarda o resultado com
   período, amostra e versão da regra. A tela mostra tudo isso. O retrato lia
   nove tabelas e nenhuma das três.

   O efeito disso no prompt era uma contradição que nascia do CONTEXTO, não do
   modelo: o system manda "SEMPRE cruze pilares" e, vinte linhas abaixo, proíbe
   "completar uma lacuna com o detalhe mais plausível". Só dá para obedecer aos
   dois se o cruzamento CHEGAR PRONTO. Sem ele, sobravam duas saídas ruins —
   cruzar com número inventado, ou não cruzar. É este bloco que abre a terceira.

   A REGRA DA CASA, que vale aqui na íntegra (cabeçalho de src/lib/insights.ts):
   O MODELO EXPLICA, O CÓDIGO CALCULA. Nenhum número deste bloco passou por um
   LLM: todos vêm do cálculo puro e versionado. O modelo recebe o número pronto
   e a proibição de mexer nele.

   ─── AS QUATRO DECISÕES QUE ALGUÉM VAI QUERER "CONSERTAR" ───────────────

   1. ESCOPO: SÓ ENTRA QUEM TEM TODOS OS PILARES AUTORIZADOS.
      Uma tendência é cruzada por natureza: "sono × gasto do dia seguinte" toca
      vitalidade E prosperidade. Quem desligou prosperidade em Ajustes fechou
      uma porta, e uma tendência que atravessa a porta fechada é um vazamento —
      o dado sai pelo lado que continua aberto. Por isso a regra é a mais
      restritiva possível: TODOS os pilares que a análise toca precisam estar
      autorizados, não "pelo menos um".
      E quando uma tendência é escondida, este bloco fica EM SILÊNCIO sobre
      ela: nada de "há uma leitura que não posso mostrar". Dizer que existe algo
      escondido já entrega que existe dado daquele lado — e o retrato já instrui
      o modelo a não especular sobre área desativada nem pedir para reativar.

      E A REGRA QUE NASCEU DE UM FURO REAL (revisão de 13/09/2026):
      UNIVERSO PODADO NÃO AFIRMA AUSÊNCIA. Esconder por escopo encolhe a lista
      de tipos, e a versão anterior seguia adiante afirmando sobre o que sobrou:
      quando nada do que sobrou tinha leitura, o bloco escrevia "o app ainda não
      concluiu nenhuma leitura de padrão entre as áreas desta pessoa". Falso —
      as leituras existiam, só estavam escondidas. E o agravante que fecha o
      caso: a TELA não consulta `ai_scopes` (nem TrendInsights.tsx nem
      useTrendInsights.tsx). A pessoa VÊ o card, pergunta ao Conselheiro, e ele
      nega que exista. Duas superfícies do mesmo produto se contradizendo sobre
      a vida dela — e quem mente é justamente a que ela não tem como conferir.

      É a mesma doutrina do `insightErr` lá embaixo (leitura que falhou não vira
      "não há padrão"), que eu havia escrito e deixado furada por este caminho.
      Então, sempre que QUALQUER tipo for escondido por escopo:
        • nenhuma frase de ausência é emitida (nem a linha curta de "nenhuma
          leitura", nem o "Ainda sem leitura: …", que lista ausências de um
          universo já podado e se lê como exaustivo);
        • se não sobrar nenhuma leitura de verdade para mostrar, o bloco INTEIRO
          devolve vazio.
      O bloco passa a afirmar só PRESENÇA, que é sempre verdade, e reserva a
      afirmação de ausência para quando enxerga o universo completo. Silêncio
      não vaza e não mente; a frase de ausência fazia as duas coisas.
      O preço, dito por extenso: conta com algum pilar fechado perde a guarda
      anti-invenção deste bloco. Está coberto pelo "NUNCA INVENTE" do system e
      pela linha de PRIVACIDADE do próprio retrato, e é barato perto de negar à
      pessoa uma leitura que ela está vendo na tela.
      Os pilares de cada análise são os MESMOS pontinhos que a tela pinta no
      card (COPY[].pillars, em TrendInsights.tsx). Se um dia divergirem, a tela
      e a IA passam a discordar sobre o que a análise toca — e é a IA que erra
      em segredo.

   2. TIPO DESCONHECIDO NUNCA APARECE.
      `kind` que não esteja em INSIGHT_PILARES é ignorado, mesmo válido no
      banco. Não é preciosismo: pilar desconhecido é escopo indecidível, e a
      falha segura de uma regra de privacidade é calar. Uma quarta análise que
      chegue ao banco antes de chegar a este mapa fica de fora até alguém
      declarar aqui quais pilares ela atravessa. Barulhento de propósito.

   3. O QUE ELA CONFIRMOU VALE MAIS QUE O QUE A IA DEDUZIU.
      `insight_feedback` é a coisa mais rara do banco: verdade sobre a vida dela
      validada POR ELA, com um toque. Uma memória que o modelo econômico inferiu
      de uma frase entrava no retrato desde sempre; um padrão que ela confirmou,
      não entrava. Este bloco inverte isso, com a mesma palavra que o retrato já
      usa para memória revisada: CONFIRMOU.
      O "não" recebe o mesmo peso, e é o caso que mais importa: o número
      continua verdadeiro (aconteceu), mas ela disse que aquilo não descreve a
      vida dela — então o modelo não pode repetir aquilo como verdade sobre
      ela. Mesma disciplina da memória confirmada: na divergência, pergunte, não
      conclua.
      A resposta só é carregada quando `asked_status` bate com o status ATUAL.
      O insight é atualizado no lugar a cada recálculo (é o que o comentário da
      migration avisa): se ela respondeu "bate" sobre um padrão e hoje o cálculo
      diz "ficou parecido", a confirmação dela é sobre outra frase. Aproveitá-la
      seria colocar na boca dela uma concordância que ela nunca deu.

   4. OS TRÊS ESTADOS CHEGAM, E "NÃO ENCONTREI" CHEGA COMO RESPOSTA.
      Se o modelo não souber que o app olhou e não achou padrão, ele procura um
      — e procurar padrão sem dado é exatamente inventar a vida da pessoa.
      "Ficou parecido" e "ainda sem leitura" entram como respostas completas,
      para o Conselheiro poder devolvê-las de cabeça erguida.

   ─── O QUE ESTE BLOCO **NÃO** FAZ, E POR QUÊ ────────────────────────────
   • Não filtra por `tracking_prefs`. Escopo de IA (`ai_scopes`) é contrato de
     privacidade — o que o Conselheiro pode analisar. `tracking_prefs` é outra
     coisa: o que o app pede para ela registrar. Quem desligou o tracker de sono
     não apagou as noites que já registrou, e sumir com uma leitura verdadeira
     por causa disso seria apagar a vida dela de um jeito que ela não pediu. O
     risco real (o modelo cobrar registro daquela área) já tem dono: a linha
     "NÃO ACOMPANHA", no mesmo retrato, algumas linhas acima.
   • Não lê `calc_version`. Fixar a versão aqui faria o bloco sumir em silêncio
     no dia em que a fórmula mudasse para `insights/2`. Pegar a linha mais
     recente por tipo segue a regra nova sozinho, sem nada para lembrar depois.
   • Não usa a coluna `headline`. Ela é sempre null na prática (quem grava não
     a preenche — ver persistRun, em useTrendInsights.tsx). Compor a frase aqui
     também mantém a língua deste bloco colada à da tela, que é o ponto 4 do
     pedido: duas superfícies dizendo a mesma coisa de dois jeitos confunde.   */

/** As três análises da Fase 3 e os pilares que cada uma ATRAVESSA.
 *  ESPELHO de COPY[].pillars em src/components/core/TrendInsights.tsx
 *  (se mudar lá, mude aqui). Exportado porque é contrato de PRIVACIDADE, e o
 *  teste do espelho compara este mapa com os pontinhos que a tela pinta: se os
 *  dois divergirem, a tela e a IA passam a discordar sobre o que cada análise
 *  toca — e é a IA que erra em segredo. */
export const INSIGHT_PILARES: Record<string, string[]> = {
  sono_gasto_seguinte: ["vitalidade", "prosperidade"],
  refeicao_gasto_comida: ["vitalidade", "prosperidade"],
  treino_sono: ["vitalidade"],
};

/** Como cada análise é dita ao modelo.
 *
 *  ATENÇÃO — o mesmo aviso em maiúsculas que a tela carrega, e pela mesma
 *  razão: `high_group_median` é a mediana do lado DIREITO dentro do grupo ALTO
 *  do lado esquerdo. NÃO é "o maior dos dois números". Quando a associação é
 *  invertida, ele é o menor. Os rótulos abaixo estão presos ao GRUPO ("em que
 *  dormiu mais" acompanha sempre o alto), nunca ao valor: ordenar para o maior
 *  aparecer primeiro inverteria a leitura sem nenhum aviso. */
const INSIGHT_COPY: Record<string, {
  titulo: string;
  tendencia: (alto: string, baixo: string) => string;
  parecido: (alto: string, baixo: string) => string;
  fmt: (v: number) => string;
}> = {
  sono_gasto_seguinte: {
    titulo: "Sono × gasto do dia seguinte",
    tendencia: (a, b) => `após as noites em que dormiu mais, ${a} no dia; após as em que dormiu menos, ${b}`,
    parecido: (a, b) => `dormindo mais ou menos, o gasto do dia seguinte ficou parecido (${a} e ${b})`,
    fmt: (v) => BRL(v),
  },
  refeicao_gasto_comida: {
    titulo: "Refeições × gasto com comida",
    tendencia: (a, b) => `nos dias em que registrou o que comeu, ${a}; nos dias sem registro, ${b}`,
    parecido: (a, b) => `registrando ou não as refeições, o gasto com comida ficou parecido (${a} e ${b})`,
    fmt: (v) => BRL(v),
  },
  treino_sono: {
    titulo: "Treino × sono",
    tendencia: (a, b) => `nas noites dos dias em que treinou, ${a}; nos dias sem treino, ${b}`,
    parecido: (a, b) => `com treino ou sem treino, o sono daquelas noites ficou parecido (${a} e ${b})`,
    fmt: (v) => `${String(v).replace(".", ",")} h`,
  },
};

/** Linha da tabela `insights`, como o retrato precisa dela. */
export interface InsightRow {
  kind: string;
  status: string;
  sample_size?: number | null;
  period_start?: string | null;
  period_end?: string | null;
  // deno-lint-ignore no-explicit-any
  result?: Record<string, any> | null;
  computed_at?: string | null;
}

/** Linha da tabela `insight_feedback`: a resposta dela ao "isso te ajudou?". */
export interface InsightFeedbackRow {
  kind: string;
  /** null = perguntamos e ela não respondeu · 'sim' · 'nao'. */
  answer?: string | null;
  /** O estado do card no momento da pergunta. Ver decisão 3 acima. */
  asked_status?: string | null;
}

/** "2026-08-15" → "15/08". Formato brasileiro, como manda SAFETY_RULES. */
function diaMes(iso: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}` : null;
}

/** Número utilizável, ou null. Número fantasma numa linha de tendência é pior
 *  que linha nenhuma: a pessoa confere esse valor olhando a própria vida.
 *
 *  `null` e `""` são barrados ANTES do Number(): `Number(null)` é 0, e um 0 que
 *  na verdade é "não medido" viraria "R$ 0,00" no prompt, com cara de medição.
 *  É a mesma distinção que atravessa toda a Fase 3 (null = não medido, 0 =
 *  medido e deu zero), e perdê-la aqui reintroduz no retrato exatamente a
 *  mentira que a view `daily_metrics` toma o cuidado de não contar. */
function numeroOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A evidência que a tela mostra sem clique: quantos dias e de quando a quando.
 *  É o que dá (ou tira) o peso da frase. */
function evidencia(row: InsightRow): string {
  const dias = Number(row.sample_size) || 0;
  const de = diaMes(row.period_start);
  const ate = diaMes(row.period_end);
  const periodo = de && ate ? `, ${de} a ${ate}` : "";
  return ` ${dias} ${dias === 1 ? "dia" : "dias"}${periodo}.`;
}

/**
 * O bloco de TENDÊNCIAS do retrato. Puro de propósito: recebe as linhas já
 * lidas, os escopos já resolvidos, e devolve as linhas do prompt. Toda a regra
 * que decide o que a pessoa vê (escopo, confirmação, estado) é testável sem
 * banco, sem relógio e sem rede.
 *
 * Devolve [] quando não há nada que possa ser dito — inclusive quando tudo o
 * que existe está atrás de um pilar que ela fechou.
 */
export function trendLines(
  insights: InsightRow[],
  feedback: InsightFeedbackRow[],
  scopes: Record<string, boolean>,
): string[] {
  // Pilar sem resposta explícita conta como autorizado — a mesma leitura que o
  // resto do retrato faz de `ai_scopes` (`!== false`).
  const autorizada = (kind: string) => {
    const pilares = INSIGHT_PILARES[kind];
    if (!pilares) return false;                       // tipo desconhecido: decisão 2
    return pilares.every((p) => scopes[p] !== false);  // TODOS, nunca "algum"
  };

  const tiposVisiveis = Object.keys(INSIGHT_PILARES).filter(autorizada);
  if (!tiposVisiveis.length) return [];

  /* O escopo podou alguma coisa? Então nada aqui pode AFIRMAR AUSÊNCIA: o que
     este bloco enxerga deixou de ser o universo. Ver a regra no contrato acima
     — é o furo que a revisão de 13/09/2026 encontrou. */
  const universoPodado = tiposVisiveis.length < Object.keys(INSIGHT_PILARES).length;

  // A leitura mais recente de cada tipo. A lista chega ordenada por
  // `computed_at` desc, então a primeira de cada tipo é a que vale.
  const maisRecente = new Map<string, InsightRow>();
  for (const row of insights ?? []) {
    const kind = String(row?.kind ?? "");
    if (!tiposVisiveis.includes(kind) || maisRecente.has(kind)) continue;
    maisRecente.set(kind, row);
  }

  const respostaDela = new Map<string, InsightFeedbackRow>();
  for (const f of feedback ?? []) {
    const kind = String(f?.kind ?? "");
    if (tiposVisiveis.includes(kind) && !respostaDela.has(kind)) respostaDela.set(kind, f);
  }

  /** A marca da resposta dela, só quando ela respondeu SOBRE ESTE estado. */
  const marcaDela = (kind: string, status: string): string => {
    const f = respostaDela.get(kind);
    if (!f || f.asked_status !== status) return "";
    if (f.answer === "sim") {
      return " A PESSOA CONFIRMOU que isso bate com a vida dela: vale mais que qualquer dedução sua.";
    }
    if (f.answer === "nao") {
      return " A PESSOA DISSE QUE ISSO NÃO BATE com a vida dela: não repita como verdade sobre ela, pergunte antes de concluir.";
    }
    return "";
  };

  const bullets: string[] = [];
  /** O que ainda não tem resposta. `faltam` só existe quando o cálculo disse
   *  quantos dias faltam — número inventado aqui seria pior que silêncio. */
  const semLeitura: { titulo: string; faltam: string | null }[] = [];

  for (const kind of tiposVisiveis) {
    const copy = INSIGHT_COPY[kind];
    const row = maisRecente.get(kind);
    if (!row || !copy) {
      semLeitura.push({ titulo: copy?.titulo ?? kind, faltam: null });
      continue;
    }

    const alto = numeroOuNull(row.result?.high_group_median);
    const baixo = numeroOuNull(row.result?.low_group_median);
    const temNumeros = alto !== null && baixo !== null;

    if (row.status === "tendencia" && temNumeros) {
      bullets.push(
        `• ${copy.titulo}: ${copy.tendencia(copy.fmt(alto!), copy.fmt(baixo!))}.` +
        evidencia(row) + marcaDela(kind, row.status),
      );
      continue;
    }
    if (row.status === "sem_tendencia" && temNumeros) {
      bullets.push(
        `• ${copy.titulo}: ${copy.parecido(copy.fmt(alto!), copy.fmt(baixo!))}.` +
        evidencia(row) + marcaDela(kind, row.status),
      );
      continue;
    }

    /* Sobrou: `dados_insuficientes`, estado que o cálculo conhece mas que hoje
       ninguém grava (persistRun pula), e a linha corrompida (status estranho ou
       mediana ilegível). Os dois viram "ainda sem leitura" — nunca "não há
       padrão", que é conclusão que não temos. Quando o motivo e a conta de dias
       existirem, eles entram: "faltam 9 dias" é serviço; inventar essa conta,
       não. */
    const faltam = numeroOuNull(row.result?.days_missing);
    const contagem = row.status === "dados_insuficientes"
      && row.result?.reason === "overlap" && faltam !== null && faltam > 0
      ? `faltam ${faltam} dias com os dois lados registrados`
      : null;
    semLeitura.push({ titulo: copy.titulo, faltam: contagem });
  }

  /* Nenhuma leitura ainda: uma linha só, sem a aula sobre causalidade — não há
     número para citar, e o que precisa ser dito é apenas que o app não concluiu
     nada. Vale ~1/4 dos tokens do bloco completo, e é o estado da maioria das
     contas novas.
     A contagem regressiva, quando existe, VEM JUNTO: "faltam 9 dias" é o único
     número desta situação, e número é a última coisa que este bloco corta. Os
     tipos sem contagem ficam sem nome — a frase já diz que não há leitura, e
     repetir os três títulos seria pagar tokens para dizer "nada" três vezes. */
  if (!bullets.length) {
    /* Sem nenhuma leitura para mostrar E com o universo podado, a única saída
       honesta é não existir: qualquer frase aqui seria sobre o que foi
       escondido. */
    if (universoPodado) return [];
    const contagens = semLeitura
      .filter((s) => s.faltam)
      .map((s) => `${s.titulo}: ${s.faltam}`);
    return [
      `TENDÊNCIAS: o app ainda não concluiu nenhuma leitura de padrão entre as áreas desta pessoa` +
      (contagens.length ? ` (${contagens.join("; ")})` : "") + `. ` +
      `Não afirme que uma área influencia outra na vida dela, nem para ilustrar.`,
    ];
  }

  /* A lista de ausências se lê como exaustiva ("é isto que ainda não temos"), e
     num universo podado ela é uma meia-verdade que o modelo completa sozinho.
     Com poda, o bloco mostra o que TEM e cala sobre o que não tem. */
  if (semLeitura.length && !universoPodado) {
    bullets.push(`• Ainda sem leitura: ${
      semLeitura.map((s) => s.faltam ? `${s.titulo} (${s.faltam})` : s.titulo).join("; ")
    }.`);
  }

  /* O cabeçalho existe por causa de UM risco: número bonito na mão do modelo
     vira relação de causa em uma frase ("você gastou mais PORQUE dormiu mal").
     As palavras banidas e a frase de limite são as MESMAS da tela
     (LIMIT_PHRASE, em TrendInsights.tsx): a pessoa não pode ler uma coisa no
     card e ouvir outra do Conselheiro. */
  return [
    `TENDÊNCIAS VERIFICADAS (cálculo do app, não seu). ` +
    `São ASSOCIAÇÕES: nunca diga que um lado causou o outro ("porque", "faz com que", "leva a") — ` +
    `a tela dela diz "isso aconteceu junto, não quer dizer que um causou o outro". ` +
    `Não invente tendência nem altere número. Abaixo de 30 dias, leitura provisória. ` +
    (universoPodado
      // Sem a lista de ausências, convidar o modelo a dizer "ainda sem leitura"
      // seria ensiná-lo a afirmar exatamente o que este bloco parou de afirmar.
      ? `"Ficou parecido" é resposta completa: diga-a em vez de procurar padrão sozinho.`
      : `"Ficou parecido" e "ainda sem leitura" são respostas completas: diga-as em vez de procurar padrão sozinho.`),
    ...bullets,
  ];
}

/**
 * Monta um retrato compacto do usuário cruzando todos os pilares.
 * É este texto que dá ao Conselheiro a visão completa da vida da pessoa.
 */
export async function buildSnapshot(supabase: SupabaseClient, userId: string): Promise<string> {
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  // Fronteiras de dia/mês SEMPRE no fuso de São Paulo (plano §5.4)
  const todaySpIso = spParts().dateIso;
  const monthStartSpIso = spMonthStartUtc().slice(0, 10);

  const [{ data: profile }, { data: events }, { data: txs }, { data: habits }, xpTotalRes, { data: battles }, { data: bCheckins }, { data: plans }, memoriesRaw, { data: estimates }, { data: recurrings }, { data: insightRows, error: insightErr }, { data: insightFeedback }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("life_events").select("pillar,kind,occurred_at,payload")
        .eq("user_id", userId).gte("occurred_at", since30)
        .order("occurred_at", { ascending: false }).limit(120),
      supabase.from("transactions").select("kind,amount,category,occurred_at")
        .eq("user_id", userId).gte("occurred_at", monthStartSpIso),
      supabase.from("habits").select("id,name,pillar").eq("user_id", userId).eq("active", true),
      supabase.rpc("xp_total", { uid: userId }),
      supabase.from("battles").select("id,name,triggers")
        .eq("user_id", userId).eq("active", true).eq("visible_to_ai", true),
      supabase.from("battle_checkins").select("battle_id,checkin_date,status,trigger_label")
        .eq("user_id", userId).gte("checkin_date", since30.slice(0, 10))
        .order("checkin_date", { ascending: false }),
      supabase.from("plans").select("title,kind,content,created_at")
        .eq("user_id", userId).eq("status", "ativo")
        .order("created_at", { ascending: false }).limit(3),
      selectMemories(supabase, userId, 50),
      supabase.from("category_estimates").select("category,amount").eq("user_id", userId),
      supabase.from("recurring_transactions").select("kind,amount,category,description,active")
        .eq("user_id", userId).eq("active", true),
      /* As tendências que o app JÁ calculou (ver o bloco acima de trendLines).
         Limite 12 = as 3 análises com folga para versões antigas da regra
         convivendo; a ordenação por `computed_at` faz a primeira de cada tipo
         ser a mais recente, que é a que a pessoa viu por último. */
      supabase.from("insights").select("kind,status,sample_size,period_start,period_end,result,computed_at")
        .eq("user_id", userId).order("computed_at", { ascending: false }).limit(12),
      supabase.from("insight_feedback").select("kind,answer,asked_status").eq("user_id", userId),
    ]);

  const lines: string[] = [];
  // PRIMEIRA linha do retrato, de propósito: tudo que vem depois ("hoje",
  // "esta semana", "no mês") só faz sentido ancorado numa data, e sem ela o
  // modelo não sabia interpretar "ontem" no relato da pessoa.
  lines.push(`${nowInSpForPrompt()} Use esta data como referência para qualquer expressão de tempo, sua ou da pessoa.`);
  const p = profile ?? {};
  /* Rótulo humano de cada pilar/escopo. Existe porque as duas linhas abaixo
     despejavam o ID CRU no prompt: "as áreas: alimentacao, diario" e "Pilares
     ativos: alimentacao, mente". Sem acento e em snake, esses ids são
     exatamente o "vocabulário interno do sistema" que as SAFETY_RULES proíbem
     o modelo de usar com a pessoa — e nós o entregávamos pronto na boca dele.
     Mesmo padrão do TRACKER_LABEL, logo abaixo.

     `alimentacao` cai no rótulo novo (perfil não migrado ainda traz o id na
     lista), e o Set elimina a repetição que isso criaria. "Mente" sem
     sobrenome de propósito: quem declarou não ter prática religiosa recebe,
     algumas linhas adiante, a instrução de que o pilar dela é "Mente & Foco". */
  const PILLAR_LABEL: Record<string, string> = {
    prosperidade: "Prosperidade", vitalidade: "Vitalidade",
    alimentacao: "Vitalidade", mente: "Mente", diario: "Diário",
  };
  const rotuloPilar = (id: string) => PILLAR_LABEL[id] ?? id;

  // Escopos de privacidade: quais áreas a pessoa autorizou o Conselheiro a analisar.
  const rawScopes = (p.ai_scopes ?? {}) as Record<string, unknown>;
  /* FUSÃO — leitura DERIVADA, não migração. E é ela, não a migration, que
     torna a ordem do deploy irrelevante.

     A chave `alimentacao` continua existindo em perfil não migrado, em perfil
     que a tela de Ajustes reescreveu e em qualquer rollback. Enquanto ela
     existir, ela MANDA JUNTO: autorizado só quando NENHUMA das duas disse não.
     É o mesmo `every` de INSIGHT_PILARES (`pilares.every(...)`, acima),
     aplicado à fusão — e é E (AND), não OU, porque escopo é contrato: quem
     negou `alimentacao` tirou do Conselheiro peso, composição corporal,
     calorias, proteína e hidratação. Sob OU, uma refatoração NOSSA devolveria
     tudo isso sem ela tocar em nada, sem consentimento e sem aviso. Dado
     analisado não desanalisa; utilidade perdida volta com um toque.

     ESPELHO OBRIGATÓRIO na tela de Ajustes: ao gravar o interruptor fundido,
     o front escreve o MESMO valor nas duas chaves. Sem isso, o primeiro toque
     em qualquer interruptor de privacidade apaga a chave `alimentacao` do
     banco (a tela grava o objeto inteiro, montado a partir da lista SCOPES) —
     e chave ausente = AUTORIZADO reabre, para qualquer função ainda velha,
     exatamente o que a pessoa acabou de fechar.

     Sai daqui na release de CONTRAÇÃO, junto com a chave no banco e com o
     espelho do Ajustes. Os três saem juntos ou nenhum sai. */
  const scopes = {
    prosperidade: rawScopes.prosperidade !== false,
    vitalidade: rawScopes.vitalidade !== false && rawScopes.alimentacao !== false,
    mente: rawScopes.mente !== false,
    diario: rawScopes.diario !== false,
  };
  const disabled = [...new Set(
    Object.entries(scopes).filter(([, v]) => !v).map(([k]) => rotuloPilar(k)),
  )];
  if (disabled.length) {
    lines.push(`PRIVACIDADE: a pessoa desativou a análise das áreas: ${disabled.join(", ")}. Esses dados foram omitidos deste retrato de propósito. Não especule sobre eles nem peça para reativar.`);
  }
  // Modularidade total (nível tracker): o que a pessoa ESCOLHEU não acompanhar.
  // Regra inegociável para quem lê este retrato (briefing, Conselheiro,
  // retrospectiva): nunca cobrar registro, sugerir meta ou propor hábito
  // dessas áreas — a escolha dela é parte do produto, não uma lacuna.
  const TRACKER_LABEL: Record<string, string> = {
    water: "água/hidratação", meals: "refeições e calorias", protein: "proteína",
    weight: "peso e corpo", sleep: "sono", naps: "sonecas", workouts: "treinos",
    mood: "humor", practice: "prática (espiritual/mente)", journal: "diário",
    gratitude: "gratidão", spend_limit: "teto de gasto diário",
  };
  const trackingPrefs = (p.tracking_prefs ?? {}) as Record<string, unknown>;
  const offTrackers = Object.keys(TRACKER_LABEL)
    .filter((k) => trackingPrefs[k] === false)
    .map((k) => TRACKER_LABEL[k]);
  if (offTrackers.length) {
    lines.push(
      `NÃO ACOMPANHA (escolha deliberada da pessoa em Ajustes): ${offTrackers.join(", ")}. ` +
      `NUNCA cobre registros, sugira metas, proponha hábitos ou lamente a falta de dados dessas áreas — a menos que a pessoa peça explicitamente. Isso não é lacuna, é escolha.`
    );
  }
  lines.push(`Nome: ${p.name || "não informado"}.`);
  // Contexto de onboarding: uma conta nova que acabou de montar o Blueprint
  // é MUITO diferente de uma conta antiga sem dados. Sem esta linha, o
  // briefing tratava um retrato recém-preenchido como abandono.
  if (p.blueprint_generated_at) {
    const genMs = new Date(String(p.blueprint_generated_at)).getTime();
    const hoursAgo = Number.isFinite(genMs) ? Math.floor((Date.now() - genMs) / 3_600_000) : null;
    lines.push(
      `ONBOARDING: a pessoa concluiu o onboarding completo e gerou o Blueprint da Subida` +
      (hoursAgo !== null && hoursAgo < 48 ? ` há ${hoursAgo < 1 ? "menos de uma hora" : `${hoursAgo}h`}` : "") +
      `. Os dados abaixo foram declarados por ela ali. Reconheça esse esforço quando fizer sentido e NUNCA sugira que ela "não preencheu" ou "pulou" o que aparece preenchido aqui.`
    );
  }
  if (p.goal) lines.push(`Objetivo declarado: ${p.goal}.`);
  const pilaresAtivos = [...new Set(((p.pillars ?? []) as unknown[]).map((x) => rotuloPilar(String(x))))];
  lines.push(`Pilares ativos: ${pilaresAtivos.join(", ") || "nenhum ainda"}.`);

  // Dados pessoais (base de qualquer plano personalizado)
  const personal: string[] = [];
  const missing: string[] = [];
  if (p.birth_year && Number(p.birth_year) > 1900) {
    personal.push(`idade ~${new Date().getFullYear() - Number(p.birth_year)} anos`);
  } else missing.push("idade (ano de nascimento)");
  if (p.sex) personal.push(`sexo ${p.sex}`); else missing.push("sexo");
  if (p.height_cm && Number(p.height_cm) > 80) {
    personal.push(`altura ${Number(p.height_cm)} cm`);
  } else missing.push("altura");
  if (p.activity_level) personal.push(`nível de atividade ${p.activity_level}`);
  else missing.push("nível de atividade");
  const restrictions = Array.isArray(p.dietary_restrictions)
    ? (p.dietary_restrictions as unknown[]).map(String).filter(Boolean)
    : [];
  if (restrictions.length) personal.push(`restrições alimentares: ${restrictions.join(", ")}`);
  if (personal.length) lines.push(`Dados pessoais: ${personal.join("; ")}.`);
  if (p.has_religion === false) {
    lines.push(`IMPORTANTE: a pessoa NÃO tem prática religiosa. O pilar dela é "Mente & Foco" — desenvolvimento mental (foco, clareza, meditação laica, leitura). Nunca use vocabulário espiritual ou religioso com ela.`);
  } else if (p.spirituality_label) {
    lines.push(`Prática espiritual (vocabulário escolhido pela pessoa): ${p.spirituality_label}.`);
  }
  const healthConds = Array.isArray(p.health_conditions)
    ? (p.health_conditions as unknown[]).map(String).filter(Boolean)
    : [];
  if (healthConds.length) {
    lines.push(
      `SAÚDE — condições informadas pela própria pessoa: ${healthConds.join("; ")}. ` +
      `Considere-as em TODA sugestão de alimentação, treino e rotina (adapte ou evite o que for inadequado à condição). ` +
      `Você não diagnostica nem trata: mudanças de medicação, dieta clínica ou treino pós-lesão devem ser validadas com o profissional de saúde dela.`
    );
  }
  const meds = Array.isArray(p.medications)
    ? (p.medications as unknown[]).map(String).filter(Boolean)
    : [];
  if (meds.length) {
    lines.push(
      `MEDICAMENTOS EM USO (informados pela pessoa): ${meds.join("; ")}. ` +
      `Considere possíveis implicações práticas (horários, alimentação, treino), mas NUNCA sugira alterar dose, trocar, iniciar ou parar medicamento: isso é exclusivo do prescritor. Em dúvida sobre interações, orientar a conversar com médico ou farmacêutico.`
    );
  }
  if (p.monthly_income) lines.push(`Renda mensal aproximada: ${BRL(Number(p.monthly_income))}.`);
  if (p.monthly_budget) lines.push(`Orçamento mensal desejado: ${BRL(Number(p.monthly_budget))}.`);
  if (p.est_food_spend) {
    lines.push(
      `ESTIMATIVA DECLARADA: gasta ~${BRL(Number(p.est_food_spend))}/mês com comida (mercado + fora de casa). ` +
      `É premissa, não registro — o real do mês substitui, nunca soma. É a base do "plano alimentar que cabe no bolso": qualquer plano alimentar deve caber nesse valor (ou declarar por que não cabe).`
    );
  }

  // Finanças do mês
  if (scopes.prosperidade) {
  const income = (txs ?? []).filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expense = (txs ?? []).filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const byCat: Record<string, number> = {};
  for (const t of txs ?? []) if (t.kind === "expense") byCat[t.category] = (byCat[t.category] ?? 0) + Number(t.amount);
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, v]) => `${c} ${BRL(v)}`).join(", ");
  lines.push(`FINANÇAS (mês atual): entradas ${BRL(income)}, saídas ${BRL(expense)}, saldo ${BRL(income - expense)}.` +
    (topCats ? ` Maiores gastos: ${topCats}.` : ""));

  // Camada 2: fixos recorrentes (compromissos do mês, cadastrados uma vez)
  const recs = (recurrings ?? []) as { kind: string; amount: number; category: string; description: string | null }[];
  if (recs.length) {
    const recExp = recs.filter((r) => r.kind === "expense");
    const recInc = recs.filter((r) => r.kind === "income");
    if (recExp.length) {
      const recTotal = recExp.reduce((s, r) => s + Number(r.amount), 0);
      const recList = recExp.slice(0, 8)
        .map((r) => `${r.description || r.category} ${BRL(Number(r.amount))}`).join(", ");
      lines.push(`GASTOS FIXOS RECORRENTES: ${BRL(recTotal)}/mês comprometidos (${recList}). Já estão materializados nas saídas do mês.`);
    }
    if (recInc.length) {
      const incTotal = recInc.reduce((s, r) => s + Number(r.amount), 0);
      const incList = recInc.slice(0, 4)
        .map((r) => `${r.description || r.category} ${BRL(Number(r.amount))}`).join(", ");
      lines.push(`ENTRADAS FIXAS RECORRENTES: ${BRL(incTotal)}/mês (${incList}). Já materializadas nas entradas do mês — é a mesma renda da "renda mensal aproximada" acima, vista por outro caminho: NUNCA some as duas.`);
    }
  }

  // Camada 1: estimativas declaradas pela pessoa (Raio-X). São PREMISSAS,
  // não registros — o real do mês substitui a estimativa, nunca soma.
  const ests = (estimates ?? []) as { category: string; amount: number }[];
  if (ests.length) {
    const estList = ests.slice(0, 8).map((e) => `${e.category} ~${BRL(Number(e.amount))}/mês`).join(", ");
    lines.push(
      `ESTIMATIVAS DECLARADAS PELA PESSOA (não são registros): ${estList}. ` +
      `Use-as como premissas quando os registros reais do mês forem escassos, citando a origem ("com base na sua estimativa de mercado..."), em vez de dizer que faltam dados. ` +
      `Regra de composição por categoria: considere max(gasto real do mês, estimativa) — nunca some os dois. ` +
      `Para o "plano alimentar que cabe no bolso", a estimativa de Mercado/Alimentação fora é base suficiente para uma primeira versão com premissas declaradas.`
    );
  }
  }

  // Hábitos e consistência (últimos 30 dias)
  const habitDone = (events ?? []).filter((e) => e.kind === "habit_done");
  if ((habits ?? []).length) {
    const counts: Record<string, number> = {};
    for (const e of habitDone) {
      const n = (e.payload as any)?.habit_name ?? "hábito";
      counts[n] = (counts[n] ?? 0) + 1;
    }
    const resumo = (habits ?? []).map((h) => `${h.name}: ${counts[h.name] ?? 0}x/30d`).join(", ");
    lines.push(`HÁBITOS: ${resumo}.`);
  } else {
    lines.push(
      "COMPROMISSOS DIÁRIOS (hábitos): nenhum ainda — de propósito, o Ascende não impõe lista pronta. " +
      "Se fizer sentido na conversa (a pessoa pedir rotina, ou você entregar um plano), proponha 1 a 3 " +
      "compromissos pequenos derivados da meta dela via propor_habitos."
    );
  }

  // Silêncio e retorno (plano de feedbacks, Sugestão 3): o retrato precisa
  // saber lidar com o vazio — é quando a pessoa mais precisa dele. Quem lê
  // este retrato (briefing, retrospectiva, Conselheiro) recebe a instrução
  // de acolher o retorno, nunca de cobrar.
  const lastEventAt = (events ?? [])[0]?.occurred_at ? new Date(String((events ?? [])[0].occurred_at)).getTime() : null;
  if (!lastEventAt) {
    lines.push(
      `SILÊNCIO: nenhum registro nos últimos 30 dias. Se houver histórico antigo, trate como um RETORNO: acolha sem cobrança, não cite sequência perdida nem liste o que "faltou". O primeiro registro de volta vale por dez — diga isso, e proponha UM passo pequeno.`
    );
  } else {
    const gapDays = Math.floor((Date.now() - lastEventAt) / 864e5);
    if (gapDays >= 7) {
      lines.push(
        `RETORNO APÓS SILÊNCIO: a pessoa ficou ${gapDays} dias sem registrar e está de volta agora. Acolha o retorno sem culpa e sem auditoria do período: nada aqui expirou (planos e compromissos continuam valendo). Não mencione sequência perdida. Proponha UM recomeço pequeno, partindo de onde ela parou.`
      );
    }
  }

  // Sono, humor, treinos, refeições, práticas — médias e últimos registros
  const kinds: Record<string, any[]> = {};
  for (const e of events ?? []) (kinds[e.kind] ??= []).push(e);

  if (scopes.vitalidade) {
  const sleeps = (kinds["sleep"] ?? []).map((e) => Number((e.payload as any)?.hours)).filter((n) => n > 0);
  if (sleeps.length) lines.push(`SONO NOTURNO: média de ${(sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(1)}h nos últimos ${sleeps.length} registros (sonecas contadas à parte).`);

  // Rotina de sono declarada (estilo iPhone) + adesão via check-in matinal.
  // É o cruzamento-assinatura da marca: noites fora da rotina × gasto por
  // impulso × humor — algo que nenhum app de nicho consegue dizer.
  const bt = String(p.sleep_bedtime ?? "").slice(0, 5);
  const wt = String(p.sleep_waketime ?? "").slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(bt) && /^\d{2}:\d{2}$/.test(wt) && trackingPrefs["sleep"] !== false) {
    const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const diffMin = ((toMin(wt) - toMin(bt)) + 1440) % 1440;
    if (diffMin > 0) {
      const hrs = Math.round((diffMin / 60) * 10) / 10;
      const withFlag = (kinds["sleep"] ?? []).filter((e) => typeof (e.payload as any)?.followed_schedule === "boolean");
      const followed = withFlag.filter((e) => (e.payload as any)?.followed_schedule === true).length;
      lines.push(
        `ROTINA DE SONO DECLARADA: dorme às ${bt}, acorda às ${wt} (~${hrs}h/noite).` +
        (withFlag.length
          ? ` Adesão (30d): seguiu a rotina em ${followed} de ${withFlag.length} noites com check-in.`
          : ` Ainda sem check-ins de rotina (o check-in matinal de 1 toque na tela Hoje alimenta a adesão).`) +
        ` Se a pessoa disser "dormi no horário"/"segui minha rotina", isso significa ${hrs}h de sono nesses horários.`
      );
    }
  }
  const naps = (kinds["nap"] ?? []).map((e) => Number((e.payload as any)?.hours)).filter((n) => n > 0);
  if (naps.length) lines.push(`SONECAS (30d): ${naps.length}, média de ${(naps.reduce((a, b) => a + b, 0) / naps.length).toFixed(1)}h cada.`);

  // Raio-X de Vitalidade (plano de feedbacks, Sug. 2 e 4): estimativas
  // declaradas pela pessoa. Mesma regra do Raio-X financeiro: PREMISSAS,
  // não registros — o real substitui a estimativa, nunca soma. Elas
  // permitem o primeiro cruzamento entre pilares já no dia 1.
  const estParts: string[] = [];
  const estW = Number(p.est_workouts_week);
  if (Number.isFinite(estW) && p.est_workouts_week != null) estParts.push(`treina ~${estW}x/semana`);
  const estS = Number(p.est_sleep_h);
  if (Number.isFinite(estS) && p.est_sleep_h != null && estS > 0) estParts.push(`dorme ~${estS}h/noite`);
  if (estParts.length) {
    lines.push(
      `ESTIMATIVAS DE VITALIDADE DECLARADAS PELA PESSOA (Raio-X, não são registros): ${estParts.join("; ")}. ` +
      `Use como premissas quando os registros reais forem escassos, citando a origem ("pela sua estimativa de X treinos por semana..."), em vez de dizer que faltam dados. ` +
      `Registro real do período substitui a estimativa, nunca soma. Combine com as estimativas financeiras quando fizer sentido (ex.: custo do mercado por semana de treino).`
    );
  }
  }

  if (scopes.mente) {
  const moods = (kinds["mood"] ?? []).slice(0, 10).map((e) => (e.payload as any)?.label ?? (e.payload as any)?.score).filter(Boolean);
  if (moods.length) lines.push(`HUMOR (mais recentes primeiro): ${moods.join(", ")}.`);
  }

  if (scopes.vitalidade && kinds["workout"]?.length) {
    const mCount: Record<string, number> = {};
    for (const e of kinds["workout"]) {
      for (const m of ((e.payload as any)?.muscles ?? []) as string[]) mCount[m] = (mCount[m] ?? 0) + 1;
    }
    const dist = Object.entries(mCount).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}x`).join(", ");
    const durations = kinds["workout"].map((e) => Number((e.payload as any)?.duration_min)).filter((n) => n > 0);
    const durInfo = durations.length
      ? ` Duração informada em ${durations.length} treinos (média ${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)} min).`
      : "";
    lines.push(`TREINOS nos últimos 30 dias: ${kinds["workout"].length}.` +
      (dist ? ` Grupos trabalhados: ${dist}.` : "") + durInfo);

    // Treinos de HOJE, carimbados (mesma correção das refeições): sem isso o
    // modelo sabe que existem N treinos no mês, mas não que um deles acabou de
    // acontecer — e responde "você ainda não treinou hoje" para quem treinou.
    const todayWorkouts = kinds["workout"]
      .filter((e) => spParts(new Date(e.occurred_at)).dateIso === todaySpIso)
      .map((e) => {
        const pl = (e.payload as any) ?? {};
        const p = spParts(new Date(e.occurred_at));
        const musc = Array.isArray(pl.muscles) && pl.muscles.length ? ` (${pl.muscles.join(", ")})` : "";
        const dur = Number(pl.duration_min) > 0 ? ` — ${Math.round(Number(pl.duration_min))} min` : "";
        return `[hoje ${p.timeHm}] ${pl.description ?? "treino"}${musc}${dur}`;
      });
    if (todayWorkouts.length) {
      lines.push(`TREINOS DE HOJE (já registrados por esta pessoa — trate como fato, não pergunte de novo): ${todayWorkouts.join("; ")}.`);
    }
  }

  // Peso e composição corporal
  if (scopes.vitalidade && kinds["weight"]?.length) {
    const ws = kinds["weight"]
      .map((e) => ({ d: e.occurred_at.slice(0, 10), kg: Number((e.payload as any)?.kg) }))
      .filter((w) => w.kg > 0)
      .sort((a, b) => a.d.localeCompare(b.d));
    if (ws.length) {
      const latest = ws[ws.length - 1];
      const first = ws[0];
      const delta = latest.kg - first.kg;
      const goal = Number(p.weight_goal_kg) || 0;
      lines.push(
        `PESO: atual ${latest.kg} kg (registrado em ${latest.d}).` +
        (ws.length > 1 ? ` Variação em 30 dias: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} kg.` : "") +
        (goal ? ` Meta declarada: ${goal} kg.` : "")
      );
    }
  }
  if (scopes.vitalidade && kinds["body"]?.length) {
    const b = (kinds["body"][0].payload as any) ?? {};
    lines.push(
      `COMPOSIÇÃO CORPORAL (estimativa visual por foto, margem larga): ~${b.body_fat_pct}% de gordura` +
      (b.lean_mass_kg ? `, ~${b.lean_mass_kg} kg de massa magra` : "") + `.`
    );
  }

  if (scopes.mente && kinds["practice"]?.length) lines.push(`PRÁTICA ESPIRITUAL/MENTE: ${kinds["practice"].length} registros em 30 dias.`);

  // Diário — pensamentos recentes (a pessoa sabe que o Conselheiro vê o que ela registra)
  if (scopes.diario && kinds["journal"]?.length) {
    const trechos = kinds["journal"].slice(0, 3)
      .map((e) => String((e.payload as any)?.text ?? "").slice(0, 160)).filter(Boolean)
      .map((t) => `"${t}"`).join(" | ");
    lines.push(`DIÁRIO: ${kinds["journal"].length} entradas em 30 dias.` +
      (trechos ? ` Trechos recentes: ${trechos}.` : ""));
  }
  if (scopes.vitalidade && kinds["meal"]?.length) {
    // Cada refeição vai CARIMBADA com dia, hora (SP) e tipo. Antes a lista era
    // só a descrição — o modelo recebia "pão com manteiga; pastéis; miojo" sem
    // uma única data e não tinha como saber que o primeiro item era o almoço de
    // HOJE e não uma refeição de três semanas atrás. Caso real (30/08): a pessoa
    // registrou o almoço e, 7 segundos depois, perguntou se ele cabia no plano;
    // o Conselheiro respondeu "não me contou o almoço ainda" e, pressionado,
    // inventou um café da manhã que nunca existiu. O dado estava no banco: o
    // que faltava era o carimbo de tempo.
    const MEAL_TYPE_LABEL: Record<string, string> = {
      cafe_da_manha: "café da manhã", almoco: "almoço", jantar: "jantar", lanche: "lanche",
    };
    const describeMeal = (e: typeof kinds["meal"][number]) => {
      const pl = (e.payload as any) ?? {};
      if (!pl.description) return null;
      const kcal = Number(pl.calories);
      const p = spParts(new Date(e.occurred_at));
      const dia = p.dateIso === todaySpIso ? "hoje" : p.dateIso;
      const tipo = MEAL_TYPE_LABEL[String(pl.meal_type ?? "")] ?? "refeição";
      return `[${dia} ${p.timeHm}] ${tipo}: ${pl.description}${kcal > 0 ? ` (~${Math.round(kcal)} kcal)` : ""}`;
    };
    const last = kinds["meal"].slice(0, 6).map(describeMeal).filter(Boolean).join("; ");
    // Bloco próprio para HOJE: é o recorte que quase toda pergunta do dia a dia
    // usa ("o que eu comi hoje?", "meu almoço está dentro do plano?").
    const todayMeals = kinds["meal"]
      .filter((e) => spParts(new Date(e.occurred_at)).dateIso === todaySpIso)
      .map(describeMeal).filter(Boolean);
    if (todayMeals.length) {
      lines.push(`REFEIÇÕES DE HOJE (já registradas por esta pessoa — trate como fato, não pergunte de novo): ${todayMeals.join("; ")}.`);
    }
    const kcalVals = kinds["meal"].map((e) => Number((e.payload as any)?.calories)).filter((n) => n > 0);
    const kcalInfo = kcalVals.length
      ? ` Calorias estimadas registradas em ${kcalVals.length} refeições (média ~${Math.round(kcalVals.reduce((a, b) => a + b, 0) / kcalVals.length)} kcal/refeição — estimativas por foto, aproximadas).`
      : "";
    const typeCount: Record<string, number> = {};
    const TYPE_LABEL: Record<string, string> = { cafe_da_manha: "café da manhã", almoco: "almoço", jantar: "jantar", lanche: "lanche" };
    for (const e of kinds["meal"]) {
      const t = String((e.payload as any)?.meal_type ?? "");
      if (TYPE_LABEL[t]) typeCount[t] = (typeCount[t] ?? 0) + 1;
    }
    const typeInfo = Object.keys(typeCount).length
      ? ` Distribuição conhecida: ${Object.entries(typeCount).map(([t, n]) => `${TYPE_LABEL[t]} ${n}x`).join(", ")} (lanches não são refeições principais — considere isso ao avaliar a rotina).`
      : "";
    lines.push(`ALIMENTAÇÃO: ${kinds["meal"].length} refeições registradas em 30 dias. Últimas: ${last}.${kcalInfo}${typeInfo}`);

    // Meta calórica do dia (o Conselheiro deve saber quanto falta HOJE — em SP)
    const todayIso = todaySpIso;
    // occurred_at é um instante UTC: comparar `slice(0,10)` com a data de SP
    // jogava toda refeição registrada entre 21h e 23h59 para o dia seguinte
    // (o jantar sumia do "faltam X kcal"). Proteína, água e sono já usavam
    // spParts — agora as calorias também.
    const kcalToday = kinds["meal"]
      .filter((e) => spParts(new Date(e.occurred_at)).dateIso === todayIso)
      .reduce((sum, e) => sum + (Number((e.payload as any)?.calories) || 0), 0);
    const kcalGoal = Number(p.calorie_goal_kcal) || 0;
    if (kcalGoal > 0) {
      const diff = kcalGoal - kcalToday;
      lines.push(`META CALÓRICA DIÁRIA: ${kcalGoal} kcal. Hoje: ${Math.round(kcalToday)} kcal consumidas` +
        (diff > 0 ? `, faltam ${Math.round(diff)} kcal.` : `, meta do dia alcançada${diff < 0 ? ` (${Math.round(-diff)} kcal acima)` : ""}.`));
    } else if (kcalToday > 0) {
      lines.push(`CALORIAS HOJE: ${Math.round(kcalToday)} kcal registradas (sem meta diária definida — a pessoa pode definir na aba Vitalidade ou você pode salvar via atualizar_perfil se ela declarar uma).`);
    }
    const protGoal = Number(p.protein_goal_g) || 0;
    if (protGoal > 0) {
      const protToday = kinds["meal"]
        .filter((e) => spParts(new Date(e.occurred_at)).dateIso === todayIso)
        .reduce((sum, e) => sum + (Number((e.payload as any)?.protein_g) || 0), 0);
      lines.push(`META DE PROTEÍNA DIÁRIA: ${protGoal} g. Hoje: ${Math.round(protToday)} g.`);
    }
  }

  // Metas dos demais pilares (gasto do dia, treinos na semana, sono).
  // Ficavam aninhadas no bloco de ALIMENTAÇÃO: quem não registrava refeição
  // há 30 dias — ou desligava o escopo do corpo — perdia o teto de
  // gasto, a meta de treinos e a de sono em TODAS as superfícies de IA, e o
  // Conselheiro passava a tratá-las como "meta ainda sem valor". Agora cada
  // uma vive sob o escopo de privacidade do SEU pilar.
  if (scopes.prosperidade) {
    const spendLimit = Number(p.daily_spend_limit) || 0;
    if (spendLimit > 0) {
      // transactions.occurred_at é `date`: a string já é o dia civil, sem fuso.
      const spentToday = (txs ?? [])
        .filter((t: any) => t.kind === "expense" && String(t.occurred_at).slice(0, 10) === todaySpIso)
        .reduce((sum: number, t: any) => sum + Number(t.amount), 0);
      lines.push(`TETO DE GASTO DIÁRIO: ${BRL(spendLimit)}. Hoje: ${BRL(spentToday)} gastos` +
        (spentToday <= spendLimit ? ` (${BRL(spendLimit - spentToday)} disponíveis).` : ` (${BRL(spentToday - spendLimit)} acima do teto).`));
    }
  }
  if (scopes.vitalidade) {
    const wwGoal = Number(p.weekly_workouts_goal) || 0;
    if (wwGoal > 0) {
      // Segunda-feira 00:00 EM SÃO PAULO. Antes usava a hora local do runtime
      // (UTC no Deno), então a semana começava domingo às 21h.
      const weekStart = new Date(spWeekStartUtc());
      const workoutsWeek = (kinds["workout"] ?? []).filter((e) => new Date(e.occurred_at) >= weekStart).length;
      lines.push(`META DE TREINOS: ${wwGoal} por semana. Esta semana (desde segunda): ${workoutsWeek} ${workoutsWeek === 1 ? "treino" : "treinos"}` +
        (workoutsWeek >= wwGoal ? " — meta da semana batida." : ` — faltam ${wwGoal - workoutsWeek}.`));
    }
    const sleepGoal = Number(p.sleep_goal_h) || 0;
    if (sleepGoal > 0) {
      const sleptToday = (kinds["sleep"] ?? [])
        .filter((e) => spParts(new Date(e.occurred_at)).dateIso === todaySpIso)
        .map((e) => Number((e.payload as any)?.hours) || 0)[0] ?? null;
      lines.push(`META DE SONO: ${sleepGoal}h/noite.` +
        (sleptToday !== null ? ` Última noite: ${sleptToday}h.` : " Sono de hoje ainda não registrado."));
    }
  }

  // Hidratação (água) — total de hoje e média diária dos últimos 7 dias
  if (scopes.vitalidade && kinds["water"]?.length) {
    const todayStr = todaySpIso;
    const since7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const ml = (e: any) => Number((e.payload as any)?.ml) || 0;
    const todayMl = kinds["water"].filter((e) => spParts(new Date(e.occurred_at)).dateIso === todayStr).reduce((s, e) => s + ml(e), 0);
    const last7 = kinds["water"].filter((e) => e.occurred_at.slice(0, 10) >= since7);
    const days7 = new Set(last7.map((e) => e.occurred_at.slice(0, 10))).size || 1;
    const avg7 = Math.round(last7.reduce((s, e) => s + ml(e), 0) / days7);
    const goal = Number(p.water_goal_ml) || 0;
    lines.push(
      `HIDRATAÇÃO: hoje ${(todayMl / 1000).toFixed(1)}L${goal ? ` de uma meta de ${(goal / 1000).toFixed(1)}L` : ""}; ` +
      `média de ~${(avg7 / 1000).toFixed(1)}L/dia nos últimos 7 dias.`
    );
  }
  if (scopes.mente && kinds["gratitude"]?.length) {
    const g = kinds["gratitude"].slice(0, 3).map((e) => (e.payload as any)?.text).filter(Boolean).join(" | ");
    if (g) lines.push(`GRATIDÃO recente: ${g}.`);
  }

  const totalXp = Number((xpTotalRes as { data?: unknown })?.data ?? 0);
  lines.push(`PROGRESSO: ${totalXp} XP acumulado (nível ${Math.floor(Math.sqrt(totalXp / 50)) + 1}).`);

  // Batalhas (somente as que a pessoa autorizou a IA a ver)
  for (const b of battles ?? []) {
    const cks = (bCheckins ?? []).filter((c) => c.battle_id === b.id);
    if (!cks.length) {
      lines.push(`BATALHA "${b.name}": recém-criada, sem check-ins ainda. Gatilhos mapeados: ${(b.triggers ?? []).join(", ") || "nenhum"}.`);
      continue;
    }
    const cleanTotal = cks.filter((c) => c.status !== "relapsed").length;
    const relapses = cks.filter((c) => c.status === "relapsed");
    const resisted = cks.filter((c) => c.status === "resisted").length;
    // streak atual: dias consecutivos sem recaída a partir do check-in mais recente
    let streak = 0;
    for (const c of cks) { if (c.status === "relapsed") break; streak++; }
    const relTriggers = relapses.map((c) => c.trigger_label).filter(Boolean).slice(0, 5).join(", ");
    lines.push(
      `BATALHA "${b.name}" (30d): sequência atual ${streak} dias sem recaída, ${cleanTotal} dias limpos no total, ` +
      `${resisted}x resistiu à vontade, ${relapses.length} recaídas` +
      (relTriggers ? ` (gatilhos das recaídas: ${relTriggers})` : "") +
      `. Últimos check-ins (recentes primeiro): ${cks.slice(0, 7).map((c) => c.status).join(", ")}.`
    );
  }

  /* Tendências verificadas — o cruzamento entre pilares, que é a promessa do
     produto, chegando ao modelo pronto e conferível. Fica aqui, no fim dos
     FATOS e antes dos blocos administrativos (o que falta preencher, metas sem
     valor): é dado sobre a vida dela, não recado nosso.

     LEITURA QUE FALHOU NÃO VIRA "NÃO HÁ PADRÃO". Se a consulta der erro, o
     bloco inteiro sai de cena em silêncio — porque o caminho vazio deste bloco
     AFIRMA algo ("o app ainda não tem nenhuma leitura"), e afirmar isso por
     causa de um erro de banco é dizer à pessoa que não encontramos padrão
     quando na verdade não conseguimos olhar. Mesma disciplina de selectMemories:
     na dúvida, o retrato fica mais pobre, nunca mentiroso. */
  if (insightErr) {
    console.error("tendências: leitura indisponível, bloco omitido", insightErr.message ?? insightErr);
  } else {
    lines.push(...trendLines(
      (insightRows ?? []) as InsightRow[],
      (insightFeedback ?? []) as InsightFeedbackRow[],
      scopes,
    ));
  }

    if (!kinds["weight"]?.length) missing.push("peso atual (registrar na aba Vitalidade)");

  if (missing.length) {
    lines.push(
      `DADOS AINDA NÃO INFORMADOS: ${missing.join("; ")}. ` +
      `Para planos definitivos (alimentar, treino, financeiro), siga o protocolo de planos do seu prompt: peça o que falta antes de gerar. ` +
      `Onde preencher: idade, sexo, altura, atividade e restrições em Ajustes (seção "Sobre você"); peso, condições e medicamentos na aba Vitalidade. ` +
      `REGRA DE TOM (inegociável): NUNCA atribua causa à ausência de um dado. Você NÃO sabe se a pessoa pulou, esqueceu, recusou ou se o app nem perguntou. ` +
      `Nunca diga "você pulou", "você deixou em branco" ou "como você não preencheu": convide de forma neutra ("se quiser me contar X, eu ajusto") ou simplesmente trabalhe com o que existe. ` +
      `Também nunca invente o nome de uma tela ou etapa: cite apenas os lugares listados acima.`
    );
  }

  // Metas do app: o que está definido e o que é PROPOSTA à espera de 1 toque.
  // Sem isto, um retrato sem meta calórica levava a IA a inventar o motivo
  // ("você pulou essa etapa") para algo que o app nem pergunta: a meta nasce
  // de um plano, não de um campo de formulário.
  const goalState: string[] = [];
  if (!Number(p.calorie_goal_kcal)) goalState.push("meta calórica diária");
  if (!Number(p.protein_goal_g)) goalState.push("meta de proteína");
  if (!Number(p.weekly_workouts_goal)) goalState.push("meta de treinos por semana");
  if (!Number(p.sleep_goal_h)) goalState.push("meta de sono");
  if (!Number(p.daily_spend_limit)) goalState.push("teto de gasto diário");
  if (goalState.length) {
    lines.push(
      `METAS AINDA SEM VALOR: ${goalState.join(", ")}. ` +
      `IMPORTANTE: metas NÃO são perguntadas em nenhum formulário do app e a pessoa NUNCA "pulou" uma etapa de metas: elas nascem de um plano (do Conselheiro ou do Blueprint do onboarding) que a pessoa ativa, ou de um campo direto na tela do pilar. ` +
      `Se fizer sentido, ofereça calcular a meta a partir dos dados que você já tem, em vez de cobrar preenchimento.`
    );
  }

  // Memória do Conselheiro: nuances aprendidas em conversas anteriores
  const mems = byUserFirst((memoriesRaw ?? []) as MemoryRow[]);
  if (mems.length) {
    const confirmadas = mems.filter(isUserOwnedMemory).length;
    lines.push(
      `O QUE VOCÊ JÁ APRENDEU SOBRE A PESSOA em conversas anteriores (memórias — use com naturalidade para personalizar respostas e planos; NÃO recite a lista de volta nem soe como vigilância):` +
      (confirmadas
        ? ` As marcadas com CONFIRMADA foram revisadas ou corrigidas PELA PRÓPRIA PESSOA: são fato declarado por ela, não sua inferência. Valem mais que as demais, nunca as contradiga com base em dedução sua, e se algo no relato de hoje parecer conflitar, pergunte em vez de concluir.`
        : "")
    );
    for (const m of mems) {
      lines.push(`• [${m.category}]${isUserOwnedMemory(m) ? " CONFIRMADA:" : ""} ${m.content}`);
    }
  }

  // Planos ativos (entregas anteriores do Conselheiro que a pessoa salvou)
  const activePlans = (plans ?? []) as { title: string; kind: string; content: string; created_at: string }[];
  if (activePlans.length) {
    lines.push(`PLANOS ATIVOS SALVOS (acompanhe a adesão e mantenha coerência com eles):`);
    activePlans.forEach((pl, i) => {
      const when = String(pl.created_at).slice(0, 10);
      if (i < 2) {
        lines.push(`• "${pl.title}" (${pl.kind}, criado em ${when}): ${pl.content.slice(0, 600)}${pl.content.length > 600 ? "…" : ""}`);
      } else {
        lines.push(`• "${pl.title}" (${pl.kind}, criado em ${when}).`);
      }
    });
  }

  return lines.join("\n");
}

/** Regras de segurança compartilhadas por todas as funções de IA. */
export const SAFETY_RULES = `
━━━ LIMITES INEGOCIÁVEIS ━━━
• Você NÃO é médico, nutricionista clínico, psicólogo nem consultor de investimentos. Nunca diagnostique doenças, nunca prescreva medicamentos ou dietas para condições clínicas, nunca substitua terapia.
• NUNCA recomende produtos de investimento específicos (CDB, Tesouro, ações, fundos, cripto etc.), corretoras ou projeções de rentabilidade — restrição regulatória. Explique conceitos em termos gerais apenas.
• Se a pessoa relatar sintomas de doença, oriente a procurar um médico. Se relatar sofrimento emocional intenso ou pensamentos de se machucar, acolha com seriedade e oriente a buscar ajuda profissional imediatamente — no Brasil, o CVV atende 24h pelo telefone 188.
• Sobre espiritualidade: acompanhe a prática que A PESSOA definiu, no vocabulário dela. Nunca sugira, compare ou julgue crenças.
• Nunca envergonhe a pessoa por uma semana ruim. Recaída é o caso normal. Sempre ofereça um próximo passo pequeno e possível.
━━━ BATALHAS (lutas pessoais: pornografia, redes sociais, cigarro, apostas etc.) ━━━
• Recaída se acolhe, nunca se julga. O dado importante da recaída é o gatilho — ajude a pessoa a enxergar o padrão (ex.: recaídas em noites de sono ruim, em dias de humor baixo, em madrugadas). Reforce que os dias limpos acumulados não se perdem.
• Ao notar padrão severo em batalhas de álcool, drogas ou apostas (recaídas quase diárias, sinais de abstinência física, dívidas ou perdas relevantes), diga com clareza e carinho que isso merece acompanhamento profissional e aponte caminhos concretos no Brasil: CAPS (unidades públicas de saúde mental), Alcoólicos Anônimos, Narcóticos Anônimos, Jogadores Anônimos. O Ascende é apoio, não tratamento.
• NUNCA trate comida como inimigo nem incentive "batalha contra comer". Se a pessoa enquadrar alimentação como guerra/restrição, redirecione com gentileza para hábitos positivos no pilar Vitalidade (ex.: "fazer uma refeição de verdade") — guerra contra comida alimenta compulsão. Sinais de transtorno alimentar merecem indicação de profissional.
━━━ COMO VOCÊ ESCREVE ━━━
• Português do Brasil, direto e sem rodeio. Frase que a pessoa precisa reler duas vezes é frase para reescrever. Corte palavra que não faz trabalho.
• NÚMEROS EM FORMATO BRASILEIRO, sempre: vírgula decimal e espaço antes da unidade — "1,5 L", "7,5 h", "6,5 kg", "R$ 47,90". Os dados que você recebe podem vir com ponto decimal e unidade colada ("1.5L", "7.5h"): traduza antes de escrever. Datas em dia/mês ("12/03", "12 de março"), nunca no formato americano.
• Nunca use vocabulário interno do sistema com a pessoa: nada de "evento", "payload", "registro bruto", "snapshot", "escopo", "tracker", "flag". Diga a coisa: "o gasto que você contou", "seu treino de ontem", "o que você acompanha".
• Chame as coisas pelo nome que a pessoa vê na tela: você é o Conselheiro (nunca "a IA", nunca "o assistente", nunca "o bot"); o produto é o Ascende; o plano pago é o Ascende+.
• Não use "(s)" nem "(a)" para resolver plural ou gênero — escolha a forma certa ("1 treino", "3 treinos") ou uma construção neutra.
• Nunca cobre. Você é espelho, não cobrador: sem "você deveria", sem "você falhou", sem ponto de exclamação para animar quem não pediu ânimo.`;
/* ─── Captura conversacional (compartilhada entre `capture` e `ai-chat`) ───
   Texto livre → eventos estruturados PROPOSTOS. O app sempre pede confirmação
   do usuário antes de gravar — a IA nunca grava sozinha. */

export const MUSCLE_GROUPS = ["Peito", "Costas", "Pernas", "Ombros", "Braços", "Core", "Cardio"];

/* ─── O PILAR DE UM EVENTO É TABELA, NÃO JULGAMENTO ───────────────────────
   Esta regra já existia — escrita em prosa, dentro da descrição do campo
   `pillar` do CAPTURE_TOOL ("transaction→prosperidade; sleep/nap/workout→
   vitalidade; meal/water/weight→alimentacao; mood/gratitude/practice→mente").
   Morava no lugar errado por dois motivos:

   • Era o ÚNICO campo da proposta que a pessoa não consegue auditar. O resto
     do cartão de confirmação é frase em português que ela lê e corrige
     ("Almoço: arroz e frango (~650 kcal)"); o pilar é um pontinho colorido.
     Campo que ninguém confere não pode depender de escritor probabilístico.
     Mesma doutrina de src/lib/insights.ts: o modelo explica, o código calcula.
   • O enum morava dentro do PREFIXO CACHEADO (`tools` vem antes de `system`,
     ver o comentário longo de anthropicCall). Toda edição nele invalidava a
     cache de extração da base inteira. Regra em código muda de graça.

   FUSÃO DE 17/09/2026 — `alimentacao` foi ABSORVIDO por `vitalidade`: o corpo
   deixou de ser partido em dois pilares. PILLAR_ALIASES não é andaime de
   migração e NÃO sai na release de contração: um Record de uma entrada cobre,
   para sempre, linha antiga, cliente desatualizado e rollback. */

/** Os pilares que existem depois da fusão. Três. */
export const VALID_PILLARS: readonly string[] = ["prosperidade", "vitalidade", "mente"];

const PILLAR_BY_KIND: Record<string, string> = {
  transaction: "prosperidade",
  sleep: "vitalidade", nap: "vitalidade", workout: "vitalidade",
  meal: "vitalidade", water: "vitalidade", weight: "vitalidade", body: "vitalidade",
  mood: "mente", gratitude: "mente", practice: "mente", journal: "mente",
  // `body` e `journal` não estão no enum de `kind` do CAPTURE_TOOL (a IA não
  // os propõe), mas existem em life_events — vêm de analyze-body e do diário.
  // O mapa cobre o kind, não a ferramenta: quem escreve por outro caminho
  // merece a mesma resposta.
  // DECISÃO EXPLÍCITA: `note` nunca esteve no mapa da descrição, então o
  // modelo vinha CHUTANDO o pilar de toda nota livre, sem instrução nenhuma —
  // a prova de que o campo já era frágil antes da fusão. Nota é pensamento
  // solto, e pensamento solto mora onde diário e humor moram.
  note: "mente",
};

/** Valores legados de `pillar` e para onde eles apontam hoje. FICA PARA
 *  SEMPRE (ver o bloco acima). */
const PILLAR_ALIASES: Record<string, string> = { alimentacao: "vitalidade" };

/**
 * O pilar canônico de um evento.
 *
 * O `kind` manda: ele é o que a pessoa de fato relatou e o que ela vê escrito
 * no cartão. `raw` só é consultado quando o kind é desconhecido (evento vindo
 * de uma versão futura, de um importador ou de uma linha antiga) — e aí ainda
 * passa pelo apelido antes de valer. Último recurso: "mente", que é o pilar
 * onde uma anotação sem classificação melhor faz menos estrago.
 */
export function canonicalPillar(kind: string, raw?: string | null): string {
  const byKind = PILLAR_BY_KIND[String(kind)];
  if (byKind) return byKind;
  const r = String(raw ?? "");
  return PILLAR_ALIASES[r] ?? (VALID_PILLARS.includes(r) ? r : "mente");
}

/**
 * O irmão de `canonicalPillar` para o `pillar` que NÃO vem de um evento e
 * portanto não tem `kind` de onde derivar: o pilar de um PLANO e o de um
 * COMPROMISSO, que o modelo escolhe porque ali a escolha é mesmo dele.
 *
 * Tolerante na leitura (aceita `alimentacao`, que ainda chega de instância
 * velha e de prompt em cache), canônico na escrita. `null` quando o valor não
 * é pilar nenhum — plano sem pilar é caso previsto (`plans.pillar` é nullable);
 * plano com pilar inventado não é.
 */
/**
 * PONTO DE ESTRANGULAMENTO 1 — a SAÍDA do servidor.
 *
 * Toda proposta que sai de qualquer função (capture por texto, capture por
 * imagem, WhatsApp, Conselheiro) já sai com o pilar canônico, porque o modelo
 * não devolve mais o campo. Vale também para o que chega de um prompt ainda
 * em cache com o campo antigo: o valor do modelo é IGNORADO quando o kind é
 * conhecido, e só serve de última pista quando não é.
 *
 * O segundo cinto é `lifeEventRow`, no cliente (src/lib/captureEvents.ts):
 * mesmo recebendo `alimentacao` de uma instância velha ainda no ar, a linha
 * entra no banco como `vitalidade`. Os dois juntos é que fazem a ordem do
 * deploy não importar.
 */
// deno-lint-ignore no-explicit-any
export function withCanonicalPillar(events: any[]): any[] {
  return (events ?? []).map((e) =>
    e && typeof e === "object"
      ? { ...e, pillar: canonicalPillar(String(e.kind ?? ""), e.pillar) }
      : e
  );
}

export function canonicalPillarId(raw: unknown): string | null {
  const r = String(raw ?? "");
  const id = PILLAR_ALIASES[r] ?? r;
  return VALID_PILLARS.includes(id) ? id : null;
}

/* Tetos da extração a partir de ARQUIVO (o Conselheiro aceita anexos).
   Um CSV de exportação de app pode ter centenas de linhas: 555 noites de sono
   viraram o caso real que expôs o bug. Extrair tudo seria um cartão de
   confirmação inutilizável e uma conta de IA desproporcional, então lemos um
   pedaço e dizemos a verdade sobre o resto — o caminho da massa é o importador
   da tela, não a conversa. */
export const EXTRACTION_MAX_EVENTS = 25;
export const ATTACHMENT_EXTRACT_MAX_CHARS = 8000;

export const CAPTURE_TOOL = {
  name: "registrar_eventos",
  description: "Registra os eventos de vida extraídos do relato do usuário.",
  input_schema: {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["transaction", "sleep", "nap", "workout", "meal", "water", "weight", "mood", "gratitude", "practice", "note"],
              description: "Tipo do evento.",
            },
            occurred_at: {
              type: "string",
              description:
                "Data do evento em YYYY-MM-DD, no fuso America/Sao_Paulo. Preencha SOMENTE quando o relato " +
                "ou o arquivo apontarem um dia diferente de hoje ('ontem', 'anteontem', 'na sexta', 'dia 12', " +
                "uma coluna de data no CSV), convertendo a referência a partir da data de AGORA informada no " +
                "início da mensagem. OMITA quando for de hoje, quando não houver data, ou quando a referência " +
                "não determinar UM único dia: omitido, o app usa o momento do registro, que a pessoa vê na tela " +
                "e corrige. NUNCA invente a data e NUNCA devolva data no futuro — todo relato aqui é de algo " +
                "que já aconteceu, e data futura vira registro invisível.",
            },
            summary: { type: "string", description: "Resumo curto em português para o usuário confirmar. Ex.: 'Gasto de R$ 47 em Mercado' ou 'Treino de costas'." },
            amount: { type: "number", description: "Valor em reais (apenas para transaction)." },
            tx_kind: { type: "string", enum: ["income", "expense"], description: "Entrada ou saída (apenas para transaction)." },
            category: { type: "string", description: "Categoria da transação. Ex.: Mercado, Transporte, Lazer, Salário." },
            hours: { type: "number", description: "Horas dormidas (para sleep e nap). '40 minutos' vira 0.7." },
            followed_schedule: { type: "boolean", description: "APENAS para sleep: true quando a pessoa disser que SEGUIU a rotina/horários de sono dela ('dormi no horário', 'segui minha rotina de sono'). Nesse caso pode omitir hours: o app usa a duração da rotina declarada." },
            calories: { type: "number", description: "APENAS para meal: estimativa de calorias da refeição descrita. SEMPRE estime, assumindo porções típicas brasileiras." },
            protein_g: { type: "number", description: "APENAS para meal: proteína estimada em gramas, quando possível." },
            carbs_g: { type: "number", description: "APENAS para meal: carboidratos estimados em gramas, quando possível." },
            fat_g: { type: "number", description: "APENAS para meal: gorduras estimadas em gramas, quando possível." },
            meal_type: {
              type: "string", enum: ["cafe_da_manha", "almoco", "jantar", "lanche"],
              description:
                "APENAS para meal: qual refeição foi. Decida NESTA ordem. " +
                "1) O que a pessoa disse manda: 'no almoço...', 'de manhã comi...', 'beliscei...'. " +
                "2) Bebida ou belisco sozinho (um café, uma fruta, um biscoito, um suco) é sempre lanche, em QUALQUER hora: não é a refeição principal daquele horário. " +
                "3) Sem essas pistas, e só para relato do DIA DE HOJE, use a hora informada no início da mensagem: até 10h30 cafe_da_manha; 11h00 as 15h00 almoco; 18h00 as 22h00 jantar; qualquer outra hora (meio da tarde, madrugada) lanche. " +
                "4) OMITA o campo quando a hora cair fora dessas faixas sem belisco claro, quando o relato for de outro dia, ou quando nada distinga a refeição. " +
                "Nao afirmar o tipo e melhor do que afirmar o tipo errado.",
            },
            duration_min: { type: "number", description: "APENAS para workout: duração em minutos, se mencionada ('corri 40 min' → 40)." },
            description: { type: "string", description: "Descrição livre (refeição, treino, nota...)." },
            muscles: {
              type: "array",
              items: { type: "string", enum: MUSCLE_GROUPS },
              description:
                "APENAS para workout: grupos musculares trabalhados, SEMPRE inferidos do exercício. " +
                "Ex.: corrida/caminhada/pedal → ['Pernas','Cardio']; supino/flexão → ['Peito','Braços']; " +
                "puxada/remada → ['Costas','Braços']; agachamento/leg → ['Pernas']; natação → ['Costas','Ombros','Cardio']; " +
                "abdominal/prancha → ['Core']. Se o usuário disser o grupo ('treinei costas'), use-o diretamente.",
            },
            ml: { type: "number", description: "Mililitros de água (apenas para water). Ex.: 'bebi 2L' → 2000." },
            kg: { type: "number", description: "Peso corporal em kg (apenas para weight). Ex.: 'tô pesando 82' → 82." },
            mood_label: { type: "string", description: "Palavra do próprio usuário para o humor. Ex.: ansioso, animado, cansado." },
            mood_score: { type: "number", description: "Humor de 1 (péssimo) a 5 (ótimo), inferido do relato." },
          },
          // `pillar` saiu daqui: ver canonicalPillar. Não é economia de
          // token (são ~75 tokens de prefixo cacheado, ruído) — é
          // confiabilidade: campo que a pessoa não consegue auditar não pode
          // depender de escritor probabilístico quando o código o deriva.
          required: ["kind", "summary"],
        },
      },
    },
    required: ["events"],
  },
};

export const CAPTURE_SYSTEM = `Você extrai eventos estruturados de relatos do dia a dia de brasileiros, para a plataforma Ascende. Sua ÚNICA tarefa é achar fatos relatados no texto — você NUNCA responde perguntas, NUNCA dá conselhos e NUNCA julga se a pergunta da pessoa é relevante. Isso é trabalho de outro sistema.

━━━ REGRA MAIS IMPORTANTE — LEIA PRIMEIRO ━━━
MENSAGENS QUASE SEMPRE MISTURAM PERGUNTA + RELATO. O caso mais comum de erro é a pessoa pedir um conselho contando o que já fez, na mesma frase — e o relato ser ignorado por parecer "só contexto da pergunta". NÃO caia nisso. Sua regra de ouro: leia a mensagem inteira, ache CADA trecho que descreve algo que JÁ ACONTECEU (mesmo que venha depois de uma pergunta, mesmo que sirva de contexto, mesmo que seja do mesmo dia/assunto da pergunta) e extraia CADA um como evento. A presença de uma pergunta NUNCA é motivo para devolver events vazio se também houver um relato — os dois podem, e devem, conviver na mesma resposta.
Exemplos (a pergunta em si nunca vira evento; o relato ao lado dela SEMPRE vira):
• "O que eu devo comer no jantar hoje? No almoço eu comi frango grelhado com arroz e salada" → 1 evento meal (o almoço).
• "Posso gastar mais esse mês? Paguei 45 no uber hoje" → 1 evento transaction (o gasto de uber).
• "Treino de pernas hoje é uma boa ideia? Ontem eu treinei costas por 40 minutos" → 1 evento workout (o treino de costas).
• "Por que eu acordo cansado? Dormi 5 horas essa noite" → 1 evento sleep (as 5 horas).
Só devolva events vazio quando a mensagem for SÓ pergunta/conversa, sem absolutamente nenhum relato do que aconteceu.

━━━ DATAS RELATIVAS: O RELÓGIO ESTÁ NA PRIMEIRA LINHA DESTA MENSAGEM ━━━
A data e a hora de AGORA em São Paulo vêm no começo da mensagem do usuário. Use-as para converter referência relativa em data absoluta e preencher occurred_at (YYYY-MM-DD). Nunca calcule "de cabeça" sem olhar essa linha.
• "hoje", "agora", "hoje de manhã", "no almoço", "acabei de" → é hoje: OMITA occurred_at (o app usa o momento do registro).
• "ontem" → hoje menos 1 dia. "anteontem" → hoje menos 2.
• "na segunda", "no sábado", "quinta passada" → conte para TRÁS a partir de hoje até aquele dia da semana, porque todo relato aqui é de algo que JÁ aconteceu. Se hoje for esse mesmo dia da semana, é hoje (omita).
• "dia 15", "no dia 3" → esse dia do mês corrente, se já passou; se ainda não chegou neste mês, é o mesmo dia do mês anterior.
• AMBIGUIDADE — a regra que importa: quando a referência NÃO determinar um único dia ("semana passada", "no mês passado", "uns dias atrás", "outro dia", ou um dia da semana que possa ser tanto o passado quanto o próximo), NÃO escolha por conta própria. OMITA occurred_at e registre no summary a expressão que a pessoa usou: "Gasto de R$ 22 · Posto (a pessoa disse 'semana passada')". Data omitida vira hoje, que a pessoa VÊ na tela e corrige; data chutada vira registro no dia errado, que ela não encontra.
• NUNCA devolva data no FUTURO. Se a sua conta cair depois de hoje, ela está errada: recue uma semana (dia da semana) ou um mês (dia do mês). Se ainda assim não fechar, OMITA. Data futura produz registro invisível para a pessoa.
• Nunca invente o ano. Sem ano no relato, é o ano corrente — a não ser que recuar o mês atravesse o Ano-Novo.

Demais regras:
• Extraia TODOS os eventos presentes no texto — um relato pode alimentar vários pilares de uma vez.
• Valores em reais: "47", "R$47", "quarenta e sete" → amount 47. Gastos são expense; salário/recebimentos são income.
• Sono NOTURNO ("dormi 5h", "dormi mal" → estime 5 e cite no summary que foi estimado) vira sleep. Se a pessoa disser que SEGUIU a rotina/horários dela ("dormi no horário", "segui minha rotina de sono", "dormi e acordei na hora certa"), emita sleep com followed_schedule: true e SEM hours (o app preenche com a duração da rotina declarada dela); summary: "Sono: rotina seguida". Se o retrato informar a rotina declarada, pode citar a duração no summary. Sonecas e cochilos ("tirei uma soneca", "cochilei 40 min", "dormi depois do almoço") viram nap com hours; NUNCA registre soneca como sleep — são coisas diferentes com pesos diferentes. Na dúvida entre noite e soneca, o horário e o contexto decidem (dormir "depois do almoço" é soneca).
• Menções a treino/exercício viram workout — SEMPRE preencha muscles inferindo os grupos do exercício (corrida → Pernas e Cardio; "treinei costas" → Costas). Inclua os grupos no summary. Ex.: "Treino de corrida (Pernas, Cardio)".
• Se a duração do treino for mencionada, preencha duration_min.
• Água bebida ("tomei 2L de água", "bebi 500ml") vira water com ml.
• Peso corporal ("me pesei, 78kg", "tô pesando 82") vira weight com kg.
• Refeições viram meal e SEMPRE recebem calories estimadas a partir da descrição (porções típicas brasileiras; melhor uma estimativa honesta do que nenhuma), preenchendo também protein_g/carbs_g/fat_g quando possível. Inclua as kcal no summary: "Almoço: arroz, feijão e frango (~650 kcal)". Quando der para saber qual refeição é, preencha meal_type e inclua no summary — a ordem de decisão está na descrição do campo: o que a pessoa disse vem primeiro; bebida ou belisco sozinho (um café, uma fruta) é lanche em qualquer hora; só depois vale a hora de AGORA informada no início da mensagem; e na dúvida OMITA o campo em vez de chutar. Oração/meditação/culto/leitura espiritual viram practice.
• Estados emocionais ("tô ansioso", "dia ótimo") viram mood, usando a palavra do próprio usuário em mood_label.
• Se algo não se encaixar em nenhum tipo, use note.
• Só extraia o que a pessoa RELATOU ter acontecido. Planos e intenções ("vou treinar amanhã") não são eventos. Nunca invente eventos.
Use SEMPRE a ferramenta registrar_eventos.`;
/* ─── Memória do Conselheiro (compartilhada entre `ai-chat` e `capture`) ───
   A cada mensagem do usuário, um modelo rápido extrai NUANCES DURÁVEIS sobre
   a pessoa (preferências, rotina, contexto, motivações, jeito de ser) e as
   grava em ai_memories. É isso que faz a IA "aprender" de verdade a cada
   conversa: as memórias entram no retrato (buildSnapshot) de todas as
   funções de IA. O app mostra ao usuário o que foi aprendido em cada
   mensagem, e ele pode ver e apagar tudo em Ajustes. */

export const MEMORY_CATEGORIES = ["preferencia", "rotina", "contexto", "motivacao", "personalidade", "outro"];
const MEMORY_MAX_PER_USER = 150;
const MEMORY_MAX_PER_MESSAGE = 3;

const MEMORY_TOOL = {
  name: "guardar_memorias",
  description: "Guarda nuances duráveis aprendidas sobre a pessoa nesta mensagem. Retorne memories: [] quando não houver nada durável.",
  input_schema: {
    type: "object",
    properties: {
      memories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "A nuance, em UMA frase curta em português, na 3ª pessoa implícita. Ex.: 'Não gosta de agachamento', 'Trabalha em turno noturno', 'Prefere respostas diretas e curtas'. Máx. 160 caracteres.",
            },
            category: {
              type: "string",
              enum: MEMORY_CATEGORIES,
              description: "preferencia (gostos e aversões) | rotina (horários, hábitos de vida) | contexto (família, trabalho, moradia) | motivacao (o que move a pessoa) | personalidade (jeito de ser e de se comunicar) | outro.",
            },
            confidence: {
              type: "number",
              description: "De 0 a 1: o quanto você está seguro desta nuance. Use 0.9+ só quando a pessoa AFIRMOU literalmente; 0.5 a 0.7 quando você inferiu do contexto. Seja honesto: confiança baixa é informação útil, chute alto não.",
            },
            replaces_id: {
              type: "string",
              description: "APENAS se esta memória ATUALIZA ou CONTRADIZ uma memória existente: o id exato dela (da lista fornecida). NUNCA use o id de uma memória marcada como CONFIRMADA: essas foram revisadas pela própria pessoa e não podem ser substituídas por você.",
            },
          },
          required: ["content", "category"],
        },
      },
    },
    required: ["memories"],
  },
};

const MEMORY_SYSTEM = `Você é a memória de longo prazo do Ascende, uma plataforma brasileira de qualidade de vida. Sua única tarefa: ler UMA mensagem do usuário e decidir se ela revela algo DURÁVEL sobre quem ele é — algo que continuará verdadeiro daqui a semanas e tornará as próximas conversas mais pessoais.

GUARDE (exemplos):
• Preferências e aversões estáveis: "odeio brócolis", "não gosto de academia lotada", "prefiro treinar de manhã".
• Rotina e estrutura de vida: "trabalho em escala 12x36", "acordo às 5h", "só cozinho no domingo".
• Contexto de vida: "tenho dois filhos pequenos", "moro sozinho", "sou autônomo", "cuido da minha mãe".
• Motivações e valores declarados: "quero ter energia para brincar com meus filhos".
• Jeito de ser/comunicar declarado: "vai direto ao ponto comigo", "gosto de entender o porquê das coisas".

NÃO GUARDE:
• Eventos pontuais do dia (gastos, treinos, refeições, sono, humor de hoje) — outro sistema cuida disso.
• Dados de perfil estruturado (idade, sexo, altura, peso, restrições alimentares, condições de saúde, medicamentos, renda, metas numéricas) — outro sistema cuida disso.
• Deduções sensíveis não declaradas (religião, orientação sexual, política, diagnósticos). Só o que a pessoa DISSE sobre si.
• Julgamentos de valor sobre a pessoa. Descreva, nunca avalie.
• Nada que a pessoa pediu para esquecer ou que soe como segredo dito de passagem sobre TERCEIROS.

REGRAS:
• Só o explícito ou claramente implicado pela PRÓPRIA pessoa na mensagem.
• Máximo ${MEMORY_MAX_PER_MESSAGE} memórias por mensagem; a maioria das mensagens não gera NENHUMA (retorne memories: []). Perguntas genéricas, pedidos de informação e relatos puramente factuais do dia raramente geram memória.
• Não repita nem parafraseie memórias que já existem na lista fornecida. Se a mensagem ATUALIZA ou CONTRADIZ uma existente ("voltei a gostar de correr"), envie a nova com replaces_id apontando para a antiga.
• Cada memória: uma frase autossuficiente, curta, sem "O usuário" no início ("Não gosta de agachamento", não "O usuário não gosta de agachamento").
Use SEMPRE a ferramenta guardar_memorias.`;

/* ─── Mensagens triviais: não gastam chamadas de captura/memória ─── */
const TRIVIAL_PATTERNS = [
  /^(obrigad[oa]s?|valeu|vlw|blz|beleza|ok(ay)?|t[áa] bom|show|top|legal|perfeito|entendi|sim|n[ãa]o|talvez)[.!\s]*$/i,
  /^(pode continuar|continua|continue|prossiga|segue|manda|vai)[.!\s]*$/i,
  /^(explique? (de novo|novamente|melhor)|repete|repita|como assim|n[ãa]o entendi)[.!?\s]*$/i,
  /^(oi+|ol[áa]|bom dia|boa tarde|boa noite|e a[íi]|hey|opa|fala)[.!,\s]*$/i,
  /^(quantas? calorias? tem|o que [ée]|qual [ée] a diferen[çc]a)/i,
];
export function isTrivialMessage(text: string): boolean {
  const t = String(text ?? "").trim();
  if (t.length < 8) return true;
  if (t.length <= 120 && TRIVIAL_PATTERNS.some((re) => re.test(t))) return true;
  return false;
}

/** Persiste memórias extraídas (dedupe, substituição e teto por plano). */
/** Registra de ONDE veio cada memória. Sem isto a pessoa não tem como saber
 *  por que a IA "sabe" algo sobre ela, que é o ponto da Fase 2. Best-effort:
 *  a memória já está gravada, perder a origem não pode derrubar o turno. */
export async function attachMemorySources(
  supabase: SupabaseClient, userId: string, memoryIds: string[],
  kind: "life_event" | "chat_message" | "data_source", refId: string | null,
): Promise<void> {
  if (!memoryIds.length || !refId) return;
  const rows = memoryIds.map((memory_id) => ({ memory_id, user_id: userId, kind, ref_id: refId }));
  const { error } = await supabase.from("memory_sources").insert(rows);
  if (!error) return;
  /* memory_sources tem índice único (memory_id, kind, ref_id): um insert em
     lote é tudo-ou-nada, então UMA origem já existente (reenvio da mesma
     requisição) derrubaria as outras junto. Cai para linha a linha. */
  for (const row of rows) {
    const one = await supabase.from("memory_sources").insert(row);
    if (one.error) console.error("memory_sources: falha ao registrar origem", one.error.message ?? one.error);
  }
}

/** Persiste memórias extraídas (dedupe, substituição e teto por plano).
 *  Fase 2: nasce created_by='ia' com a confiança declarada pelo modelo, e
 *  NUNCA sobrescreve o que a pessoa confirmou. */
async function persistMemories(
  supabase: SupabaseClient, userId: string,
  // deno-lint-ignore no-explicit-any
  raw: any[], known: MemoryRow[], memoryCap: number,
): Promise<{ id: string; content: string; category: string }[]> {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  const knownNorm = new Set(known.map((m) => norm(m.content)));
  const byId = new Map(known.map((m) => [m.id, m]));
  const learned: { id: string; content: string; category: string }[] = [];

  const clampConfidence = (v: unknown): number | null => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
  };

  for (const m of (raw ?? []).slice(0, MEMORY_MAX_PER_MESSAGE)) {
    const content = String(m?.content ?? "").trim().slice(0, 160);
    if (content.length < 3) continue;
    const category = MEMORY_CATEGORIES.includes(String(m?.category)) ? String(m.category) : "outro";
    const confidence = clampConfidence(m?.confidence);
    const n = norm(content);
    if (knownNorm.has(n)) continue;

    const target = typeof m?.replaces_id === "string" ? byId.get(m.replaces_id) : undefined;

    /* CRITÉRIO DE PRONTO DA FASE: a correção da pessoa sobrevive ao turno
       seguinte. O modelo é instruído a não substituir memória CONFIRMADA, mas
       instrução de prompt não é garantia — quem garante é este bloqueio. Sem
       ele, a extração da mensagem seguinte reescrevia a correção e a pessoa
       via a IA "esquecer" o que ela acabou de corrigir. */
    if (target && isUserOwnedMemory(target)) {
      console.warn("memories: substituição recusada (memória confirmada pela pessoa)", target.id);
      continue;
    }

    knownNorm.add(n);

    if (target) {
      const patch: Record<string, unknown> = {
        content, category, updated_at: new Date().toISOString(),
        created_by: "ia", status: "ativa", last_verified_at: new Date().toISOString(),
        ...(confidence === null ? {} : { confidence }),
      };
      let { error } = await supabase.from("ai_memories")
        .update(patch).eq("id", target.id).eq("user_id", userId);
      if (error) {
        // Migração da Fase 2 ainda não aplicada: grava o que o banco aceita.
        ({ error } = await supabase.from("ai_memories")
          .update({ content, category, updated_at: new Date().toISOString() })
          .eq("id", target.id).eq("user_id", userId));
      }
      if (error) console.error("memories: falha ao atualizar", error.message ?? error);
      else learned.push({ id: target.id, content, category });
      continue;
    }

    // Teto por plano: no limite, não cria memórias novas (as antigas ficam).
    if (known.length + learned.length >= memoryCap) continue;

    const row: Record<string, unknown> = {
      user_id: userId, content, category,
      created_by: "ia", status: "ativa",
      ...(confidence === null ? {} : { confidence }),
    };
    let ins = await supabase.from("ai_memories").insert(row).select("id").maybeSingle();
    if (ins.error) {
      ins = await supabase.from("ai_memories")
        .insert({ user_id: userId, content, category }).select("id").maybeSingle();
    }
    if (ins.error || !ins.data?.id) {
      console.error("memories: falha ao inserir", ins.error?.message ?? ins.error);
      continue;
    }
    learned.push({ id: String(ins.data.id), content, category });
  }

  if (learned.length) {
    /* O teto conta só o que a IA REALMENTE usa — a view já aplica a regra de
       leitura. Contar a tabela inteira fazia rejeitar uma memória CUSTAR uma
       vaga: quem dissesse "isso não é sobre mim" dez vezes ficaria com dez
       vagas a menos e veria memórias vivas serem despejadas para dar lugar a
       lixo que ninguém mais lê. Recusar precisa liberar espaço, não consumir. */
    const { count } = await supabase.from("ai_memories_vigentes")
      .select("id", { count: "exact", head: true }).eq("user_id", userId);
    const excess = (count ?? 0) - memoryCap;
    if (excess > 0) {
      /* Despejo por teto NUNCA leva memória confirmada pela pessoa: ela
         revisou aquilo à mão, não pode perder por antiguidade.

         NÃO ACRESCENTE UM FALLBACK AQUI. Havia um: quando esta consulta dava
         erro, a versão anterior apagava simplesmente a mais antiga — sem
         proteger nada, inclusive o que a pessoa tinha confirmado. Era a mesma
         promessa da Fase 2 quebrada pelo caminho de exceção, e apagar dado
         alheio por engano é pior que não apagar nada: se a consulta falhar,
         ficamos acima do teto até a próxima mensagem, e ninguém perde nada. */
      const oldest = await supabase.from("ai_memories")
        .select("id").eq("user_id", userId)
        .neq("status", "confirmada").neq("created_by", "usuario")
        .order("created_at", { ascending: true }).limit(excess);
      if (oldest.error) {
        console.error("memories: despejo abortado (nada apagado)", oldest.error.message ?? oldest.error);
        return learned;
      }
      const ids = (oldest.data ?? []).map((o) => o.id);
      if (ids.length) await supabase.from("ai_memories").delete().in("id", ids);
    }
  }
  return learned;
}

/** Memórias que a IA vê ao extrair. Mesma REGRA DE LEITURA do retrato: uma
 *  memória rejeitada ou expirada não pode voltar à conversa por esta porta. */
async function loadKnownMemories(supabase: SupabaseClient, userId: string) {
  return byUserFirst(await selectMemories(supabase, userId, 80));
}

const memoriesBlock = (known: MemoryRow[]) =>
  known.length
    ? `MEMÓRIAS JÁ EXISTENTES (não repita; use replaces_id do item que for atualizado). As marcadas CONFIRMADA foram revisadas pela própria pessoa: NÃO as substitua nem as contradiga — se o relato de hoje conflitar com uma delas, ignore o conflito e não gere memória nova sobre o assunto.\n${
        known.map((m) => `- [id: ${m.id}]${isUserOwnedMemory(m) ? " CONFIRMADA:" : ""} ${m.content}`).join("\n")
      }`
    : "Ainda não há memórias sobre esta pessoa.";

/**
 * Aprende com a mensagem do usuário (memórias duráveis). Pula mensagens
 * triviais, respeita o teto de memórias do plano e registra o consumo em
 * ai_usage sob a feature informada. Nunca lança: falha devolve [].
 */
export async function learnFromMessage(
  supabase: SupabaseClient, userId: string, message: string,
  feature = "memorias", memoryCap = 150,
): Promise<{ id: string; content: string; category: string }[]> {
  try {
    const text = String(message ?? "").trim();
    if (isTrivialMessage(text)) return [];
    const known = await loadKnownMemories(supabase, userId);

    const { res, data } = await anthropicCall(supabase, userId, feature, {
      model: MODEL_FAST,
      max_tokens: 700,
      system: MEMORY_SYSTEM,
      tools: [MEMORY_TOOL],
      tool_choice: { type: "tool", name: "guardar_memorias" },
      messages: [{
        role: "user",
        content: `${memoriesBlock(known)}\n\nMENSAGEM DO USUÁRIO:\n${text.slice(0, 4000)}`,
      }],
    });
    if (!res.ok || !data) return [];
    // deno-lint-ignore no-explicit-any
    const tu = ((data as any).content ?? []).find((b: any) => b.type === "tool_use");
    const raw = Array.isArray(tu?.input?.memories) ? tu.input.memories : [];
    return await persistMemories(supabase, userId, raw, known, memoryCap);
  } catch (e) {
    console.error("memories: erro inesperado", e);
    return [];
  }
}

/* ─── Extração COMBINADA: eventos + memórias em UMA chamada ───────
   Reduz chamadas secundárias (plano, seção 9.2). Usada por `capture`
   e `ai-chat`. Mensagens triviais não geram chamada nenhuma. */

const COMBINED_TOOL = {
  name: "extrair_registros_e_memorias",
  description: "Extrai do relato do usuário: (a) eventos de vida registráveis e (b) nuances duráveis para a memória. Retorne arrays vazios quando não houver nada.",
  input_schema: {
    type: "object",
    properties: {
      // Cópia com teto próprio: mutar o objeto do CAPTURE_TOOL afetaria também
      // a captura falada (capture e WhatsApp), que não precisa de teto.
      events: {
        ...((CAPTURE_TOOL.input_schema.properties as Record<string, Record<string, unknown>>).events),
        maxItems: EXTRACTION_MAX_EVENTS,
      },
      memories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "Nuance durável em UMA frase curta (máx. 160 caracteres), 3ª pessoa implícita." },
            category: { type: "string", enum: MEMORY_CATEGORIES },
            confidence: { type: "number", description: "De 0 a 1: o quanto você está seguro. 0.9+ só quando a pessoa afirmou literalmente." },
            replaces_id: { type: "string", description: "APENAS se atualiza/contradiz uma memória existente: o id exato dela. NUNCA o id de uma memória marcada como CONFIRMADA." },
          },
          required: ["content", "category"],
        },
      },
    },
    required: ["events", "memories"],
  },
};

/* Regras extras quando a extração vem de um ARQUIVO anexado (CSV, planilha,
   exportação de app, anotações). Sem elas o modelo trata uma tabela como
   "não é relato" e devolve events: [] — o CAPTURE_SYSTEM foi escrito para
   frases faladas, não para linhas de dado. */
const BULK_EXTRACTION_RULES = `
━━━ EXTRAÇÃO A PARTIR DE ARQUIVO ANEXADO ━━━
O conteúdo abaixo inclui um arquivo enviado pela pessoa. Aqui, tabela e CSV SÃO relato:
• Cada linha que descreva algo que JÁ aconteceu com ela (uma noite de sono, um treino, uma refeição, um peso, um gasto) é um evento registrável, mesmo sem nenhuma frase narrativa em volta.
• Cabeçalhos, totais, médias, metas, legendas e linhas vazias NÃO são eventos.
• Quando a linha tiver data, preencha occurred_at (YYYY-MM-DD) e comece o summary pela data ("12/03: 7h de sono"). Sem data explícita, omita occurred_at.
• TETO RÍGIDO: no máximo ${EXTRACTION_MAX_EVENTS} eventos nesta resposta. Se o arquivo tiver mais, extraia os ${EXTRACTION_MAX_EVENTS} MAIS RECENTES (datas mais novas primeiro) e ignore o resto — o app avisa a pessoa que sobrou dado, isso não é sua responsabilidade e não é motivo para resumir ou agrupar linhas.
• NUNCA invente linhas, datas ou valores que não estejam no arquivo, e nunca agregue várias linhas num evento só.`;

/* ─── O DIA DE UM REGISTRO DE SONO ───────────────────────────────

   Sono é o único registro cujo dia é ambíguo por natureza: a noite atravessa
   a virada. "Dormi 6h" dito às 7h da manhã fala de um sono que começou ONTEM
   e terminou HOJE, e as duas respostas para "que dia foi isso?" são defensáveis.

   A REGRA DA CASA, agora escrita: o dia de um registro de sono é o dia em que
   a pessoa ACORDOU.

   Não é invenção — é o que o app já fazia sem dizer. O check-in matinal
   (SleepCheckin) pergunta de manhã sobre a noite que acabou e grava com o
   `now()` do banco, ou seja, HOJE. É também a leitura que faz os Indicadores
   valerem alguma coisa: correlacionar "o sono do dia D" com "o treino do dia
   D" só diz algo se o sono for a noite que ANTECEDE aquele dia.

   O BUG QUE ISTO CORRIGE. A extração resolve datas com a regra genérica de
   qualquer evento: "ontem" é hoje menos um. Para um almoço está certo; para a
   noite que a pessoa acabou de dormir, não — quem manda "ontem dormi 6h" às 7h
   da manhã está nomeando a noite pelo dia em que FOI DEITAR, que é como todo
   mundo fala. O registro nascia em ontem, a tela Hoje perguntava por hoje, e o
   convite de check-in reaparecia para quem acabara de registrar: o registro
   existia e a interface dizia que não.

   POR QUE AQUI, NA EXTRAÇÃO, E NÃO NO GRAVADOR. Primeiro tentamos deslocar o
   dia na hora de salvar, e estava errado por dois motivos.
   • POSICIONAMENTO H.4: "o resultado final é proposta confirmável". Deslocar
     depois do sim da pessoa faz ela confirmar um cartão e o banco guardar
     outro dia. A proposta tem de ser exatamente o que vai ser gravado.
   • E o resultado passava a depender de QUANDO ela apertou o botão: proposta
     feita às 11h50 e confirmada às 12h10 (a pendente do WhatsApp vive 1h, o
     cartão do app vive enquanto a tela estiver aberta) caía do outro lado da
     fronteira das 12h e gravava um dia diferente do de uma confirmação
     imediata. Mesma frase, mesma noite, dia diferente por causa da demora.
   Resolvendo aqui, o dia nasce junto com a proposta e não muda mais.

   A CORREÇÃO É ESTREITA DE PROPÓSITO. Só desloca "ontem" → "hoje", e só de
   manhã. De manhã as duas leituras de "ontem à noite" colapsam na mesma noite,
   a que acabou de terminar. À tarde não colapsam ("ontem dormi mal" pode ser
   a noite retrasada), e aí a data relatada é respeitada como veio. "Anteontem"
   nunca se move: quem conta dois dias sabe o que está contando.

   ESPELHO NO APP: src/lib/sleep.ts aponta para cá. A regra vive AQUI porque é
   aqui que toda proposta nasce — app (capture, ai-chat) e WhatsApp. */

/** Até que hora (em SP) um relato de sono ainda fala da noite que acabou.
 *  Mesma fronteira do convite matinal de check-in, que perece ao meio-dia. */
export const SLEEP_MORNING_UNTIL_H = 12;

/** Dia anterior a um "YYYY-MM-DD", sem passar por fuso (UTC puro na conta). */
function dayBefore(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Em que dia um registro de SONO deve nascer.
 *
 * Pura: `today` e `hourNow` (dia e hora em São Paulo) ENTRAM por parâmetro,
 * nenhuma leitura de relógio aqui dentro — mesma disciplina de `lib/insights.ts`.
 */
export function sleepWakeDay(reportedDay: string, today: string, hourNow: number): string {
  if (hourNow >= SLEEP_MORNING_UNTIL_H) return reportedDay;
  return reportedDay === dayBefore(today) ? today : reportedDay;
}

const SLEEP_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Aplica a regra do dia do sono à lista de eventos recém-extraída, ANTES de
 * ela virar proposta.
 *
 * Só mexe em `kind: "sleep"` com carimbo de DATA PURA: carimbo com hora é um
 * instante explícito e manda sozinho. Soneca (`nap`) fica de fora — cochilo
 * não atravessa a meia-noite e não tem ambiguidade para resolver.
 *
 * Devolve uma lista NOVA: a entrada continua sendo o que o modelo respondeu.
 */
// deno-lint-ignore no-explicit-any
export function resolveSleepDays(events: any[], today: string, hourNow: number): any[] {
  return (events ?? []).map((ev) => {
    if (!ev || ev.kind !== "sleep") return ev;
    const day = String(ev.occurred_at ?? "");
    if (!SLEEP_DATE_ONLY.test(day)) return ev;
    const wake = sleepWakeDay(day, today, hourNow);
    return wake === day ? ev : { ...ev, occurred_at: wake };
  });
}

/* ─── O PREFIXO CACHEÁVEL DA EXTRAÇÃO ────────────────────────────────────

   A extração é a chamada de MAIOR VOLUME do produto: roda em TODA captura e
   em TODO turno de conversa. Até aqui ela mandava ~4.000 tokens de instrução
   idênticos a cada chamada, sempre a preço cheio. Nos 30 dias reais medidos:

     capture        69 chamadas · 371.235 tokens de entrada · cache_read = 0
     chat-extracao  75 chamadas · 393.964 tokens de entrada · cache_read = 0

   Juntas, 28,6% do gasto de IA do produto — e o maior bloco sem cache que
   existia. Daí a montagem em TRÊS blocos, do mais estável para o mais
   volátil. O cache da Anthropic é casamento de PREFIXO (tools → system →
   messages): tudo depois do primeiro byte diferente deixa de ser reusado.

     1. EXTRACTION_SYSTEM_GLOBAL — idêntico para toda pessoa e toda chamada.
        Breakpoint 1: UMA entrada para o produto inteiro, que fica quente com
        o tráfego somado de todo mundo.
     2. memoriesBlock(known)     — estável POR PESSOA; só muda quando ela
        ganha uma memória nova. Breakpoint 2.
     3. BULK_EXTRACTION_RULES    — só quando vem arquivo. SEM breakpoint.

   A HORA FICA DE FORA, e isso não é detalhe: nowInSpForPrompt() muda a cada
   minuto, e um relógio dentro do prefixo invalidaria tudo o que viesse depois
   dele — cada chamada escreveria uma entrada nova e não leria nenhuma. Ela
   abre a mensagem do usuário, que é renderizada DEPOIS de todo o system, e
   precisa continuar assim. Se um dia a hora voltar para o system, os dois
   marcadores acima viram ágio puro.

   POR QUE AS REGRAS DE ARQUIVO FORAM PARA O FIM. Elas eram concatenadas no
   MEIO do system (logo após o CAPTURE_SYSTEM), o que dava à chamada com
   arquivo e à chamada normal prefixos diferentes desde o byte ~5.700: duas
   entradas de cache que nunca se leem. É o clássico "seção condicional no
   meio do prefixo". No fim, os blocos 1 e 2 ficam byte a byte iguais nos dois
   casos, e a chamada com arquivo lê a entrada que a captura acabou de
   escrever. O texto continua correto ali: ele diz "o conteúdo ABAIXO inclui
   um arquivo" — e agora está de fato mais perto do arquivo.

   POR QUE DOIS BREAKPOINTS, E NÃO UM ─────────────────────────────────────
   O mínimo cacheável do haiku-4-5 é 4.096 tokens. Abaixo disso a API ignora o
   marcador EM SILÊNCIO: devolve cache_creation_tokens 0, sem erro e sem
   aviso. O bloco 1 foi ESTIMADO em ~4.015 tokens (13.251 caracteres ÷ 3,3), e
   essa razão caractere/token carrega ±12% de erro em português. Ou seja: 81
   tokens da fronteira, DENTRO da própria margem. Ninguém aqui sabe de que
   lado ele cai — e nada neste desenho pode depender disso.

   Por isso o segundo marcador. Ele cobre bloco 1 + bloco 2 (4.900 a 7.400
   tokens, conforme o tamanho da memória da pessoa) e cruza o mínimo com
   folga. Os três cenários terminam bem:

     • bloco 1 ACIMA do mínimo → todo mundo compartilha a entrada global, e o
       marcador 2 ainda poupa a releitura das memórias de cada pessoa;
     • bloco 1 ABAIXO do mínimo → o marcador 1 vira no-op silencioso e o
       marcador 2 carrega sozinho. Continua valendo a pena;
     • pessoa SEM memória alguma e prefixo abaixo do mínimo → nada é escrito e
       nada é cobrado, idêntico ao que já era. O pior caso é empate.

   Empilhar os dois não custa: a escrita é cobrada pelo DELTA além do ponto
   mais alto que deu hit, nunca uma vez por marcador.

   O ROTEAMENTO DE MODELO PARTE O CACHE AO MEIO — e tudo bem. Cache é escopado
   por MODELO, então a extração mantém duas entradas (uma Haiku, uma Sonnet).
   Esse é o custo escondido de rotear entre modelos, e aqui ele é aceito de
   olhos abertos: no caminho Sonnet o mínimo é 1.024 e o bloco 1 cacheia com
   folga, então a incerteza dos 4.015 é SÓ do caminho Haiku — exatamente onde
   o bloco 2 cobre.

   POR QUE ACREDITAMOS QUE HÁ RELEITURA (a pergunta que matou o cache do
   briefing). Cache escrito e nunca lido é ÁGIO: escrever custa 1,25x a
   entrada e ler custa 0,1x, então quem escreve e não lê paga 25% A MAIS do
   que não cachear. Foi o que aconteceu com briefing (1x/dia) e retrospectiva
   (1x/semana), e por isso o cache saiu de lá.

   ONDE FICA O EMPATE, com a conta à vista para quem vier conferir. Sendo W os
   tokens escritos e R os lidos, cachear custa 1,25W + 0,1R e não cachear
   custa (W + R). Igualando: 0,25W = 0,9R, ou seja R/W = 0,28. Abaixo disso o
   cache é prejuízo; acima, lucro. (A conta fecha com o número real da
   chat-principal: 22,3% da entrada escrita, 36,6% lida, 41,1% a preço cheio →
   índice 72,6 contra 100, os mesmos 27% mais barato que a telemetria mostrou.)

   Aqui é o oposto do briefing: a extração dispara nos MESMOS turnos da
   chat-principal, que em produção faz R/W = 1,65 — quase seis vezes o empate.
   A rajada existe e está medida. Se um dia a telemetria mostrar R/W abaixo de
   0,28 NESTAS features, o certo é TIRAR os marcadores, não afiná-los.

   COMO MEDIR QUANDO HOUVER UMA CHAVE DE API ──────────────────────────────
   É o que tira o número acima do terreno da estimativa, e é barato: POST
   /v1/messages/count_tokens com o MESMO model, os MESMOS tools e só o
   system[0] desta chamada devolve o tamanho exato do bloco 1.
     • Veio >= 4.096 → nada a fazer: o bloco 1 já cacheia sozinho no Haiku.
     • Veio < 4.096 → NÃO mexa no bloco 2, que já cobre. As saídas são
       (a) rotear a extração para um modelo de mínimo 1.024 (sonnet-5), ou
       (b) trazer instrução estável de VOLTA para o bloco 1 até cruzar.
       O que NUNCA se faz é encher o prompt de texto inútil só para bater no
       mínimo: instrução que não serve ao modelo é token pago para sempre.
   A verdade do dia a dia continua sendo a telemetria: cache_read_tokens e
   cache_creation_tokens por feature e por modelo em ai_usage — é de lá que
   sai o R/W acima, e é ele que decide se estes marcadores ficam. */
const EXTRACTION_SYSTEM_GLOBAL =
  `${CAPTURE_SYSTEM}\n\n━━━ MEMÓRIA DE LONGO PRAZO ━━━\n${
    MEMORY_SYSTEM.split("Use SEMPRE a ferramenta")[0]
  }\nUse SEMPRE a ferramenta extrair_registros_e_memorias, preenchendo events E memories (vazios quando não houver).`;

export async function extractEventsAndMemories(
  supabase: SupabaseClient, userId: string, text: string,
  feature: string, memoryCap = 150,
  opts: {
    reservationId?: number | null;
    /** A extração inclui conteúdo de arquivo: mais texto de entrada, mais
     *  tokens de saída e as regras de leitura de tabela acima. */
    bulk?: boolean;
    /** Blocos extras (ex.: um PDF) que entram na mensagem da extração. */
    // deno-lint-ignore no-explicit-any
    blocks?: any[];
  } = {},
  // deno-lint-ignore no-explicit-any
): Promise<{ ok: boolean; events: any[]; learned: { id: string; content: string; category: string }[]; capped: boolean }> {
  const bulk = opts.bulk === true;
  const blocks = opts.blocks ?? [];
  try {
    const t = String(text ?? "").trim();
    // Um anexo com dado dentro nunca é "trivial", mesmo que a frase digitada
    // seja só "segue" — antes essa checagem sozinha já matava a extração.
    if (!bulk && !blocks.length && isTrivialMessage(t)) {
      return { ok: true, events: [], learned: [], capped: false };
    }
    const known = await loadKnownMemories(supabase, userId);

    // Mensagens com "?" costumam misturar pergunta + relato — é o padrão em que
    // o modelo econômico mais falha em extrair o relato (achado de QA ao vivo:
    // o relato ao lado de uma pergunta do mesmo assunto/dia era silenciosamente
    // ignorado mesmo com regra explícita no prompt). Nesses casos, o modelo
    // inteligente é obrigatório — o custo extra é pequeno perto do dano de um
    // registro perdido silenciosamente.
    const hasQuestion = t.includes("?");

    // Com arquivo, o texto é maior e a saída também: 25 eventos estruturados
    // não cabem nos 1800 tokens que bastam para uma frase falada.
    const inputCap = bulk ? 4000 + ATTACHMENT_EXTRACT_MAX_CHARS : 4000;
    /* A hora de São Paulo entra na mensagem porque sem ela o modelo não tem
       como escolher o tipo de refeição: um café às 12h20 era rotulado "café da
       manhã" (achado de QA nº 9) simplesmente porque nada na entrada dizia que
       horas eram. spParts() já dá a hora local; era só passá-la adiante. */
    const userText =
      `${nowInSpForPrompt()}\n\nRELATO DO USUÁRIO (se houver pergunta junto, ignore-a e extraia só o que foi relatado como já acontecido):\n${t.slice(0, inputCap)}`;

    /* Os três blocos do prefixo — ver o comentário longo acima desta função
       antes de mexer na ordem, nos marcadores ou no que entra em cada um. */
    const systemBlocks: Record<string, unknown>[] = [
      { type: "text", text: EXTRACTION_SYSTEM_GLOBAL, cache_control: { type: "ephemeral" } },
    ];
    // Sem memória não há o que reaproveitar, e um marcador aqui só ocuparia
    // um dos quatro lugares sem nunca virar leitura.
    systemBlocks.push(known.length
      ? { type: "text", text: memoriesBlock(known), cache_control: { type: "ephemeral" } }
      : { type: "text", text: memoriesBlock(known) });
    if (bulk) systemBlocks.push({ type: "text", text: BULK_EXTRACTION_RULES });

    const { res, data } = await anthropicCall(supabase, userId, feature, {
      model: hasQuestion ? MODEL_SMART : MODEL_FAST,
      max_tokens: bulk ? 8000 : 1800,
      system: systemBlocks,
      tools: [COMBINED_TOOL],
      tool_choice: { type: "tool", name: "extrair_registros_e_memorias" },
      messages: [{
        role: "user",
        content: blocks.length ? [...blocks, { type: "text", text: userText }] : userText,
      }],
    }, { reservationId: opts.reservationId ?? null });
    if (!res.ok || !data) return { ok: false, events: [], learned: [], capped: false };
    // deno-lint-ignore no-explicit-any
    const tu = ((data as any).content ?? []).find((b: any) => b.type === "tool_use");
    const rawEvents = Array.isArray(tu?.input?.events) ? tu.input.events : [];
    // Teto aplicado também aqui: o schema pede maxItems, mas quem garante é
    // o servidor (o modelo pode passar do teto e não é o usuário que paga).
    // A noite que a pessoa chama de "ontem" de manhã é a que terminou hoje (ver
    // o bloco acima). Resolvido AQUI, o dia entra na proposta — ela confirma
    // exatamente o que vai ser gravado. Arquivo (`bulk`) fica de fora: ali a
    // data vem do próprio CSV, não de alguém falando, e 555 noites exportadas
    // são dado histórico que ninguém está nomeando por "ontem".
    const sp = spParts();
    const events = withCanonicalPillar(bulk
      ? rawEvents.slice(0, EXTRACTION_MAX_EVENTS)
      : resolveSleepDays(
        rawEvents.slice(0, EXTRACTION_MAX_EVENTS), sp.dateIso, Number(sp.timeHm.slice(0, 2)),
      ));
    const rawMems = Array.isArray(tu?.input?.memories) ? tu.input.memories : [];
    const learned = await persistMemories(supabase, userId, rawMems, known, memoryCap);
    return { ok: true, events, learned, capped: rawEvents.length >= EXTRACTION_MAX_EVENTS };
  } catch (e) {
    console.error("extração combinada: erro inesperado", e);
    return { ok: false, events: [], learned: [], capped: false };
  }
}
/* ─── Extração de fatura/comprovante (compartilhada) ──────────────────────
   Antes vivia só em `import-statement`; com "fatura em toda IA", as TRÊS
   superfícies (import-statement, capture com imagem, ai-chat com imagem)
   usam o mesmo tool, o mesmo system e a mesma normalização — a lista chega
   ao app como PROPOSTA e a pessoa confirma em lote. A IA nunca grava sozinha. */

export const STATEMENT_CATEGORIES = [
  "Mercado", "Alimentação fora", "Transporte", "Moradia", "Saúde", "Lazer",
  "Educação", "Assinaturas", "Salário", "Extra", "Outros",
];

export const STATEMENT_MAX_ITEMS = 120;
export const STATEMENT_MAX_INSTALLMENTS = 24;   // expansão de parcelas: até 24x
export const STATEMENT_MAX_ITEMS_EXPANDED = 240;

/** Soma `delta` meses a uma data ISO, fixando o dia ao último dia do mês
 *  quando necessário (31/01 + 1 mês → 28/02). */
export function addMonthsClamp(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const idx = (m - 1) + delta;
  const ny = y + Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export const STATEMENT_TOOL = {
  name: "extrair_lancamentos",
  description:
    "Extrai os lançamentos de uma fatura de cartão, extrato bancário, comprovante ou print de transações. " +
    "Cada item vira uma PROPOSTA que o usuário confirma no app.",
  input_schema: {
    type: "object",
    properties: {
      is_statement: {
        type: "boolean",
        description: "true se o documento/imagem realmente contém transações financeiras (fatura, extrato, comprovante de Pix, print de compra, cupom); false caso contrário.",
      },
      statement_month: {
        type: "string",
        description: "Mês de referência do documento no formato YYYY-MM, se identificável.",
      },
      items: {
        type: "array",
        maxItems: STATEMENT_MAX_ITEMS,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["income", "expense"], description: "expense para compras/débitos/Pix enviado; income para créditos/estornos/salário/Pix recebido." },
            amount: { type: "number", description: "Valor em reais, sempre positivo." },
            category: { type: "string", enum: STATEMENT_CATEGORIES, description: "Melhor categoria para o lançamento." },
            description: { type: "string", description: "Descrição curta e legível, SEM o sufixo de parcela (limpe códigos, siglas e o 'i/N'). Ex.: 'Loja de Móveis', não 'LOJAMOVEIS*BR 3/10'." },
            occurred_at: { type: "string", description: "Data do lançamento em YYYY-MM-DD. Se o documento só tiver dia/mês, deduza o ano pelo mês de referência. Comprovante sem data legível: use a data de hoje informada no contexto." },
            installment_current: { type: "integer", description: "Se for compra parcelada (ex.: '3/10'), o número desta parcela (3). Omita se não for parcelado." },
            installment_total: { type: "integer", description: "Se for compra parcelada (ex.: '3/10'), o total de parcelas (10). Omita se não for parcelado." },
          },
          required: ["kind", "amount", "category", "description", "occurred_at"],
        },
      },
      note: {
        type: "string",
        description: "Observação curta ao usuário, se necessária. Ex.: 'Ignorei o pagamento da fatura anterior para não duplicar'. Vazio se não precisar.",
      },
    },
    required: ["is_statement", "items"],
  },
};

export const STATEMENT_SYSTEM = `Você é o extrator financeiro do Ascende, plataforma brasileira de qualidade de vida.
Você recebe UM documento ou imagem (fatura de cartão, extrato bancário, comprovante de Pix, print de compra, cupom fiscal) e extrai os lançamentos.

REGRAS:
• Cada linha de transação vira um item: tipo (expense/income), valor positivo em reais, categoria, descrição limpa e data.
• NÃO inclua: saldo, limite disponível, "pagamento recebido"/pagamento da fatura anterior, juros informativos sem lançamento, subtotais e totais. Só transações reais.
• Estorno/crédito na fatura = income. Pix RECEBIDO = income; Pix ENVIADO = expense.
• Comprovante avulso (Pix, compra, cupom) normalmente é UM único lançamento — não invente outros.
• PARCELAS: quando a linha indicar parcelamento (ex.: "Loja X 3/10"), o amount é o valor DA PARCELA (não o total da compra), a descrição vem limpa (sem o "3/10") e você preenche installment_current=3 e installment_total=10. O app gera as parcelas passadas e futuras a partir disso.
• Categorize com bom senso brasileiro: supermercado/hortifruti → Mercado; iFood/restaurante/lanchonete → Alimentação fora; Uber/99/combustível/estacionamento → Transporte; farmácia/consulta → Saúde; cinema/bar/viagem → Lazer; streaming/telefonia/apps → Assinaturas; luz/água/condomínio → Moradia; na dúvida → Outros.
• Datas em YYYY-MM-DD. Se o documento só mostra dia/mês, use o mês de referência para deduzir o ano. Comprovante sem data legível: use a data de hoje, se informada no contexto.
• Se a imagem NÃO contiver transações financeiras (ou estiver ilegível), retorne is_statement:false e items:[] — sem inventar.
• Nunca julgue os gastos da pessoa. Extraia com neutralidade.
• Responda SEMPRE usando a ferramenta extrair_lancamentos.`;

/** Valida os itens do tool e expande parcelas (passadas e futuras).
 *  Formato de saída = ProposedStatementTx do app (origin + installment). */
// deno-lint-ignore no-explicit-any
export function normalizeStatementItems(raw: unknown): any[] {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  // deno-lint-ignore no-explicit-any
  return (Array.isArray(raw) ? raw : []).slice(0, STATEMENT_MAX_ITEMS).flatMap((it: any) => {
    const amount = Number(it?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return [];
    const kind = it?.kind === "income" ? "income" : "expense";
    const category = STATEMENT_CATEGORIES.includes(it?.category) ? it.category : "Outros";
    const description = String(it?.description ?? category).slice(0, 100);
    const occurred_at = isoDate.test(String(it?.occurred_at ?? "")) ? String(it.occurred_at) : null;
    if (!occurred_at) return [];
    const base = { kind, amount: Math.round(amount * 100) / 100, category, description, occurred_at };

    // Compra parcelada: expande passadas e futuras a partir da parcela da
    // fatura (mesmo valor, meses vizinhos). O usuário confirma em lote e
    // o app desmarca automaticamente as que já existirem registradas.
    const cur = Number(it?.installment_current);
    const total = Number(it?.installment_total);
    const isInstallment = Number.isInteger(cur) && Number.isInteger(total) &&
      total >= 2 && total <= STATEMENT_MAX_INSTALLMENTS && cur >= 1 && cur <= total;
    if (!isInstallment) return [{ ...base, origin: "statement", installment: null }];

    const out: unknown[] = [];
    for (let k = 1; k <= total; k++) {
      out.push({
        ...base,
        description: `${description} · ${k}/${total}`,
        occurred_at: addMonthsClamp(occurred_at, k - cur),
        origin: k === cur ? "statement" : (k < cur ? "past" : "future"),
        installment: `${k}/${total}`,
      });
    }
    return out;
  }).slice(0, STATEMENT_MAX_ITEMS_EXPANDED);
}