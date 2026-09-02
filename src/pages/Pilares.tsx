import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePillarActivityQuery } from "@/hooks/useJornadaData";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { PILLARS, activePillarSet, type PillarId } from "@/lib/pillars";
import { ChevronRight, Swords, ClipboardList, Plus, Loader2, Layers } from "lucide-react";
import FirstTimeTip from "@/components/core/FirstTimeTip";
import QueryError from "@/components/core/QueryError";

/* Modularidade REAL (plano de feedbacks, Sugestão 1): antes, um pilar
   "inativo" era só um card esmaecido — e continuava clicável. Agora a
   escolha da pessoa reorganiza a tela: pilares ativos são o app dela;
   pilares pausados viram convites discretos ("existe mais vida aqui"),
   ativáveis em 1 toque, sem passar por Ajustes. */

export default function Pilares() {
  const { user } = useAuth();
  const { profile, refresh } = useProfile();
  const [activating, setActivating] = useState<PillarId | null>(null);

  const { data: counts, isError, refetch, isFetching } = usePillarActivityQuery();

  const active = activePillarSet(profile?.pillars);
  const activeList = PILLARS.filter((p) => active.has(p.id));
  const pausedList = PILLARS.filter((p) => !active.has(p.id));

  // Ativação em 1 toque: o pilar nasce do desejo de usar, não do checkbox
  // em Ajustes (Sugestão 1: "deixe os outros nascerem do uso").
  const activatePillar = async (id: PillarId) => {
    if (!user || activating) return;
    setActivating(id);
    const next = [...new Set([...(profile?.pillars ?? []), id])];
    const { error } = await supabase.from("profiles").update({ pillars: next }).eq("user_id", user.id);
    setActivating(null);
    if (error) { toast.error("Não consegui ativar agora. Tente de novo."); return; }
    toast.success(`Pronto: ${PILLARS.find((p) => p.id === id)?.name} agora faz parte do seu Ascende.`);
    refresh();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-semibold">Pilares</h1>
        <p className="text-sm text-muted-foreground">
          O seu Ascende é feito dos pilares que você ativou. Os outros ficam aqui,
          discretos, esperando você — nunca cobrando.
        </p>
      </div>

      <FirstTimeTip id="pilares" />

      {isError && (
        <QueryError
          title="Não consegui carregar a atividade dos seus pilares."
          detail="Pode ser a conexão — os pilares abrem normalmente, só a contagem de registros não veio."
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      )}

      {/* Pilares = áreas da vida; Ferramentas = recursos transversais (plano §5.4) */}
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-1">
        Seus pilares
      </p>
      <div className="grid grid-cols-1 gap-3">
        {activeList.map((p) => {
          const n = counts?.[p.id] ?? 0;
          return (
            <Card key={p.id}>
              <Link to={p.route} className="flex items-center gap-4 p-4">
                <div
                  className="w-11 h-11 rounded-md grid place-items-center shrink-0"
                  style={{ background: `hsl(var(${p.colorVar}) / 0.12)` }}
                >
                  <p.icon className="w-5 h-5" style={{ color: `hsl(var(${p.colorVar}))` }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {n > 0 ? `${n} ${n === 1 ? "registro" : "registros"} nos últimos 14 dias` : p.desc}
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
              </Link>
            </Card>
          );
        })}
      </div>

      {/* Divisão de trabalho declarada (Sugestão 2): o Ascende não compete
          em profundidade com apps de nicho — ele é a camada acima deles. */}
      <Card className="p-4 flex items-start gap-3">
        <div className="w-9 h-9 rounded-full grid place-items-center shrink-0 bg-gold/10">
          <Layers className="w-5 h-5 text-gold-ink" />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Usa Strava, MyFitnessPal ou o app do banco? Ótimo — continue usando.</strong>{" "}
          O Ascende não quer substituí-los: eles vão fundo em uma área, nós cruzamos a
          vida inteira. Conte numa frase na captura ("treinei pernas", "gastei 47 no
          mercado") e nós conectamos o que nenhum app de nicho consegue conectar.
        </p>
      </Card>

      {pausedList.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">
            Esperando por você
          </p>
          <div className="grid grid-cols-1 gap-3">
            {pausedList.map((p) => {
              const n = counts?.[p.id] ?? 0;
              return (
                <Card key={p.id} className="border-dashed">
                  <div className="flex items-center gap-4 p-4">
                    <div
                      className="w-11 h-11 rounded-md grid place-items-center shrink-0 opacity-60"
                      style={{ background: `hsl(var(${p.colorVar}) / 0.12)` }}
                    >
                      <p.icon className="w-5 h-5" style={{ color: `hsl(var(${p.colorVar}))` }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-muted-foreground">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {n > 0 ? `${n} ${n === 1 ? "registro" : "registros"} nos últimos 14 dias — parece que já é seu` : p.desc}
                      </p>
                    </div>
                    <button
                      onClick={() => activatePillar(p.id)}
                      disabled={!!activating}
                      className="shrink-0 flex items-center gap-1 text-xs font-medium rounded-full border px-3 py-1.5 hover:bg-muted/60 transition-colors disabled:opacity-60"
                    >
                      {activating === p.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <><Plus className="w-3.5 h-3.5" /> Ativar</>}
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">
        Ferramentas
      </p>
      <div className="grid grid-cols-1 gap-3">
        {/* Batalhas: transversal aos pilares */}
        <Card className="border-gold/30">
          <Link to="/app/batalhas" className="flex items-center gap-4 p-4">
            <div className="w-11 h-11 rounded-md grid place-items-center shrink-0 bg-gold/10">
              <Swords className="w-5 h-5 text-gold" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">Batalhas</p>
              <p className="text-xs text-muted-foreground truncate">
                As lutas que você escolheu enfrentar — sem julgamento, com método
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
          </Link>
        </Card>

        {/* Planos salvos do Conselheiro */}
        <Card className="border-gold/30">
          <Link to="/app/planos" className="flex items-center gap-4 p-4">
            <div className="w-11 h-11 rounded-md grid place-items-center shrink-0 bg-gold/10">
              <ClipboardList className="w-5 h-5 text-gold" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">Meus planos</p>
              <p className="text-xs text-muted-foreground truncate">
                Planos alimentares, de treino e financeiros que o Conselheiro montou para você
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
          </Link>
        </Card>
      </div>
    </div>
  );
}