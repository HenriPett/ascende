/* ASCENDE — As regras do Social que dependem da ARQUITETURA, não do cálculo.
 *
 * Mesmo desenho do teste de isolamento do espelho, e pelo mesmo motivo escrito
 * lá: "regra que depende de alguém lembrar é regra que uma refatoração apaga
 * sem ninguém ver". As regras abaixo NÃO são calculáveis — elas são
 * propriedades da forma como o Social está ligado ao resto do app, e por isso
 * só um teste que LÊ O CÓDIGO consegue travá-las:
 *
 *   N3  batalhas nunca entram no Social, em forma nenhuma. O parecer do Fiel
 *       escreve o teste: "o módulo que calcula qualquer valor compartilhável
 *       NÃO PODE importar de lib/battles". Um import é exatamente o tipo de
 *       coisa que teste de unidade não pega — o valor sai certo, e a porta fica
 *       aberta para o próximo que for "só reaproveitar a contagem de dias".
 *   C8  Social não pontua no Score nem gera XP. Entrar em grupo, postar, apoiar
 *       e subir no placar valem ZERO.
 *   —   e a recíproca, que é a que garante o C8 de verdade: nenhum módulo de
 *       CÁLCULO do app pode conhecer o Social. Se o XP, os insights ou o Score
 *       souberem que grupos existem, o Social deixou de ser opcional.
 *   RLS a service role passa por cima de TODA política de RLS. As ~35
 *       políticas da Aduana, e as quatro revogações que ela provou num
 *       Postgres local, são anuladas inteiras por UM caminho de leitura que
 *       use a chave de serviço — e anuladas sem deixar rastro, porque a
 *       consulta FUNCIONA. Ela classificou isso como "regra de revisão de
 *       código, não de banco"; nesta base, regra de revisão que depende de
 *       alguém lembrar é regra que uma refatoração apaga.
 *
 * O QUE ESTE ARQUIVO DELIBERADAMENTE NÃO AFIRMA: que ninguém no app menciona o
 * Social. Ele vai ter tela, rota e cartão — afirmar o contrário seria afirmar
 * que o recurso nunca sai. O que se trava é a DIREÇÃO: cálculo não conhece
 * Social, e Social não conhece batalha, dinheiro nem XP.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Os arquivos que SÃO o Social nesta rodada (a camada de cálculo puro).
 *  As telas do Pixel entram na lista quando existirem — e entrar na lista é a
 *  decisão, que é justamente o ponto: nada se liga ao Social por acidente. */
const SOCIAL_FILES = [
  "src/lib/socialMetrics.ts",
  "src/lib/socialMetrics.test.ts",
  "src/lib/socialChallenge.ts",
  "src/lib/socialChallenge.test.ts",
  "src/lib/socialSemana.ts",
  "src/lib/socialSemana.test.ts",
  "src/lib/socialConvite.ts",
  "src/lib/socialConvite.test.ts",
  "src/lib/socialNotifications.ts",
  "src/lib/socialNotifications.test.ts",
  "src/lib/socialIsolation.test.ts",
  "src/lib/socialCatalogMirror.test.ts",
];

/** A ÚNICA porta de cliente Supabase do app: a chave anônima, presa à sessão
 *  da pessoa, que é o que faz a RLS valer. */
const PORTA_DO_CLIENTE = "src/integrations/supabase/client.ts";

/**
 * Pontos de integração que PODEM passar por cima da RLS, com o motivo escrito.
 *
 * HOJE ESTÁ VAZIA, e isso é um fato do desenho, não um esquecimento: nenhum
 * caminho do Social precisa de service role. O grupo lê PROJEÇÃO, e a projeção
 * é escrita por gatilho do banco — a leitura da pessoa cabe inteira dentro das
 * políticas dela.
 *
 * Se um dia entrar alguma coisa aqui, a pergunta que a revisão tem de fazer
 * NÃO é "adiciono na lista?". É: POR QUE ESTE CAMINHO PRECISA PASSAR POR CIMA
 * DA RLS? Se a resposta for "porque é mais simples", a resposta é não — a
 * simplicidade está sendo comprada com a única defesa que o Social tem.
 */
