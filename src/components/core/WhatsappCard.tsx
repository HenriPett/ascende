// Vínculo do WhatsApp (Ajustes) — canal de RETORNO ao app.
//
// Fluxo de pareamento seguro: o app só gera um código de 6 dígitos (RPC);
// quem grava o telefone é o webhook, ao receber o código DO próprio número.
// Assim ninguém consegue vincular um número que não possui.
//
// Config do frontend: VITE_WHATSAPP_NUMBER no .env (só dígitos, com DDI,
// ex.: 5547999999999) — usado para montar o link wa.me com o código pronto.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useWhatsappLinkQuery, useHasAnyEventQuery, type WhatsappLink as WaLink,
} from "@/hooks/useZoneQueries";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { MessageCircle, Loader2, Copy, ExternalLink, Unlink, X } from "lucide-react";

const WA_NUMBER: string = (import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined) ?? "";

const maskPhone = (p: string) =>
  p.length > 6 ? `+${p.slice(0, 4)} ••••• ${p.slice(-4)}` : `+${p}`;

/* ── Convite compacto para a tela Hoje (feedback do fundador): Ajustes é onde
   pouca gente passeia — o convite mora onde o hábito acontece. Regras de
   respeito: só aparece para quem NÃO vinculou, só depois do primeiro registro
   (não compete com o dia 1), e o X dispensa PARA SEMPRE (nunca vira cobrança,
   coerente com /recusas). O pareamento acontece aqui mesmo, em 3 toques. ── */
export function WhatsappHojeCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("ascend-wa-hoje-dismissed") === "1",
  );
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: link, isLoading } = useWhatsappLinkQuery(code);

  // Só depois do primeiro registro (não compete com o dia 1 do onboarding)
  const { data: hasEvents } = useHasAnyEventQuery(!dismissed && !link?.linked_at);

  useEffect(() => {
    // Vinculou com o código deste card: celebra e some.
    if (code && link?.linked_at) {
      toast.success("WhatsApp conectado ✓ Agora é só mandar uma frase por lá.");
      setCode(null);
    }
  }, [code, link?.linked_at]);

  if (dismissed || isLoading || link?.linked_at || !hasEvents) return null;

  const dismiss = () => { localStorage.setItem("ascend-wa-hoje-dismissed", "1"); setDismissed(true); };

  const generate = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("create_whatsapp_pairing_code");
    setBusy(false);
    if (error || !data) { toast.error("Não consegui gerar o código. Tente de novo."); return; }
    setCode(String(data));
    qc.invalidateQueries({ queryKey: ["whatsapp-link"] });
  };

  const waHref = code && WA_NUMBER
    ? `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(code)}`
    : null;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <MessageCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(142 70% 45%)" }} />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm font-semibold">Registre pelo WhatsApp</p>
            <p className="text-xs text-muted-foreground">
              "Gastei 47 no mercado e treinei" por mensagem vira registro aqui —
              e o Conselheiro responde por lá também.
            </p>
          </div>
          {code ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-display text-lg font-semibold tracking-[0.25em] rounded-lg border bg-background px-3 py-1">
                  {code}
                </span>
                {waHref && (
                  <Button asChild size="sm">
                    <a href={waHref} target="_blank" rel="noreferrer">
                      <ExternalLink className="w-3.5 h-3.5 mr-1" /> Enviar no WhatsApp
                    </a>
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Mande o código (vale 15 min). Assim que chegar, confirmo aqui sozinho.
              </p>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={generate} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Conectar em 3 toques"}
            </Button>
          )}
        </div>
        <button onClick={dismiss} className="text-muted-foreground hover:text-foreground" aria-label="Dispensar convite do WhatsApp">
          <X className="w-4 h-4" />
        </button>
      </div>
    </Card>
  );
}

