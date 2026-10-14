// ASCENDE — Blog: as duas páginas (listagem e artigo), como componentes React
// que só existem no BUILD. Elas nunca montam no navegador: render.tsx as
// transforma em HTML estático, servido sem JS. Por isso aqui não há estado,
// efeito nem `onClick` — só marcação. E por isso os links são `<a href>`
// comuns, não `<Link>`: daqui para a landing ou para /auth é uma navegação de
// página inteira, e o React Router nem está carregado.
//
// O desenho segue a especificação de leitura da Prisma
// (scratchpad/blog/prisma-spec.md): mesmos tokens da landing, uma coluna,
// ouro só na assinatura e no botão da chamada, nada de `dark:` escrito à mão
// (o escuro vem dos tokens, quando o tema.js põe `.dark` no <html>).

import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/core/Logo";
import SiteFooter from "@/components/core/SiteFooter";
import { Markdown } from "@/components/core/Markdown";
import { DESCRICAO_DO_BLOG, type PostDoBlog } from "@/lib/blog/tipos";
import { dataPorExtenso, foiAtualizado, minutosDeLeitura, ROTULO_DO_CLUSTER } from "./formato";

/** O mesmo anel de foco do app — o padrão do navegador some no fundo creme. */
const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function PularParaOConteudo() {
  return (
    <a
      href="#conteudo"
      className={
        "sr-only focus:not-sr-only focus:fixed focus:left-3 focus:z-50 focus:rounded-full " +
        "focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg " +
        "focus:top-[calc(env(safe-area-inset-top,0px)+0.75rem)] " + FOCO
      }
    >
      Pular para o conteúdo
    </a>
  );
}

/** Botões do topo em px também no toque: o Button padrão vira `min-h-11`
 *  (rem) e quebra linha sob `coarse:`, o que a 40 pt dá uma pílula de 100px. */
const BOTAO_DO_TOPO =
  "h-[44px] px-[16px] text-[min(0.875rem,15px)] whitespace-nowrap " +
  "coarse:h-[44px] coarse:min-h-[44px] coarse:py-0 coarse:whitespace-nowrap";

/** O cabeçalho da landing, igual: marca, Entrar, Começar grátis. Na landing a
 *  marca não é link (já se está nela); aqui ela leva de volta ao produto. */
function Cabecalho() {
  return (
    <header className="sticky top-0 z-40 glass border-x-0 border-t-0 rounded-none">
      <div className="container px-[20px] flex items-center justify-between h-[64px]">
        {/* O CROMO NÃO ESCALA com o Texto Maior: a 40 pt o botão saía da tela, e
            depois o wordmark era espremido até sumir (medido pela Prisma). O
            conteúdo cresce; o cabeçalho é todo em px — altura, padding, ícone,
            espaços, botões — e o texto dele tem teto com `min(rem, px)`. No
            desktop 1rem = 16px, então lá nada muda. Conta a 390: 20 + 32 + 8 +
            ~95 + 8 + ~147 + 20 ≈ 330. */}
        <a href="/" className={"inline-flex items-center gap-[8px] min-h-[44px] rounded-md " + FOCO}>
          <LogoMark className="size-[32px] shrink-0" />
          <span className="font-display font-semibold tracking-tight text-[min(1.25rem,22px)] whitespace-nowrap shrink-0">Ascende</span>
        </a>
        <div className="flex items-center gap-[8px] shrink-0">
          <Button asChild variant="ghost" className={"hidden sm:inline-flex " + BOTAO_DO_TOPO}>
            <a href="/auth">Entrar</a>
          </Button>
          <Button asChild className={BOTAO_DO_TOPO}>
            <a href="/auth?intent=signup">Começar grátis</a>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground overflow-x-clip">
      <PularParaOConteudo />
      <Cabecalho />
      {/* `tabIndex={-1}`: o skip link leva o FOCO para cá, não só a rolagem —
          sem isso, o próximo Tab no Safari volta para o cabeçalho. */}
      <main id="conteudo" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      {/* Nas páginas do blog o link "Blog" sempre aparece: elas só existem
          quando há post. */}
      <SiteFooter blog />
    </div>
  );
}

/** "14 de outubro de 2026 · 6 min de leitura", com o `<time>` legível por máquina. */
function Meta({ post, cluster = false }: { post: PostDoBlog; cluster?: boolean }) {
  return (
    <>
      <time dateTime={post.datePublished}>{dataPorExtenso(post.datePublished)}</time>
      {" · "}
      {minutosDeLeitura(post.corpo)} min de leitura
      {foiAtualizado(post) && (
        <>
          {" · Atualizado em "}
          <time dateTime={post.dateModified}>{dataPorExtenso(post.dateModified!)}</time>
        </>
      )}
      {cluster && <>{" · "}{ROTULO_DO_CLUSTER[post.cluster]}</>}
    </>
  );
}

/* ═══ LISTAGEM — /blog/ ═══════════════════════════════════════════════════ */

