// ASCENDE — Blueprint: o que fazer com cada chamada, sem banco e sem modelo.
//
// POR QUE ESTE ARQUIVO EXISTE SEPARADO DO index.ts
//
// A regra que importa aqui é negativa: "quem já tem proposta NÃO chama o
// modelo de novo". Uma regra negativa só se prova chamando o fluxo com um
// modelo falso e conferindo que ele NÃO foi chamado — e isso exige que o fluxo
// receba o modelo como dependência, em vez de importá-lo. Por isso a decisão
// mora aqui, pura, e o index.ts só liga as peças de verdade
// (decide.test.ts prova os ramos com `deno test`).
//
// A verdade sobre concorrência NÃO mora aqui: duas abas chegando juntas são
// resolvidas dentro do banco, por `claim_blueprint_generation` (migração
// 20261013120000). Este módulo decide o caminho rápido sem escrever nada e,
// quando é para gerar, pede ao banco — que pode responder "outra aba ganhou".

/** "Geração velha" = a função de borda que gerava morreu no meio (relógio de
 *  parede do Edge Runtime, worker reciclado). Depois disto, outra chamada pode
 *  reivindicar de novo. Um lugar só define o número: o banco recebe este valor
 *  como parâmetro em vez de ter o seu.
 *
 *  POR QUE 420 (decisão do Maestro, 13/10/2026): o teto de relógio de parede
 *  das funções de borda pagas do Supabase é 400 s. Com o limiar ACIMA dele,
 *  uma geração ainda viva nunca é tida como morta — passou de 400 s, a
 *  plataforma já a encerrou. Era 180: uma geração lenta (até 16.000 tokens de
 *  saída) podia ser reivindicada por outra aba no meio do caminho, e a mesma
 *  cortesia seria paga duas vezes. */
export const GERACAO_VELHA_SEGUNDOS = 420;

export type StatusDaLinha = "generating" | "ready" | "activated";

/** A linha de `blueprint_proposals`, só com o que a decisão lê. */
export interface Linha {
  status: StatusDaLinha;
  proposal: unknown;
  choices: unknown;
  generation_started_at: string;
  activation_result: unknown;
}

/** O que `claim_blueprint_generation` responde. */
export type Reivindicacao = "claimed" | "generating" | "ready" | "activated" | "legacy";

/** A reivindicação com o TOKEN da geração (só quando `claimed`). Gravar e
 *  liberar filtram por ele: uma geração antiga que acorde depois de outra ter
 *  reivindicado não grava por cima da nova nem apaga a linha dela. A garantia
 *  de "nunca dois escritores" deixa de morar só no teto da plataforma. */
export interface Reivindicado {
  resultado: Reivindicacao;
  token: string | null;
}

export type Decisao = "retomar" | "ativada" | "esperar" | "reivindicar" | "legado";

/** A forma mínima do Blueprint que esta decisão precisa conhecer. */
export interface BlueprintMinimo {
  plans: unknown[];
  habits: unknown[];
}

export interface Escolhas {
  plans: boolean[];
  habits: boolean[];
  goals: boolean;
}

export interface Resposta {
  status: number;
  body: Record<string, unknown>;
}

export const MSG_JA_GERADO =
  "Seu Blueprint de boas-vindas já foi gerado. Para novos planos, converse com o Conselheiro.";

/** A mesma frase nas saídas recuperáveis. Ela promete duas coisas que o
 *  servidor de fato cumpre: a cortesia foi ESTORNADA (`release_blueprint_
 *  generation` apaga a linha e zera `blueprint_generated_at` juntos), então
 *  tentar de novo funciona mesmo. */
export const MSG_TENTAR_DE_NOVO =
  "Não consegui montar seu Blueprint agora. Tente de novo — a cortesia não foi consumida.";

export const MSG_DESLIGADO =
  "O Blueprint de boas-vindas está indisponível agora. Você já pode registrar seu dia, e o seu primeiro plano você pede ao Conselheiro quando quiser.";

/**
 * O caminho, a partir do que já existe. Não escreve nada.
 *
 * `carimboLegado` só importa quando NÃO há linha: o carimbo antigo
 * (`blueprint_generated_at`) preenchido sem linha é um Blueprint gerado antes
 * da migração, cuja proposta só existiu no corpo de uma resposta que ninguém
 * guardou. Não há o que retomar.
 */
export function decidir(linha: Linha | null, carimboLegado: string | null, agoraMs: number): Decisao {
  if (!linha) return carimboLegado ? "legado" : "reivindicar";
  if (linha.status === "ready") return "retomar";
  if (linha.status === "activated") return "ativada";
  const inicio = Date.parse(linha.generation_started_at);
  // Data ilegível conta como velha: preferível uma segunda tentativa a uma
  // pessoa esperando para sempre por uma geração que nunca vai terminar.
  if (!Number.isFinite(inicio)) return "reivindicar";
  return agoraMs - inicio >= GERACAO_VELHA_SEGUNDOS * 1000 ? "reivindicar" : "esperar";
}

/** As escolhas com que a proposta nasce — as mesmas que o cliente montava:
 *  planos marcados só até a cota de planos ATIVOS (o resto nasce desmarcado,
 *  e se a pessoa marcar mesmo assim, vai guardado como arquivado), todos os
 *  hábitos, e as metas. */
export function escolhasIniciais(bp: BlueprintMinimo, maxPlanosAtivos: number): Escolhas {
  const cota = Math.max(1, Math.floor(Number(maxPlanosAtivos) || 1));
  return {
    plans: bp.plans.map((_, i) => i < cota),
    habits: bp.habits.map(() => true),
    goals: true,
  };
}

/** Tudo o que o fluxo precisa do mundo de fora. O index.ts liga cada um ao
 *  Supabase e ao modelo; o teste liga a dublês que contam chamadas. */
