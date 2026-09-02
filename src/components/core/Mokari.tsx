import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PILLARS, type PillarId } from "@/lib/pillars";
import { useMokariPreference } from "@/hooks/useMokariPreference";
import { useMokariData } from "@/hooks/useMokariData";
import type { Mokari as MokariData, MokariStage, PillarAffinity } from "@/lib/mokari";
import {
  VIEWBOX, STAGE_ANCHORS, STATE_STYLE, STAGE_LABEL, ENVIRONMENT_LABEL,
  leafSlotsFor, fruitSlotsFor, flowerSlotsFor, leafAngle, budSlot,
  shouldShowBuds, BUD_STROKE, LEAF_LENGTH,
  type Point, type StageAnchors, type StateStyle,
} from "@/lib/mokariLayers";

/* O Mokari — o espelho da jornada, composto em CAMADAS.
 *
 * Uma imagem por combinação seriam 4 × 3⁴ × 5 × 5 = 8.100 arquivos. São 27
 * peças que se sobrepõem: ambiente → raízes → corpo → folhas → frutos →
 * flores → expressão. As marcas de pilar nunca têm coordenada própria: elas se
 * posicionam pelas ÂNCORAS que a peça de corpo publica, então trocar o estágio
 * move tudo junto.
 *
 * ELE NÃO TEM ROSTO, e é decisão, não economia: rosto convida leitura
 * emocional, e no dia em que a pessoa sumir uma semana ela leria tristeza numa
 * boca neutra — a regra 2 morreria na percepção, que é onde ela importa. Sem
 * rosto, a expressão vive na LUZ e na POSTURA, e "ele está triste comigo" não
 * tem onde nascer.
 *
 * NADA murcha, cai, seca ou aponta para baixo. A geometria que garante isso
 * está em mokariLayers.ts, com teste. */

/** Sem animação para quem pediu para não ter. Checado em JS além do CSS
 *  porque as partículas têm de continuar desenhadas e paradas. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

const pillarVar = (id: PillarId) => PILLARS.find((p) => p.id === id)!.colorVar;
const color = (id: PillarId, alpha = 1) =>
  alpha === 1 ? `hsl(var(${pillarVar(id)}))` : `hsl(var(${pillarVar(id)}) / ${alpha})`;

/* ── 1. AMBIENTE — a única camada que conta TEMPO ─────────────────────────
   Deliberado: o tempo passa para quem registra e para quem não registra. É a
   parte do quadro que nunca pode parecer mérito nem cobrança. */
function Environment({ step }: { step: 1 | 2 | 3 | 4 | 5 }) {
  const cloud = "var(--mokari-cloud)";
  return (
    <g aria-hidden>
      {step >= 4 && (
        <circle cx="40" cy="20" r="90" fill="url(#mokari-sky)" />
      )}
      {step === 1 && (
        <>
          <path d="M0,124 Q120,118 240,124 L240,150 L0,150 Z" fill="hsl(var(--muted))" />
          <circle cx="120" cy="150" r="120" fill="url(#mokari-dawn)" />
        </>
      )}
      {step === 2 && (
        <>
          <path d="M0,132 Q120,116 240,126 L240,150 L0,150 Z" fill="hsl(var(--muted))" />
          <ellipse cx="48" cy="130" rx="26" ry="5" fill={cloud} />
        </>
      )}
      {step === 3 && (
        <>
          <path d="M56,122 Q120,114 184,122 L176,150 L64,150 Z" fill="hsl(var(--muted))" />
          <ellipse cx="40" cy="96" rx="34" ry="6" fill={cloud} />
          <ellipse cx="200" cy="104" rx="30" ry="5" fill={cloud} />
        </>
      )}
      {step >= 4 && (
        <>
          {step === 5 && (
            <polyline
              points="0,128 30,120 58,126 92,118 120,124 150,117 186,125 214,119 240,126"
              fill="hsl(var(--foreground) / 0.08)" stroke="none"
            />
          )}
          <path d="M78,120 Q120,114 162,120 L154,150 L86,150 Z" fill="hsl(var(--muted))" />
          {[0, 1, 2].map((i) => (
            <ellipse
              key={i}
              cx={40 + i * 80} cy={(step === 5 ? 140 : 132) + i * 3}
              rx="80" ry="7" fill={cloud}
            />
          ))}
          {step === 5 && [
            { x: 36, y: 34 }, { x: 78, y: 20 }, { x: 148, y: 26 },
            { x: 196, y: 44 }, { x: 214, y: 18 },
          ].map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r="1" fill="var(--mokari-spark)" />
          ))}
        </>
      )}
    </g>
  );
}

/* ── 2. RAÍZES — Vitalidade. Sustentação, não músculo ────────────────────
   Cumpre a regra 3 por construção: nada aqui muda com peso ou composição
   corporal, porque nada disso chega ao cálculo (MokariEvent não tem payload). */
