import { useMemo } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  weekScoreboard, fullDayThreshold, FULL_DAY_SIGNALS, type MemberTotals,
} from "@/lib/socialChallenge";
import { linhaDaSemana, metaDoCiclo, semanasDoCiclo } from "@/lib/socialSemana";
import type { DadosDoGrupo } from "@/hooks/useGrupo";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   A FOLHA DO DESAFIO — onde o detalhe mora
   ═══════════════════════════════════════════════════════════════════════════

   A barra COLETIVA continua aqui, e é decisão registrada: ela é a Camada 2 do
   parecer de 17/09, com o k mínimo de quatro consentimentos. O que mudou é o
   lugar — ela saiu da tela principal e passou a viver dentro desta folha, que
   a faixa de uma linha abre.

   ─── O QUE SAIU DAQUI NESTA RODADA, e é vinculante ────────────────────────

   1. **"Faltam 17 — dá 5 por pessoa até o fim."** A seção B do parecer é
      literal: *"Proibido: 'faltam X', 'só falta 1', '+1' animado, delta, e
      qualquer frase que cite o que a pessoa NÃO fez."* Eram dois erros numa
      frase só: "faltam 17" é o complemento do que o grupo não fez (dívida), e
      "dá 5 por pessoa" convertia essa dívida numa COTA INDIVIDUAL que ninguém
      combinou — `goal_value` é por pessoa justamente para que não exista uma
      régua comum, e a tela escrevia a régua comum. De quebra, a divisão usava
      `participantes.length` enquanto a barra só soma quem tem consentimento
      ativo: o número estava errado E deixava deduzir, por subtração, quantos
      participantes não estavam contando — a dedução que o k=4 existe para
      impedir. A barra já diz "O grupo fez 43 de 60"; dizer a mesma coisa pelo
      complemento é o que transforma estado em cobrança.

   2. **A trilha de bolinhas por pessoa.** Ver `FichaDaMetrica.tsx`: a
      geometria saiu da tela inteira. Aqui ela era ainda pior que nos cartões,
      porque `metaDoCiclo` multiplica a meta semanal pelas semanas e qualquer
      meta ≥ 12 recebia a MESMA largura de 96px com preenchimento fracionário
      — literalmente a régua comum. Sobrou o texto, que não tem régua.

   3. **A animação da barra.** `transition-all duration-500` no preenchimento:
      com o sino de pé, a barra deslizava meio segundo para a direita cada vez
      que alguém do grupo registrava algo. É um contador subindo com outra
      forma, e o RT3 proíbe. O CSS veio de antes do tempo real; com o sino
      ligado ele mudou de natureza.

   ─── O QUE CONTINUA PROIBIDO ──────────────────────────────────────────────

   · Sem ordinal, sem posição — a lista vem do `weekScoreboard`, que ordena
     por nome e desempata por id. E ordena pelo NOME DO GRUPO, nunca pelo
     rótulo "Você": ordenar pelo rótulo jogaria quem está olhando sempre para
     a letra V, e "eu num lugar fixo" é ordinal de uma pessoa só.
   · Sem cor por desempenho: cor por desempenho é veredito.
   · Sem prêmio, sem selo, sem troféu. O desafio termina sozinho na data.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function FolhaDoDesafio({
  open, onOpenChange, dados, meuId, onParticipar, entrando, onCombinarOutro, podeCombinar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dados: DadosDoGrupo;
  meuId: string;
  onParticipar: (desafioId: string) => void;
  entrando: boolean;
  onCombinarOutro: () => void;
  podeCombinar: boolean;
}) {
  const d = dados.desafio;
  const futuro = dados.desafioFuturo;

  /* O PLACAR VEM DO `lib/socialChallenge`, e nenhuma regra dele é refeita
     aqui. A tela não ordena, não corta e não decide o k mínimo: ela renderiza.
     `consentimentosNoDesafio` null = a contagem falhou; nesse caso não há
     placar nenhum, e a folha diz isso em vez de inventar um motivo. */
  const placar = useMemo(() => {
    if (!d || dados.consentimentosNoDesafio === null) return null;
    const membros: MemberTotals[] = dados.progresso.map((p) => ({
      memberId: p.user_id,
      // O nome DO GRUPO, nunca o rótulo — o rótulo é resolvido ao desenhar,
      // com `isViewer`, que o `ScoreboardLine` já devolve.
      name: p.display_name,
      done: p.feito ?? 0,
      goal: Number(p.combinado) || 0,
    }));
    return weekScoreboard({
      members: membros,
      viewerId: meuId,
      consentCount: dados.consentimentosNoDesafio,
    });
  }, [d, dados.progresso, dados.consentimentosNoDesafio, meuId]);

  const titulo = d?.nome ?? futuro?.nome ?? dados.encerrado?.nome ?? "Combinado";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>{titulo}</SheetTitle>
          <SheetDescription>
            {d
              ? `Termina ${dataLonga(d.terminaEm)}. Ele acaba sozinho — sem prêmio, e sem cobrança.`
              : futuro
                ? `Começa ${dataLonga(futuro.comecaEm)} e termina ${dataLonga(futuro.terminaEm)}.`
                : `Terminou ${dataLonga(dados.encerrado?.terminaEm ?? "")}.`}
          </SheetDescription>
        </SheetHeader>

        <div className="py-4 space-y-4">
          {/* ── O combinado que ainda não começou ── */}
          {!d && futuro && (
            <p className="text-sm text-muted-foreground">
              Ainda não começou. A partir de {dataLonga(futuro.comecaEm)}, o que cada um
              registrar passa a contar aqui.
            </p>
          )}

          {d && dados.consentimentosNoDesafio === null && (
            /* Erro engolido virava uma explicação FALSA sobre o grupo ("menos
               de quatro pessoas compartilham"). Não saber é uma terceira
               coisa, e a tela diz qual das três é. */
            <p className="text-sm text-muted-foreground">
              Não consegui carregar o total do grupo agora.
            </p>
          )}

          {d && placar && (
            <>
              {placar.collectiveHiddenReason === "k-minimo" ? (
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
              ) : dados.barra && (
                /* O TOTAL VEM DO BANCO, e é ele quem manda: `barra_do_grupo`
                   confere o k, a janela E escala a meta semanal para o ciclo
                   (`ceil(dias/7)`). A tela não refaz nenhuma dessas contas. */
                <BarraDoGrupo
                  feito={dados.barra.feito}
                  meta={dados.barra.combinado}
                  semanas={semanasDoCiclo(d.comecaEm, d.terminaEm)}
                />
              )}

              {/* A LINHA DE CADA UM contra a meta DELA — texto, sem
                  recipiente. Duas frações com denominadores diferentes não se
                  varrem; duas barras, sim. */}
              <div className="space-y-2">
                {placar.lines.map((l) => {
                  const meta = metaDoCiclo(l.goal, d.comecaEm, d.terminaEm);
                  const cru = dados.progresso.find((p) => p.user_id === l.memberId)?.feito ?? null;
                  /* `total_do_ciclo` faz `sum()` sem `coalesce`: zero linhas
                     devolve o MESMO NULL de "não há direito ao número". Se o
                     cartão daquela pessoa mostra número para esta métrica, o
                     direito existe — então o NULL aqui é o zero, e a regra C
                     manda mostrá-lo. Sem esta ponte, quem aparecia "0 de 6" no
                     cartão simplesmente sumia desta lista. */
                  const podeVer = dados.temDireitoAoNumero.has(`${l.memberId}|${d.metricKey}`);
                  const feito = cru === null && podeVer ? 0 : cru;
                  const linha = linhaDaSemana({ feito, combinado: meta || null });
                  if (linha.tipo === "oculta") return null;
                  return (
                    <div key={l.memberId} className="flex items-baseline justify-between gap-3">
                      <span className={cn("text-sm min-w-0 truncate", l.isViewer && "font-medium")}>
                        {l.isViewer ? "Você" : l.name}
                      </span>
                      <span
                        className="text-[13px] text-foreground whitespace-nowrap shrink-0"
                        style={{ fontVariantNumeric: "proportional-nums" }}
                      >
                        {linha.tipo === "contagem"
                          ? `${linha.feito} de ${linha.meta} combinados`
                          : linha.texto}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Participar é opt-in de cada um: ninguém é inscrito por outra
                  pessoa, nem por estar no grupo. */}
              {!d.participantes.includes(meuId) && (
                <Button
                  variant="outline" className="min-h-11 w-full"
                  onClick={() => onParticipar(d.id)} disabled={entrando}
                >
                  {entrando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar neste combinado"}
                </Button>
              )}

              {/* A conta sai do `lib`, não de um número escrito aqui: se o dia
                  inteiro deixar de ser 3 de 4, esta frase acompanha sozinha. */}
              <p className="text-xs text-muted-foreground border-t pt-3">
                Um dia inteiro = {fullDayThreshold(FULL_DAY_SIGNALS.length)} dos{" "}
                {FULL_DAY_SIGNALS.length} sinais do dia (treino · sono · comida · água) —
                não {FULL_DAY_SIGNALS.length} de {FULL_DAY_SIGNALS.length}: dia de descanso
                ainda conta, e quem desligou um sinal não fica de fora. A meta já vem com
                dois dias de folga por pessoa.
              </p>
            </>
          )}

          {/* ── O FECHAMENTO: diz o que foi feito e oferece começar outro.
                 Só isso — sem prêmio, sem selo, sem troféu. ── */}
          {!d && !futuro && dados.encerrado && (
            <>
              <p className="text-sm font-medium">
                {dados.barraEncerrado === null
                  ? "O combinado fechou. O total do grupo não aparece porque menos de quatro pessoas estavam compartilhando este sinal."
                  : `O grupo fez ${dados.barraEncerrado.feito} de ${dados.barraEncerrado.combinado}.`}
              </p>
              {dados.meuEncerrado !== null && (
                <p className="text-sm text-muted-foreground">A sua parte: {dados.meuEncerrado}.</p>
              )}
              {podeCombinar && (
                <Button variant="outline" className="min-h-11" onClick={onCombinarOutro}>
                  Combinar outro
                </Button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A barra do GRUPO contra a meta DO GRUPO — já escalada para o ciclo. */
function BarraDoGrupo({
  feito, meta, semanas,
}: { feito: number; meta: number; semanas: number }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">O grupo fez {feito} de {meta}</p>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        {/* `transition-none`: com o sino de pé, uma barra que desliza quando o
            dado de terceiro chega é um contador subindo com outra forma (RT3).
            Mesma regra do `✓`, que também não anima. */}
        <div
          className="h-full rounded-full transition-none"
          style={{
            width: `${meta > 0 ? Math.min(100, (feito / meta) * 100) : 0}%`,
            background: "hsl(var(--vitalidade))",
          }}
        />
      </div>
      {semanas > 1 && (
        <p className="text-xs text-muted-foreground">
          A meta de cada um é semanal, e o combinado tem {semanas} semanas.
        </p>
      )}
    </div>
  );
}

const dataLonga = (iso: string) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })
    : "";
