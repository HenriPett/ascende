// ASCENDE — Biblioteca central de datas (plano §5.4)
// Regra: instantes são gravados em UTC no banco; agrupamentos, "hoje",
// semanas e meses usam SEMPRE o fuso America/Sao_Paulo, calculado aqui.
// Não misture current_date do banco, horário do navegador e toISOString()
// fora destes helpers.
export const APP_TZ = "America/Sao_Paulo";

/** Partes da data no fuso de São Paulo. */
export function spParts(d: Date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year), m: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute),
    weekday: String(p.weekday), // Sun..Sat
    dateIso: `${p.year}-${p.month}-${p.day}`,
  };
}

/** "YYYY-MM-DD" de hoje EM SÃO PAULO (use no lugar de toISOString().slice). */
export const todayISOInSP = () => spParts().dateIso;

/** "YYYY-MM-01" do mês atual em São Paulo. */
export const monthStartISOInSP = () => {
  const { y, m } = spParts();
  return `${y}-${String(m).padStart(2, "0")}-01`;
};

/** Domingo em São Paulo? (retrospectiva semanal) */
export const isSundayInSP = (d: Date = new Date()) => spParts(d).weekday === "Sun";

/** Hora local de São Paulo (0-23), para saudações. */
export const hourInSP = (d: Date = new Date()) => spParts(d).hour;

/** Formata um instante UTC/ISO para exibição em pt-BR no fuso de SP. */
export function formatSP(iso: string, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" }) {
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: APP_TZ, ...opts }).format(new Date(iso));
  } catch { return iso; }
}
