# Vitalidade (fusão) e Social — plano fechado, antes do código

> Rodada 2 do esquadrão. Seis especialistas leram o produto inteiro contra o
> contrato (`PRINCIPIOS.md` e `POSICIONAMENTO.md`) para responder a dois
> pedidos do fundador: **unificar Vitalidade + Alimentação** e **criar um pilar
> Social** inspirado no GymRats, porém mais completo.
>
> A preocupação declarada era uma só: *que o app fique complexo e difícil de
> usar*. Este documento existe porque a parte cara não é o código — é o
> raciocínio. Decisão sem procedência volta à pauta a cada seis meses.

## O esquadrão

| Codinome      | Especialidade                    | O que entregou |
| ------------- | -------------------------------- | -------------- |
| **Compass**   | Planejamento                     | Inventário de 35 arquivos de produção e 7 de teste, com arquivo:linha |
| **Prisma**    | UI/UX                            | Arquitetura da tela, os 6 cortes, o lugar do Social, as telas |
| **Vitral**    | Arquitetura de IA                | Semântica de consentimento, sequência de deploy, custo medido |
| **Aduana**    | Dados compartilhados (novo)      | 13 tabelas, ~35 políticas de RLS, as 4 revogações |
| **Fiel**      | Ética da persuasão — **o veto**  | O veredito do Social e as 8 condições inegociáveis |
| **Farol**     | Marca                            | O nome, a cor e o ícone |

---

## As quatro decisões de fundador tomadas nesta rodada

1. **Social é CAMADA, não pilar.** Não tem dado próprio, não entra no Score, não
   gera XP. Espelha em grupo o que a pessoa já registra. O app fica com **3
   pilares**, e é assim que a fusão paga pelo recurso novo.
2. **Consentimento por tipo de dado e por grupo.** Tudo nasce fechado. Dado
   financeiro nunca é compartilhável — nem por opção.
3. **O pilar unificado chama-se Vitalidade**, não "Saúde".
4. **Duas levas:** Vitalidade primeiro, sozinha. Social depois.

---

## Por que não "Saúde" — a decisão que barateou tudo

Dois especialistas chegaram nisso por caminhos independentes.

**O motivo grave (Farol).** O item 7 da lista NUNCA (`POSICIONAMENTO.md:79`) é
*"Conselheiro fingindo ser profissional de saúde ou corretor"*, e o documento
declara que **cada item dessa lista tem versão pública em `/recusas`**. Batizar
de "Saúde" o pilar em que esse Conselheiro opera empurra o produto exatamente
para o enquadramento que os dois documentos passam o tempo todo recusando.

**O motivo concreto (Vitral).** A palavra "SAÚDE" já aparece **duas vezes no
retrato do Conselheiro, com dois significados**, hoje, antes da mudança:

- `_shared/lib.ts:728` — o bloco clínico: `SAÚDE — condições informadas...`
- `_shared/lib.ts:757` e `:790` — a categoria de despesa: `Maiores gastos:
  Mercado R$ 812,00, Saúde R$ 240,00...`

Um terceiro significado no mesmo prompt não é preciosismo. O cenário de falha:
a pessoa desliga o escopo do pilar, e o modelo passa a segurar uma proibição
sobre "saude" e um dado rotulado "Saúde". Ou ele cala sobre os R$ 240,00 que ela
**vê na tela Prosperidade** — reintroduzindo o furo de 13/09/2026 já corrigido em
`trendLines` — ou trata farmácia como licença para falar de saúde, que é
vazamento pelo lado aberto.

**O dividendo:** com o id `vitalidade`, a fusão deixa de ser *"criar `saude` em
35 arquivos"* e vira **absorção: `alimentacao` → `vitalidade`**.

| Artefato | Se fosse `saude` | Sendo `vitalidade` |
|---|---|---|
| `ai_scopes` — chave nova ausente = AUTORIZADO | **o risco central do levantamento** | não existe: a chave está em 100% dos perfis |
| Backfill de `life_events.pillar` | 2 valores legados | 1 |
| `habits.pillar default` + 2 triggers | 3 objetos SQL | **zero** |
| `--vitalidade`, `/app/vitalidade`, `whatsapp-webhook:655` | renomear + redirect | **zero** |
| Prompts de `briefing` e `lib.ts` ("ESTIMATIVAS DE VITALIDADE") | reescrever 3 | **zero** |
| `POSICIONAMENTO.md §H.2` (documento que é contrato) | emenda de fundador | **zero** |

