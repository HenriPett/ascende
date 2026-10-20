// A 404 da casa, estática (dist/404.html): o Netlify a serve com status 404
// para qualquer endereço que não existe. Mesmo visual do NotFound do app
// (src/pages/NotFound.tsx), mas sem sessão nem JS: quem cai aqui não está no
// app — e um agente que erra um endereço precisa de saídas que existem.
import { BLOG_TEM_POSTS } from "@/blog/temPosts";

// Alvos de 44 pt: links soltos numa linha (não no meio de uma frase).
const link = "inline-flex items-center min-h-11 underline underline-offset-2 hover:text-foreground";

export default function NaoEncontrada() {
  return (
    <div className="min-h-dvh grid place-items-center bg-background px-4 text-center">
      <main>
        <p className="font-display text-6xl font-semibold text-gold">404</p>
        <h1 className="mt-2 text-muted-foreground">Esse degrau não existe.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O endereço que você abriu não foi encontrado — ele pode ter mudado de lugar
          ou ter sido digitado com algum erro.
        </p>
        <a
          href="/"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Voltar para o início
        </a>
        <nav aria-label="Outros caminhos" className="mt-4 flex flex-wrap justify-center gap-x-4 text-sm text-muted-foreground">
          {BLOG_TEM_POSTS && <a className={link} href="/blog/">Blog</a>}
          <a className={link} href="/sobre">Sobre</a>
          <a className={link} href="/sitemap.xml">Mapa do site</a>
          <a className={link} href="/llms.txt">llms.txt</a>
        </nav>
      </main>
    </div>
  );
}
