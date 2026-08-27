import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export default function NotFound() {
  const { session, loading } = useAuth();

  // O destino depende de quem chegou aqui: mandar um visitante deslogado para
  // /app é jogá-lo contra o muro de login por ter errado um endereço.
  const to = session ? "/app" : "/";
  const label = session ? "Voltar para o Hoje" : "Voltar para o início";

  return (
    <div className="min-h-dvh grid place-items-center bg-background px-4 text-center">
      <div>
        <p className="font-display text-6xl font-semibold text-gold">404</p>
        <p className="mt-2 text-muted-foreground">Esse degrau não existe.</p>
        {/* Enquanto a sessão carrega, o botão fica inerte e sem destino: é
            melhor esperar um instante do que oferecer o caminho errado. */}
        {loading ? (
          <Button disabled className="mt-5">Voltar</Button>
        ) : (
          <Button asChild className="mt-5"><Link to={to}>{label}</Link></Button>
        )}
      </div>
    </div>
  );
}
