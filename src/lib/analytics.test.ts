import { describe, it, expect } from "vitest";
import { isPublicPath } from "./analytics";

/* A fronteira entre público e autenticado é uma decisão de PRIVACIDADE, não
 * de estilo: tudo que estiver do lado errado vira gravação de sessão em cima
 * de finanças, saúde e diário. Por isso ela é testada rota a rota. */
describe("isPublicPath", () => {
  it("aceita as páginas que qualquer visitante vê", () => {
    for (const p of ["/", "/recusas", "/privacidade", "/termos", "/aviso-legal"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });

  it("recusa toda a área autenticada", () => {
    for (const p of [
      "/app",
      "/app/",
      "/app/conselheiro",
      "/app/prosperidade",
      "/app/vitalidade",
      "/app/alimentacao",
      "/app/mente",
      "/app/score",
      "/app/planos",
      "/app/batalhas",
      "/app/ajustes",
      "/app/assinatura",
      "/onboarding",
    ]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });

  it("recusa as telas de credencial", () => {
    // A pessoa digita e-mail e senha aqui; e o callback carrega tokens na URL.
    expect(isPublicPath("/auth")).toBe(false);
    expect(isPublicPath("/auth/callback")).toBe(false);
  });

  it("não confunde rota que apenas começa com um prefixo público", () => {
    // "/termos-de-uso-secreto" não é "/termos".
    expect(isPublicPath("/termosx")).toBe(false);
    expect(isPublicPath("/privacidade-interna")).toBe(false);
  });

  it("aceita subcaminho legítimo de página pública", () => {
    expect(isPublicPath("/termos/v2")).toBe(true);
  });
});
