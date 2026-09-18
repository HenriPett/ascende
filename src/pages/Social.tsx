import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import QueryError from "@/components/core/QueryError";
import SocialConsentSheet, { type ConsentimentoDaFolha } from "@/components/core/SocialConsentSheet";
import SocialInviteSheet, { type ConviteAberto } from "@/components/core/SocialInviteSheet";
import SocialChallengeSheet from "@/components/core/SocialChallengeSheet";
import { frasePublica } from "@/components/core/socialPhrases";
import {
  weekScoreboard, fullDayThreshold, FULL_DAY_SIGNALS, type MemberTotals,
} from "@/lib/socialChallenge";
import type { SocialMetricKey } from "@/lib/socialMetrics";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Users, ChevronLeft, ChevronRight, Settings2, UserPlus, Lock, Loader2,
  HandHeart, LogOut, Send, Sunrise,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   SOCIAL — o grupo que combina, não a plateia que assiste
   ═══════════════════════════════════════════════════════════════════════════

   O objeto deste recurso é o COMBINADO, não o mural. Não é marketing: é o que
   decide cada pixel abaixo, e é a diferença entre um Social que sobrevive ao
   PRINCIPIOS.md e uma cópia do GymRats, que não sobrevive. O próprio GRUPO tem
   data de fim (`groups.ends_on`, NOT NULL) — não é um espaço permanente que
   existe para ser rolado.

   ─── TRÊS COISAS QUE O BANCO ENSINOU A ESTA TELA ──────────────────────────

   Esta tela já falou com tabelas que não existiam (`group_feed`,
   `group_reactions`, `group_member_goals`), e o conserto não foi renomear
   coluna: foi entender que o modelo dizia coisas que o meu desenho ignorava.
   As três, porque cada uma virou regra de interface:

   1. **O FEED DE PRESENÇA NÃO É UMA TABELA.** Não existe linha "Ana registrou
      um treino" guardada em lugar nenhum, e é de propósito: duplicar o dado
      criaria uma SEGUNDA cópia para revogar, e a doutrina é "publicar é
      copiar, revogar é apagar" — com UMA cópia só. A presença se DERIVA de
      `v_grupo_hoje`, que já é o que o grupo pode ver, filtrado por
      consentimento, janela e reciprocidade. `group_notes` é só o recado
      escrito à mão. A tela junta os dois por data.

   2. **O "FORÇA" NÃO É CURTIDA DE POST.** É reconhecimento do DIA de uma
      PESSOA (`group_recognitions`, com `check (giver_id <> subject_id)`).
      Isso não é detalhe de schema: é a Camada 3 do parecer, a que ele mandou
      construir NO LUGAR do ranking. O alvo é quem voltou, não o post — a
      comparação social cura quando o grupo nota quem voltou, e fere quando
      ordena quem produziu.

   3. **A META MORA NO CONSENTIMENTO.** `group_data_consents.goal_value` é NOT
      NULL: não existe ligar um tipo de dado sem combinar quanto. Faz sentido —
      sem denominador, a tela só teria número absoluto, e número absoluto ao
      lado de número absoluto já é um ranking, mesmo sem coluna de posição.

   ─── O QUE ESTA TELA NUNCA MOSTRA, e é estrutural ─────────────────────────

   · **Ausência.** Nenhuma linha diz que alguém não registrou. Sem "visto por
     último", sem "online", sem calendário de bolinhas de terceiro — e repare
     que `v_grupo_hoje` não aceita intervalo de datas, então a série diária do
     outro não sai do banco nem se a tela pedir.
   · **Número comparável.** Sem kg, kcal, litros, gramas, R$, minutos.
   · **Contador público de apoio.** Um gesto só, e o número só quem recebeu vê.
   · **Ordinal entre pessoas.** Nem por soma: soma é monotônica em presença.
   · **Feed infinito.** A tela tem começo, meio e FIM: hoje e ontem, e acabou.
   · **Badge, bolinha, contador de não-lidos.** Em lugar nenhum.
   · **Descoberta.** Nenhuma sugestão de gente, nenhuma prévia de grupo alheio.
   ═══════════════════════════════════════════════════════════════════════════ */

interface MeuGrupo {
  id: string;
  nome: string;
  diasRestantes: number;
  vigente: boolean;
  papel: string;
  pessoas: number;
}

/** Uma linha de presença, vinda de `v_grupo_hoje`. O valor já chegou filtrado
 *  por consentimento e reciprocidade: se está aqui, o grupo pode ver. */
interface Presenca {
  userId: string;
  nome: string;
  souEu: boolean;
  dia: string;
  metricKey: SocialMetricKey;
  /** Camada 3: registrou hoje depois de uma semana sem registrar. É um BIT —
   *  o banco nunca devolve quantos dias, porque o número é o denominador da
   *  ausência. */
  voltou: boolean;
}

interface Recado {
  id: string;
  nome: string;
  souEu: boolean;
  texto: string;
  criadoEm: string;
}

const ehAdmin = (papel?: string) => papel === "owner" || papel === "admin";

/** O chip de escolha, no padrão da casa: 44px de alvo, e tinta escura sobre a
 *  sálvia porque o branco reprova AA nos dois temas. */
const chip = (ativo: boolean) => cn(
  "text-sm rounded-full border px-4 min-h-11 transition-colors",
  ativo ? "border-transparent text-primary-foreground" : "text-muted-foreground hover:bg-muted/60",
);

