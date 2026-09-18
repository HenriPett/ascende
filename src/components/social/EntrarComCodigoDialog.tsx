import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { codigoDoTexto } from "@/components/social/uteis";
import { toast } from "sonner";

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

  const entrar = async () => {
    const limpo = codigoDoTexto(codigo);
    if (!limpo) { toast.error("Cole o link ou o código que te mandaram."); return; }
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
      toast.error("Esse convite não vale mais. Peça um novo a quem te chamou.");
      return;
    }
    onOpenChange(false);
    setCodigo("");
    onEntrou(String(data));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {retomado ? "Você tinha um convite esperando" : "Tenho um link de convite"}
          </DialogTitle>
          <DialogDescription>
            {retomado
              ? "Você abriu um convite antes de ter conta, e ele ficou guardado aqui. Entrar é escolha sua — e dá para entrar sem compartilhar nada."
              : "Cole o link que te mandaram. Você escolhe o que compartilhar depois de entrar — e dá para entrar sem compartilhar nada."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            className="min-h-11" autoFocus placeholder="cole aqui o link que te mandaram"
            value={codigo} onChange={(e) => setCodigo(e.target.value)}
            aria-label="Link ou código do convite"
          />
          <div className="space-y-1">
            <Input
              className="min-h-11" maxLength={40}
              placeholder={nomeSugerido ? `Como eles te chamam (ex.: ${nomeSugerido})` : "Como eles te chamam"}
              value={comoMeChamo} onChange={(e) => setComoMeChamo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") entrar(); }}
              aria-label="Como o grupo te chama"
            />
            <p className="text-[11px] text-muted-foreground">Só este nome sai para o grupo.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="min-h-11" onClick={() => onOpenChange(false)} disabled={entrando}>
            Cancelar
          </Button>
          <Button className="min-h-11" onClick={entrar} disabled={entrando}>
            {entrando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
