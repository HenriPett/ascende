# Parecer de UX — rodada 2: Mokari, cor e a tela do Social

> Três decisões de desenho. Nada implementado, nenhum arquivo do projeto editado.
> Lido para esta rodada: `lib/mokari.ts`, `lib/mokariChange.ts`, `lib/mokariDensity.ts`,
> `hooks/useMokariData.tsx`, `components/core/Mokari.tsx`, `index.css`, `lib/blueprint.ts`,
> `pages/Planos.tsx`, `components/core/PlanSections.tsx`, `pages/Hoje.tsx`,
> `_shared/lib.ts` (mapa kind→pillar), `PRINCIPIOS.md`, `POSICIONAMENTO.md`.

---

## 1) O MOKARI — confirmo a leitura, com uma correção que muda o desenho

### Confirmado

Sua leitura está certa no essencial: **contar por `kind` em vez de por `pillar` zera a
regressão.** A prova é aritmética e não depende de confiança:

- `raiz` = `sleep + nap + workout` = exatamente o antigo `pillar = 'vitalidade'`
- `folha` = `meal + water` = exatamente o antigo `pillar = 'alimentacao'`
  (`weight`/`body` já saem antes de qualquer conta, por `IGNORED_KINDS` — regra 3)

O mapa é declarado e único (`_shared/lib.ts:1254-1255`: `sleep/nap/workout→vitalidade;
meal/water/weight→alimentacao`). As somas são idênticas, então `mokariDensity` devolve a
mesma densidade, `affinity` a mesma marca-d'água e ninguém vê uma folha a menos.

### A correção (e é ela que salva o "não muda um pixel")

**O contrato de `mokariChange.ts:63-73` não é "um pilar, um órgão". O invariante real é
"cada órgão tem UMA fonte, e nenhuma fonte alimenta dois órgãos".** Esse invariante
sobrevive à fusão intacto; o que morre é só o *acoplamento* órgão↔pilar. Então a unidade
do Mokari deixa de ser pilar e passa a ser **órgão**: 4 órgãos ← 4 grupos de `kind` ← 3
pilares. Escrito assim, "4 órgãos para 3 pilares" para de ser anomalia e volta a ser
simetria — a assimetria fica onde ela é verdade: **Saúde desenha duas peças porque tem
duas naturezas** (o que sustenta e o que nutre). Sua intuição de raiz+folha está certa, e
é bonita: é o único par de órgãos em que a divisão é legível sem explicação.

Mas há um pixel que **muda sozinho** se ninguém mexer, e é onde eu corrijo:

> **`Mokari.tsx:55-57` pinta cada órgão com a cor do PILAR** (`pillarVar(id)`).
> Se Saúde vira uma cor só (seção 2), **raiz e folha ficam do mesmo tom** e a árvore
> perde a distinção entre dois órgãos — regressão visual do conquistado, pela porta
> dos fundos, exatamente como o `data ?? []` de `useMokariData.tsx:74-78` furou a regra 1
> pela camada de dados e não pelo cálculo.

**Proposta:** a árvore ganha **tokens de órgão**, semeados com os valores de hoje —
`--mokari-raiz: 8 78% 56%` (o coral de hoje) e `--mokari-folha: 150 38% 40%` (a sálvia de
hoje), com os pares do tema escuro. O `color()` do Mokari passa a ler órgão, não pilar.
Resultado: **zero pixel alterado na árvore**, e a cor da árvore deixa de ser hostage da
paleta de pilares para sempre. De quebra, o coral não morre — **ele se aposenta como cor
de raiz**, que é o lugar onde coral sempre fez mais sentido do que como cor de categoria.

### O segundo furo possível, e como fechá-lo por construção

Contar por `kind` só é idêntico se toda linha histórica tiver `pillar` coerente com
`kind`. Se existir uma única linha em que a captura gravou `pillar='vitalidade'` para um
`meal`, a contagem nova fica **menor** que a antiga para aquele órgão — e a regra 1 cai
por um dado sujo, não por um erro de desenho. Não dá para auditar isso daqui, então eu
não apostaria na coerência: **piso explícito durante a transição.**

```
raiz  = max( conta(kind in sleep,nap,workout), conta(pillar='vitalidade') )
folha = max( conta(kind in meal,water),        conta(pillar='alimentacao') )
```

