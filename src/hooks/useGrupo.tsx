import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { ConsentimentoDaFolha } from "@/components/core/SocialConsentSheet";
import type { ConviteAberto } from "@/components/core/SocialInviteSheet";
import { SHAREABLE_METRICS, type SocialMetricKey } from "@/lib/socialMetrics";
import {
  diaLocal, linhaDaSemana, linhaVisivel, porNomeDoGrupo, type LinhaVisivel,
} from "@/lib/socialSemana";

/* ═══════════════════════════════════════════════════════════════════════════
   A LEITURA DE UM GRUPO — uma consulta, várias views
   ═══════════════════════════════════════════════════════════════════════════

   TRÊS COISAS QUE O BANCO ENSINOU A ESTA TELA, e que vivem aqui porque é aqui
   que a consulta acontece:

   1. **O FEED DE PRESENÇA NÃO É UMA TABELA.** Não existe linha "Ana registrou
      um treino" guardada em lugar nenhum, e é de propósito: duplicar o dado
      criaria uma SEGUNDA cópia para revogar, e a doutrina é "publicar é
      copiar, revogar é apagar" — com UMA cópia só. A presença se DERIVA de
      `v_grupo_hoje`, que já é o que o grupo pode ver, filtrado por
      consentimento, janela e reciprocidade. `group_notes` é só o recado
      escrito à mão. A tela junta os dois por data.

   2. **O "FORÇA" NÃO É CURTIDA DE POST.** É reconhecimento do DIA de uma
      PESSOA (`group_recognitions`, com `check (giver_id <> subject_id)`) — a
      Camada 3 do parecer, construída NO LUGAR do ranking. O alvo é quem
      voltou, não o post.

   3. **A META MORA NO CONSENTIMENTO.** `group_data_consents.goal_value` é NOT
      NULL: não existe ligar um tipo de dado sem combinar quanto. Sem
      denominador, a tela só teria número absoluto — e número absoluto ao lado
      de número absoluto já é um ranking, mesmo sem coluna de posição.

   ─── AS DUAS VIEWS, E POR QUE SÃO DUAS ────────────────────────────────────

   · `v_grupo_hoje` é o ATO: hoje e ontem, uma linha por registro. Ela NÃO
     aceita intervalo de datas, de propósito — série diária de terceiro é o
     calendário de bolinhas, e ele não sai do banco nem se a tela pedir.
   · `v_grupo_semana` é o ESTADO: o agregado da semana corrente por pessoa por
     métrica. Ela devolve o AGREGADO e nunca os dias que o compõem, e é essa
     assimetria que a função `security definer` por trás dela existe para
     sustentar. `feito` NULL e `feito` 0 são fatos DIFERENTES (regra C do
     Fiel) — quem decide o que cada um vira na tela é `lib/socialSemana.ts`.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PessoaComMetrica {
  key: SocialMetricKey;
  /** O rótulo LONGO, como a folha de consentimento o promete. */
  label: string;
  /** O mesmo tipo de dado dito CURTO, para caber na ficha ("Água" em vez de
   *  "Dias com a água em dia"). Vem do BANCO (`label_curto`, coluna de
   *  `shareable_metrics` publicada nas views) — nunca de uma tabela de
   *  rótulos no front, que seria a segunda verdade. Enquanto a migration que
   *  o cria não rodar, cai no rótulo longo: mais largo do que devia, e
   *  correto. */
  labelCurto: string;
  linha: LinhaVisivel;
}

export interface PessoaDoGrupo {
  userId: string;
  /** O nome DO GRUPO. Nunca lido de `profiles`, que tem renda e remédios na
   *  mesma linha do nome — e RLS não recorta coluna. */
  nome: string;
  emoji: string | null;
  souEu: boolean;
  /** Só as métricas com direito ao número. As ocultas já foram removidas
   *  aqui: a tela não recebe a chance de desenhar um buraco. */
  metricas: PessoaComMetrica[];
  /** Registrou hoje depois de uma semana sem registrar. É um BIT — o banco
   *  nunca devolve quantos dias, porque o número é o denominador da ausência. */
  voltouHoje: boolean;
}

