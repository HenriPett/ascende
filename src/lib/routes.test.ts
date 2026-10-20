// ASCENDE — A rede de segurança das rotas (Fase 4).
//
// O QUE ESTE ARQUIVO IMPEDE
//
// A Fase 4 move Pilares e Indicadores para dentro do hub /app/jornada. O erro
// natural é aposentar as rotas antigas ou apontá-las para o hub. Um link de
// /app/prosperidade enviado num grupo de WhatsApp em julho NÃO AVISA quando
// para de funcionar: a pessoa clica, cai num hub, não acha o que o link
// prometeu e desiste. É a falha mais barata de introduzir e a mais cara de
// descobrir, porque só aparece por reclamação.
//
// Então aqui a lista de rotas antigas é ESCRITA À MÃO (FROZEN_LEGACY_PATHS) e
// conferida contra o que o app realmente resolve, via matchRoutes — o mesmo
// matcher do react-router em produção, não uma imitação.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { matchRoutes, Navigate, type RouteObject } from "react-router-dom";
import {
  APP_ROUTES, FROZEN_LEGACY_PATHS, EXTERNALLY_LINKED, QUERY_DEPENDENT,
  FROZEN_EXTERNAL_PUBLIC_PATHS, NAV, APP_BASE, appPath,
} from "@/lib/routes";
import { isPublicPath } from "@/lib/analytics";
import { lerRegras, resolver } from "@/prerender/netlify";

/**
 * Espelha EXATAMENTE como o App.tsx monta as rotas de /app: um pai "/app" com
 * um filho por entrada da tabela, e `index` para o subcaminho vazio. O `id` é o
 * nome da página, então o teste consegue afirmar QUAL tela cada endereço abre.
 */
const routes: RouteObject[] = [{
  path: APP_BASE,
  id: "app",
  children: APP_ROUTES.map(({ path, page }) =>
    path === "" ? { index: true, id: page } : { path, id: page }),
}];

/** Página que o app abre para um endereço, ou null se o endereço não resolve. */
function pageFor(url: string): string | null {
  const matched = matchRoutes(routes, url);
  if (!matched?.length) return null;
  return String(matched[matched.length - 1].route.id ?? "");
}

const appSource = readFileSync("src/App.tsx", "utf8");

/* ═══ A garantia da fase ═══════════════════════════════════════════════ */

