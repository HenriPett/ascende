// ASCENDE — As regras éticas do Mokari que dependem da ARQUITETURA, não do cálculo.
//
// O contrato da Fase 5 é explícito: "regra que depende de alguém lembrar é
// regra que uma refatoração apaga sem ninguém ver". O cálculo (marca-d'água
// alta, nada de negativo) é do Forge e tem os testes dele em mokari.test.ts.
//
// Este arquivo cuida das duas regras que NÃO são calculáveis — elas são
// propriedades da forma como o Mokari está ligado ao resto do app, e por isso
// só um teste que LÊ O CÓDIGO consegue travá-las:
//
//   Regra 5  desativar não afeta função nenhuma. Só é verdade se nada além do
//            próprio Mokari souber que ele existe. Um `if (mokariEnabled)`
//            dentro do XP, da captura ou dos insights transformaria o espelho
//            em pedágio — e passaria em qualquer teste de unidade.
//   Regra 3  nunca ridiculariza o corpo. O app registra peso; a tentação de
//            "refletir" isso no personagem é enorme. Aqui isso vira erro de
//            teste, não questão de bom senso.
//   Regra 4  nunca notifica por culpa. Nesta fase o Mokari não dispara
//            notificação nenhuma — nem por ausência, nem por qualquer motivo.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { computeMokari, type MokariEvent, type XpEntry } from "@/lib/mokari";
import { join } from "node:path";

const SRC = "src";

/** Arquivos que SÃO o Mokari, ou os pontos onde ele se liga à interface.
 *  Acrescentar algo aqui é uma decisão consciente: significa dizer que mais
 *  uma parte do app passou a conhecer o Mokari. */
const MOKARI_FILES = [
  "src/lib/mokari.ts",
  "src/lib/mokari.test.ts",
  "src/lib/mokariIsolation.test.ts",
  "src/lib/mokariLayers.ts",
  "src/lib/mokariLayers.test.ts",
  "src/lib/mokariReasons.test.ts",
  "src/hooks/useMokariPreference.tsx",
  "src/hooks/useMokariData.tsx",
  "src/components/core/Mokari.tsx",
  "src/components/core/MokariInvite.tsx",
];

/** Onde o Mokari aparece, e o único lugar que declara a preferência. */
const INTEGRATION_POINTS = [
  "src/pages/Jornada.tsx",   // o hub: é ali que ele mora
  "src/pages/Ajustes.tsx",   // o interruptor
  "src/hooks/useProfile.tsx", // declara o campo mokari_enabled
];

function allSourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { allSourceFiles(path, out); continue; }
    if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

const read = (p: string) => readFileSync(p, "utf-8");

