import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { proximaViradaDeDia } from "@/lib/socialSemana";

/* ═══════════════════════════════════════════════════════════════════════════
   O SINO — tempo real que é SERVIÇO, e não engajamento
   ═══════════════════════════════════════════════════════════════════════════

   O pedido é legítimo: não ter que sair e entrar para ver o que mudou. Ele
   vira engajamento no instante em que a chegada do dado disputa a atenção da
   pessoa — e é essa fronteira que este arquivo guarda. As condições RT0..RT9
   do parecer do Fiel (18/09/2026) estão implementadas aqui, cada uma no
   trecho que a cumpre.

   ─── RT0 — O CANAL NÃO TRANSPORTA DADO (arquitetura, bloqueante) ──────────

   O canal diz "mudou algo no grupo X" e o cliente RECONSULTA pelas views. Ele
   não carrega linha nenhuma, e não é conservadorismo:

   · Publicar as tabelas em `supabase_realtime` entregaria o payload CRU, sem
     a janela `day >= current_date - 1` da view. Um cliente que fica escutando
     ACUMULA a série diária de terceiro, dia após dia — o calendário de
     bolinhas que não tem endpoint entraria pela porta do socket.
   · Pior: em `postgres_changes`, o DELETE **não passa por RLS**. O WAL só
     carrega o REPLICA IDENTITY (a PK), e a PK de `group_visible_stats` é
     `(group_id, user_id, day, metric_key)` — literalmente o fato inteiro. E
     `publicar_dia` apaga e reescreve a cada registro. Assinar aquela tabela
     transmitiria a vida alheia, por métrica, para qualquer autenticado.

   Por isso: broadcast privado, payload só com o id do grupo, autorização por
   política em `realtime.messages`. Uma avaliação na entrada do canal em vez
   de uma por assinante por linha.

   ─── O QUE ESTE HOOK NUNCA FAZ ────────────────────────────────────────────

   · RT1  Nenhum badge de não-lido, contador de novidades ou ponto vermelho.
   · RT2  Nenhum toast, alerta, som ou vibração por ato de terceiro.
   · RT3  Nenhuma animação que chame o olho. Troca direta ou fade curto.
   · RT4  Nenhum push do sistema nasce daqui: o tempo real só pinta a tela que
          já está aberta.
   · RT5  Nada de presença — sem "online agora", sem "digitando", sem "visto
          por último". Presença em tempo real é vigilância e cria obrigação de
          estar lá. Repare que este hook NÃO chama `channel.track()`.
   · RT6  O scroll do usuário nunca é movido por dado novo.
   · RT7  Nenhum evento de ausência: ninguém recebe "Fulano ainda não
          registrou". O sino não sabe o que mudou, então não tem como.
   · RT8  A atualização vale sobre o ciclo corrente. Sem "carregar mais".
   · RT9  O canal FECHA quando a aba perde o foco, e nada é acumulado para
          "trazer de volta" o usuário depois.
   ═══════════════════════════════════════════════════════════════════════════ */

/** De quanto em quanto tempo a tela reconsulta quando o sino não está de pé.
 *  É a degradação silenciosa: num banco que ainda não rodou a migration do
 *  sino, o app continua funcionando — só para de ser instantâneo. */
const INTERVALO_SEM_SINO = 90_000;

/** O relógio do "atualizado há X". Um minuto: abaixo disso o texto vira
 *  cronômetro, e cronômetro é contador subindo com outro nome (RT3). */
const PASSO_DO_RELOGIO = 60_000;