const PODEM_USAR_SERVICE_ROLE: { arquivo: string; porque: string }[] = [];

/** Este arquivo. Ele ENUNCIA a proibição — os padrões proibidos aparecem no
 *  código dele, não em comentário, e `stripComments` não tem como saber a
 *  diferença. Quem define a regra não pode ser acusado por ela; qualquer outro
 *  arquivo, inclusive teste, é acusado. */
const DEFINIDOR_DA_REGRA = "src/lib/socialIsolation.test.ts";

/** O que o Social NÃO pode importar, com o motivo. A lista é curta de
 *  propósito: cada linha é uma condição do parecer, não uma preferência. */
const IMPORTS_PROIBIDOS: [RegExp, string][] = [
  [/@\/lib\/battles/, "N3 — batalhas nunca entram no Social, em forma nenhuma"],
  [/@\/lib\/xp\b/, "C8 — Social não gera XP: entrar, postar, apoiar e subir no placar valem zero"],
  [/@\/lib\/prosperidade/, "N2 — dado financeiro nunca é compartilhável, nem derivado"],
  [/@\/integrations\/supabase/, "pureza — estes módulos são função pura, testáveis sem banco"],
];

function allSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { allSourceFiles(path, out); continue; }
    if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

const read = (p: string) => readFileSync(p, "utf-8");

/** Remove comentários antes de checar. Sem isto, um arquivo que faz a coisa
 *  CERTA falha: este teste cita "@/lib/battles" para explicar por que ele não
 *  pode ser importado, e explicar a regra não pode ser o que reprova. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}

const mentionsSocial = (text: string) =>
  /social(Metrics|Challenge)|isShareable|SHAREABLE_METRICS|weekScoreboard/i.test(text);

const PUROS = SOCIAL_FILES.filter((f) => !f.endsWith(".test.ts"));

/** TODO arquivo cujo nome diz Social, onde quer que ele esteja. Descoberto por
 *  varredura, nunca por lista: o Pixel está criando tela enquanto isto é
 *  escrito, e uma lista escrita à mão cobriria só o que existia no momento em
 *  que alguém a escreveu — que é o oposto do que este arquivo serve para
 *  fazer. */
