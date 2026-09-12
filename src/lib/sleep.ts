// Rotina de sono — matemática pura da janela (testável, sem I/O).
// A rotina são dois horários (dormir, acordar) no estilo do iPhone; a
// duração derivada alimenta sleep_goal_h e o check-in matinal de 1 toque.

/** "23:00" | "23:00:00" → minutos desde 00:00. null se inválido. */
export function parseTimeToMinutes(t?: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(t).trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** minutos desde 00:00 → "HH:MM" (para inputs e para salvar em `time`). */
export function minutesToTime(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Duração da janela em horas, tratando a virada da meia-noite
 *  (23:00 → 06:30 = 7,5h; 01:00 → 09:00 = 8h; iguais = null). */
export function sleepWindowHours(bedtime?: string | null, waketime?: string | null): number | null {
  const b = parseTimeToMinutes(bedtime);
  const w = parseTimeToMinutes(waketime);
  if (b === null || w === null) return null;
  const diff = (w - b + 1440) % 1440;
  if (diff === 0) return null;
  return Math.round((diff / 60) * 10) / 10;
}

/** "7,5h" | "8h" — duração formatada para exibição em pt-BR. */
export function formatWindowHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${String(rounded).replace(".", ",")}h`;
}

/** "23:00:00" (Postgres time) → "23:00" para inputs type=time. */
export function timeForInput(t?: string | null): string {
  const min = parseTimeToMinutes(t);
  return min === null ? "" : minutesToTime(min);
}

/** Ângulo (rad) de um horário no dial de 24h, 00:00 no topo, sentido horário. */
export function timeToAngle(minutes: number): number {
  return ((minutes / 1440) * Math.PI * 2) - Math.PI / 2;
}

/** Ponto (x,y) sobre um círculo para o horário dado. */
export function timePoint(minutes: number, cx: number, cy: number, r: number): { x: number; y: number } {
  const a = timeToAngle(minutes);
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

/** Path SVG do arco da janela de sono (de dormir a acordar, sentido horário). */
export function sleepArcPath(bedMin: number, wakeMin: number, cx: number, cy: number, r: number): string {
  const start = timePoint(bedMin, cx, cy, r);
  const end = timePoint(wakeMin, cx, cy, r);
  const sweepMin = (wakeMin - bedMin + 1440) % 1440;
  const largeArc = sweepMin > 720 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/** Ângulo do ponteiro (em minutos desde 00:00) a partir de um toque no dial. */
export function pointToMinutes(x: number, y: number, cx: number, cy: number): number {
  const a = Math.atan2(y - cy, x - cx) + Math.PI / 2; // 00:00 no topo
  const norm = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const raw = (norm / (Math.PI * 2)) * 1440;
  return (Math.round(raw / 15) * 15) % 1440; // snap de 15 min (estilo iPhone)
}

/* ─── O DIA DE UM REGISTRO DE SONO ───────────────────────────────

   Sono é o único registro cujo dia é ambíguo por natureza: a noite atravessa
   a virada. "Dormi 6h" dito às 7h da manhã fala de um sono que começou ONTEM
   e terminou HOJE, e as duas respostas para "que dia foi isso?" são defensáveis.

   A REGRA DA CASA, agora escrita: o dia de um registro de sono é o dia em que
   a pessoa ACORDOU.

   Não é invenção — é o que o app já fazia sem dizer. O check-in matinal
   (SleepCheckin) pergunta de manhã sobre a noite que acabou e grava com o
   `now()` do banco, ou seja, HOJE. É também a leitura que faz os Indicadores
   valerem alguma coisa: correlacionar "o sono do dia D" com "o treino do dia
   D" só diz algo se o sono for a noite que ANTECEDE aquele dia.

   O BUG QUE ISTO CORRIGE. A captura por texto (app e WhatsApp) resolve datas
   com a regra genérica de qualquer evento: "ontem" é hoje menos um. Para um
   almoço está certo; para a noite que a pessoa acabou de dormir, não — quem
   manda "ontem dormi 6h" às 7h da manhã está nomeando a noite pelo dia em que
   FOI DEITAR, que é como todo mundo fala. O registro nascia em ontem, a tela
   Hoje perguntava por hoje, e o convite de check-in reaparecia para quem
   acabara de registrar: o registro existia e a interface dizia que não.

   A CORREÇÃO É ESTREITA DE PROPÓSITO. Só desloca "ontem" → "hoje", e só de
   manhã. De manhã as duas leituras de "ontem à noite" colapsam na mesma noite,
   a que acabou de terminar. À tarde não colapsam ("ontem dormi mal" pode ser
   a noite retrasada), e aí a data relatada é respeitada como veio. "Anteontem"
   nunca se move: quem conta dois dias sabe o que está contando. */

/** Até que hora (em SP) um relato de sono ainda fala da noite que acabou.
 *  Mesma fronteira do convite matinal de check-in, que perece ao meio-dia. */
export const SLEEP_MORNING_UNTIL_H = 12;

/** Dia anterior a um "YYYY-MM-DD", sem passar por fuso (UTC puro na conta). */
function dayBefore(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}

/**
 * Em que dia um registro de SONO deve nascer.
 *
 * Pura: `today` e `hourNow` (dia e hora em São Paulo) ENTRAM por parâmetro,
 * nenhuma leitura de relógio aqui dentro — mesma disciplina de `lib/insights.ts`.
 *
 * @param reportedDay dia "YYYY-MM-DD" que o relato apontou
 * @param today       dia civil de hoje em SP
 * @param hourNow     hora de agora em SP (0-23)
 */
export function sleepWakeDay(reportedDay: string, today: string, hourNow: number): string {
  if (hourNow >= SLEEP_MORNING_UNTIL_H) return reportedDay;
  return reportedDay === dayBefore(today) ? today : reportedDay;
}
