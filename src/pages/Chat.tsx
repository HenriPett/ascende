import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Send, Loader2, Sparkles } from "lucide-react";
import { Markdown } from "@/components/core/Markdown";
import { cn } from "@/lib/utils";

interface Msg { id?: string; role: "user" | "assistant"; content: string; pending?: boolean }

const SUGGESTIONS = [
  "Monte um plano alimentar para ganho de massa que caiba no meu orçamento",
  "Como está minha vida esta semana?",
  "O que meus dados dizem que eu deveria melhorar primeiro?",
  "Quanto posso gastar com lazer este mês sem me apertar?",
];

export default function Chat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [local, setLocal] = useState<Msg[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: history, isLoading } = useQuery({
    queryKey: ["chat", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("chat_messages")
        .select("id,role,content").eq("user_id", user!.id)
        .order("created_at", { ascending: true }).limit(200);
      return (data ?? []) as Msg[];
    },
  });

  const messages = [...(history ?? []), ...local];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);
    setLocal((l) => [...l, { role: "user", content }]);
    try {
      const { data, error } = await supabase.functions.invoke("ai-chat", { body: { message: content } });
      if (error || data?.error) throw new Error(data?.error ?? "erro");
      setLocal([]);
      qc.invalidateQueries({ queryKey: ["chat", user?.id] });
    } catch (e) {
      setLocal((l) => l.filter((m) => m.content !== content));
      const msg = e instanceof Error && e.message !== "erro" ? e.message
        : "O Conselheiro não respondeu agora. Tente de novo em instantes.";
      toast.error(msg);
      setInput(content);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-7rem)]">
      <div className="mb-3">
        <h1 className="font-display text-2xl font-semibold">Conselheiro</h1>
        <p className="text-sm text-muted-foreground">
          A única IA que enxerga suas finanças, corpo, alimentação e mente ao mesmo tempo.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-3 pr-1">
        {isLoading && <Skeleton className="h-16 w-3/4" />}

        {!isLoading && messages.length === 0 && (
          <div className="space-y-2 pt-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-gold" /> Algumas coisas que só eu consigo responder:
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full text-left text-sm rounded-lg border bg-card p-3 hover:bg-muted/60 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={m.id ?? `local-${i}`} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] min-w-0 break-words rounded-2xl px-4 py-2.5 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm leading-relaxed whitespace-pre-line"
                  : "bg-card border rounded-bl-sm"
              )}
            >
              {m.role === "user" ? m.content : <Markdown content={m.content} />}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-card border rounded-2xl rounded-bl-sm px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 items-end pt-2 border-t">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte qualquer coisa sobre a sua vida..."
          rows={1}
          maxLength={4000}
          className="resize-none min-h-[44px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <Button size="icon" onClick={() => send()} disabled={sending || !input.trim()} aria-label="Enviar">
          <Send className="w-4 h-4" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground pt-1.5">
        O Conselheiro não substitui médicos, psicólogos, nutricionistas ou consultores de investimento.
      </p>
    </div>
  );
}