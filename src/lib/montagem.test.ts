import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { consumirMontagemDoPrerender, marcarMontagemDoPrerender } from "./montagem";

describe("a montagem por cima do pré-render", () => {
  it("a marca vale uma vez: a próxima visita dentro da SPA anima", () => {
    marcarMontagemDoPrerender(true);
    expect(consumirMontagemDoPrerender()).toBe(true);
    expect(consumirMontagemDoPrerender()).toBe(false);
  });

  it("o main.tsx marca ANTES do createRoot, pelo data-prerender do #root", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    const marca = main.indexOf('marcarMontagemDoPrerender(root.hasAttribute("data-prerender"))');
    expect(marca).toBeGreaterThan(0);
    expect(marca).toBeLessThan(main.indexOf("createRoot(root)"));
  });

  it("o herói da Landing só anima a entrada fora do pré-render — e os itens do demo continuam", () => {
    const landing = readFileSync(new URL("../pages/Landing.tsx", import.meta.url), "utf8");
    expect(landing).toContain('useState(() => (consumirMontagemDoPrerender() ? "" : "animate-fade-up"))');
    const heroi = landing.slice(landing.indexOf('<section className="relative">'), landing.indexOf("<CaptureDemo />"));
    expect(heroi.match(/\$\{animarEntrada\}/g)).toHaveLength(6);
    expect(heroi).not.toContain(" animate-fade-up");
    expect(landing.match(/p-2\.5 animate-fade-up/g)).toHaveLength(2);
  });
});
