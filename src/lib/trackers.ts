// Modularidade TOTAL (nível tracker) — continuação natural da "modularidade
// real" da Emenda 1: a escolha da pessoa desce do pilar para o tracker.
// "Não quero acompanhar água" → o anel, os botões de 1 toque, a barra do
// painel, os exemplos da captura e a cobrança do briefing SOMEM — mas nada
// é apagado: desligado ≠ deletado, religa em 1 toque com histórico intacto.
//
// Fonte única de verdade (mesmo padrão de pillars.ts): Hoje, Alimentação,
// Vitalidade, Mente, Score, CaptureBar, Ajustes e o snapshot do servidor
// leem TODOS daqui. Regra de composição:
//   ativo(tracker) = pilarAtivo(tracker.pillar) && prefs[tracker.id] !== false
import {
  Droplet, UtensilsCrossed, Beef, Scale, Moon, BedDouble, Dumbbell,
  Smile, Sparkles, BookOpen, HeartHandshake, Banknote, type LucideIcon,
} from "lucide-react";
import { activePillarSet, type PillarId } from "@/lib/pillars";

export type TrackerId =
  | "water" | "meals" | "protein" | "weight"          // alimentação
  | "sleep" | "naps" | "workouts"                     // vitalidade
  | "mood" | "practice" | "journal" | "gratitude"     // mente
  | "spend_limit";                                    // prosperidade

export interface TrackerMeta {
  id: TrackerId;
  pillar: PillarId;
  label: string;
  desc: string;
  icon: LucideIcon;
  /** kinds de life_events que este tracker produz (para a captura marcar
   *  propostas de trackers desligados como desmarcadas, nunca escondidas). */
  eventKinds: string[];
}

export const TRACKERS: TrackerMeta[] = [
  // Alimentação
  { id: "meals", pillar: "alimentacao", label: "Refeições e calorias", desc: "Foto do prato, descrição e metas calóricas", icon: UtensilsCrossed, eventKinds: ["meal"] },
  { id: "protein", pillar: "alimentacao", label: "Proteína", desc: "Meta e acompanhamento diário de proteína", icon: Beef, eventKinds: [] },
  { id: "water", pillar: "alimentacao", label: "Água", desc: "Hidratação em 1 toque e meta diária", icon: Droplet, eventKinds: ["water"] },
  { id: "weight", pillar: "alimentacao", label: "Peso e corpo", desc: "Peso, meta e evolução corporal", icon: Scale, eventKinds: ["weight", "body"] },
  // Vitalidade
  { id: "sleep", pillar: "vitalidade", label: "Sono", desc: "Rotina de sono, check-in matinal e metas", icon: Moon, eventKinds: ["sleep"] },
  { id: "naps", pillar: "vitalidade", label: "Sonecas", desc: "Cochilos contados à parte do sono da noite", icon: BedDouble, eventKinds: ["nap"] },
  { id: "workouts", pillar: "vitalidade", label: "Treinos", desc: "Registro de treinos, grupos musculares e meta semanal", icon: Dumbbell, eventKinds: ["workout"] },
  // Mente
  { id: "mood", pillar: "mente", label: "Humor", desc: "Como você está, em 1 toque", icon: Smile, eventKinds: ["mood"] },
  { id: "practice", pillar: "mente", label: "Prática", desc: "Sua prática espiritual ou momento para a mente", icon: Sparkles, eventKinds: ["practice"] },
  { id: "journal", pillar: "mente", label: "Diário", desc: "Os pensamentos do dia, num espaço só seu", icon: BookOpen, eventKinds: ["journal"] },
  { id: "gratitude", pillar: "mente", label: "Gratidão", desc: "Uma coisa boa por dia, guardada", icon: HeartHandshake, eventKinds: ["gratitude"] },
  // Prosperidade (o registro de gastos em si NUNCA é desligável — é o pilar;
  // o teto diário é o acompanhamento opcional)
  { id: "spend_limit", pillar: "prosperidade", label: "Teto de gasto diário", desc: "Acompanhamento do gasto do dia contra um teto", icon: Banknote, eventKinds: [] },
];

export const trackerById = (id: string): TrackerMeta | undefined =>
  TRACKERS.find((t) => t.id === id);

