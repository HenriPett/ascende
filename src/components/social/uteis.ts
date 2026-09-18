import { diaLocal } from "@/lib/socialSemana";
import { cn } from "@/lib/utils";

/** O prazo em uma frase. Factual e sem urgência: "termina em 3 dias", nunca
 *  um relógio correndo. */
export function prazo(vigente: boolean, dias: number): string {
  if (!vigente) return "o combinado terminou";
  if (dias <= 0) return "termina hoje";
  return `termina em ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/** "hoje" / "ontem". A view não devolve mais que isso, então não existe
 *  terceiro caso — mas a data fica escrita para o dia em que existir.
 *  O "hoje" é o dia LOCAL: em UTC, depois das 21h em São Paulo, o rótulo
 *  cairia no dia seguinte e a tela mentiria com nome de gente em cima. */
export function rotuloDoDia(dia: string, agora: Date): string {
  const hoje = diaLocal(agora);
  const ontem = diaLocal(new Date(agora.getTime() - 864e5));
  if (dia === hoje) return "hoje";
  if (dia === ontem) return "ontem";
  return new Date(`${dia}T00:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "short",
  });
}

/** O chip de escolha, no padrão da casa: 44px de alvo, e tinta escura sobre a
 *  sálvia porque o branco reprova AA nos dois temas. */
export const chip = (ativo: boolean) => cn(
  "text-sm rounded-full border px-4 min-h-11 transition-colors",
  ativo ? "border-transparent text-primary-foreground" : "text-muted-foreground hover:bg-muted/60",
);

/**
 * O código, de onde quer que a pessoa tenha colado.
 *
 * Ela vai colar o link inteiro, o link com texto em volta, ou só o código — as
 * três formas chegam de conversas reais, e recusar duas delas seria
 * transformar um convite num teste de atenção.
 */
export function codigoDoTexto(bruto: string): string {
  const t = bruto.trim();
  if (!t) return "";
  const naQuery = t.match(/[?&]convite=([^&\s]+)/);
  if (naQuery) return decodeURIComponent(naQuery[1]);
  const pedacos = t.split(/[/\s]+/).filter(Boolean);
  return pedacos[pedacos.length - 1] ?? "";
}
