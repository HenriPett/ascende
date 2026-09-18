import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Loader2 } from "lucide-react";
import { CATALOGO_VISIVEL } from "@/components/core/socialPhrases";
import {
  FULL_DAY_SIGNALS, fullDayThreshold, groupWeekGoal, WEEK_DAYS_PER_PERSON,
} from "@/lib/socialChallenge";
import { SHAREABLE_METRICS, type SocialMetricKey } from "@/lib/socialMetrics";
import { cn } from "@/lib/utils";

/**
 * CRIAR UM DESAFIO — "A Semana Inteira", de fábrica.
 *
 * O objeto do Social é o COMBINADO, não o mural (condição C1 do Fiel), e é
 * esta folha que materializa a frase: um desafio tem começo, fim e resultado
 * coletivo, e ele EXPIRA SOZINHO. Ninguém precisa encerrar, e não existe
 * "renovar automaticamente" — combinado que se renova sem alguém combinar de
 * novo deixou de ser combinado e virou presença permanente, que é exatamente a
 * forma que o parecer vetou.
 *
 * TRÊS COISAS QUE ESTA TELA NÃO TEM, e cada ausência responde a um risco:
 *
 * · **Prêmio.** Sem XP, sem selo, sem troféu, sem "você desbloqueou". Ação no
 *   app não vira XP (micro-incoerência 1), e prêmio por desafio social
 *   transformaria o combinado numa moeda — aí o que move deixa de ser a vida
 *   melhorando e passa a ser o prêmio, que é o motor que o Dilema 4 recusa.
 * · **Escassez.** Nada de "vagas limitadas" nem contagem regressiva que não
 *   corresponda a um limite real do sistema (N14). O prazo aqui é o prazo, e
 *   ele existe porque um combinado tem fim — não para apressar ninguém.
 * · **Lista própria de métricas.** O seletor abaixo é construído a partir do
 *   catálogo de `lib/socialMetrics.ts`, nunca de uma lista escrita aqui. Se
 *   fossem duas listas, elas divergiriam no primeiro dia em que alguém mexesse
 *   numa delas — e a que o Fiel auditou é a do catálogo. Peso e corpo não
 *   aparecem porque não estão lá, não porque esta tela os esconde.
 */

/** As durações oferecidas. Dias inteiros, escritos como a pessoa fala. Sete é
 *  o padrão: é a semana dela, e é a janela em que um combinado ainda é um
 *  combinado em vez de um projeto. */
const DURACOES = [
  { dias: 7, label: "1 semana" },
  { dias: 14, label: "2 semanas" },
  { dias: 30, label: "1 mês" },
] as const;

const PADRAO: SocialMetricKey = "dia_inteiro";

