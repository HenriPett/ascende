// ASCENDE — Mokari: O MOMENTO DA MUDANÇA.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
// O componente desenhava só o AGORA. Não havia "você virou Muda", não havia
// comparação com o desenho anterior, não havia distância para o próximo passo.
//
// Isso é o suficiente para o Mokari parecer parado mesmo quando ele MUDOU: as
// mudanças ficavam a semanas de distância umas das outras, e ninguém consegue
// notar que seis folhas viraram nove se a última vez que olhou foi há sete
// semanas. Percepção precisa de referência, e a referência não existia.
//
// ─── ONDE A REFERÊNCIA MORA, E POR QUE NÃO NO BANCO ─────────────────────
// No navegador. Uma coluna nova em `profiles` daria memória entre aparelhos, e
// custaria uma migração em produção para guardar um dado que só serve para
// decidir se um aviso aparece uma vez. O pior caso do armazenamento local é
// perder UM aviso ao trocar de aparelho — e o desenho, que é o que importa,
// continua inteiro.
//
// O aviso também não é notificação: ele só existe quando a pessoa abre a
// Jornada. A regra 4 do Mokari ("nunca notifica por culpa") proíbe o resto, e
// aqui não há nada que precise ser desligado depois.
//
// LEITURA E ESCRITA NUNCA PODEM DERRUBAR A TELA: aba anônima, armazenamento
// bloqueado e JSON corrompido são todos possíveis, e nenhum deles vale um
// Mokari que não desenha. Toda função aqui engole a falha e devolve "sem
// novidade" — o silêncio é o pior caso aceitável.
import type { Mokari } from "@/lib/mokari";
import { PILLARS, type PillarId } from "@/lib/pillars";
import { leafCount, fruitCount, flowerCount, rootCount } from "@/lib/mokariDensity";

const KEY = (userId: string) => `ascende-mokari-visto-${userId}`;

/** O mínimo de um armazenamento. ENTRA POR PARÂMETRO pela mesma razão que a
 *  data entra no cálculo do Mokari: função que alcança o ambiente sozinha não
 *  tem como ser testada sem simular o ambiente. Aqui isso importa em dobro,
 *  porque os casos que precisam de teste são justamente os do ambiente hostil
 *  — aba anônima, storage bloqueado, JSON corrompido. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** O armazenamento do navegador, ou `null` onde ele não existe (SSR, teste de
 *  função pura). Acessar `localStorage` pode LANÇAR, não só devolver vazio. */
function browserStore(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch { return null; }
}

/** O retrato reduzido ao que a pessoa PODE VER mudar. Guardar o Mokari
 *  inteiro faria o estado recente (que oscila sozinho, sem ninguém evoluir)
 *  disparar aviso — e "você evoluiu" por causa de um dia de descanso seria
 *  mentira. Por isso o estado fica de fora. */
export interface MokariSnapshot {
  stage: number;
  environment: number;
  marks: Record<string, number>;
}

/** Quantas marcas cada pilar desenha hoje — SÓ a marca que é dele.
 *
 *  Cada pilar tem uma peça e uma só: Alimentação são as folhas, Prosperidade
 *  os frutos, Mente as flores, Vitalidade as raízes. Somar as quatro contas
 *  para todo pilar faria o aviso disparar por uma mudança que não está
 *  desenhada em lugar nenhum — "Mente cresceu" sem nada ter mudado na tela é
 *  pior que silêncio, porque ensina a pessoa a não acreditar no aviso. */
const MARK_OF: Record<PillarId, (n: number) => number> = {
  alimentacao: leafCount,
  prosperidade: fruitCount,
  mente: flowerCount,
  vitalidade: rootCount,
};

export function marksOf(m: Mokari): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of PILLARS) {
    const n = m.detail.pillar_events?.[p.id as PillarId] ?? 0;
    out[p.id] = (MARK_OF[p.id as PillarId] ?? leafCount)(n);
  }
  return out;
}

export const snapshotOf = (m: Mokari): MokariSnapshot => ({
  stage: m.stage, environment: m.environment, marks: marksOf(m),
});

export function readSnapshot(userId: string, store = browserStore()): MokariSnapshot | null {
  try {
    const raw = store?.getItem(KEY(userId));
    if (!raw) return null;
    const v = JSON.parse(raw) as MokariSnapshot;
    return v && typeof v.stage === "number" && v.marks ? v : null;
  } catch { return null; }
}

export function writeSnapshot(userId: string, snap: MokariSnapshot, store = browserStore()): void {
  try { store?.setItem(KEY(userId), JSON.stringify(snap)); } catch { /* sem memória, sem aviso */ }
}

/**
 * O que mudou desde a última vez que esta pessoa olhou.
 *
 * SÓ REPORTA GANHO. Se algum número estiver menor que o guardado — dado
 * corrompido, conta trocada, relógio maluco —, a diferença é DESCARTADA em vez
 * de virar "você perdeu": a regra 1 vale também para a frase, não só para o
 * desenho. Nada aqui tem como dizer a alguém que ela regrediu.
 *
 * Sem referência anterior (primeira visita, aparelho novo) não há novidade
 * nenhuma: comparar contra o vazio anunciaria toda a história como se tivesse
 * acontecido agora.
 */
export function changesSince(
  anterior: MokariSnapshot | null,
  atual: MokariSnapshot,
  stageLabel: (s: number) => string,
  environmentLabel: (e: number) => string,
): string[] {
  if (!anterior) return [];
  const frases: string[] = [];
  if (atual.stage > anterior.stage) frases.push(`Seu Mokari virou ${stageLabel(atual.stage)}`);
  if (atual.environment > anterior.environment) frases.push(`O céu abriu: ${environmentLabel(atual.environment)}`);
  for (const p of PILLARS) {
    const ganho = (atual.marks[p.id] ?? 0) - (anterior.marks[p.id] ?? 0);
    if (ganho > 0) frases.push(`${p.name} cresceu`);
  }
  return frases;
}