/* ─── A tela ──────────────────────────────────────────────────────────────
   Uma rota só (`/app/social`), e o grupo aberto vive na query `?g=`. O Voltar
   do navegador sai do grupo em vez de sair do app, e um grupo aberto é um
   endereço — dá para recarregar sem perder onde se estava. */
export default function Social() {
  const [params, setParams] = useSearchParams();
  const grupoAberto = params.get("g");
  /* O convite chega pela MESMA rota, em `?convite=`. Uma rota a menos para o
     mundo conhecer, e o link cai dentro da área autenticada — quem ainda não
     tem conta passa pela porta que já existe. */
  const convite = params.get("convite");

  const abrir = (id: string | null, primeiraVez = false) => {
    const proximos = new URLSearchParams(params);
    if (id) proximos.set("g", id); else proximos.delete("g");
    proximos.delete("convite");
    // Acabou de entrar (ou de criar): a folha de consentimento é a PRIMEIRA
    // coisa que ela vê do grupo. É onde a decisão acontece, e adiar essa tela
    // seria deixar a pessoa dentro de um grupo antes de ela ter escolhido o
    // que ele vê.
    if (primeiraVez) proximos.set("entrando", "1"); else proximos.delete("entrando");
    setParams(proximos, { replace: !id });
  };

  return grupoAberto
    ? (
      <Grupo
        grupoId={grupoAberto}
        primeiraVez={params.get("entrando") === "1"}
        onVoltar={() => abrir(null)}
      />
    )
    : <ListaDeGrupos onAbrir={abrir} conviteDaUrl={convite} />;
}

/* ═══ TELA (a) — a lista, e a tela vazia ════════════════════════════════ */

function ListaDeGrupos({
  onAbrir, conviteDaUrl,
}: { onAbrir: (id: string, primeiraVez?: boolean) => void; conviteDaUrl: string | null }) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [criarAberto, setCriarAberto] = useState(false);
  // Chegou por link de convite: a folha abre já preenchida. Ela ainda tem de
  // tocar em "Entrar" — entrar em grupo por causa de um link aberto sem
  // querer é decisão que o app tomaria no lugar dela.
  const [entrarAberto, setEntrarAberto] = useState(!!conviteDaUrl);

  /* UMA consulta. `v_meus_grupos` já traz o nome, o papel, quantas pessoas e
     os dias restantes — a view foi construída como caminho de leitura, e ir
     direto nas tabelas era refazer à mão o que ela já faz. */
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["social-grupos", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: linhas, error } = await supabase
        .from("v_meus_grupos")
        .select("id,name,dias_restantes,vigente,role,pessoas")
        .order("ends_on", { ascending: true });
      if (error) throw error;
      return ((linhas ?? []) as {
        id: string; name: string; dias_restantes: number;
        vigente: boolean; role: string; pessoas: number;
      }[]).map((g) => ({
        id: g.id, nome: g.name, diasRestantes: Number(g.dias_restantes),
        vigente: g.vigente, papel: g.role, pessoas: Number(g.pessoas),
      } as MeuGrupo));
    },
  });

  const grupos = data ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold">Social</h1>
        <p className="text-sm text-muted-foreground">Quem está no mesmo aperto que você.</p>
      </div>

      {isError && (
        <QueryError
          title="Não consegui carregar seus grupos."
          detail="Pode ser a conexão — nada do que você registrou se perdeu, e nada foi compartilhado sem você."
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      )}

      {isLoading && <Skeleton className="h-40 w-full rounded-xl" />}

      {!isLoading && !isError && grupos.length === 0 && (
        <Card className="p-6 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-muted grid place-items-center mx-auto">
            <Users className="w-7 h-7 text-muted-foreground" aria-hidden />
          </div>
          {/* O que esta tela NÃO tem, de propósito: nenhuma sugestão de
              "pessoas que você pode conhecer" (busca de gente é padrão de
              crescimento, não de serviço), nenhuma prévia de feed alheio para
              dar vontade, e nenhum "3 amigos seus já estão aqui" — isso é
              pressão social disfarçada de informação. */}
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Um grupo pequeno — você e duas, três pessoas — que se acompanham por um tempo
            combinado. Não tem feed público, não tem desconhecido, não tem placar de quem
            treina mais.
          </p>
          <div className="space-y-2 max-w-xs mx-auto">
            <Button className="w-full min-h-11" onClick={() => setCriarAberto(true)}>
              Criar um grupo
            </Button>
            <Button
              variant="ghost" className="w-full min-h-11 text-muted-foreground"
              onClick={() => setEntrarAberto(true)}
            >
              Tenho um link de convite →
            </Button>
          </div>
        </Card>
      )}

      {grupos.length > 0 && (
        <>
          <div className="space-y-2.5">
            {grupos.map((g) => (
              <Card key={g.id}>
                <button
                  onClick={() => onAbrir(g.id)}
                  className="w-full flex items-center gap-4 p-4 min-h-[60px] text-left hover:bg-muted/40 transition-colors rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <div className="w-11 h-11 rounded-md grid place-items-center shrink-0 bg-muted">
                    <Users className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{g.nome}</p>
                    {/* Prazo FACTUAL, sem contagem regressiva: o combinado tem
                        fim, e dizer quando é serviço puro. "Últimas 24h!"
                        seria escassez artificial, que está vetada. */}
                    <p className="text-xs text-muted-foreground">
                      {g.pessoas} {g.pessoas === 1 ? "pessoa" : "pessoas"}
                      {" · "}{prazo(g.vigente, g.diasRestantes)}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                </button>
              </Card>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => setCriarAberto(true)}>
              Criar um grupo
            </Button>
            <Button variant="ghost" className="min-h-11 text-muted-foreground" onClick={() => setEntrarAberto(true)}>
              Tenho um link de convite →
            </Button>
          </div>
        </>
      )}

      {/* O rodapé da promessa. Não é decoração: é a razão pela qual alguém
          aceita colocar a própria semana na frente de outras pessoas. */}
      <Card className="p-4 space-y-1.5 bg-muted/30">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Lock className="w-4 h-4 shrink-0" /> Nasce fechado
        </p>
        <p className="text-sm text-muted-foreground">
          Nada seu é compartilhado até você escolher, item por item. Dinheiro nunca entra —
          nem se você quiser. Peso, humor, diário e batalhas também não.
        </p>
      </Card>

      <CriarGrupoDialog
        open={criarAberto}
        onOpenChange={setCriarAberto}
        nomeSugerido={profile?.name ?? ""}
        onCriado={(id) => onAbrir(id, true)}
      />
      <EntrarComCodigoDialog
        open={entrarAberto}
        onOpenChange={setEntrarAberto}
        codigoInicial={conviteDaUrl}
        nomeSugerido={profile?.name ?? ""}
        onEntrou={(id) => onAbrir(id, true)}
      />
    </div>
  );
}

