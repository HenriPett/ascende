import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HandHeart, Send, Sunrise } from "lucide-react";
import { frasePublica } from "@/components/core/socialPhrases";
import { SHAREABLE_METRICS } from "@/lib/socialMetrics";
import { diaLocal, tintaDaMetrica } from "@/lib/socialSemana";
import type { PessoaDoGrupo, Presenca, Recado } from "@/hooks/useGrupo";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   O FEED — TRÊS NATUREZAS, TRÊS FORMAS
   ═══════════════════════════════════════════════════════════════════════════

   Antes as três usavam o mesmo cartão com a mesma borda, e a tela virava uma
   pilha uniforme de caixas. A separação agora é por FORMA, não por cor:

   · **ATO** — a linha mais leve. Sem caixa: `py-2` e um divisor. O ato já
     está contado no cartão da pessoa; aqui ele é textura, não manchete.
   · **VOLTOU** — sem divisória, com recuo e fundo próprio. É o único item do
     feed com AÇÃO, porque é o único que pede uma: a Camada 3 do parecer é o
     grupo notar quem voltou, no lugar de ordenar quem produziu.
   · **RECADO** — o mais pesado. Aspas, itálico e `text-foreground` (não
     muted): é a única voz humana da tela.

   ─── O NÚMERO NO ATO, e a condição que o permite ──────────────────────────

   O feed é ATO ("a Ana treinou"); o cartão é ESTADO ("3 de 6"). O número no
   feed só vira placar quando ele REPETE — o estado de terceiro reimpresso a
   cada evento, várias vezes por dia, é placar rolável, e aí a leitura vira
   "faltam 3". Então:

   · o número aparece UMA VEZ POR LINHA, e só nas linhas de HOJE. A linha de
     ontem não carrega número nenhum: o estado da semana é o de AGORA, e
     imprimi-lo ao lado de um ato de ontem seria dizer uma coisa que não é
     verdade sobre aquele momento — além de repetir o mesmo número duas vezes
     na mesma rolagem, que é exatamente a forma vetada.
   · NUNCA "faltam X", "só falta 1", "+1", delta, ou qualquer frase que cite o
     que a pessoa NÃO fez.

   ─── A FRASE VEM DO CATÁLOGO, sempre ──────────────────────────────────────

   O texto sai de `frasePublica`, que monta a partir da MESMA string que a
   folha de consentimento promete. Se a tela escrevesse o rótulo por conta
   própria, a folha viraria propaganda do recurso em vez de descrição dele — e
   a promessa "é isto que o grupo lê" deixaria de ser verificável.
   ═══════════════════════════════════════════════════════════════════════════ */

type ItemDoFeed =
  | { id: string; forma: "ato"; presenca: Presenca; estado: string | null }
  | { id: string; forma: "voltou"; userId: string; nome: string; souEu: boolean; dia: string }
  | { id: string; forma: "recado"; recado: Recado };

