import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { chip } from "@/components/social/uteis";
import { toast } from "sonner";

/** As durações oferecidas para o COMBINADO. `groups.ends_on` é NOT NULL: um
 *  grupo sem fim não é um combinado, é um mural — e mural é a forma vetada. */
const DURACOES = [
  { dias: 30, label: "1 mês" },
  { dias: 60, label: "2 meses" },
  { dias: 90, label: "3 meses" },
] as const;

export default function CriarGrupoDialog({
  open, onOpenChange, nomeSugerido, onCriado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  nomeSugerido: string;
  onCriado: (id: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [comoMeChamo, setComoMeChamo] = useState("");
  const [dias, setDias] = useState<number>(30);
  const [salvando, setSalvando] = useState(false);

  const fim = new Date();
  fim.setDate(fim.getDate() + dias);

  const criar = async () => {
    if (!nome.trim()) { toast.error("Dê um nome ao grupo. Ex.: \"Os Teimosos\"."); return; }
    setSalvando(true);
    const { data, error } = await supabase.rpc("criar_grupo", {
      p_nome: nome.trim(),
      p_display_name: (comoMeChamo.trim() || nomeSugerido || "Eu").slice(0, 40),
      p_ends_on: fim.toISOString().slice(0, 10),
    });
    setSalvando(false);
    if (error || !data) { toast.error(error?.message ?? "Não consegui criar o grupo."); return; }
    toast.success("Grupo criado. Nada seu é compartilhado até você escolher.");
    onOpenChange(false);
    setNome(""); setComoMeChamo("");
    onCriado(String(data));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Criar um grupo</DialogTitle>
          <DialogDescription>
            Pequeno funciona melhor: você e duas, três pessoas que se acompanham por
            um tempo combinado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            className="min-h-11" maxLength={60} autoFocus
            placeholder='Nome do grupo. Ex.: "Os Teimosos"'
            value={nome} onChange={(e) => setNome(e.target.value)}
            aria-label="Nome do grupo"
          />
          {/* O nome do grupo é do GRUPO, e por isso é pedido aqui em vez de
              lido do perfil: `profiles` tem renda e remédios na mesma linha do
              nome, e RLS não recorta coluna. */}
          <div className="space-y-1">
            <Input
              className="min-h-11" maxLength={40}
              placeholder={nomeSugerido ? `Como eles te chamam (ex.: ${nomeSugerido})` : "Como eles te chamam"}
              value={comoMeChamo} onChange={(e) => setComoMeChamo(e.target.value)}
              aria-label="Como o grupo te chama"
            />
            <p className="text-[11px] text-muted-foreground">
              Só este nome sai para o grupo. O resto do seu perfil não vai junto.
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Até quando</p>
            <div className="flex flex-wrap gap-2">
              {DURACOES.map((d) => (
                <button
                  key={d.dias} type="button" onClick={() => setDias(d.dias)}
                  aria-pressed={dias === d.dias} className={chip(dias === d.dias)}
                  style={dias === d.dias ? { background: "hsl(var(--vitalidade))" } : undefined}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Termina {fim.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}.
              O grupo tem fim porque é um combinado, não um lugar para ficar — e ele
              expira sozinho, sem ninguém precisar encerrar.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="min-h-11" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button className="min-h-11" onClick={criar} disabled={salvando}>
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