/** O prazo em uma frase. Factual e sem urgência: "termina em 3 dias", nunca
 *  um relógio correndo. */
function prazo(vigente: boolean, dias: number): string {
  if (!vigente) return "o combinado terminou";
  if (dias <= 0) return "termina hoje";
  return `termina em ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/* ═══ TELA (b) — o grupo ativo ══════════════════════════════════════════ */

function Grupo({
  grupoId, onVoltar, primeiraVez,
}: { grupoId: string; onVoltar: () => void; primeiraVez: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [consentAberto, setConsentAberto] = useState(primeiraVez);
  const [conviteAberto, setConviteAberto] = useState(false);
  const [linkNovo, setLinkNovo] = useState<string | null>(null);
  const [criandoConvite, setCriandoConvite] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [desafioAberto, setDesafioAberto] = useState(false);
  const [criandoDesafio, setCriandoDesafio] = useState(false);
  const [entrandoNoDesafio, setEntrandoNoDesafio] = useState(false);
  const [recado, setRecado] = useState("");
  const [enviandoRecado, setEnviandoRecado] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["social-grupo", grupoId, user?.id],
    enabled: !!user && !!grupoId,
    queryFn: async () => {
      const [grupo, membros, consentimentos, desafios, hoje, recados, reconhecimentos, convites] =
        await Promise.all([
          supabase.from("v_meus_grupos")
            .select("name,dias_restantes,vigente,role,pessoas")
            .eq("id", grupoId).maybeSingle(),
          supabase.from("group_members")
            .select("user_id,display_name").eq("group_id", grupoId),
          /* O PREVIEW LITERAL da condição C5, e ele vem pronto da view: o
             catálogo INTEIRO, chave a chave, dizendo o que está ligado e o que
             está fechado — com o mesmo destaque. Mais `dias_publicados`, que é
             o número honesto: quantos dias meus este grupo já pode somar. */
          supabase.from("v_meus_consentimentos")
            .select("metric_key,label,o_que_o_zero_diz,compartilhado,goal_value,dias_publicados")
            .eq("group_id", grupoId),
          supabase.from("challenges")
            .select("id,name,metric_key,ends_on,challenge_participants(user_id)")
            .eq("group_id", grupoId).order("ends_on", { ascending: false }).limit(3),
          /* A presença de HOJE (e de ontem: a view corta em `current_date - 1`).
             Não existe versão dela com intervalo de datas, de propósito —
             série diária de terceiro é o calendário de bolinhas, e ele não sai
             do banco nem se a tela pedir. */
          supabase.from("v_grupo_hoje")
            .select("user_id,display_name,sou_eu,day,metric_key,voltou")
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

      const g = grupo.data as {
        name: string; dias_restantes: number; vigente: boolean;
        role: string; pessoas: number;
      } | null;

      // `display_name` é a identidade DO GRUPO — nunca lida de `profiles`, que
      // tem renda e remédios na mesma linha do nome, e RLS não recorta coluna.
      const nomes = new Map(((membros.data ?? []) as { user_id: string; display_name: string }[])
        .map((m) => [m.user_id, m.display_name]));

      const lista = (desafios.data ?? []) as unknown as {
        id: string; name: string; metric_key: SocialMetricKey; ends_on: string;
        challenge_participants: { user_id: string }[];
      }[];
      const hojeIso = new Date().toISOString().slice(0, 10);
      /* O desafio EXPIRA SOZINHO: ninguém encerra nada. `ends_on` no banco é o
         fim, e a partir do dia seguinte ele deixa de ser o em curso — o
         combinado acabou porque a data chegou, que é o que faz dele um
         combinado e não uma presença permanente. */
      const emCurso = lista.find((c) => c.ends_on >= hojeIso) ?? null;
      const encerrado = lista.find((c) => c.ends_on < hojeIso) ?? null;

      /* O placar de cada participante vem de `v_desafio_progresso`, que já traz
         `feito` (NULL = sem registro, nunca 0) ao lado de `combinado`. Uma
         consulta para o desafio inteiro em vez de uma chamada por pessoa — e,
         mais importante, sem nenhum caminho para série diária de terceiro. */
      let progresso: {
        user_id: string; display_name: string; sou_eu: boolean;
        feito: number | null; combinado: number | null;
      }[] = [];
      let barra: number | null = null;
      let consentimentosNoDesafio = 0;
      if (emCurso) {
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
        barra = b.data === null || b.data === undefined ? null : Number(b.data);
        consentimentosNoDesafio = c.count ?? 0;
      }

      let barraEncerrado: number | null = null;
      let meuEncerrado: number | null = null;
      if (encerrado) {
        const [meu, doGrupo] = await Promise.all([
          supabase.rpc("total_do_ciclo", { p_challenge: encerrado.id, p_user: user!.id }),
          supabase.rpc("barra_do_grupo", { p_challenge: encerrado.id }),
        ]);
        meuEncerrado = meu.data === null || meu.data === undefined ? null : Number(meu.data);
        barraEncerrado = doGrupo.data === null || doGrupo.data === undefined ? null : Number(doGrupo.data);
      }

      const todosReconhecimentos = (reconhecimentos.data ?? []) as {
        giver_id: string; subject_id: string; ref_day: string;
      }[];

      return {
        nome: g?.name ?? "Grupo",
        pessoas: Number(g?.pessoas ?? 0),
        papel: g?.role ?? "member",
        diasRestantes: Number(g?.dias_restantes ?? 0),
        vigente: !!g?.vigente,
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
            id: emCurso.id, nome: emCurso.name, terminaEm: emCurso.ends_on,
            participantes: emCurso.challenge_participants.map((p) => p.user_id),
          }
          : null,
        encerrado: encerrado ? { nome: encerrado.name, terminaEm: encerrado.ends_on } : null,
        progresso,
        barra,
        consentimentosNoDesafio,
        barraEncerrado,
        meuEncerrado,
        presencas: ((hoje.data ?? []) as {
          user_id: string; display_name: string; sou_eu: boolean;
          day: string; metric_key: SocialMetricKey; voltou: boolean;
        }[]).map((p) => ({
          userId: p.user_id, nome: p.display_name, souEu: !!p.sou_eu,
          dia: p.day, metricKey: p.metric_key, voltou: !!p.voltou,
        } as Presenca)),
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

  const invalidar = () => qc.invalidateQueries({ queryKey: ["social-grupo", grupoId] });

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
    if (!user || !data) return false;
    const antes = new Map(
      data.consentimentos.filter((c) => c.ligado).map((c) => [c.key, c.meta ?? 0]),
    );
    const depois = new Map(proximos.map((p) => [p.key, p.meta]));

    const desligar = [...antes.keys()].filter((k) => !depois.has(k));
    const ligar = proximos.filter((p) => !antes.has(p.key));
    const reajustar = proximos.filter((p) => antes.has(p.key) && antes.get(p.key) !== p.meta);

    if (desligar.length) {
      const { error } = await supabase.from("group_data_consents")
        .delete().eq("group_id", grupoId).eq("user_id", user.id).in("metric_key", desligar);
      if (error) { toast.error("Não consegui salvar. Nada foi alterado."); return false; }
    }
    if (ligar.length) {
      const { error } = await supabase.from("group_data_consents").insert(
        ligar.map((p) => ({
          group_id: grupoId, user_id: user.id, metric_key: p.key,
          goal_value: p.meta, goal_period: "semana",
        })),
      );
      if (error) { toast.error("Não consegui ligar tudo. Confira a lista."); invalidar(); return false; }
    }
    for (const p of reajustar) {
      await supabase.from("group_data_consents")
        .update({ goal_value: p.meta })
        .eq("group_id", grupoId).eq("user_id", user.id).eq("metric_key", p.key);
    }

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
      toast.error(error?.message ?? "Não consegui criar o convite. Tente de novo.");
      return;
    }
    setLinkNovo(`${window.location.origin}/app/social?convite=${encodeURIComponent(String(codigo))}`);
    invalidar();
  };

  const cancelarConvite = async (id: string) => {
    const { error } = await supabase.from("group_invites")
      .update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error("Não consegui cancelar. Tente de novo."); return; }
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
    if (error) { toast.error(error.message ?? "Não consegui criar o desafio."); return false; }
    toast.success("Combinado. Ele termina sozinho na data — sem prêmio, e sem cobrança.");
    invalidar();
    return true;
  };

  const participar = async () => {
    if (!user || !data?.desafio) return;
    setEntrandoNoDesafio(true);
    const { error } = await supabase.from("challenge_participants")
      .insert({ challenge_id: data.desafio.id, user_id: user.id });
    setEntrandoNoDesafio(false);
    if (error) { toast.error("Não consegui entrar no desafio. Tente de novo."); return; }
    invalidar();
  };

  const enviarRecado = async () => {
    if (!user || !recado.trim()) return;
    setEnviandoRecado(true);
    const { error } = await supabase.from("group_notes")
      .insert({ group_id: grupoId, author_id: user.id, text: recado.trim() });
    setEnviandoRecado(false);
    if (error) { toast.error("Não consegui enviar. Tente de novo."); return; }
    setRecado("");
    invalidar();
  };

  const sair = async () => {
    setSaindo(true);
    const { error } = await supabase.rpc("sair_do_grupo", { p_group: grupoId });
    setSaindo(false);
    if (error) { toast.error("Não consegui sair agora. Tente de novo."); return; }
    // Sem diálogo de retenção. "Tem certeza? seus amigos vão sentir sua falta"
    // é proibido — sair é um toque, e o grupo não recebe anúncio.
    toast.success("Você saiu. O que o grupo via de você foi apagado.");
    qc.invalidateQueries({ queryKey: ["social-grupos"] });
    onVoltar();
  };

  /* O PLACAR VEM DO `lib/socialChallenge`, e nenhuma regra dele é refeita aqui.
     A tela não ordena, não corta e não decide o k mínimo: ela renderiza. */
  const placar = useMemo(() => {
    if (!data?.desafio || !user) return null;
    const membros: MemberTotals[] = data.progresso.map((p) => ({
      memberId: p.user_id,
      name: p.sou_eu ? "Você" : p.display_name,
      done: p.feito ?? 0,
      goal: Number(p.combinado) || 0,
    }));
    return {
      quadro: weekScoreboard({
        members: membros,
        viewerId: user.id,
        consentCount: data.consentimentosNoDesafio,
      }),
      semRegistro: new Set(data.progresso.filter((p) => p.feito === null).map((p) => p.user_id)),
    };
  }, [data, user]);

  /* A linha do tempo do grupo: presença DERIVADA e recado ESCRITO, juntos e
     ordenados por data. São duas naturezas diferentes de propósito — o ato
     aponta, a nota fala —, e a presença nunca vira texto guardado. */
  const linhaDoTempo = useMemo(() => {
    if (!data) return [] as { dia: string; presencas: Presenca[]; recados: Recado[] }[];
    const dias = new Map<string, { presencas: Presenca[]; recados: Recado[] }>();
    const pega = (d: string) => {
      if (!dias.has(d)) dias.set(d, { presencas: [], recados: [] });
      return dias.get(d)!;
    };
    for (const p of data.presencas) pega(p.dia).presencas.push(p);
    for (const r of data.recados) pega(r.criadoEm.slice(0, 10)).recados.push(r);
    return [...dias.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([dia, v]) => ({ dia, ...v }));
  }, [data]);

  const souAdmin = ehAdmin(data?.papel);

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div className="flex items-center gap-2">
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
        <Button
          variant="ghost" size="icon" className="w-11 h-11 shrink-0"
          onClick={() => setConsentAberto(true)} aria-label="O que este grupo vê de você"
        >
          <Settings2 className="w-5 h-5" />
        </Button>
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
          {/* ── O FECHAMENTO: diz o que foi feito e oferece começar outro.
                 Só isso — sem prêmio, sem selo, sem troféu. ── */}
          {!data.desafio && data.encerrado && (
            <Card className="p-4 space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {data.encerrado.nome}
                </p>
                <p className="text-xs text-muted-foreground">
                  Terminou {new Date(data.encerrado.terminaEm + "T00:00:00")
                    .toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}.
                </p>
              </div>
              <p className="text-sm font-medium">
                {data.barraEncerrado === null
                  ? "O combinado fechou. O total do grupo não aparece porque menos de quatro pessoas estavam compartilhando este sinal."
                  : `O grupo fez ${data.barraEncerrado}.`}
              </p>
              {data.meuEncerrado !== null && (
                <p className="text-sm text-muted-foreground">
                  A sua parte: {data.meuEncerrado}.
                </p>
              )}
              {souAdmin && data.vigente && (
                <Button variant="outline" className="min-h-11" onClick={() => setDesafioAberto(true)}>
                  Combinar outro
                </Button>
              )}
            </Card>
          )}

          {/* Sem desafio nenhum: convite em tom baixo e condicional, como em
              Batalhas. "Comece agora!" num grupo é o app empurrando um
              combinado que não é dele. */}
          {!data.desafio && !data.encerrado && (
            <Card className="p-4 space-y-2.5">
              <p className="text-sm font-medium">Nenhum combinado agora</p>
              <p className="text-sm text-muted-foreground">
                Um desafio é um combinado com data de fim — "nós quatro, uma semana inteira,
                até sábado". Ele termina sozinho, e não vale prêmio nenhum.
              </p>
              {souAdmin && data.vigente ? (
                <Button variant="outline" className="min-h-11" onClick={() => setDesafioAberto(true)}>
                  Combinar um desafio
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Quem administra o grupo é quem combina o desafio.
                </p>
              )}
            </Card>
          )}

          {/* ── A barra do GRUPO contra a meta DO GRUPO ── */}
          {data.desafio && placar && (
            <Card className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {data.desafio.nome}
                </p>
                <p className="text-xs text-muted-foreground shrink-0">
                  termina {new Date(data.desafio.terminaEm + "T00:00:00")
                    .toLocaleDateString("pt-BR", { weekday: "long" })}
                </p>
              </div>

              {placar.quadro.collectiveHiddenReason === "k-minimo" ? (
                /* Agregado não é anônimo em grupo pequeno: com a barra e as
                   linhas individuais, num grupo de três qualquer um deduz o
                   terceiro por subtração — inclusive quem escolheu não
                   aparecer. A tela DIZ o motivo em vez de só omitir: omissão
                   sem explicação é a pessoa achando que é bug. */
                <p className="text-sm text-muted-foreground">
                  O total do grupo aparece quando pelo menos quatro pessoas estiverem
                  compartilhando este sinal. Com menos gente, somar entregaria quem
                  não quis aparecer.
                </p>
              ) : placar.quadro.collective && (() => {
                // O total vem do banco (`barra_do_grupo`), que é quem manda: a
                // função pura confere o k, o SQL confere o k E a janela.
                const feito = data.barra ?? placar.quadro.collective.done;
                const meta = placar.quadro.collective.goal;
                const faltam = Math.max(0, meta - feito);
                const pessoas = data.desafio!.participantes.length;
                const porPessoa = pessoas > 0 ? Math.ceil(faltam / pessoas) : 0;
                return (
                  <>
                    <p className="text-sm font-medium">O grupo fez {feito} de {meta}</p>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${meta > 0 ? Math.min(100, (feito / meta) * 100) : 0}%`,
                          background: "hsl(var(--vitalidade))",
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {faltam === 0
                        ? "Meta do grupo cumprida. 🎉"
                        : `Faltam ${faltam} — dá ${porPessoa} por pessoa até o fim.`}
                    </p>
                  </>
                );
              })()}

              {/* Participar é opt-in de cada um: ninguém é inscrito por outra
                  pessoa, nem por estar no grupo. */}
              {!data.desafio.participantes.includes(user?.id ?? "") && (
                <Button
                  variant="outline" className="min-h-11 w-full"
                  onClick={participar} disabled={entrandoNoDesafio}
                >
                  {entrandoNoDesafio ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar neste combinado"}
                </Button>
              )}

              {/* A conta sai do `lib`, não de um número escrito aqui: se o dia
                  inteiro deixar de ser 3 de 4, esta frase acompanha sozinha. */}
              <p className="text-xs text-muted-foreground border-t pt-2.5">
                Um dia inteiro = {fullDayThreshold(FULL_DAY_SIGNALS.length)} dos{" "}
                {FULL_DAY_SIGNALS.length} sinais do dia (treino · sono · comida · água) —
                não {FULL_DAY_SIGNALS.length} de {FULL_DAY_SIGNALS.length}: dia de descanso
                ainda conta, e quem desligou um sinal não fica de fora. A meta já vem com
                dois dias de folga por pessoa.
              </p>
            </Card>
          )}

          {/* ── A semana de cada um: contra a própria meta, sem ordinal ── */}
          {placar && placar.quadro.lines.length > 0 && (
            <Card className="p-4 space-y-2.5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  A semana de cada um
                </p>
                <p className="text-xs text-muted-foreground">Quem cumpriu o que prometeu:</p>
              </div>

              {/* SEM ORDEM DE DESEMPENHO e sem posição: a lista vem do
                  `weekScoreboard` em ordem alfabética, e não existe "1., 2.,
                  3." em lugar nenhum. Ordinal é uma afirmação sobre a PESSOA
                  ("você é o quinto"), não sobre o comportamento dela — e o
                  público deste app é quem já desistiu de vários outros. */}
              <div className="space-y-1.5">
                {placar.quadro.lines.map((l) => (
                  <div
                    key={l.memberId}
                    className="flex items-center gap-3 rounded-md border p-3 min-h-11"
                  >
                    <span className="text-sm flex-1 min-w-0 truncate font-medium">{l.name}</span>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {/* "2 de 4", nunca "2". E "sem registro", nunca "0":
                          ausência de linha é ausência de registro, e escrever
                          zero seria o banco certo com o produto mentindo —
                          com plateia. */}
                      {placar.semRegistro.has(l.memberId)
                        ? "sem registro"
                        : l.goal
                          ? `${l.done} de ${l.goal} combinados`
                          : `${l.done} — sem meta combinada`}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── O que houve no grupo: presença, nunca ausência ── */}
          <Card className="p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              No grupo
            </p>

            {linhaDoTempo.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nada por aqui hoje. Quando alguém do grupo registrar algo que escolheu
                compartilhar, aparece nesta lista — e só isso.
              </p>
            )}

            {linhaDoTempo.map(({ dia, presencas, recados }) => (
              <div key={dia} className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">{rotuloDoDia(dia)}</p>

                {presencas.map((p) => {
                  const chave = `${p.userId}|${p.dia}`;
                  const jaDei = data.dei.has(chave);
                  const recebidos = p.souEu ? (data.recebi.get(p.dia) ?? 0) : 0;
                  return (
                    <div key={`${chave}|${p.metricKey}`} className="flex items-center gap-2 rounded-md border p-3">
                      {/* CAMADA 3 — o grupo nota quem VOLTOU, com o mesmo peso
                          visual de qualquer outra linha. Nunca menos, e nunca
                          um destaque que soe como "olhem quem apareceu". */}
                      {p.voltou && <Sunrise className="w-4 h-4 shrink-0 text-gold" aria-hidden />}
                      <span className="text-sm flex-1 min-w-0 break-words">
                        {p.voltou && <strong>{p.souEu ? "Você voltou. " : `${p.nome} voltou. `}</strong>}
                        {frasePublica(p.nome, p.souEu, {
                          kind: "ato", metricKey: p.metricKey, texto: null,
                        })}
                      </span>
                      {p.souEu ? (
                        /* Quem recebeu vê quantos reconhecimentos ganhou
                           naquele dia; o grupo não vê nenhum. É um gesto só
                           para todo mundo, e o número não é placar de ninguém. */
                        recebidos > 0 && (
                          <span className="text-xs text-muted-foreground shrink-0 inline-flex items-center gap-1">
                            <HandHeart className="w-3.5 h-3.5" /> {recebidos}
                          </span>
                        )
                      ) : (
                        <Button
                          variant="ghost" size="sm"
                          className="min-h-11 shrink-0 text-muted-foreground"
                          onClick={() => reconhecer(p.userId, p.dia)}
                          disabled={jaDei}
                        >
                          <HandHeart className="w-4 h-4 mr-1.5" />
                          {jaDei ? "Enviado" : "Força"}
                        </Button>
                      )}
                    </div>
                  );
                })}

                {recados.map((r) => (
                  <div key={r.id} className="flex items-start gap-2 rounded-md border p-3 bg-muted/30">
                    <span className="text-sm flex-1 min-w-0 break-words">
                      <strong>{r.souEu ? "Você" : r.nome}:</strong> {r.texto}
                    </span>
                  </div>
                ))}
              </div>
            ))}

            {/* A tela acaba aqui: não existe "carregar mais". `v_grupo_hoje`
                devolve hoje e ontem, e não aceita intervalo de datas nem se a
                tela pedir — o histórico diário de terceiro é o calendário de
                bolinhas, e ele não sai do banco. */}
            <p className="text-xs text-center text-muted-foreground">
              Aqui acaba — de propósito. O grupo mostra o dia, não o histórico de ninguém.
            </p>

            {data.vigente && (
              <form
                className="flex gap-2 border-t pt-3"
                onSubmit={(e) => { e.preventDefault(); enviarRecado(); }}
              >
                <Input
                  className="min-h-11 min-w-0 flex-1" maxLength={500}
                  placeholder="Escrever um recado para o grupo"
                  value={recado} onChange={(e) => setRecado(e.target.value)}
                  aria-label="Recado para o grupo"
                />
                <Button
                  type="submit" size="icon" className="w-11 h-11 shrink-0"
                  disabled={enviandoRecado || !recado.trim()} aria-label="Enviar recado"
                >
                  {enviandoRecado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </form>
            )}
          </Card>

          <div className="flex flex-wrap gap-2">
            {/* Convidar é de quem administra, e não é burocracia: pela
                reciprocidade, quem entra passa a ver o que cada um já
                compartilha — e ninguém foi consultado. Um membro sozinho não
                decide, por todos, quem enxerga a vida deles. */}
            {souAdmin && data.vigente && (
              <Button variant="outline" className="min-h-11" onClick={() => setConviteAberto(true)}>
                <UserPlus className="w-4 h-4 mr-1.5" /> Chamar alguém
              </Button>
            )}
            <Button
              variant="ghost" className="min-h-11 text-muted-foreground"
              onClick={sair} disabled={saindo}
            >
              {saindo ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><LogOut className="w-4 h-4 mr-1.5" /> Sair do grupo</>)}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Sair apaga o que este grupo via de você — o histórico, não só o daqui pra frente.
            O seu registro continua seu.
          </p>

          <SocialConsentSheet
            open={consentAberto}
            onOpenChange={setConsentAberto}
            grupoNome={data.nome}
            linhas={data.consentimentos}
            onSalvar={salvarConsentimentos}
            modo={primeiraVez ? "entrar" : "revisar"}
          />
          <SocialChallengeSheet
            open={desafioAberto}
            onOpenChange={setDesafioAberto}
            pessoasNoGrupo={data.pessoas}
            criando={criandoDesafio}
            onCriar={criarDesafio}
          />
          <SocialInviteSheet
            open={conviteAberto}
            onOpenChange={(v) => { setConviteAberto(v); if (!v) setLinkNovo(null); }}
            link={linkNovo}
            abertos={data.convites}
            criando={criandoConvite}
            onCriar={criarConvite}
            onCancelar={cancelarConvite}
            aviso5={data.pessoas >= 4}
          />
        </>
      )}
    </div>
  );
}