export default function FeedDoGrupo({
  presencas, recados, pessoas, hojeIso, dei, recebi, novos,
  vigente, recado, setRecado, enviando, onEnviar, onReconhecer, rotuloDoDia,
}: {
  presencas: Presenca[];
  recados: Recado[];
  pessoas: PessoaDoGrupo[];
  hojeIso: string;
  dei: Set<string>;
  recebi: Map<string, number>;
  novos: Set<string>;
  vigente: boolean;
  recado: string;
  setRecado: (v: string) => void;
  enviando: boolean;
  onEnviar: () => void;
  onReconhecer: (userId: string, dia: string) => void;
  rotuloDoDia: (dia: string) => string;
}) {
  /* O ESTADO DA SEMANA de cada pessoa por métrica, para a coluna da direita.
     Vem dos MESMOS cartões que estão acima na tela — não de uma segunda
     consulta que poderia discordar deles. */
  const estadoDe = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pessoas) {
      for (const met of p.metricas) {
        if (met.linha.tipo === "contagem") {
          m.set(`${p.userId}|${met.key}`, `${met.linha.feito} de ${met.linha.meta}`);
        }
      }
    }
    return m;
  }, [pessoas]);

  /* A linha do tempo: presença DERIVADA e recado ESCRITO, juntos e ordenados
     por data. São duas naturezas diferentes de propósito — o ato aponta, a
     nota fala —, e a presença nunca vira texto guardado. */
  const dias = useMemo(() => {
    const porDia = new Map<string, ItemDoFeed[]>();
    const pega = (d: string) => {
      if (!porDia.has(d)) porDia.set(d, []);
      return porDia.get(d)!;
    };

    for (const p of presencas) {
      pega(p.dia).push({
        id: `ato|${p.userId}|${p.dia}|${p.metricKey}`,
        forma: "ato",
        presenca: p,
        estado: p.dia === hojeIso ? estadoDe.get(`${p.userId}|${p.metricKey}`) ?? null : null,
      });
    }

    /* "Voltou" é UM item por pessoa por dia, não um por métrica: quem voltou
       voltou uma vez, e repetir a frase a cada registro dela transformaria um
       reconhecimento em anúncio. */
    const jaVoltou = new Set<string>();
    for (const p of presencas) {
      if (!p.voltou) continue;
      const chave = `${p.userId}|${p.dia}`;
      if (jaVoltou.has(chave)) continue;
      jaVoltou.add(chave);
      pega(p.dia).push({
        id: `voltou|${chave}`, forma: "voltou",
        userId: p.userId, nome: p.nome, souEu: p.souEu, dia: p.dia,
      });
    }

    for (const r of recados) {
      /* `created_at` é `timestamptz` e o PostgREST o serializa em UTC, então
         `slice(0,10)` era a data UTC. As presenças são dias de São Paulo e o
         "hoje" da tela também — um recado escrito às 22:15 de Brasília caía
         num balde de AMANHÃ, que ordenava ACIMA de "hoje" e ganhava um
         cabeçalho com o nome do dia seguinte, com a assinatura logo abaixo
         dizendo "22:15". A mesma função que decide o "hoje" da tela decide o
         dia do recado. */
      pega(diaLocal(new Date(r.criadoEm))).push({ id: `recado|${r.id}`, forma: "recado", recado: r });
    }

    // Ordem DENTRO do dia: atos, depois quem voltou, depois os recados. É a
    // hierarquia de peso do desenho, do mais leve ao mais pesado.
    const peso = { ato: 0, voltou: 1, recado: 2 } as const;
    return [...porDia.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([dia, itens]) => ({
        dia,
        itens: itens.sort((x, y) => peso[x.forma] - peso[y.forma]),
      }));
  }, [presencas, recados, estadoDe, hojeIso]);

  return (
    <Card className="p-4 space-y-3">
      {/* A frase seca, sem caixa e sem explicação: o parágrafo que estava aqui
          ("quando alguém registrar algo que escolheu compartilhar, aparece
          nesta lista — e só isso") é a doutrina repetida numa seção que não
          precisa dela. Ela já está dita uma vez, na frase-âncora dos cartões. */}
      {dias.length === 0 && (
        <p className="text-sm text-muted-foreground">Nada por aqui hoje.</p>
      )}

      {/* `overflow-anchor: auto` — RT6: se uma linha entrar acima do que a
          pessoa está lendo, o navegador compensa sozinho e o scroll NÃO se
          move sob o dedo. Sem auto-scroll, sem "pular para o novo". */}
      <div style={{ overflowAnchor: "auto" }}>
        {dias.map(({ dia, itens }) => (
          <div key={dia}>
            {/* A barra do app é `sticky top-0 z-30` e ocupa 0..58px. Com
                `top-0 z-10` este cabeçalho grudava DENTRO e ATRÁS dela: o
                sticky existia e nunca era visto, e quem rolava perdia a
                referência de qual dia estava lendo. Desce para 58px e sobe de
                camada — deslocamento, não redesenho. */}
            <p className="sticky top-[58px] z-20 bg-background/95 py-1.5 text-caption2 font-semibold uppercase tracking-wider text-muted-foreground">
              {rotuloDoDia(dia)}
            </p>

            {itens.map((item) => (
              <div
                key={item.id}
                /* O MARCADOR DE NOVO: decoração, e some sozinho em 45s. Não é
                   badge, não é contador, não é não-lido — e não aparece em
                   lote (ver `useMarcadorDeNovo`).
                   A borda existe SEMPRE, transparente: assim o marcador some
                   com um fade de 400ms de verdade, e nada se desloca sob o
                   dedo quando ele vai embora (RT6). */
                className={cn(
                  "border-l-2 pl-2 transition-colors duration-[400ms]",
                  novos.has(item.id) ? "border-gold/45" : "border-transparent",
                )}
              >
                {item.forma === "ato" && <LinhaDeAto item={item} />}
                {item.forma === "voltou" && (
                  <BlocoDeVolta
                    item={item}
                    jaDei={dei.has(`${item.userId}|${item.dia}`)}
                    recebidos={item.souEu ? (recebi.get(item.dia) ?? 0) : 0}
                    onReconhecer={onReconhecer}
                  />
                )}
                {item.forma === "recado" && <BlocoDeRecado recado={item.recado} />}
              </div>
            ))}

            {/* O apoio que EU recebi naquele dia, quando ele não tem um bloco
                de "voltou" para carregá-lo. Só quem recebeu vê o número: o
                grupo não vê o de ninguém, porque contador público de apoio é
                placar de popularidade com outro nome. */}
            <MeuApoioDoDia
              quantos={recebi.get(dia) ?? 0}
              jaMostrado={itens.some((i) => i.forma === "voltou" && i.souEu)}
            />
          </div>
        ))}
      </div>

      {/* O FIM EXPLÍCITO. A tela acaba aqui: não existe "carregar mais".
          `v_grupo_hoje` devolve hoje e ontem, e não aceita intervalo de datas
          nem se a tela pedir — o histórico diário de terceiro é o calendário
          de bolinhas, e ele não sai do banco. */}
      {dias.length > 0 && (
        <div className="pt-1 space-y-1.5">
          <div className="ascend-line" aria-hidden />
          <p className="text-caption2 text-center text-muted-foreground">
            Aqui acaba. O grupo mostra hoje e ontem.
          </p>
        </div>
      )}

      {vigente && (
        <form
          className="flex gap-2 border-t pt-3"
          onSubmit={(e) => { e.preventDefault(); onEnviar(); }}
        >
          <Input
            className="min-h-11 min-w-0 flex-1" maxLength={500}
            placeholder="Escrever um recado para o grupo"
            value={recado} onChange={(e) => setRecado(e.target.value)}
            aria-label="Recado para o grupo"
            enterKeyHint="send"
          />
          <Button
            type="submit" size="icon" className="w-11 h-11 shrink-0"
            disabled={enviando || !recado.trim()} aria-label="Enviar recado"
            loading={enviando}
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      )}
    </Card>
  );
}

