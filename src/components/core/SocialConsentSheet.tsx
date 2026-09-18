import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Lock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { FRASE_DE, NUNCA_COMPARTILHAVEL } from "@/components/core/socialPhrases";
import { isShareable, type SocialMetricKey } from "@/lib/socialMetrics";
import { WEEK_DAYS_PER_PERSON } from "@/lib/socialChallenge";

/**
 * Uma linha da folha, como o banco a devolve (`v_meus_consentimentos`).
 *
 * A view lista o CATÁLOGO INTEIRO — ligado e desligado — porque a tela precisa
 * mostrar o que está FECHADO com o mesmo destaque do que está aberto. Um
 * catálogo que só mostra o que você ligou esconde o que você recusou, e aí a
 * recusa deixa de ser uma decisão visível.
 */
export interface ConsentimentoDaFolha {
  key: SocialMetricKey;
  /** O rótulo vem do BANCO (`shareable_metrics.label`), não de uma lista aqui:
   *  o catálogo é fechado por migration e é ele quem manda. */
  label: string;
  /** O teste do zero, escrito pelo banco. É o que justifica a métrica existir,
   *  e a folha mostra para a pessoa a mesma frase que a mesa do Fiel olhou. */
  oQueOZeroDiz: string;
  ligado: boolean;
  /** A meta combinada. `null` quando o tipo está desligado — não existe meta
   *  sem consentimento, porque as duas moram na MESMA linha do banco. */
  meta: number | null;
  /** Quantos dias meus este grupo já pode somar deste tipo. O preview honesto
   *  da condição C5: não "o que eles poderiam ver", e sim o que já está lá. */
  diasPublicados: number;
}

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
/** A meta padrão de quem acabou de ligar um tipo: cinco de sete, a mesma régua
 *  do desafio. Os dois dias de folga por pessoa já estão dentro dela — e o
 *  padrão importa, porque a maioria não vai mexer no número. */
const META_PADRAO = WEEK_DAYS_PER_PERSON;

export default function SocialConsentSheet({
  open, onOpenChange, grupoNome, linhas, onSalvar, modo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grupoNome: string;
  /** O catálogo inteiro para ESTE grupo, ligado e desligado. */
  linhas: readonly ConsentimentoDaFolha[];
  /** Recebe a lista final, cada uma com a meta. `true` = deu certo. */
  onSalvar: (proximos: { key: SocialMetricKey; meta: number }[]) => Promise<boolean>;
  /** "entrar" muda só os rótulos dos botões: a folha é a mesma, e é de
   *  propósito — quem revisita reconhece a tela em que decidiu. */
  modo: "entrar" | "revisar";
}) {
  /* O estado é chave → META, não um conjunto de chaves, e isso não é detalhe
     de implementação: `group_data_consents.goal_value` é NOT NULL, então não
     existe ligar um tipo sem combinar quanto. Faz sentido — sem denominador a
     tela só teria número absoluto, e número absoluto ao lado de número
     absoluto já é um ranking, mesmo sem coluna de posição. */
  const [sel, setSel] = useState<Map<SocialMetricKey, number>>(new Map());
  const [salvando, setSalvando] = useState(false);

  // Reabrir com o estado do banco, não com o que ficou da vez anterior: esta
  // folha é a fonte da verdade sobre uma decisão de privacidade.
  useEffect(() => {
    if (!open) return;
    setSel(new Map(linhas.filter((l) => l.ligado).map((l) => [l.key, l.meta ?? META_PADRAO])));
  }, [open, linhas]);

  const alternar = (k: SocialMetricKey, on: boolean) =>
    setSel((atual) => {
      const proximo = new Map(atual);
      if (on) proximo.set(k, atual.get(k) ?? META_PADRAO); else proximo.delete(k);
      return proximo;
    });

  const mudarMeta = (k: SocialMetricKey, bruto: string) =>
    setSel((atual) => {
      if (!atual.has(k)) return atual;
      const n = Math.max(1, Math.min(7, Math.round(Number(bruto.replace(/\D/g, "")) || 0)));
      return new Map(atual).set(k, n);
    });

  const salvar = async (lista: { key: SocialMetricKey; meta: number }[]) => {
    setSalvando(true);
    const ok = await onSalvar(lista);
    setSalvando(false);
    if (ok) onOpenChange(false);
  };

  const visiveis = linhas.filter((l) => isShareable(l.key));

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
          {visiveis.map((l) => {
            const m = FRASE_DE[l.key];
            const on = sel.has(l.key);
            return (
              /* `min-h-14` e o Switch de 44px: é a tela onde se decide o que
                 sai de você para outras pessoas. Alvo pequeno aqui não é
                 desconforto, é risco de ligar o que não se queria ligar. */
              <div key={l.key} className="rounded-lg hover:bg-muted/50 transition-colors">
                <label className="flex items-start gap-3 p-3 min-h-14 cursor-pointer">
                  <span className="text-lg leading-none pt-0.5 w-6 text-center shrink-0" aria-hidden>{m.emoji}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium">{l.label}</span>
                    {/* A frase literal, entre aspas, com a tinta do texto comum:
                        ela não é legenda do controle — ela É o que se decide. */}
                    <span className="block text-sm text-muted-foreground">"{m.frase}"</span>
                    <span className="block text-xs text-muted-foreground/80">{m.semOQue}</span>
                    {/* O preview honesto: não "o que eles poderiam ver", e sim
                        o que este grupo JÁ pode somar de você. */}
                    {l.diasPublicados > 0 && (
                      <span className="block text-xs text-muted-foreground/80">
                        Este grupo já pode somar {l.diasPublicados}{" "}
                        {l.diasPublicados === 1 ? "dia seu" : "dias seus"} deste tipo.
                      </span>
                    )}
                  </span>
                  <Switch
                    checked={on}
                    onCheckedChange={(v) => alternar(l.key, v)}
                    className="mt-0.5 shrink-0 scale-125 origin-right"
                    aria-label={`Compartilhar ${l.label} com ${grupoNome}`}
                  />
                </label>

                {/* A META, e ela só existe quando o tipo está ligado — porque
                    no banco as duas moram na mesma linha. É o denominador que
                    permite "3 de 3" em vez de "3", e é o que faz quem combinou
                    2 e cumpriu aparecer completo ao lado de quem combinou 6. */}
                {on && (
                  <div className="flex items-center gap-2 px-3 pb-3 pl-12">
                    <span className="text-xs text-muted-foreground">Eu combino</span>
                    <Input
                      inputMode="numeric" className="h-11 w-16 text-center"
                      value={String(sel.get(l.key) ?? META_PADRAO)}
                      onChange={(e) => mudarMeta(l.key, e.target.value)}
                      aria-label={`Quantas vezes por semana você combina ${l.label}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {(sel.get(l.key) ?? META_PADRAO) === 1 ? "vez" : "vezes"} por semana
                    </span>
                  </div>
                )}
              </div>
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
          simplesmente para de ver — inclusive o que já tinha visto daquele tipo. Ligar
          de novo não traz o passado de volta: o grupo vê a partir do dia em que você
          ligou, nunca antes.
        </p>

        <div className="pt-4 space-y-2">
          <Button
            className="w-full min-h-11" disabled={salvando}
            onClick={() => salvar([...sel].map(([key, meta]) => ({ key, meta })))}
          >
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
