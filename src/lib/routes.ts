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
   * caminho nem virar redirect. `fase-4` = nasceu agora.
   */
  since: "legacy" | "fase-4";
}

/**
 * A tabela de rotas de /app. O App.tsx monta os <Route> a partir daqui.
 *
 * Acrescentar rota nova: adicione com `since: "fase-4"` (ou a fase corrente).
 * REMOVER ou repontar uma `legacy`: não faça. Se o seu desenho precisa disso,
 * o desenho está errado — o teste vai reprovar, e é para isso que ele existe.
 */
export const APP_ROUTES: readonly AppRoute[] = [
  { path: "", Component: Hoje, page: "Hoje", since: "legacy" },
  { path: "conselheiro", Component: Chat, page: "Chat", since: "legacy" },
  { path: "pilares", Component: Pilares, page: "Pilares", since: "legacy" },
  { path: "prosperidade", Component: Prosperidade, page: "Prosperidade", since: "legacy" },
  { path: "vitalidade", Component: Vitalidade, page: "Vitalidade", since: "legacy" },
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
  { path: "alimentacao", Component: Vitalidade, page: "Alimentacao", since: "legacy" },
  { path: "mente", Component: Mente, page: "Mente", since: "legacy" },
  { path: "batalhas", Component: Batalhas, page: "Batalhas", since: "legacy" },
  { path: "assinatura", Component: Assinatura, page: "Assinatura", since: "legacy" },
  { path: "planos", Component: Planos, page: "Planos", since: "legacy" },
  { path: "score", Component: Score, page: "Score", since: "legacy" },
  { path: "ajustes", Component: Ajustes, page: "Ajustes", since: "legacy" },
  // ─── Fase 4 ───
  { path: "jornada", Component: Jornada, page: "Jornada", since: "fase-4" },
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
  avatar: appPath("ajustes"),
} as const;

/** Rotas de /app que dependem de query string para funcionar direito. Um
 *  redirect que descarte a query quebra a função, não só o endereço. */
export const QUERY_DEPENDENT: Readonly<Record<string, string>> = {
  conselheiro: "?q=... pré-preenche a pergunta (Chat.tsx). Usado pela tela Hoje, Alimentação, Prosperidade e Batalhas.",
  assinatura: "?status=sucesso|cancelado é como o Stripe devolve a pessoa depois do checkout.",
};