/** ATO — a forma mais leve. Sem caixa, sem borda: só um divisor e ar. */
function LinhaDeAto({ item }: { item: Extract<ItemDoFeed, { forma: "ato" }> }) {
  const p = item.presenca;
  const doCatalogo = SHAREABLE_METRICS[p.metricKey];
  const tinta = tintaDaMetrica(p.metricKey, !!doCatalogo?.composedOf.length, doCatalogo?.signals[0]);
  return (
    <div className="flex items-center gap-2 py-2 border-b border-border/60">
      <span className={cn("w-1.5 h-1.5 rounded-full bg-current shrink-0", tinta)} aria-hidden />
      <span className="text-sm flex-1 min-w-0 break-words">
        {frasePublica(p.nome, p.souEu, { kind: "ato", metricKey: p.metricKey, texto: null })}
      </span>
      {item.estado && (
        <span className="text-caption2 text-muted-foreground shrink-0 tabular-nums">
          {item.estado}
        </span>
      )}
    </div>
  );
}

/** VOLTOU — sem divisória, com recuo e fundo próprio. O único item com ação. */
function BlocoDeVolta({
  item, jaDei, recebidos, onReconhecer,
}: {
  item: Extract<ItemDoFeed, { forma: "voltou" }>;
  jaDei: boolean;
  recebidos: number;
  onReconhecer: (userId: string, dia: string) => void;
}) {
  return (
    <div className="my-2 rounded-lg bg-accent/40 py-3 px-3 flex gap-2.5">
      <Sunrise className="w-4 h-4 shrink-0 mt-0.5 text-gold-ink" aria-hidden />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium">
          {item.souEu ? "Você voltou." : `${item.nome} voltou.`}
        </p>
        {/* NUNCA quantos dias ficou fora: o número é o denominador da
            ausência, e o banco nem o devolve — `voltou` é um bit. */}
        <p className="text-xs text-muted-foreground">Primeiro registro depois de um tempo.</p>
        {item.souEu
          ? recebidos > 0 && (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <HandHeart className="w-3.5 h-3.5" aria-hidden /> {recebidos}
            </p>
          )
          : (
            <div className="flex justify-end">
              <Button
                variant="ghost" size="sm" className="min-h-11 text-muted-foreground"
                onClick={() => onReconhecer(item.userId, item.dia)} disabled={jaDei}
              >
                <HandHeart className="w-4 h-4 mr-1.5" />
                {jaDei ? "Enviado" : "Mandar um força"}
              </Button>
            </div>
          )}
      </div>
    </div>
  );
}

/** RECADO — a única voz humana da tela, e a forma mais pesada. */
function BlocoDeRecado({ recado }: { recado: Recado }) {
  return (
    <div className="my-2 border-l-2 border-border bg-muted/30 rounded-r-lg py-2.5 px-3">
      <p className="text-sm italic text-foreground break-words">“{recado.texto}”</p>
      <p className="text-caption2 text-muted-foreground text-right mt-1">
        — {recado.souEu ? "Você" : recado.nome},{" "}
        {new Date(recado.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}

function MeuApoioDoDia({ quantos, jaMostrado }: { quantos: number; jaMostrado: boolean }) {
  if (!quantos || jaMostrado) return null;
  return (
    <p className="py-2 text-xs text-muted-foreground inline-flex items-center gap-1">
      <HandHeart className="w-3.5 h-3.5" aria-hidden /> {quantos} — o grupo mandou força para você.
    </p>
  );
}
