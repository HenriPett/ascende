// ASCENDE — Configuração de testes (Vitest). Testes de unidade para funções
// puras (datas no fuso de São Paulo, XP, rótulos); fluxos completos entram
// depois com Playwright (plano §6.2).
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
