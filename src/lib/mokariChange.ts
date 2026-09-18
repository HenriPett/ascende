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
import { MOKARI_ORGANS, type Mokari, type MokariOrgan } from "@/lib/mokari";
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

/** Quantas marcas cada ÓRGÃO desenha hoje — só a marca que é dele.
 *
 *  Era chaveado por PILAR, com o contrato "cada pilar tem uma peça e uma só".
 *  Desde que Vitalidade absorveu Alimentação (17/09/2026) esse contrato é
 *  falso: um pilar desenha DUAS peças. Manter a chave no pilar daria a
 *  Vitalidade uma marca só — e aí o aviso voltaria a poder disparar por uma
 *  mudança que não está desenhada em lugar nenhum, que é exatamente o medo
 *  escrito neste comentário desde o primeiro dia. "Vitalidade cresceu" sem
 *  nada ter mudado na tela é pior que silêncio: ensina a pessoa a não
 *  acreditar no aviso.
 *
 *  Quatro chaves fixas, e o invariante que sobrevive à fusão: cada órgão tem
 *  UMA fonte, e nenhuma fonte alimenta dois órgãos. */
const MARK_OF: Record<MokariOrgan, (n: number) => number> = {
  raiz: rootCount,
  folha: leafCount,
  fruto: fruitCount,
  flor: flowerCount,
};

/** A frase de cada órgão. Fala do que a pessoa VÊ crescer no desenho — e não
 *  de "pilar", que é vocabulário nosso e não dela. */
const GROWTH_PHRASE: Record<MokariOrgan, string> = {
  raiz: "Suas raízes cresceram",
  folha: "Suas folhas cresceram",
  fruto: "Seus frutos cresceram",
  flor: "Suas flores cresceram",
};

export function marksOf(m: Mokari): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of MOKARI_ORGANS) {
    out[o] = MARK_OF[o](m.detail.organ_events?.[o] ?? 0);
  }
  return out;
}

/* ── O retrato guardado ANTES da fusão ───────────────────────────────────
   O armazenamento local guarda `marks` chaveado pelo que o código da época
   conhecia: os quatro ids de PILAR. Um snapshot desses, lido pelo código novo,
   não casa com nenhuma das quatro chaves de órgão — e `changesSince` compara
   contra 0 e anuncia as QUATRO peças como novidade de hoje para quem não fez
   nada. Aviso falso é a única coisa que este arquivo não pode produzir.

   A tradução é exata, porque a fusão não moveu nenhuma marca de lugar:
   vitalidade desenhava a raiz, alimentacao a folha, prosperidade o fruto,
   mente a flor. Isto pode sair quando não houver mais navegador com snapshot
   anterior a 17/09/2026 — na prática, nunca: custa quatro linhas e o pior caso
   de deixá-lo é zero. */
const ORGAN_OF_LEGACY_PILLAR: Record<string, MokariOrgan> = {
  vitalidade: "raiz", alimentacao: "folha", prosperidade: "fruto", mente: "flor",
};

function migrateMarks(marks: Record<string, number>): Record<string, number> {
  if (MOKARI_ORGANS.some((o) => o in marks)) return marks;   // já é de órgão
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(marks)) {
    const organ = ORGAN_OF_LEGACY_PILLAR[id];
    if (organ) out[organ] = Number(n) || 0;
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
    if (!v || typeof v.stage !== "number" || !v.marks) return null;
    return { ...v, marks: migrateMarks(v.marks) };
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
  for (const o of MOKARI_ORGANS) {
    const ganho = (atual.marks[o] ?? 0) - (anterior.marks[o] ?? 0);
    if (ganho > 0) frases.push(GROWTH_PHRASE[o]);
  }
  return frases;
}
