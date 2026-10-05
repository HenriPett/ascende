import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePillarActivityQuery } from "@/hooks/useJornadaData";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PILLARS, activePillarSet, normalizePillars, type PillarId } from "@/lib/pillars";
import { ChevronRight, Swords, ClipboardList, Plus, Layers, Users } from "lucide-react";
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
    /* Normaliza ANTES de acrescentar. A leitura já traduz o apelido, então
       nada se perderia sem isto — mas gravar a lista crua de volta
       perpetuaria `alimentacao` no banco a cada ativação, e apelido que se
       reescreve sozinho nunca chega ao fim do prazo de remoção. */
    const next = [...new Set([...normalizePillars(profile?.pillars), id])];
    const { error } = await supabase.from("profiles").update({ pillars: next }).eq("user_id", user.id);
    setActivating(null);
    if (error) { toast.error("Não consegui ativar agora. Tente de novo."); return; }
    toast.dismiss("Não consegui ativar agora. Tente de novo.");
    toast.success(`Pronto: ${PILLARS.find((p) => p.id === id)?.name} agora faz parte do seu Ascende.`);
    refresh();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up [&_:is(h1,h2,h3)]:hyphens-auto [&_:is(h1,h2,h3)]:[overflow-wrap:break-word]">
      {/* Títulos podem quebrar no meio da palavra, e só quando a palavra
        não cabe: com Texto Maior a 40 pt, "Prosperidade" ou "Conselheiro"
        num `text-2xl` passam da largura da tela sozinhos. Hifeniza em
        pt-BR onde o dicionário deixa; senão, quebra onde precisar. No
        tamanho padrão nenhum título chega na borda, então nada muda. */}
      <div>
        <h1 className="font-display text-2xl font-semibold">Pilares</h1>
        <p className="text-subhead text-muted-foreground">
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
                  {/* `anywhere`: o nome é uma palavra só, e a 40 pt
                      "Prosperidade" passa da tela (ver o pilar pausado, abaixo). */}
                  <p className="font-semibold [overflow-wrap:anywhere]">{p.name}</p>
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
        {/* `min-w-0` + quebra em qualquer ponto: "MyFitnessPal" é nome
            próprio (o dicionário não hifeniza) e, a 40 pt, sozinho é mais
            largo que a coluna ao lado do ícone. */}
        <p className="text-xs text-muted-foreground leading-relaxed min-w-0 [overflow-wrap:break-word]">
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
                  {/* `flex-wrap` com piso de largura no texto: no tamanho padrão
                      tudo cabe numa linha, como antes; com Texto Maior o
                      "Ativar" (que não pode encolher) desce para a linha de
                      baixo, alinhado à direita, em vez de empurrar a página. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                    <div
                      className="w-11 h-11 rounded-md grid place-items-center shrink-0 opacity-60"
                      style={{ background: `hsl(var(${p.colorVar}) / 0.12)` }}
                    >
                      <p.icon className="w-5 h-5" style={{ color: `hsl(var(${p.colorVar}))` }} />
                    </div>
                    {/* Piso de 8rem COM TETO de 100%: a 40 pt, 8rem são 320 px —
                        mais que a linha inteira —, e o piso sozinho empurrava a
                        página. `min(8rem,100%)` vale 8rem no padrão e nunca
                        passa da linha.
                        No nome, `anywhere` (e não `break-word`) de propósito: é UMA
                        palavra, e a 40 pt "Prosperidade" sozinha passa da tela —
                        `break-word` não a quebra porque mantém a palavra como
                        largura mínima. Aqui é seguro: o piso de 8rem do bloco
                        impede o flex de espremê-lo, e no tamanho padrão o nome
                        cabe inteiro, então nada se parte. */}
                    <div className="flex-1 min-w-[min(8rem,100%)]">
                      <p className="font-semibold text-muted-foreground hyphens-auto [overflow-wrap:anywhere]">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {n > 0 ? `${n} ${n === 1 ? "registro" : "registros"} nos últimos 14 dias — parece que já é seu` : p.desc}
                      </p>
                    </div>
                    {/* Era um <button> cru que trocava "Ativar" pelo spinner — o
                        nome sumia no toque e a pílula encolhia. O Button da casa
                        segura o rótulo (invisível) e dá o alvo de 44 pt. */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => activatePillar(p.id)}
                      loading={activating === p.id}
                      disabled={!!activating}
                      className="shrink-0 ml-auto gap-1 rounded-full text-xs px-3"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden /> Ativar
                    </Button>
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
              <p className="font-semibold [overflow-wrap:anywhere]">Batalhas</p>
              <p className="text-xs text-muted-foreground truncate">
                As lutas que você escolheu enfrentar — sem julgamento, com método
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
          </Link>
        </Card>

        {/* Social: transversal como Batalhas, e pelo mesmo motivo — não é área
            da vida, é jeito de percorrer as outras. Aqui, e NÃO como sexto alvo
            da barra: a barra tem cinco alvos e um só protagonista dourado, e
            negociar isso seria resolver o problema errado.
            Sem badge e sem bolinha, hoje e sempre: bolinha vermelha é o motor
            de "abre o app", que o Dilema 4 proíbe. */}
        <Card className="border-gold/30">
          <Link to="/app/social" className="flex items-center gap-4 p-4">
            <div className="w-11 h-11 rounded-md grid place-items-center shrink-0 bg-gold/10">
              <Users className="w-5 h-5 text-gold" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold [overflow-wrap:anywhere]">Social</p>
              <p className="text-xs text-muted-foreground truncate">
                Um grupo pequeno que se acompanha na semana — sem plateia, sem placar
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
              <p className="font-semibold [overflow-wrap:anywhere]">Meus planos</p>
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