E a rota congelada que o WhatsApp usa por nome, em template aprovado pela Meta,
passa a estar **certa** — não apenas tolerada.

**Identidade final:** pilar Vitalidade · atributo Vitalidade · ícone `HeartPulse`
(a maçã sai) · matiz sálvia 150° no token `--vitalidade` · coral 8° renasce como
`--mokari-raiz` · `--alimentacao` sai · desc *"Corpo, sono, treino e o que você
come"* — comida em quarto lugar na frase, sempre, porque ordem é posicionamento.

---

# TRILHA 1 — Vitalidade absorve Alimentação

## O achado que barateia o resto

`Vitalidade.tsx:234-239` e `Alimentacao.tsx:128,144,158` consultam `life_events`
**por `kind`, nunca por `pillar`**. As duas telas, como dados, já são uma só.

O campo `pillar` só serve para três coisas: **agregar** (`Score.tsx:219`,
`useMokariData.tsx:52-54`), **pintar** e **prompt**. Fundir tela é barato; o caro
é agregação e consentimento.

## As duas regras que não podem ser invertidas

Os dois campos genuinamente *lossy* pedem semânticas **opostas**.

| Campo | Regra | Por quê |
|---|---|---|
| `profiles.ai_scopes` | **E** | Registro de **consentimento**. O código lê `raw[id] !== false` — *chave ausente = autorizado*. Sob OU, uma refatoração nossa devolve ao Conselheiro peso, calorias, proteína e hidratação sem a pessoa tocar em nada. Não existe consentimento para isso, nem notificação. Dado analisado não desanalisa. |
| `profiles.pillars` | **OU** | Registro de **superfície**. Aqui esconder é o dano. |

A precedência do E já está escrita e testada no mesmo arquivo: `lib.ts:470` usa
`pilares.every((p) => scopes[p] !== false)` — `every`, não `some`; e `lib.ts:283`
declara *"na dúvida, o retrato fica mais pobre, nunca mentiroso"*.

**E o argumento mais forte, que ninguém costuma citar:** hoje existe um estado de
retrato incoerente que a fusão **torna impossível** — `vitalidade=true,
alimentacao=false`. O Conselheiro recebe treinos e sono e **nenhum peso, nenhuma
caloria**; e aí o protocolo de planos exige "peso atual" e manda pedir o que
falta. Ele pede um dado que a pessoa deliberadamente escondeu, num retrato que já
lhe disse "não peça para reativar". Meio corpo visível era um bug de contexto. O
E elimina esse estado do universo.

**Antes de decidir, rode a contagem** — o número é do fundador, não do time:

```sql
select count(*) filter (where (ai_scopes->>'alimentacao') = 'false'
                          and (ai_scopes->>'vitalidade')  is distinct from 'false') as so_ali,
       count(*) as total
from public.profiles;
```

`so_ali` é exatamente quem perde análise por causa do E. Se for perto de zero — o
provável, já que o default liga tudo — a discussão é teórica.

## O vazamento silencioso que quase passou

`Ajustes.tsx:172-181` grava o objeto `ai_scopes` **inteiro**, reconstruído a
partir da constante `SCOPES`:

```ts
for (const sc of SCOPES) next[sc.id] = raw[sc.id] !== false;
await supabase.from("profiles").update({ ai_scopes: next })
```

Se o front novo tirar `alimentacao` da lista, o primeiro toque em **qualquer**
interruptor de privacidade apaga a chave do banco. Para qualquer função ainda
velha — ou para um rollback — chave ausente significa **autorizado**. A pessoa
mexe na tela de privacidade e a consequência é reabrir o que ela havia fechado.

**Regra da janela, inegociável:** enquanto existir função velha em produção, o
toggle fundido **espelha o valor nas duas chaves**.

## A defesa real não é a migration: é a leitura derivada