function Roots({ level, opacity }: { level: PillarAffinity; opacity: number }) {
  if (level < 1) return null;
  const stroke = color("vitalidade");
  return (
    <g fill="none" stroke={stroke} strokeLinecap="round" opacity={opacity} aria-hidden>
      <path d="M120,120 Q112,127 104,130" strokeWidth="1.5" />
      <path d="M120,120 Q128,127 136,130" strokeWidth="1.5" />
      {level >= 2 && (
        <>
          <path d="M104,130 Q104,128 88,132" strokeWidth="1.5" />
          <path d="M136,130 Q136,128 152,132" strokeWidth="1.5" />
        </>
      )}
      {level >= 3 && (
        <>
          <path d="M104,130 Q112,130 96,136" strokeWidth="1.5" />
          <path d="M136,130 Q130,130 148,137" strokeWidth="1.5" />
          <path d="M120,120 Q104,132 76,134" strokeWidth="3.5" />
        </>
      )}
    </g>
  );
}

/* ── 3. CORPO — neutro de propósito ─────────────────────────────────────
   Traço `--muted-foreground`, preenchimento `--muted`: a cor pertence aos
   pilares. Assim as quatro cores aparecem sobre uma base que não briga com
   elas, e o tema escuro funciona sem regra extra. */
function Body({ stage, canopyScaleX }: { stage: MokariStage; canopyScaleX: number }) {
  const stroke = "hsl(var(--muted-foreground))";
  const fill = "hsl(var(--muted))";
  const canopy = (cx: number, cy: number, rx: number, ry: number, key: number) => (
    <ellipse key={key} cx={cx} cy={cy} rx={rx * canopyScaleX} ry={ry} fill={fill} stroke={stroke} strokeWidth="0.5" />
  );

  return (
    <g aria-hidden>
      {stage === 1 && (
        <>
          <path d="M120,120 Q118,105 120,90" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="112" cy="92" rx="6" ry="3.5" fill={fill} stroke={stroke} strokeWidth="0.5" transform="rotate(-25 112 92)" />
          <ellipse cx="128" cy="92" rx="6" ry="3.5" fill={fill} stroke={stroke} strokeWidth="0.5" transform="rotate(25 128 92)" />
        </>
      )}
      {stage === 2 && (
        <g fill="none" stroke={stroke} strokeLinecap="round">
          <path d="M120,120 Q117,100 120,82" strokeWidth="4" />
          <path d="M120,82 L108,66" strokeWidth="3" />
          <path d="M120,82 L132,68" strokeWidth="3" />
        </g>
      )}
      {stage === 3 && (
        <>
          <g fill="none" stroke={stroke} strokeLinecap="round">
            <path d="M120,120 L120,72" strokeWidth="5" />
            <path d="M120,88 L102,78" strokeWidth="2" />
            <path d="M120,80 L140,72" strokeWidth="2" />
            <path d="M120,74 L112,62" strokeWidth="2" />
          </g>
          {canopy(108, 52, 30, 20, 1)}
          {canopy(134, 46, 26, 18, 2)}
        </>
      )}
      {stage === 4 && (
        <>
          <path d="M120,120 C118,100 122,86 120,66" fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round" />
          {canopy(104, 48, 28, 19, 1)}
          {canopy(136, 44, 26, 18, 2)}
          {canopy(120, 30, 24, 16, 3)}
          {canopy(120, 56, 34, 18, 4)}
        </>
      )}
    </g>
  );
}

/* ── 4. FOLHAS — Alimentação ─────────────────────────────────────────── */
function Leaves({
  stage, level, towardStem, opacity,
}: { stage: MokariStage; level: PillarAffinity; towardStem: number; opacity: number }) {
  if (level < 1) return null;
  const slots = leafSlotsFor(stage, level);
  return (
    <g aria-hidden>
      {level >= 3 && (
        <ellipse cx="120" cy={STAGE_ANCHORS[stage].auraCenter.y} rx="34" ry="20" fill={color("alimentacao", 0.07)} />
      )}
      {slots.map((slot, i) => (
        <ellipse
          key={i}
          cx={slot.x} cy={slot.y} rx={LEAF_LENGTH} ry="4"
          fill={color("alimentacao", Math.min(1, 0.85 + opacity))}
          transform={`rotate(${leafAngle(slot, towardStem)} ${slot.x} ${slot.y})`}
        />
      ))}
    </g>
  );
}

/* ── 5. FRUTOS — Prosperidade. Colheita, não moeda ──────────────────────
   Moeda lê como cobiça; fruto lê como colheita. */