/** "hoje" / "ontem". A view não devolve mais que isso, então não existe
 *  terceiro caso — mas a data fica escrita para o dia em que existir. */
function rotuloDoDia(dia: string): string {
  const hoje = new Date().toISOString().slice(0, 10);
  const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  if (dia === hoje) return "hoje";
  if (dia === ontem) return "ontem";
  return new Date(dia + "T00:00:00").toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "short",
  });
}

/* ═══ Criar grupo e entrar por convite ══════════════════════════════════ */

/** As durações oferecidas para o COMBINADO. `groups.ends_on` é NOT NULL: um
 *  grupo sem fim não é um combinado, é um mural — e mural é a forma vetada. */
const DURACOES = [
  { dias: 30, label: "1 mês" },
  { dias: 60, label: "2 meses" },
  { dias: 90, label: "3 meses" },
] as const;

function CriarGrupoDialog({
  open, onOpenChange, nomeSugerido, onCriado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  nomeSugerido: string;
  onCriado: (id: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [comoMeChamo, setComoMeChamo] = useState("");
  const [dias, setDias] = useState<number>(30);
  const [salvando, setSalvando] = useState(false);

  const fim = new Date();
  fim.setDate(fim.getDate() + dias);

  const criar = async () => {
    if (!nome.trim()) { toast.error("Dê um nome ao grupo. Ex.: \"Os Teimosos\"."); return; }
    setSalvando(true);
    const { data, error } = await supabase.rpc("criar_grupo", {
      p_nome: nome.trim(),
      p_display_name: (comoMeChamo.trim() || nomeSugerido || "Eu").slice(0, 40),
      p_ends_on: fim.toISOString().slice(0, 10),
    });
    setSalvando(false);
    if (error || !data) { toast.error(error?.message ?? "Não consegui criar o grupo."); return; }
    toast.success("Grupo criado. Nada seu é compartilhado até você escolher.");
    onOpenChange(false);
    setNome(""); setComoMeChamo("");
    onCriado(String(data));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Criar um grupo</DialogTitle>
          <DialogDescription>
            Pequeno funciona melhor: você e duas, três pessoas que se acompanham por
            um tempo combinado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            className="min-h-11" maxLength={60} autoFocus
            placeholder='Nome do grupo. Ex.: "Os Teimosos"'
            value={nome} onChange={(e) => setNome(e.target.value)}
            aria-label="Nome do grupo"
          />
          {/* O nome do grupo é do GRUPO, e por isso é pedido aqui em vez de
              lido do perfil: `profiles` tem renda e remédios na mesma linha do
              nome, e RLS não recorta coluna. */}
          <div className="space-y-1">
            <Input
              className="min-h-11" maxLength={40}
              placeholder={nomeSugerido ? `Como eles te chamam (ex.: ${nomeSugerido})` : "Como eles te chamam"}
              value={comoMeChamo} onChange={(e) => setComoMeChamo(e.target.value)}
              aria-label="Como o grupo te chama"
            />
            <p className="text-[11px] text-muted-foreground">
              Só este nome sai para o grupo. O resto do seu perfil não vai junto.
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Até quando</p>
            <div className="flex flex-wrap gap-2">
              {DURACOES.map((d) => (
                <button
                  key={d.dias} type="button" onClick={() => setDias(d.dias)}
                  aria-pressed={dias === d.dias} className={chip(dias === d.dias)}
                  style={dias === d.dias ? { background: "hsl(var(--vitalidade))" } : undefined}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Termina {fim.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}.
              O grupo tem fim porque é um combinado, não um lugar para ficar — e ele
              expira sozinho, sem ninguém precisar encerrar.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="min-h-11" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button className="min-h-11" onClick={criar} disabled={salvando}>
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O código, de onde quer que a pessoa tenha colado.
 *
 * Ela vai colar o link inteiro, o link com texto em volta, ou só o código — as
 * três formas chegam de conversas reais, e recusar duas delas seria
 * transformar um convite num teste de atenção.
 */
function codigoDoTexto(bruto: string): string {
  const t = bruto.trim();
  if (!t) return "";
  const naQuery = t.match(/[?&]convite=([^&\s]+)/);
  if (naQuery) return decodeURIComponent(naQuery[1]);
  const pedacos = t.split(/[/\s]+/).filter(Boolean);
  return pedacos[pedacos.length - 1] ?? "";
}

function EntrarComCodigoDialog({
  open, onOpenChange, onEntrou, codigoInicial, nomeSugerido,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEntrou: (id: string) => void;
  codigoInicial?: string | null;
  nomeSugerido: string;
}) {
  const [codigo, setCodigo] = useState(codigoInicial ?? "");
  const [comoMeChamo, setComoMeChamo] = useState("");
  const [entrando, setEntrando] = useState(false);

  const entrar = async () => {
    const limpo = codigoDoTexto(codigo);
    if (!limpo) { toast.error("Cole o link ou o código que te mandaram."); return; }
    setEntrando(true);
    const { data, error } = await supabase.rpc("aceitar_convite", {
      p_codigo: limpo,
      p_display_name: (comoMeChamo.trim() || nomeSugerido || "Eu").slice(0, 40),
    });
    setEntrando(false);
    if (error || !data) {
      // O banco devolve UMA mensagem para código errado, expirado, revogado e
      // esgotado — distinguir os quatro confirmaria, para quem sonda, que o
      // código existe. A tela repete o mesmo silêncio.
      toast.error("Esse convite não vale mais. Peça um novo a quem te chamou.");
      return;
    }
    onOpenChange(false);
    setCodigo("");
    onEntrou(String(data));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tenho um link de convite</DialogTitle>
          <DialogDescription>
            Cole o link que te mandaram. Você escolhe o que compartilhar depois de entrar —
            e dá para entrar sem compartilhar nada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            className="min-h-11" autoFocus placeholder="cole aqui o link que te mandaram"
            value={codigo} onChange={(e) => setCodigo(e.target.value)}
            aria-label="Link ou código do convite"
          />
          <div className="space-y-1">
            <Input
              className="min-h-11" maxLength={40}
              placeholder={nomeSugerido ? `Como eles te chamam (ex.: ${nomeSugerido})` : "Como eles te chamam"}
              value={comoMeChamo} onChange={(e) => setComoMeChamo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") entrar(); }}
              aria-label="Como o grupo te chama"
            />
            <p className="text-[11px] text-muted-foreground">Só este nome sai para o grupo.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="min-h-11" onClick={() => onOpenChange(false)} disabled={entrando}>
            Cancelar
          </Button>
          <Button className="min-h-11" onClick={entrar} disabled={entrando}>
            {entrando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
