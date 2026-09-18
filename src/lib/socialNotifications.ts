// ASCENDE — Social: O QUE PODE CHAMAR A PESSOA DE VOLTA, E QUANTAS VEZES.
//
// ─── O QUE ESTÁ VETADO, E É O MOTOR INTEIRO DO GYMRATS ──────────────────
//
// "Fulano treinou, e você?" — vetado, sem versão suavizada. A primeira metade
// tem utilidade ZERO para a vida dela; a segunda é onde mora o valor, e o
// valor é NOSSO. E o volume passaria a ser função de quantos amigos ela tem,
// não da vida dela — o oposto do briefing 1x/dia que o Dilema 4 cita como
// prova de desenho.
//
// Não existe constante aqui que o desligue: ele não está implementado. O que
// impede a volta dele é a forma deste módulo — o gatilho de toda notificação é
// um ATO DIRIGIDO A ELA, e atividade ambiente não tem como virar candidata.
//
// ─── AS QUATRO REGRAS QUE DECIDEM O QUE PASSA ───────────────────────────
//
//   (a) o gatilho é um HUMANO dirigindo-se A VOCÊ, nunca atividade ambiente;
//   (b) a notificação é COMPLETA EM SI — não existe para te fazer entrar;
//   (c) volume INDEPENDENTE do tamanho do grupo;
//   (d) nada sobre o que você NÃO fez.
//
// ─── O TETO: POR PESSOA/DIA, SOMANDO TUDO ───────────────────────────────
//
// A regra N8 diz que o teto diário não aumenta por causa do Social. A
// infraestrutura de hoje (`whatsapp_sends`, deduplicado por
// `user_id, kind, sent_on`) impede o MESMO tipo duas vezes no dia — e só isso.
// Com cinco tipos novos, os cinco passariam no mesmo dia obedecendo à letra da
// dedupe e furando o espírito da regra: a pessoa receberia convite + recado +
// reconhecimento + prazo + fechamento, cada um "legalmente".
//
// Então o teto aqui NÃO é por tipo e NÃO é por grupo: é UM ORÇAMENTO POR
// PESSOA/DIA, e o Social concorre pelo MESMO orçamento das mensagens que já
// existem (retro, briefing, retorno). Cinco grupos não geram cinco vezes mais
// push porque o grupo não entra na conta em lugar nenhum — `sentToday` é uma
// lista de envios DAQUELA PESSOA, e não tem campo de grupo para somar.
//
// O número é 1, e não é arbitrário: é o que o app já pratica hoje por fluxo de
// controle (domingo a retro é "o único toque do dia"; quem está em silêncio
// não recebe briefing por cima). Aqui isso deixa de ser consequência da ordem
// dos `if` e vira regra explícita, contável e testável.
//
// ─── PUREZA ─────────────────────────────────────────────────────────────
//
// Sem Supabase, sem Date.now(). O dia de referência e o que já foi enviado
// ENTRAM como parâmetro — é o que permite testar "ela já recebeu hoje" sem
// relógio e sem banco.

/** Os CINCO tipos que passaram. Allowlist fechada: um tipo novo não nasce
 *  permitido, ele simplesmente não tem para onde ir. */
export const SOCIAL_PUSH_KINDS = [
  "convite", "recado", "reconhecimento", "prazo", "fechamento",
] as const;
export type SocialPushKind = typeof SOCIAL_PUSH_KINDS[number];

export interface SocialPushRule {
  kind: SocialPushKind;
  /** Quem disparou: uma PESSOA dirigindo-se a ela, ou ela mesma. Nenhum tipo
   *  tem "atividade de terceiro" como gatilho — é a regra (a), e ela está no
   *  tipo, não num comentário. */
  gatilho: "pessoa-para-voce" | "voce-mesma" | "resultado-do-grupo";
  /** Frequência máxima. `ciclo` é uma vez por desafio, não por dia. */
  limite: "uma-vez" | "1-por-dia" | "1-por-ciclo";
  porque: string;
}

