// ASCENDE — As regras de [[redirects]] do netlify.toml, lidas e simuladas.
// Só para os testes: amarram as rotas do App.tsx às regras e aos arquivos
// do build (src/prerender/rotas.test.ts). Não é um parser de TOML — lê o
// subconjunto que o nosso netlify.toml usa (from, to, status, force), e
// recusa o que não entende para nenhuma regra passar despercebida.

export interface RegraNetlify { from: string; to: string; status: number; force: boolean }

export function lerRegras(toml: string): RegraNetlify[] {
  const out: RegraNetlify[] = [];
  const blocos = toml.split(/^\[\[redirects\]\]\s*$/m).slice(1);
  for (const b of blocos) {
    const corpo = b.split(/^\[/m)[0]; // até a próxima tabela
    const campos: Record<string, string> = {};
    for (const linha of corpo.split("\n")) {
      const l = linha.trim();
      if (!l || l.startsWith("#")) continue;
      const m = l.match(/^([a-z_]+)\s*=\s*(?:"([^"]*)"|(\d+)|(true|false))\s*$/);
      if (!m) throw new Error(`netlify.toml: linha de [[redirects]] que o teste não entende: ${l}`);
      campos[m[1]] = m[2] ?? m[3] ?? m[4];
    }
    const extras = Object.keys(campos).filter((k) => !["from", "to", "status", "force"].includes(k));
    if (extras.length) throw new Error(`netlify.toml: campo de [[redirects]] não coberto pelo teste: ${extras.join(", ")}`);
    out.push({ from: campos.from, to: campos.to, status: Number(campos.status ?? 301), force: campos.force === "true" });
  }
  return out;
}

/** Netlify: `/x` casa `/x` e `/x/`; `/x/*` casa tudo abaixo de `/x/`. */
export function casaRegra(from: string, caminho: string): boolean {
  const semBarra = (s: string) => (s.length > 1 ? s.replace(/\/+$/, "") : s);
  if (from.endsWith("/*")) return caminho.startsWith(from.slice(0, -1));
  return semBarra(from) === semBarra(caminho);
}

/** O arquivo que o Netlify serviria para `caminho`, se existir em `arquivos`
 *  (relativos a dist/): o próprio, `<caminho>.html` ou `<caminho>/index.html`. */
export function arquivoDe(caminho: string, arquivos: ReadonlySet<string>): string | null {
  const rel = caminho.replace(/^\/+/, "");
  const candidatos = rel === "" ? ["index.html"]
    : rel.endsWith("/") ? [`${rel}index.html`]
    : [rel, `${rel}.html`, `${rel}/index.html`];
  return candidatos.find((c) => arquivos.has(c)) ?? null;
}

export type Resolucao =
  | { tipo: "arquivo"; arquivo: string; status: 200 }
  | { tipo: "regra"; regra: RegraNetlify; status: number }
  | { tipo: "404"; status: 404 };

/** A ordem do Netlify: arquivo que existe vence regra sem `force`; depois a
 *  primeira regra que casa; senão, 404 (servindo o 404.html). */
export function resolver(caminho: string, regras: RegraNetlify[], arquivos: ReadonlySet<string>): Resolucao {
  const forcada = regras.find((r) => r.force && casaRegra(r.from, caminho));
  if (forcada) return { tipo: "regra", regra: forcada, status: forcada.status };
  const arquivo = arquivoDe(caminho, arquivos);
  if (arquivo) return { tipo: "arquivo", arquivo, status: 200 };
  const regra = regras.find((r) => casaRegra(r.from, caminho));
  if (regra) return { tipo: "regra", regra, status: regra.status };
  return { tipo: "404", status: 404 };
}
