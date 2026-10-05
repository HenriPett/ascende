import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody,
} from "@/components/ui/drawer";
import { Switch } from "@/components/ui/switch";
import { Lock } from "lucide-react";
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
  /** O ATO que abriu esta folha, e não o estado do consentimento:
   *  · `entrar`  — acabei de aceitar um convite. Ainda não sou membro no meu
   *                próprio entendimento, e o botão fecha a entrada.
   *  · `criar`   — acabei de criar o grupo. Já sou dona dele: "Entrar no
   *                grupo" seria o app me convidando para onde eu já estou.
   *  · `revisar` — abri pela engrenagem, a qualquer momento.
   *  A distinção existe porque o modo já foi derivado de "ainda não consenti
   *  nada" uma vez, e aí a dona de um grupo de três semanas lia "Entrar no
   *  grupo" toda vez que abria a folha. */
  modo: "entrar" | "criar" | "revisar";
}) {
  /* O estado é chave → META, não um conjunto de chaves, e isso não é detalhe
     de implementação: `group_data_consents.goal_value` é NOT NULL, então não
     existe ligar um tipo sem combinar quanto. Faz sentido — sem denominador a
     tela só teria número absoluto, e número absoluto ao lado de número
     absoluto já é um ranking, mesmo sem coluna de posição. */
  const [sel, setSel] = useState<Map<SocialMetricKey, number>>(new Map());
  /* O QUE ELA ESTÁ DIGITANDO, antes de virar número.
     Sem isto o campo era controlado pelo valor já grampeado em 1..7, e aí
     TODO estado intermediário do teclado era inalcançável: apagar o campo dava
     `Number("") || 0` -> `max(1, …)` -> 1, e digitar um dígito depois do que já
     estava lá fazia "5"+"6" = "56" -> 7. O campo aceitava exatamente dois
     valores, 1 e 7, e nenhum dos dois era o que ela quis digitar.
     A regra continua a mesma (1 a 7); o que muda é QUANDO ela é aplicada —
     ao sair do campo, não a cada tecla. Um campo vazio é um estado legítimo
     de digitação, não um zero a ser corrigido. */
  const [rascunho, setRascunho] = useState<Map<SocialMetricKey, string>>(new Map());
  const [salvando, setSalvando] = useState(false);

  // Reabrir com o estado do banco, não com o que ficou da vez anterior: esta
  // folha é a fonte da verdade sobre uma decisão de privacidade.
  useEffect(() => {
    if (!open) return;
    setSel(new Map(linhas.filter((l) => l.ligado).map((l) => [l.key, l.meta ?? META_PADRAO])));
    setRascunho(new Map());
  }, [open, linhas]);

  const alternar = (k: SocialMetricKey, on: boolean) =>
    setSel((atual) => {
      const proximo = new Map(atual);
      if (on) proximo.set(k, atual.get(k) ?? META_PADRAO); else proximo.delete(k);
      return proximo;
    });

  /** O texto vira meta. Fora do componente porque é a regra, e regra que mora
   *  dentro de um `onChange` é regra que ninguém consegue testar nem achar.
   *  Vazio ou lixo devolve `null` — "ainda não é um número" é diferente de
   *  "é um número ruim", e só o segundo merece ser corrigido. */
  const metaDoTexto = (bruto: string): number | null => {
    const digitos = bruto.replace(/\D/g, "");
    if (!digitos) return null;
    return Math.max(1, Math.min(7, Number(digitos)));
  };

  // A CADA TECLA: guarda o que ela digitou, no máximo dois dígitos, e não
  // grampeia nada. É isto que deixa o campo passar por vazio.
  const mudarMeta = (k: SocialMetricKey, bruto: string) => {
    if (!sel.has(k)) return;
    setRascunho((atual) => new Map(atual).set(k, bruto.replace(/\D/g, "").slice(0, 2)));
  };

  // AO SAIR DO CAMPO: aí sim vale a régua. Saiu com o campo vazio, mantém o
  // que estava — apagar um número não é pedir para combinar zero, e zero não
  // existe aqui (o banco tem `check (goal_value > 0)`).
  const confirmarMeta = (k: SocialMetricKey) => {
    const n = metaDoTexto(rascunho.get(k) ?? "");
    if (n !== null) setSel((atual) => (atual.has(k) ? new Map(atual).set(k, n) : atual));
    setRascunho((atual) => { const p = new Map(atual); p.delete(k); return p; });
  };

  const salvar = async (lista: { key: SocialMetricKey; meta: number }[]) => {
    setSalvando(true);
    const ok = await onSalvar(lista);
    setSalvando(false);
    if (ok) onOpenChange(false);
  };

  const visiveis = linhas.filter((l) => isShareable(l.key));

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {/* A folha de baixo da casa (ui/drawer.tsx): fecha arrastando, tem
          puxador, e o Fechar de 44 pt e o respiro do indicador de início já vêm
          do primitivo. As correções N5 e N6, que antes eram repetidas à mão em
          cada folha, moram lá agora — e por isso não há sobrescrita aqui. */}
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>O que este grupo vê de você</DrawerTitle>
          <DrawerDescription>
            {grupoNome} · Tudo começa desligado. Ligue só o que você quer que eles vejam — e
            sempre como "feito", nunca com número.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>

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
                    {/* Sem a opacidade de 80%: ela levava esta linha a 3,40:1, e é
                        a que diz o que NÃO sai daqui — o consentimento informado
                        em si. A hierarquia vem do tamanho, não da transparência. */}
                    <span className="block text-xs text-muted-foreground">{m.semOQue}</span>
                    {/* O preview honesto: não "o que eles poderiam ver", e sim
                        o que este grupo JÁ pode somar de você. */}
                    {l.diasPublicados > 0 && (
                      <span className="block text-xs text-muted-foreground">
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
                      value={rascunho.get(l.key) ?? String(sel.get(l.key) ?? META_PADRAO)}
                      onChange={(e) => mudarMeta(l.key, e.target.value)}
                      onBlur={() => confirmarMeta(l.key)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
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
            onClick={() => salvar([...sel].map(([key, meta]) => ({
              key, meta: metaDoTexto(rascunho.get(key) ?? "") ?? meta,
            })))}
            loading={salvando}
          >
            {modo === "entrar" ? "Entrar no grupo"
                : modo === "criar" ? "Começar assim" : "Salvar"}
          </Button>

          {/* O caminho de verdade: dá para ser só torcida. Na revisão ele vira
              "desligar tudo", que é a mesma ação com o nome que ela tem ali. */}
          <Button
            variant="ghost" className="w-full min-h-11 text-muted-foreground"
            disabled={salvando} onClick={() => salvar([])}
          >
            {/* A seta é desenho, não palavra: o VoiceOver a leria como
                "seta para a direita" no meio do rótulo. */}
            {modo === "entrar" ? <>Entrar sem compartilhar nada ainda <span aria-hidden>→</span></>
              : modo === "criar" ? <>Começar sem compartilhar nada <span aria-hidden>→</span></>
                : "Desligar tudo"}
          </Button>
        </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