describe("nenhuma rota de /app pode sumir", () => {
  it("toda rota anterior à Fase 4 continua na tabela", () => {
    const naTabela = APP_ROUTES.map((r) => r.path);
    for (const legado of FROZEN_LEGACY_PATHS) {
      expect(naTabela, `a rota ${appPath(legado)} desapareceu da tabela`).toContain(legado);
    }
  });

  it("toda rota anterior à Fase 4 ainda RESOLVE para uma tela", () => {
    for (const legado of FROZEN_LEGACY_PATHS) {
      const url = appPath(legado);
      expect(pageFor(url), `${url} deixou de resolver`).toBeTruthy();
    }
  });

  it.each([...FROZEN_LEGACY_PATHS])("/app/%s abre a mesma tela de sempre", (sub) => {
    // O par endereço → tela é o contrato com o mundo externo. Mudar qualquer
    // linha desta expectativa é mudar para onde um link já enviado leva.
    const esperado: Record<string, string> = {
      "": "Hoje",
      conselheiro: "Chat",
      pilares: "Pilares",
      prosperidade: "Prosperidade",
      vitalidade: "Vitalidade",
      alimentacao: "Alimentacao",
      mente: "Mente",
      batalhas: "Batalhas",
      assinatura: "Assinatura",
      planos: "Planos",
      score: "Score",
      ajustes: "Ajustes",
    };
    expect(pageFor(appPath(sub))).toBe(esperado[sub]);
  });

  it("nenhuma rota de /app é um redirecionador", () => {
    // ALIAS NÃO É REDIRECT: /app/prosperidade RENDERIZA Prosperidade.
    for (const r of APP_ROUTES) {
      expect(r.Component, `${appPath(r.path)} virou <Navigate>`).not.toBe(Navigate);
      // Componente carregado sob demanda (lazy), não um redirecionador.
      expect(typeof r.Component, `${appPath(r.path)} não é uma página`).toBe("object");
    }
  });

  it("o App.tsx monta as rotas a partir da tabela (a tabela é a verdade)", () => {
    // Sem isto, alguém poderia deixar a tabela intacta e escrever <Route> à
    // mão no App.tsx: o teste ficaria verde medindo algo que não é usado.
    expect(appSource).toContain("APP_ROUTES");
    expect(appSource).toMatch(/APP_ROUTES\.map/);
  });

  it("o bloco de /app do App.tsx não tem nenhum <Navigate>", () => {
    const inicio = appSource.indexOf('path="/app"');
    expect(inicio).toBeGreaterThan(-1);
    // Só o CÓDIGO: o comentário do próprio bloco cita `<Navigate>` justamente
    // para dizer que ele é proibido ali, e não pode disparar o alarme.
    const bloco = appSource
      .slice(inicio, appSource.indexOf('path="*"'))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // Os dois <Navigate> legítimos do arquivo (RequireAuth e RequireOnboarded)
    // ficam ACIMA deste bloco: são guardas de sessão, não alias de rota.
    expect(bloco).not.toContain("<Navigate");
  });

  it("TODA rota da tabela resolve — não só as congeladas", () => {
    /* O buraco que deixou /app/social nascer morto: a garantia de resolução
       existia só para FROZEN_LEGACY_PATHS, e rota NOVA não entra nessa lista
       (ela é dos caminhos anteriores à Fase 4, copiada à mão para que remover
       doa). Resultado: uma entrada nova podia ficar meses sem nenhuma prova de
       que abre alguma coisa — ou, como aconteceu, nem ser escrita.
       Isto cobre a tabela INTEIRA, para sempre, sem lista para manter. */
    for (const r of APP_ROUTES) {
      const url = appPath(r.path);
      expect(pageFor(url), `${url} está na tabela e NÃO RESOLVE`).toBe(r.page);
    }
  });

  it("todo `page` é único — o teste compara contra rótulo, e rótulo repetido confunde", () => {
    const pages = APP_ROUTES.map((r) => r.page);
    expect(new Set(pages).size, `rótulos repetidos: ${pages.join(", ")}`).toBe(pages.length);
  });

  it("não há caminho duplicado (duas telas disputando o mesmo endereço)", () => {
    const paths = APP_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

/* ═══ Todo link do app aponta para algum lugar ════════════════════════ */

describe("nenhum link do app leva a 404", () => {
  /* O ACHADO QUE ORIGINOU ESTE BLOCO (18/09/2026): o cartão do Social em
     Pilares.tsx e a linha do hub em Jornada.tsx apontavam para /app/social, e
     a rota não existia. Ninguém errou de propósito — quem fez a tela achou que
     a rota vinha junto, quem cuidava das rotas não soube que havia tela nova.
     Só apareceu porque uma pessoa CLICOU.

     Nenhum teste podia pegar isso, porque nenhum olhava para a ponta de lá: os
     testes provavam que as rotas existiam, nunca que os LINKS chegavam a
     alguma. Este olha. É a varredura que fecha o vão entre quem escreve tela e
     quem escreve rota — que é onde este tipo de buraco mora sempre. */

  /** Todo arquivo de src, menos os testes. */
  function fontesDoApp(dir = "src", out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const caminho = join(dir, entry);
      if (statSync(caminho).isDirectory()) { fontesDoApp(caminho, out); continue; }
      if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(caminho);
    }
    return out;
  }

  /** Comentários fora: este arquivo e o routes.ts CITAM caminhos para explicar
   *  regras, e explicar não pode reprovar. */
  const semComentarios = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  /** Os destinos que o app monta: literais "/app/..." e chamadas appPath("..."). */
  function destinosDe(fonte: string): string[] {
    const texto = semComentarios(fonte);
    const literais = [...texto.matchAll(/["'`](\/app(?:\/[a-z0-9-]*)?)(?:[?#][^"'`]*)?["'`]/g)]
      .map((m) => m[1]);
    const porHelper = [...texto.matchAll(/appPath\(\s*["']([a-z0-9-]*)["']\s*\)/g)]
      .map((m) => appPath(m[1]));
    return [...literais, ...porHelper];
  }

  it("todo destino /app montado no código resolve para uma tela", () => {
    const quebrados: string[] = [];
    let conferidos = 0;
    for (const arquivo of fontesDoApp()) {
      for (const destino of destinosDe(readFileSync(arquivo, "utf8"))) {
        conferidos++;
        if (!pageFor(destino)) quebrados.push(`${destino}  ← ${arquivo}`);
      }
    }
    // Guarda contra o no-op: se o varredor parar de achar destinos, ele passa
    // sem olhar nada — e um teste que tranquiliza sem provar é pior que nenhum.
    expect(conferidos, "o varredor não achou destino nenhum; a regex quebrou")
      .toBeGreaterThan(10);
    expect(quebrados, `Links para rota inexistente:\n  ${quebrados.join("\n  ")}`).toEqual([]);
  });
});

/* ═══ Query string e hash ══════════════════════════════════════════════ */

describe("query string e hash preservados", () => {
  it.each([...FROZEN_LEGACY_PATHS])("/app/%s resolve igual com ?query e #hash", (sub) => {
    const limpo = appPath(sub);
    const comExtras = `${limpo}?a=1&b=dois%20tr%C3%AAs#uma-secao`;
    expect(pageFor(comExtras)).toBe(pageFor(limpo));
  });

  it("a query que a tela CONSOME sobrevive ao roteamento", () => {
    // /app/conselheiro?q=... pré-preenche a pergunta (Chat.tsx). Um redirect
    // para o hub descartaria o ?q e quebraria a FUNÇÃO, não só o endereço:
    // a pessoa chegaria numa conversa vazia sem saber o que se perdeu.
    const pergunta = "Analisa meus gastos recentes: onde estou gastando mais?";
    const url = `${appPath("conselheiro")}?q=${encodeURIComponent(pergunta)}`;
    expect(pageFor(url)).toBe("Chat");
    expect(new URL(url, "https://ascende.site").searchParams.get("q")).toBe(pergunta);
  });

  it("o status que o Stripe devolve sobrevive ao roteamento", () => {
    for (const status of ["sucesso", "cancelado"]) {
      const url = `${appPath("assinatura")}?status=${status}`;
      expect(pageFor(url)).toBe("Assinatura");
      expect(new URL(url, "https://ascende.site").searchParams.get("status")).toBe(status);
    }
  });

  it("o link de CONVITE do Social resolve com a query que ele carrega", () => {
    /* O convite é a única porta de entrada do Social (C6: sem descoberta
       pública, só convite direto), e ele viaja FORA do app — a pessoa manda o
       link para um amigo por WhatsApp. Social.tsx:501 monta
       `${origin}/app/social?convite=<código>`, e o grupo aberto vive em `?g=`.
       Se o caminho parar de resolver, não quebra uma tela: quebra todo convite
       já enviado, e quem recebeu não tem como saber o que era.

       NOTA DE DÍVIDA, e ela é real: `social` NÃO está em QUERY_DEPENDENT nem em
       EXTERNALLY_LINKED, embora seja as duas coisas. Os dois registros exigem
       que a chave esteja em FROZEN_LEGACY_PATHS, que é a lista dos caminhos
       ANTERIORES à Fase 4 — rota nova não cabe lá, e forçar seria mentir sobre
       a procedência. Enquanto os registros não souberem expressar "nova E
       linkada de fora", esta asserção é a cobertura. */
    const comConvite = `${appPath("social")}?convite=ABC123`;
    const comGrupo = `${appPath("social")}?g=7f3e`;
    expect(pageFor(comConvite), "o link de convite deixou de resolver").toBe("Social");
    expect(pageFor(comGrupo)).toBe("Social");
    expect(new URL(comConvite, "https://ascende.site").searchParams.get("convite")).toBe("ABC123");
  });

  it("toda rota marcada como dependente de query está entre as congeladas", () => {
    for (const sub of Object.keys(QUERY_DEPENDENT)) {
      expect(FROZEN_LEGACY_PATHS, `${appPath(sub)} usa query e não está congelada`)
        .toContain(sub);
    }
  });
});

/* ═══ Links montados à mão fora da SPA ════════════════════════════════ */

describe("rotas linkadas de fora (WhatsApp, PWA, Stripe)", () => {
  // Um teste POR ROTA, e a mensagem de erro diz de onde saem os links. Se
  // alguém apagar /app/vitalidade daqui a um ano, a falha não diz "rota
  // faltando": diz que o WhatsApp manda gente para lá, na linha 602.
  it.each(Object.entries(EXTERNALLY_LINKED))(
    "/app/%s é linkada de fora e continua viva",
    (sub, origens) => {
      const onde = `\n  Links já enviados apontam para cá:\n${origens.map((o) => `   · ${o}`).join("\n")}`;
      expect(pageFor(appPath(sub)), `${appPath(sub)} NÃO RESOLVE MAIS.${onde}`).toBeTruthy();
      expect(FROZEN_LEGACY_PATHS, `${appPath(sub)} saiu das congeladas.${onde}`).toContain(sub);
    },
  );

  it("as duas que o hub fará parecer redundantes seguem intactas", () => {
    // Alerta registrado pelo fundador: são o alvo natural de quem simplificar
    // depois, e as que o WhatsApp cita por nome.
    expect(pageFor("/app/prosperidade"), "o WhatsApp manda a fatura para cá (webhook:582)")
      .toBe("Prosperidade");
    expect(pageFor("/app/vitalidade"), "o WhatsApp manda a composição corporal para cá (webhook:602)")
      .toBe("Vitalidade");
  });

  it("cada entrada do inventário diz ONDE o link é montado", () => {
    // Inventário sem procedência não serve para decidir risco.
    for (const [sub, lugares] of Object.entries(EXTERNALLY_LINKED)) {
      expect(lugares.length, `${appPath(sub)} está no inventário sem origem`).toBeGreaterThan(0);
      for (const lugar of lugares) expect(lugar).toMatch(/^supabase\/|^public\/|^src\//);
    }
  });

  it("o manifesto do PWA continua apontando para uma rota que existe", () => {
    const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    // start_url é o que abre no celular de quem já instalou o app.
    expect(pageFor(manifest.start_url)).toBeTruthy();
    for (const atalho of manifest.shortcuts ?? []) {
      expect(pageFor(atalho.url), `atalho "${atalho.name}" aponta para rota morta`).toBeTruthy();
    }
  });

  it("as URLs de retorno do Stripe apontam para rota que existe", () => {
    // Estão gravadas dentro de sessões e da configuração do portal: mudar o
    // caminho aqui deixa quem está pagando numa tela 404 depois de pagar.
    const checkout = readFileSync("supabase/functions/create-checkout/index.ts", "utf8");
    const portal = readFileSync("supabase/functions/customer-portal/index.ts", "utf8");
    const encontrados = [...`${checkout}\n${portal}`.matchAll(/\$\{origin\}(\/app[\w/-]*)/g)]
      .map((m) => m[1]);
    expect(encontrados.length).toBeGreaterThan(0);
    for (const rota of new Set(encontrados)) {
      expect(pageFor(rota), `${rota} é URL de retorno do Stripe e não resolve`).toBeTruthy();
    }
  });

  it("as rotas citadas nas mensagens do WhatsApp existem", () => {
    const webhook = readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf8");
    const citadas = [...webhook.matchAll(/\$\{url\}(\/app[\w/-]*)/g)].map((m) => m[1]);
    expect(citadas.length).toBeGreaterThan(0);
    for (const rota of new Set(citadas)) {
      expect(pageFor(rota), `o WhatsApp manda ${rota}, que não resolve`).toBeTruthy();
    }
  });
});

describe("alvos da barra", () => {
  it("todo alvo de NAV resolve para uma tela (a barra não escreve caminho à mão)", () => {
    for (const [nome, rota] of Object.entries(NAV)) {
      expect(pageFor(rota), `NAV.${nome} aponta para ${rota}, que não resolve`).toBeTruthy();
    }
  });
});

/* ═══ Achados fora de /app, mesmo risco ══════════════════════════════ */

describe("links externos que não são /app", () => {
  it("o fallback de SPA da CDN cobre todo deep link de /app (sem ele, o React nem roda)", () => {
    // Sem o catch-all de antes, /app/* tem regra própria para o shell, 200.
    // Se alguém trocar por 301 ou remover, a pessoa recebe 404 do Netlify em
    // /app/prosperidade — quebra mais que qualquer rota individual, e de uma
    // vez. As rotas de topo são conferidas em src/prerender/rotas.test.ts.
    const regras = lerRegras(readFileSync("netlify.toml", "utf8"));
    const arquivos = new Set(["index.html", "app-shell.html", "404.html"]);
    for (const r of APP_ROUTES) {
      const url = r.path === "" ? "/app" : `/app/${r.path.replace(/:[^/]+/g, "x").replace(/\*$/, "x")}`;
      const res = resolver(url, regras, arquivos);
      expect(res.tipo === "regra" && res.regra.to, url).toBe("/app-shell.html");
      expect(res.status, url).toBe(200);
    }
  });

  it("os templates aprovados pela Meta apontam para rota que existe", () => {
    // O botão de URL vive dentro do template aprovado: trocar o caminho exige
    // nova aprovação da Meta, e as mensagens já enviadas ficam com o antigo.
    const sql = readFileSync("supabase/whatsapp_e_metas.sql", "utf8");
    const botoes = [...sql.matchAll(/Bot[ãa]o URL\s*→\s*https:\/\/[^/\s]+(\/app[\w/-]*)/g)]
      .map((m) => m[1]);
    expect(botoes.length, "os templates da Meta sumiram da documentação").toBe(3);
    for (const rota of new Set(botoes)) {
      expect(pageFor(rota), `template da Meta manda para ${rota}, que não resolve`).toBeTruthy();
    }
  });

  it("as rotas que viajam em e-mail continuam declaradas no App.tsx", () => {
    // Link de recuperação de senha é o link velho por definição: a pessoa
    // clica dias depois. Estas rotas são de topo, então a conferência é pela
    // fonte do App.tsx (elas não passam pela tabela de /app).
    for (const rota of Object.keys(FROZEN_EXTERNAL_PUBLIC_PATHS)) {
      expect(appSource, `${rota} viaja em e-mail e saiu do App.tsx`)
        .toContain(`path="${rota}"`);
    }
  });

  it("cada rota de e-mail diz de onde o link sai", () => {
    for (const [rota, lugares] of Object.entries(FROZEN_EXTERNAL_PUBLIC_PATHS)) {
      expect(lugares.length, `${rota} está no inventário sem origem`).toBeGreaterThan(0);
      for (const lugar of lugares) expect(lugar).toMatch(/^src\/|^supabase\//);
    }
  });
});

/* ═══ A rota nova ══════════════════════════════════════════════════════ */

describe("/app/jornada", () => {
  it("existe e abre a Jornada", () => {
    expect(pageFor("/app/jornada")).toBe("Jornada");
  });

  it("é adição, não substituição: as duas rotas que ela agrupa seguem inteiras", () => {
    // Pilares e Indicadores saem da BARRA, não do endereçamento.
    expect(pageFor("/app/pilares")).toBe("Pilares");
    expect(pageFor("/app/score")).toBe("Score");
  });

  it("não é marcada como legada (nasceu na Fase 4)", () => {
    expect(APP_ROUTES.find((r) => r.path === "jornada")?.since).toBe("fase-4");
    expect(FROZEN_LEGACY_PATHS).not.toContain("jornada");
  });
});

/* ═══ Invariante de privacidade ════════════════════════════════════════ */

describe("privacidade", () => {
  it("nenhuma rota de /app é tratada como página pública", () => {
    // A gravação de sessão (Clarity) só vale na área pública: /app tem
    // finanças, exames, diário e conversa com o Conselheiro. Rota nova não
    // pode entrar na telemetria por descuido.
    for (const r of APP_ROUTES) {
      expect(isPublicPath(appPath(r.path)), `${appPath(r.path)} virou pública`).toBe(false);
    }
  });
});