/** Forma mínima do perfil que os helpers precisam (evita acoplamento). */
export interface TrackerProfileSlice {
  pillars?: string[] | null;
  tracking_prefs?: Record<string, boolean> | null;
}

/** Conjunto de trackers ativos. Sem perfil (carregando), tudo ativo —
 *  nunca escondemos o app por engano (mesma filosofia de activePillarSet). */
export function activeTrackerSet(profile?: TrackerProfileSlice | null): Set<TrackerId> {
  const pillarSet = activePillarSet(profile?.pillars);
  const prefs = profile?.tracking_prefs ?? {};
  const out = new Set<TrackerId>();
  for (const t of TRACKERS) {
    if (!pillarSet.has(t.pillar)) continue;        // pilar pausado ⇒ trackers dele pausados
    if (prefs[t.id] === false) continue;           // desligado explicitamente
    out.add(t.id);
  }
  return out;
}

export const isTrackerActive = (profile: TrackerProfileSlice | null | undefined, id: TrackerId) =>
  activeTrackerSet(profile).has(id);

/** Trackers desligados EXPLICITAMENTE (prefs), independentes do pilar —
 *  é o que o snapshot do servidor e o Ajustes mostram como "não acompanha". */
export function disabledTrackerIds(prefs?: Record<string, boolean> | null): TrackerId[] {
  const p = prefs ?? {};
  return TRACKERS.filter((t) => p[t.id] === false).map((t) => t.id);
}

/** Tracker dono de um kind de evento (para a captura respeitar a escolha). */
export function trackerForEventKind(kind: string): TrackerMeta | undefined {
  return TRACKERS.find((t) => t.eventKinds.includes(kind));
}

/** Um evento proposto deve vir PRÉ-marcado? Regra: eventos de tracker
 *  desligado chegam desmarcados (a pessoa mencionou, então propor respeita a
 *  frase dela; gravar por padrão, não). kinds sem tracker (transaction, note)
 *  sempre marcados. */
export function proposedEventChecked(profile: TrackerProfileSlice | null | undefined, kind: string): boolean {
  const t = trackerForEventKind(kind);
  if (!t) return true;
  return isTrackerActive(profile, t.id);
}

/* ── Exemplos da CaptureBar coerentes com os TRACKERS ativos ──────────────
   (evolução do captureExamplesFor de pillars.ts, que filtrava por pilar:
   quem desligou água não vê "Tomei 2 copos de água" como exemplo). */
const EXAMPLES_BY_TRACKER: [TrackerId | "expense", string][] = [
  ["expense", "Gastei 47 no mercado"],
  ["workouts", "Treinei pernas hoje"],
  ["sleep", "Dormi umas 6h, tô meio cansado"],
  ["meals", "Almocei frango com arroz"],
  ["water", "Tomei 2 copos de água agora"],
  ["mood", "Dia meio ansioso, humor ruim"],
  ["practice", "Orei de manhã, tô mais leve"],
  ["weight", "Me pesei hoje: 78kg"],
];
const COMBO_EXAMPLES: [(TrackerId | "expense")[], string][] = [
  [["expense", "workouts"], "Gastei 47 no mercado e treinei pernas"],
  [["meals", "practice"], "Almocei frango com arroz, orei de manhã"],
  [["sleep", "mood"], "Dormi mal e acordei ansioso"],
  [["expense", "meals"], "Gastei 32 no almoço fora"],
];

export function captureExamplesForTrackers(profile?: TrackerProfileSlice | null): string[] {
  const active = activeTrackerSet(profile);
  const pillarSet = activePillarSet(profile?.pillars);
  const has = (id: TrackerId | "expense") =>
    id === "expense" ? pillarSet.has("prosperidade") : active.has(id);
  const out: string[] = [];
  for (const [combo, phrase] of COMBO_EXAMPLES) {
    if (combo.every(has)) out.push(phrase);
    if (out.length >= 2) break;
  }
  for (const [id, phrase] of EXAMPLES_BY_TRACKER) {
    if (out.length >= 4) break;
    if (has(id)) out.push(phrase);
  }
  return out.length ? out.slice(0, 4) : ["Gastei 47 no mercado"];
}
