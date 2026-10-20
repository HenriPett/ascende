// Netlify Edge Function (Deno): `Accept: text/markdown` → o .md do build.
// Só cola. A decisão — q-values, qual .md, 404 em Markdown, `Vary: Accept` —
// mora em src/lib/agentes/negociacao.ts e é testada no vitest.
// Sem import de "@netlify/edge-functions": o contexto usado é só `next()`, e
// assim o `deno check` roda sem rede nem dependência.
import { CAMINHOS_EXCLUIDOS, negociar } from "../../src/lib/agentes/negociacao.ts";

export default (req: Request, context: { next: () => Promise<Response> }) =>
  negociar(req, () => context.next(), (url) => fetch(url));

export const config = {
  path: "/*",
  excludedPath: CAMINHOS_EXCLUIDOS,
};
