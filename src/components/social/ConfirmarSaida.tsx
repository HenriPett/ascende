import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * SAIR DO GRUPO — confirmação de ATO DESTRUTIVO. Não é retenção.
 *
 * ─── A DIFERENÇA, e ela é a razão deste arquivo existir ───────────────────
 *
 * O código antigo tinha um comentário dizendo que NÃO existe diálogo aqui de
 * propósito. Aquele comentário está certo e continua valendo — mas ele fala de
 * RETENÇÃO, que é outra coisa:
 *
 * · **Retenção (PROIBIDO, e segue proibido):** "Tem certeza? Seus amigos vão
 *   sentir sua falta", "você vai perder sua sequência de 14 dias", um botão
 *   "Ficar" maior que o de sair, uma oferta de desconto, um segundo passo que
 *   existe para cansar. Isso usa o vínculo social como algema, e é exatamente
 *   o padrão que esta casa recusa. Nada disso está abaixo.
 * · **Confirmação de ato destrutivo (o que ESTA folha é):** dizer o que vai
 *   ser apagado, e pedir o segundo toque. Sair apaga `group_visible_stats`, o
 *   consentimento e até os reconhecimentos que a pessoa RECEBEU — não há
 *   desfazer, e dentro da própria casa apagar uma fonte de importação (menos
 *   grave e reversível) já pergunta antes.
 *
 * O teste para quem for mexer nisto um dia: **este diálogo tenta convencer
 * alguém a ficar?** Se a resposta for não, ele é confirmação. Se alguém
 * acrescentar uma frase sobre o que a pessoa perde EM RELAÇÃO AOS OUTROS, ou
 * um botão que grita "ficar", virou retenção — e aí tem de sair.
 *
 * Por isso: o botão de cancelar diz o que cancelar SIGNIFICA ("Continuar no
 * grupo"), sem adjetivo e sem apelo; o de confirmar diz o ato ("Sair e
 * apagar"), sem suavizar; e não há terceira opção, nem oferta, nem pergunta
 * sobre o motivo da saída.
 */
export default function ConfirmarSaida({
  open, onOpenChange, saindo, onConfirmar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  saindo: boolean;
  onConfirmar: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sair deste grupo?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              <p>
                O que este grupo via de você é apagado — o histórico inteiro, não só
                o daqui pra frente: os dias já publicados, o que você tinha escolhido
                compartilhar e os "força" que você recebeu aqui.
              </p>
              <p>
                O seu registro continua seu: nada sai do seu app. Não dá para desfazer,
                e ninguém do grupo é avisado.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saindo}>Continuar no grupo</AlertDialogCancel>
          {/* `destrutiva`: vermelho, e sem o papel de destaque — o dourado é a
              cor da recompensa nesta casa (ver ui/alert-dialog.tsx).
              Sem spinner aqui de propósito: a ação do Radix FECHA o alerta no
              toque, então o spinner nunca chegava a aparecer. A espera é
              mostrada no `⋯` do cabeçalho (MenuDoGrupo), que continua na tela. */}
          <AlertDialogAction destrutiva onClick={onConfirmar} disabled={saindo}>
            Sair e apagar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