/**
 * Remove comentários antes de checar as regras 3 e 4.
 *
 * Sem isto, um arquivo que faz a coisa CERTA falha: o mokari.ts descarta o XP
 * de peso e escreve "o XP de peso e composição corporal é descartado (regra
 * 3)" ao lado — documentar a exclusão é exatamente o que se quer, e não pode
 * ser o que reprova. As regras são sobre o que o código FAZ.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}
const mentionsMokari = (text: string) => /mokari/i.test(text);

describe("regra 5 — desativar o Mokari não afeta função nenhuma", () => {
  it("nada além do próprio Mokari e dos pontos de integração o menciona", () => {
    const permitido = new Set([...MOKARI_FILES, ...INTEGRATION_POINTS]);
    const intrusos = allSourceFiles()
      .filter((f) => !permitido.has(f))
      .filter((f) => mentionsMokari(read(f)));

    // Se este teste falhar, a pergunta NÃO é "adiciono na lista?". É: por que
    // esta parte do app precisa saber que o Mokari existe? Se a resposta
    // envolve mudar comportamento, número ou disponibilidade de qualquer
    // função, a regra 5 foi quebrada e o desenho está errado.
    expect(intrusos, `Estes arquivos passaram a conhecer o Mokari: ${intrusos.join(", ")}`)
      .toEqual([]);
  });

  it("os módulos de cálculo do app não conhecem o Mokari", () => {
    // Estes são os números que a pessoa vê. Nenhum deles pode variar por causa
    // de uma preferência de personagem.
    const calculos = [
      "src/lib/xp.ts", "src/lib/insights.ts", "src/lib/insightsData.ts",
      "src/lib/captureEvents.ts", "src/lib/trackers.ts", "src/lib/pillars.ts",
      "src/lib/battles.ts", "src/lib/planSections.ts", "src/lib/prosperidade.ts",
      "src/lib/healthImport.ts", "src/lib/dataSources.ts", "src/lib/memories.ts",
      "src/lib/analytics.ts",
    ];
    for (const f of calculos) {
      expect(mentionsMokari(read(f)), `${f} não pode conhecer o Mokari`).toBe(false);
    }
  });

  it("a preferência tem UMA porta de entrada", () => {
    // Ler `mokari_enabled` direto do perfil em outro lugar criaria um segundo
    // caminho — e a regra 5 deixaria de ser verificável.
    const lendoDireto = allSourceFiles()
      .filter((f) => f !== "src/hooks/useMokariPreference.tsx"
        && f !== "src/hooks/useProfile.tsx"
        && f !== "src/lib/mokariIsolation.test.ts")
      .filter((f) => /mokari_enabled/.test(read(f)));
    expect(lendoDireto, `Use useMokariPreference() em vez de ler o campo: ${lendoDireto.join(", ")}`)
      .toEqual([]);
  });
});

describe("regra 3 — o Mokari nunca ridiculariza o corpo", () => {
  /* Aqui NÃO dá para usar grep, e a primeira versão deste teste errou por
     isso: ela reprovava justamente o código que implementa a regra
     (`IGNORED_KINDS = ["weight", "body"]`). Texto não distingue "usa peso"
     de "lista peso para excluir".
     A pergunta certa é de comportamento: a MESMA história, com e sem peso,
     produz o mesmo Mokari? */
  const dia = (n: number) => `2026-03-${String(n).padStart(2, "0")}`;
  const iso = (n: number) => `${dia(n)}T12:00:00-03:00`;

  const baseEvents: MokariEvent[] = Array.from({ length: 30 }, (_, i) => ({
    occurred_at: iso(i + 1), pillar: "vitalidade", kind: "workout",
  }));
  const baseXp: XpEntry[] = Array.from({ length: 30 }, (_, i) => ({
    created_at: iso(i + 1), points: 8, reason: "Treino registrado",
  }));

  it("peso e composição corporal não movem NADA no Mokari", () => {
    const semPeso = computeMokari(baseXp, baseEvents, dia(30), dia(1));

    // A mesma pessoa, que também se pesou todos os dias e registrou
    // composição corporal — muito XP de peso inclusive.
    const comPeso = computeMokari(
      [
        ...baseXp,
        ...Array.from({ length: 30 }, (_, i) => ({
          created_at: iso(i + 1), points: 3, reason: "Peso registrado",
        })),
        ...Array.from({ length: 30 }, (_, i) => ({
          created_at: iso(i + 1), points: 4, reason: "Composição corporal registrada",
        })),
      ],
      [
        ...baseEvents,
        ...Array.from({ length: 30 }, (_, i) => ({
          occurred_at: iso(i + 1), pillar: "vitalidade", kind: "weight",
        })),
        ...Array.from({ length: 30 }, (_, i) => ({
          occurred_at: iso(i + 1), pillar: "alimentacao", kind: "body",
        })),
      ],
      dia(30), dia(1),
    );

    expect(comPeso).toEqual(semPeso);
  });

  it("o Mokari não tem como VER um valor de corpo: o tipo de entrada não carrega payload", () => {
    // Garantia estrutural, e é a mais forte das duas: mesmo que alguém queira
    // refletir peso no personagem, o dado não chega. `MokariEvent` é
    // {occurred_at, pillar, kind} — sem payload, sem kg, sem percentual.
    const evento: MokariEvent = { occurred_at: iso(1), pillar: "vitalidade", kind: "workout" };
    expect(Object.keys(evento).sort()).toEqual(["kind", "occurred_at", "pillar"]);
  });
});

describe("regra 4 — o Mokari nunca notifica", () => {
  it("nenhum arquivo do Mokari dispara notificação ou toast", () => {
    // Nesta fase o mais simples é o certo: o Mokari não notifica por nada.
    // Sem canal, não há como uma notificação por ausência nascer depois sem
    // alguém ter que passar por este teste.
    // Regex estreita de propósito: a primeira versão pegava `events.push(...)`
    // do teste do Forge e reprovava código honesto. O que interessa é CANAL:
    const proibido =
      /new Notification|showNotification|requestPermission|pushManager|serviceWorker\.|from "sonner"|toast\./i;
    // Só fonte: um arquivo de teste menciona o que testa, e isso é correto.
    const arquivosDoMokari = MOKARI_FILES
      .filter((f) => !f.endsWith(".test.ts"))
      .filter((f) => { try { statSync(f); return true; } catch { return false; } });

    for (const f of arquivosDoMokari) {
      const hits = stripComments(read(f)).split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => proibido.test(l));
      expect(hits, `${f} abre canal de notificação: linhas ${hits.map(([n]) => n).join(", ")}`)
        .toEqual([]);
    }
  });
});
