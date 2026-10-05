// ASCENDE — Registro de rotas do app (Fase 4).
//
// POR QUE ISTO EXISTE COMO DADO, E NÃO COMO JSX SOLTO NO App.tsx
//
// A Fase 4 acrescenta /app/jornada como HUB e move Pilares e Indicadores para
// dentro dele na barra de navegação. A tentação óbvia é aposentar as rotas
// antigas ou transformá-las em <Navigate> para o hub. Isso quebraria links que
// já existem no mundo e que não podemos consertar: mensagens de WhatsApp
// enviadas meses atrás, o atalho do PWA instalado no celular da pessoa, e as
// URLs de retorno gravadas dentro das sessões do Stripe.
//
// ALIAS NÃO É REDIRECT: /app/prosperidade continua RENDERIZANDO Prosperidade.
// O hub é uma porta a mais, nunca a única porta. Jogar quem clicou num link
// específico dentro de um hub e obrigá-la a caçar a seção transforma um clique
// em três — seria "simplificar" piorando.
//
// Com a tabela aqui, o App.tsx passa a montar as rotas a partir dela e o teste
// em routes.test.ts consegue provar, de fato, que nenhuma rota antiga sumiu ou
// virou redirect. Enquanto isso era JSX escrito à mão, a única garantia era
// alguém lembrar.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const Hoje = lazy(() => import("@/pages/Hoje"));
const Chat = lazy(() => import("@/pages/Chat"));
const Jornada = lazy(() => import("@/pages/Jornada"));
const Pilares = lazy(() => import("@/pages/Pilares"));
const Prosperidade = lazy(() => import("@/pages/Prosperidade"));
const Vitalidade = lazy(() => import("@/pages/Vitalidade"));
const Mente = lazy(() => import("@/pages/Mente"));
const Score = lazy(() => import("@/pages/Score"));
const Batalhas = lazy(() => import("@/pages/Batalhas"));
const Planos = lazy(() => import("@/pages/Planos"));
const Ajustes = lazy(() => import("@/pages/Ajustes"));
const Assinatura = lazy(() => import("@/pages/Assinatura"));
const Social = lazy(() => import("@/pages/Social"));
const Conta = lazy(() => import("@/pages/Conta"));

/** Prefixo da área autenticada. */
export const APP_BASE = "/app";

export interface AppRoute {
  /** Subcaminho dentro de /app. "" é a rota índice (a tela Hoje). */
  path: string;
  /** Página renderizada. NUNCA um redirecionador para as rotas `legacy`. */
  Component: LazyExoticComponent<ComponentType<unknown>>;
  /** Nome da página, para o teste falhar com mensagem legível. */
  page: string;
  /**
   * `legacy` = existia antes da Fase 4 e é CONGELADA: não pode sumir, mudar de
   * caminho nem virar redirect. Os outros valores dizem QUAL entrega criou a
   * rota — e alargar esta união é erro de compilação de propósito: acrescentar
   * rota nova obriga a passar por aqui, que é o ponto do arquivo inteiro.
   *
   * `social` não é número de fase porque o Social não tem um: os documentos o
   * chamam de trilha, não de fase. Inventar "fase-7" aqui seria registrar uma
   * procedência que não existe em lugar nenhum — e este arquivo é, antes de
   * tudo, um registro de procedência.
   */
  since: "legacy" | "fase-4" | "social" | "padrao-apple";
  /**
   * A ABA a que esta tela pertence. Ela decide duas coisas que o AppLayout
   * desenha, e por isso mora aqui, como dado, e não numa lista à parte:
   *
   *   · qual aba fica ACESA — sem isso, nas telas de segundo nível (Pilares,
   *     Vitalidade, Score…) nenhuma aba acendia, e a barra parava de responder
   *     "onde eu estou" (`tab-bars.md`: sem a seção indicada, "people can
   *     forget which area of the app they're in");
   *   · se a tela ganha o botão VOLTAR no cabeçalho — toda tela que não é a
   *     raiz da própria aba ganha.
   *
   * É campo OBRIGATÓRIO de propósito, como o `since`: rota nova não nasce sem
   * dizer de que seção é, porque uma tela sem seção é uma tela em que a pessoa
   * se perde.
   */
  secao: Secao;
}

/** As quatro abas da barra. REGISTRAR não é uma delas: é AÇÃO, não lugar. */
export type Secao = "hoje" | "jornada" | "conselheiro" | "conta";