O novo `lib.ts:653-657` não lê a chave nova direto. Ele **deriva**:

```ts
vitalidade: rawScopes.vitalidade !== false && rawScopes.alimentacao !== false,
```

Com isso, as quatro combinações de perfil × função fecham corretamente, e **a
migration pode rodar antes, depois, no meio ou nunca**. Migration como
otimização, não como correção, é a única forma de migração que não precisa ser
perfeita.

**O teste que prova isso**, e que se escreve antes de tudo: um perfil com
`{"vitalidade": true, "alimentacao": false}` — sem chave nova — passando por
`buildSnapshot` da função nova, e o retrato não pode conter peso, calorias,
proteína, hidratação nem `refeicao_gasto_comida`. Se ele passar, a ordem de
deploy deixou de ser um risco.

## O campo `pillar` sai do CAPTURE_TOOL

Três razões, em ordem de força:

1. **É o único campo da proposta que a pessoa não consegue auditar.** Todo o
   resto do cartão de confirmação é frase em português que ela lê e corrige. O
   pilar é um pontinho colorido. Campo que ninguém confere não pode depender de
   escritor probabilístico. Mesma doutrina de `insights.ts`: **o modelo explica,
   o código calcula.**
2. **O enum mora dentro do prefixo cacheado** (`tools → system → messages`).
   Regra de conversão em código nunca invalida cache.
3. **É 100% derivável de `kind`.** A própria descrição já é uma tabela.

A normalização vira `canonicalPillar(kind, raw)` em `_shared/lib.ts`, com os
aliases legados guardados **para sempre** — custam um lookup e cobrem linha
antiga, cliente desatualizado e rollback.

**Bônus que a leitura expôs:** `note` não está no mapeamento. O modelo hoje chuta
o pilar de toda nota livre, sem instrução nenhuma. Ao derivar, decide-se
explicitamente (`mente`) em vez de deixar o chute continuar.

## A sequência de deploy

**R1 — EXPAND.** Nenhum byte de prompt ou de tool muda; **cache intacta**.
Leitores passam a aceitar os dois valores; entra a leitura derivada de escopos, o
espelho em `Ajustes.tsx`, a migration de `ai_scopes` e o `canonicalPillar` sem ser
chamado na escrita ainda.

**R2 — MIGRATE.** Todos os escritores num **único deploy** — e isso é regra, não
estilo: cada edição do prefixo faz cada usuário ativo pagar escrita onde pagaria
leitura (~R$ 0,10 por usuário, uma vez; ~R$ 105 para mil ativos). Três deploys que
tocam o prefixo custam três vezes isso. Entram: o `pillar` fora do tool, o
`canonicalPillar` aplicado nos dois pontos de estrangulamento (saída do servidor e
`lifeEventRow`), os prompts de tela, e o backfill.

**R3 — CONTRACT**, uma release depois: a chave `alimentacao` some, a derivação e o
espelho saem **juntos**, os leitores param de aceitar o valor legado.
`canonicalPillar` fica.

## O Mokari: o invariante escrito não era o invariante real

`mokariChange.ts:63-73` diz "cada pilar tem uma peça e uma só". **O invariante
verdadeiro é outro:** cada órgão tem UMA fonte, e nenhuma fonte alimenta dois
órgãos. Esse sobrevive intacto — o que morre é o acoplamento órgão↔pilar.

A unidade passa a ser **órgão**: 4 órgãos ← 4 grupos de `kind` ← 3 pilares.
Vitalidade desenha duas peças porque tem duas naturezas: **a raiz sustenta (sono,
treino), a folha nutre (comida, água).**

A aritmética prova que ninguém regride: `raiz = sleep+nap+workout` é exatamente o
antigo `pillar='vitalidade'`; `folha = meal+water` é exatamente o antigo
`pillar='alimentacao'` (peso e corpo já saem antes de qualquer conta, regra 3).

