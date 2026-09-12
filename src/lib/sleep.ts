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

/* ─── E O DIA DE UM REGISTRO DE SONO? ─────────────────────────────

   Não mora aqui, e isso é deliberado. A regra ("o dia de um sono é o dia em
   que a pessoa ACORDOU") está escrita por extenso em
   supabase/functions/_shared/lib.ts, junto de `sleepWakeDay`/`resolveSleepDays`.

   Ela vive lá porque é lá que toda proposta nasce — app (capture, ai-chat) e
   WhatsApp passam pela MESMA extração. O dia chega ao front já resolvido, e
   `captureEvents.saveProposedEvents` escreve o que a pessoa confirmou sem
   reinterpretar nada.

   Uma cópia da regra aqui seria pior do que nenhuma: duas cópias divergem em
   silêncio, e aí app e WhatsApp voltam a gravar o mesmo fato de jeitos
   diferentes — que é exatamente o bug que a regra existe para fechar. */