export default function WhatsappCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: link, isLoading } = useWhatsappLinkQuery(code);

  const linked = !!link?.linked_at && !!link?.phone;

  const generate = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("create_whatsapp_pairing_code");
    setBusy(false);
    if (error || !data) { toast.error("Não consegui gerar o código. Tente de novo."); return; }
    setCode(String(data));
  };

  const setPrefs = async (patch: Partial<Pick<WaLink, "notify_retro" | "notify_briefing" | "notify_return">>) => {
    if (!link) return;
    const next = { ...link, ...patch };
    qc.setQueryData(["whatsapp-link", user?.id], next); // otimista
    const { error } = await supabase.rpc("set_whatsapp_prefs", {
      retro: next.notify_retro, briefing: next.notify_briefing, ret: next.notify_return,
    });
    if (error) {
      qc.invalidateQueries({ queryKey: ["whatsapp-link"] });
      toast.error("Não consegui salvar a preferência.");
    }
  };

  const unlink = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("unlink_whatsapp");
    setBusy(false);
    if (error) { toast.error("Não consegui desvincular."); return; }
    setCode(null);
    qc.invalidateQueries({ queryKey: ["whatsapp-link"] });
    toast.success("WhatsApp desvinculado. Nada do seu número ficou guardado.");
  };

  const waHref = code && WA_NUMBER
    ? `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(code)}`
    : null;

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="font-display font-semibold flex items-center gap-1.5">
          <MessageCircle className="w-4 h-4" style={{ color: "hsl(142 70% 45%)" }} /> WhatsApp
        </h2>
        <p className="text-xs text-muted-foreground">
          Registre o dia por mensagem ("gastei 47 no mercado e treinei") confirmando no botão,
          ou converse com o Conselheiro ("tô gastando demais esse mês?") — a conversa continua
          no app de onde parou. E o Ascende te avisa quando a retrospectiva estiver pronta.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : linked ? (
        <div className="space-y-3">
          <p className="text-sm">
            Conectado a <strong>{maskPhone(link!.phone!)}</strong>
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="wa-retro" className="text-sm font-normal">
                Retrospectiva de domingo
                <span className="block text-[11px] text-muted-foreground">Um aviso por semana, quando ela ficar pronta</span>
              </Label>
              <Switch id="wa-retro" checked={link!.notify_retro}
                onCheckedChange={(v) => setPrefs({ notify_retro: v })} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="wa-brief" className="text-sm font-normal">
                Briefing diário <span className="text-[11px] text-gold-ink">Ascende+</span>
                <span className="block text-[11px] text-muted-foreground">Toda manhã, quando o briefing do dia estiver no app</span>
              </Label>
              <Switch id="wa-brief" checked={link!.notify_briefing}
                onCheckedChange={(v) => setPrefs({ notify_briefing: v })} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="wa-return" className="text-sm font-normal">
                Convite de retorno
                <span className="block text-[11px] text-muted-foreground">Se você sumir uns dias, um lembrete gentil (no máximo 1 a cada 2 semanas)</span>
              </Label>
              <Switch id="wa-return" checked={link!.notify_return}
                onCheckedChange={(v) => setPrefs({ notify_return: v })} />
            </div>
          </div>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={unlink} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Unlink className="w-3.5 h-3.5 mr-1.5" /> Desvincular número</>)}
          </Button>
        </div>
      ) : code ? (
        <div className="space-y-3">
          <p className="text-sm">
            Mande este código pelo seu WhatsApp para o número do Ascende (vale por 15 minutos):
          </p>
          <div className="flex items-center gap-2">
            <span className="font-display text-2xl font-semibold tracking-[0.3em] rounded-lg border bg-background px-4 py-2">
              {code}
            </span>
            <Button variant="outline" size="icon" aria-label="Copiar código"
              onClick={() => { navigator.clipboard?.writeText(code); toast.success("Código copiado."); }}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          {waHref ? (
            <Button asChild className="w-full">
              <a href={waHref} target="_blank" rel="noreferrer">
                <ExternalLink className="w-4 h-4 mr-1.5" /> Abrir WhatsApp com o código pronto
              </a>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Envie o código para o número oficial do Ascende no WhatsApp.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Assim que o código chegar, esta tela confirma o vínculo sozinha.
          </p>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={generate} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Conectar meu WhatsApp"}
        </Button>
      )}
    </Card>
  );
}