É o mesmo espírito da prova de não-regressão de `mokariDensity` ("a não-regressão é
provada por propriedade, não gravada num campo que pode faltar"): duas leituras, e o
desenho fica com a maior. Custa duas contagens `head:true` a mais numa query que já faz
quatro.

E `marksOf()` (`mokariChange.ts:74-82`) passa a ser chaveado por **órgão**, com quatro
chaves fixas — senão Saúde recebe uma marca só e o aviso "você evoluiu" volta a poder
disparar por mudança que não está desenhada, que é o medo escrito naquele comentário.
Mesma coisa em `Mokari.tsx:352-356`: `proximo` deve falar em órgão ("faltam 2 registros de
treino para uma raiz nova"), não em pilar.

### A frase que o usuário lê

`Mokari.tsx:501` hoje diz "vêm dos seus quatro pilares" e vai mentir. Substituição:

> O Mokari é o retrato do que você registrou até aqui. O corpo cresce com o seu XP
> acumulado. **As raízes vêm do que sustenta você — treino e sono. As folhas, do que
> nutre — comida e água. Os frutos vêm do dinheiro; as flores, da mente.** As quatro
> peças continuam crescendo sem limite — cada vez mais devagar, nunca parando. O céu
> acompanha o tempo de jornada. Ele nunca volta atrás: o que você construiu fica.

Nota de redação: a frase deixa de citar "pilares" e passa a citar **atos** (treino, sono,
comida, água, dinheiro, mente). É melhor mesmo sem a fusão — ninguém registra "um pilar",
registra um treino. E ela não precisa ser reescrita na próxima vez que a arquitetura de
pilares mudar.

Para o caso de alguém perguntar por que Saúde tem duas peças, uma linha dentro do mesmo
"O que é isto?": *"Saúde desenha duas: a raiz sustenta, a folha nutre."*

---

## 2) A COR — a Saúde é SÁLVIA. O coral se aposenta como raiz.

### A decisão

**`--saude: 150 38% 40%` (claro) / `150 45% 56%` (escuro)** — os valores atuais de
`--alimentacao`, sem um dígito de diferença. O coral sai da paleta de pilares.

### Defesa

1. **Distinguibilidade categórica — o argumento que decide.** Com três pilares, as matizes
   ficam: com sálvia → **42 (ouro) · 150 (sálvia) · 258 (lilás)**, dois intervalos de 108°.
   Com coral → **8 · 42 · 258**: coral e ouro a **34° de distância**. Cor de categoria a
   34° de distância, em bolinha de 6px no hub (`Jornada.tsx` `dots`) e em ícone de 20px,
   não é uma paleta — é a mesma cor duas vezes. E o ouro não é negociável: é o `--gold` do
   XP, do nível e do REGISTRAR, o "um só protagonista" que o `index.css` declara.
2. **O coral tem ficha corrida de contraste, escrita no próprio código.**
   `Vitalidade.tsx:398-404` registra: branco sobre coral dá **2,86:1 no escuro e 3,79:1 no
   claro**, e foi preciso trocar por tinta escura. Promover a matiz que não carrega texto
   ao pilar mais usado do app é comprar esse problema para todo cartão futuro.
3. **A árvore já concorda.** A folha do Mokari é sálvia. Verde é a cor botânica de
   crescimento, e Saúde é o pilar mais "vivo" dos três.
4. **O app já provou que cor semântica pode coexistir com cor de pilar**: a água é
   `hsl(205 70% 55%)` fixa em `Hoje.tsx:659`, azul, e ninguém reclamou. Ou seja: a paleta
   de pilares não precisa carregar todo significado — o que libera aposentar o coral sem
   perder expressividade.

### O contra-argumento honesto (e por que ele perde)

Coral é mais distintivo, mais emocional, e casa com o `HeartPulse`; sálvia corre o risco
de ler "app de dieta" justo quando o pilar deixou de ser só dieta. É um argumento de
marca, e marca não é minha alçada sozinho — **essa matiz passa pelo Farol, que tem veto.**
Minha recomendação é sálvia. Se o Farol escolher coral, a decisão vem com duas dívidas
obrigatórias: (a) coral **nunca** carrega texto branco, em nenhum lugar, e (b) o ouro de
`--prosperidade` (42) tem de se afastar do coral — o que é uma mexida de identidade bem
maior que esta. Sálvia é a escolha que não abre outra frente.

### O que acontece nos lugares citados

**a) Blueprint e Planos — plano alimentar (sálvia) × plano de treino (coral), lado a lado**
(`blueprint.ts:77-78`, `Planos.tsx:49`, `PlanSections.tsx:62-63`)

Os dois passam a ser `--saude`. **E está certo assim**: a cor nunca foi o que distinguia
esses cartões — o rótulo ("Alimentar" / "Treino") e o ícone (`UtensilsCrossed` /
`Dumbbell`) já fazem isso, e em `Planos.tsx` cada um tem **seção própria com título**.
Ressuscitar o coral como cor de *tipo de plano*, sem pilar por trás, seria recriar
exatamente a incoerência que estamos removendo: uma cor de categoria que não corresponde a
nenhuma categoria do app.

Efeito colateral bom: `PlanSections.KIND_VAR` (duas entradas que viram uma) deixa de
precisar ser mapa e vira constante. Três arquivos ficam menores.

**b) A barra de proteína pintada de `--vitalidade` sendo tracker de alimentação**
(`Hoje.tsx:650`)

