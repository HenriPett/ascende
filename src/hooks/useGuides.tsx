import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, type Profile } from "@/hooks/useProfile";
import { ALL_GUIDE_IDS, type GuideId } from "@/lib/guides";

/**
 * Estado do guia de primeiras vezes.
 * - shouldShow(id): a dica ainda não foi vista? (false enquanto o perfil carrega,
 *   para nunca piscar dica na tela de quem já a viu)
 * - markSeen(ids): marca como vista — chamada pelo botão "Entendi" E pelas ações
 *   da própria função (auto-dispensa: usou, não precisa mais da dica)
 * - disableAll(): desliga todas as dicas de uma vez
 * - resetAll(): volta a mostrar tudo (botão em Ajustes)
 * A escrita é otimista: a dica some na hora e o banco sincroniza em seguida.
 */
export function useGuides() {
  const { user } = useAuth();
  const { profile, isError } = useProfile();
  const qc = useQueryClient();

  const seen = new Set(profile?.guides_seen ?? []);
  // `ready` exige perfil CARREGADO, e é isso que faz a falha errar para o lado
  // certo: sem saber o que já foi visto, não mostramos dica nenhuma. Trocar
  // isto por `guides_seen ?? []` sem o `ready` faria toda dica reaparecer para
  // quem já dispensou — falha de rede virando enxurrada de dica.
  const ready = !!profile;

  const persist = async (next: string[]) => {
    if (!user) return;
    qc.setQueryData(["profile", user.id], (p: Profile | null | undefined) =>
      p ? { ...p, guides_seen: next } : p);
    const { error } = await supabase.from("profiles")
      .update({ guides_seen: next }).eq("user_id", user.id);
    // Falha aqui nunca atrapalha o uso; no pior caso a dica reaparece depois.
    if (error) console.error("guides: falha ao sincronizar", error.message ?? error);
  };

  const markSeen = (ids: GuideId | GuideId[]) => {
    if (!ready) return;
    const list = Array.isArray(ids) ? ids : [ids];
    const toAdd = list.filter((id) => !seen.has(id));
    if (!toAdd.length) return;
    void persist([...seen, ...toAdd]);
  };

  return {
    ready,
    /** A lista de dicas vistas não pôde ser lida (nenhuma dica é mostrada). */
    isError,
    shouldShow: (id: GuideId) => ready && !seen.has(id),
    markSeen,
    disableAll: () => markSeen(ALL_GUIDE_IDS),
    resetAll: () => { if (ready) void persist([]); },
    anySeen: seen.size > 0,
  };
}
