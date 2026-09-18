import { Sunrise } from "lucide-react";
import FichaDaMetrica, { CLASSES_DO_CONTAINER } from "@/components/social/FichaDaMetrica";
import type { PessoaDoGrupo } from "@/hooks/useGrupo";
import { cn } from "@/lib/utils";

/**
 * O CARTÃO DE UMA PESSOA — a semana dela contra o combinado DELA.
 *
 * ─── O QUE MUDOU, E POR QUE ELE NÃO TEM MAIS TRILHA ───────────────────────
 *
 * A versão anterior desenhava uma trilha de bolinhas cujo comprimento era a
 * meta. O QA mediu o DOM e provou que, em 390px, as trilhas da MESMA métrica
 * começam todas no mesmo x — e aí o comprimento do bloco cheio ordena as
 * pessoas antes de qualquer número ser lido. A geometria saiu inteira; ficou o
 * número, que é o que o fundador pediu e a forma que o parecer autoriza. O
 * detalhe da decisão está em `FichaDaMetrica.tsx`.
 *
 * ─── O QUE CONTINUA VALENDO ───────────────────────────────────────────────
 *
 * · **Zero percentual, zero ordinal, zero cor de bom/ruim.** Sem "faltam 5":
 *   dívida de terceiro é ausência disfarçada, e ausência é o que esta tela não
 *   mostra em forma nenhuma.
 * · O ÚNICO destaque de quem está olhando é o rótulo "Você" e um anel
 *   discreto. Nunca o topo da lista: a ordem alfabética inclui você, e "eu
 *   primeiro" é ordinal de uma pessoa só.
 * · A ordem das métricas é a FIXA do catálogo (`ordem` 1..7), igual para todo
 *   mundo e igual à do resto do app. Ordenar por desempenho seria ranking
 *   interno; embaralhar para atrapalhar a comparação seria sludge — esconder a
 *   régua confundindo o leitor. A régua foi retirada na origem; a ordem pode
 *   ser honesta.
 */
export default function CartaoDaPessoa({
  pessoa, semNumeros,
}: {
  pessoa: PessoaDoGrupo;
  /** Os números da semana não carregaram (erro de rede, view fora do ar) ou o
   *  grupo já terminou. Sem isto, a ausência de linhas seria confundida com
   *  "ela não compartilha" — uma frase sobre a ESCOLHA dela, e falsa. */
  semNumeros?: boolean;
}) {
  const nome = pessoa.souEu ? "Você" : pessoa.nome;

  return (
    <div
      className={cn(
        /* `min-w-0` NO ITEM DO GRID — uma palavra, e ela impede a página de
           rolar de lado. Medido pelo QA numa réplica de CSS puro em 391px,
           uma variável só (o comprimento do nome):

             nome "Ana"        → cartões 285px · scrollWidth 391 = clientWidth
             nome de 40 chars  → cartões 392px · scrollWidth 445 · 54px de estouro
             com `min-w-0`     → cartões 285px · sem estouro · nome ainda trunca

           A CAUSA, e ela é contraintuitiva o bastante para eu ter errado o
           diagnóstico na primeira leitura: o `min-w-0 truncate` do `<p>` do
           nome protege a LINHA dentro do cartão, mas não protege o CARTÃO
           contra a própria trilha do grid. `white-space: nowrap` (que é o que
           `truncate` faz) mantém o `min-content` do texto igual à largura
           INTEIRA da frase; `min-w-0` derruba o mínimo automático do item
           flex, não o `min-content` dele. Como um item de grid também nasce
           com `min-width: auto`, esse `min-content` passa a dimensionar o
           item, o item dimensiona a trilha `auto`, e a trilha dimensiona
           TODOS os cartões da coluna — por isso o cartão do vizinho crescia
           junto, sem ninguém ter tocado no nome dele.

           E 40 caracteres não é caso patológico: é o `maxLength` que o próprio
           campo de "como eles te chamam" oferece.

           A mesma trava está no contêiner das fichas, um nível abaixo, pela
           mesma razão — e lá ela é o que torna alcançável o comportamento que
           `FichaDaMetrica` documenta: ficha que não cabe quebra DENTRO da
           própria borda, em vez de empurrar a coluna. */
        "min-w-0 rounded-xl border p-3.5 space-y-2.5 bg-card",
        pessoa.souEu && "ring-1 ring-primary/30",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="w-9 h-9 rounded-full bg-muted grid place-items-center text-lg shrink-0"
          aria-hidden
        >
          {pessoa.emoji || "🙂"}
        </span>
        <p className="font-medium text-sm flex-1 min-w-0 truncate">{nome}</p>
        {/* CAMADA 3 — o grupo nota quem VOLTOU. Nunca "sumiu", nunca há
            quantos dias: o número seria o denominador da ausência. */}
        {pessoa.voltouHoje && (
          <span className="inline-flex items-center gap-1 shrink-0 text-gold-ink">
            <Sunrise className="w-3.5 h-3.5" aria-hidden />
            <span className="text-[11px]">voltou hoje</span>
          </span>
        )}
      </div>

      {semNumeros ? null : pessoa.metricas.length === 0 ? (
        /* A pessoa APARECE mesmo sem compartilhar nada: ela existe no grupo.
           "Ainda não compartilha" fala de uma ESCOLHA dela; "não registrou"
           falaria de ausência, e é por isso que essa segunda frase não existe
           em lugar nenhum desta tela. Esta frase só pode sair quando a tela
           TEM os números e eles estão vazios — daí o `semNumeros` acima. */
        <p className="text-xs text-muted-foreground">Ainda não compartilha nada.</p>
      ) : (
        <div className={CLASSES_DO_CONTAINER}>
          {pessoa.metricas.map((m) => (
            <FichaDaMetrica
              key={m.key} metricKey={m.key} label={m.labelCurto}
              linha={m.linha} souEu={pessoa.souEu}
            />
          ))}
        </div>
      )}
    </div>
  );
}
