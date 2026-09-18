import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import QueryError from "@/components/core/QueryError";
import SocialConsentSheet from "@/components/core/SocialConsentSheet";
import SocialInviteSheet from "@/components/core/SocialInviteSheet";
import SocialChallengeSheet from "@/components/core/SocialChallengeSheet";
import PessoasDoGrupo from "@/components/social/PessoasDoGrupo";
import FeedDoGrupo from "@/components/social/FeedDoGrupo";
import FaixaDoDesafio from "@/components/social/FaixaDoDesafio";
import FolhaDoDesafio from "@/components/social/FolhaDoDesafio";
import MenuDoGrupo from "@/components/social/MenuDoGrupo";
import { prazo, rotuloDoDia } from "@/components/social/uteis";
import { ehAdmin, useAcoesDoGrupo, useGrupo } from "@/hooks/useGrupo";
import { textoDoTempo, useGrupoAoVivo, useMarcadorDeNovo } from "@/hooks/useGrupoAoVivo";
import { diaLocal } from "@/lib/socialSemana";
import ConfirmarSaida from "@/components/social/ConfirmarSaida";
import { ChevronLeft, Settings2 } from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   TELA (b) — O GRUPO ABERTO
   ═══════════════════════════════════════════════════════════════════════════

   A HIERARQUIA, e ela é a decisão de desenho desta rodada:

     1. a FAIXA do desafio — uma linha logo abaixo do cabeçalho, que abre a
        folha com o detalhe. Quando não há desafio, ela não existe.
     2. as PESSOAS — os cartões. É a tela; é o que a pessoa vem ver.
     3. o FEED — hoje e ontem, e acabou.
     4. as AÇÕES — no `⋯` do cabeçalho, fora do corpo.

   O QUE SAIU, e por quê: o bloco "A semana de cada um" em forma de lista
   (absorvido pelos cartões, e era a duplicata que mais parecia placar) e os
   parágrafos explicativos que se repetiam em cada seção. A doutrina se explica
   UMA vez — na frase-âncora do bloco de pessoas e no estado vazio.

   ─── O QUE ESTA TELA NUNCA MOSTRA, e é estrutural ─────────────────────────

   · **Ausência.** Nenhuma linha diz que alguém não registrou. Sem "visto por
     último", sem "online", sem calendário de bolinhas de terceiro — e repare
     que `v_grupo_hoje` não aceita intervalo de datas, então a série diária do
     outro não sai do banco nem se a tela pedir.
   · **Número comparável.** Sem kg, kcal, litros, gramas, R$, minutos.
   · **Contador público de apoio.** Um gesto só, e o número só quem recebeu vê.
   · **Ordinal entre pessoas.** Nem por soma: soma é monotônica em presença.
   · **Feed infinito.** A tela tem começo, meio e FIM: hoje e ontem, e acabou.
   · **Badge, bolinha, contador de não-lidos.** Em lugar nenhum — nem quando o
     tempo real traz coisa nova (ver `useGrupoAoVivo`).
   · **Descoberta.** Nenhuma sugestão de gente, nenhuma prévia de grupo alheio.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function TelaDoGrupo({
  grupoId, onVoltar, comoChegou,
}: {
  grupoId: string;
  onVoltar: () => void;
  /** O ATO que trouxe a pessoa até aqui agora — `null` quando ela só abriu um
   *  grupo que já era dela. Ver `modoDeEntrada` em `pages/Social.tsx`. */
  comoChegou: "entrar" | "criar" | null;
}) {
  const { user } = useAuth();
  /* O MODO DA FOLHA vem de "estou entrando AGORA por ela", nunca de "ainda
     não consenti nada". Eram duas coisas diferentes tratadas como uma só, e
     por isso a dona de um grupo de três semanas, que nunca ligou métrica
     nenhuma, lia "Entrar no grupo" e "Entrar sem compartilhar nada ainda →"
     ao abrir a engrenagem (achado do QA, rodada 4). Quem abre pela
     engrenagem está REVISANDO, sempre — mesmo com a lista inteira desligada. */
  const [consentAberto, setConsentAberto] = useState(!!comoChegou);
  const [modoDaFolha, setModoDaFolha] = useState<"entrar" | "criar" | "revisar">(
    comoChegou ?? "revisar",
  );
  const revisarConsentimento = () => { setModoDaFolha("revisar"); setConsentAberto(true); };
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const [conviteAberto, setConviteAberto] = useState(false);
  const [criarDesafioAberto, setCriarDesafioAberto] = useState(false);
  const [folhaDesafioAberta, setFolhaDesafioAberta] = useState(false);
  const [recado, setRecado] = useState("");

  /* O SINO PRIMEIRO, A CONSULTA DEPOIS: é ele que decide se a tela precisa
     reconsultar por intervalo. Num banco que ainda não rodou a migration do
     canal, `vivo` nasce falso, o intervalo assume — e a pessoa não vê erro
     nenhum. O sino não carrega dado: ele diz "mudou algo neste grupo", e quem
     rebusca é a consulta abaixo, pelas views, que já têm a regra. */
  const qc = useQueryClient();
  const aoMudar = useCallback(
    () => { qc.invalidateQueries({ queryKey: ["social-grupo", grupoId] }); },
    [qc, grupoId],
  );
  const aoVivo = useGrupoAoVivo(grupoId, aoMudar);
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useGrupo(grupoId, { refetchInterval: aoVivo.intervalo });
  const acoes = useAcoesDoGrupo(grupoId, data?.consentimentos ?? []);

  /* O dia de hoje anda junto com o relógio do cabeçalho: na virada da
     meia-noite "hoje" vira "ontem" sozinho, e o timer do sino já invalidou a
     consulta. Sem isso, uma tela aberta desde ontem à noite mente. */
  const agora = useMemo(() => new Date(aoVivo.agora), [aoVivo.agora]);
  const hojeIso = useMemo(() => diaLocal(agora), [agora]);

  /* O MARCADOR DE "NOVO": os ids do feed, na ordem em que a tela os desenha.
     Ele marca o evento ÚNICO e ignora o lote — ver `useMarcadorDeNovo`. */
  const idsDoFeed = useMemo(() => {
    if (!data) return [] as string[];
    /* Sem repetidos: "voltou" é UM item por pessoa por dia, mesmo quando ela
       registrou cinco métricas. Um id repetido faria o marcador contar duas
       chegadas onde houve uma, e a regra do lote (marca só o evento único)
       deixaria de valer justamente no caso que ela existe para pegar. */
    return [...new Set([
      ...data.presencas.map((p) => `ato|${p.userId}|${p.dia}|${p.metricKey}`),
      ...data.presencas.filter((p) => p.voltou).map((p) => `voltou|${p.userId}|${p.dia}`),
      ...data.recados.map((r) => `recado|${r.id}`),
    ])];
  }, [data]);
  const novos = useMarcadorDeNovo(idsDoFeed);

  const souAdmin = ehAdmin(data?.papel);

  return (
    /* `max-w-3xl` (768px): com `sm:grid-cols-2`, o teto de 672px dava 313px por
       cartão em 1440px — MENOS que os 322px do mesmo cartão em 390px. O desktop
       prometia mais ar e entregava menos. A coluna continua com teto: a tela não
       é um painel, e esticar cartão de pessoa por 1440px só aumenta a distância
       de varredura. */
    <div className="max-w-3xl mx-auto space-y-4 animate-fade-up">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost" size="icon" className="w-11 h-11 shrink-0 -ml-2"
          onClick={onVoltar} aria-label="Voltar para os meus grupos"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-semibold truncate">{data?.nome ?? "Grupo"}</h1>
          {!!data && (
            <p className="text-xs text-muted-foreground">
              {data.pessoas} {data.pessoas === 1 ? "pessoa" : "pessoas"}
              {" · "}{prazo(data.vigente, data.diasRestantes)}
            </p>
          )}
        </div>
        {/* A folha do consentimento é o controle mais importante da tela e
            fica à vista; o resto das ações vai para o `⋯`. */}
        <Button
          variant="ghost" size="icon" className="w-11 h-11 shrink-0"
          onClick={revisarConsentimento} aria-label="O que este grupo vê de você"
        >
          <Settings2 className="w-5 h-5" />
        </Button>
        {!!data && (
          <MenuDoGrupo
            souAdmin={souAdmin}
            vigente={data.vigente}
            temDesafio={!!data.desafio || !!data.desafioFuturo}
            saindo={acoes.saindo}
            onConvidar={() => setConviteAberto(true)}
            onCombinarDesafio={() => setCriarDesafioAberto(true)}
            onSair={() => setConfirmarSaida(true)}
          />
        )}
      </div>

      {isError && (
        <QueryError
          title="Não consegui carregar este grupo."
          detail="Pode ser a conexão. Nada seu foi compartilhado por causa disso — o que o grupo vê depende só do que você ligou."
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      )}

      {isLoading && <Skeleton className="h-64 w-full rounded-xl" />}

      {data && (
        <>
          <FaixaDoDesafio
            desafio={data.desafio}
            futuro={data.desafio ? null : data.desafioFuturo}
            encerrado={data.desafio || data.desafioFuturo ? null : data.encerrado}
            hojeIso={hojeIso}
            onAbrir={() => setFolhaDesafioAberta(true)}
          />

          <PessoasDoGrupo
            pessoas={data.membros}
            atualizadoHa={textoDoTempo(dataUpdatedAt, aoVivo.agora)}
            vigente={data.vigente}
            terminouEm={data.terminaEm}
            semanaIndisponivel={data.semanaIndisponivel}
            onAbrirConsentimento={revisarConsentimento}
          />

          <FeedDoGrupo
            presencas={data.presencas}
            recados={data.recados}
            pessoas={data.membros}
            hojeIso={hojeIso}
            dei={data.dei}
            recebi={data.recebi}
            novos={novos}
            vigente={data.vigente}
            recado={recado}
            setRecado={setRecado}
            enviando={acoes.enviandoRecado}
            onEnviar={async () => { if (await acoes.enviarRecado(recado)) setRecado(""); }}
            onReconhecer={acoes.reconhecer}
            rotuloDoDia={(dia) => rotuloDoDia(dia, agora)}
          />

          {/* O aviso "sair apaga o histórico" era um parágrafo permanente aqui.
              Ele agora vive dentro de `ConfirmarSaida`, que é onde a decisão
              acontece — a doutrina se explica uma vez, e um aviso lido no
              momento do ato vale mais que um aviso lido todo dia. */}

          <FolhaDoDesafio
            open={folhaDesafioAberta}
            onOpenChange={setFolhaDesafioAberta}
            dados={data}
            meuId={user?.id ?? ""}
            onParticipar={acoes.participar}
            entrando={acoes.entrandoNoDesafio}
            onCombinarOutro={() => { setFolhaDesafioAberta(false); setCriarDesafioAberto(true); }}
            podeCombinar={souAdmin && data.vigente}
          />
          <ConfirmarSaida
            open={confirmarSaida}
            onOpenChange={setConfirmarSaida}
            saindo={acoes.saindo}
            onConfirmar={() => acoes.sair(onVoltar)}
          />
          <SocialConsentSheet
            open={consentAberto}
            onOpenChange={setConsentAberto}
            grupoNome={data.nome}
            linhas={data.consentimentos}
            onSalvar={acoes.salvarConsentimentos}
            modo={modoDaFolha}
          />
          <SocialChallengeSheet
            open={criarDesafioAberto}
            onOpenChange={setCriarDesafioAberto}
            criando={acoes.criandoDesafio}
            onCriar={acoes.criarDesafio}
          />
          <SocialInviteSheet
            open={conviteAberto}
            onOpenChange={(v) => { setConviteAberto(v); if (!v) acoes.setLinkNovo(null); }}
            link={acoes.linkNovo}
            abertos={data.convites}
            criando={acoes.criandoConvite}
            onCriar={acoes.criarConvite}
            onCancelar={acoes.cancelarConvite}
            aviso5={data.pessoas >= 4}
          />
        </>
      )}
    </div>
  );
}
