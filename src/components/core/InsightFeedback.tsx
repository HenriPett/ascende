import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

/* "Isso te ajudou?" — o único sinal NOVO da Fase 6, e ele é novo porque
 * precisa ser: "insight útil" é juízo da pessoa, e não existe jeito honesto de
 * inferir isso sem perguntar. Seis das sete medidas da fase saem de dados que
 * ela mesma gerou; esta é a exceção, e a exceção se resolve PERGUNTANDO, não
 * instrumentando.
 *
 * Quatro regras que o desenho respeita, e o motivo de cada uma:
 *
 * DISCRETA. Uma linha no pé do card, tipografia menor, sem moldura própria. O
 * card é sobre a vida dela, não sobre a nossa métrica — se a pergunta competir
 * com o conteúdo, ela virou o assunto, e o assunto é o sono e o gasto da
 * pessoa.
 *
 * SIM OU NÃO. Sem estrela, sem NPS, sem escala de 1 a 10. Duas opções não
 * pedem que ela calibre nada, e "de 1 a 10 quanto isso te ajudou?" é uma
 * pergunta que só serve a quem faz a planilha.
 *
 * UMA VEZ SÓ. Quem respondeu não é perguntado de novo — e quem IGNOROU também
 * não. Repetir transforma uma pergunta educada em cobrança, e o produto
 * inteiro é construído contra isso.
 *
 * SÓ ONDE FAZ SENTIDO. Nunca num card de "ainda não dá para dizer": ali não
 * ajudou nem tentou ajudar, e perguntar seria pedir opinião sobre uma coisa
 * que não aconteceu. Quem decide isso é o chamador (ver TrendInsights). */

export default function InsightFeedback({
  answered, saving, onAnswer,
}: {
  /** Já respondeu (`"sim"`/`"nao"`) — mostra o agradecimento em vez da
   *  pergunta. `null` = ainda não respondeu nesta sessão. */
  answered: "sim" | "nao" | null;
  saving?: boolean;
  onAnswer: (value: "sim" | "nao") => void;
}) {
  if (answered) {
    // Confirmação de UMA linha e nada mais. Sem "obrigado pelo feedback!",
    // sem convite a comentar, sem segunda pergunta: ela respondeu, acabou.
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--success))" }} aria-hidden />
        Anotado.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2 pt-0.5">
      <p className="text-xs text-muted-foreground">Isso te ajudou?</p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost" size="sm"
          className="h-7 px-2.5 text-xs text-muted-foreground"
          onClick={() => onAnswer("sim")}
          disabled={saving}
        >
          Sim
        </Button>
        <Button
          variant="ghost" size="sm"
          className="h-7 px-2.5 text-xs text-muted-foreground"
          onClick={() => onAnswer("nao")}
          disabled={saving}
        >
          Não
        </Button>
      </div>
    </div>
  );
}
