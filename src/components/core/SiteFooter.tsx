import { Link } from "react-router-dom";

/** Rodapé compartilhado das páginas públicas (Landing, Recusas, Legal...):
 *  mesmo aviso, mesmos links legais, em qualquer porta de entrada fria. */
export default function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="container py-8 text-center">
        <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
          O Ascende não substitui médicos, nutricionistas, psicólogos ou consultores de investimento,
          e não faz recomendações de produtos financeiros. Se você estiver passando por um momento
          difícil, o CVV atende 24h pelo telefone 188.
        </p>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-4 text-xs">
          <Link to="/recusas" className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">O que o Ascende recusa</Link>
          <Link to="/privacidade" className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">Política de Privacidade</Link>
          <Link to="/termos" className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">Termos e Condições</Link>
          <Link to="/aviso-legal" className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">Aviso Legal</Link>
        </div>
        <p className="text-xs text-muted-foreground mt-3">© {new Date().getFullYear()} Ascende</p>
      </div>
    </footer>
  );
}
