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
import SocialConsentSheet from "@/components/core/SocialConsentSheet";
import SocialInviteSheet, { type ConviteAberto } from "@/components/core/SocialInviteSheet";
import SocialChallengeSheet from "@/components/core/SocialChallengeSheet";
import { frasePublica } from "@/components/core/socialPhrases";
import {
  weekScoreboard, groupWeekGoal, fullDayThreshold, FULL_DAY_SIGNALS,
  type MemberTotals,
} from "@/lib/socialChallenge";
import type { SocialMetricKey } from "@/lib/socialMetrics";
import { toast } from "sonner";
import {
  Users, ChevronLeft, ChevronRight, Settings2, UserPlus, Lock, Loader2,
  HandHeart, LogOut,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   SOCIAL — o grupo que combina, não a plateia que assiste
   ═══════════════════════════════════════════════════════════════════════════

   O objeto deste recurso é o COMBINADO, não o mural. Essa frase não é
   marketing: é o que decide cada pixel abaixo, e é a diferença entre um Social
   que sobrevive ao PRINCIPIOS.md e uma cópia do GymRats, que não sobrevive.

   O QUE ESTA TELA NUNCA MOSTRA — e é estrutural, não configuração:

   · **Ausência.** Nenhuma linha diz que alguém não registrou. Sem "visto por
     último", sem "online", sem calendário de bolinhas de terceiro. No agregado
     o conteúdo já não existe: o que vaza é sempre a ausência.
   · **Número comparável.** Sem kg, kcal, litros, gramas, R$, minutos.
     "Registrou um treino", nunca "treinou 1h20".
   · **Contador público de apoio.** O gesto é um só ("Força") e o número só o
     autor vê. Contador público de curtida é leaderboard de popularidade
     disfarçado.
   · **Ordinal entre pessoas.** Nem por soma: soma é monotônica em presença,
     então todo ranking de soma é ranking de frequência disfarçado. O que fica
     é a barra coletiva e cada um contra a META DELE.
   · **Feed infinito.** A tela do grupo tem começo, meio e FIM — uma janela
     fixa, um marcador de fim, e acabou. O Ascende VENDE uma batalha contra
     rolagem infinita e comparação (`lib/battles.ts`); construir a engrenagem
     aqui dentro seria lucrar duas vezes com a mesma queda.
   · **Badge, bolinha, contador de não-lidos.** Em lugar nenhum, incluindo a
     barra e o hub. Bolinha vermelha é o motor de "abre o app", e é exatamente
     o que o Dilema 4 proíbe.
   · **Descoberta.** Nenhuma sugestão de gente, nenhuma prévia de grupo alheio,
     nenhum "3 amigos seus já estão aqui". Isso é pressão social disfarçada de
     informação, e mata o motor viral de propósito.

   ONDE ELE MORA: a barra tem cinco alvos e um só dourado, e não cabe um sexto.
   Social é FERRAMENTA TRANSVERSAL — rota própria, cartão em "Ferramentas"
   (Pilares) e uma linha no hub. O precedente é Batalhas, que é o assunto mais
   íntimo do app e mora exatamente aí.

   ONDE OS DADOS MORAM: o grupo lê PROJEÇÃO, nunca a fonte. Nada aqui consulta
   `life_events`, `transactions`, `habit_logs`, `battles` ou `chat_messages` —
   essas tabelas não ganham uma única política de grupo, nunca. O que esta tela
   lê são agregados publicados por consentimento, e a defesa mais forte é
   estrutural: a tabela de projeção não tem UMA coluna de texto, então o
   diário e a descrição da refeição não vazam porque não existe onde caberem.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Uma pessoa, como o GRUPO a conhece. `display_name` vem de `group_members`,
 *  nunca de `profiles`: o nome que você usa no grupo da academia não tem de
 *  ser o nome que está na sua conta. */
interface Membro { userId: string; nome: string; papel: string }

interface ItemDoFeed {
  id: string;
  autorId: string;
  kind: "ato" | "nota";
  metricKey: SocialMetricKey | null;
  texto: string | null;
  dia: string;
  criadoEm: string;
}

interface DesafioAtivo {
  id: string;
  nome: string;
  metricKey: SocialMetricKey;
  terminaEm: string;
  participantes: string[];
}

/* ─── A tela ──────────────────────────────────────────────────────────────
   Uma rota só (`/app/social`), e o grupo aberto vive na query `?g=`. É o
   mesmo padrão da Vitalidade, e aqui ele paga duas vezes: o Voltar do
   navegador sai do grupo em vez de sair do app, e um grupo aberto é um
   endereço — dá para recarregar sem perder onde se estava. */
export default function Social() {
  const [params, setParams] = useSearchParams();
  const grupoAberto = params.get("g");
  /* O convite chega pela MESMA rota, em `?convite=`, e não por um caminho
     público próprio. Duas razões, e a segunda é a que decide:
     1. uma rota a menos para o mundo conhecer — e rota que já saiu em link de
        WhatsApp não se corrige depois;
     2. o link cai dentro da área autenticada, então quem ainda não tem conta
        passa pela porta que já existe (o guard do AppLayout) em vez de uma
        tela de convite anônima que precisaria decidir sozinha o que mostrar a
        um desconhecido. */
  const convite = params.get("convite");

  const abrir = (id: string | null, primeiraVez = false) => {
    const proximos = new URLSearchParams(params);
    if (id) proximos.set("g", id); else proximos.delete("g");
    proximos.delete("convite");
    // Acabou de entrar (ou de criar): a folha de consentimento é a PRIMEIRA
    // coisa que ela vê do grupo. Não é burocracia de entrada — é onde a
    // decisão acontece, e adiar essa tela seria deixar a pessoa dentro de um
    // grupo antes de ela ter escolhido o que ele vê.
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

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["social-grupos", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: vinculos, error } = await supabase
        .from("group_members")
        .select("group_id,display_name,role,groups!inner(id,name,archived_at)")
        .eq("user_id", user!.id);
      if (error) throw error;

      const ativos = (vinculos ?? []).filter((v) => {
        const g = v.groups as unknown as { archived_at: string | null };
        return !g?.archived_at;
      });
      if (!ativos.length) return [] as { id: string; nome: string; pessoas: number }[];

      // Quantas pessoas há em cada grupo. Sai numa consulta só; a RLS já
      // limita o que volta aos grupos de que a pessoa participa.
      const ids = ativos.map((v) => v.group_id);
      const { data: todos, error: e2 } = await supabase
        .from("group_members").select("group_id").in("group_id", ids);
      if (e2) throw e2;
      const contagem = new Map<string, number>();
      for (const m of todos ?? []) contagem.set(m.group_id, (contagem.get(m.group_id) ?? 0) + 1);

      return ativos.map((v) => ({
        id: v.group_id,
        nome: (v.groups as unknown as { name: string }).name,
        pessoas: contagem.get(v.group_id) ?? 1,
      }));
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
            Um grupo pequeno — você e duas, três pessoas — que se acompanham na semana.
            Não tem feed público, não tem desconhecido, não tem placar de quem treina mais.
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
                    <p className="text-xs text-muted-foreground">
                      {g.pessoas} {g.pessoas === 1 ? "pessoa" : "pessoas"}
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

      {/* O rodapé da promessa. Ele não é decoração: é a razão pela qual alguém
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
        onEntrou={(id) => onAbrir(id, true)}
      />
    </div>
  );
}

/* ═══ TELA (b) — o grupo ativo ══════════════════════════════════════════ */

/** A janela do feed: dois dias por padrão, a semana inteira com um toque, e
 *  FIM. Não é paginação — é uma janela fixa com duas posições. "Carregar mais"
 *  sem fim é a engrenagem que o produto recusa. */
const DIAS_RESUMIDOS = 2;
const DIAS_DO_CICLO = 7;

function Grupo({
  grupoId, onVoltar, primeiraVez,
}: { grupoId: string; onVoltar: () => void; primeiraVez: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [consentAberto, setConsentAberto] = useState(primeiraVez);
  const [conviteAberto, setConviteAberto] = useState(false);
  const [linkNovo, setLinkNovo] = useState<string | null>(null);
  const [criandoConvite, setCriandoConvite] = useState(false);
  const [semanaInteira, setSemanaInteira] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [desafioAberto, setDesafioAberto] = useState(false);
  const [criandoDesafio, setCriandoDesafio] = useState(false);
  const [entrandoNoDesafio, setEntrandoNoDesafio] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["social-grupo", grupoId, user?.id],
    enabled: !!user && !!grupoId,
    queryFn: async () => {
      const [grupo, membros, consentimentos, desafios, feed, convites] = await Promise.all([
        supabase.from("groups").select("id,name").eq("id", grupoId).maybeSingle(),
        supabase.from("group_members").select("user_id,display_name,role").eq("group_id", grupoId),
        supabase.from("group_data_consents").select("metric_key")
          .eq("group_id", grupoId).eq("user_id", user!.id),
        supabase.from("challenges")
          .select("id,name,metric_key,starts_on,ends_on,challenge_participants(user_id)")
          .eq("group_id", grupoId).order("ends_on", { ascending: false }).limit(2),
        supabase.from("group_feed")
          .select("id,author_id,kind,metric_key,text,ref_day,created_at")
          .eq("group_id", grupoId)
          .order("created_at", { ascending: false })
          .limit(120),
        supabase.from("group_invites")
          .select("id,created_at,expires_at,uses,max_uses,revoked_at")
          .eq("group_id", grupoId).is("revoked_at", null),
      ]);

      const falhou = [grupo, membros, consentimentos, desafios, feed, convites].find((r) => r.error);
      if (falhou?.error) throw falhou.error;

      const lista = (desafios.data ?? []) as unknown as {
        id: string; name: string; metric_key: SocialMetricKey;
        starts_on: string; ends_on: string;
        challenge_participants: { user_id: string }[];
      }[];
      const hoje = new Date().toISOString().slice(0, 10);
      /* O desafio EXPIRA SOZINHO: ninguém encerra nada, e não existe rotina
         para isso. `ends_on` no banco é o fim, e a partir do dia seguinte ele
         simplesmente deixa de ser o em curso — o combinado acabou porque a
         data chegou, que é o que faz dele um combinado e não uma presença
         permanente. O mais recente já encerrado vira a tela de fechamento. */
      const emCurso = lista.find((c) => c.ends_on >= hoje) ?? null;
      const encerrado = lista.find((c) => c.ends_on < hoje) ?? null;

      /* O total de cada participante vem da ÚNICA porta que existe para o
         histórico de terceiro: `total_do_ciclo`, que não tem parâmetro de
         data. Sem parâmetro de data não há ataque de diferenciação — pedir
         dois totais e subtrair para reconstruir o dia de alguém. A série
         diária de terceiro não é buscada em lugar nenhum desta tela, e o
         calendário de bolinhas do outro é o artefato de vergonha mais
         eficiente desta categoria de app. */
      const totais = new Map<string, number | null>();
      let barra: number | null = null;
      let meuAnterior: number | null = null;
      if (emCurso) {
        const ps = emCurso.challenge_participants.map((p) => p.user_id);
        const [somas, barraRes] = await Promise.all([
          Promise.all(ps.map((uid) =>
            supabase.rpc("total_do_ciclo", { p_challenge: emCurso.id, p_user: uid }))),
          supabase.rpc("barra_do_grupo", { p_challenge: emCurso.id }),
        ]);
        ps.forEach((uid, i) => {
          const v = somas[i].data;
          totais.set(uid, v === null || v === undefined ? null : Number(v));
        });
        barra = barraRes.data === null || barraRes.data === undefined ? null : Number(barraRes.data);
      }
      let barraEncerrado: number | null = null;
      if (encerrado) {
        const [meu, dogrupo] = await Promise.all([
          supabase.rpc("total_do_ciclo", { p_challenge: encerrado.id, p_user: user!.id }),
          supabase.rpc("barra_do_grupo", { p_challenge: encerrado.id }),
        ]);
        meuAnterior = meu.data === null || meu.data === undefined ? null : Number(meu.data);
        barraEncerrado = dogrupo.data === null || dogrupo.data === undefined ? null : Number(dogrupo.data);
      }

      // As metas combinadas: cada um contra a régua DELE. Sem isto a tela só
      // teria número absoluto — e número absoluto ao lado de número absoluto
      // já é um ranking, mesmo sem coluna de posição.
      const { data: metas } = await supabase.from("group_member_goals")
        .select("user_id,metric_key,goal_value").eq("group_id", grupoId);

      /* Quantas pessoas consentiram A MÉTRICA DO DESAFIO — não o tamanho do
         grupo. É o k mínimo do `weekScoreboard`: quem está no grupo mas não
         compartilha aquele sinal não entra na conta que decide se a barra
         coletiva pode aparecer sem entregar alguém por subtração. */
      let consentimentosNoDesafio = 0;
      if (emCurso) {
        const { count } = await supabase.from("group_data_consents")
          .select("user_id", { count: "exact", head: true })
          .eq("group_id", grupoId).eq("metric_key", emCurso.metric_key);
        consentimentosNoDesafio = count ?? 0;
      }

      /* Os apoios são lidos SÓ dos itens que eu escrevi. O autor vê quantos
         recebeu; o grupo não vê nenhum. Contador público de apoio é placar de
         popularidade com outro nome. */
      const meusItens = (feed.data ?? []).filter((f) => f.author_id === user!.id).map((f) => f.id);
      const apoios = new Map<string, number>();
      if (meusItens.length) {
        const { data: rs } = await supabase.from("group_reactions")
          .select("feed_id").in("feed_id", meusItens);
        for (const r of rs ?? []) apoios.set(r.feed_id, (apoios.get(r.feed_id) ?? 0) + 1);
      }
      const { data: meusApoios } = await supabase.from("group_reactions")
        .select("feed_id").eq("user_id", user!.id);

      return {
        nome: (grupo.data as { name?: string } | null)?.name ?? "Grupo",
        membros: ((membros.data ?? []) as { user_id: string; display_name: string; role: string }[])
          .map((m) => ({ userId: m.user_id, nome: m.display_name, papel: m.role } as Membro)),
        consentidos: ((consentimentos.data ?? []) as { metric_key: SocialMetricKey }[])
          .map((c) => c.metric_key),
        desafio: emCurso
          ? {
            id: emCurso.id, nome: emCurso.name, metricKey: emCurso.metric_key,
            terminaEm: emCurso.ends_on,
            participantes: emCurso.challenge_participants.map((p) => p.user_id),
          } as DesafioAtivo
          : null,
        totais,
        barra,
        consentimentosNoDesafio,
        meuAnterior,
        barraEncerrado,
        encerrado: encerrado
          ? {
            id: encerrado.id, nome: encerrado.name, metricKey: encerrado.metric_key,
            terminaEm: encerrado.ends_on,
            participantes: encerrado.challenge_participants.map((p) => p.user_id),
          } as DesafioAtivo
          : null,
        metas: (metas ?? []) as { user_id: string; metric_key: string; goal_value: number }[],
        feed: ((feed.data ?? []) as {
          id: string; author_id: string; kind: "ato" | "nota";
          metric_key: SocialMetricKey | null; text: string | null;
          ref_day: string | null; created_at: string;
        }[]).map((f) => ({
          id: f.id, autorId: f.author_id, kind: f.kind, metricKey: f.metric_key,
          texto: f.text, dia: f.ref_day ?? f.created_at.slice(0, 10), criadoEm: f.created_at,
        } as ItemDoFeed)),
        apoiosRecebidos: apoios,
        jaApoiei: new Set((meusApoios ?? []).map((r) => r.feed_id)),
        convites: ((convites.data ?? []) as {
          id: string; created_at: string; expires_at: string; uses: number; max_uses: number;
        }[]).filter((c) => c.uses < c.max_uses)
          .map((c) => ({ id: c.id, criadoEm: c.created_at, expiraEm: c.expires_at } as ConviteAberto)),
      };
    },
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["social-grupo", grupoId] });

  const salvarConsentimentos = async (proximos: SocialMetricKey[]): Promise<boolean> => {
    if (!user || !data) return false;
    const antes = new Set(data.consentidos);
    const depois = new Set(proximos);
    const ligar = proximos.filter((k) => !antes.has(k));
    const desligar = [...antes].filter((k) => !depois.has(k));

    /* Desligar é DELEÇÃO, e a ordem importa: apagamos primeiro. Se a chamada
       cair no meio, o pior estado possível é ter compartilhado de menos —
       nunca de mais. Fail-closed não é só do banco. */
    if (desligar.length) {
      const { error } = await supabase.from("group_data_consents")
        .delete().eq("group_id", grupoId).eq("user_id", user.id).in("metric_key", desligar);
      if (error) { toast.error("Não consegui salvar. Nada foi alterado."); return false; }
    }
    if (ligar.length) {
      const { error } = await supabase.from("group_data_consents").insert(
        ligar.map((k) => ({ group_id: grupoId, user_id: user.id, metric_key: k })),
      );
      if (error) { toast.error("Não consegui salvar tudo. Confira a lista."); invalidar(); return false; }
    }
    toast.success(proximos.length
      ? "Pronto. O grupo passa a ver só o que você ligou."
      : "Pronto. O grupo não vê nada seu — dá para ser só torcida.");
    invalidar();
    return true;
  };

  const criarConvite = async () => {
    setCriandoConvite(true);
    const { data: res, error } = await supabase.rpc("criar_convite", { p_group: grupoId });
    setCriandoConvite(false);
    if (error || !res) { toast.error("Não consegui criar o convite. Tente de novo."); return; }
    const codigo = typeof res === "string" ? res : (res as { code?: string }).code ?? "";
    setLinkNovo(`${window.location.origin}/app/social?convite=${encodeURIComponent(codigo)}`);
    invalidar();
  };

  const cancelarConvite = async (id: string) => {
    const { error } = await supabase.from("group_invites")
      .update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error("Não consegui cancelar. Tente de novo."); return; }
    toast.success("Convite cancelado. O link deixa de funcionar agora.");
    invalidar();
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
      /* Quem combina entra no combinado — mas só quem combina. Ninguém é
         inscrito por outra pessoa: participar é opt-in de cada um, e é por
         isso que a criação inscreve o criador e mais ninguém. */
      await supabase.from("challenge_participants")
        .insert({ challenge_id: novo.id, user_id: user.id });
    }
    setCriandoDesafio(false);
    if (error) { toast.error("Não consegui criar o desafio. Tente de novo."); return false; }
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

  const apoiar = async (feedId: string) => {
    if (!user) return;
    const { error } = await supabase.from("group_reactions")
      .insert({ feed_id: feedId, user_id: user.id, emoji: "forca" });
    // Apoiar duas vezes não é erro: a chave primária já impede, e avisar
    // seria transformar um gesto em cobrança de atenção.
    if (!error) invalidar();
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

  const nomeDe = (id: string) => data?.membros.find((m) => m.userId === id)?.nome ?? "Alguém";

  /* O PLACAR VEM DO `lib/socialChallenge`, e nenhuma regra dele é refeita
     aqui. A tela não ordena, não corta e não decide o k mínimo: ela renderiza.
     Regra ética reimplementada na camada de cima é regra que diverge no
     primeiro conserto feito com pressa.

     REPARE NO QUE A TELA NÃO PEDE: série diária de ninguém. `MemberTotals` não
     tem esse campo, e é estrutura em vez de política — o calendário de
     bolinhas de outra pessoa é o artefato de vergonha mais eficiente desta
     categoria de app, e ele não é recusado por uma regra que alguém precisa
     lembrar: ele não tem onde caber. */
  const placar = useMemo(() => {
    if (!data?.desafio || !user) return null;
    const metaDe = (uid: string) =>
      data.metas.find((g) => g.user_id === uid && g.metric_key === data.desafio!.metricKey)?.goal_value ?? 0;
    const membros: MemberTotals[] = data.desafio.participantes.map((uid) => ({
      memberId: uid,
      name: uid === user.id ? "Você" : nomeDe(uid),
      done: data.totais.get(uid) ?? 0,
      goal: Number(metaDe(uid)) || 0,
    }));
    return {
      quadro: weekScoreboard({
        members: membros,
        viewerId: user.id,
        consentCount: data.consentimentosNoDesafio,
      }),
      /* A meta do grupo é `pessoas × 5`, não `pessoas × 7`: os dois dias de
         folga por pessoa já estão embutidos. Um grupo que só fecha 100% com
         sete dias de todo mundo é um grupo que pune quem descansou. */
      metaDoGrupo: groupWeekGoal(data.desafio.participantes.length),
      semRegistro: new Set(
        data.desafio.participantes.filter((uid) => data.totais.get(uid) === null),
      ),
      meuAnterior: data.meuAnterior,
      minhaMeta: Number(metaDe(user.id)) || 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, user?.id]);

  const feedVisivel = useMemo(() => {
    if (!data) return [];
    const limite = new Date();
    limite.setDate(limite.getDate() - (semanaInteira ? DIAS_DO_CICLO : DIAS_RESUMIDOS) + 1);
    const corte = limite.toISOString().slice(0, 10);
    return data.feed.filter((f) => f.dia >= corte);
  }, [data, semanaInteira]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, ItemDoFeed[]>();
    for (const f of feedVisivel) {
      if (!mapa.has(f.dia)) mapa.set(f.dia, []);
      mapa.get(f.dia)!.push(f);
    }
    return [...mapa.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
  }, [feedVisivel]);

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
          {!!data?.membros.length && (
            <p className="text-xs text-muted-foreground">
              {data.membros.length} {data.membros.length === 1 ? "pessoa" : "pessoas"}
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
          {/* ── O FECHAMENTO. Quando termina, a tela diz o que foi feito e
                 oferece começar outro. Só isso: sem prêmio, sem selo, sem
                 troféu, sem "você desbloqueou". O que fica é a semana. ── */}
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
                  : `O grupo fez ${data.barraEncerrado} ${data.barraEncerrado === 1 ? "dia inteiro" : "dias inteiros"}.`}
              </p>
              {data.meuAnterior !== null && (
                <p className="text-sm text-muted-foreground">
                  A sua parte: {data.meuAnterior} {data.meuAnterior === 1 ? "dia" : "dias"}.
                </p>
              )}
              <Button
                variant="outline" className="min-h-11"
                onClick={() => setDesafioAberto(true)}
              >
                Combinar outro
              </Button>
            </Card>
          )}

          {/* Sem desafio nenhum: o convite fica em tom baixo e condicional,
              como em Batalhas. "Comece agora!" num grupo é o app empurrando um
              combinado que não é dele. */}
          {!data.desafio && !data.encerrado && (
            <Card className="p-4 space-y-2.5">
              <p className="text-sm font-medium">Nenhum combinado agora</p>
              <p className="text-sm text-muted-foreground">
                Um desafio é um combinado com data de fim — "nós quatro, uma semana inteira,
                até sábado". Ele termina sozinho, e não vale prêmio nenhum.
              </p>
              <Button variant="outline" className="min-h-11" onClick={() => setDesafioAberto(true)}>
                Combinar um desafio
              </Button>
            </Card>
          )}

          {/* ── A SEMANA INTEIRA: a barra do GRUPO contra a meta DO GRUPO ── */}
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
                /* O banco e a função pura concordam: abaixo de quatro
                   consentimentos ativos não há barra. Agregado não é anônimo em
                   grupo pequeno — com a barra e as linhas individuais, num
                   grupo de três qualquer um deduz o terceiro por subtração,
                   inclusive quem escolheu não aparecer.
                   A tela DIZ o motivo em vez de só omitir: omissão sem
                   explicação é a pessoa achando que é bug. */
                <p className="text-sm text-muted-foreground">
                  O total do grupo aparece quando pelo menos quatro pessoas estiverem
                  compartilhando este sinal. Com menos gente, somar entregaria quem
                  não quis aparecer.
                </p>
              ) : placar.quadro.collective && (() => {
                /* A meta do grupo é a SOMA do que cada um combinou. Quando
                   ninguém combinou nada ainda, cai para `pessoas × 5` — a
                   régua da casa, com os dois dias de folga por pessoa já
                   embutidos. */
                const feito = placar.quadro.collective.done;
                const meta = placar.quadro.collective.goal || placar.metaDoGrupo;
                const faltam = Math.max(0, meta - feito);
                const porPessoa = data.desafio!.participantes.length > 0
                  ? Math.ceil(faltam / data.desafio!.participantes.length) : 0;
                return (
                  <>
                    <p className="text-sm font-medium">
                      O grupo fez {feito} de {meta} dias inteiros
                    </p>
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

              {/* Participar é opt-in de cada um: ninguém é inscrito por
                  outra pessoa, nem por estar no grupo. */}
              {!data.desafio.participantes.includes(user?.id ?? "") && (
                <Button
                  variant="outline" className="min-h-11 w-full"
                  onClick={participar} disabled={entrandoNoDesafio}
                >
                  {entrandoNoDesafio ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar neste combinado"}
                </Button>
              )}

              {/* A conta sai do `lib`, não de um número escrito aqui: se o
                  dia inteiro deixar de ser 3 de 4 um dia, esta frase acompanha
                  sozinha. Duas fontes para a mesma regra divergem no primeiro
                  conserto feito com pressa. */}
              <p className="text-xs text-muted-foreground border-t pt-2.5">
                Um dia inteiro = {fullDayThreshold(FULL_DAY_SIGNALS.length)} dos{" "}
                {FULL_DAY_SIGNALS.length} sinais do dia (treino · sono · comida · água) —
                não {FULL_DAY_SIGNALS.length} de {FULL_DAY_SIGNALS.length}: dia de descanso
                ainda conta, e quem desligou um sinal não fica de fora. A meta já vem com
                dois dias de folga por pessoa.
              </p>
            </Card>
          )}

          {/* ── A SEMANA DE CADA UM: contra a própria meta, sem ordinal ── */}
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
                  público deste app é quem já desistiu de vários outros.
                  Abaixo do k mínimo a função devolve só a linha de quem está
                  olhando: esconder a barra e manter as linhas deixaria a
                  dedução de pé pelo outro lado. */}
              <div className="space-y-1.5">
                {placar.quadro.lines.map((l) => (
                  <div
                    key={l.memberId}
                    className="flex items-center gap-3 rounded-md border p-3 min-h-11"
                  >
                    <span className="text-sm flex-1 min-w-0 truncate font-medium">{l.name}</span>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {/* "2 de 4", nunca "2". Número solto ao lado de número
                          solto É um ranking, mesmo sem coluna de posição. E
                          "sem registro", nunca "0": ausência de linha é
                          ausência de registro, e escrever zero seria o banco
                          certo com o produto mentindo — com plateia. */}
                      {placar.semRegistro.has(l.memberId)
                        ? "sem registro"
                        : l.goal
                          ? `${l.done} de ${l.goal} combinados`
                          : `${l.done} — sem meta combinada`}
                    </span>
                  </div>
                ))}
              </div>

              {/* A ÚNICA COMPARAÇÃO QUE NÃO TEM NINGUÉM DO OUTRO LADO.
                  Sem "caiu": a queda é informação que a pessoa já tem, e
                  nomeá-la aqui seria o app cobrando. A régua existe para
                  reconhecer, não para lembrar. */}
              {placar.meuAnterior !== null && placar.minhaMeta > 0 && (() => {
                const meuAgora = data.totais.get(user!.id) ?? 0;
                const antes = placar.meuAnterior;
                const subiu = meuAgora > antes;
                return (
                  <p className="text-sm text-muted-foreground border-t pt-2.5">
                    Você na semana passada: {antes} de {placar.minhaMeta}.
                    {subiu ? " Subiu." : ""}
                  </p>
                );
              })()}
            </Card>
          )}

          {/* ── O que houve no grupo: presença, nunca ausência ── */}
          <Card className="p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Esta semana, no grupo
            </p>

            {porDia.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nada registrado por aqui ainda. Quando alguém do grupo registrar algo que
                escolheu compartilhar, aparece nesta lista — e só isso.
              </p>
            )}

            {porDia.map(([dia, itens]) => (
              <div key={dia} className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">{rotuloDoDia(dia)}</p>
                {itens.map((f) => {
                  const meu = f.autorId === user?.id;
                  const apoios = data.apoiosRecebidos.get(f.id) ?? 0;
                  return (
                    <div key={f.id} className="flex items-center gap-2 rounded-md border p-3">
                      <span className="text-sm flex-1 min-w-0 break-words">
                        {frasePublica(nomeDe(f.autorId), meu, f)}
                      </span>
                      {meu ? (
                        /* O autor vê quantos apoios recebeu; o grupo não vê
                           nenhum. É o mesmo gesto para todo mundo — um só —,
                           e o número não é placar de ninguém. */
                        apoios > 0 && (
                          <span className="text-xs text-muted-foreground shrink-0 inline-flex items-center gap-1">
                            <HandHeart className="w-3.5 h-3.5" /> {apoios}
                          </span>
                        )
                      ) : (
                        <Button
                          variant="ghost" size="sm"
                          className="min-h-11 shrink-0 text-muted-foreground"
                          onClick={() => apoiar(f.id)}
                          disabled={data.jaApoiei.has(f.id)}
                        >
                          <HandHeart className="w-4 h-4 mr-1.5" />
                          {data.jaApoiei.has(f.id) ? "Enviado" : "Força"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Uma janela fixa com DUAS posições, e depois o fim. Não é
                paginação: não existe "carregar mais" que continue para sempre. */}
            {!semanaInteira ? (
              <Button
                variant="ghost"
                className="w-full min-h-11 text-muted-foreground"
                onClick={() => setSemanaInteira(true)}
              >
                ver a semana toda →
              </Button>
            ) : (
              <p className="text-xs text-center text-muted-foreground pt-1">
                Fim da semana. A tela do grupo acaba aqui — de propósito.
              </p>
            )}
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => setConviteAberto(true)}>
              <UserPlus className="w-4 h-4 mr-1.5" /> Chamar alguém
            </Button>
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
            ligados={data.consentidos}
            onSalvar={salvarConsentimentos}
            modo={primeiraVez ? "entrar" : "revisar"}
          />
          <SocialChallengeSheet
            open={desafioAberto}
            onOpenChange={setDesafioAberto}
            pessoasNoGrupo={data.membros.length}
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
            aviso5={data.membros.length >= 4}
          />
        </>
      )}
    </div>
  );
}

/** "hoje" / "ontem" e depois a data. Nomear os dois dias mais recentes é o que
 *  faz a lista parecer a semana de alguém em vez de um log. */
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
  const [salvando, setSalvando] = useState(false);

  const criar = async () => {
    if (!nome.trim()) { toast.error("Dê um nome ao grupo. Ex.: \"Os Teimosos\"."); return; }
    setSalvando(true);
    const { data, error } = await supabase.rpc("criar_grupo", {
      p_nome: nome.trim(),
      p_display_name: (comoMeChamo.trim() || nomeSugerido || "Eu").slice(0, 40),
    });
    setSalvando(false);
    if (error || !data) { toast.error("Não consegui criar o grupo. Tente de novo."); return; }
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
            Pequeno funciona melhor: você e duas, três pessoas que se acompanham na semana.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            className="min-h-11" maxLength={60} autoFocus
            placeholder='Nome do grupo. Ex.: "Os Teimosos"'
            value={nome} onChange={(e) => setNome(e.target.value)}
            aria-label="Nome do grupo"
          />
          {/* O nome do grupo é do GRUPO, e por isso ele é pedido aqui em vez de
              lido do perfil: o nome que você usa no grupo da academia não tem
              de ser o nome que está na sua conta. */}
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
 * Ela vai colar o link inteiro, o link com texto em volta, ou só o código —
 * as três formas chegam de conversas reais, e recusar duas delas seria
 * transformar um convite num teste de atenção. Aceitar as três custa cinco
 * linhas; recusar custa uma pessoa que desiste de entrar.
 */
function codigoDoTexto(bruto: string): string {
  const t = bruto.trim();
  if (!t) return "";
  const naQuery = t.match(/[?&]convite=([^&\s]+)/);
  if (naQuery) return decodeURIComponent(naQuery[1]);
  // Link antigo ou colado pela metade: fica o último pedaço não vazio.
  const pedacos = t.split(/[/\s]+/).filter(Boolean);
  return pedacos[pedacos.length - 1] ?? "";
}

function EntrarComCodigoDialog({
  open, onOpenChange, onEntrou, codigoInicial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEntrou: (id: string) => void;
  codigoInicial?: string | null;
}) {
  const [codigo, setCodigo] = useState(codigoInicial ?? "");
  const [entrando, setEntrando] = useState(false);

  const entrar = async () => {
    const limpo = codigoDoTexto(codigo);
    if (!limpo) { toast.error("Cole o link ou o código que te mandaram."); return; }
    setEntrando(true);
    const { data, error } = await supabase.rpc("aceitar_convite", { p_codigo: limpo });
    setEntrando(false);
    if (error || !data) {
      // Sem detalhar se o código não existe, venceu ou já foi usado: um erro
      // que distingue os três casos é um oráculo para quem estiver chutando.
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
        <Input
          className="min-h-11" autoFocus placeholder="cole aqui o link que te mandaram"
          value={codigo} onChange={(e) => setCodigo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") entrar(); }}
          aria-label="Link ou código do convite"
        />
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
