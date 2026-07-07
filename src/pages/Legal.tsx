import { Link, Navigate } from "react-router-dom";
import { Markdown } from "@/components/core/Markdown";
import Logo from "@/components/core/Logo";
import { PRIVACIDADE, TERMOS, AVISO_LEGAL } from "@/lib/legal";
import { cn } from "@/lib/utils";

const DOCS: Record<string, { title: string; content: string }> = {
  privacidade: { title: "Política de Privacidade", content: PRIVACIDADE },
  termos: { title: "Termos e Condições", content: TERMOS },
  "aviso-legal": { title: "Aviso Legal", content: AVISO_LEGAL },
};

export default function Legal({ doc }: { doc: string }) {
  const current = DOCS[doc];
  if (!current) return <Navigate to="/" replace />;

  return (
    <div className="min-h-dvh bg-background bg-ether">
      <header className="sticky top-0 z-40 glass border-x-0 border-t-0 rounded-none">
        <div className="container flex items-center justify-between h-14">
          <Link to="/" aria-label="Ascend — início"><Logo size="sm" /></Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            Voltar ao início
          </Link>
        </div>
      </header>

      <main className="container py-8 max-w-3xl">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Legal</p>

        {/* Navegação entre os documentos */}
        <nav className="flex flex-wrap gap-2 mb-6" aria-label="Documentos legais">
          {Object.entries(DOCS).map(([slug, d]) => (
            <Link
              key={slug}
              to={`/${slug}`}
              className={cn(
                "text-sm rounded-full border px-3.5 py-1.5 transition-colors",
                slug === doc
                  ? "bg-primary text-primary-foreground border-transparent font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {d.title}
            </Link>
          ))}
        </nav>

        <article className="rounded-2xl border bg-card p-5 sm:p-8 text-sm">
          <Markdown content={current.content} doc />
        </article>

        <p className="text-xs text-muted-foreground mt-6 text-center">
          Dúvidas sobre estes documentos ou sobre seus dados? Fale com a gente pelo canal de
          atendimento da plataforma.
        </p>
      </main>
    </div>
  );
}
