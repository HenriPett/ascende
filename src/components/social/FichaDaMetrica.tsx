import { Check } from "lucide-react";
import { SHAREABLE_METRICS } from "@/lib/socialMetrics";
import { tintaDaMetrica, type LinhaVisivel } from "@/lib/socialSemana";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   A FICHA — a forma que substituiu a trilha, e por quê
   ═══════════════════════════════════════════════════════════════════════════

   A forma anterior era uma trilha de bolinhas cujo COMPRIMENTO era a meta da
   pessoa, apoiada na ideia de que os cartões nunca alinhariam em coluna. O QA
   mediu o DOM e provou o contrário: em 390px há uma coluna só, o rótulo de uma
   mesma métrica tem sempre a mesma largura, e as três trilhas de "Treinos"
   começavam no mesmo x. Com os blocos cheios ancorados no mesmo ponto, lia-se
   quem estava na frente em menos de um segundo — sem ler número nenhum.

   Comprimento ancorado é canal pré-atento: o olho ordena antes de ler. Então a
   GEOMETRIA SAIU INTEIRA e o NÚMERO FICOU — o número era o pedido do fundador
   ("0 de 6") e a forma canônica do parecer; a geometria não foi pedida por
   ninguém. Sem geometria, o alinhamento vira inofensivo: duas fichas no mesmo
   x são duas FRASES que precisam ser lidas, com denominadores diferentes.

   ─── AS SETE REGRAS DESTA FICHA, e cada uma tem um motivo ─────────────────

   1. **Sem comprimento significante.** A largura vem do rótulo e dos dígitos,
      nunca da meta nem do feito. Duas pessoas com metas 5 e 6 podem ter fichas
      idênticas em largura — e isso agora é CORRETO, não um defeito.
   2. **Sem preenchimento.** O fundo é o mesmo em "0 de 6" e em "5 de 6".
   3. **Numerador e denominador com o MESMO tratamento** — mesma cor, mesmo
      tamanho, mesmo peso. Isso OBRIGA a ler "de 5" junto com o "3": numerador
      destacado é o que permitiria varrer só os numeradores em coluna.
   4. **Numerais PROPORCIONAIS, não tabulares.** Ao contrário do instinto:
      `tabular-nums` alinharia os dígitos em coluna entre fichas, que é
      exatamente o que não se quer aqui.
   5. **`whitespace-nowrap` na fração.** "3 de 5" nunca quebra no meio — era
      assim que o número ficava órfão e colava na métrica seguinte.
   6. **Marca de cumprido SÓ no meu próprio cartão.** No cartão de terceiro não
      existe marca em forma nenhuma — só o número. Ver o bloco logo abaixo do
      cabeçalho: é o conserto de um erro meu, e a razão é que marcar "cumpriu"
      na frente dos outros premia quem escolheu a meta modesta.
   7. **Cor é identidade, nunca desempenho.** O ponto de 6px veste a tinta do
      pilar. A ficha de quem fez 0 e a de quem fez 6 têm exatamente a mesma cor.

   ─── O ERRO DA REGRA 6, E POR QUE A MARCA NÃO PODE TER COR ────────────────

   A primeira versão desta ficha pintava a ficha cumprida de verde
   (`bg-vitalidade/10` + `border-vitalidade/30`) e o docblock defendia isso
   assim: *"binário não ordena: parte o grupo em dois conjuntos e, dentro de
   cada um, não há gradação visual nenhuma."*

   **A frase é verdadeira para UMA ficha, e o raciocínio não subiu um nível.**
   O cartão tem VÁRIAS fichas, e a CONTAGEM de fichas verdes por cartão é uma
   gradação — contínua, e pré-atenta. O QA mediu com três cartões reais (Ana 2
   cumpridas, Você 0, Bruno 3) e ordenou "Bruno > Ana > Você" em menos de um
   segundo, **sem ler um número**. Ou seja: o verde reconstruiu exatamente o
   placar que os dots formavam, por outro canal. Cor de bloco é área, e área
   soma no olho.

   Pior, e é o agravante ético: quem escolhe metas BAIXAS fica mais verde que
   quem escolhe metas ambiciosas. O sinal premiava combinar pouco.

   Então o fundo e a borda da ficha cumprida **saíram** — são os mesmos em
   `0 de 6` e em `6 de 6`. Isso é cor por desempenho, que a seção D do parecer
   já proibia por conta própria.

   **A lição, para quem mexer aqui depois:** a pergunta "esta marca ordena?"
   tem de ser feita no nível do CARTÃO e no da TELA, nunca no do elemento. Um
   sinal binário por item vira contagem por conjunto, e contagem é ordem.

   ─── E A REGRA DE ESPAÇO QUE FECHA O NÚMERO ÓRFÃO ─────────────────────────

   6px DENTRO da ficha × 8px ENTRE fichas. Era o contrário (8 dentro, 6 entre),
   e por isso o número ficava mais perto do rótulo da métrica SEGUINTE do que
   do seu próprio. Além da distância, a ficha tem borda e fundo: região comum
   vence proximidade, então o agrupamento sobrevive até se a ficha quebrar.
   ═══════════════════════════════════════════════════════════════════════════ */

