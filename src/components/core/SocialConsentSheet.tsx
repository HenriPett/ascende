import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Lock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATALOGO_VISIVEL, NUNCA_COMPARTILHAVEL } from "@/components/core/socialPhrases";
import type { SocialMetricKey } from "@/lib/socialMetrics";

/**
 * A FOLHA DE CONSENTIMENTO — "O que este grupo vê de você".
 *
 * Ela aparece DUAS vezes na vida de um vínculo, e é a mesma folha: na entrada
 * do grupo, e depois em ⚙︎, sempre que a pessoa quiser mexer. Consentimento que
 * só pode ser dado, nunca revisto, não é consentimento — é assinatura.
 *
 * QUATRO DECISÕES DE DESENHO, e todas vêm do parecer do Fiel (C5) e do plano:
 *
 * 1. **Cada linha mostra a FRASE LITERAL que o grupo vai ler.** "Compartilhar
 *    treinos" não diz se sai a carga; "Registrou um treino — sem duração, sem
 *    carga, sem qual" diz. Consentimento com o texto real é a única forma
 *    honesta de pedir consentimento. Checkbox com texto legal é consentimento
 *    que ninguém leu, e consentimento que ninguém leu é manipulação por
 *    omissão.
 * 2. **O bloco do NUNCA é visível e não tem interruptor.** Ele existe para a
 *    pessoa poder confiar no que *não* está lá. Interruptor desligado diz
 *    "hoje não"; ausência de interruptor diz "nunca".
 * 3. **Tudo começa desligado** (N1). A tela nunca chega com nada ligado "para
 *    facilitar" — o padrão é a decisão, e um padrão aberto é uma decisão
 *    tomada pelo app no lugar da pessoa.
 * 4. **"Entrar sem compartilhar nada ainda" é um caminho de verdade.** Dá para
 *    ser só torcida. Grupo que exige oferenda para deixar entrar é pedágio, e
 *    o vínculo passa a custar dado — que é exatamente o que o produto recusa.
 *
 * DESLIGAR APAGA, e a folha diz isso: o gatilho `trg_despublicar_ao_revogar`
 * apaga o histórico publicado daquele tipo naquele grupo, não só o futuro
 * (N12). É fail-closed por deleção, não por cláusula WHERE.
 */
