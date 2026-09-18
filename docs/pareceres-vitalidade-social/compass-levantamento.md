# Inventário — unificar Vitalidade + Alimentação em "Saúde"

**35 arquivos de produção** (fora testes) citam `vitalidade`/`alimentacao`; **7 arquivos de teste** travam os ids por string. Abaixo o terreno.

Levantado em 17/09/2026 sobre o branch `fix/gasto-de-hoje-somava-o-futuro`, diretório `/Users/henriquepett/Downloads/pessoal/ascende`.

---

## 1) FRONT — quem lê/escreve os ids

### Fonte única (o que define os ids)

| Arquivo:linha | O que quebra se o id sumir |
|---|---|
| `src/lib/pillars.ts:3` | `type PillarId` — é a união. Estreitar aqui é o que **dá erro de compilação** nos lugares tipados (bom). |
| `src/lib/pillars.ts:17-18` | as duas linhas de `PILLARS` (nome, `attribute`, `desc`, `icon`, `colorVar`, `route`). |
| `src/lib/pillars.ts:22` | `pillarById(id)` devolve `undefined` para ids antigos — todo consumidor com `?.` degrada calado. |
| `src/lib/pillars.ts:32-33` | `activePillarSet` filtra ids desconhecidos **e cai no fallback "todos ativos" se a lista ficar vazia** → ver risco #2. |
| `src/lib/pillars.ts:36-37` | `isPillarActive` herda o mesmo fallback. |
| `src/lib/pillars.ts:42-47` | `GOAL_PATTERNS` — dois regexes (`vitalidade` e `alimentacao`) disputariam o mesmo pilar; empate resolvido por ordem do array (`:51`). |
| `src/lib/pillars.ts:58-63` | `EXAMPLES_BY_PILLAR: Record<PillarId, string[]>` → erro de compilação (bom). |
| `src/lib/pillars.ts:64-69` | `COMBO_EXAMPLES` — 3 dos 4 combos citam os dois ids. |
| `src/lib/pillars.ts:70-81` | `captureExamplesFor` — os exemplos da CaptureBar. |
| `src/lib/trackers.ts:17-21` | `TrackerId` e os comentários de agrupamento (`// alimentação`, `// vitalidade`). |
| `src/lib/trackers.ts:36-43` | campo `pillar` de **7 trackers**: `meals`, `protein`, `water`, `weight` (alimentacao) e `sleep`, `naps`, `workouts` (vitalidade). |
| `src/lib/trackers.ts:65-75` | `activeTrackerSet` — regra de composição `pilarAtivo(t.pillar) && prefs[t.id] !== false`. |
| `src/lib/trackers.ts:105-120` | `EXAMPLES_BY_TRACKER` / `COMBO_EXAMPLES` (por tracker, sobrevivem; a chave é o tracker, não o pilar). |

### Consumidores tipados (quebram na compilação — os baratos)

