import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { todayISOInSP, daysAgoISOInSP } from "@/lib/dates";
import { PILLARS, pillarMatchValues, type PillarId } from "@/lib/pillars";
import {
  computeMokariFromTotals, IGNORED_KINDS, ORGAN_KINDS, RECENT_WINDOW_DAYS,
  type Mokari, type MokariEvent, type MokariTotals,
} from "@/lib/mokari";

/* Os dados do Mokari — AGREGADOS, nunca a história.
 *
 * A versão anterior baixava até 6000 linhas de life_events e xp_log. Dois
 * problemas, e o segundo é o grave:
 *
 *   1. custo: mais de 1 MB de JSON por carregamento frio da Jornada;
 *   2. CORREÇÃO: o PostgREST corta no `max-rows` do projeto (1000 por padrão),
 *      e o corte fazia um pilar INTEIRO desaparecer do desenho. Medido com a
 *      história real do fundador: `prosperidade` caía de nível 3 para 0 e a
 *      gema de "ainda não começou" aparecia no lugar dos frutos de 120
 *      lançamentos. Silencioso — nada errava.
 *
 * Agora: afinidade é CONTAGEM por pilar (`count: exact, head: true` — não
 * traz corpo de resposta), estágio é SOMA de XP via RPC, começo da jornada é
 * uma linha, e só a janela recente de sete dias traz eventos, porque sete dias
 * é pequeno por natureza. Exato, sem teto.
 *
 * O DESENHO, porém, não conta por pilar: conta por ÓRGÃO. Desde que Vitalidade
 * absorveu Alimentação (17/09/2026), um pilar desenha duas peças — a raiz
 * sustenta, a folha nutre —, e o que separa as duas é o `kind`, não o pilar.
 * A regra inteira, com o piso de transição e o porquê de cada leitura, está em
 * lib/mokari.ts, no bloco OS QUATRO ÓRGÃOS. Aqui só se consulta.
 *
 * REGRA 3 EM DOIS LUGARES, e os dois importam: as contagens excluem
 * IGNORED_KINDS (peso/corpo) no filtro, e a soma de XP usa
 * `xp_total_mokari`, que exclui os motivos de peso em SQL. `xp_total` NÃO
 * serve aqui: soma tudo.
 *
 * A query só roda com o Mokari LIGADO. Desligado não custa nem uma requisição
 * — é a regra 5, e é por isso que desligar não muda nem a latência da tela. */

/** Filtro PostgREST dos kinds que o Mokari não vê. Montado a partir da
 *  constante para não existir uma segunda lista aqui. */
const KIND_FILTER = `(${IGNORED_KINDS.join(",")})`;

/** Mesmo filtro, acrescido dos kinds do órgão VIZINHO. É o recorte que impede
 *  a mesma refeição de alimentar raiz e folha depois do backfill — ver o piso
 *  de transição em organEventsFromCounts. */
const kindFilterExcept = (kinds: readonly string[]) =>
  `(${[...IGNORED_KINDS, ...kinds].join(",")})`;

