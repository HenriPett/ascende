import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerBody,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { codigoDoTexto } from "@/components/social/uteis";

export default function EntrarComCodigoDialog({
  open, onOpenChange, onEntrou, codigoInicial, nomeSugerido, retomado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEntrou: (id: string) => void;
  codigoInicial?: string | null;
  nomeSugerido: string;
  /** A pessoa abriu o convite ANTES de ter conta, e o app o guardou pelo
   *  caminho. Ela não pediu esta folha agora — então a folha explica por que
   *  apareceu, em vez de cobrar um código que ninguém pediu. */
  retomado?: boolean;
}) {
  const [codigo, setCodigo] = useState(codigoInicial ?? "");
  const [comoMeChamo, setComoMeChamo] = useState("");
  const [entrando, setEntrando] = useState(false);
  /* O ERRO DO CAMPO MORA EMBAIXO DO CAMPO. Ele era um toast: aparecia no topo
     da tela, longe de onde a pessoa estava olhando, e sumia sozinho. Aqui ele
     aparece onde o problema está, fica até ela corrigir, e o leitor de tela o
     anuncia (`role="alert"`) e o associa ao campo (`aria-describedby`). */
  const [erroCodigo, setErroCodigo] = useState<string | null>(null);
  // Reabrir a folha é começar de novo: o erro do convite anterior não vale
  // para o próximo link.
  useEffect(() => { if (open) setErroCodigo(null); }, [open]);

  const entrar = async () => {
    const limpo = codigoDoTexto(codigo);
    if (!limpo) { setErroCodigo("Cole o link ou o código que te mandaram."); return; }
    setEntrando(true);
    const { data, error } = await supabase.rpc("aceitar_convite", {
      p_codigo: limpo,
      p_display_name: (comoMeChamo.trim() || nomeSugerido || "Eu").slice(0, 40),
    });
    setEntrando(false);
    if (error || !data) {
      // O banco devolve UMA mensagem para código errado, expirado, revogado e
      // esgotado — distinguir os quatro confirmaria, para quem sonda, que o
      // código existe. A tela repete o mesmo silêncio.
      // E ela vai para baixo do CAMPO do código, que é o que está errado.
      setErroCodigo("Esse convite não vale mais. Peça um novo a quem te chamou.");
      return;
    }
    onOpenChange(false);
    setCodigo("");
    onEntrou(String(data));
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            {retomado ? "Você tinha um convite esperando" : "Tenho um link de convite"}
          </DrawerTitle>
          <DrawerDescription>
            {retomado
              ? "Você abriu um convite antes de ter conta, e ele ficou guardado aqui. Entrar é escolha sua — e dá para entrar sem compartilhar nada."
              : "Cole o link que te mandaram. Você escolhe o que compartilhar depois de entrar — e dá para entrar sem compartilhar nada."}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
        <div className="space-y-3">
          <Input
            className="min-h-11" autoFocus placeholder="cole aqui o link que te mandaram"
            value={codigo} onChange={(e) => { setCodigo(e.target.value); setErroCodigo(null); }}
            aria-label="Link ou código do convite"
            aria-invalid={!!erroCodigo || undefined}
            aria-describedby={erroCodigo ? "erro-codigo-convite" : undefined}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next"
          />
          {erroCodigo && (
            <p id="erro-codigo-convite" role="alert" className="text-footnote text-destructive">{erroCodigo}</p>
          )}
          <div className="space-y-1">
            <Input
              className="min-h-11" maxLength={40}
              placeholder={nomeSugerido ? `Como eles te chamam (ex.: ${nomeSugerido})` : "Como eles te chamam"}
              value={comoMeChamo} onChange={(e) => setComoMeChamo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") entrar(); }}
              aria-label="Como o grupo te chama"
              /* O Enter deste campo ENTRA no grupo: a tecla diz "ir". */
              enterKeyHint="go" autoComplete="given-name"
            />
            <p className="text-caption2 text-muted-foreground">Só este nome sai para o grupo.</p>
          </div>
        </div>
        </DrawerBody>
        {/* `flex-col-reverse`: no celular os botões empilham, e o Cancelar fica
            EMBAIXO da pilha, com a ação principal em cima — a mesma ordem do
            rodapé dos alertas da casa (ui/alert-dialog.tsx), e a que o
            `alerts.md` pede para uma pilha. No código ele vem primeiro só
            para a ordem de tabulação continuar Cancelar → ação. */}
        <DrawerFooter className="flex-col-reverse">
          <Button variant="ghost" className="min-h-11" onClick={() => onOpenChange(false)} disabled={entrando}>
            Cancelar
          </Button>
          <Button className="min-h-11" onClick={entrar} disabled={entrando} loading={entrando}>
            Entrar
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
