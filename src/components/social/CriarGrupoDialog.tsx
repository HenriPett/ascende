import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerBody,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
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
  /* O ERRO DO CAMPO MORA EMBAIXO DO CAMPO. Ele era um toast: aparecia no topo
     da tela, longe de onde a pessoa estava olhando, e sumia sozinho. Aqui ele
     aparece onde o problema está, fica até ela corrigir, e o leitor de tela o
     anuncia (`role="alert"`) e o associa ao campo (`aria-describedby`). */
  const [erroNome, setErroNome] = useState<string | null>(null);

  const fim = new Date();
  fim.setDate(fim.getDate() + dias);

  const criar = async () => {
    if (!nome.trim()) { setErroNome("Dê um nome ao grupo. Ex.: \"Os Teimosos\"."); return; }
    setSalvando(true);
    const { data, error } = await supabase.rpc("criar_grupo", {
      p_nome: nome.trim(),
      p_display_name: (comoMeChamo.trim() || nomeSugerido || "Eu").slice(0, 40),
      p_ends_on: fim.toISOString().slice(0, 10),
    });
    setSalvando(false);
    // `id` estável: a mensagem pode vir do banco, e é pelo id que a próxima
    // tentativa bem-sucedida dispensa este erro.
    if (error || !data) { toast.error(error?.message ?? "Não consegui criar o grupo.", { id: "grupo-criar" }); return; }
    toast.dismiss("grupo-criar");
    // Sem toast de sucesso: a folha de consentimento abre no mesmo instante e
    // diz, com mais detalhe, a mesma coisa ("Tudo começa desligado") — e o
    // toast ficaria por cima dela, disputando a primeira leitura do grupo.
    onOpenChange(false);
    setNome(""); setComoMeChamo("");
    onCriado(String(data));
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Criar um grupo</DrawerTitle>
          <DrawerDescription>
            Pequeno funciona melhor: você e duas, três pessoas que se acompanham por
            um tempo combinado.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
        <div className="space-y-3">
          <Input
            className="min-h-11" maxLength={60} autoFocus
            placeholder='Nome do grupo. Ex.: "Os Teimosos"'
            value={nome} onChange={(e) => { setNome(e.target.value); setErroNome(null); }}
            aria-label="Nome do grupo"
            enterKeyHint="next"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget.form ?? document).querySelector<HTMLInputElement>('input[aria-label="Como o grupo te chama"]')?.focus(); } }}
            aria-invalid={!!erroNome || undefined}
            aria-describedby={erroNome ? "erro-nome-grupo" : undefined}
          />
          {erroNome && (
            <p id="erro-nome-grupo" role="alert" className="text-footnote text-destructive">{erroNome}</p>
          )}
          {/* O nome do grupo é do GRUPO, e por isso é pedido aqui em vez de
              lido do perfil: `profiles` tem renda e remédios na mesma linha do
              nome, e RLS não recorta coluna. */}
          <div className="space-y-1">
            <Input
              className="min-h-11" maxLength={40}
              placeholder={nomeSugerido ? `Como eles te chamam (ex.: ${nomeSugerido})` : "Como eles te chamam"}
              value={comoMeChamo} onChange={(e) => setComoMeChamo(e.target.value)}
              aria-label="Como o grupo te chama"
              enterKeyHint="go"
              onKeyDown={(e) => { if (e.key === "Enter") criar(); }}
            />
            <p className="text-caption2 text-muted-foreground">
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
            <p className="text-caption2 text-muted-foreground">
              Termina {fim.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}.
              O grupo tem fim porque é um combinado, não um lugar para ficar — e ele
              expira sozinho, sem ninguém precisar encerrar.
            </p>
          </div>
        </div>
        </DrawerBody>
        {/* `flex-col-reverse`: no celular os botões empilham, e o Cancelar fica
            EMBAIXO da pilha, com a ação principal em cima — a mesma ordem do
            rodapé dos alertas da casa (ui/alert-dialog.tsx), e a que o
            `alerts.md` pede para uma pilha. No código ele vem primeiro só
            para a ordem de tabulação continuar Cancelar → ação. */}
        <DrawerFooter className="flex-col-reverse">
          <Button variant="ghost" className="min-h-11" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button className="min-h-11" onClick={criar} disabled={salvando} loading={salvando}>
            Criar
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