**O pixel que mudaria sozinho** — e é aqui que o desenho quase falhou:
`Mokari.tsx:55-57` pinta cada órgão com a cor do **pilar**. Com uma cor só,
**raiz e folha ficariam do mesmo tom** — regressão visual do conquistado, pela
porta dos fundos, exatamente como o `data ?? []` já furou a regra 1 pela camada de
dados. Solução: tokens de órgão (`--mokari-raiz` = o coral de hoje,
`--mokari-folha` = a sálvia de hoje), e `color()` lendo órgão, não pilar. Zero
pixel alterado, e a árvore deixa de ser refém da paleta de pilares para sempre.

**O piso de transição**, contra dado sujo: uma única linha com `pillar='vitalidade'`
num `meal` derrubaria a regra 1 por dado sujo, não por erro de desenho.

```
raiz  = max( conta(kind in sleep,nap,workout), conta(pillar='vitalidade') )
folha = max( conta(kind in meal,water),        conta(pillar='alimentacao') )
```

**E o `localStorage`:** `mokariChange.ts:88-100` guarda marcas chaveadas por id de
pilar. Sem tratamento, `changesSince` anuncia *"Vitalidade cresceu"* do zero, como
novidade de hoje, para quem não fez nada. `marksOf()` passa a ser chaveado por
órgão.