/**
 * A tabela de rotas de /app. O App.tsx monta os <Route> a partir daqui.
 *
 * Acrescentar rota nova: adicione com `since: "fase-4"` (ou a fase corrente).
 * REMOVER ou repontar uma `legacy`: não faça. Se o seu desenho precisa disso,
 * o desenho está errado — o teste vai reprovar, e é para isso que ele existe.
 */
export const APP_ROUTES: readonly AppRoute[] = [
  { path: "", Component: Hoje, page: "Hoje", since: "legacy", secao: "hoje" },
  { path: "conselheiro", Component: Chat, page: "Chat", since: "legacy", secao: "conselheiro" },
  { path: "pilares", Component: Pilares, page: "Pilares", since: "legacy", secao: "jornada" },
  { path: "prosperidade", Component: Prosperidade, page: "Prosperidade", since: "legacy", secao: "jornada" },
  { path: "vitalidade", Component: Vitalidade, page: "Vitalidade", since: "legacy", secao: "jornada" },
  /* FUSÃO DE 17/09/2026 — `alimentacao` foi absorvido por `vitalidade`, e a
     rota continua RENDERIZANDO, nunca redirecionando. Só o `Component` mudou:
     `path` e `page` estão INTOCADOS, porque routes.test.ts compara `page`
     contra um mapa literal ("alimentacao" → "Alimentacao") e exige que os dois
     rótulos continuem distintos entre si.
     O teste impõe doze condições sobre estas duas linhas, mas NUNCA afirma
     qual componente um caminho renderiza — só que não é um <Navigate>, que é
     um `lazy()` e que o rótulo bate. Dois caminhos apontando para o mesmo
     lazy passam nas doze. Apagar a linha reprova em cinco delas.
     Quem chega por /app/alimentacao (link de WhatsApp antigo, atalho do PWA,
     favorito) cai na tela nova sem tropeço nenhum. */
  { path: "alimentacao", Component: Vitalidade, page: "Alimentacao", since: "legacy", secao: "jornada" },
  { path: "mente", Component: Mente, page: "Mente", since: "legacy", secao: "jornada" },
  { path: "batalhas", Component: Batalhas, page: "Batalhas", since: "legacy", secao: "jornada" },
  { path: "assinatura", Component: Assinatura, page: "Assinatura", since: "legacy", secao: "conta" },
  { path: "planos", Component: Planos, page: "Planos", since: "legacy", secao: "jornada" },
  { path: "score", Component: Score, page: "Score", since: "legacy", secao: "jornada" },
  { path: "ajustes", Component: Ajustes, page: "Ajustes", since: "legacy", secao: "conta" },
  // ─── Fase 4 ───
  { path: "jornada", Component: Jornada, page: "Jornada", since: "fase-4", secao: "jornada" },
  /* ─── Social ───
     A ROTA FALTOU, e o buraco só apareceu quando alguém CLICOU: o cartão em
     Pilares.tsx:180 e a linha do hub em Jornada.tsx apontavam para
     /app/social, e o caminho não existia — 404 em cima de um link que o
     próprio app oferece. É o vão clássico de trabalho em paralelo: quem fez a
     tela achou que a rota vinha junto, quem cuidava das rotas não soube que
     havia tela nova.

     É exatamente para isso que esta tabela é DADO e não JSX solto: para uma
     rota não nascer — nem morrer — sem ninguém ver. Ela não impediu o buraco
     porque ninguém passou por aqui; o que ela faz é garantir que, uma vez
     escrita, a rota tenha teste e não possa ser removida em silêncio.

     UMA rota só, e o grupo aberto vive na query (`?g=`): ver Social.tsx:99.
     Não há /app/social/:id, e é decisão — sub-rota por grupo faria o endereço
     carregar a identidade de um grupo privado. */
  { path: "social", Component: Social, page: "Social", since: "social", secao: "jornada" },
  /* ─── Conta ───
     Era uma FOLHA aberta pela quinta célula da barra, e por isso a barra tinha
     uma célula que não navegava (`tab-bars.md`: "Use a tab bar to support
     navigation, not to provide actions"). Virou lugar: ela agora fica acesa
     como as outras, e Ajustes e Assinatura — que eram abertas a partir dela —
     são da seção dela. Continua embaixo, ao alcance do polegar, que era o
     argumento original para a folha não ir para o canto de cima. */
  { path: "conta", Component: Conta, page: "Conta", since: "padrao-apple", secao: "conta" },
] as const;