/** Uma linha de presença, vinda de `v_grupo_hoje`. O valor já chegou filtrado
 *  por consentimento e reciprocidade: se está aqui, o grupo pode ver. */
export interface Presenca {
  userId: string;
  nome: string;
  souEu: boolean;
  dia: string;
  metricKey: SocialMetricKey;
  voltou: boolean;
}

export interface Recado {
  id: string;
  nome: string;
  souEu: boolean;
  texto: string;
  criadoEm: string;
}

/** O que `barra_do_grupo` devolve desde a migration do sino: uma LINHA, não
 *  um número. `feito`, `combinado` (já escalado para o ciclo) e quantas
 *  pessoas entraram no k. Nenhuma linha = nenhuma barra. */
export interface BarraDoGrupo {
  feito: number;
  combinado: number;
  pessoas: number;
}

export interface DesafioEmCurso {
  id: string;
  nome: string;
  metricKey: SocialMetricKey;
  comecaEm: string;
  terminaEm: string;
  participantes: string[];
}

export interface DadosDoGrupo {
  nome: string;
  pessoas: number;
  papel: string;
  diasRestantes: number;
  vigente: boolean;
  /** A data em que o combinado do GRUPO termina (ou terminou). */
  terminaEm: string;
  consentimentos: ConsentimentoDaFolha[];
  desafio: DesafioEmCurso | null;
  /** Combinado com `starts_on` no futuro: existe, mas ainda não começou.
   *  Sem este estado ele aparecia como "em curso" e a folha abria vazia —
   *  `total_do_ciclo` devolve NULL para todos antes do primeiro dia. */
  desafioFuturo: { nome: string; comecaEm: string; terminaEm: string } | null;
  encerrado: { nome: string; comecaEm: string; terminaEm: string } | null;
  progresso: {
    user_id: string; display_name: string; sou_eu: boolean;
    feito: number | null; combinado: number | null;
  }[];
  /** A barra do grupo, direto do banco. `null` = o banco não devolveu linha:
   *  ou o k mínimo de quatro não foi alcançado, ou quem olha não participa do
   *  combinado. O `combinado` já vem ESCALADO PARA O CICLO pelo SQL — é ele
   *  quem manda sobre o denominador, e a tela não refaz essa conta. */
  barra: BarraDoGrupo | null;
  /** Quantos consentimentos ativos existem naquela métrica. `null` significa
   *  "NÃO SEI" — a contagem falhou. Sem esse terceiro estado, um erro de rede
   *  virava `0`, e `weekScoreboard` escrevia na tela "o total aparece quando
   *  pelo menos quatro pessoas estiverem compartilhando" num desafio com
   *  seis. A tela afirmava um fato sobre o grupo a partir de um erro engolido,
   *  e explicação errada é pior que omissão muda. */
  consentimentosNoDesafio: number | null;
  barraEncerrado: BarraDoGrupo | null;
  meuEncerrado: number | null;
  membros: PessoaDoGrupo[];
  /** Chaves `userId|metricKey` para as quais quem olha TEM direito ao número.
   *  Ver o comentário na montagem: é a ponte que impede a folha do desafio de
   *  sumir com quem o cartão mostra. */
  temDireitoAoNumero: Set<string>;
  /** A view semanal ainda não existe neste banco. A tela degrada para os
   *  cartões sem números em vez de quebrar — ver `semana` abaixo. */
  semanaIndisponivel: boolean;
  presencas: Presenca[];
  recados: Recado[];
  dei: Set<string>;
  recebi: Map<string, number>;
  convites: ConviteAberto[];
}

export const ehAdmin = (papel?: string) => papel === "owner" || papel === "admin";

