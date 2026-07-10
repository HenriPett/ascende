import { useId } from "react";
import { cn } from "@/lib/utils";

/* ─── Marca Ascende ───────────────────────────────────────────────
   Símbolo: uma linha de cume ascendente e um sol nascente.
   Lê-se como montanha e como gráfico subindo — traço aberto,
   sem caixa, em gradiente dourado. */

export function LogoMark({ className = "w-8 h-8" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={`au-${id}`} x1="8" y1="52" x2="56" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E39A2E" />
          <stop offset="1" stopColor="#F8C842" />
        </linearGradient>
      </defs>
      <circle cx="44" cy="10" r="6" fill={`url(#au-${id})`} />
      <path
        d="M8 50 L26 28 L36 40 L56 16"
        stroke={`url(#au-${id})`}
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Logo({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const mark = size === "lg" ? "w-10 h-10" : size === "sm" ? "w-7 h-7" : "w-8 h-8";
  const word = size === "lg" ? "text-2xl" : size === "sm" ? "text-lg" : "text-xl";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LogoMark className={mark} />
      <span className={cn("font-display font-semibold tracking-tight", word)}>Ascende</span>
    </div>
  );
}