function Fruits({
  stage, level, opacity,
}: { stage: MokariStage; level: PillarAffinity; opacity: number }) {
  if (level < 1) return null;
  const fill = color("prosperidade", Math.min(1, 1 - 0 + opacity));
  return (
    <g aria-hidden>
      {fruitSlotsFor(stage, level).map((slot, i) => (
        <circle key={i} cx={slot.x} cy={slot.y} r="3.2" fill={fill} />
      ))}
      {/* O fruto caído é o acúmulo que ficou — não é perda. */}
      {level >= 3 && <circle cx="152" cy="118" r="3" fill={fill} />}
    </g>
  );
}

/* ── 6. FLORES E AURA — Mente ───────────────────────────────────────────
   Usam os slots de índice ímpar para não empilhar sobre as folhas. */
function Flowers({
  stage, level, anchors, opacity,
}: { stage: MokariStage; level: PillarAffinity; anchors: StageAnchors; opacity: number }) {
  if (level < 1) return null;
  const petal = color("mente", Math.min(1, 1 + opacity));
  return (
    <g aria-hidden>
      {level >= 3 && (
        <circle cx={anchors.auraCenter.x} cy={anchors.auraCenter.y} r={anchors.auraRadius} fill="url(#mokari-aura)" />
      )}
      {flowerSlotsFor(stage, level).map((slot, i) => (
        <g key={i}>
          {[0, 1, 2, 3, 4].map((k) => {
            const a = ((k * 72 - 90) * Math.PI) / 180;
            return (
              <circle
                key={k}
                cx={slot.x + 3 * Math.cos(a)} cy={slot.y + 3 * Math.sin(a)}
                r="1.8" fill={petal}
              />
            );
          })}
          <circle cx={slot.x} cy={slot.y} r="1.2" fill="hsl(var(--gold))" />
        </g>
      ))}
    </g>
  );
}

/* ── 7. GEMAS — afinidade 0. "Ainda não", nunca "faltou" ────────────────
   Gema é o ponto de onde o crescimento sai: ela não está vazia, está antes.
   Cor neutra de propósito — a cor do pilar é o que aparece quando a pessoa
   começa. E só desenha se algum OUTRO pilar já tiver marca: quatro gemas
   cinzentas num broto leriam como quatro caixinhas para preencher, que é a
   lista de tarefas que a regra 2 proíbe.
   Nunca contada, nunca rotulada: a legenda jamais diz "1 de 4 pilares". */
function Buds({
  stage, affinity,
}: { stage: MokariStage; affinity: Record<PillarId, PillarAffinity> }) {
  if (!shouldShowBuds(affinity)) return null;
  const zeros = PILLARS.filter((p) => (affinity[p.id] ?? 0) < 1);
  if (!zeros.length) return null;

  return (
    <g fill="none" stroke={BUD_STROKE} strokeWidth="1" aria-hidden>
      {zeros.map((p) => {
        const slot: Point = budSlot(p.id, stage);
        const rumo = slot.x < 120 ? 3 : -3;
        return (
          <g key={p.id}>
            <circle cx={slot.x} cy={slot.y} r="2.2" />
            <path d={`M${slot.x + rumo},${slot.y} l${rumo * 1.4},0`} />
          </g>
        );
      })}
    </g>
  );
}

/* ── 8. EXPRESSÃO — luz e postura, nunca rosto ──────────────────────────── */
function Expression({
  style, anchors, reduced,
}: { style: StateStyle; anchors: StageAnchors; reduced: boolean }) {
  return (
    <g aria-hidden>
      {style.halo > 0 && (
        <circle
          cx={anchors.auraCenter.x} cy={anchors.auraCenter.y}
          r={anchors.auraRadius * style.halo}
          fill="var(--mokari-glow)" opacity={0.35}
        />
      )}
      <circle
        cx={anchors.auraCenter.x} cy={anchors.auraCenter.y}
        r={anchors.auraRadius * 0.7}
        fill="var(--mokari-glow)" opacity={style.glow * 0.5}
      />
      {/* Partículas: com movimento reduzido ficam DESENHADAS e paradas na
          posição inicial. Some o movimento, não a informação. */}
      {Array.from({ length: style.particles }, (_, i) => (
        <circle
          key={i}
          cx={anchors.tipPoint.x + (i - 1) * 6}
          cy={anchors.tipPoint.y - i * 4}
          r="1.4" fill="var(--mokari-spark)"
          className={reduced ? undefined : "mokari-drift"}
          style={reduced ? undefined : { animationDelay: `${i * 1.2}s` }}
        />
      ))}
    </g>
  );
}