**Essa incoerência se resolve de graça**: com a fusão, proteína e treino são o mesmo pilar,
e a barra fica certa sem ninguém consertar nada. Mas ela expõe um risco no painel: kcal,
proteína, treinos e sono todos em sálvia = quatro barras da mesma cor empilhadas. A regra
que eu recomendo para o "Seu dia em números" é **cor por domínio, não por linha**:

```
sálvia → kcal, proteína, treinos, sono   (Saúde)
azul   → água                            (já é assim, hsl(205 70% 55%))
ouro   → teto de gasto                   (Prosperidade)
```

Três cores em vez de quatro, e cada uma responde a uma pergunta diferente. Rótulo e ícone
distinguem as linhas dentro do domínio — como já distinguem hoje.

**c) Higiene de migração (24 usos de `var(--vitalidade)` em 6 arquivos, 15 de
`var(--alimentacao)`)**

Não faça 39 substituições num commit. Declare `--saude` como a verdade, e por **uma
release**: `--alimentacao: var(--saude)` e `--vitalidade: var(--saude)` como apelidos
marcados `@deprecated` com data de remoção no comentário — menos `--mokari-raiz`, que fica
com o coral. Assim nada quebra visualmente no meio do caminho e o grep final é mecânico. A
exigência de sempre nesta base: prazo escrito, senão apelido temporário vira permanente.

---

## 3) A TELA DO SOCIAL

Premissas fixadas pelo fundador e respeitadas em todos os desenhos: Social **não é pilar**,
**não pontua no Score**, compartilhamento é **opt-in por tipo de dado**, **tudo nasce
fechado**, **dinheiro nunca é compartilhável**.

### (a) Tela vazia — abriu Social e não tem grupo nenhum

```
┌────────────────────────────────────────────┐
│  Social                                    │
│  Quem está no mesmo aperto que você.       │
├────────────────────────────────────────────┤
│                                            │
│         ( ícone: duas pessoas )            │
│                                            │
│   Um grupo pequeno — você e duas, três     │
│   pessoas — que se acompanham na semana.   │
│   Não tem feed público, não tem            │
│   desconhecido, não tem placar de quem     │
│   treina mais.                             │
│                                            │
│   ┌──────────────────────────────────────┐ │
│   │       Criar um grupo                 │ │  ← primário
│   └──────────────────────────────────────┘ │
│        Tenho um link de convite →          │  ← secundário, texto
│                                            │
├────────────────────────────────────────────┤
│  🔒 Nasce fechado                          │
│  Nada seu é compartilhado até você         │
│  escolher, item por item. Dinheiro nunca   │
│  entra — nem se você quiser.               │
└────────────────────────────────────────────┘
```

Três coisas que essa tela **não** tem, de propósito: nenhuma sugestão de "pessoas que você
pode conhecer" (busca de gente é padrão de crescimento, não de serviço), nenhuma prévia de
feed alheio para dar vontade, e nenhum contador de "3 amigos seus já estão aqui" — isso é
pressão social disfarçada de informação.

### (b) Um grupo ativo

