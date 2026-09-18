/* ASCENDE — O CONTRATO ENTRE O FRONT E O BANCO.
 *
 * ─── O BUG QUE ORIGINOU ESTE ARQUIVO (18/09/2026) ───────────────────────
 *
 * O front do Social chamava `group_feed`, `group_member_goals` e
 * `group_reactions`. Nenhuma das três existe: o banco tem `group_notes`,
 * `group_recognitions`, e a meta mora em `group_data_consents.goal_value`.
 * Erro real do navegador: PGRST205, "Could not find the table
 * public.group_feed". O fundador achou usando o app.
 *
 * ─── POR QUE NADA PEGOU, E É ESTRUTURAL ─────────────────────────────────
 *
 * 865 testes passando, `tsc` limpo, autoteste de banco provando as revogações
 * com usuários de verdade, QA visual varrendo as telas — e o bug passou por
 * todos. A razão não é descuido: é que os testes provam o FRONT contra si
 * mesmo e o BANCO contra si mesmo, e ninguém provava o CONTRATO entre os dois.
 *
 * `supabase.from("group_feed")` é uma STRING. O TypeScript não sabe que aquela
 * tabela não existe; o vitest não fala com Postgres; o autoteste SQL não lê
 * TypeScript. O buraco tinha o tamanho de uma tela inteira, e só aparecia
 * quando uma pessoa clicava.
 *
 * Este arquivo é a ponte: lê o que o front CHAMA e o que o SQL CRIA, e falha
 * quando os dois discordam. Vale mais que o conserto — o conserto tira um bug,
 * isto tira a classe.
 *
 * ─── O QUE ESTE TESTE COBRE ─────────────────────────────────────────────
 *
 *   • toda `.from("tabela")` com nome literal, em src/ (fora testes);
 *   • toda `.rpc("funcao")` com nome literal;
 *   • as COLUNAS de nível superior de cada `.select("a,b,c")`, quando o alvo é
 *     uma TABELA conhecida.
 *
 * ─── O QUE ELE NÃO COBRE, E É DECLARADO EM VEZ DE DISFARÇADO ────────────
 *
 * Teste que promete demais é pior que teste honesto sobre o próprio alcance.
 * Fora de alcance, de propósito:
 *
 *   1. `.from(variavel)` — nome montado em tempo de execução (Ajustes exporta
 *      dados varrendo uma lista de tabelas). São contados e reportados; não dá
 *      para resolvê-los lendo o fonte, e fingir que dá seria pior.
 *   2. EMBEDS do PostgREST (`group_members(user_id, name)`), ALIASES
 *      (`nome:name`), caminhos de json (`payload->>kg`), casts (`col::text`) e
 *      `*`. São reconhecidos e PULADOS na checagem de coluna — o embed vira
 *      uma junção cujo dono é outra tabela, e resolver isso direito exige
 *      conhecer as FKs. Melhor não checar do que checar errado.
 *   3. COLUNAS DE VIEW. O corpo de uma view é um `select` arbitrário; deduzir
 *      as colunas dele exige um parser de SQL. Views são checadas como
 *      EXISTINDO, nunca por coluna.
 *   4. FILTROS — `.eq()`, `.order()`, `.gte()` também citam coluna, e não
 *      entram aqui. É a próxima fatia óbvia, e a deixo escrita em vez de
 *      esquecida.
 *   5. OUTROS SCHEMAS — `auth.users` é do Supabase (GoTrue), `storage.*` é do
 *      Storage. Nada fora de `public` é criado por este repositório, então
 *      nada fora de `public` pode ser conferido contra ele.
 *   6. As EDGE FUNCTIONS (Deno) fazem as mesmas chamadas e não são varridas
 *      aqui: a tarefa pediu `src/`. Mesmo extrator serve, e fica registrado.
 *
 * ─── E POR QUE NÃO EXISTE ALLOWLIST ─────────────────────────────────────
 *
 * Se este teste acusar algo que EXISTE, o defeito é dele — e o conserto é
 * ensiná-lo a enxergar, nunca abrir exceção. Foi assim que ele nasceu certo:
 * a primeira versão acusou `whatsapp_links` e `claim_goal_bonuses`, que
 * existem — em `supabase/whatsapp_e_metas.sql`, um arquivo de schema fora de
 * `migrations/` que o varredor não lia. A correção foi ler todos os `.sql` de
 * `supabase/`, não criar uma exceção para os dois nomes.
 *
 * `supabase/tests/` fica FORA da varredura, e isso é o mesmo princípio pelo
 * avesso: aquelas fixtures criam objetos que não existem em produção
 * (`auth.users`, `_r`). Contá-las seria uma allowlist entrando pela porta dos
 * fundos, com cara de cobertura.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* ═══ Leitura dos arquivos ════════════════════════════════════════════ */