function MokariFigure({ data, reduced }: { data: MokariData; reduced: boolean }) {
  const anchors = STAGE_ANCHORS[data.stage];
  const style = STATE_STYLE[data.state];
  const lean = style.lean + anchors.lean;

  const destaque = PILLARS.filter((p) => (data.affinity[p.id] ?? 0) >= 2).map((p) => p.name);
  const legenda = `${STAGE_LABEL[data.stage]} · ${ENVIRONMENT_LABEL[data.environment]} · ${style.label}`;
  const aria = `Seu Mokari: ${STAGE_LABEL[data.stage].toLowerCase()}, ${ENVIRONMENT_LABEL[data.environment].toLowerCase()}, ${style.label.toLowerCase()}.`
    + (destaque.length ? ` ${destaque.join(" e ")} em destaque.` : "");

  return (
    <>
      <svg viewBox={VIEWBOX} role="img" aria-label={aria} className="w-full h-[140px]">
        <defs>
          <radialGradient id="mokari-aura">
            <stop offset="0%" stopColor={color("mente", 0.18)} />
            <stop offset="100%" stopColor={color("mente", 0)} />
          </radialGradient>
          <radialGradient id="mokari-dawn">
            <stop offset="0%" stopColor="hsl(var(--gold) / 0.10)" />
            <stop offset="100%" stopColor="hsl(var(--gold) / 0)" />
          </radialGradient>
          <radialGradient id="mokari-sky">
            <stop offset="0%" stopColor={color("mente", 0.08)} />
            <stop offset="100%" stopColor={color("mente", 0)} />
          </radialGradient>
        </defs>

        <Environment step={data.environment} />

        {/* O conjunto vivo balança junto; o ambiente fica parado. */}
        <g
          className={reduced ? undefined : "mokari-sway"}
          style={{ transformOrigin: `${anchors.rootOrigin.x}px ${anchors.rootOrigin.y}px` }}
        >
          <g transform={`rotate(${lean} ${anchors.rootOrigin.x} ${anchors.rootOrigin.y})`}>
            <Roots level={data.affinity.vitalidade} opacity={Math.min(1, 1 + style.markOpacityBonus)} />
            <Body stage={data.stage} canopyScaleX={style.canopyScaleX} />
            <Leaves
              stage={data.stage} level={data.affinity.alimentacao}
              towardStem={style.leafTowardStem} opacity={style.markOpacityBonus}
            />
            <Fruits stage={data.stage} level={data.affinity.prosperidade} opacity={style.markOpacityBonus} />
            <Flowers
              stage={data.stage} level={data.affinity.mente}
              anchors={anchors} opacity={style.markOpacityBonus}
            />
            <Buds stage={data.stage} affinity={data.affinity} />
            <Expression style={style} anchors={anchors} reduced={reduced} />
          </g>
        </g>
      </svg>

      {/* Legenda VISÍVEL: desenho abstrato sem legenda é bonito e ilegível — a
          pessoa não tem como saber o que mudou nem por quê. Serve baixa visão,
          daltonismo (as quatro cores deixam de ser o único canal) e quem não
          decorou o vocabulário. */}
      <p className="text-sm text-muted-foreground text-center">{legenda}</p>
    </>
  );
}

export default function Mokari() {
  const { enabled } = useMokariPreference();
  const { data, isLoading, isError, refetch, isFetching } = useMokariData(enabled);
  const reduced = useReducedMotion();
  const [openWhat, setOpenWhat] = useState(false);

  // Desligado (ou recusado): o slot não renderiza NADA. Nem card, nem moldura,
  // nem "ative o Mokari" — mesma regra da Fase 4, e aqui vale em dobro.
  if (!enabled) return null;

  return (
    <Card className="p-4 space-y-2">
      {/* Falha de leitura tem cara PRÓPRIA, e isso é regra 1, não gentileza.
          Antes, erro virava história vazia e o Mokari de quem tinha Árvore em
          flor voltava a Broto — o desenho desfazia três meses por causa de um
          timeout. Melhor não desenhar nada e dizer o que houve. */}
      {isError ? (
        <div className="py-6 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Não consegui desenhar seu Mokari agora.
          </p>
          <p className="text-xs text-muted-foreground">
            É falha de conexão — nada do que você construiu mudou.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching
              ? (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Tentando...</>)
              : (<><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Tentar de novo</>)}
          </Button>
        </div>
      ) : isLoading || !data
        ? <Skeleton className="w-full h-[140px] rounded-lg" />
        : <MokariFigure data={data} reduced={reduced} />}

      <Collapsible open={openWhat} onOpenChange={setOpenWhat}>
        <CollapsibleTrigger className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          O que é isto?
          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", openWhat && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="text-xs text-muted-foreground pt-2">
            O Mokari é o retrato do que você registrou até aqui. O corpo cresce com o seu XP
            acumulado. As raízes, folhas, frutos e flores vêm dos seus quatro pilares. O céu
            acompanha o tempo de jornada. Ele nunca volta atrás: o que você construiu fica.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
