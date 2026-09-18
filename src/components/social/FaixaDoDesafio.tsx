import { ChevronRight } from "lucide-react";
import type { DadosDoGrupo } from "@/hooks/useGrupo";

/**
 * A FAIXA DO DESAFIO — uma linha, e não um cartão de três blocos.
 *
 * O desafio saiu do topo da tela porque ele não é o que a pessoa vem ver: ela
 * vem ver o que cada um fez. Ele continua existindo, continua com prazo e
 * continua expirando sozinho — mas cabe numa linha, e o detalhe mora na folha
 * que esta faixa abre.
 *
 * PRAZO FACTUAL, sem contagem regressiva: o combinado tem fim, e dizer quando
 * é serviço puro. "Últimas 24h!" seria escassez artificial, que está vetada.
 *
 * Quando não há desafio nenhum, esta faixa NÃO EXISTE — o convite para
 * combinar um migra para o menu do cabeçalho. Um convite permanente no corpo
 * da tela é o app empurrando um combinado que não é dele.
 */
export default function FaixaDoDesafio({
  desafio, futuro, encerrado, hojeIso, onAbrir,
}: {
  desafio: DadosDoGrupo["desafio"];
  /** Combinado marcado para começar depois de hoje. Ele existia e era exibido
   *  como "em curso" — com a folha abrindo vazia, porque nada é somado antes
   *  de `starts_on`. Agora ele diz que ainda não começou. */
  futuro: DadosDoGrupo["desafioFuturo"];
  encerrado: DadosDoGrupo["encerrado"];
  hojeIso: string;
  onAbrir: () => void;
}) {
  if (!desafio && !futuro && !encerrado) return null;

  const texto = desafio
    ? `${desafio.nome} · ${prazoDoDesafio(desafio.terminaEm, hojeIso)}`
    : futuro
      ? `${futuro.nome} · começa ${quando(futuro.comecaEm, hojeIso)}`
      : `${encerrado!.nome} · terminou ${dataCurta(encerrado!.terminaEm)}`;

  return (
    <button
      onClick={onAbrir}
      className="w-full flex items-center gap-2 bg-accent/50 text-accent-foreground rounded-lg px-3 py-2 min-h-11 text-left hover:bg-accent/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-sm flex-1 min-w-0 truncate">{texto}</span>
      <ChevronRight className="w-4 h-4 shrink-0 opacity-70" aria-hidden />
    </button>
  );
}

function prazoDoDesafio(terminaEm: string, hojeIso: string): string {
  if (terminaEm <= hojeIso) return "termina hoje";
  return `termina ${quando(terminaEm, hojeIso)}`;
}

/**
 * "segunda-feira" dentro da semana, a data a partir daí.
 *
 * Só o dia da semana é ambíguo acima de sete dias: um combinado que termina em
 * onze dias dizia "termina segunda-feira" — qual segunda? O prazo continua
 * factual e sem contagem regressiva; só deixa de ser ambíguo.
 */
function quando(iso: string, hojeIso: string): string {
  const dias = Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${hojeIso}T00:00:00Z`)) / 864e5,
  );
  if (!Number.isFinite(dias) || dias > 7) return dataCurta(iso);
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { weekday: "long" });
}

const dataCurta = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