function walk(dir: string, keep: (p: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

const semComentariosTs = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const semComentariosSql = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

/** Todo schema que ESTE repositório aplica. `supabase/tests/` fora: ver o topo. */
const ARQUIVOS_SQL = walk("supabase", (p) => p.endsWith(".sql") && !p.includes(`${"tests"}/`));
/** Todo fonte do app, fora os testes. */
const ARQUIVOS_TS = walk("src", (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p));

/* ═══ O que o SQL CRIA ════════════════════════════════════════════════ */

interface Schema {
  tabelas: Set<string>;
  views: Set<string>;
  funcoes: Set<string>;
  colunas: Map<string, Set<string>>;
}

function lerSchema(): Schema {
  const tabelas = new Set<string>(), views = new Set<string>(), funcoes = new Set<string>();
  const colunas = new Map<string, Set<string>>();
  const addCol = (t: string, c: string) => {
    if (!colunas.has(t)) colunas.set(t, new Set());
    colunas.get(t)!.add(c);
  };

  for (const arquivo of ARQUIVOS_SQL) {
    const sql = semComentariosSql(readFileSync(arquivo, "utf8"));

    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)/gi,
    )) views.add(m[1].toLowerCase());

    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi,
    )) funcoes.add(m[1].toLowerCase());

    // Coluna acrescentada depois: o `alter` conta tanto quanto o `create`.
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)/gi,
    )) { tabelas.add(m[1].toLowerCase()); addCol(m[1].toLowerCase(), m[2].toLowerCase()); }

    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const nome = m[1].toLowerCase();
      tabelas.add(nome);
      // Corpo da tabela: casa os parênteses para não parar num `numeric(10,2)`.
      let i = re.lastIndex, prof = 1;
      while (i < sql.length && prof > 0) {
        if (sql[i] === "(") prof++; else if (sql[i] === ")") prof--;
        i++;
      }
      const corpo = sql.slice(re.lastIndex, i - 1);
      let d = 0, atual = "";
      const partes: string[] = [];
      for (const ch of corpo) {
        if (ch === "(") d++;
        if (ch === ")") d--;
        if (ch === "," && d === 0) { partes.push(atual); atual = ""; } else atual += ch;
      }
      partes.push(atual);
      for (const parte of partes) {
        const t = parte.trim();
        // Restrições de tabela não são colunas.
        if (!t || /^(primary|unique|foreign|constraint|check|exclude|like)\b/i.test(t)) continue;
        const c = /^"?([a-z_0-9]+)"?\s/i.exec(t);
        if (c) addCol(nome, c[1].toLowerCase());
      }
    }
  }
  return { tabelas, views, funcoes, colunas };
}

const schema = lerSchema();

/* ═══ O que o FRONT chama ═════════════════════════════════════════════ */

interface Chamada {
  tipo: "tabela" | "funcao";
  nome: string;
  arquivo: string;
  linha: number;
  select?: string;
}

