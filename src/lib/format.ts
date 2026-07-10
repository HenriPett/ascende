import { todayISOInSP, monthStartISOInSP, hourInSP } from "@/lib/dates";

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Data de "hoje" no fuso America/Sao_Paulo (biblioteca central em lib/dates.ts). */
export const todayISO = () => todayISOInSP();

export const monthStartISO = () => monthStartISOInSP();

export const greet = () => {
  const h = hourInSP();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
};