/** O espaço ENTRE fichas (8px) é sempre MAIOR que o espaço dentro (6px).
 *  `min-w-0`: a mesma trava do cartão, um nível abaixo. Sem ela, o que não
 *  encolhe aqui dentro (a fração é `whitespace-nowrap`, e o `max-w-full` da
 *  ficha é porcentagem — que não resolve durante a medição intrínseca da
 *  trilha) sobe pela árvore e dimensiona a coluna do grid. */
export const CLASSES_DO_CONTAINER = "flex flex-wrap gap-2 min-w-0";

/**
 * A MARCA DE CUMPRIDO SÓ EXISTE NO MEU PRÓPRIO CARTÃO.
 *
 * Decisão do Fiel (Adendo 3, 18/09/2026), vinculante. No cartão de TERCEIRO
 * não existe marca de cumprimento em forma nenhuma: nem glifo, nem cor, nem
 * peso de fonte, nem borda, nem opacidade, nem ordem, nem ícone ao lado do
 * nome. **Só o número.** No meu, o `✓` pode inclusive ter cor — é devolutiva
 * minha sobre mim, sem plateia.
 *
 * É a mesma fronteira do Adendo 2 (forma na minha linha, número na dos
 * outros), agora aplicada ao marcador de cumprimento.
 *
 * ─── A RAZÃO, e ela não é estética ────────────────────────────────────────
 *
 * Marcar "cumpriu" na frente dos outros **PREMIA QUEM ESCOLHEU A META
 * MODESTA**. Isso não reabre só a comparação: **corrompe o DENOMINADOR**, que
 * é a peça sobre a qual toda a doutrina se apoia — a regra C3 (comparação
 * sempre contra a meta da própria pessoa) e a do "0 de 6" dependem de a meta
 * ser uma declaração honesta. No instante em que a meta baixa rende mais
 * marcas, a pessoa aprende a BAIXAR A META, e o produto passa a ensinar o
 * contrário do que vende.
 *
 * ─── AS DUAS SAÍDAS RECUSADAS, para ninguém refazer o caminho ─────────────
 *
 * · **`✓` neutro em todos os cartões.** Não resolve: contar glifos é contar.
 *   Tinta neutra ENFRAQUECE o canal, não o fecha — e "mais difícil de
 *   perceber" é a definição de sludge, não de conserto. (Era o que eu tinha
 *   implementado; estava errado.)
 * · **Tirar o `✓` de todo lugar.** Tira demais: no meu próprio cartão não
 *   existe segunda linha para formar régua, e marcar ali o combinado cumprido
 *   é serviço.
 *
 * Quem for devolver o `✓` ao cartão de terceiro achando que é enfeite
 * inofensivo: ele não é. Ele é uma instrução para combinar menos.
 */