**A frase que o usuário lê** (`Mokari.tsx:501` hoje diz "vêm dos seus quatro
pilares" e vai mentir) passa a citar **atos**, não pilares:

> As raízes vêm do que sustenta você — treino e sono. As folhas, do que nutre —
> comida e água. Os frutos vêm do dinheiro; as flores, da mente.

É melhor mesmo sem a fusão: ninguém registra "um pilar", registra um treino. E
não precisa ser reescrita na próxima vez que a arquitetura mudar.

## A cor: sálvia, e o argumento não é estético

Com 3 pilares as matizes ficam **42° (ouro) · 150° (sálvia) · 258° (lilás)** —
dois intervalos de 108°. Com coral seriam **8° · 42° · 258°**, e coral ficaria a
**34° do ouro**. Em bolinha de 6px no hub e ícone de 20px, 34° não é uma paleta:
é a mesma cor duas vezes. E o ouro não é negociável — é o `--gold` do XP, do
nível e do REGISTRAR, o "um só protagonista" que o `index.css` declara. Marca não
gasta a cor do protagonista para salvar a cor de um coadjuvante.

Reforço: o coral tem ficha corrida de contraste **registrada no próprio código**
(`Vitalidade.tsx:398-404`) — branco sobre coral dá 2,86:1 no escuro.

O risco de "app de dieta" não mora na matiz: mora no nome, no ícone e na primeira
linha de copy. Por isso a maçã morre e fica o `HeartPulse`. Sálvia + batimento é
corpo vivo; sálvia + maçã é MyFitnessPal.

**Higiene:** não fazer 39 substituições num commit. Declarar a sálvia em
`--vitalidade` e manter `--alimentacao: var(--vitalidade)` por **uma release**,
marcado `@deprecated` **com data de remoção escrita no comentário**. Sem prazo
escrito, apelido temporário vira permanente.

## A tela: 16 cartões visíveis → 9

**Três abas, e a primeira dobra FORA das abas.** Não é gosto: `Alimentacao.tsx:452`
já validou 3 abas nesta mesma matéria e ninguém reclamou. Seções ancoradas parecem
mais simples e são piores aqui — mantêm o scroll inteiro e transferem para a
pessoa o trabalho de ignorar 80% da tela.

**A dobra:** `h1`, subtítulo, e **um cartão só — registrar**, com 4 chips de 1
toque (Refeição · Água · Treino · Sono).

**O que NÃO entra na dobra: barra de progresso nenhuma.** `Hoje.tsx:585-706` já é
o painel do dia. Se Vitalidade abrir com "seu dia em números", o app passa a ter
**dois painéis do mesmo dia** — e a fusão terá dobrado a percepção de complexidade
enquanto reduzia um pilar.

> **Hoje é o dono do dia. Vitalidade é a mesa de trabalho.**

| Aba | Conteúdo |
|---|---|
| **Meu dia** (padrão) | o que a captura dourada não alcança: foto→calorias, garrafas de água, chips de grupo muscular, horas de sono/soneca |
| **Meu corpo** | peso + gráfico + meta, composição, mapa de corpo treinado, condições de saúde e medicamentos |
| **Histórico** | uma linha por dia com o que houve + o heatmap |

**Os 6 cortes que fazem a fusão valer.** Sem eles a fusão piora o app — e a culpa
não será do Social:

1. Um cartão-assinatura, não dois (`Alimentacao.tsx:435` e `Vitalidade.tsx:100`
   são a mesma peça na mesma posição).
2. Radar + barras dos mesmos 7 números (`Vitalidade.tsx:478-510`) — dois gráficos
   da mesma tabela. Fica a barra ordenada.
3. Seis `GoalInput` espalhados → uma folha "Minhas metas". Hoje a pessoa caça meta
   em 6 cartões de 2 telas.
4. "Registro rápido em texto" (`Alimentacao.tsx:649-657`) — é a CaptureBar com
   menos poder, e o REGISTRAR já está em toda tela.
5. Hábitos diários sai (`Vitalidade.tsx:530-573`) — não é vitalidade: o próprio
   `<Select>` oferece os 4 pilares.
6. Três históricos → um.

**Entrada por `/app/alimentacao`:** a rota continua **renderizando**, nunca
redirecionando — `routes.test.ts` impõe 12 condições, mas nunca afirma qual
componente um caminho renderiza. Muda só o `Component`. Abre a aba "Meu dia"
ancorada em comida, com uma linha única de reorientação no padrão do
`FirstTimeTip`: *"Treino, sono e comida agora vivem juntos, em Vitalidade."*

**Cor no painel do dia**, para não empilhar quatro barras sálvia: cor **por
domínio, não por linha** — sálvia (kcal, proteína, treinos, sono) · azul (água) ·
ouro (teto de gasto).

## O que a fusão conserta de graça

- Peso sob Alimentação e sono sob Vitalidade — a pergunta some, e somem as notas
  de rodapé que só existiam para explicar a divisão.
- A barra de proteína pintada de `--vitalidade` sendo tracker de alimentação
  (`Hoje.tsx:650`) — contradição visual na tela mais usada.
- O indicador de Alimentação que ignora 3 dos seus 4 trackers (`Score.tsx:167-177`
  só conta `mealDays`; água, peso e proteína não contribuem com nada).
- O empate do onboarding: *"quero emagrecer comendo melhor"* hoje cai em
  Vitalidade por acidente de ordem do array (`pillars.ts:44-45,51`).
- Duas autorizações de privacidade para a mesma intimidade física viram uma.
- O estado "meio corpo visível" sai do universo — o maior ganho de qualidade, e é
  de graça.

## O que a fusão NÃO conserta (é honesto dizer)

- **Comida × dinheiro continua partido por desenho.** `daily_metrics.food_spend`
  sai de categorias que vivem em prosperidade. A prova nº 1 do posicionamento —
  *"o plano alimentar que cabe no seu bolso"* — atravessa Vitalidade ×
  Prosperidade antes e depois.
- **A copy de "quatro" espalhada** (`Landing.tsx:420,667`, `Mokari.tsx`,
  `Score.tsx:209`, README, POSICIONAMENTO). Nada quebra; tudo mente.

## Dívida achada de graça

`routes.ts:162,165` cita `whatsapp-webhook/index.ts:582` e `:602`; as linhas
reais são `:635` e `:655`. O teste só confere o prefixo do caminho, então a
procedência errada **passa verde** — e inventário com procedência errada é
exatamente o que faz alguém apagar uma rota achando que conferiu.

---

# TRILHA 2 — Social

## O veredito

**SIM ao Social. NÃO ao GymRats.** A distinção não é de grau, é de objeto.

O **GymRats** é construído em volta do **desempenho alheio**: o feed mostra o que
os outros fizeram, o ranking ordena pessoas, o push lembra você de que alguém
andou enquanto você parou. Esse motor só funciona enquanto a pessoa não percebe
que a inquietação ao abrir o app foi projetada — manipulação pela definição de
Susser/Roessler/Nissenbaum, e já recusada por escrito no Dilema 4.

O que passa é um Social construído em volta do **compromisso**: um combinado
explícito, com início, fim e resultado coletivo. *"Nós quatro, quatro treinos por
semana, até dia 30."* Compromisso com terceiros funciona **melhor** com a pessoa
plenamente consciente do mecanismo — que é justamente o teste que o feed reprova.

## O achado que ninguém tinha procurado

`src/lib/battles.ts:29`, primeira linha de `BATTLE_TEMPLATES`:

```ts
{ name: "Redes sociais", triggers: ["tédio", "celular na cama", "madrugada"],
  hint: "Rolagem infinita, comparação, horas perdidas" },
```

**O Ascende vende uma batalha contra feed e comparação.** Construir feed infinito
e ranking aqui dentro é a estrutura exata do Dilema 3 (a casa de apostas): lucrar
duas vezes com a mesma queda — uma vendendo a batalha, outra operando o gatilho.

Isso não veta o Social. Veta o **feed** e o **ranking ordinal** como forma. No dia
em que a contradição for notada em público, não se perde o Social — perde-se a
`/recusas` inteira, que é o ativo caro construído por oito itens hoje verdadeiros
no código.

## As 8 condições inegociáveis (se uma cair, o voto vira NÃO)

| # | Condição |
|---|---|
| C1 | O objeto é o combinado, não o mural. Todo grupo/desafio tem data de fim e **expira sozinho**. |
| C2 | **Reciprocidade.** Você só vê de alguém o tipo de dado que você também compartilha. Sem espectador. |
| C3 | Comparação sempre contra a meta **da própria pessoa**. |
| C4 | **Teto de notificação inalterado.** Cinco grupos não geram cinco vezes mais push. |
| C5 | Consentimento **entendido**: preview literal, com os dados reais dela, antes do confirmar. |
| C6 | **Sem descoberta pública.** Só convite direto. Mata o motor viral de propósito. |
| C7 | Participar de grupo é do **plano grátis**; cair para o grátis nunca remove ninguém de um grupo — senão cancelar passa a custar amigos (roach motel). |
| C8 | Social não pontua no Score nem gera XP. |

## O teste do zero (a regra que decide o catálogo)

Uma métrica só é compartilhável se **o zero dela** for informação que a pessoa não
se importaria de ouvir lida em voz alta pelo grupo.

| Métrica | Zero significa | Entra? |
|---|---|---|
| Treino, água, sono, refeição, gratidão | "não registrou" | ✅ |
| Humor | "parou de conseguir se olhar" | ❌ |
| Prática espiritual | "se afastou da fé" | ❌ (dado sensível, LGPD art. 5º, II) |
| Batalha | "recaiu" | ❌ |
| Peso e composição | — | ❌ (o Mokari já remove de toda conta, regra 3) |
| Qualquer coisa financeira | — | ❌ nem derivado, nem booleano |

*"Cumpriu o teto de gasto hoje: sim/não" já é dado financeiro.*

Isso é melhor que classificar por sensibilidade do conteúdo, porque no agregado o
conteúdo já não existe — **o que vaza é sempre a ausência**.

## O que fica no lugar do ranking

- **Camada 0 — a barra coletiva** (padrão): *"34 de 50 treinos combinados nesta
  semana"*. Quem está atrás continua **contribuindo** em vez de aparecer atrás.
- **Camada 1 — a lista, sem ordem e contra a própria meta.** *"Ana: 3 de 3" ·
  "Você: 2 de 4"*. Quem combinou 2 e cumpriu aparece completo ao lado de quem
  combinou 6 — que é a verdade que o ordinal apaga. Premia honestidade de meta,
  não tempo livre nem dinheiro; ou seja, não pune a nossa cliente.
- **Camada 2 — desafio competitivo, opt-in, posição privada.** Cada um vê a
  própria posição; ninguém vê a de ninguém.
- **Camada 3 — o reconhecimento assimétrico**, recomendado construir **primeiro**:
  o grupo reconhece um **retorno** ("voltou depois de 9 dias") com o mesmo peso
  visual de um recorde. **A comparação social cura quando o grupo nota quem
  voltou, e fere quando o grupo ordena quem produziu.**

## A notificação do GymRats está vetada

*"Fulano treinou, e você?"* — vetado, sem versão suavizada. A primeira metade tem
utilidade zero para a vida dela; a segunda é onde mora o valor, e o valor é nosso.
O volume passaria a ser função de quantos amigos ela tem, não da vida dela — o
oposto do briefing 1x/dia que o Dilema 4 cita como prova de desenho.

**As que passam:** convite recebido (uma vez, expira em silêncio) · recado
dirigido (agrupado, máx. 1/dia) · reconhecimento recebido agregado · prazo do que
ela mesma escolheu · fechamento coletivo — **com a trava:** não enviar a quem não
participou nenhuma vez no ciclo. Nunca notificar alguém sobre um resultado
coletivo em que a ausência dela **é** a informação.

A infraestrutura para cumprir C4 já existe: `whatsapp_sends (user_id, kind,
sent_on)` é o livro-caixa de deduplicação. O Social entra no **mesmo contador por
usuário/dia**.

## O modelo de dados — e a frase que o justifica

Três fatos do banco atual determinam tudo:

1. **`life_events` já contém dinheiro.** O gatilho `tx_to_life_event`
   (`setup.sql:206`) grava toda transação como `kind='transaction'` com
   `payload.amount`. Treino, peso, diário e fatura moram na **mesma tabela**, no
   **mesmo `jsonb`**.
2. **RLS é de linha, não de coluna.** Abrir a linha abre o `payload` inteiro.
3. **`profiles` carrega `monthly_income`, `medications`, `health_conditions`** na
   mesma linha do `name`.

> **A decisão "dado financeiro nunca é compartilhável" é _inexprimível_ como
> política sobre as tabelas de hoje.** Não porque seja difícil — porque a forma do
> dado não comporta o recorte.

Daí o desenho: **o grupo lê projeção, nunca a fonte.** `life_events`,
`transactions`, `habit_logs`, `battles`, `ai_memories` e `chat_messages` **não
ganham uma única política nova. Nunca.**

A defesa mais forte é estrutural, não política: a tabela de projeção **não tem uma
única coluna de texto**. O diário, a descrição da refeição e a análise da foto não
vazam porque **não existe onde eles caberem** — `value` é `numeric`. Uma política
pode ser escrita errado; uma coluna que não existe, não.

E **allowlist, nunca denylist**: um `kind` novo que apareça amanhã não vira métrica
compartilhável — ele simplesmente não tem para onde ir. Uma denylist ("todos menos
transaction") nasce aberta. Foi assim que o financeiro entraria: não por decisão,
por um `kind` novo num sábado.

**Publicar é copiar; revogar é apagar.** Fail-closed por **deleção**, não por
predicado — porque *"regra de privacidade como cláusula WHERE é regra a um bug de
distância: a janela esconde o passado, não apaga; uma regressão de um caractere
reexpõe um ano de histórico num deploy, em silêncio"*.

**Custo:** 7 migrations · 13 tabelas · ~35 políticas (das quais **6 concentram
todo o risco**) · 4 views · ~11 funções `security definer` · ~12 testes
obrigatórios. **Nada toca o front, e nenhuma linha existente de RLS muda** — se a
camada inteira for revertida, o app volta a ser de uma pessoa só sem migração de
volta.

## Três riscos estruturais que sobrevivem ao schema

1. **O buraco permanente é, ele mesmo, informação.** Um vão de 3 a 20 de setembro
   é lido pelo grupo como "aconteceu alguma coisa ali" — o controle de privacidade
   virou sinal social. A tela nunca mostra o denominador da janela de terceiro.
2. **Agregado não é anônimo em grupo pequeno.** Num grupo de 3, a barra coletiva
   mais as linhas individuais permitem deduzir o terceiro por subtração. **k mínimo
   de 4** consentimentos ativos para a barra aparecer.
3. **`greatest()` ignora NULL em Postgres.** Uma janela escrita como
   `day >= greatest(entrei_em(g), consentiu_em(g))` **abre tudo** quando a função
   devolve NULL para quem não é membro. Toda função de janela devolve
   `'infinity'::date` quando não há direito — nunca NULL.

## Onde o Social mora (sem inchar a barra)

A barra tem exatamente 5 alvos e um só dourado. Não cabe um sexto, e negociar isso
é resolver o problema errado.

Social vira **ferramenta transversal**: rota `/app/social`, cartão no bloco
"Ferramentas" de `Pilares.tsx:160` (onde Batalhas e Planos já moram) e uma linha
no hub Jornada — *"2 grupos · desafio da água termina sábado"*. **Sem badge, sem
bolinha de notificação:** bolinha vermelha é o motor de "abre o app", que é
exatamente o que o Dilema 4 proíbe.

O precedente que defende a escolha: **Batalhas** é o assunto mais íntimo do app e
mora exatamente aí.

## O primeiro desafio cruzado: "A Semana Inteira"

- **A unidade:** um *dia inteiro* = **3 dos 4 sinais** (treino, sono, comida,
  água). Três de quatro, não quatro de quatro: dia de descanso ainda conta, e quem
  desligou um tracker não fica de fora.
- **A meta do grupo:** `pessoas × 5` dias. Dois dias de folga por pessoa já
  embutidos — a regra do descanso aplicada no nível do grupo, não como perdão
  excepcional.
- **Prêmio:** nenhum. Sem XP, sem selo, sem troféu.

**Por que este e não um desafio de treino:** o GymRats pode copiar ranking de
treino numa sprint; não pode copiar um desafio que exige sono, comida e água na
mesma conta, porque ele não tem esses dados. É a única forma de o Social ser
**prova** da caixinha em vez de diluição dela.

## A fatura visível (linha para `/recusas`)

> **"Nosso Social nunca terá feed infinito, ranking de quem está na frente, nem
> notificação de 'fulano treinou, e você?'."**
>
> Grupos aqui existem para combinar e sustentar, não para comparar. Você escolhe,
> um por um, o que o grupo vê — nada nasce aberto, dinheiro nunca é
> compartilhável, e suas batalhas nunca saem daqui. Recusamos a engrenagem que faz
> um app social crescer, porque ela cresce com a sua insegurança. Temos uma Batalha
> contra redes sociais dentro do produto: seria estranho construir uma aqui dentro.

Complemento para a landing: **"Tem grupo, sim. Não tem plateia."**

---

## A matemática da complexidade, respondida com honestidade

4 − 1 + 1 = 4 em número. **Em percepção, fica mais complexo** — a menos que cinco
coisas sejam verdade.

A fusão é uma redução real, mas é um ganho **de mapa**: a pessoa sente uma vez, ao
reaprender onde as coisas ficam. O Social é um acréscimo de **superfície viva**:
gente, convite, desafio, estado que muda sem você fazer nada. Um kg de mapa não
compensa um kg de superfície viva.

**Fica mais simples se — e só se:**

1. **A fusão apagar superfície, não realocar.** Os 6 cortes entram. Se Vitalidade
   nascer com 16 cartões em 3 abas, a fusão piorou o app.
2. **Nenhuma barra de progresso nova.** Hoje continua o único painel do dia.
3. **O Social nascer desligado e silencioso.** Quem nunca abrir não deve sentir
   que existe.
4. **A barra continuar com 5 alvos e um só dourado.**
5. **Sair em duas entregas** — decidido.

Se as cinco valerem: percepção de *"app menor"* na Vitalidade, e *"app com um
bairro opcional"* no Social. Líquido positivo. Se a 1 ou a 3 caírem, o saldo fica
negativo e o número 4 vai mentir.

---

## O que ainda depende de decisão de fundador

1. **A janela de quem chega depois.** Adotado o fechado: quem entra em setembro
   não vê julho de ninguém. Mais seguro, possivelmente frustrante. Reversível na
   direção segura, não na outra.
2. **A cópia publicada por grupo.** Duplica dado para que revogar seja `DELETE` e
   não `WHERE`. Custa amplificação de escrita e reconciliação permanente. É o
   risco nº 1 de gravidade — **o custo está pago?**
3. **`peso_registrado` no catálogo.** Sobreviveu ao corte do delta, mas "não subiu
   na balança" é frase que alguém pode usar contra outra pessoa. Cortando, o
   catálogo cai para 8 e nada mais muda no modelo.
4. **Rodar a contagem `so_ali`** antes de aprovar o E em `ai_scopes`.