export function useGrupo(grupoId: string, opcoes?: { refetchInterval?: number | false }) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["social-grupo", grupoId, user?.id],
    enabled: !!user && !!grupoId,
    refetchInterval: opcoes?.refetchInterval ?? false,
    queryFn: async (): Promise<DadosDoGrupo> => {
      const [grupo, membros, consentimentos, desafios, hoje, recados, reconhecimentos, convites] =
        await Promise.all([
          supabase.from("v_meus_grupos")
            .select("name,ends_on,dias_restantes,vigente,role,pessoas")
            .eq("id", grupoId).maybeSingle(),
          supabase.from("group_members")
            .select("user_id,display_name,avatar_emoji").eq("group_id", grupoId),
          /* O PREVIEW LITERAL da condição C5, e ele vem pronto da view: o
             catálogo INTEIRO, chave a chave, dizendo o que está ligado e o que
             está fechado — com o mesmo destaque. */
          supabase.from("v_meus_consentimentos")
            .select("metric_key,label,o_que_o_zero_diz,compartilhado,goal_value,dias_publicados")
            .eq("group_id", grupoId),
          supabase.from("challenges")
            .select("id,name,metric_key,starts_on,ends_on,challenge_participants(user_id)")
            .eq("group_id", grupoId).order("ends_on", { ascending: false }).limit(3),
          /* O ATO. `label` e `goal_value` já existiam nesta view e a tela
             simplesmente não os pedia. */
          supabase.from("v_grupo_hoje")
            .select("user_id,display_name,avatar_emoji,sou_eu,day,metric_key,label,voltou")
            .eq("group_id", grupoId).order("day", { ascending: false }),
          supabase.from("group_notes")
            .select("id,author_id,text,created_at")
            .eq("group_id", grupoId)
            .order("created_at", { ascending: false }).limit(50),
          supabase.from("group_recognitions")
            .select("giver_id,subject_id,ref_day").eq("group_id", grupoId),
          supabase.from("group_invites")
            .select("id,created_at,expires_at,uses,max_uses")
            .eq("group_id", grupoId).is("revoked_at", null),
        ]);

      const falhou = [grupo, membros, consentimentos, desafios, hoje, recados, reconhecimentos, convites]
        .find((r) => r.error);
      if (falhou?.error) throw falhou.error;

      /* O ESTADO DA SEMANA, à parte e TOLERANTE AO ERRO.
         A migration que cria `v_grupo_semana` pode ainda não ter rodado neste
         banco. Um `throw` aqui derrubaria a tela inteira — pessoas, feed,
         recado e desafio — por causa de um número. A tela sabe viver sem ele:
         os cartões aparecem com o nome e sem a trilha, e é a verdade (não há
         número), não um erro escondido. */
      /* `select("*")` AQUI É TEMPORÁRIO, e a janela tem nome: a migration
         `20260918210000` acrescenta `label_curto` a esta view e ainda não foi
         aplicada. Nomear a coluna antes disso quebraria a consulta com
         "column does not exist" — e a tela inteira cairia por causa de um
         rótulo, que é muito pior do que exibir o rótulo longo. Com `*`, o
         curto aparece sozinho no minuto em que a migration rodar, e a linha
         volta a nomear as colunas depois disso.
         Não há risco de vazamento: a view JÁ é a projeção filtrada por
         consentimento, reciprocidade e janela — não existe coluna nela que
         este cliente não possa ler. */
      const semana = await supabase.from("v_grupo_semana")
        .select("*")
        .eq("group_id", grupoId)
        /* ORDEM FIXA DO CATÁLOGO (`ordem` 1..7), e é decisão dos dois
           pareceres. Sem ela a lista saía alfabética pela CHAVE TÉCNICA
           (`agua_fechada` antes de `dia_inteiro`), que não significa nada para
           quem lê. As duas alternativas estão vetadas por escrito: ordenar por
           desempenho é ordinal com outro nome, e embaralhar para atrapalhar a
           comparação é sludge — só funciona enquanto a pessoa não percebe. Se
           a régua é o problema, tira-se a régua (foi o que se fez), não se
           bagunçam os rótulos. */
        .order("ordem", { ascending: true });
      const semanaIndisponivel = !!semana.error;

      const g = grupo.data as {
        name: string; ends_on: string; dias_restantes: number; vigente: boolean;
        role: string; pessoas: number;
      } | null;

      // `display_name` é a identidade DO GRUPO — nunca lida de `profiles`, que
      // tem renda e remédios na mesma linha do nome, e RLS não recorta coluna.
      const gente = ((membros.data ?? []) as {
        user_id: string; display_name: string; avatar_emoji: string | null;
      }[]);
      const nomes = new Map(gente.map((m) => [m.user_id, m.display_name]));

      const lista = (desafios.data ?? []) as unknown as {
        id: string; name: string; metric_key: SocialMetricKey;
        starts_on: string; ends_on: string;
        challenge_participants: { user_id: string }[];
      }[];
      const hojeIso = diaLocal(new Date());
      /* O desafio EXPIRA SOZINHO: ninguém encerra nada. `ends_on` no banco é o
         fim, e a partir do dia seguinte ele deixa de ser o em curso — o
         combinado acabou porque a data chegou, que é o que faz dele um
         combinado e não uma presença permanente. */
      /* E ele também tem um COMEÇO. Olhar só o fim fazia um combinado marcado
         para segunda aparecer como vigente hoje — com a folha abrindo vazia,
         porque `total_do_ciclo` não soma nada antes de `starts_on`. */
      const emCurso = lista.find((c) => c.ends_on >= hojeIso && c.starts_on <= hojeIso) ?? null;
      const futuro = lista.find((c) => c.starts_on > hojeIso) ?? null;
      const encerrado = lista.find((c) => c.ends_on < hojeIso) ?? null;

      let progresso: DadosDoGrupo["progresso"] = [];
      let barra: BarraDoGrupo | null = null;
      let consentimentosNoDesafio: number | null = null;
      if (emCurso) {
        /* O placar de cada participante vem de `v_desafio_progresso`, que já
           traz `feito` ao lado de `combinado`. Uma consulta para o desafio
           inteiro em vez de uma chamada por pessoa — e, mais importante, sem
           nenhum caminho para série diária de terceiro. */
        const [p, b, c] = await Promise.all([
          supabase.from("v_desafio_progresso")
            .select("user_id,display_name,sou_eu,feito,combinado")
            .eq("challenge_id", emCurso.id),
          supabase.rpc("barra_do_grupo", { p_challenge: emCurso.id }),
          supabase.from("group_data_consents")
            .select("user_id", { count: "exact", head: true })
            .eq("group_id", grupoId).eq("metric_key", emCurso.metric_key),
        ]);
        if (p.error) throw p.error;
        progresso = (p.data ?? []) as typeof progresso;
        /* `b` e `c` NÃO derrubam a tela, mas também não passam calados: o erro
           vira "não sei" (null), e quem desenha escreve "não consegui carregar"
           em vez de afirmar um fato sobre o grupo. */
        barra = b.error ? null : primeiraBarra(b.data);
        consentimentosNoDesafio = c.error ? null : (c.count ?? 0);
      }

      let barraEncerrado: BarraDoGrupo | null = null;
      let meuEncerrado: number | null = null;
      if (encerrado) {
        const [meu, doGrupo] = await Promise.all([
          supabase.rpc("total_do_ciclo", { p_challenge: encerrado.id, p_user: user!.id }),
          supabase.rpc("barra_do_grupo", { p_challenge: encerrado.id }),
        ]);
        meuEncerrado = meu.error ? null : numeroOuNulo(meu.data);
        barraEncerrado = doGrupo.error ? null : primeiraBarra(doGrupo.data);
      }

      const presencas = ((hoje.data ?? []) as {
        user_id: string; display_name: string; sou_eu: boolean;
        day: string; metric_key: SocialMetricKey; voltou: boolean;
      }[]).map((p) => ({
        userId: p.user_id, nome: p.display_name, souEu: !!p.sou_eu,
        dia: p.day, metricKey: p.metric_key, voltou: !!p.voltou,
      } as Presenca));

      const linhasDaSemana = ((semana.data ?? []) as {
        user_id: string; metric_key: SocialMetricKey; label: string;
        label_curto?: string | null;
        feito: number | null; combinado: number | null;
      }[]);

      /* QUEM TEM DIREITO AO NÚMERO, por métrica. Uma linha da semana com
         `feito` não-nulo prova que quem olha PODE ler aquele número daquela
         pessoa (consentimento de pé, reciprocidade, dentro da janela). A folha
         do desafio usa isto para não sumir com alguém: `total_do_ciclo` faz
         `sum()` sem `coalesce`, então zero linhas devolve NULL — o mesmo NULL
         de "não há direito". Sem a ponte, a mesma pessoa aparecia "0 de 6" no
         cartão e SUMIA da folha, a um toque de distância.
         O conserto definitivo é no banco (`coalesce(sum(v.value), 0)` em
         `total_do_ciclo`, como `total_da_semana` já faz); enquanto ele não
         vem, a tela não inventa direito — ela só deixa de esconder quem já
         está visível ao lado. */
      const temDireitoAoNumero = new Set(
        linhasDaSemana.filter((l) => l.feito !== null).map((l) => `${l.user_id}|${l.metric_key}`),
      );

      const voltaramHoje = new Set(
        presencas.filter((p) => p.voltou && p.dia === hojeIso).map((p) => p.userId),
      );

      /* OS CARTÕES DE PESSOA. A lista sai de `group_members`, não das linhas
         da semana: quem está no grupo e não compartilha nada APARECE — com o
         nome e uma frase, nunca como buraco. É `linhaDaSemana` que decide o
         que cada métrica vira, e o que ela manda ocultar some aqui. */
      const membrosDoGrupo: PessoaDoGrupo[] = gente.map((m) => ({
        userId: m.user_id,
        nome: m.display_name,
        emoji: m.avatar_emoji,
        souEu: m.user_id === user!.id,
        voltouHoje: voltaramHoje.has(m.user_id),
        metricas: linhasDaSemana
          .filter((l) => l.user_id === m.user_id)
          .map((l) => ({
            key: l.metric_key,
            label: l.label,
            /* O curto vem do BANCO, e o longo é a reserva: enquanto a
               migration `20260918210000` não rodar, a ficha desenha o rótulo
               longo — mais larga do que devia, e correta. O front não guarda
               uma segunda tabela de rótulos para preencher esse intervalo. */
            labelCurto: l.label_curto || l.label,
            linha: linhaDaSemana({ feito: l.feito, combinado: l.combinado }),
          }))
          .filter((x): x is PessoaComMetrica => linhaVisivel(x.linha)),
      })).sort(porNomeDoGrupo);

      const todosReconhecimentos = (reconhecimentos.data ?? []) as {
        giver_id: string; subject_id: string; ref_day: string;
      }[];

      return {
        nome: g?.name ?? "Grupo",
        pessoas: Number(g?.pessoas ?? 0),
        papel: g?.role ?? "member",
        diasRestantes: Number(g?.dias_restantes ?? 0),
        vigente: !!g?.vigente,
        terminaEm: g?.ends_on ?? "",
        consentimentos: ((consentimentos.data ?? []) as {
          metric_key: SocialMetricKey; label: string; o_que_o_zero_diz: string;
          compartilhado: boolean; goal_value: number | null; dias_publicados: number;
        }[]).map((c) => ({
          key: c.metric_key, label: c.label, oQueOZeroDiz: c.o_que_o_zero_diz,
          ligado: !!c.compartilhado,
          meta: c.goal_value === null ? null : Number(c.goal_value),
          diasPublicados: Number(c.dias_publicados),
        } as ConsentimentoDaFolha)),
        desafio: emCurso
          ? {
            id: emCurso.id, nome: emCurso.name, metricKey: emCurso.metric_key,
            comecaEm: emCurso.starts_on, terminaEm: emCurso.ends_on,
            participantes: emCurso.challenge_participants.map((p) => p.user_id),
          }
          : null,
        desafioFuturo: futuro
          ? { nome: futuro.name, comecaEm: futuro.starts_on, terminaEm: futuro.ends_on }
          : null,
        encerrado: encerrado
          ? { nome: encerrado.name, comecaEm: encerrado.starts_on, terminaEm: encerrado.ends_on }
          : null,
        progresso,
        barra,
        consentimentosNoDesafio,
        barraEncerrado,
        meuEncerrado,
        membros: membrosDoGrupo,
        temDireitoAoNumero,
        semanaIndisponivel,
        presencas,
        recados: ((recados.data ?? []) as {
          id: string; author_id: string; text: string; created_at: string;
        }[]).map((r) => ({
          id: r.id, nome: nomes.get(r.author_id) ?? "Alguém",
          souEu: r.author_id === user!.id, texto: r.text, criadoEm: r.created_at,
        } as Recado)),
        /* Os reconhecimentos que EU dei (para o botão saber que já foi) e os
           que EU recebi (o contador que só quem recebeu vê). O grupo não vê o
           número de ninguém: contador público de apoio é placar de
           popularidade com outro nome. */
        dei: new Set(todosReconhecimentos
          .filter((r) => r.giver_id === user!.id)
          .map((r) => `${r.subject_id}|${r.ref_day}`)),
        recebi: todosReconhecimentos
          .filter((r) => r.subject_id === user!.id)
          .reduce((m, r) => m.set(r.ref_day, (m.get(r.ref_day) ?? 0) + 1), new Map<string, number>()),
        convites: ((convites.data ?? []) as {
          id: string; created_at: string; expires_at: string; uses: number; max_uses: number;
        }[]).filter((c) => c.uses < c.max_uses)
          .map((c) => ({ id: c.id, criadoEm: c.created_at, expiraEm: c.expires_at } as ConviteAberto)),
      };
    },
  });
}