export interface Dependencias<B extends BlueprintMinimo> {
  agora(): number;
  lerLinha(): Promise<Linha | null>;
  carimboLegado(): Promise<string | null>;
  geracaoLigada(): Promise<boolean>;
  reivindicar(): Promise<Reivindicado>;
  /** Chama o modelo. `null` = falha recuperável (resposta ruim, cortada). */
  gerar(): Promise<B | null>;
  maxPlanosAtivos(): Promise<number>;
  /** Grava a proposta como pronta, SÓ se a linha ainda é a geração deste
   *  token. `false` = não alcançou nada (outra geração tomou o lugar). */
  gravarPronta(bp: B, escolhas: Escolhas, token: string): Promise<boolean>;
  /** Apaga a linha `generating` deste token e devolve a cortesia, juntos. */
  liberar(token: string): Promise<void>;
  /** Grava no rastro. Quem implementa engole o próprio erro: um evento que
   *  não foi gravado não pode custar à pessoa o Blueprint dela. */
  evento(kind: "generated" | "resumed" | "resume_failed", detail?: Record<string, unknown>): Promise<void>;
}

/** O fluxo inteiro de uma chamada POST `{}`. */
export async function atender<B extends BlueprintMinimo>(d: Dependencias<B>): Promise<Resposta> {
  const linha = await d.lerLinha();
  const decisao = decidir(linha, linha ? null : await d.carimboLegado(), d.agora());
  return seguir(d, decisao, linha);
}

async function seguir<B extends BlueprintMinimo>(
  d: Dependencias<B>, decisao: Decisao, linha: Linha | null,
): Promise<Resposta> {
  switch (decisao) {
    case "retomar":
      // O ramo que motivou tudo isto: recarregou, fechou a aba, voltou no
      // outro dia. A proposta está guardada; o modelo não é chamado.
      if (!linha) return { status: 202, body: { status: "generating" } };
      await d.evento("resumed");
      return {
        status: 200,
        body: { status: "ready", blueprint: linha.proposal, choices: linha.choices, resumed: true },
      };

    case "ativada":
      if (!linha) return { status: 202, body: { status: "generating" } };
      return {
        status: 200,
        body: { status: "activated", blueprint: linha.proposal, activation_result: linha.activation_result },
      };

    case "esperar":
      // Outra aba (ou um retry do navegador) está gerando agora. Gerar de
      // novo aqui seria pagar duas vezes pela mesma cortesia.
      return { status: 202, body: { status: "generating" } };

    case "legado":
      await d.evento("resume_failed", { reason: "legado_sem_proposta" });
      return { status: 409, body: { error: MSG_JA_GERADO, already: true } };

    case "reivindicar":
      return reivindicarEGerar(d);
  }
}

async function reivindicarEGerar<B extends BlueprintMinimo>(d: Dependencias<B>): Promise<Resposta> {
  // O kill-switch só barra GERAÇÃO NOVA. Quem já tem proposta guardada
  // retoma mesmo com o modelo desligado — retomar não chama modelo nenhum.
  if (!(await d.geracaoLigada())) {
    return { status: 503, body: { error: MSG_DESLIGADO, disabled: true } };
  }

  const { resultado: r, token } = await d.reivindicar();
  if (r !== "claimed" || !token) {
    // Outra chamada ganhou a corrida, ou o estado mudou entre a leitura e a
    // reivindicação. O banco disse o que há; segue por esse caminho.
    const mapa: Record<Exclude<Reivindicacao, "claimed">, Decisao> = {
      generating: "esperar", ready: "retomar", activated: "ativada", legacy: "legado",
    };
    const proxima = r === "claimed" ? "esperar" : mapa[r];
    const linha = proxima === "retomar" || proxima === "ativada" ? await d.lerLinha() : null;
    return seguir(d, proxima, linha);
  }

  let bp: B | null;
  try {
    bp = await d.gerar();
  } catch (e) {
    await d.liberar(token);
    throw e;
  }
  if (!bp) {
    await d.liberar(token);
    return { status: 502, body: { error: MSG_TENTAR_DE_NOVO, recoverable: true } };
  }

  // GRAVAR ANTES DE RESPONDER. É a mudança inteira: a proposta passa a existir
  // no banco antes de existir no corpo da resposta, e a resposta pode se perder
  // à vontade (aba fechada, rede caindo) sem levar a proposta junto.
  const escolhas = escolhasIniciais(bp, await d.maxPlanosAtivos());
  let gravou: boolean;
  try {
    gravou = await d.gravarPronta(bp, escolhas, token);
  } catch (e) {
    // Não conseguiu guardar: devolve a cortesia, para a próxima tentativa
    // gerar de novo em vez de esperar por uma linha que nunca vai ficar pronta.
    await d.liberar(token);
    throw e;
  }
  if (!gravou) {
    // Esta geração foi superada: outra chamada reivindicou depois (a nossa foi
    // tida como morta) ou a linha sumiu. Responder com o NOSSO `bp` mostraria
    // uma proposta diferente da guardada — e as escolhas e a ativação, que
    // conferem contra a guardada, recusariam tudo. Responde o que está no banco.
    const atual = await d.lerLinha();
    if (!atual) return { status: 502, body: { error: MSG_TENTAR_DE_NOVO, recoverable: true } };
    const mapa: Record<StatusDaLinha, Decisao> = { ready: "retomar", activated: "ativada", generating: "esperar" };
    return seguir(d, mapa[atual.status], atual);
  }
  await d.evento("generated", { plans: bp.plans.length, habits: bp.habits.length });
  return { status: 200, body: { status: "ready", blueprint: bp, choices: escolhas, resumed: false } };
}