export function useMokariData(enabled: boolean) {
  const { user } = useAuth();

  return useQuery<Mokari>({
    queryKey: ["mokari", user?.id, todayISOInSP()],
    enabled: enabled && !!user,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const referenceDay = todayISOInSP();
      const desde = daysAgoISOInSP(RECENT_WINDOW_DAYS - 1);
      const uid = user!.id;

      /* Leitor TOLERANTE (`in`, não `eq`): enquanto houver linha histórica
         dizendo `alimentacao`, contar só `vitalidade` zeraria a afinidade de
         quem mais registrou — e raízes e folhas sumiriam da árvore de quem já
         as tinha. Regressão do conquistado é o que a regra 1 proíbe, e ela já
         foi furada uma vez por esta mesma camada — ver "VAZIO SÓ PODE
         SIGNIFICAR VAZIO", algumas linhas abaixo. */
      const contaPilar = (pillar: PillarId) => supabase.from("life_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid).in("pillar", pillarMatchValues(pillar))
        .not("kind", "in", KIND_FILTER);

      /* As contagens dos ÓRGÃOS. Fruto e flor não aparecem aqui porque saem de
         graça de `contaPilar` (prosperidade e mente) — a fusão não os tocou.
         Raiz e folha precisam de duas leituras cada: por kind, que é o desenho
         certo, e por pilar, que é o piso que segura hábito cumprido e linha
         incoerente. Todas são `head: true`: contam sem trazer corpo. */
      const contaKind = (kinds: readonly string[]) => supabase.from("life_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid).in("kind", kinds as string[]);
      const contaPilarCru = (pillar: string, excetoKinds: readonly string[]) =>
        supabase.from("life_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid).eq("pillar", pillar)
          .not("kind", "in", kindFilterExcept(excetoKinds));

      const [
        xpRes, totalRes, inicioRes, recentesRes,
        raizKindRes, raizPilarRes, folhaKindRes, folhaPilarRes,
        ...pilarRes
      ] = await Promise.all([
        supabase.rpc("xp_total_mokari", { uid }),
        supabase.from("life_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid).not("kind", "in", KIND_FILTER),
        supabase.from("life_events")
          .select("occurred_at")
          .eq("user_id", uid).not("kind", "in", KIND_FILTER)
          .order("occurred_at", { ascending: true }).limit(1).maybeSingle(),
        supabase.from("life_events")
          .select("occurred_at,pillar,kind")
          .eq("user_id", uid)
          .gte("occurred_at", `${desde}T00:00:00-03:00`)
          .order("occurred_at", { ascending: true }).limit(1000),
        contaKind(ORGAN_KINDS.raiz),
        contaPilarCru("vitalidade", ORGAN_KINDS.folha),
        contaKind(ORGAN_KINDS.folha),
        // O pilar absorvido, lido pelo nome que ele tinha: é exatamente o que
        // a folha contava antes da fusão, e é isso que o piso preserva.
        contaPilarCru("alimentacao", ORGAN_KINDS.raiz),
        ...PILLARS.map((p) => contaPilar(p.id)),
      ]);

      /* VAZIO SÓ PODE SIGNIFICAR VAZIO.
         Antes daqui, `data ?? []` transformava falha de leitura em história
         inexistente — e o Mokari de quem tinha Árvore em flor voltava a
         Broto, com afinidade zero em todos os pilares. Regressão do
         conquistado é exatamente o que a regra 1 proíbe, e ela estava sendo
         furada pela camada que alimenta o cálculo, não pelo cálculo.
         Lançar é o que deixa a tela poder dizer "não consegui ler". */
      const falha = [
        xpRes, totalRes, inicioRes, recentesRes,
        raizKindRes, raizPilarRes, folhaKindRes, folhaPilarRes, ...pilarRes,
      ].find((r) => r.error);
      if (falha?.error) throw falha.error;

      const pillarCounts: Partial<Record<string, number>> = {};
      PILLARS.forEach((p, i) => { pillarCounts[p.id] = pilarRes[i].count ?? 0; });

      const totals: MokariTotals = {
        xpTotal: Number(xpRes.data ?? 0),
        pillarCounts: pillarCounts as MokariTotals["pillarCounts"],
        eventsTotal: totalRes.count ?? 0,
        // Sem registro nenhum, `maybeSingle` devolve null: o ambiente fica na
        // primeira etapa, que é o certo — o tempo conta de quando a história
        // começou, não de quando a conta foi criada.
        journeyStart: (inicioRes.data as { occurred_at?: string } | null)?.occurred_at ?? null,
        recentEvents: ((recentesRes.data ?? []) as MokariEvent[]),
        organTotals: {
          raizPorKind: raizKindRes.count ?? 0,
          raizPorPilar: raizPilarRes.count ?? 0,
          folhaPorKind: folhaKindRes.count ?? 0,
          folhaPorPilar: folhaPilarRes.count ?? 0,
          fruto: pillarCounts.prosperidade ?? 0,
          flor: pillarCounts.mente ?? 0,
        },
      };

      return computeMokariFromTotals(totals, referenceDay);
    },
  });
}