const numeroOuNulo = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/** `barra_do_grupo` devolve `setof` — zero linhas quando o k não fechou ou
 *  quem pergunta não participa. Zero linhas é AUSÊNCIA DE BARRA, nunca uma
 *  barra de zero: uma barra vazia diria "o grupo não fez nada", que é uma
 *  frase sobre pessoas, e falsa. */
function primeiraBarra(v: unknown): BarraDoGrupo | null {
  const linha = Array.isArray(v) ? v[0] : v;
  if (!linha || typeof linha !== "object") return null;
  const b = linha as { feito: unknown; combinado: unknown; pessoas: unknown };
  if (b.feito === null || b.feito === undefined) return null;
  return {
    feito: Number(b.feito),
    combinado: Number(b.combinado ?? 0),
    pessoas: Number(b.pessoas ?? 0),
  };
}

/* ═══ AS AÇÕES ════════════════════════════════════════════════════════════ */

export function useAcoesDoGrupo(grupoId: string, consentimentos: ConsentimentoDaFolha[]) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [criandoConvite, setCriandoConvite] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [criandoDesafio, setCriandoDesafio] = useState(false);
  const [entrandoNoDesafio, setEntrandoNoDesafio] = useState(false);
  const [enviandoRecado, setEnviandoRecado] = useState(false);
  const [linkNovo, setLinkNovo] = useState<string | null>(null);

  const invalidar = useMemo(
    () => () => qc.invalidateQueries({ queryKey: ["social-grupo", grupoId] }),
    [qc, grupoId],
  );

  /**
   * Ligar, desligar e reajustar a meta — nesta ordem.
   *
   * DESLIGAR PRIMEIRO, e é regra, não estilo: se a chamada cair no meio, o
   * pior estado possível é ter compartilhado de MENOS. Fail-closed não é só do
   * banco. E desligar é `delete`: o gatilho `trg_despublicar_ao_revogar` apaga
   * o histórico já publicado daquele tipo — retroativo, não só daqui pra
   * frente. Regra de privacidade como cláusula WHERE é regra a um bug de
   * distância; como deleção, não é.
   */
  const salvarConsentimentos = async (
    proximos: { key: SocialMetricKey; meta: number }[],
  ): Promise<boolean> => {
    if (!user) return false;
    const antes = new Map(
      consentimentos.filter((c) => c.ligado).map((c) => [c.key, c.meta ?? 0]),
    );
    const depois = new Map(proximos.map((p) => [p.key, p.meta]));

    const desligar = [...antes.keys()].filter((k) => !depois.has(k));
    const ligar = proximos.filter((p) => !antes.has(p.key));
    const reajustar = proximos.filter((p) => antes.has(p.key) && antes.get(p.key) !== p.meta);

    if (desligar.length) {
      const { error } = await supabase.from("group_data_consents")
        .delete().eq("group_id", grupoId).eq("user_id", user.id).in("metric_key", desligar);
      if (error) { toast.error("Não consegui salvar. Nada foi alterado."); return false; }
      toast.dismiss("Não consegui salvar. Nada foi alterado.");
    }
    if (ligar.length) {
      const { error } = await supabase.from("group_data_consents").insert(
        ligar.map((p) => ({
          group_id: grupoId, user_id: user.id, metric_key: p.key,
          goal_value: p.meta, goal_period: "semana",
        })),
      );
      if (error) { toast.error("Não consegui ligar tudo. Confira a lista."); invalidar(); return false; }
      toast.dismiss("Não consegui ligar tudo. Confira a lista.");
    }
    /* O TERCEIRO RAMO TAMBÉM CONFERE O ERRO. Ele não conferia, e os dois de
       cima sim — então mudar a meta de treino de 6 para 3 e ver o `update` ser
       recusado (RLS, rede caindo entre as duas chamadas) produzia um "Pronto."
       verde, seguido do `invalidar()` recarregando a meta antiga na cara da
       pessoa. Ela não tinha como saber se salvou. E, sendo um laço sequencial,
       o estado parcial existe de verdade: três metas mudadas e a quarta
       falhando ainda diria "Pronto.". */
    const falhas: string[] = [];
    for (const p of reajustar) {
      const { error } = await supabase.from("group_data_consents")
        .update({ goal_value: p.meta })
        .eq("group_id", grupoId).eq("user_id", user.id).eq("metric_key", p.key);
      if (error) falhas.push(p.key);
    }
    if (falhas.length) {
      const quais = falhas
        .map((k) => SHAREABLE_METRICS[k as SocialMetricKey]?.label ?? k)
        .join(", ");
      toast.error(`Não consegui salvar a meta de ${quais}. Confira a lista.`, { id: "grupo-metas" });
      invalidar();
      return false;
    }

    toast.dismiss("grupo-metas");
    toast.success(proximos.length
      ? "Pronto. O grupo passa a ver só o que você ligou."
      : "Pronto. O grupo não vê nada seu — dá para ser só torcida.");
    invalidar();
    return true;
  };

  const criarConvite = async () => {
    setCriandoConvite(true);
    const { data: codigo, error } = await supabase.rpc("criar_convite", { p_group: grupoId });
    setCriandoConvite(false);
    if (error || !codigo) {
      // O banco recusa COM MOTIVO (não é admin, três convites abertos, grupo
      // vencido, muitos convites em pouco tempo). Mostrar o motivo dele é
      // melhor que um "tente de novo" que manda a pessoa repetir uma ação que
      // nunca vai funcionar.
      toast.error(error?.message ?? "Não consegui criar o convite. Tente de novo.", { id: "grupo-convite" });
      return;
    }
    toast.dismiss("grupo-convite");
    setLinkNovo(`${window.location.origin}/app/social?convite=${encodeURIComponent(String(codigo))}`);
    invalidar();
  };

  const cancelarConvite = async (id: string) => {
    const { error } = await supabase.from("group_invites")
      .update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error("Não consegui cancelar. Tente de novo."); return; }
    toast.dismiss("Não consegui cancelar. Tente de novo.");
    toast.success("Convite cancelado. O link deixa de funcionar agora.");
    invalidar();
  };

  /**
   * RECONHECER O DIA DE ALGUÉM — a Camada 3, no lugar do ranking.
   *
   * O alvo é a PESSOA e o DIA dela, não um item de mural: o banco nem tem onde
   * guardar "curtida de post". É a única forma de comparação social que cura
   * em vez de ferir — o grupo nota quem voltou, em vez de ordenar quem
   * produziu. `check (giver_id <> subject_id)` impede reconhecer a si mesmo; a
   * tela nem oferece o botão.
   */
  const reconhecer = async (subjectId: string, dia: string) => {
    if (!user || subjectId === user.id) return;
    const { error } = await supabase.from("group_recognitions")
      .insert({ group_id: grupoId, giver_id: user.id, subject_id: subjectId, ref_day: dia });
    // Reconhecer duas vezes não é erro: a chave primária já impede, e avisar
    // transformaria um gesto em cobrança de atenção.
    if (!error) invalidar();
  };

  const criarDesafio = async (d: {
    nome: string; metricKey: SocialMetricKey; comeca: string; termina: string;
  }): Promise<boolean> => {
    if (!user) return false;
    setCriandoDesafio(true);
    const { data: novo, error } = await supabase.from("challenges").insert({
      group_id: grupoId, name: d.nome, metric_key: d.metricKey,
      starts_on: d.comeca, ends_on: d.termina, created_by: user.id,
    }).select("id").single();
    if (!error && novo) {
      /* Quem combina entra no combinado — e só quem combina. Ninguém é
         inscrito por outra pessoa: participar é opt-in de cada um. */
      await supabase.from("challenge_participants")
        .insert({ challenge_id: novo.id, user_id: user.id });
    }
    setCriandoDesafio(false);
    if (error) { toast.error(error.message ?? "Não consegui criar o desafio.", { id: "grupo-desafio" }); return false; }
    toast.dismiss("grupo-desafio");
    toast.success("Combinado. Ele termina sozinho na data — sem prêmio, e sem cobrança.");
    invalidar();
    return true;
  };

  const participar = async (desafioId: string) => {
    if (!user) return;
    setEntrandoNoDesafio(true);
    const { error } = await supabase.from("challenge_participants")
      .insert({ challenge_id: desafioId, user_id: user.id });
    setEntrandoNoDesafio(false);
    if (error) { toast.error("Não consegui entrar no desafio. Tente de novo."); return; }
    toast.dismiss("Não consegui entrar no desafio. Tente de novo.");
    invalidar();
  };

  const enviarRecado = async (texto: string): Promise<boolean> => {
    if (!user || !texto.trim()) return false;
    setEnviandoRecado(true);
    const { error } = await supabase.from("group_notes")
      .insert({ group_id: grupoId, author_id: user.id, text: texto.trim() });
    setEnviandoRecado(false);
    if (error) { toast.error("Não consegui enviar. Tente de novo."); return false; }
    toast.dismiss("Não consegui enviar. Tente de novo.");
    invalidar();
    return true;
  };

  const sair = async (depois: () => void) => {
    setSaindo(true);
    const { error } = await supabase.rpc("sair_do_grupo", { p_group: grupoId });
    setSaindo(false);
    if (error) { toast.error("Não consegui sair agora. Tente de novo."); return; }
    toast.dismiss("Não consegui sair agora. Tente de novo.");
    // Sem diálogo de retenção. "Tem certeza? seus amigos vão sentir sua falta"
    // é proibido — sair é um toque, e o grupo não recebe anúncio.
    toast.success("Você saiu. O que o grupo via de você foi apagado.");
    qc.invalidateQueries({ queryKey: ["social-grupos"] });
    depois();
  };

  return {
    invalidar,
    salvarConsentimentos,
    criarConvite, cancelarConvite, criandoConvite, linkNovo, setLinkNovo,
    reconhecer,
    criarDesafio, criandoDesafio,
    participar, entrandoNoDesafio,
    enviarRecado, enviandoRecado,
    sair, saindo,
  };
}