```
┌────────────────────────────────────────────┐
│  ← Grupo                            ⚙︎     │
│  Os Teimosos · 4 pessoas                   │
├────────────────────────────────────────────┤
│  A SEMANA INTEIRA          termina sábado  │
│                                            │
│  O grupo fez 14 dias inteiros de 20        │
│  ██████████████████░░░░░░░                 │
│  Faltam 6 — dá 2 por pessoa até sábado.    │
│                                            │
│  Um dia inteiro = 3 dos 4 sinais do dia    │
│  (treino · sono · comida · água).          │
├────────────────────────────────────────────┤
│  A SEMANA DE CADA UM                       │
│  Quem cumpriu o que prometeu:              │
│   1. Júlia    5 de 5 combinados   100%     │
│   2. Ana      4 de 4 combinados   100%     │
│   3. Você     4 de 5 combinados    80%     │
│                                            │
│  Você na semana passada: 3 de 5 (60%).     │
│  Subiu.                                    │
├────────────────────────────────────────────┤
│  ESTA SEMANA, NO GRUPO                     │
│  hoje                                      │
│   Júlia registrou um treino        [Força] │
│   Você fechou a água de hoje               │
│  ontem                                     │
│   Ana dormiu dentro da janela dela [Força] │
│   Pedro registrou uma refeição     [Força] │
│                                            │
│           ver a semana toda →              │
└────────────────────────────────────────────┘
```

Como cada regra da seção 4 da rodada 1 aparece aqui, concretamente:

- **O placar é do grupo contra a meta do grupo** (14 de 20). Quem está atrás está *dentro*
  do 14, não embaixo de uma tabela.
- **A meta já vem com folga embutida**: 4 pessoas × **5** dias, não × 7. O grupo pode
  fechar 100% com dois dias de descanso por pessoa. É a regra do dia de descanso
  (PRINCIPIOS) aplicada no nível do grupo, não como perdão excepcional.
- **"A semana de cada um" ranqueia cumprimento do próprio combinado**, não volume: Ana com
  4 de 4 está à frente de quem prometeu 6 e fez 5. Premia honestidade de meta, não tempo
  livre nem dinheiro — a nossa cliente.
- **Top 3 e para.** Não existe 4º lugar público. Se você não está no top 3, a sua linha
  aparece no lugar da 3ª — você vê a sua, nunca a de quem está abaixo.
- **A régua de verdade é você × você**: "na semana passada 60%. Subiu." É a única
  comparação que não tem alguém do outro lado.
- **O feed lista presença, nunca ausência.** Nenhuma linha diz que Pedro não registrou.
  Sem "visto por último", sem "online".
- **"Força" não tem contador visível.** O autor vê quantos apoios recebeu; o grupo não.
- **Nenhum número comparável**: sem kg, sem kcal, sem litros, sem gramas, sem R$, sem
  minutos. "Registrou um treino" — não "treinou 1h20".
- **Nada aqui dá XP.**

### (c) A folha de consentimento, na entrada do grupo

```
┌────────────────────────────────────────────┐
│  O que este grupo vê de você         ✕     │
│  Os Teimosos                               │
│                                            │
│  Tudo começa desligado. Ligue só o que     │
│  você quer que eles vejam — e sempre       │
│  como "feito", nunca com número.           │
│                                            │
│  🏋  Treino                          [ ○ ] │
│      "Você registrou um treino".           │
│      Sem duração, sem carga, sem qual.     │
│                                            │
│  🌙  Sono                            [ ○ ] │
│      "Dormiu dentro da janela dela".       │
│      Sem horas, sem horário.               │
│                                            │
│  🍽  Refeições                       [ ○ ] │
│      "Registrou uma refeição".             │
│      Sem foto, sem calorias, sem o que.    │
│                                            │
│  💧  Água                            [ ○ ] │
│      "Fechou a água de hoje".              │
│      Sem litros.                           │
│                                            │
│  ────────────────────────────────────────  │
│  Nunca compartilhável, em grupo nenhum:    │
│  🔒 dinheiro · peso e corpo · humor ·      │
│     diário · gratidão · batalhas ·         │
│     condições de saúde · medicamentos      │
│                                            │
│  Desligar depois não apaga nada: o seu     │
│  histórico continua seu, e o grupo         │
│  simplesmente para de ver.                 │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │            Entrar no grupo           │  │
│  └──────────────────────────────────────┘  │
│   Entrar sem compartilhar nada ainda →     │
└────────────────────────────────────────────┘
```

Quatro decisões de desenho nessa folha:

1. **Cada linha mostra a frase literal que o grupo vai ler.** Consentimento com exemplo do
   texto real é a única forma honesta — "compartilhar treinos" não diz se vai sair a carga.
2. **O bloco do nunca é visível e não tem interruptor.** Ele existe para a pessoa poder
   confiar no que *não* está lá. É a página `/recusas` em miniatura, no lugar onde a
   decisão acontece.
3. **Peso e corpo estão no bloco do nunca** — mesma razão da regra 3 do Mokari ("nunca
   ridiculariza o corpo"). Um grupo de saúde é justamente onde isso machucaria.
4. **"Entrar sem compartilhar nada ainda" é um caminho de verdade.** Dá para ser só
   torcida. Grupo que exige oferenda para deixar entrar é pedágio.

Reaproveita `tracking_prefs` como modelo mental e como padrão de código: mesma ideia de
"desligado ≠ deletado", já testada em `lib/trackers.ts`.

### (d) O convite — sem virar spam

```
┌────────────────────────────────────────────┐
│  Chamar alguém                       ✕     │
│                                            │
│  Um link. Você manda por onde já fala com  │
│  a pessoa — WhatsApp, no olho, o que for.  │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │  ascende.app/g/7fk2q                 │  │
│  └──────────────────────────────────────┘  │
│  [ Copiar link ]   [ Compartilhar ]        │
│                                            │
│  Vale para 1 pessoa e expira em 7 dias.    │
│  O Ascende não manda nada para ela: quem   │
│  convida é você.                           │
│                                            │
│  ────────────────────────────────────────  │
│  Convites em aberto                        │
│   7fk2q · criado ontem · expira em 6 dias  │
│                              [ cancelar ]  │
└────────────────────────────────────────────┘
```

As regras, que valem mais que o desenho:

- **O app nunca envia o convite.** Sem SMS, sem e-mail, sem push para quem não é usuário.
  O convite é um link que **a pessoa** manda pelo canal onde as duas já se falam.
- **Nenhuma leitura de agenda, contatos ou lista do WhatsApp.** Isso é o motor de
  crescimento viral clássico, e é também a maior porta de dados alheios que este app
  poderia abrir. Não abre.
- **Pedir duas vezes é cobrar** (padrão do `MokariInvite`): convite não aceito **expira em
  silêncio**. Sem lembrete para o convidado, sem "Ana ainda não respondeu, chamar de
  novo?" para quem convidou. Quem quiser insistir insiste fora do app, como gente.
- **Quem recusa não recebe outro convite do mesmo grupo.** A recusa é final até a própria
  pessoa pedir.
- **Vale para 1 pessoa e expira em 7 dias**: link vazado não vira porta aberta.
- Aparece um aviso ao 5º membro: *"Grupos pequenos funcionam melhor. A partir daqui, isso
  começa a virar plateia."* — não bloqueia, só nomeia.

### O primeiro desafio cruzado, de fábrica: **"A Semana Inteira"**

- **Duração:** 7 dias, de domingo a sábado.
- **A unidade:** um **dia inteiro** = **3 dos 4 sinais** do dia — treino, sono, comida,
  água. Três de quatro, não quatro de quatro: dia de descanso ainda conta pelos outros
  três, e quem desligou um tracker não fica de fora (conta 2 de 3).
- **A meta do grupo:** `pessoas × 5` dias inteiros. Dois dias de folga por pessoa já
  embutidos na meta.
- **O que aparece:** uma barra de grupo, um número que sobe, e nada mais.
- **Prêmio:** nenhum. Sem XP, sem selo, sem troféu. Quando fecha, a tela diz o que foi
  feito e oferece começar outra — e só.

**Por que este e não um desafio de treino:** o nome é a posição. "A Semana Inteira" só é
possível num app que vê a vida inteira — o GymRats pode copiar ranking de treino em uma
sprint, e não pode copiar um desafio que exige sono, comida e água na mesma conta, porque
ele não tem esses dados. É a única forma de o Social ser prova da caixinha em vez de
diluição dela (POSICIONAMENTO, micro-incoerência 4: *"isso serve o cliente-alavanca ou
dilui a caixinha?"*).

E note o que ele deliberadamente **não** mede: nada de dinheiro — nem "semana sem delivery",
nem "semana dentro do teto". Dinheiro é o dado mais íntimo do app e a assimetria mais cruel
que um grupo poderia expor. Fora, por decisão do fundador e por desenho.
