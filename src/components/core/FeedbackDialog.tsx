// ASCENDE — Feedback (canal TEMPORÁRIO durante a fase de consolidação/piloto).
// Grava direto na tabela `feedback` (RLS: cada usuário insere e vê só o seu).
// Fica disponível no topo do app e em Ajustes; remova quando o piloto acabar.
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, MessageSquarePlus, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { id: "ideia", label: "Ideia" },
  { id: "problema", label: "Problema" },
  { id: "elogio", label: "Elogio" },
  { id: "outro", label: "Outro" },
] as const;

export default function FeedbackDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["id"]>("ideia");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!user || message.trim().length < 3) {
      toast.error("Escreva pelo menos algumas palavras.");
      return;
    }
    setSending(true);
    const { error } = await supabase.from("feedback").insert({
      user_id: user.id,
      category,
      message: message.trim().slice(0, 2000),
      page: location.pathname.slice(0, 120),
    });
    setSending(false);
    if (error) {
      toast.error("Não consegui enviar agora. Tente de novo em instantes.");
      return;
    }
    toast.success("Feedback enviado. Obrigado por ajudar a construir o Ascende!");
    setMessage("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Enviar feedback sobre a plataforma"
            title="Enviar feedback"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Conte para a gente</DialogTitle>
          <DialogDescription>
            O Ascende está em fase de consolidação: ideias, problemas e elogios
            enviados aqui vão direto para quem constrói a plataforma.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={cn(
                  "text-xs rounded-full border px-3 py-1.5 transition-colors",
                  category === c.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-muted"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              category === "problema"
                ? "O que aconteceu? Em qual tela? O que você esperava que acontecesse?"
                : "Escreva à vontade — tudo é lido."
            }
            rows={5}
            maxLength={2000}
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button onClick={send} disabled={sending || message.trim().length < 3}>
              {sending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : (<><Send className="w-4 h-4 mr-1.5" /> Enviar feedback</>)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
