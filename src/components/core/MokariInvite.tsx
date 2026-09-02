import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sprout } from "lucide-react";
import { useMokariPreference } from "@/hooks/useMokariPreference";

/* O convite — UMA vez, e só.
 *
 * "Agora não" grava `false` e some PARA SEMPRE: não volta em uma semana, não
 * volta no mês que vem. Quem mudar de ideia liga em Ajustes. Pedir duas vezes
 * é cobrar, e o contrato mandou respeitar o silêncio — um personagem que
 * aparece sem ser convidado, no app de quem está tentando organizar a própria
 * vida, é atrito.
 *
 * Nada de linguagem de dono e bichinho. Ele não fala, não pede, não agradece:
 * espelho não conversa. Terceira pessoa descritiva, sempre. */
export default function MokariInvite() {
  const { shouldInvite, setEnabled, decline } = useMokariPreference();
  if (!shouldInvite) return null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md grid place-items-center shrink-0 bg-muted">
          <Sprout className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="font-display font-semibold">Quer um espelho da sua jornada?</p>
          <p className="text-sm text-muted-foreground">
            O Mokari é um broto que cresce com o que você registra. Ele não cobra nada, não
            notifica, e nunca desfaz o que você já construiu.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setEnabled(true)}>Conhecer o Mokari</Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={decline}>
          Agora não
        </Button>
      </div>
    </Card>
  );
}