export const SOCIAL_PUSH_RULES: Record<SocialPushKind, SocialPushRule> = {
  convite: {
    kind: "convite", gatilho: "pessoa-para-voce", limite: "uma-vez",
    porque: "uma pessoa te chamou. Expira sozinho e NÃO REPETE — insistir num " +
      "convite é cobrar uma resposta que ela já deu com o silêncio.",
  },
  recado: {
    kind: "recado", gatilho: "pessoa-para-voce", limite: "1-por-dia",
    porque: "alguém escreveu no grupo. Agrupado e com corte: dez recados são " +
      "um aviso, não dez — senão o volume vira função do tamanho do grupo.",
  },
  reconhecimento: {
    kind: "reconhecimento", gatilho: "pessoa-para-voce", limite: "1-por-dia",
    porque: "pessoas reconheceram um registro dela. Agregado, sem escalonar a " +
      "contagem e sem 'você está em alta': o reconhecimento é do ato, não um placar.",
  },
  prazo: {
    kind: "prazo", gatilho: "voce-mesma", limite: "1-por-ciclo",
    porque: "o prazo do que ELA escolheu. Serviço puro, factual, uma vez.",
  },
  fechamento: {
    kind: "fechamento", gatilho: "resultado-do-grupo", limite: "1-por-ciclo",
    porque: "o resultado coletivo, sem nomes e sem destrinchar quem fez quanto.",
  },
};

/** O orçamento de toques por PESSOA e por DIA, somando Social e não-Social. */
export const DAILY_PUSH_BUDGET = 1;

/**
 * A ordem de prioridade quando mais de um cabe no mesmo dia.
 *
 * Primeiro vem quem foi DIRIGIDO A ELA por uma pessoa (regra (a)), depois o
 * que ela mesma marcou, e por último o resultado do grupo — que é o único cujo
 * gatilho não é ninguém falando com ela.
 */
const PRIORIDADE: SocialPushKind[] = [
  "convite", "recado", "reconhecimento", "prazo", "fechamento",
];

/** Um envio que já aconteceu hoje para ESTA pessoa. Repare que não há campo de
 *  grupo: é isso que torna impossível o teto virar "por grupo" sem alguém
 *  mudar o tipo e ter de explicar por quê. */
export interface SentToday {
  kind: string;
}

export interface SocialPushCandidate {
  kind: SocialPushKind;
  /** Chave estável para "isto já foi enviado": o id do convite, o id do
   *  desafio + ciclo. Nunca o id do grupo sozinho. */
  dedupeKey: string;
  /** Quantas pessoas estão por trás do agrupamento (recado, reconhecimento).
   *  Serve para a frase, e é limitado na renderização. */
  pessoas?: number;
  /** Só para `fechamento`: quantas vezes ELA participou no ciclo.
   *  A trava mais fácil de esquecer e a mais cruel de errar. */
  participacoesNoCiclo?: number;
  /** Texto pronto do lado de quem chamou (nome do grupo, do desafio). */
  contexto?: string;
}

export type DropReason =
  | "teto-diario"
  | "ja-enviado"
  | "kind-desconhecido"
  | "ausencia-nao-e-evento"
  | "sem-participacao-no-ciclo";

export interface PushDecision {
  escolhido: SocialPushCandidate | null;
  descartados: { candidato: SocialPushCandidate; motivo: DropReason }[];
}

export interface PushInput {
  /** Tudo que já foi enviado HOJE para esta pessoa — Social e não-Social.
   *  O briefing e a retro entram aqui: o Social concorre pelo mesmo teto. */
  sentToday: readonly SentToday[];
  /** O que já foi enviado alguma vez, por dedupeKey (convite não repete,
   *  prazo é uma vez por ciclo). */
  jaEnviados: readonly string[];
  candidatos: readonly SocialPushCandidate[];
}

