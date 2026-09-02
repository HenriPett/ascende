import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, type Profile } from "@/hooks/useProfile";

/* A preferência do Mokari — e nada mais.
 *
 * Este hook é a ÚNICA porta de entrada da preferência no app. É de propósito:
 * a quinta regra do contrato ("desativar não afeta função nenhuma") só é
 * verificável se existir um lugar só para checar, e nenhum outro caminho lendo
 * `mokari_enabled` por conta própria. `src/lib/mokariIsolation.test.ts` falha
 * se alguém abrir uma segunda porta.
 *
 * TRÊS estados, num campo anulável:
 *   null  → nunca perguntamos: o convite aparece UMA vez, na Jornada
 *   false → ela disse não, ou ligou e depois desligou: silêncio
 *   true  → ligado
 *
 * O convite pede uma vez e respeita o silêncio. Personagem que aparece sem ser
 * convidado, no app de quem está tentando organizar a vida, é atrito. */

export type MokariPreference = "nunca_perguntado" | "ligado" | "desligado";

export function useMokariPreference() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const qc = useQueryClient();

  const ready = !!profile;
  const raw = profile?.mokari_enabled ?? null;
  const state: MokariPreference =
    raw === true ? "ligado" : raw === false ? "desligado" : "nunca_perguntado";

  /** Escrita otimista: a tela responde na hora e o banco sincroniza depois.
   *  Falhar aqui nunca pode atrapalhar o uso do app — no pior caso a
   *  preferência volta ao que era no próximo carregamento. */
  const persist = useCallback(async (value: boolean) => {
    if (!user) return;
    qc.setQueryData(["profile", user.id], (p: Profile | null | undefined) =>
      p ? { ...p, mokari_enabled: value } : p);
    const { error } = await supabase.from("profiles")
      .update({ mokari_enabled: value }).eq("user_id", user.id);
    if (error) console.error("mokari: falha ao sincronizar preferência", error.message ?? error);
  }, [user, qc]);

  return {
    /** false enquanto o perfil carrega — para nunca piscar convite na tela de
     *  quem já respondeu. */
    ready,
    state,
    enabled: ready && state === "ligado",
    /** O convite só aparece para quem nunca foi perguntado. */
    shouldInvite: ready && state === "nunca_perguntado",
    setEnabled: (value: boolean) => { if (ready) void persist(value); },
    /** Recusar o convite grava `false`: é o que faz o silêncio ser respeitado
     *  em vez de o convite voltar na próxima visita. */
    decline: () => { if (ready) void persist(false); },
  };
}
