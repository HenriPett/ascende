// Página pública /sobre — quem faz o Ascende e o que ele é. Mesma moldura de
// Legal (cabeçalho, coluna de leitura, cartão do documento); o texto mora em
// src/lib/sobre.ts, que também vira dist/sobre.md para agentes.
import { Link } from "react-router-dom";
import { Markdown } from "@/components/core/Markdown";
import Logo from "@/components/core/Logo";
import SiteFooter from "@/components/core/SiteFooter";
import { SOBRE } from "@/lib/sobre";

export default function Sobre() {
  return (
    <div className="min-h-dvh bg-background bg-ether">
      <header className="sticky top-0 z-40 glass border-x-0 border-t-0 rounded-none">
        <div className="container flex items-center justify-between h-14">
          {/* Alvos de 44 pt: eram ~20 (a altura do texto e do logo). */}
          <Link to="/" aria-label="Ascende — início" className="inline-flex items-center min-h-11"><Logo size="sm" /></Link>
          <Link to="/" className="inline-flex items-center min-h-11 text-sm text-muted-foreground hover:text-foreground">
            Voltar ao início
          </Link>
        </div>
      </header>

      <main className="container py-8 max-w-3xl">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Sobre</p>
        <article className="rounded-2xl border bg-card p-5 sm:p-8 text-sm">
          <Markdown content={SOBRE} doc pagina />
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
