import { useProfile } from "@/hooks/useProfile";
import {
  useSleepTodayQuery, useBattlesTodayQuery, useWhatsappLinkQuery, useHasAnyEventQuery,
} from "@/hooks/useZoneQueries";
import { useAuth } from "@/hooks/useAuth";
import { todayISO } from "@/lib/format";
import { hourInSP } from "@/lib/dates";
import { sleepWindowHours } from "@/lib/sleep";
import { isTrackerActive } from "@/lib/trackers";

/* Visibilidade das zonas da Hoje que vivem FORA de Hoje.tsx.
 *
 * POR QUE ISTO EXISTE
 * A Hoje tem teto de 5 zonas e "zona sem dado não renderiza nada". Mas cada
 * zona se escondia sozinha, com um `return null` no próprio corpo — então a
 * página não tinha como saber QUANTAS teriam conteúdo antes de renderizar, e
 * "renderizar nove e contar os nulos" não é possível em React.
 *
 * As queries vêm de useZoneQueries: uma queryKey, um queryFn, um lugar. Ver o
 * comentário de lá para o motivo — repetir a query com a mesma chave e forma
 * diferente envenena o cache do outro consumidor.
 *
 * O `return null` de dentro de cada componente CONTINUA lá, de propósito, como
 * rede de segurança. Se algum dia hook e guarda discordarem, o componente se
 * esconde e a Hoje perde uma vaga naquele render — falha para o lado de
 * mostrar menos, nunca para o lado de mostrar moldura vazia. */

/** localStorage pode lançar (armazenamento bloqueado). Sem a flag, a zona
 *  aparece — mostrar de novo é menos grave que sumir por engano. */
function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

/** Sono: convite matinal de check-in. Perece ao meio-dia. */
export function useSleepZoneVisible(): boolean {
  const { user } = useAuth();
  const { profile } = useProfile();

  const dismissed = readFlag(`ascend-sleep-checkin-${todayISO()}`);
  const scheduleHours = sleepWindowHours(profile?.sleep_bedtime, profile?.sleep_waketime);
  const eligible = !!user && !!profile && isTrackerActive(profile, "sleep")
    && scheduleHours !== null && hourInSP() < 12 && !dismissed;

  const { data: sleptToday } = useSleepTodayQuery(eligible);
  return eligible && sleptToday === false;
}

/** Batalhas: só quando existe batalha ativa E o check-in de HOJE está
 *  pendente. Batalha em dia não precisa ocupar vaga na Hoje. */
export function useBattleZoneVisible(): boolean {
  const today = todayISO();
  const { data } = useBattlesTodayQuery();
  if (!data?.battles.length) return false;
  const doneToday = new Set(
    data.checkins.filter((c) => c.checkin_date === today).map((c) => c.battle_id),
  );
  return data.battles.some((b) => !doneToday.has(b.id));
}

/** WhatsApp: convite de vínculo, só depois do primeiro registro. */
export function useWhatsappZoneVisible(): boolean {
  const dismissed = readFlag("ascend-wa-hoje-dismissed");
  const { data: link, isLoading } = useWhatsappLinkQuery(null);
  const { data: hasEvents } = useHasAnyEventQuery(!dismissed && !link?.linked_at);
  return !dismissed && !isLoading && !link?.linked_at && !!hasEvents;
}
