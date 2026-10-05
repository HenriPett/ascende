import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody,
} from "@/components/ui/drawer";
import { Copy, Share2, X, Check } from "lucide-react";
import { toast } from "sonner";

export interface ConviteAberto {
  id: string;
  criadoEm: string;
  expiraEm: string;
}

/**
 * O CONVITE — e a regra que vale mais que o desenho: **o app nunca envia.**
 *
 * Sem SMS, sem e-mail, sem push para quem não é usuário. Nenhuma leitura de
 * agenda, de contatos ou de lista do WhatsApp. Isso não é uma limitação que a
 * gente vai remover quando der: é o motor de crescimento viral clássico, e é
 * também a maior porta de dados alheios que este app poderia abrir. Não abre.
 * O convite é um link que A PESSOA manda pelo canal onde as duas já se falam.
 *
 * PEDIR DUAS VEZES É COBRAR (padrão do MokariInvite). Por isso não existe, em
 * lugar nenhum desta folha:
 *  · lembrete para o convidado;
 *  · "Ana ainda não respondeu, chamar de novo?" para quem convidou;
 *  · contagem regressiva com urgência fabricada (N14 — nada de "expira em 2h"
 *    que não corresponda a um limite real do sistema).
 * Convite não aceito **expira em silêncio**. Quem quiser insistir insiste fora
 * do app, como gente.
 *
 * O CÓDIGO APARECE UMA VEZ SÓ, e isso é decisão de segurança da Aduana, não
 * economia de tela: `group_invites` guarda o HASH, nunca o código — mesmo
 * raciocínio dos 6 dígitos do pareamento de WhatsApp. Um código curto legível
 * para sempre é um código força-brutável até entrar no grupo de outra gente.
 * Por isso a lista de convites em aberto mostra uma referência opaca e a data,
 * nunca o link de novo.
 */
export default function SocialInviteSheet({
  open, onOpenChange, link, abertos, criando, onCriar, onCancelar, aviso5,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** O link recém-criado, visível uma única vez. `null` = ainda não criou. */
  link: string | null;
  abertos: readonly ConviteAberto[];
  criando: boolean;
  onCriar: () => Promise<void>;
  onCancelar: (id: string) => Promise<void>;
  /** Verdadeiro a partir do 5º membro. Não bloqueia: só nomeia. */
  aviso5: boolean;
}) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.dismiss("Não consegui copiar. Selecione o link acima e copie à mão.");
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Área de transferência bloqueada (http, permissão negada): o link está
      // na tela e dá para selecionar à mão. Falhar em silêncio aqui deixaria
      // a pessoa achando que copiou.
      toast.error("Não consegui copiar. Selecione o link acima e copie à mão.");
    }
  };

  const compartilhar = async () => {
    if (!link) return;
    // `navigator.share` abre a folha do SISTEMA: quem escolhe o canal e o
    // destinatário é a pessoa, no app dela. O Ascende não vê para quem foi.
    if (!navigator.share) { copiar(); return; }
    try { await navigator.share({ text: link }); } catch { /* cancelou: nada a dizer */ }
  };

  const dia = (iso: string) =>
    new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {/* A folha de baixo da casa (ui/drawer.tsx): fecha arrastando, tem
          puxador, e o Fechar de 44 pt e o respiro do indicador de início já vêm
          do primitivo. As correções N5 e N6, que antes eram repetidas à mão em
          cada folha, moram lá agora — e por isso não há sobrescrita aqui. */}
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Chamar alguém</DrawerTitle>
          <DrawerDescription>
            Um link. Você manda por onde já fala com a pessoa — WhatsApp, no olho, o que for.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>

        <div className="py-4 space-y-3">
          {link ? (
            <>
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-sm break-all select-all">{link}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1 min-h-11" onClick={copiar}>
                  {copiado
                    ? (<><Check className="w-4 h-4 mr-1.5" /> Copiado</>)
                    : (<><Copy className="w-4 h-4 mr-1.5" /> Copiar link</>)}
                </Button>
                <Button variant="secondary" className="flex-1 min-h-11" onClick={compartilhar}>
                  <Share2 className="w-4 h-4 mr-1.5" /> Compartilhar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Guarde agora: por segurança, este link não aparece de novo. Se perder,
                crie outro — o antigo você pode cancelar aqui embaixo.
              </p>
            </>
          ) : (
            <Button className="w-full min-h-11" onClick={onCriar} disabled={criando} loading={criando}>
              Criar um link de convite
            </Button>
          )}

          <p className="text-xs text-muted-foreground">
            Vale para 1 pessoa e expira em 7 dias. O Ascende não manda nada para ela:
            quem convida é você. E se ela não responder, o convite vence em silêncio —
            ninguém é lembrado, dos dois lados.
          </p>

          {aviso5 && (
            /* Não bloqueia. Só nomeia — e nomear é o que permite a pessoa
               decidir com o que ela já sabe, em vez de descobrir depois. */
            <p className="text-sm rounded-lg border border-warning/40 bg-warning/5 p-3">
              Grupos pequenos funcionam melhor. A partir daqui, isso começa a virar plateia.
            </p>
          )}
        </div>

        {abertos.length > 0 && (
          <div className="border-t pt-3 space-y-2">
            <p className="text-sm font-medium">Convites em aberto</p>
            {abertos.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground flex-1 min-w-0">
                  {/* SEM PREFIXO DO CÓDIGO, e é impossível ter um: o banco
                      guarda só o `sha256` do código, de propósito — "este link
                      não aparece de novo" é promessa de schema, não de tela.
                      O que estava aqui era o prefixo do `id` DA LINHA
                      (`afe93…`), que não tem relação nenhuma com o código que
                      a pessoa tem na mão (`56AB43…`): com dois convites
                      abertos, cancelar virava chute. Identificar pelas DATAS é
                      o que ela consegue conferir — ela sabe quando pediu cada
                      um. */}
                  criado {dia(c.criadoEm)}{" · "}vence {dia(c.expiraEm)}
                </p>
                <Button
                  variant="ghost" size="sm"
                  className="min-h-11 shrink-0 text-muted-foreground"
                  onClick={() => onCancelar(c.id)}
                >
                  <X className="w-4 h-4 mr-1" /> cancelar
                </Button>
              </div>
            ))}
            {/* Nenhuma linha diz se alguém abriu, viu ou ignorou o convite.
                Saber que "ela viu e não entrou" é informação que só serve para
                cobrar. */}
          </div>
        )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