export default function SocialConsentSheet({
  open, onOpenChange, grupoNome, ligados, onSalvar, modo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grupoNome: string;
  /** O que já está ligado neste grupo. Vazio na entrada — nada nasce aberto. */
  ligados: readonly SocialMetricKey[];
  /** Recebe a lista final. `true` = deu certo e a folha pode fechar. */
  onSalvar: (proximos: SocialMetricKey[]) => Promise<boolean>;
  /** "entrar" muda só os rótulos dos botões: a folha é a mesma, e é de
   *  propósito — quem revisita reconhece a tela em que decidiu. */
  modo: "entrar" | "revisar";
}) {
  const [sel, setSel] = useState<Set<SocialMetricKey>>(new Set(ligados));
  const [salvando, setSalvando] = useState(false);

  // Reabrir com o estado do banco, não com o que ficou da vez anterior: esta
  // folha é a fonte da verdade sobre uma decisão de privacidade.
  useEffect(() => { if (open) setSel(new Set(ligados)); }, [open, ligados]);

  const alternar = (k: SocialMetricKey, on: boolean) =>
    setSel((atual) => {
      const proximo = new Set(atual);
      if (on) proximo.add(k); else proximo.delete(k);
      return proximo;
    });

  const salvar = async (lista: SocialMetricKey[]) => {
    setSalvando(true);
    const ok = await onSalvar(lista);
    setSalvando(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* As duas correções de toque da casa, medidas em QA e já pagas uma vez
       *  (AppLayout.tsx, achados N5 e N6). Reaproveitadas literalmente aqui:
       *
       *  N5 — o "Fechar" do SheetContent é 16x16 (um ícone de 16px num botão
       *  sem tamanho). Escape resolve no teclado; no celular não existe
       *  Escape. A caixa vira 44x44 SEM o desenho sair do lugar: o botão é
       *  `absolute right-4 top-4`, então o ícone estava centrado a 24px de
       *  cada borda (16 + 16/2); com a caixa em 44px, `right-0.5 top-0.5`
       *  recoloca esse centro exatamente em 24px (2 + 44/2).
       *
       *  N6 — `safe-bottom` sozinho ZERARIA o respiro (num aparelho sem
       *  recorte ele vale 0 e, sendo mais específico, apaga o `p-6` do
       *  próprio SheetContent). O `calc` SOMA o recorte ao padding: 24px
       *  sempre, mais o que o aparelho pedir — senão a última linha termina
       *  dentro dos ~34px do indicador de home do iPhone, onde o toque vira
       *  gesto do sistema. */}
      <SheetContent
        side="bottom"
        className={cn(
          "rounded-t-2xl max-h-[85dvh] overflow-y-auto",
          "pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
          "[&>button]:h-11 [&>button]:w-11 [&>button]:grid [&>button]:place-items-center [&>button]:right-0.5 [&>button]:top-0.5",
        )}
      >
        <SheetHeader className="text-left">
          <SheetTitle>O que este grupo vê de você</SheetTitle>
          <SheetDescription>
            {grupoNome} · Tudo começa desligado. Ligue só o que você quer que eles vejam — e
            sempre como "feito", nunca com número.
          </SheetDescription>
        </SheetHeader>

        <div className="py-4 space-y-1">
          {CATALOGO_VISIVEL.map((m) => {
            const on = sel.has(m.key);
            return (
              /* `min-h-14` e o Switch de 44px: é a tela onde se decide o que
                 sai de você para outras pessoas. Alvo pequeno aqui não é
                 desconforto, é risco de ligar o que não se queria ligar. */
              <label
                key={m.key}
                className="flex items-start gap-3 rounded-lg p-3 min-h-14 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <span className="text-lg leading-none pt-0.5 w-6 text-center shrink-0" aria-hidden>{m.emoji}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium">{m.label}</span>
                  {/* A frase literal, entre aspas, com a tinta do texto comum:
                      ela não é legenda do controle — ela É o que se decide. */}
                  <span className="block text-sm text-muted-foreground">"{m.frase}"</span>
                  <span className="block text-xs text-muted-foreground/80">{m.semOQue}</span>
                </span>
                <Switch
                  checked={on}
                  onCheckedChange={(v) => alternar(m.key, v)}
                  className="mt-0.5 shrink-0 scale-125 origin-right"
                  aria-label={`Compartilhar ${m.label} com ${grupoNome}`}
                />
              </label>
            );
          })}
        </div>

        {/* O BLOCO DO NUNCA. Sem interruptor, e sem promessa de "em breve". */}
        <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Lock className="w-4 h-4 shrink-0" /> Nunca compartilhável, em grupo nenhum
          </p>
          <p className="text-sm text-muted-foreground">
            {NUNCA_COMPARTILHAVEL.join(" · ")}
          </p>
          <p className="text-xs text-muted-foreground">
            Não é uma opção desligada: é uma coisa que o Ascende não sabe fazer. Nem se você pedir.
          </p>
        </div>

        <p className="text-xs text-muted-foreground pt-3">
          Desligar depois não apaga nada seu: o seu histórico continua seu, e o grupo
          simplesmente para de ver — inclusive o que já tinha visto daquele tipo.
        </p>

        <div className="pt-4 space-y-2">
          <Button className="w-full min-h-11" disabled={salvando} onClick={() => salvar([...sel])}>
            {salvando
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : modo === "entrar" ? "Entrar no grupo" : "Salvar"}
          </Button>

          {/* O caminho de verdade: dá para ser só torcida. Na revisão ele vira
              "desligar tudo", que é a mesma ação com o nome que ela tem ali. */}
          <Button
            variant="ghost" className="w-full min-h-11 text-muted-foreground"
            disabled={salvando} onClick={() => salvar([])}
          >
            {modo === "entrar" ? "Entrar sem compartilhar nada ainda →" : "Desligar tudo"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
