// Permissões, limites e estado da assinatura — SÓ para exibição.
// A validação real acontece no servidor (Edge Functions).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface EntitlementsData {
  plan: "free" | "ascend_plus";
  limits: Record<string, number | boolean | null>;
  flags: Record<string, boolean>;
  subscription: {
    provider: string; status: string;
    current_period_end: string | null; cancel_at_period_end: boolean;
  } | null;
  usage: Record<string, number>;
  pricing: { monthly_label?: string; annual_label?: string } | null;
  /** Lua de mel do free (2 primeiras semanas, captura 10/dia): fim da janela. */
  honeymoon_until?: string | null;
}

/**
 * QUAL ERRO É O MENOS GRAVE QUANDO A LEITURA FALHA
 *
 * Antes, a falha virava `return null`, o React Query considerava sucesso, e
 * `ent?.plan === "ascend_plus"` dava false: a tela concluía PLANO GRÁTIS. Quem
 * paga via "Seu plano: Gratuito" e um convite para assinar de novo — perdendo,
 * na cara, o que já comprou.
 *
 * Os dois erros possíveis não têm o mesmo peso, e a assimetria vem da primeira
 * linha deste arquivo: quem concede recurso é o SERVIDOR. O cliente não libera
 * nada — se ele exibir "premium" por engano, a Edge Function recusa do mesmo
 * jeito e a pessoa cai no Paywall, que é uma tela desenhada para isso. Ou
 * seja: errar para "premium" custa uma promessa visual desmentida em seguida;
 * errar para "grátis" cobra de quem já pagou e empurra uma segunda compra.
 * Entre incomodar e cobrar duas vezes, incomodar é menos grave.
 *
 * Então a regra é: NUNCA rebaixar por falha. Na dúvida, `planUnknown` — a tela
 * não afirma plano nenhum, não oferece upgrade e não bloqueia nada; o servidor
 * segue sendo a autoridade. Vale aqui o mesmo princípio de marca-d'água alta
 * que o app usa nos indicadores: uma falha de rede não desfaz o que a pessoa
 * já tem.
 */
export function useEntitlements() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["entitlements", user?.id],
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<EntitlementsData> => {
      const { data, error } = await supabase.functions.invoke("get-subscription", { body: {} });
      // Propaga em vez de devolver null: sem isto o React Query marca sucesso
      // e ninguém consegue distinguir "não consegui ler" de "é grátis mesmo".
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      return data as EntitlementsData;
    },
  });

  return {
    ...query,
    /** Não sabemos o plano (a leitura falhou). Nem afirme grátis, nem premium. */
    planUnknown: query.isError,
    /** Só é `true` com leitura bem-sucedida dizendo Ascende+. */
    isPlus: query.data?.plan === "ascend_plus",
    /** Pode mostrar convite de upgrade? Não enquanto o plano for desconhecido. */
    canOfferUpgrade: query.isSuccess && query.data?.plan !== "ascend_plus",
  };
}