/**
 * A JANELA DO SINO. O toque não vira consulta na hora: espera 1,5s por outro.
 *
 * `publicar_dia` APAGA e REINSERE, e são dois statements — logo dois toques
 * por `life_event`, por grupo. Somam-se os gatilhos de `group_notes`,
 * `group_recognitions`, `group_members`, `challenges` e
 * `challenge_participants`. Do outro lado, cada invalidação refaz a consulta
 * INTEIRA: 8 chamadas, mais até 3 do desafio, mais a da semana — que custa
 * `pessoas × métricas` execuções de uma função `security definer` (a Aduana
 * contou 56 num grupo de 8).
 *
 * Grupo de 6 com todo mundo de app aberto e alguém batendo 8 copos d'água numa
 * hora: 8 eventos × 2 toques × 6 clientes = 96 consultas completas. O React
 * Query deduplica as CONCORRENTES, não as sequenciais — a janela deduplica as
 * sequenciais. 1,5s é invisível para quem olha (o dado "chegou agora" de
 * qualquer jeito) e corta o pior caso em uma ordem de grandeza.
 */
const JANELA_DO_SINO = 1_500;

export interface GrupoAoVivo {
  /** O sino está de pé? Falso = a tela reconsulta por intervalo. */
  vivo: boolean;
  /** `false` quando o sino está de pé; o intervalo, quando não está. */
  intervalo: number | false;
  /** O relógio que anda de minuto em minuto, para o "atualizado há X" e para
   *  o dia de hoje. Quem formata é `textoDoTempo` — assim o hook não precisa
   *  conhecer a consulta, e a consulta pode nascer DEPOIS dele (é ela que
   *  recebe o `intervalo`). */
  agora: number;
}