/**
 * Escolhe NO MÁXIMO um toque para esta pessoa hoje — ou nenhum.
 *
 * Devolve também o que foi descartado e POR QUÊ. Descarte silencioso é como um
 * teto vira mistério: alguém investiga "por que ela não recebeu" e não tem o
 * que ler.
 */
export function selectDailyPush(input: PushInput): PushDecision {
  const descartados: PushDecision["descartados"] = [];
  const jaEnviados = new Set(input.jaEnviados ?? []);
  const usadoHoje = (input.sentToday ?? []).length;

  const elegiveis: SocialPushCandidate[] = [];
  for (const c of input.candidatos ?? []) {
    if (!SOCIAL_PUSH_KINDS.includes(c.kind)) {
      descartados.push({ candidato: c, motivo: "kind-desconhecido" });
      continue;
    }
    if (jaEnviados.has(c.dedupeKey)) {
      descartados.push({ candidato: c, motivo: "ja-enviado" });
      continue;
    }
    /* A TRAVA DO FECHAMENTO. Nunca notifique alguém sobre um resultado
       coletivo em que a AUSÊNCIA DELA é a informação: quem não participou
       nenhuma vez no ciclo lê "o grupo cumpriu 50 de 50" como uma frase sobre
       si mesma, e é a leitura certa. Sem nomes não basta — a conta que falta é
       a dela, e ela sabe. */
    if (c.kind === "fechamento" && (c.participacoesNoCiclo ?? 0) <= 0) {
      descartados.push({ candidato: c, motivo: "sem-participacao-no-ciclo" });
      continue;
    }
    elegiveis.push(c);
  }

  if (usadoHoje >= DAILY_PUSH_BUDGET) {
    for (const c of elegiveis) descartados.push({ candidato: c, motivo: "teto-diario" });
    return { escolhido: null, descartados };
  }

  elegiveis.sort((a, b) => PRIORIDADE.indexOf(a.kind) - PRIORIDADE.indexOf(b.kind));
  const escolhido = elegiveis[0] ?? null;
  for (const c of elegiveis.slice(1)) descartados.push({ candidato: c, motivo: "teto-diario" });
  return { escolhido, descartados };
}

/* ═══ O TEXTO ═════════════════════════════════════════════════════════
   A NOTIFICAÇÃO CHAMA, NUNCA ENTREGA — regra de canal herdada do
   whatsapp-notify, que já faz certo. Nenhum push do Social carrega número que
   compare pessoas, e nenhum carrega o que ela NÃO fez. */

/** Acima disto a contagem para de crescer na frase. "3 pessoas" é
 *  reconhecimento; "27 pessoas" é placar, e placar escala — é o "você está em
 *  alta" entrando pela porta do número. */
export const RECONHECIMENTO_MAX_NA_FRASE = 3;

export function renderPush(c: SocialPushCandidate): string {
  const ctx = (c.contexto ?? "").trim();
  switch (c.kind) {
    case "convite":
      return ctx ? `Você foi convidado para ${ctx}.` : "Você recebeu um convite.";
    case "recado": {
      const n = Math.max(1, Math.floor(c.pessoas ?? 1));
      const quem = n === 1 ? "Alguém escreveu" : "Algumas pessoas escreveram";
      return ctx ? `${quem} em ${ctx}.` : `${quem} no seu grupo.`;
    }
    case "reconhecimento": {
      const n = Math.max(1, Math.floor(c.pessoas ?? 1));
      if (n === 1) return "Alguém reconheceu seu registro.";
      if (n <= RECONHECIMENTO_MAX_NA_FRASE) return `${n} pessoas reconheceram seu registro.`;
      // Sem escalonamento: a partir daqui o número para de subir na frase.
      return "Algumas pessoas reconheceram seu registro.";
    }
    case "prazo":
      return ctx ? `${ctx} termina amanhã.` : "Seu desafio termina amanhã.";
    case "fechamento":
      return ctx ? `${ctx} fechou a semana.` : "Seu grupo fechou a semana.";
  }
}