export function Listagem({ posts }: { posts: PostDoBlog[] }) {
  // Sem post, /blog não existe (regra 5 do plano). Renderizar uma lista vazia
  // aqui seria publicar um "em breve" — falhar é o certo: é bug do pipeline.
  if (posts.length === 0) throw new Error("listagem do blog sem posts: /blog não deve ser gerado");
  return (
    <Moldura>
      <div className="mx-auto max-w-3xl px-5 pt-10 pb-16 md:pt-14">
        <h1 className="font-display font-semibold text-[min(1.75rem,64px)] leading-tight md:text-4xl text-balance break-words hyphens-auto">Blog do Ascende</h1>
        <p className="mt-3 text-lg text-muted-foreground text-pretty">
          {DESCRICAO_DO_BLOG}
        </p>
        <ol className="mt-8 space-y-3" aria-label="Artigos, do mais recente ao mais antigo">
          {posts.map((p) => (
            <li key={p.slug}>
              {/* O cartão inteiro é UM link — sem link dentro de link, e o
                  leitor de tela lê o título como nome dele. */}
              <a
                href={p.caminho}
                className={"block rounded-lg border bg-card p-5 transition-colors hover:border-foreground/20 " + FOCO}
              >
                <h2 className="font-display font-semibold text-title3 text-balance break-words hyphens-auto">{p.title}</h2>
                <p className="mt-1.5 text-subhead text-muted-foreground line-clamp-3 text-pretty">{p.description}</p>
                <p className="mt-3 text-footnote text-muted-foreground"><Meta post={p} cluster /></p>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </Moldura>
  );
}

/* ═══ ARTIGO — /blog/<slug>/ ═════════════════════════════════════════════ */

const ROTULO_DO_PRODUTO: Record<PostDoBlog["productPath"], string> = {
  "/": "Como o Ascende funciona",
  "/recusas": "O que o Ascende recusa",
};

export function Artigo({ post, relacionados }: { post: PostDoBlog; relacionados: PostDoBlog[] }) {
  const continue_ = relacionados.filter((r) => r.slug !== post.slug).slice(0, 3);
  return (
    <Moldura>
      <div className="mx-auto max-w-[66ch] px-5 pt-6 pb-16 md:pt-10">
        <article>
          <nav aria-label="Trilha">
            <a
              href="/blog/"
              className={"inline-flex items-center gap-1 min-h-11 text-footnote text-muted-foreground hover:text-foreground rounded-md " + FOCO}
            >
              <span aria-hidden>←</span> Blog
            </a>
          </nav>
          {/* Teto de 64 px: abaixo do Texto Maior máximo ele não trava, e no máximo
              (AX3) continua MAIOR que o h2 (55) e a linha-fina (45) — com 44 a
              hierarquia se invertia (Lince). O hífen segura a largura. */}
          <h1 className="mt-2 font-display font-semibold text-[min(1.75rem,64px)] leading-tight md:text-4xl text-balance break-words hyphens-auto">{post.title}</h1>
          <p className="mt-3 text-lg text-muted-foreground text-pretty">{post.description}</p>
          <p className="mt-4 text-footnote text-muted-foreground"><Meta post={post} /></p>

          <div className="mt-8 text-body leading-[1.6] text-foreground">
            <Markdown content={post.corpo} artigo />
          </div>

          {post.sources.length > 0 && (
            <section aria-labelledby="fontes" className="mt-12">
              <h2 id="fontes" className="font-semibold text-title3">Fontes</h2>
              <ul className="mt-3 space-y-2 text-footnote text-muted-foreground">
                {post.sources.map((f) => (
                  <li key={f.url} className="break-words">
                    {/* Aqui o link É o controle da linha (não uma palavra no meio
                        da frase): alvo de 44 pt, como os outros links soltos. */}
                    <a
                      href={f.url}
                      rel="noopener"
                      className={"inline-flex items-center min-h-11 text-foreground underline underline-offset-2 decoration-[hsl(var(--gold-text))] hover:decoration-2 rounded-sm " + FOCO}
                    >
                      {f.title}
                    </a>
                    {" — "}{f.publisher}, consultado em <time dateTime={f.accessed}>{dataPorExtenso(f.accessed)}</time>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>

        {/* A assinatura, uma vez. */}
        <div className="ascend-line my-12" aria-hidden />

        {/* A CHAMADA AO PRODUTO. Uma por artigo, sempre aqui e sempre igual —
            nunca no meio do texto, nunca fixa na tela. Ela descreve o que o
            produto FAZ hoje; "grátis" pode porque é compromisso público
            ("Grátis para sempre no essencial", PRINCIPIOS.md). Sem resultado
            prometido, sem número de usuários, sem urgência. */}
        <aside aria-labelledby="chamada" className="rounded-lg border bg-card p-5">
          <h2 id="chamada" className="font-display font-semibold text-title3 text-balance">Um app que vê a sua vida inteira</h2>
          <p className="mt-1.5 text-subhead text-muted-foreground text-pretty">
            Você conta o dia numa frase; o Ascende registra e cruza corpo e dinheiro. O essencial é grátis, para sempre.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* A 40 pt o rótulo não cabia numa linha e o botão vazava: aqui
                ele quebra e cresce para baixo, também no mouse. */}
            <Button asChild className="h-auto min-h-11 whitespace-normal max-w-full text-center">
              <a href="/auth?intent=signup">Começar grátis</a>
            </Button>
            <a
              href={post.productPath}
              className={"inline-flex items-center min-h-11 text-subhead text-foreground underline underline-offset-2 decoration-[hsl(var(--gold-text))] hover:decoration-2 rounded-sm " + FOCO}
            >
              {ROTULO_DO_PRODUTO[post.productPath]}
            </a>
          </div>
        </aside>

        {/* Com 0 relacionados a seção não existe — nada de "em breve". */}
        {continue_.length > 0 && (
          <nav aria-labelledby="continue" className="mt-12">
            <h2 id="continue" className="font-semibold text-title3">Continue lendo</h2>
            <ul className="mt-3 border-b">
              {continue_.map((r) => (
                <li key={r.slug}>
                  <a
                    href={r.caminho}
                    className={"flex flex-col justify-center min-h-11 py-3 border-t hover:bg-muted/40 transition-colors " + FOCO}
                  >
                    <span className="text-subhead font-medium text-balance break-words hyphens-auto">{r.title}</span>
                    <span className="text-footnote text-muted-foreground">
                      <time dateTime={r.datePublished}>{dataPorExtenso(r.datePublished)}</time>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </Moldura>
  );
}