export default function FichaDaMetrica({
  metricKey, label, linha, souEu,
}: {
  metricKey: string;
  /** O rótulo CURTO. O longo é o contrato da folha de consentimento e não
   *  encurta lá; aqui ele não caberia, e foi essa a causa do número órfão. */
  label: string;
  linha: LinhaVisivel;
  /** É o meu próprio cartão? É a ÚNICA coisa que libera a marca de cumprido.
   *  Sem isto a ficha não sabe distinguir devolutiva de placar. */
  souEu?: boolean;
}) {
  const doCatalogo = SHAREABLE_METRICS[metricKey as keyof typeof SHAREABLE_METRICS];
  const tinta = tintaDaMetrica(metricKey, !!doCatalogo?.composedOf.length, doCatalogo?.signals[0]);
  // A regra inteira numa linha, e o porquê está no bloco acima.
  const marcar = linha.tipo === "contagem" && linha.cumpriu && !!souEu;

  return (
    <span
      /* A MESMA casca para todo mundo, cumprido ou não: sem fundo verde, sem
         borda verde, sem nada que se conte de longe. Ver o bloco do topo —
         pintar a ficha cumprida reconstruía o placar que os dots formavam, e
         premiava quem combinou pouco.
         `max-w-full`: uma ficha que não caiba ocupa a linha inteira sozinha e
         quebra DENTRO da própria borda. Rótulo de métrica nunca é truncado —
         truncar o rótulo é esconder de qual métrica se está falando. */
      className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-border bg-muted/40 px-2.5 py-1"
    >
      <span className={cn("w-1.5 h-1.5 rounded-full bg-current shrink-0", tinta)} aria-hidden />
      <span className="text-footnote text-foreground font-medium min-w-0">{label}</span>
      {linha.tipo === "contagem" ? (
        <span
          className="text-footnote text-foreground font-medium whitespace-nowrap"
          style={{ fontVariantNumeric: "proportional-nums" }}
        >
          {/* A forma canônica. O zero entra aqui como qualquer outro número:
              zero com denominador declarado não acusa, situa (regra C). E o
              numerador NÃO é destacado — ver a regra 3 acima. */}
          {linha.feito} de {linha.meta}
        </span>
      ) : (
        /* Consentida SEM meta semanal: não se inventa denominador (regra A.4),
           e "sem registro" só pode aparecer aqui — nunca como eufemismo de um
           zero que tem meta. A distinção que o tipo faz sobrevive na forma. */
        <span className="text-footnote text-muted-foreground whitespace-nowrap">{linha.texto}</span>
      )}
      {marcar && (
        /* SÓ NO MEU CARTÃO — ver o bloco acima. Aqui a cor pode ficar: não há
           segunda linha na tela para formar régua com esta, e é devolutiva
           minha sobre mim. Estado, não prêmio: sem animação, sem confete, sem
           "parabéns". Contra a MINHA meta, que é a única comparação que esta
           marca faz. */
        <Check className="w-3 h-3 shrink-0 text-vitalidade-ink" aria-label="combinado cumprido" />
      )}
    </span>
  );
}

/**
 * A ficha FANTASMA — a mesma forma, tracejada, sem dado nenhum.
 *
 * Ela substituiu as três bolinhas cinzas do estado vazio, que ensinavam a
 * gramática de uma tela que não existe mais (e que, medidas, ficavam a 1,25:1
 * — invisíveis no tema claro). O tracejado em `border-muted-foreground/50`
 * mede ~3,2:1: passa o mínimo de objeto gráfico, e ensina a FORMA REAL.
 */
export function FichaFantasma({ texto }: { texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/50 px-2.5 py-1">
      <span className="w-1.5 h-1.5 rounded-full border border-muted-foreground/50" aria-hidden />
      <span className="text-footnote text-muted-foreground whitespace-nowrap">{texto}</span>
    </span>
  );
}
