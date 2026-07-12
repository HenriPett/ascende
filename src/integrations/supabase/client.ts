import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Variáveis do Supabase não configuradas. " +
      "Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env (local) ou no painel do Netlify."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    // "implicit" (tokens voltam no fragmento da URL) em vez do padrão PKCE.
    // Motivo: no app instalado (PWA, especialmente iOS), o retorno do OAuth
    // abre num overlay de navegador que pode ser OUTRO container de storage.
    // No PKCE, o code_verifier fica no storage da janela que INICIOU o
    // login — o overlay que recebe o ?code= não o tem, a troca falha em
    // silêncio e a sessão não nasce em lugar nenhum. Com o fluxo implícito,
    // quem recebe o retorno se basta: a sessão nasce ali (e, no iOS moderno,
    // o overlay do web app compartilha o data store com o app — o app entra
    // sozinho ao ganhar foco). Trade-off aceito: tokens transitam no
    // fragmento da URL (não vai a servidor/logs) sob HTTPS + allowlist de
    // redirect no Supabase — o padrão da web por muitos anos.
    flowType: "implicit",
  },
});