/**
 * As rotas que existiam ANTES da Fase 4, escritas à mão de propósito.
 *
 * É uma cópia deliberada da tabela acima: se fosse derivada dela
 * (`APP_ROUTES.filter(...)`), apagar uma linha da tabela apagaria a expectativa
 * junto e o teste passaria feliz com a rota morta. Congelar a lista aqui é o
 * que faz a remoção DOER. Só se mexe nesta lista com decisão explícita de
 * produto — e aí o certo é discutir, não editar.
 */
export const FROZEN_LEGACY_PATHS: readonly string[] = [
  "",
  "conselheiro",
  "pilares",
  "prosperidade",
  "vitalidade",
  "alimentacao",
  "mente",
  "batalhas",
  "assinatura",
  "planos",
  "score",
  "ajustes",
] as const;

/** URL completa de uma rota de /app. `""` devolve "/app". */
export function appPath(sub: string): string {
  return sub ? `${APP_BASE}/${sub}` : APP_BASE;
}

/**
 * Rotas cujo endereço é montado À MÃO fora da SPA. São as intocáveis: o link
 * já saiu, está no histórico de conversa de alguém, gravado numa sessão de
 * cobrança ou dentro de um template aprovado pela Meta — e nós NÃO temos como
 * corrigi-lo depois.
 *
 * Levantado por grep em 05/09/2026 sobre src/, supabase/ e public/, com
 * arquivo e linha. Se você criar um link novo em mensagem, e-mail ou config
 * externa, registre aqui: inventário sem procedência não serve para decidir
 * risco, e o teste em routes.test.ts exige a procedência.
 */
export const EXTERNALLY_LINKED: Readonly<Record<string, readonly string[]>> = {
  "": [
    // As três primeiras são as MAIS travadas do produto: o botão de URL vive
    // dentro de um template aprovado pela Meta. Trocar o caminho exige nova
    // aprovação, e as mensagens já enviadas continuam com o botão antigo.
    "supabase/whatsapp_e_metas.sql:222 — template ascende_retro (botão de URL, aprovado pela Meta)",
    "supabase/whatsapp_e_metas.sql:227 — template ascende_briefing (botão de URL, aprovado pela Meta)",
    "supabase/whatsapp_e_metas.sql:232 — template ascende_retorno (botão de URL, aprovado pela Meta)",
    "public/manifest.webmanifest:2,6 — id e start_url do PWA já instalado no celular",
    "public/manifest.webmanifest:21 — atalho \"Registrar meu dia\" do PWA",
    "supabase/functions/whatsapp-webhook/index.ts:199 — cartão de confirmação da captura",
    "supabase/functions/whatsapp-webhook/index.ts:205 — mensagem de ajuda",
    "supabase/functions/whatsapp-webhook/index.ts:478 — nada pendente",
    "supabase/functions/whatsapp-webhook/index.ts:508 — \"Registrado ✓\"",
    "supabase/functions/whatsapp-webhook/index.ts:509 — falha ao gravar",
    "supabase/functions/whatsapp-webhook/index.ts:775 — WhatsApp conectado (pareamento)",
    "supabase/functions/whatsapp-webhook/index.ts:865 — captura esgotada",
  ],
  assinatura: [
    // O caso mais grave: estas URLs ficam DENTRO da sessão do Stripe e da
    // configuração do portal. Quem estiver no meio de um checkout volta para
    // a URL criada antes do deploy — mudar o caminho deixa quem acabou de
    // pagar numa tela de 404.
    "supabase/functions/create-checkout/index.ts:64 — success_url da sessão do Stripe",
    "supabase/functions/create-checkout/index.ts:65 — cancel_url da sessão do Stripe",
    "supabase/functions/customer-portal/index.ts:25 — return_url do portal de cobrança",
    "supabase/functions/whatsapp-webhook/index.ts:268 — upsell de mensagens do Conselheiro",
    "supabase/functions/whatsapp-webhook/index.ts:305 — upsell de análise de documentos",
    "supabase/functions/whatsapp-webhook/index.ts:535 — upsell no limite de captura (imagem)",
    "supabase/functions/whatsapp-webhook/index.ts:865 — upsell no limite de captura (texto)",
    "src/components/core/Paywall.tsx:96 — navigate() do paywall (interno; o roteador resolve)",
    "src/pages/Ajustes.tsx:601 — \"Ver planos\" (interno; o roteador resolve)",
  ],
  conselheiro: [
    // O modelo EMITE este link nas respostas: sai em conversa real, com ?q=.
    "supabase/functions/whatsapp-webhook/index.ts:222 — WA_SYSTEM (o próprio Conselheiro escreve o link)",
    "supabase/functions/whatsapp-webhook/index.ts:682 — desvio de arquivo grande demais para o WhatsApp",
  ],
  // ⚠ ALERTA REGISTRADO (fundador, 05/09/2026): prosperidade e vitalidade são
  // exatamente as duas que o hub /app/jornada fará PARECER redundantes aos
  // olhos de quem for simplificar depois — "já tem tudo na Jornada, para que
  // a rota solta?". São as intocáveis: o WhatsApp manda gente para elas por
  // nome, em mensagens já entregues que não podemos editar.
  prosperidade: [
    "supabase/functions/whatsapp-webhook/index.ts:635 — desvio de fatura completa para a importação",
  ],
  vitalidade: [
    "supabase/functions/whatsapp-webhook/index.ts:655 — desvio de composição corporal",
  ],
};

