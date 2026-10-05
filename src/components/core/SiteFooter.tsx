import { Link } from "react-router-dom";

/** Rodapé compartilhado das páginas públicas (Landing, Recusas, Legal...):
 *  mesmo aviso, mesmos links legais, em qualquer porta de entrada fria. */
export default function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="container py-8 text-center">
        <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
          O Ascende não substitui médicos, nutricionistas, psicólogos ou consultores de investimento
          e não faz recomendações de produtos financeiros. Se você estiver passando por um momento
          difícil, o CVV atende de graça, 24 horas por dia, no telefone 188.
        </p>
        {/* Cada link tem 44 pt de altura de alvo: no celular eram 15 pt, e é a
            linha onde ficam a política de privacidade e os termos. */}
        <div className="flex flex-wrap justify-center gap-x-4 mt-2 text-xs">
          <Link to="/recusas" className="inline-flex items-center min-h-11 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">O que o Ascende recusa</Link>
          <Link to="/privacidade" className="inline-flex items-center min-h-11 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">Política de Privacidade</Link>
          <Link to="/termos" className="inline-flex items-center min-h-11 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">Termos e Condições</Link>
          <Link to="/aviso-legal" className="inline-flex items-center min-h-11 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">Aviso Legal</Link>
        </div>
        <p className="text-xs text-muted-foreground mt-3">© {new Date().getFullYear()} Ascende</p>
      </div>
    </footer>
  );
}
