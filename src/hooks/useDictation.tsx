import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Reconhecimento de voz do navegador (Chrome, Edge e Safari)
type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start: () => void; stop: () => void;
};

/**
 * Ditado por voz em pt-BR. Cada trecho final reconhecido é entregue em `onText`.
 * Retorna { listening, toggle, stop } — `toggle` liga/desliga o microfone.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => { recRef.current?.stop(); }, []);

  const toggle = useCallback(() => {
    if (listening) { recRef.current?.stop(); return; }
    // deno-lint não se aplica aqui; APIs sem tipos oficiais no TS
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      toast.error("Seu navegador não suporta ditado por voz. Funciona no Chrome, Edge e Safari.");
      return;
    }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const ev = e as { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] };
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
      }
      if (final.trim()) onTextRef.current(final.trim());
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    rec.onerror = (e) => {
      setListening(false); recRef.current = null;
      if ((e as { error?: string })?.error === "not-allowed") {
        toast.error("Permita o acesso ao microfone para usar o ditado por voz.");
      }
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, [listening]);

  // Desliga o microfone ao sair da tela
  useEffect(() => () => { recRef.current?.stop(); }, []);

  return { listening, toggle, stop };
}