function lerChamadas(): { chamadas: Chamada[]; dinamicas: string[] } {
  const chamadas: Chamada[] = [];
  const dinamicas: string[] = [];

  for (const arquivo of ARQUIVOS_TS) {
    const texto = semComentariosTs(readFileSync(arquivo, "utf8"));
    const linhaDe = (i: number) => texto.slice(0, i).split("\n").length;

    for (const m of texto.matchAll(/\.from\(\s*(["'`])([a-z_0-9]+)\1/gi)) {
      /* O `.select()` desta chamada é o primeiro que aparece ANTES do próximo
         `.from(` — a cadeia do supabase-js pode quebrar em várias linhas, com
         `.eq()` e `.order()` no meio. */
      const resto = texto.slice(m.index! + m[0].length);
      const proximo = resto.search(/\.from\(/);
      const janela = proximo === -1 ? resto : resto.slice(0, proximo);
      const sel = /\.select\(\s*(["'`])([\s\S]*?)\1/.exec(janela);
      chamadas.push({
        tipo: "tabela", nome: m[2].toLowerCase(), arquivo,
        linha: linhaDe(m.index!), select: sel?.[2],
      });
    }

    for (const m of texto.matchAll(/\.rpc\(\s*(["'`])([a-z_0-9]+)\1/gi)) {
      chamadas.push({ tipo: "funcao", nome: m[2].toLowerCase(), arquivo, linha: linhaDe(m.index!) });
    }

    // `Array.from({...})` não é consulta; `supabase.from(variavel)` é, e não
    // dá para resolver lendo o fonte.
    for (const m of texto.matchAll(/(\w+)\.from\(\s*([a-zA-Z_][a-zA-Z_0-9]*)\s*[,)]/g)) {
      if (m[1] !== "Array") dinamicas.push(`${arquivo}:${linhaDe(m.index!)}`);
    }
  }
  return { chamadas, dinamicas };
}

const { chamadas, dinamicas } = lerChamadas();

/* ═══ "Talvez você quisesse…" ═════════════════════════════════════════
   Erro que SUGERE conserta em segundos; erro que só acusa custa uma sessão de
   investigação. É o que o próprio PostgREST faz na mensagem do PGRST205. */

function distancia(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1, d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[a.length][b.length];
}

export function maisProximo(alvo: string, candidatos: Iterable<string>): string | null {
  let melhor: string | null = null, menor = Infinity;
  for (const c of candidatos) {
    const dist = distancia(alvo, c);
    if (dist < menor) { menor = dist; melhor = c; }
  }
  // Longe demais não é sugestão, é chute — e chute errado atrapalha mais.
  const teto = Math.max(3, Math.floor(alvo.length * 0.5));
  return melhor && menor <= teto ? melhor : null;
}

const sugestao = (alvo: string, universo: Iterable<string>) => {
  const p = maisProximo(alvo, universo);
  return p ? ` — talvez você quisesse "${p}"` : "";
};

/* ═══ As colunas de um `.select()` ════════════════════════════════════ */

/** Colunas de nível superior que dá para conferir com confiança. Tudo que for
 *  embed, alias, caminho de json, cast ou `*` sai fora — ver o topo. */
export function colunasConferiveis(select: string): string[] {
  const out: string[] = [];
  let prof = 0, atual = "";
  const partes: string[] = [];
  for (const ch of select) {
    if (ch === "(") prof++;
    if (ch === ")") prof--;
    if (ch === "," && prof === 0) { partes.push(atual); atual = ""; } else atual += ch;
  }
  partes.push(atual);

  for (const parte of partes) {
    const t = parte.trim();
    if (!t) continue;
    if (/[(:.>!*]|::|\s/.test(t)) continue;   // embed, alias, json, cast, curinga
    if (/^[a-z_][a-z_0-9]*$/i.test(t)) out.push(t.toLowerCase());
  }
  return out;
};

/* ═══ Os testes ═══════════════════════════════════════════════════════ */

describe("o varredor enxerga o repositório — senão ele passa sem olhar", () => {
  /* Guarda contra o no-op silencioso. Um varredor que para de achar arquivos
     reporta zero problemas, e zero problemas de zero leituras é o relatório que
     tranquiliza sem provar nada. */
  it("achou o schema e as chamadas", () => {
    expect(ARQUIVOS_SQL.length, "não achei os arquivos de schema").toBeGreaterThan(20);
    expect(ARQUIVOS_TS.length, "não achei os fontes do app").toBeGreaterThan(50);
    expect(schema.tabelas.size, "não extraí tabela nenhuma").toBeGreaterThan(30);
    expect(schema.funcoes.size, "não extraí função nenhuma").toBeGreaterThan(30);
    expect(chamadas.length, "não extraí chamada nenhuma").toBeGreaterThan(100);
  });

  it("lê TODO schema que este repositório aplica, não só as migrations", () => {
    /* A primeira versão lia só `setup.sql` + `migrations/` e acusou
       `whatsapp_links`, que existe em `supabase/whatsapp_e_metas.sql`. O
       conserto foi ensinar o teste a ver, não abrir exceção. */
    expect(ARQUIVOS_SQL).toContain("supabase/setup.sql");
    expect(ARQUIVOS_SQL).toContain("supabase/whatsapp_e_metas.sql");
    expect(schema.tabelas.has("whatsapp_links")).toBe(true);
    expect(schema.funcoes.has("claim_goal_bonuses")).toBe(true);
  });

  it("NÃO conta as fixtures de teste como schema de produção", () => {
    // `supabase/tests/_stub_auth.sql` cria `auth.users` só para o cluster
    // descartável. Contar isso seria uma allowlist disfarçada de cobertura.
    expect(ARQUIVOS_SQL.some((f) => f.includes("tests/"))).toBe(false);
  });
});

describe("toda tabela e função que o front chama EXISTE no banco", () => {
  it("nenhuma chamada aponta para objeto que o SQL não cria", () => {
    const quebradas = chamadas.filter((c) =>
      c.tipo === "funcao"
        ? !schema.funcoes.has(c.nome)
        : !schema.tabelas.has(c.nome) && !schema.views.has(c.nome));

    const universo = (c: Chamada) =>
      c.tipo === "funcao" ? schema.funcoes : [...schema.tabelas, ...schema.views];

    const linhas = quebradas.map((c) =>
      `${c.arquivo}:${c.linha}  ${c.tipo} "${c.nome}"${sugestao(c.nome, universo(c))}`);

    expect(
      linhas,
      "O front chama o que o banco não tem. Em produção isto é PGRST205 na cara " +
      `da pessoa, e nenhum outro teste pega:\n  ${linhas.join("\n  ")}\n`,
    ).toEqual([]);
  });
});

describe("toda coluna pedida num select EXISTE na tabela", () => {
  it("nenhum select pede coluna que a tabela não tem", () => {
    /* Tabela certa com coluna errada quebra igual — e quebra mais tarde, porque
       a consulta sai e o erro chega no lugar onde o dado seria usado. */
    const problemas: string[] = [];
    let conferidas = 0;

    for (const c of chamadas) {
      if (c.tipo !== "tabela" || !c.select) continue;
      // View não tem coluna extraível: o corpo é um select arbitrário.
      if (!schema.tabelas.has(c.nome)) continue;
      const declaradas = schema.colunas.get(c.nome);
      if (!declaradas?.size) continue;

      for (const col of colunasConferiveis(c.select)) {
        conferidas++;
        if (!declaradas.has(col)) {
          problemas.push(
            `${c.arquivo}:${c.linha}  ${c.nome}.${col}${sugestao(col, declaradas)}`,
          );
        }
      }
    }

    expect(conferidas, "não conferi coluna nenhuma — o extrator de select quebrou")
      .toBeGreaterThan(50);
    expect(
      problemas,
      `Select pedindo coluna que não existe:\n  ${problemas.join("\n  ")}\n`,
    ).toEqual([]);
  });
});

describe("o alcance do teste é declarado, não disfarçado", () => {
  it("as chamadas dinâmicas são contadas e ficam à vista", () => {
    /* `supabase.from(variavel)`: Ajustes exporta os dados da pessoa varrendo
       uma lista de tabelas em tempo de execução. Não dá para resolver lendo o
       fonte. Ficam contadas aqui para que o número não cresça em silêncio — se
       um dia passar de uma dúzia, o padrão virou comum e merece outra defesa. */
    expect(dinamicas.length, `chamadas dinâmicas:\n  ${dinamicas.join("\n  ")}`)
      .toBeLessThanOrEqual(12);
  });

  it("a sugestão do nome mais próximo funciona — é ela que faz a falha ser útil", () => {
    expect(maisProximo("group_feed", ["group_notes", "profiles"])).toBe("group_notes");
    expect(maisProximo("group_reactions", ["group_recognitions", "plans"]))
      .toBe("group_recognitions");
    // Longe demais não vira chute.
    expect(maisProximo("zzzzzzzzzzzz", ["profiles", "plans"])).toBeNull();
  });

  it("o extrator de colunas pula o que ele não sabe conferir", () => {
    expect(colunasConferiveis("id,name,pillar")).toEqual(["id", "name", "pillar"]);
    expect(colunasConferiveis("*")).toEqual([]);
    expect(colunasConferiveis("id, group_members(user_id, name)")).toEqual(["id"]);
    expect(colunasConferiveis("nome:name")).toEqual([]);
    expect(colunasConferiveis("payload->>kg")).toEqual([]);
    expect(colunasConferiveis("id, count:challenges(count)")).toEqual(["id"]);
  });
});