const socialPorNome = (): string[] =>
  allSourceFiles("src").filter((f) => /(^|\/)social/i.test(f.replace(/^src\//, "")));

/**
 * A superfície REAL do Social: os arquivos com nome de Social, mais tudo que
 * eles alcançam por import, transitivamente.
 *
 * O alcance importa porque o caminho óbvio de furar a regra não é escrever
 * `serviceClient()` dentro de `Social.tsx` — é um hook com nome neutro,
 * importado por ele, que "só busca os dados do grupo". Um hook assim não tem
 * nome de Social e passaria por qualquer varredura por nome.
 */
function superficieDoSocial(): string[] {
  const vistos = new Set<string>();
  const fila = socialPorNome();
  const importsDe = (f: string) =>
    [...stripComments(read(f)).matchAll(/from\s+"(@\/[^"]+)"/g)].map((mm) => mm[1]);

  while (fila.length) {
    const atual = fila.pop()!;
    if (vistos.has(atual)) continue;
    vistos.add(atual);
    for (const imp of importsDe(atual)) {
      for (const ext of [".ts", ".tsx"]) {
        const path = `${imp.replace("@/", "src/")}${ext}`;
        try { statSync(path); if (!vistos.has(path)) fila.push(path); break; } catch { /* segue */ }
      }
    }
  }
  return [...vistos];
}

describe("N3/C8 — o que o Social não pode nem IMPORTAR", () => {
  it.each(IMPORTS_PROIBIDOS)("nenhum módulo do Social importa %s (%s)", (padrao) => {
    for (const f of SOCIAL_FILES) {
      expect(padrao.test(stripComments(read(f))), `${f} importa o proibido`).toBe(false);
    }
  });

  it("o Social não alcança o proibido por caminho INDIRETO", () => {
    /* A defesa contra o próximo passo óbvio: em vez de importar `lib/battles`,
       importar um módulo que importa. A varredura é transitiva. */
    const importsDe = (f: string) =>
      [...stripComments(read(f)).matchAll(/from\s+"(@\/[^"]+)"/g)].map((mm) => mm[1]);

    const alcance = new Set<string>();
    const fila = [...PUROS];
    while (fila.length) {
      const atual = fila.pop()!;
      for (const imp of importsDe(atual)) {
        const path = `${imp.replace("@/", "src/")}.ts`;
        if (alcance.has(path)) continue;
        alcance.add(path);
        try { statSync(path); fila.push(path); } catch { /* .tsx ou pacote externo */ }
      }
    }
    for (const [padrao, motivo] of IMPORTS_PROIBIDOS) {
      const achado = [...alcance].filter((p) => padrao.test(p.replace("src/", "@/").replace(/\.ts$/, "")));
      expect(achado, `${motivo} — alcançado por: ${achado.join(", ")}`).toEqual([]);
    }
  });

  it("o Social é FOLHA: NENHUM módulo de cálculo do app o conhece", () => {
    /* A recíproca, e é ela que garante o C8 de verdade. Um `if (emGrupo)`
       dentro do XP, do Score ou dos insights faria o Social mudar um número que
       a pessoa vê — e passaria em qualquer teste de unidade.

       A lista é DERIVADA, não escrita à mão: todo módulo de src/lib que não é
       do Social e não é teste. Lista escrita à mão protege só o que alguém
       lembrou de listar, e o módulo de cálculo que nascer em novembro entraria
       sem cobertura — que é exatamente como uma regra dessas morre. */
    const calculos = allSourceFiles("src/lib")
      .filter((f) => !SOCIAL_FILES.includes(f))
      .filter((f) => !/\.test\.tsx?$/.test(f));

    expect(calculos.length, "a varredura não achou módulo nenhum — o filtro comeu tudo")
      .toBeGreaterThan(20);

    const intrusos = calculos.filter((f) => mentionsSocial(stripComments(read(f))));
    expect(intrusos, `Estes módulos de cálculo conhecem o Social: ${intrusos.join(", ")}`)
      .toEqual([]);
  });

  it("e o Social não pontua: nenhum módulo dele fala em XP", () => {
    /* C8 dito do outro lado, e por MENÇÃO e não por import: o caminho óbvio de
       furar isso é este módulo devolver um número chamado "pontos" e alguém
       somá-lo lá fora. */
    for (const f of PUROS) {
      const fonte = stripComments(read(f));
      expect(/\bxp\b|awardXp|pontua|pontos\b/i.test(fonte), `${f} fala em pontuação`).toBe(false);
    }
  });
});

describe("RLS — nenhum caminho do Social passa por cima das políticas", () => {
  /* O buraco que o SQL não consegue fechar sozinho, apontado pela própria
     Aduana depois de escrever ~35 políticas e provar as quatro revogações num
     Postgres local: a service role ignora RLS por definição. Um único caminho
     de leitura do Social com a chave de serviço anula o documento inteiro — e
     anula em SILÊNCIO, porque a consulta funciona, devolve dado e não erra. É
     o tipo exato de regra que não pode depender de revisão de código. */

  const PROIBIDO = [
    /SERVICE_ROLE/i,
    /\bservice_role\b/,
    /\bserviceClient\b/,
    /SUPABASE_SERVICE_ROLE_KEY/,
  ];

  it("a superfície do Social é descoberta, não listada à mão", () => {
    /* Se a varredura parar de achar os arquivos, todos os testes abaixo passam
       por vacuidade — e um teste de segurança que passa por não olhar nada é
       pior que teste nenhum, porque ele tranquiliza. */
    const porNome = socialPorNome();
    expect(porNome.length, "a varredura por nome não achou arquivo nenhum do Social")
      .toBeGreaterThanOrEqual(SOCIAL_FILES.length);
    expect(porNome).toEqual(expect.arrayContaining(SOCIAL_FILES));

    const superficie = superficieDoSocial();
    expect(superficie.length, "o alcance por import não expandiu — o seguidor quebrou")
      .toBeGreaterThan(porNome.length);
    // E ele alcança de fato a camada que fala com o banco.
    expect(superficie).toContain(PORTA_DO_CLIENTE);
  });

  it.each(PROIBIDO)("nenhum arquivo da superfície do Social menciona %s", (padrao) => {
    const permitidos = new Set(PODEM_USAR_SERVICE_ROLE.map((x) => x.arquivo));
    const infratores = superficieDoSocial()
      .filter((f) => f !== DEFINIDOR_DA_REGRA && !permitidos.has(f))
      .filter((f) => padrao.test(stripComments(read(f))));

    expect(
      infratores,
      `Estes caminhos do Social passam por cima da RLS: ${infratores.join(", ")}.\n` +
      "A pergunta NÃO é 'adiciono na lista de exceção?'. É: POR QUE ESTE CAMINHO " +
      "PRECISA PASSAR POR CIMA DA RLS? A service role ignora as ~35 políticas de " +
      "uma vez, sem erro e sem rastro. Se a resposta for 'porque é mais simples', " +
      "a resposta é não.",
    ).toEqual([]);
  });

  it("o Social não cria cliente Supabase nenhum — só usa a porta da sessão", () => {
    /* A outra metade da mesma regra. Não adianta proibir a palavra
       `serviceClient` se alguém montar um `createClient(url, outraChave)` na
       mão: o resultado é o mesmo, e a palavra proibida não aparece. Existe UMA
       porta, ela é a da chave anônima, e ela está presa à sessão da pessoa —
       que é exatamente o que faz a RLS ter sobre quem valer. */
    const infratores = superficieDoSocial()
      .filter((f) => f !== PORTA_DO_CLIENTE)
      .filter((f) => /\bcreateClient\s*\(/.test(stripComments(read(f))));

    expect(
      infratores,
      `Estes arquivos criam um cliente Supabase próprio: ${infratores.join(", ")}. ` +
      `A porta é ${PORTA_DO_CLIENTE}, e é uma só.`,
    ).toEqual([]);
  });

  it("a porta do cliente usa a chave ANÔNIMA, e nunca a de serviço", () => {
    /* A porta única só protege enquanto ela própria for a chave certa. Trocar
       a chave aqui seria a mesma falha, um nível acima — e valeria para o app
       inteiro, não só para o Social. */
    const fonte = stripComments(read(PORTA_DO_CLIENTE));
    expect(/VITE_SUPABASE_(ANON|PUBLISHABLE)_KEY/.test(fonte),
      "a porta do cliente não usa mais a chave anônima").toBe(true);
    for (const padrao of PROIBIDO) {
      expect(padrao.test(fonte), `a porta do cliente menciona ${padrao}`).toBe(false);
    }
  });

  it("nenhuma edge function do Social usa service role sem estar declarada", () => {
    /* O caminho legítimo, se um dia existir, mora aqui: uma edge function do
       Social. Hoje não existe nenhuma — e o desenho é esse de propósito,
       porque o grupo lê PROJEÇÃO e a projeção é escrita por gatilho do banco.
       Se aparecer uma, ela entra em PODEM_USAR_SERVICE_ROLE com o motivo
       escrito, e a revisão responde à pergunta antes de a linha existir. */
    const dir = "supabase/functions";
    const permitidos = new Set(PODEM_USAR_SERVICE_ROLE.map((x) => x.arquivo));
    const doSocial = allSourceFiles(dir).filter((f) => /social/i.test(f));
    const infratores = doSocial
      .filter((f) => f !== DEFINIDOR_DA_REGRA && !permitidos.has(f))
      .filter((f) => PROIBIDO.some((padrao) => padrao.test(stripComments(read(f)))));

    expect(
      infratores,
      `Função de borda do Social usando service role sem declaração: ${infratores.join(", ")}`,
    ).toEqual([]);
  });

  it("toda exceção declarada tem motivo escrito — e o arquivo existe", () => {
    // Exceção sem motivo é exceção que ninguém consegue revisar depois. E
    // exceção apontando para arquivo que não existe é lista podre dando falsa
    // sensação de controle.
    for (const { arquivo, porque } of PODEM_USAR_SERVICE_ROLE) {
      expect(porque.length, `${arquivo} está na lista sem motivo escrito`).toBeGreaterThan(20);
      expect(() => statSync(arquivo)).not.toThrow();
    }
  });
});

describe("pureza — a data de referência entra por parâmetro", () => {
  it("nenhum módulo do Social lê o relógio", () => {
    /* Mesma regra de pureza do cálculo do espelho: sem ela, o mesmo ciclo
       produziria placares diferentes conforme a hora em que a tela abriu, e
       nenhum teste conseguiria provar o contrário. */
    for (const f of PUROS) {
      const fonte = stripComments(read(f));
      expect(/Date\.now\(\)/.test(fonte), `${f} lê o relógio`).toBe(false);
      expect(/new Date\(\s*\)/.test(fonte), `${f} lê o relógio`).toBe(false);
    }
  });
});

describe("Adendo 3 — a marca de cumprido não existe no cartão de terceiro", () => {
  /* Regra do Fiel, vinculante (18/09/2026), e ela NÃO é calculável: é uma
     propriedade de como o componente está escrito. Um teste de unidade
     renderizaria a ficha e veria o glifo sumir; não veria alguém devolvê-lo
     por outro canal — um fundo, uma borda, um `font-semibold`, uma opacidade,
     uma ordenação. Por isso este teste LÊ O CÓDIGO.

     A razão da regra, para quem cair aqui por causa de uma falha: marcar
     "cumpriu" na frente dos outros PREMIA QUEM ESCOLHEU A META MODESTA — e
     isso corrompe o DENOMINADOR, que é a peça sobre a qual a C3 e a doutrina
     do "0 de 6" se apoiam. No instante em que a meta baixa rende mais marcas,
     a pessoa aprende a baixar a meta. */

  const DA_TELA = allSourceFiles("src/components/social");

  it("a varredura acha os componentes do Social — senão ela passa sem olhar", () => {
    expect(DA_TELA.length, "não achei os componentes da tela do Social")
      .toBeGreaterThan(8);
  });

  it("todo uso de `cumpriu` na tela está preso a `souEu`", () => {
    const infratores: string[] = [];
    let usos = 0;
    for (const f of DA_TELA) {
      for (const [i, linha] of stripComments(read(f)).split("\n").entries()) {
        if (!/\bcumpriu\b/.test(linha)) continue;
        usos++;
        if (!/\bsouEu\b/.test(linha)) infratores.push(`${f}:${i + 1}  ${linha.trim()}`);
      }
    }
    expect(usos, "ninguém mais lê `cumpriu` na tela — o teste ficou vazio e tranquiliza à toa")
      .toBeGreaterThan(0);
    expect(
      infratores,
      "Marca de cumprimento fora do meu próprio cartão:\n  " + infratores.join("\n  ") +
      "\nNo cartão de terceiro não existe marca em forma nenhuma — só o número.",
    ).toEqual([]);
  });

  it("nenhum canal de cumprimento volta por cor, peso ou opacidade", () => {
    /* Os canais que já foram usados uma vez (o fundo verde) ou que são os
       próximos candidatos óbvios. `cn(...)` condicional com qualquer um destes
       ao lado de `cumpriu` é o mesmo placar por outra porta. */
    const CANAIS = [
      /bg-vitalidade\//, /border-vitalidade\//, /text-vitalidade(?!-ink)/,
      /font-(semi)?bold/, /opacity-/,
    ];
    const infratores: string[] = [];
    for (const f of DA_TELA) {
      for (const [i, linha] of stripComments(read(f)).split("\n").entries()) {
        if (!/\bcumpr|\bmarcar\b/.test(linha)) continue;
        for (const canal of CANAIS) {
          if (canal.test(linha)) infratores.push(`${f}:${i + 1}  ${linha.trim()}`);
        }
      }
    }
    expect(infratores, "Cumprimento voltando por cor/peso/opacidade:\n  " + infratores.join("\n  "))
      .toEqual([]);
  });
});

describe("a trilha do grid não pode ser dimensionada pelo nome de ninguém", () => {
  /* ACHADO ALTA, medido por dois caminhos independentes (réplica de CSS puro e
     dado real do banco): um `display_name` de 40 caracteres — que é o
     `maxLength` que o PRÓPRIO campo oferece — fazia a página rolar de lado em
     390px, e inflava TODOS os cartões da coluna junto.

       documentElement.scrollWidth 433 × clientWidth 390   (43px de estouro)
       grid-template-columns 395,58px  com o container em 316px
       cartão "Maria Fernanda Albuquerque Nascimento Jr" = 396px
       cartão "Você" (quatro caracteres) ................. 396px

     Isolado por eliminação: sem as fichas o estouro permanece; sem o NOME a
     trilha cabe exata (316). E trocar os rótulos longos pelos curtos no DOM
     não mudou nada — ou seja, não é a migration que falta.

     POR QUE `truncate` NÃO SALVA, que é a parte contraintuitiva: `truncate` é
     `white-space: nowrap`, e nowrap resolve o DESENHO do texto, não a
     contribuição de `min-content` do item. O `min-w-0` do `<p>` derruba o
     mínimo automático daquele item flex; não derruba o `min-content` dele. O
     CARTÃO é o único elo da cadeia que continuava com `min-width: auto`
     (`main.container`, `.max-w-3xl`, o `Card` e o `.grid` já têm `0px`), então
     era ele quem empurrava a trilha — e a trilha é UMA SÓ em coluna única.

     Isto é layout, e o vitest não resolve CSS: este teste não mede largura
     nenhuma. Ele trava a única coisa que dá para travar aqui, e que é
     exatamente o que alguém apaga por achar que é sobra — a CLASSE, no lugar
     certo. */

  const CARTAO = "src/components/social/CartaoDaPessoa.tsx";
  const FICHA = "src/components/social/FichaDaMetrica.tsx";

  /** A string de classes da casca do cartão: é a que carrega `rounded-xl`. */
  function cascaDoCartao(): string {
    const achadas = [...stripComments(read(CARTAO)).matchAll(/"([^"]*rounded-xl[^"]*)"/g)]
      .map((m) => m[1]);
    expect(achadas.length, "não achei a casca do cartão — o teste ficaria vazio")
      .toBeGreaterThan(0);
    return achadas.join(" ");
  }

  it("o cartão de pessoa carrega `min-w-0` — ele é o item do grid", () => {
    expect(
      /\bmin-w-0\b/.test(cascaDoCartao()),
      "O cartão perdeu o `min-w-0`. Sem ele, o `min-content` do nome dimensiona a " +
      "trilha `auto` do grid, a trilha dimensiona TODOS os cartões da coluna, e a " +
      "página rola de lado em 390px com um nome de 40 caracteres (o maxLength do " +
      "próprio campo). `truncate` não substitui: nowrap resolve o desenho do texto, " +
      "não a contribuição de min-content.",
    ).toBe(true);
  });

  it("o contêiner das fichas carrega `min-w-0` pela mesma razão", () => {
    const linha = stripComments(read(FICHA))
      .split("\n").find((l) => l.includes("CLASSES_DO_CONTAINER"));
    expect(linha, "não achei CLASSES_DO_CONTAINER — o teste ficaria vazio").toBeTruthy();
    expect(
      /\bmin-w-0\b/.test(linha ?? ""),
      "O contêiner das fichas perdeu o `min-w-0`. A fração é `whitespace-nowrap` e o " +
      "`max-w-full` da ficha é porcentagem — que não resolve durante a medição " +
      "intrínseca da trilha —, então o que não encolhe aqui sobe pela árvore.",
    ).toBe(true);
  });

  it("o comentário que explica o porquê continua junto da classe", () => {
    /* A classe sozinha é indefensável: ela parece sobra. Quem a apagar daqui a
       seis meses tem de esbarrar no motivo ANTES, e o motivo mora no fonte —
       não neste teste, que a pessoa pode nem rodar antes de apagar. */
    const fonte = read(CARTAO);
    expect(
      /min-width:\s*auto|min-content/.test(fonte),
      `${CARTAO} perdeu a explicação do min-w-0. Sem ela a classe vira sobra aos ` +
      "olhos de quem não viveu o bug, e some na próxima limpeza.",
    ).toBe(true);
  });
});
