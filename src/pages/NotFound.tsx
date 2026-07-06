import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-dvh grid place-items-center bg-background px-4 text-center">
      <div>
        <p className="font-display text-6xl font-semibold text-gold">404</p>
        <p className="mt-2 text-muted-foreground">Essa trilha não existe.</p>
        <Button asChild className="mt-5"><Link to="/app">Voltar para o Hoje</Link></Button>
      </div>
    </div>
  );
}