/**
 * MESMO RISCO, FORA DE /app: rotas públicas cujo endereço viaja em e-mail ou
 * está numa allowlist de terceiro. Um link de recuperação de senha é o link
 * velho por definição — a pessoa clica dias depois, de outro dispositivo.
 *
 * Não estão na tabela APP_ROUTES (são rotas de topo, declaradas direto no
 * App.tsx), então o teste as confere pela fonte do App.tsx.
 */
export const FROZEN_EXTERNAL_PUBLIC_PATHS: Readonly<Record<string, readonly string[]>> = {
  "/auth/callback": [
    "src/pages/Auth.tsx:185 — redirectTo do OAuth (também cadastrado na allowlist de Redirect URLs do Supabase)",
  ],
  "/auth": [
    "src/pages/Auth.tsx:235 — redirectTo do e-mail de recuperação de senha (?recovery=1)",
  ],
};

/**
 * Alvos da barra de navegação, para o AppLayout NÃO escrever caminho na mão:
 * caminho escrito à mão é como uma rota antiga morre sem ninguém ver.
 * REGISTRAR não está aqui porque é AÇÃO, não rota (foca a CaptureBar na Hoje,
 * abre a folha fora dela). O avatar aponta para Ajustes.
 */
export const NAV = {
  hoje: appPath(""),
  jornada: appPath("jornada"),
  conselheiro: appPath("conselheiro"),
  conta: appPath("conta"),
  avatar: appPath("ajustes"),
} as const;

/** A raiz de cada aba: é para onde o VOLTAR leva quando não há histórico (a
 *  pessoa abriu um link direto para /app/vitalidade, e `history.back()` a
 *  tiraria do app). */
export const RAIZ_DA_SECAO: Readonly<Record<Secao, string>> = {
  hoje: NAV.hoje,
  jornada: NAV.jornada,
  conselheiro: NAV.conselheiro,
  conta: NAV.conta,
};

/**
 * A seção de uma URL de /app, ou `null` fora dela.
 *
 * Casa pelo PRIMEIRO segmento depois de /app: `/app/vitalidade?x=1` e
 * `/app/social` com `?g=` caem na seção certa. Rota desconhecida devolve
 * `null`, e aí nenhuma aba acende — é verdade que a pessoa não está em
 * nenhuma delas.
 */
export function secaoDe(pathname: string): Secao | null {
  if (pathname !== APP_BASE && !pathname.startsWith(`${APP_BASE}/`)) return null;
  const sub = pathname.slice(APP_BASE.length).replace(/^\//, "").split("/")[0] ?? "";
  return APP_ROUTES.find((r) => r.path === sub)?.secao ?? null;
}

/** É a raiz de uma aba? As raízes não ganham VOLTAR: voltar de "Hoje" para
 *  fora do app não é navegação, é saída. */
export function ehRaizDeSecao(pathname: string): boolean {
  const limpo = pathname.replace(/\/+$/, "") || "/";
  return (Object.values(RAIZ_DA_SECAO) as string[]).includes(limpo);
}

/** Rotas de /app que dependem de query string para funcionar direito. Um
 *  redirect que descarte a query quebra a função, não só o endereço. */
export const QUERY_DEPENDENT: Readonly<Record<string, string>> = {
  conselheiro: "?q=... pré-preenche a pergunta (Chat.tsx). Usado pela tela Hoje, Alimentação, Prosperidade e Batalhas.",
  assinatura: "?status=sucesso|cancelado é como o Stripe devolve a pessoa depois do checkout.",
};
