import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, MoreHorizontal, UserPlus, Flag } from "lucide-react";

/**
 * AS AÇÕES, fora do corpo da tela.
 *
 * "Chamar alguém" e "Sair" eram dois botões no fim da página, disputando
 * espaço com o que a pessoa veio ver. Eles não somem — vão para o `⋯`, que é
 * onde mora ação que se usa uma vez por mês.
 *
 * CONVIDAR É DE QUEM ADMINISTRA, e não é burocracia: pela reciprocidade, quem
 * entra passa a ver o que cada um já compartilha — e ninguém foi consultado.
 * Um membro sozinho não decide, por todos, quem enxerga a vida deles.
 *
 * SAIR NÃO TEM DIÁLOGO DE RETENÇÃO. "Tem certeza? seus amigos vão sentir sua
 * falta" é proibido — sair é um toque, e o grupo não recebe anúncio.
 */
export default function MenuDoGrupo({
  souAdmin, vigente, temDesafio, saindo, onConvidar, onCombinarDesafio, onSair,
}: {
  souAdmin: boolean;
  vigente: boolean;
  temDesafio: boolean;
  saindo: boolean;
  onConvidar: () => void;
  onCombinarDesafio: () => void;
  onSair: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost" size="icon" className="w-11 h-11 shrink-0"
          aria-label="Mais ações deste grupo"
        >
          {saindo ? <Loader2 className="w-5 h-5 animate-spin" /> : <MoreHorizontal className="w-5 h-5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {souAdmin && vigente && (
          <DropdownMenuItem onSelect={onConvidar} className="min-h-11">
            <UserPlus className="w-4 h-4 mr-2" /> Chamar alguém
          </DropdownMenuItem>
        )}
        {souAdmin && vigente && !temDesafio && (
          <DropdownMenuItem onSelect={onCombinarDesafio} className="min-h-11">
            <Flag className="w-4 h-4 mr-2" /> Combinar um desafio
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onSair} disabled={saindo} className="min-h-11">
          <LogOut className="w-4 h-4 mr-2" /> Sair do grupo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
