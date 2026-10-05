import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import QueryError from "@/components/core/QueryError";
import CriarGrupoDialog from "@/components/social/CriarGrupoDialog";
import EntrarComCodigoDialog from "@/components/social/EntrarComCodigoDialog";
import { prazo } from "@/components/social/uteis";
import { ChevronRight, Lock, Users } from "lucide-react";

interface MeuGrupo {
  id: string;
  nome: string;
  diasRestantes: number;
  vigente: boolean;
  papel: string;
  pessoas: number;
}

/* ═══ TELA (a) — a lista, e a tela vazia ════════════════════════════════ */

export default function ListaDeGrupos({
  onAbrir, conviteDaUrl, conviteRetomado,
}: {
  onAbrir: (id: string, comoChegou?: "entrar" | "criar") => void;
  conviteDaUrl: string | null;
  /** O convite não veio de um toque agora: ele estava guardado desde antes de
   *  a pessoa ter conta (ver `ConviteEmTransito.tsx`). */
  conviteRetomado: boolean;
}) {
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
    <div className="max-w-3xl mx-auto space-y-4 animate-fade-up">
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
          <p className="text-subhead text-muted-foreground max-w-sm mx-auto">
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
              Tenho um link de convite <span aria-hidden>→</span>
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
              Tenho um link de convite <span aria-hidden>→</span>
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
        <p className="text-subhead text-muted-foreground">
          Nada seu é compartilhado até você escolher, item por item. Dinheiro nunca entra —
          nem se você quiser. Peso, humor, diário e batalhas também não.
        </p>
      </Card>

      <CriarGrupoDialog
        open={criarAberto}
        onOpenChange={setCriarAberto}
        nomeSugerido={profile?.name ?? ""}
        onCriado={(id) => onAbrir(id, "criar")}
      />
      <EntrarComCodigoDialog
        open={entrarAberto}
        onOpenChange={setEntrarAberto}
        codigoInicial={conviteDaUrl}
        retomado={conviteRetomado}
        nomeSugerido={profile?.name ?? ""}
        onEntrou={(id) => onAbrir(id, "entrar")}
      />
    </div>
  );
}