| Arquivo:linha | O quê |
|---|---|
| `src/lib/mokari.ts:31` | importa `PILLARS, type PillarId`. |
| `src/lib/mokari.ts:126` | `affinity: Record<PillarId, PillarAffinity>`. |
| `src/lib/mokari.ts:146` | `pillar_events: Record<PillarId, number>`. |
| `src/lib/mokari.ts:282-307` | `mokariAffinityFromCounts` / `mokariAffinity` — `e.pillar === pillar.id`. |
| `src/lib/mokari.ts:368` | `new Set(naJanela.map(e => e.pillar)).size` — diversidade de pilares no ambiente. |
| `src/lib/mokari.ts:382` | comentário: "são TODAS de vitalidade — e alimentação e prosperidade sumiam da afinidade". |
| `src/lib/mokari.ts:412, 442, 450, 456-462, 499-501` | `pillarCounts`, `pillarEventsFromCounts`. |
| `src/lib/mokariChange.ts:28` | importa `PILLARS, type PillarId`. |
| `src/lib/mokariChange.ts:63-73` | `MARK_OF: Record<PillarId, fn>` — **cada pilar desenha uma peça e uma só**: `alimentacao → leafCount`, `prosperidade → fruitCount`, `mente → flowerCount`, `vitalidade → rootCount`. |
| `src/lib/mokariChange.ts:76-81` | `marksOf` — `m.detail.pillar_events?.[p.id as PillarId]`. |
| `src/lib/mokariChange.ts:123-127` | `changesSince` — frase "`${p.name}` cresceu" por pilar. |
| `src/lib/mokariLayers.ts:14` | importa `type PillarId`. |
| `src/lib/mokariLayers.ts:319-323` | `budSlot(pillar, stage)` com `if (pillar === "vitalidade")` e `if (pillar === "prosperidade")`. |
| `src/lib/mokariLayers.ts:181, 193` | comentários sobre a camada de Vitalidade. |
| `src/lib/mokariLayers.ts:335` | `shouldShowBuds(affinity: Record<PillarId, PillarAffinity>)`. |
| `src/components/core/Mokari.tsx:123` | `stroke={color("vitalidade")}` — as RAÍZES. |
| `src/components/core/Mokari.tsx:196, 203` | `color("alimentacao", …)` — as FOLHAS. |
| `src/components/core/Mokari.tsx:388, 393` | `count={ev.vitalidade}` e `count={ev.alimentacao}` lidos de `pillar_events`. |
| `src/components/core/Mokari.tsx:348` | `const ev = data.detail.pillar_events`. |
| `src/hooks/useMokariData.tsx:52-54` | `contaPilar` → `.eq("pillar", pillar)` (ver risco #3). |
| `src/hooks/useMokariData.tsx:71, 85-86, 90` | `...PILLARS.map(p => contaPilar(p.id))` e montagem de `pillarCounts`. |
| `src/pages/Onboarding.tsx:41` | importa `PILLARS, inferPillarFromGoal, pillarById, type PillarId`. |
| `src/pages/Onboarding.tsx:63-66` | `CHIP_INK: Record<PillarId, string>` (contraste AA por pilar). |
| `src/pages/Onboarding.tsx:114, 143, 307, 313` | estados tipados `PillarId` / `PillarId[]`. |
| `src/pages/Pilares.tsx:10, 24, 34` | `type PillarId` em estado e handler. |
| `src/pages/Ajustes.tsx:20, 87` | `type PillarId` em `togglePillar`. |

### Consumidores por string (NÃO quebram na compilação — os caros)

| Arquivo:linha | O que quebra |
|---|---|
| `src/lib/queryKeys.ts:15` | comentário do PENDENTE lista "Vitalidade … Alimentacao". |
| `src/lib/queryKeys.ts:34` | `SLEEP_KEYS = [...DAILY_KEYS, "sleep-today", "vitalidade"]` — **literal**. |
| `src/lib/queryKeys.ts:39` | `LIFE_DATA_KEYS` contém `"vitalidade"` — **literal**. Se a tela renomear a `queryKey`, a invalidação **para de casar em silêncio** (risco #5). |
| `src/pages/Score.tsx:9` | `import { PILLARS, activePillarSet }`. |
| `src/pages/Score.tsx:73` | `.select("pillar,kind,occurred_at,payload")` dos últimos 14 dias. |
| `src/pages/Score.tsx:127-128` | mapa de indicadores chaveado por `vitalidade` / `alimentacao` (com os textos de estado vazio). |
| `src/pages/Score.tsx:147, 161` | `scores.vitalidade = …` (hábitos 14d + sono médio vs. 7–8h). |
| `src/pages/Score.tsx:167, 177, 180` | `scores.alimentacao = …` (dias com refeição nos últimos 14) e o texto "Você escolheu não acompanhar refeições". |
| `src/pages/Score.tsx:210-212` | `activePillarSet(profile?.pillars)` → `shownPillars` / `pausedPillars`. |
| `src/pages/Score.tsx:218-219` | tendência por pilar: `data.events.filter(e => e.pillar === p.id)`. |
| `src/pages/Hoje.tsx:28` | `import { pillarById }`. |
| `src/pages/Hoje.tsx:296` | primeiro passo → `to: "/app/alimentacao"`. |
| `src/pages/Hoje.tsx:538-540` | `pillarsTouched`: "Treino" e "Sono" → `to: "/app/vitalidade"`, `colorVar: "--vitalidade"`. |
| `src/pages/Hoje.tsx:610, 622, 634` | Calorias com `--alimentacao` e link "Definir meta" → `/app/alimentacao`. |
| `src/pages/Hoje.tsx:650` | **barra de PROTEÍNA pintada com `--vitalidade`** — mas `protein` é tracker de `alimentacao` (`trackers.ts:37`). Incoerência visual (ver seção 5). |
| `src/pages/Hoje.tsx:700, 706, 720, 728` | Treinos e Sono com `--vitalidade`. |
| `src/pages/Hoje.tsx:733-735` | grid dimensionado por `pillarsTouched.length`. |
| `src/pages/Hoje.tsx:899, 958` | `.select("id,name,pillar")` de hábitos + `pillarById(h.pillar)` → `undefined` para hábito histórico. |
| `src/pages/Landing.tsx:6` | `import { PILLARS }`. |
| `src/pages/Landing.tsx:24-47` | eventos da demo com `pillar: "vitalidade"` (`:25, :26, :39`) e `pillar: "alimentacao"` (`:40, :46`) — **strings cruas**. |
| `src/pages/Landing.tsx:89` | `PILLARS.find(p => p.id === ev.pillar)!` — **non-null assertion**. |
| `src/pages/Landing.tsx:121, 129-151` | `LocalEvent` e o parser ao vivo: `:135, :138` gravam `vitalidade`; `:141, :145` gravam `alimentacao`. |
| `src/pages/Landing.tsx:190` | segundo `PILLARS.find(...)!` — mesmo risco de crash. |
| `src/pages/Landing.tsx:420` | copy: "Uma vida só. **Quatro** pilares." |
| `src/pages/Landing.tsx:427` | `{PILLARS.map(...)}` — a grade de pilares da landing. |
| `src/pages/Landing.tsx:667` | copy: "Conselheiro que vê os **4** pilares". |
| `src/pages/Ajustes.tsx:66, 84, 110, 127, 147` | estado `pillars: string[]`, snapshot de "mudou?" e o save. |
| `src/pages/Ajustes.tsx:163-164` | `SCOPES` de privacidade: `{ id: "vitalidade", … }`, `{ id: "alimentacao", … }` (ver risco #1). |
| `src/pages/Ajustes.tsx:168-172` | `raw[sc.id] !== false` — o padrão perigoso. |
| `src/pages/Ajustes.tsx:525-532` | toggles de pilar (`PILLARS.map`). |
| `src/pages/Ajustes.tsx:550-551` | trackers agrupados por pilar. |
| `src/pages/Ajustes.tsx:574` | bloco "pilares pausados". |
| `src/pages/Ajustes.tsx:584` | link "editar em **Vitalidade**" → `/app/vitalidade`. |
| `src/pages/Batalhas.tsx:128` | classe utilitária `text-alimentacao`. |
| `src/pages/Batalhas.tsx:133` | copy: "no pilar **Alimentação**". |
| `src/pages/Batalhas.tsx:138` | link "Criar hábito positivo" → `/app/vitalidade`. |
| `src/pages/Planos.tsx:32` | `pillar: string \| null`. |
| `src/pages/Planos.tsx:46, 49` | `alimentar → "--alimentacao"`, `treino → "--vitalidade"` — **duas cores, um pilar depois**. |
| `src/pages/Planos.tsx:55` | comentário "Alimentar e treino ganham seção própria". |
| `src/pages/Chat.tsx:50, 57` | `pillar: string` em hábito proposto e plano proposto. |
| `src/pages/Chat.tsx:332, 432` | grava `pillar` vindo do modelo. |
| `src/pages/Chat.tsx:412` | rótulos `alimentar`/`treino`. |
| `src/pages/Chat.tsx:571, 681, 694` | `pillarById(...)` com `meta?.name ?? ev.pillar` → **degrada mostrando a string crua** `"vitalidade"`. |
| `src/pages/Jornada.tsx:19, 131-138, 275-276` | consome `PILLARS` genericamente — atravessa sem edição, muda só a contagem de cartões/pontos. |
| `src/pages/Pilares.tsx:28-41` | idem: `activePillarSet`, `activeList`/`pausedList`, `activatePillar` grava em `profiles.pillars`. |
| `src/pages/Onboarding.tsx:58` | comentário com os contrastes medidos (prosperidade 2,74:1, vitalidade 3,79:1). |
| `src/pages/Onboarding.tsx:71` | `FALLBACK_PILLAR = "prosperidade"` (não afetado). |
| `src/pages/Onboarding.tsx:181-183, 197-202, 226` | ponto de partida inferido e `startPillars`. |
| `src/pages/Onboarding.tsx:254` | **grava `pillar: "alimentacao"`, `kind: "weight"`** no primeiro peso declarado. |
| `src/pages/Onboarding.tsx:314-315` | auto-ativação: `if (tmb \|\| workoutsWeek \|\| sleepHrs) s.add("vitalidade")`; `if (foodSpend \|\| restrictions) s.add("alimentacao")`. |
| `src/pages/Onboarding.tsx:323, 326, 330` | validação "escolha pelo menos um pilar" e o save. |
| `src/pages/Onboarding.tsx:404, 453, 887` | `pillar` de plano e de hábito propostos pelo Blueprint. |
| `src/pages/Onboarding.tsx:545, 546, 551` | recibo final: "tela Hoje e **Vitalidade**", "**Alimentação** > Corpo", "condições de saúde: **Vitalidade**". |
| `src/pages/Onboarding.tsx:774-776` | `PILLARS.map` + `TRACKERS.filter(t => t.pillar === p.id)`. |
| `src/pages/Vitalidade.tsx` (672 linhas) | tela inteira: `:39` `RaioXVitalidade()`, `:66` toast, `:106, :122` títulos, `:148` `export default function Vitalidade()`, `:157` `useState("vitalidade")` (pilar padrão do hábito novo), `:226` `queryKey: ["vitalidade", user?.id]`, `:260` `insert({… pillar: newPillar })`, `:297` `pillar: "vitalidade"` (sleep/nap), `:317` `pillar: "vitalidade"` (workout), `:84, :85, :101, :102, :361, :398, :405, :447, :470, :490-491, :511, :579, :663` cor `--vitalidade`. |
| `src/pages/Alimentacao.tsx` (1106 linhas) | tela inteira: `:87` `export default function Alimentacao()`, `:168, :244` `pillar: "alimentacao"` (meal), `:272` (water), `:292` (weight), `:426` título, `:467, :481, :545, :614, :666, :720, :765-766, :821, :961, :990` cor `--alimentacao`, `:511` copy "sono e treinos na **Vitalidade**". |
| `src/components/core/QuickActions.tsx:402` | `insert(… { pillar: "alimentacao", kind: "water" })`. |
| `src/components/core/QuickActions.tsx:470-482` | atalhos "Refeição" → `/app/alimentacao` e "Treino" → `/app/vitalidade`, com as duas cores. |
| `src/components/core/SleepCheckin.tsx:55` | `insert({ … pillar: "vitalidade", kind: "sleep" })`. |
| `src/components/core/SleepCheckin.tsx:89-90` | cor `--vitalidade`. |
| `src/components/core/SleepSchedule.tsx:183` | cor `--vitalidade`. |
| `src/components/core/TrendInsights.tsx:96` | `pillars: ["--vitalidade", "--prosperidade"]` (`sono_gasto_seguinte`). |
| `src/components/core/TrendInsights.tsx:112` | `pillars: ["--alimentacao", "--prosperidade"]` (`refeicao_gasto_comida`). |
| `src/components/core/TrendInsights.tsx:125` | `missing.to: "/app/alimentacao"`. |
| `src/components/core/TrendInsights.tsx:128` | `pillars: ["--vitalidade"]` (`treino_sono`). |
| `src/components/core/TrendInsights.tsx:140` | `missing.to: "/app/vitalidade"`. |
| `src/components/core/HealthImport.tsx:61-68` | `sleep`/`workout` → `--vitalidade`; `weight`/`water`/`meal` → `--alimentacao`. |
| `src/components/core/HealthImport.tsx:131` | rótulo "Alimentação". |
| `src/components/core/HealthImport.tsx:617` | cor `--vitalidade`. |
| `src/components/core/SourcesAndImports.tsx:52-53` | `health_csv`/`health_export` → `--vitalidade`. |
| `src/components/core/PlanSections.tsx:62-63` | `alimentar → "--alimentacao"`, `treino → "--vitalidade"`. |
| `src/lib/blueprint.ts:48, 54` | `BlueprintHabit.pillar: string`, `pillar: string \| null`. |
| `src/lib/blueprint.ts:77-78` | `alimentar: { label: "Alimentação", colorVar: "--alimentacao" }`, `treino: { colorVar: "--vitalidade" }`. |
| `src/lib/healthImport.ts:675, 755` | grava `pillar: "vitalidade"` (sono, treino). |
| `src/lib/healthImport.ts:795-799` | grava `pillar: "alimentacao"` para **peso**, com o comentário que justifica a convenção. |
| `src/lib/healthImport.ts:882, 896` | grava `pillar: "alimentacao"` (refeição). |
| `src/lib/healthImport.ts:91, 380, 814` | comentários de seção. |
| `src/lib/appleHealth.ts:343` | `kind: "sleep", pillar: "vitalidade"`. |
| `src/lib/appleHealth.ts:355-358` | `kind: "weight", pillar: "alimentacao"` + comentário justificando. |
| `src/lib/appleHealth.ts:376` | `kind: "workout", pillar: "vitalidade"`. |
| `src/lib/appleHealth.ts:389` | `kind: "water", pillar: "alimentacao"`. |
| `src/lib/captureEvents.ts:10, 447` | `pillar: string` — repassa o que o modelo emitiu, **sem validar**. |
| `src/lib/battles.ts:40` | comentário sobre redirecionar para hábitos de Alimentação. |
| `src/hooks/useProfile.tsx:61, 86` | `pillars: string[]` e o comentário do Raio-X de Vitalidade. |
| `tailwind.config.ts:32-33` | `vitalidade: "hsl(var(--vitalidade))"`, `alimentacao: "hsl(var(--alimentacao))"`. |
| `src/index.css:57-58` | `--vitalidade: 8 78% 56%` (coral), `--alimentacao: 150 38% 40%` (sálvia) — tema claro. |
| `src/index.css:142-143` | as mesmas no tema escuro. |

### Testes que travam os ids por string

`src/lib/mokari.test.ts` (32 ocorrências), `src/lib/captureEvents.test.ts` (21), `src/lib/mokariChange.test.ts` (15), `src/lib/healthImport.test.ts` (12), `supabase/functions/_shared/lib.test.ts` (11), `src/lib/mokariLayers.test.ts` (5), `src/lib/mokariIsolation.test.ts` (4), `src/lib/analytics.test.ts` (2), `src/lib/appleHealth.test.ts` (1), `src/lib/routes.test.ts` (5).

### Achado estrutural do front

`src/pages/Vitalidade.tsx:234-239` e `src/pages/Alimentacao.tsx:128, 144, 158` consultam `life_events` **por `kind`, nunca por `pillar`**:

- `Vitalidade.tsx:234-236` → `.eq("kind", "workout")`
- `Vitalidade.tsx:237-239` → `.eq("kind", "sleep")`
- `Alimentacao.tsx:128` → `.eq("kind", "meal")`
- `Alimentacao.tsx:144` → `.eq("kind", "water")`
- `Alimentacao.tsx:158` → `.eq("kind", "weight")`

**As duas telas, como dados, já são uma só.** A fusão de tela é barata. O campo `pillar` só é usado para **agregar** (`Score.tsx:219`, `useMokariData.tsx:52-54`) e para **prompt** (`_shared/lib.ts`).

---

## 2) BANCO

### Não existe CHECK nem enum travando o valor

Varredura em `supabase/setup.sql`: **nenhum `check` cita `pillar`**. O campo é `text` livre em todos os lugares. O único "enum" de pilar no sistema vive no schema de ferramenta das edge functions (seção 3) e no `type PillarId` do TypeScript.

### Objetos que precisam de backfill

| Objeto | Onde | Situação |
|---|---|---|
| `profiles.pillars text[] not null default '{}'` | `setup.sql:22` | comentário lista os 4 ids. **Precisa backfill** — e é o que dispara o risco #2. |
| `life_events.pillar text not null` | `setup.sql:101` | livre, sem CHECK. **Precisa backfill** (é o volume). |
| `habits.pillar text not null default 'vitalidade'` | `setup.sql:223` | **default literal** — precisa backfill **e** mudança do default (risco #4). |
| `plans.pillar text` | `setup.sql:305` | nullable; escrito pelo Conselheiro (`ai-chat/index.ts:565`) e pelo Blueprint (`onboarding-blueprint/index.ts:264`). Backfill. |
| `profiles.ai_scopes jsonb not null default` | `setup.sql:736` | default `'{"prosperidade":true,"vitalidade":true,"alimentacao":true,"mente":true,"diario":true}'::jsonb`. **Backfill + decisão semântica** (risco #1). |
| `profiles.tracking_prefs` | `setup.sql:63` | chaveado por **tracker** (`water`, `sleep`, …), não por pilar → **imune**. |

### Triggers com o literal `'vitalidade'` embutido

| Arquivo:linha | Objeto |
|---|---|
| `setup.sql:223` | `habits.pillar` — `default 'vitalidade'` |
| `setup.sql:250-252` | `habit_log_to_life_event()` v1 — `coalesce(h.pillar, 'vitalidade')` |
| `setup.sql:475-477` | `habit_log_to_life_event()` v2 (**a que vale**: `create or replace` posterior, com `source_table`/`source_id`) — `coalesce(h.pillar, 'vitalidade')` |
| `setup.sql:247-256` / `:471-482` | corpo completo das duas versões |

Triggers com `'prosperidade'` hardcoded — **não afetados**, listados para fechar o inventário:
- `setup.sql:207-208` (`tx_to_life_event` v1)
- `setup.sql:439-441` (v2)
- `setup.sql:1117-1121` (v3, a que vale — XP justo)
- `supabase/migrations/20260914140000_a_compra_parcelada_e_uma_coisa_so.sql:93`

### Views e funções agregadas: IMUNES

Conferido linha a linha — **nenhuma agrega por `pillar`**:

| Objeto | Arquivo:linha | Por que é imune |
|---|---|---|
| `daily_metrics` | `migrations/20260904120000_agregados_e_tendencias.sql:69-112` | agrega por **`kind`** (`:83, :91, :92, :97`) e por **`category`** de transação (`:106-112`). Nunca toca `pillar`. |
| `daily_metrics` (recriada) | `migrations/20260907120000_cobertura_por_extrato.sql:48-70` | idem (`:55, :57, :58, :59, :68, :70`). Coluna aditiva. |
| `jsonb_num()` | `agregados_e_tendencias.sql:49` | utilitário puro. |
| `insights` / `insight_feedback` | `agregados_e_tendencias.sql:223`, `medidas_de_decisao.sql:84` | `check (kind in ('sono_gasto_seguinte','refeicao_gasto_comida','treino_sono'))` — nomes de **cruzamento**, não de pilar. Imunes, mas ficam com nome herdado. |
| 8 views de métrica | `medidas_de_decisao.sql:141, 174, 211, 247, 283, 316, 394` | `metric_time_to_first_value`, `metric_import_receipts`, `metric_memory_control`, `metric_insight_feedback`, `metric_capture_vs_navigation`, `metric_return_after_silence`, `metric_companion_reaction` — nenhuma toca `pillar`. |
| `xp_total_mokari(uid)` | `migrations/20260908120000_mokari_totais.sql:38-53` e `setup.sql:1410-1424` | filtra por `reason` do `xp_log` (`'Peso registrado'`, `'Composição corporal registrada'`, `'Registro: weight'`, `'Registro: body'`), não por pilar. |

### Dado histórico que perde sentido

**Praticamente nenhum — e essa é a boa notícia.**

`life_events.pillar` é **derivável de `kind`**. A regra 1:1 está escrita, como documentação executável, em `supabase/functions/_shared/lib.ts:1254-1255`:

> `transaction→prosperidade; sleep/nap/workout→vitalidade; meal/water/weight→alimentacao; mood/gratitude/practice→mente`

Logo, remapear `vitalidade | alimentacao → saude` é **lossless**: a granularidade fina continua no `kind`, e a informação "isto era vitalidade ou alimentação" é recuperável a qualquer momento.

**As duas exceções, que são genuinamente lossy e não têm resposta tecnicamente correta:**

1. **`profiles.pillars`** — quem tem `['vitalidade']` mas **não** `'alimentacao'` (ou o inverso) não tem tradução fiel para um único `'saude'`. Ativar a mais é dar o que a pessoa não pediu; desativar é tirar o que ela tinha.
2. **`profiles.ai_scopes`** — quem autorizou análise de sono/treino mas **negou** refeições/peso. Dois booleanos viram um; qualquer escolha contraria a pessoa em metade do caso. Aqui o erro tem custo de confiança, não de UX.

---

## 3) BORDA (supabase/functions) — PROMPT vs. CÓDIGO

A distinção importa porque **prompt errado é resposta estranha; código errado é dado perdido.**

### CÓDIGO (chave de dado — o modelo emite e o valor vai para o banco)

| Arquivo:linha | O quê | Custo |
|---|---|---|
| `_shared/lib.ts:1250-1255` | `CAPTURE_TOOL`: `pillar` com `enum: ["prosperidade","vitalidade","alimentacao","mente"]` | **O portão de entrada de tudo que vem da captura** — texto, áudio, imagem, WhatsApp. |
| `_shared/lib.ts:1293` | `required: ["kind","pillar","summary"]` | O modelo é obrigado a emitir um valor do enum. |
| `_shared/lib.ts:360-362` | `INSIGHT_PILLARS`: `sono_gasto_seguinte: ["vitalidade","prosperidade"]`, `refeicao_gasto_comida: ["alimentacao","prosperidade"]`, `treino_sono: ["vitalidade"]` | `:354` declara que é **espelho** de `COPY[].pillars` em `TrendInsights.tsx:96-128`. Duas cópias, **sem teste ligando as duas** (`:303` admite: "Se um dia divergirem, a tela…"). |
| `_shared/lib.ts:651-658` | `rawScopes.vitalidade !== false`, `rawScopes.alimentacao !== false` | **portão de privacidade** (risco #1). |
| `_shared/lib.ts:659-661` | `disabled` → linha "PRIVACIDADE: a pessoa desativou…" | nomes dos escopos entram no prompt crus. |
| `_shared/lib.ts:835` | `if (scopes.vitalidade)` — bloco de hábitos/sono | 1 de 7 gates. |
| `_shared/lib.ts:886` | `if (scopes.vitalidade && kinds["workout"])` | treinos. |
| `_shared/lib.ts:917` | `if (scopes.alimentacao && kinds["weight"])` | peso. |
| `_shared/lib.ts:934` | `if (scopes.alimentacao && kinds["body"])` | composição corporal. |
| `_shared/lib.ts:952` | `if (scopes.alimentacao && kinds["meal"])` | refeições/calorias. |
| `_shared/lib.ts:1040` | `if (scopes.vitalidade)` | rotina de sono. |
| `_shared/lib.ts:1061` | `if (scopes.alimentacao && kinds["water"])` | hidratação. |
| `_shared/lib.ts:618` | `.select("pillar,kind,occurred_at,payload")` de `life_events` | leitura, não filtro. |
| `_shared/lib.ts:623` | `.select("id,name,pillar")` de `habits` | leitura. |
| `ai-chat/index.ts:141` | `pillar: { enum: ["prosperidade","vitalidade","alimentacao","mente"] }` — **plano** | schema da ferramenta. |
| `ai-chat/index.ts:173, 176` | mesmo enum para **hábito proposto**, `required: ["name","pillar"]` | schema. |
| `ai-chat/index.ts:553, 565` | `pillar: [...].includes(inp.pillar) ? inp.pillar : null` | **validador**: pilar fora do enum vira `null`. |
| `ai-chat/index.ts:702, 710-712` | `VALID_PILLARS` + `if (!pillar) return []` | **descarta o hábito inteiro em silêncio**. |
| `onboarding-blueprint/index.ts:23` | `const VALID_PILLARS = [...]` | fonte local. |
| `onboarding-blueprint/index.ts:57` | enum + descrição "alimentar→alimentacao; treino→vitalidade; financeiro→prosperidade; rotina→vitalidade ou mente" | **prompt E código juntos**. |
| `onboarding-blueprint/index.ts:74, 90, 93` | `required`, enum do hábito | schema. |
| `onboarding-blueprint/index.ts:243-247` | `if (!pillar) return []` | **mesmo descarte silencioso**. |
| `onboarding-blueprint/index.ts:264` | `pillar: VALID_PILLARS.includes(pl?.pillar) ? … : null` | validador do plano. |
| `whatsapp-webhook/index.ts:641` | grava `kind: "transaction", pillar: "prosperidade"` | **não afetado**. |
| `capture/index.ts:16-18, 199-211` | **não cita pilar nenhum**: reusa `CAPTURE_TOOL.input_schema.properties.events` do `_shared` (`:211`) | **muda sozinho** quando `_shared/lib.ts:1252` mudar. |

> **Custo do lado código:** se o enum passar a `["prosperidade","saude","mente"]` e algum caminho ainda emitir `"vitalidade"`, então `ai-chat/index.ts:712` e `onboarding-blueprint/index.ts:245` **jogam o item fora sem erro nenhum** — o hábito simplesmente não aparece. E a captura (`CAPTURE_TOOL`) **não valida no servidor**: o valor entra cru no `life_events` via `src/lib/captureEvents.ts:447`.

### PROMPT (texto que o modelo lê — custo é tom e instrução, não dado)

| Arquivo:linha | O quê |
|---|---|
| `_shared/lib.ts:699` | `Pilares ativos: ${(p.pillars ?? []).join(", ")}` — sai **como está no banco**. |
| `_shared/lib.ts:790` | "Para o 'plano alimentar que cabe no bolso', a estimativa de Mercado/**Alimentação fora**…". |
| `_shared/lib.ts:1012` | "a pessoa pode definir na **aba Alimentação**". |
| `_shared/lib.ts:1126` | "peso atual (registrar na **aba Alimentação**)". |
| `_shared/lib.ts:1132` | "peso na **aba Alimentação**; condições e medicamentos na **Vitalidade**" — **instruções de navegação que ficam falsas** no dia em que a tela muda de nome. |
| `_shared/lib.ts:1200` | regra de segurança sobre transtorno alimentar: "hábitos positivos no **pilar Alimentação**". |
| `_shared/lib.ts:1254-1255` | descrição do enum — **é prompt E código ao mesmo tempo**: é ela que ensina o mapeamento `kind → pillar`. |
| `_shared/lib.ts:266` | comentário de arquitetura citando "vitalidade E prosperidade". |
| `_shared/lib.ts:863` | comentário "Raio-X de Vitalidade". |
| `ai-chat/index.ts:93` | mesma lista de "onde preencher": "peso na **aba Alimentação**; condições e medicamentos na **Vitalidade**". |
| `briefing/index.ts:25` | "estimativas declaradas (financeiras ou de **vitalidade**)" — prompt de conta nova. |
| `briefing/index.ts:38` | idem — prompt de conta com histórico. **Dois prompts, mesma frase.** |
| `analyze-body/index.ts:85` | mensagem ao **usuário final**: "Continue registrando seu peso na **aba Alimentação**." |
| `whatsapp-webhook/index.ts:655` | "Análise de composição corporal é no app: `${url}/app/vitalidade`" — **prompt, mensagem e ROTA ao mesmo tempo** (ver seção 4). |
| `onboarding-blueprint/index.ts:58` | exemplo de título: "'**Alimentação** para massa magra com R$ 800/mês'". |

### Colisão de nome registrada

`_shared/lib.ts:1941` e `:2012` definem **"Saúde"** como **categoria de despesa** (farmácia/consulta), espelhada em `src/lib/prosperidade.ts:14`. O nome do pilar novo **colide com uma categoria financeira existente** — e o Conselheiro lê as duas coisas no mesmo retrato.

---

## 4) ROTAS CONGELADAS — o que o teste exige, exatamente

`src/lib/routes.test.ts` impõe, sobre `/app/vitalidade` e `/app/alimentacao`, **doze condições**:

| # | Teste (arquivo:linha) | Exigência literal |
|---|---|---|
| 1 | `routes.test.ts:48-53` | o `path` continua em `APP_ROUTES`, conferido contra `FROZEN_LEGACY_PATHS` — lista escrita à mão em `routes.ts:87-100`, **deliberadamente não derivada** da tabela (`routes.ts:79-85` explica por quê). |
| 2 | `routes.test.ts:55-60` | o endereço resolve (`matchRoutes` real do react-router, `:38-41`). |
| 3 | `routes.test.ts:62-80` | ⚠️ **o mais restritivo**: mapa literal `vitalidade → "Vitalidade"`, `alimentacao → "Alimentacao"` (`:70-71`). O teste compara com o campo **`page`**, que vira o `id` do `RouteObject` em `:32-33`. Os dois `page` precisam continuar com **esses valores exatos e distintos entre si**. |
| 4 | `routes.test.ts:82-89` | `r.Component !== Navigate` **e** `typeof r.Component === "object"` — ou seja: um `lazy()`, não uma função, não um redirecionador. |
| 5 | `routes.test.ts:91-96` | `App.tsx` precisa conter a string `APP_ROUTES` e casar `/APP_ROUTES\.map/`. Confirmado em `src/App.tsx:22` e `:91`. |
| 6 | `routes.test.ts:98-110` | o bloco entre `path="/app"` e `path="*"` do `App.tsx`, já **sem comentários** (`:104-106` remove `/* */` e `//`), **não pode conter a string `<Navigate`**. |
| 7 | `routes.test.ts:112-115` | `path` únicos (`new Set(paths).size === paths.length`). |
| 8 | `routes.test.ts:121-124` | mesma resolução com `?a=1&b=dois%20três#uma-secao`. |
| 9 | `routes.test.ts:159-166` | a chave `vitalidade` de `EXTERNALLY_LINKED` (`routes.ts:164-166`) resolve **e** está em `FROZEN_LEGACY_PATHS`. |
| 10 | `routes.test.ts:168-175` | asserção nominal explícita: `pageFor("/app/vitalidade") === "Vitalidade"`, com a mensagem "o WhatsApp manda a composição corporal para cá (webhook:602)". |
| 11 | `routes.test.ts:207-214` | todo `${url}/app…` do `whatsapp-webhook/index.ts` resolve → cobre **`whatsapp-webhook/index.ts:655`** (`/app/vitalidade`). |
| 12 | `routes.test.ts:295-297` | `isPublicPath()` false para toda rota de `/app` (`src/lib/analytics.ts:22`). |

### A única forma de manter as duas rotas VIVAS renderizando a tela nova

**Manter as duas linhas de `src/lib/routes.ts:66-67` com `path` e `page` INTOCADOS, e trocar apenas o campo `Component`** para o mesmo `lazy(() => import("@/pages/Saude"))`:

```
{ path: "vitalidade",  Component: Saude, page: "Vitalidade",  since: "legacy" },
{ path: "alimentacao", Component: Saude, page: "Alimentacao", since: "legacy" },
```

O teste **nunca afirma qual componente um caminho renderiza** — só que (a) não é `Navigate`, (b) é um objeto `lazy`, e (c) o rótulo `page` bate com o mapa literal. Três entradas (`vitalidade`, `alimentacao` e uma `saude` nova) apontando para o mesmo `lazy` passam nas doze condições acima.

**O que NÃO funciona, e por quê:**
- `<Navigate to="/app/saude">` → reprova em `:85` e em `:109`.
- Apagar uma das linhas → reprova em `:51`, `:58`, `:79`, `:164` e `:213`.
- Renomear `page` para `"Saude"` nas duas → reprova em `:79` (mapa literal) e cria `id` duplicado no `RouteObject` de `:33`.
- Trocar o `path` → reprova em `:51` e quebra `whatsapp-webhook/index.ts:655`, que o teste `:207-214` confere.

**Duas consequências operacionais disso:**
1. A página `Saude` passa a ser montada em **três endereços diferentes**. Qualquer lógica dela que dependa de `useLocation()` / aba ativa / âncora precisa tolerar isso.
2. `since` é a união `"legacy" | "fase-4"` (`routes.ts:51`). Uma rota `saude` nova exige alargar a união — **isso é erro de compilação, e é o tipo bom**. `routes.test.ts:282-285` só trava o `since` de `jornada`.

### Deriva já existente, registrada aqui

`routes.ts:162` e `:165` citam `supabase/functions/whatsapp-webhook/index.ts:582` e `:602`. As linhas reais hoje são **`:635`** (desvio de fatura → `/app/prosperidade`) e **`:655`** (composição corporal → `/app/vitalidade`).

O teste `routes.test.ts:177-183` só exige o prefixo `/^supabase\/|^public\/|^src\//` — então a procedência errada **passa verde**. Inventário com procedência errada é exatamente o que faz alguém apagar a rota achando que checou.

---

## 5) A INCOERÊNCIA QUE JÁ EXISTE

Ela é real e está **documentada como decisão consciente**, não como acidente:

- `src/lib/healthImport.ts:795-799`: *"`alimentacao`, não `vitalidade`: é o pilar que o resto do app usa para peso (Alimentacao.tsx, Onboarding.tsx) e o que a regra do CAPTURE_TOOL…"*
- `src/lib/appleHealth.ts:355-358`: mesma justificativa, palavra por palavra.

Ou seja: a convenção se auto-justificou. `water` sob `alimentacao` (`trackers.ts:38`) **não tem nem essa justificativa escrita**.

### A unificação RESOLVE de verdade — não empurra

1. **Peso sob Alimentação, sono sob Vitalidade** — `trackers.ts:39` (`weight → alimentacao`) vs. `trackers.ts:41` (`sleep → vitalidade`). Some a pergunta. Somem junto as notas de rodapé que só existem para explicar a divisão: `Alimentacao.tsx:511` ("sono e treinos na Vitalidade"), `_shared/lib.ts:1132` ("peso na aba Alimentação; condições e medicamentos na Vitalidade"), `ai-chat/index.ts:93` (idem), `Onboarding.tsx:545-551` (três linhas de recibo).

2. **Proteína pintada de Vitalidade** — `Hoje.tsx:650` usa `--vitalidade` para a barra de proteína, mas `protein` é tracker de `alimentacao` (`trackers.ts:37`). Contradição visual direta, na tela mais usada do app. Com uma cor só, evapora.

3. **O indicador de Alimentação ignora 3 dos seus 4 trackers** — `Score.tsx:167-177` calcula o score só por `mealDays` ("quantos dos últimos 14 dias tiveram refeições registradas"). Água (`trackers.ts:38`), peso (`:39`) e proteína (`:37`) estão sob `alimentacao` e **não contribuem com absolutamente nada** para o indicador desse pilar. Um indicador de Saúde que soma sono + treino + refeição + hidratação fica coerente pela primeira vez.

4. **Blueprint e Planos com duas cores para o mesmo corpo** — `blueprint.ts:77-78`, `Planos.tsx:49` e `PlanSections.tsx:62-63` pintam `alimentar` de sálvia e `treino` de coral. São o mesmo plano de corpo, entregues no mesmo Blueprint, lado a lado na mesma lista.

5. **Onboarding com duas heurísticas concorrentes** — `pillars.ts:44-45`: "emagrecer"/"peso" cai em `vitalidade` (`:44`), "dieta"/"aliment" cai em `alimentacao` (`:45`), e o empate é resolvido por **ordem do array** (`:51`, `for … if (re.test(g)) return id`). Quem digita "quero emagrecer comendo melhor" ganha `vitalidade` por acidente de ordenação. Um pilar só torna o empate impossível.

6. **Duas decisões de privacidade sobre o mesmo corpo** — `Ajustes.tsx:163-164` pede duas autorizações separadas ("Vitalidade (sono e treinos)" e "Alimentação (refeições, peso, hidratação)") para a mesma intimidade física. Vira uma.

7. **Dois destinos para a mesma intenção** — `TrendInsights.tsx:125` manda para `/app/alimentacao` e `:140` para `/app/vitalidade`; `QuickActions.tsx:470` e `:479` idem; `Hoje.tsx:296` e `:539-540` idem. Todo "registrar meu corpo" passa a ter um endereço.

8. **Auto-ativação dupla no onboarding** — `Onboarding.tsx:314-315`: TMB/treinos/sono ligam `vitalidade`; gasto com comida/restrições ligam `alimentacao`. Quem declara os dois liga dois pilares sem nunca ter escolhido dois.

### O que a unificação NÃO resolve (e vale dizer ao fundador)

- **O cruzamento comida ↔ dinheiro continua partido por desenho.** `daily_metrics.food_spend` sai das categorias `'Mercado'` e `'Alimentação fora'` (`migrations/20260904120000_agregados_e_tendencias.sql:106-112`; `migrations/20260907120000_cobertura_por_extrato.sql:68-70`), que vivem em **prosperidade** (`src/lib/prosperidade.ts:14, 20`). A prova nº 1 do posicionamento — *"o plano alimentar que cabe no seu bolso"* (`POSICIONAMENTO.md:12, 62`) — atravessa Saúde × Prosperidade antes e depois. Unificar não aproxima isso um milímetro.

- **Colisão de nome NOVA, não herdada.** "Saúde" já é categoria de despesa (`src/lib/prosperidade.ts:14`; `_shared/lib.ts:1941`; regra de categorização em `_shared/lib.ts:2012`: "farmácia/consulta → Saúde"). Um pilar Saúde e uma categoria Saúde no mesmo retrato do Conselheiro é ambiguidade **criada pela mudança**.

- **O Mokari fica com quatro órgãos e três pilares.** `src/lib/mokariChange.ts:63-73` é explícito: *"Cada pilar tem uma peça e uma só: Alimentação são as folhas, Prosperidade os frutos, Mente as flores, Vitalidade as raízes."* A fusão obriga a escolher entre fundir dois órgãos do desenho ou deixar um órfão. Isso é **empurrado para a mesa de desenho**, não resolvido pelo id. Ver também `Mokari.tsx:116-123` (raízes), `:185-203` (folhas), `:501` ("as raízes, folhas, frutos e flores vêm dos seus quatro pilares"), e `mokariLayers.ts:319-323`.

- **Duas cores viram uma — e não há média.** `--vitalidade` é coral (`8 78% 56%`) e `--alimentacao` é sálvia (`150 38% 40%`), em `src/index.css:57-58`; no escuro, `8 88% 66%` e `150 45% 56%` (`:142-143`). São **142° de distância na roda**. É escolha de marca, em dois temas, mais o token do Tailwind (`tailwind.config.ts:32-33`) e a classe utilitária usada em `Batalhas.tsx:128`.

- **A copy de "quatro" espalhada.** `Landing.tsx:420` ("Uma vida só. Quatro pilares."), `Landing.tsx:667` ("vê os 4 pilares"), `Mokari.tsx:135, 284, 409, 501`, `useMokariData.tsx:77`, `mokariChange.ts:64`, `Score.tsx:209`, `_shared/lib.ts:262`, `README.md:3`, `POSICIONAMENTO.md:103`. Nada disso quebra; tudo isso mente.

---

## 6) RISCO — as 5 mais prováveis de quebrar em SILÊNCIO (sem erro de compilação)

### 1. Inversão de privacidade no `ai_scopes`

`src/pages/Ajustes.tsx:168` e `supabase/functions/_shared/lib.ts:653-657` usam o padrão **`raw[id] !== false`** — ou seja, **chave ausente significa AUTORIZADO**.

Quem desligou `alimentacao` (não quer que o Conselheiro leia peso e refeições) e não tiver a chave `saude` gravada passa a ser lido **por padrão**, já no próximo briefing. Os 7 gates de `_shared/lib.ts:835, 886, 917, 934, 952, 1040, 1061` abrem todos de uma vez.

Sem erro, sem aviso, sem log. **É a pior da lista**, porque o dano é de confiança, é retroativo, e a pessoa descobre pelo que o Conselheiro diz.

### 2. A pessoa que pausou pilares tem o app inteiro devolvido

`src/lib/pillars.ts:31-34`:

```
const list = (pillars ?? []).filter((p): p is PillarId => PILLARS.some((x) => x.id === p));
return new Set(list.length ? list : PILLARS.map((p) => p.id));
```

`activePillarSet` **filtra ids desconhecidos** e, se a lista sobrar vazia, **considera todos ativos**. Um perfil com `pillars: ["vitalidade","alimentacao"]` sem backfill vira lista vazia → fallback → Hoje (`Hoje.tsx`), Score (`Score.tsx:210-212`), Pilares (`Pilares.tsx:28-30`), Jornada (`Jornada.tsx:131-134`) e a CaptureBar voltam a mostrar **Prosperidade e Mente** para quem escolheu não ter.

O comentário de `pillars.ts:29-30` chama isso de proteção — *"nunca escondemos o app inteiro por engano"*. Aqui a proteção **vira o bug**.

### 3. Regressão do Mokari — e ela é proibida por contrato

`src/hooks/useMokariData.tsx:52-54` conta por `.eq("pillar", pillar)`. Enquanto o histórico disser `vitalidade`/`alimentacao`, a contagem de `saude` é **0** → afinidade 0 (`mokari.ts:284-288`) → **raízes e folhas somem da árvore de quem já as tinha** (`Mokari.tsx:123, 196-203, 388, 393`).

`src/lib/mokari.ts:7` (*"AS QUATRO REGRAS ÉTICAS SÃO CÓDIGO, NÃO TEXTO"*) e `src/hooks/useMokariData.tsx:74-78` (*"o Mokari de quem tinha Árvore em flor voltava a Broto, com afinidade zero nos quatro pilares. Regressão do conquistado é exatamente o que a regra 1 proíbe"*) dizem, em letras maiúsculas, que o cálculo **já foi mordido por isso antes**.

**Agravante:** `src/lib/mokariChange.ts:76-81` e `:124-127` guardam `marks` em **localStorage chaveado pelo id do pilar** (`readSnapshot`/`writeSnapshot`, `:88-100`). O snapshot antigo tem chaves que o código novo não lê — e `changesSince` anuncia "**Saúde cresceu**" do zero, como novidade de hoje, para uma pessoa que não fez nada.

### 4. O trigger continua escrevendo o pilar morto

`supabase/setup.sql:223` (`pillar text not null default 'vitalidade'`), `:252` e `:477` (`coalesce(h.pillar, 'vitalidade')`).

Todo hábito criado sem pilar explícito passa a gravar `life_events.pillar = 'vitalidade'` **para sempre**, num id que nenhuma tela conta mais. Postgres não reclama (**não há CHECK** — confirmado na seção 2), o `insert` dá certo, o XP é pago (`award_xp_for_event`, `setup.sql:1126+`) — e o evento fica **invisível** no Score (`Score.tsx:219`) e no Mokari (`useMokariData.tsx:53`).

É um **vazamento contínuo**, não um backfill que se faz uma vez. E some junto com ele o caminho de escrita de `Vitalidade.tsx:157` (`useState("vitalidade")` como pilar padrão do hábito novo) e `:260`.

### 5. Invalidação de cache que para de casar

`src/lib/queryKeys.ts:34` e `:39` carregam a string literal `"vitalidade"` dentro de `SLEEP_KEYS` e `LIFE_DATA_KEYS`. É um `as const` de strings — **renomear a `queryKey` da tela (`Vitalidade.tsx:226`) não gera erro nenhum aqui**.

Resultado: a pessoa registra sono pela CaptureBar ou pelo `SleepCheckin.tsx:55`, o toast diz "registrado", e a tela não muda até o refetch natural.

O próprio arquivo já avisa (`queryKeys.ts:14-16`) que **Vitalidade e Alimentacao estão na lista de "ainda invalidam tudo"** — o risco **cresce durante a migração**, não depois: enquanto uma tela usa chave nova e a outra chave velha, metade das gravações atualiza e metade não.

### Menção honrosa — não é silencioso, mas também não dá erro de compilação

`src/pages/Landing.tsx:89` e `:190` fazem `PILLARS.find((p) => p.id === ev.pillar)!` — **non-null assertion** sobre eventos de demo cujo `pillar` é string crua (`:24-47` na lista estática, `:129-151` no parser ao vivo da demo interativa).

Se as duas listas saírem de sincronia, é **tela branca na landing pública** — o ativo de aquisição, a "demo interativa" que `POSICIONAMENTO.md:62` lista como herói. TypeScript compila feliz, porque o `!` mandou ele calar.

---

## Resumo do terreno

**O banco é o lado fácil:** sem CHECK, sem enum, agregados indexados por `kind` e não por `pillar`, e remap lossless porque o `kind` guarda a granularidade fina (`_shared/lib.ts:1254-1255` é a prova).

**O caro está em três lugares:**

1. **`profiles.ai_scopes` e `profiles.pillars`** (`setup.sql:736` e `:22`), onde a fusão é genuinamente lossy e a escolha errada trai uma decisão explícita da pessoa.
2. **O Mokari** (`mokariChange.ts:63-73`, `Mokari.tsx:116-203`, `useMokariData.tsx:52-54`), que tem **quatro órgãos desenhados para quatro pilares** e uma regra escrita de não-regressão.
3. **Os ~20 pontos que carregam o id como string solta** (`queryKeys.ts:34/39`, `Score.tsx:127-128`, `Landing.tsx:24-47/129-151`, `Ajustes.tsx:163-164`, e todos os `pillar: "…"` de escrita), onde o TypeScript **não ajuda em nada**.

**As rotas não são o problema que parecem ser:** `routes.test.ts` permite manter `/app/vitalidade` e `/app/alimentacao` vivas renderizando a tela nova, desde que `path` e `page` fiquem intocados e só o `Component` mude. O que o teste **não** protege é a procedência do inventário — `routes.ts:162, 165` já aponta para linhas erradas do webhook (`:582`/`:602` quando o real é `:635`/`:655`).

---

*Levantamento apenas. Nenhum arquivo do projeto foi editado. Plano de implementação, ordem de backfill e testes-âncora: sob demanda.*