export function useGrupoAoVivo(grupoId: string, aoMudar: () => void): GrupoAoVivo {
  const [vivo, setVivo] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  // O callback muda a cada render da página; guardá-lo num ref evita
  // reassinar o canal (e piscar a conexão) a cada atualização de estado.
  const mudou = useRef(aoMudar);
  mudou.current = aoMudar;

  // Ver `JANELA_DO_SINO`: vários toques seguidos viram UMA reconsulta.
  const janela = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisar = useCallback(() => {
    if (janela.current) clearTimeout(janela.current);
    janela.current = setTimeout(() => { janela.current = null; mudou.current(); }, JANELA_DO_SINO);
  }, []);
  useEffect(() => () => { if (janela.current) clearTimeout(janela.current); }, []);

  /* ─── O CANAL, e o RT9 ─────────────────────────────────────────────────
     Assina ao montar e quando a aba volta ao foco; FECHA quando ela perde o
     foco. Nada fica acumulado para ser entregue depois — "5 novidades
     enquanto você esteve fora" é exatamente o chamariz que o RT1 proíbe. */
  useEffect(() => {
    if (!grupoId) return;
    /* DUAS REFERÊNCIAS SEPARADAS, e uma trava. Antes havia uma variável só
       para os dois canais: no `CHANNEL_ERROR` o código fechava "o canal" e
       abria o pulso no mesmo lugar. Só que o `realtime-js` emite
       `CHANNEL_ERROR` mais de uma vez no mesmo canal (é o normal quando o
       socket cai e a retentativa também falha, e o callback do canal velho
       continua vivo até o `removeChannel` — que é assíncrono — completar). A
       segunda emissão fechava o canal do PULSO, que estava funcionando, e
       abria um terceiro: com oscilação de rede virava laço de abre-fecha, e
       `vivo` alternando ligava e desligava o `refetchInterval` junto. */
    let sino: ReturnType<typeof supabase.channel> | null = null;
    let pulso: ReturnType<typeof supabase.channel> | null = null;
    let degradou = false;
    let vivoAqui = true;

    const fechar = () => {
      if (sino) { supabase.removeChannel(sino); sino = null; }
      if (pulso) { supabase.removeChannel(pulso); pulso = null; }
      degradou = false;
      setVivo(false);
    };

    /* PLANO B — o sino como TABELA, e por que ele é aceitável.
       Se o projeto não tiver `realtime.send`, a migration cria
       `public.group_pulse`: uma linha por grupo, com o id e o instante da
       última mudança. Nada ali é dado de ninguém — nem no DELETE, que só
       acontece quando o grupo inteiro deixa de existir. É a única tabela do
       Social que pode ser publicada em `supabase_realtime`, e é por isso que
       ela existe em vez de publicarem as três de verdade (RT0). */
    const abrirPulso = () => {
      if (pulso) return;
      pulso = supabase.channel(`pulso:${grupoId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "group_pulse", filter: `group_id=eq.${grupoId}` },
          () => { if (vivoAqui) avisar(); },
        )
        .subscribe((status) => { if (vivoAqui) setVivo(status === "SUBSCRIBED"); });
    };

    const abrirSino = () => {
      sino = supabase.channel(`grupo:${grupoId}`, { config: { private: true } })
        .on("broadcast", { event: "mudou" }, () => { if (vivoAqui) avisar(); })
        .subscribe((status) => {
          if (!vivoAqui) return;
          if (status === "SUBSCRIBED") { setVivo(true); return; }
          /* DEGRADAÇÃO SILENCIOSA, em dois degraus e UMA vez só. Banco sem a
             política do canal, socket recusado, migration ainda não rodada:
             tenta o plano B e, se ele também não estiver de pé, `vivo` fica
             falso e a tela passa a reconsultar por intervalo. A pessoa não vê
             erro nenhum — o app não pode quebrar num banco que ainda não
             rodou a migration. */
          setVivo(false);
          if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;
          if (degradou) return;   // a trava: emissões repetidas não derrubam o pulso
          degradou = true;
          if (sino) { supabase.removeChannel(sino); sino = null; }
          abrirPulso();
        });
    };

    const abrir = () => { if (!sino && !pulso) abrirSino(); };

    const aoTrocarDeAba = () => {
      if (document.visibilityState === "visible") {
        abrir();
        // Reconexão: refetch SILENCIOSO. Sem marcador "novo" em lote — quem
        // decide isso é `useMarcadorDeNovo`, e ele já ignora chegadas
        // múltiplas de propósito.
        avisar();
      } else {
        fechar();
      }
    };

    if (document.visibilityState === "visible") abrir();
    document.addEventListener("visibilitychange", aoTrocarDeAba);
    return () => {
      vivoAqui = false;
      document.removeEventListener("visibilitychange", aoTrocarDeAba);
      fechar();
    };
  }, [grupoId, avisar]);

  /* ─── A VIRADA DA MEIA-NOITE ───────────────────────────────────────────
     "Hoje" precisa virar "ontem", e a janela da view anda junto. Sem este
     timer, uma tela aberta desde ontem à noite MENTE até a pessoa sair e
     voltar — e mente com nome de gente em cima. */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const agendar = () => {
      const d = new Date();
      /* A virada é a do FUSO DO PRODUTO, não a do navegador. Agendar
         `getDate() + 1` virava a tela na meia-noite do aparelho — e com o
         aparelho fora de BRT (viagem, ou Android com fuso manual em UTC) isso
         é a hora errada, exatamente como o `diaLocal` errava o dia. */
      timer = setTimeout(
        () => { avisar(); agendar(); },
        Math.max(1000, proximaViradaDeDia(d).getTime() - d.getTime()),
      );
    };
    agendar();
    return () => clearTimeout(timer);
  }, [avisar]);

  /* ─── O RELÓGIO DO CABEÇALHO ──────────────────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), PASSO_DO_RELOGIO);
    return () => clearInterval(t);
  }, []);

  return { vivo, intervalo: vivo ? false : INTERVALO_SEM_SINO, agora };
}

/** "atualizado agora" → "há 3 min" → "há 1 h". Sem segundos: cronômetro é
 *  contador subindo com outro nome. E se o socket cair, a ÚNICA mudança
 *  visível na tela é este texto parar de andar — sem ícone de erro, sem toast. */
export function textoDoTempo(quando: number | undefined, agora: number): string {
  if (!quando) return "";
  const min = Math.floor((agora - quando) / 60_000);
  if (min < 1) return "atualizado agora";
  if (min < 60) return `atualizado há ${min} min`;
  const h = Math.floor(min / 60);
  return `atualizado há ${h} h`;
}

/* ═══ O MARCADOR DE "NOVO" ════════════════════════════════════════════════ */

/** 45 segundos, e ele some SOZINHO. Marcador que fica até alguém "ler" é um
 *  não-lido, e não-lido é o RT1. */
const JANELA_DO_MARCADOR = 45_000;

/**
 * Quais itens acabaram de chegar — e SÓ quando chegou UM.
 *
 * A regra do lote é a parte importante: se a aba voltou do background e cinco
 * coisas entraram de uma vez, marcar as cinco vira chamariz por acumulação
 * ("olha tudo o que você perdeu"), que é o efeito que o RT1 existe para
 * impedir. Lote entra em silêncio, sem marcador nenhum.
 *
 * Na primeira carga NADA é novo: a tela abriu, o conteúdo dela não "chegou".
 *
 * ─── O BUG QUE ESTA VERSÃO CONSERTA, e ele era grave ──────────────────────
 *
 * O `clearTimeout` morava no CLEANUP do efeito, e o efeito depende da lista de
 * ids. Ou seja: o cleanup rodava toda vez que **chegava outro item** — e
 * matava o timer do item anterior antes de ele expirar.
 *
 *   t=0s   a Ana registra um treino  → marca A, agenda o timer de A
 *   t=10s  o Bruno manda um recado   → cleanup MATA o timer de A; marca B
 *   t=55s  o timer de B dispara e tira só o B. **A nunca mais sai.**
 *
 * E o caso do lote era pior: com dois itens chegando juntos, o `return` do
 * "lote não marca" acontecia ANTES de agendar timer nenhum, e o item anterior
 * ficava marcado para sempre. A borda dourada virava um NÃO-LIDO PERMANENTE,
 * que é exatamente o RT1 — num grupo de quatro pessoas ativas, na primeira
 * meia hora de uso.
 *
 * O conserto é tirar os timers do ciclo de vida do efeito: um timer por id,
 * num `Map` guardado em `useRef`, limpo só no desmonte do hook.
 */
export function useMarcadorDeNovo(ids: readonly string[]): Set<string> {
  const vistos = useRef<Set<string> | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set());
  /* A dependência é a CHAVE, não o array: um array novo a cada render
     reexecutaria o efeito sem nada ter mudado, e o marcador piscaria. */
  const chave = ids.join("|");
  const atuais = useRef<readonly string[]>(ids);
  atuais.current = ids;

  useEffect(() => {
    const lista = atuais.current;
    if (vistos.current === null) { vistos.current = new Set(lista); return; }

    const novos = lista.filter((id) => !vistos.current!.has(id));

    /* PODA. `vistos` é a única coisa que impede um id de reaparecer como
       "novo", mas ele só crescia — e o feed é finito (hoje e ontem), então na
       virada do dia itens saem da lista e nunca saíam daqui. Quando a lista
       ENCOLHE, `vistos` passa a ser exatamente o que está na tela mais o que
       acabou de chegar; enquanto ela cresce, só acumula. */
      if (lista.length < vistos.current.size) vistos.current = new Set(lista);
    for (const id of lista) vistos.current.add(id);

    if (novos.length !== 1) return;

    const id = novos[0];
    setMarcados((antes) => new Set(antes).add(id));
    // O timer NÃO é limpo pelo cleanup do efeito: ele é do ITEM, não do render.
    const anterior = timers.current.get(id);
    if (anterior) clearTimeout(anterior);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      setMarcados((antes) => {
        if (!antes.has(id)) return antes;
        const proximo = new Set(antes);
        proximo.delete(id);
        return proximo;
      });
    }, JANELA_DO_MARCADOR));
  }, [chave]);

  // Só no desmonte. É o único momento em que apagar um timer não deixa uma
  // borda dourada acesa para sempre na tela.
  useEffect(() => {
    const mapa = timers.current;
    return () => { for (const t of mapa.values()) clearTimeout(t); mapa.clear(); };
  }, []);

  return marcados;
}