export default function SocialChallengeSheet({
  open, onOpenChange, pessoasNoGrupo, criando, onCriar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pessoasNoGrupo: number;
  criando: boolean;
  onCriar: (d: {
    nome: string; metricKey: SocialMetricKey; comeca: string; termina: string;
  }) => Promise<boolean>;
}) {
  const [nome, setNome] = useState("A Semana Inteira");
  const [metrica, setMetrica] = useState<SocialMetricKey>(PADRAO);
  const [dias, setDias] = useState<number>(7);

  useEffect(() => {
    if (open) { setNome("A Semana Inteira"); setMetrica(PADRAO); setDias(7); }
  }, [open]);

  const hoje = new Date();
  const fim = new Date(hoje);
  fim.setDate(fim.getDate() + dias - 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const fimLegivel = fim.toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long",
  });

  /* A ESTIMATIVA da meta, antes de criar. A meta de verdade é a SOMA do que
     cada um combinar na folha de consentimento (`group_data_consents
     .goal_value`) — aqui o número sai de `pessoas × 5`, a régua da casa, para
     a pessoa ter a ordem de grandeza antes de decidir. Os dois dias de folga
     por pessoa já estão DENTRO dela, e mostrar a conta é o que impede o
     desafio de ser lido como "sete dias ou você falhou". */
  const metaArredondada = Math.round(groupWeekGoal(pessoasNoGrupo) * (dias / 7));

  const ehDiaInteiro = metrica === "dia_inteiro";
  const precisa = fullDayThreshold(FULL_DAY_SIGNALS.length);

  const criar = async () => {
    const ok = await onCriar({
      nome: nome.trim() || "A Semana Inteira",
      metricKey: metrica,
      comeca: iso(hoje),
      termina: iso(fim),
    });
    if (ok) onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* As duas correções de toque da casa, medidas em QA e já pagas uma vez
       *  (AppLayout.tsx, achados N5 e N6). Reaproveitadas literalmente aqui:
       *
       *  N5 — o "Fechar" do SheetContent é 16x16 (um ícone de 16px num botão
       *  sem tamanho). Escape resolve no teclado; no celular não existe
       *  Escape. A caixa vira 44x44 SEM o desenho sair do lugar: o botão é
       *  `absolute right-4 top-4`, então o ícone estava centrado a 24px de
       *  cada borda (16 + 16/2); com a caixa em 44px, `right-0.5 top-0.5`
       *  recoloca esse centro exatamente em 24px (2 + 44/2).
       *
       *  N6 — `safe-bottom` sozinho ZERARIA o respiro (num aparelho sem
       *  recorte ele vale 0 e, sendo mais específico, apaga o `p-6` do
       *  próprio SheetContent). O `calc` SOMA o recorte ao padding: 24px
       *  sempre, mais o que o aparelho pedir — senão a última linha termina
       *  dentro dos ~34px do indicador de home do iPhone, onde o toque vira
       *  gesto do sistema. */}
      <SheetContent
        side="bottom"
        className={cn(
          "rounded-t-2xl max-h-[85dvh] overflow-y-auto",
          "pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
          "[&>button]:h-11 [&>button]:w-11 [&>button]:grid [&>button]:place-items-center [&>button]:right-0.5 [&>button]:top-0.5",
        )}
      >
        <SheetHeader className="text-left">
          <SheetTitle>Combinar um desafio</SheetTitle>
          <SheetDescription>
            Um combinado com começo, fim e um resultado do grupo. Sem prêmio: quando
            termina, a tela diz o que foi feito e oferece começar outro.
          </SheetDescription>
        </SheetHeader>

        <div className="py-4 space-y-5">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">O nome do combinado</p>
            <Input
              className="min-h-11" maxLength={60} value={nome}
              onChange={(e) => setNome(e.target.value)}
              aria-label="Nome do desafio"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">O que conta</p>
            {/* O SELETOR VEM DO CATÁLOGO. `CATALOGO_VISIVEL` é
                `SOCIAL_METRIC_KEYS.filter(isShareable)` — então uma métrica que
                sair do catálogo some daqui sozinha, e uma que nunca deveria ter
                entrado não chega. Peso e corpo não estão na lista porque não
                estão no catálogo. */}
            <div className="flex flex-wrap gap-2">
              {CATALOGO_VISIVEL.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMetrica(m.key)}
                  aria-pressed={metrica === m.key}
                  className={cn(
                    "text-sm rounded-full border px-4 min-h-11 inline-flex items-center gap-1.5 transition-colors",
                    metrica === m.key
                      ? "border-transparent text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                  style={metrica === m.key ? { background: "hsl(var(--vitalidade))" } : undefined}
                >
                  <span aria-hidden>{m.emoji}</span> {m.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Cada pessoa continua vendo só o que combinou ver: se alguém não ligou este
              tipo para este grupo, ela participa sem entrar na conta.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Quanto tempo</p>
            <div className="flex flex-wrap gap-2">
              {DURACOES.map((d) => (
                <button
                  key={d.dias}
                  type="button"
                  onClick={() => setDias(d.dias)}
                  aria-pressed={dias === d.dias}
                  className={cn(
                    "text-sm rounded-full border px-4 min-h-11 transition-colors",
                    dias === d.dias
                      ? "border-transparent text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                  style={dias === d.dias ? { background: "hsl(var(--vitalidade))" } : undefined}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Termina {fimLegivel}, e termina sozinho — ninguém precisa encerrar, e ele
              não se renova por conta própria.
            </p>
          </div>

          {/* A conta, antes de criar. Um combinado cuja meta a pessoa só
              descobre depois não é um combinado. */}
          <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
            <p className="text-sm font-medium">
              A meta do grupo: por volta de {metaArredondada}{" "}
              {ehDiaInteiro ? "dias inteiros" : SHAREABLE_METRICS[metrica].label.toLowerCase()}
            </p>
            <p className="text-xs text-muted-foreground">
              {pessoasNoGrupo} {pessoasNoGrupo === 1 ? "pessoa" : "pessoas"} × {WEEK_DAYS_PER_PERSON} por
              semana. São cinco de sete de propósito: os dois dias de folga por pessoa já
              estão dentro da meta — o grupo pode fechar 100% com todo mundo descansando
              dois dias. A meta final é a soma do que cada um combinar: quem combinar
              menos não puxa ninguém para baixo, só combina menos.
            </p>
            {ehDiaInteiro && (
              <p className="text-xs text-muted-foreground border-t pt-1.5">
                Um dia inteiro = {precisa} dos {FULL_DAY_SIGNALS.length} sinais do dia
                (treino · sono · comida · água). {precisa} de {FULL_DAY_SIGNALS.length}, não{" "}
                {FULL_DAY_SIGNALS.length} de {FULL_DAY_SIGNALS.length}: dia de descanso ainda
                conta pelos outros, e quem desligou um sinal não fica de fora por causa de uma
                escolha de privacidade.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Não vale XP, não dá selo e não tem troféu. Ele existe para vocês sustentarem
            uma semana juntos — e o que fica no fim é a semana, não o prêmio.
          </p>
        </div>

        <Button className="w-full min-h-11" onClick={criar} disabled={criando}>
          {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Combinar"}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
