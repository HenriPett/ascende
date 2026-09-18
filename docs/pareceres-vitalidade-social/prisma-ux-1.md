# Parecer de UX — Saúde (fusão) e Social (novo)

> Parecer de designer. Nada foi implementado; nenhum arquivo do projeto foi editado.
> Base lida: `AppLayout.tsx`, `Pilares.tsx`, `Jornada.tsx`, `Vitalidade.tsx`, `Alimentacao.tsx`,
> `Hoje.tsx`, `lib/routes.ts`, `lib/pillars.ts`, `lib/trackers.ts`, `PRINCIPIOS.md`, `POSICIONAMENTO.md`.

---

## Correção de premissa (antes do parecer)

As duas telas somam ~1.780 linhas, **mas só ~820 são JSX de tela**:

- `Vitalidade.tsx` — JSX de 358 a 672 → ~310 linhas
- `Alimentacao.tsx` — JSX de 424 a 928 → ~505 linhas
- o resto é hooks, handlers, helpers e os dois diálogos (`CalorieEditDialog`, `WaterSettingsDialog`)

Em **blocos visíveis** são **16 cartões** (8 + 8). O alvo de uma fusão honesta é **9**.
Isso é factível — o inaceitável é a soma, não a fusão.

---

## 1) SAÚDE — arquitetura de informação

**Recomendo abas. Três. E a primeira dobra FORA das abas.**

Não é escolha de gosto: `Alimentacao.tsx:452` já validou 3 abas nesta mesma matéria
(Hoje · Corpo · Histórico) e ninguém reclamou. Seções ancoradas são a opção que *parece*
mais simples e é a pior aqui — mantêm o scroll de 1.800 linhas e transferem para a pessoa
o trabalho de ignorar 80% da tela. Âncora resolve navegação; não resolve peso.

### A dobra (fora das abas, sempre visível)

`h1 "Saúde"`, uma linha de subtítulo, e **um cartão só: registrar**, com 4 chips de
1 toque — Refeição/foto · Água · Treino · Sono.

**O que NÃO entra na dobra: barra de progresso nenhuma.**
Esse é o erro que eu mais temo nesta fusão. `Hoje.tsx:585-706` já é o painel do dia:
kcal, proteína, água, treinos na semana, sono, teto de gasto, com celebração e tudo.
Se a Saúde abrir com "seu dia em números", o app passa a ter **dois painéis do mesmo dia**
— e aí a fusão terá dobrado a percepção de complexidade enquanto reduzia um pilar.

> **Hoje é o dono do dia. Saúde é a mesa de trabalho.**

### Esboço da tela (390px)

```
┌──────────────────────────────────────────┐
│  Saúde                                   │  ← h1, cor única do pilar
│  Corpo, comida, sono e treino num lugar. │
├──────────────────────────────────────────┤
│  REGISTRAR AGORA                         │  ← a dobra inteira: 1 cartão
│  [📷 Refeição] [💧 Água]                  │     4 chips de 1 toque
│  [🏋 Treino]   [🌙 Sono]                  │
├──────────────────────────────────────────┤
│ ┌─ Meu dia ─┬─ Meu corpo ─┬─ Histórico ─┐│  ← 3 abas, "Meu dia" default
│ │                                        ││
│ │  (o conteúdo da aba)                   ││
│ └────────────────────────────────────────┘│
└──────────────────────────────────────────┘
       ▲ sem barra de progresso aqui:
         o painel do dia é da tela Hoje
```

```
Aba "Meu dia"            Aba "Meu corpo"           Aba "Histórico"
─────────────────        ─────────────────         ─────────────────
Raio-X de Saúde*         Peso + meta + gráfico     ter 16/09
Comida (foto→kcal)       Composição corporal        · 🏋 pernas
Água (garrafas)          Corpo treinado (1 graf.)   · 🍽 2 refeições
Treino (chips músculo)   Condições de saúde         · 💧 2,1 L
Sono / soneca            Medicamentos               · 🌙 6,5 h
· Minhas metas →                                   seg 15/09 …
  (folha com as 6)                                 [heatmap 28 dias]

* só até ser respondido
```

### As abas

| Aba | Conteúdo | Por quê |
|---|---|---|
| **Meu dia** (padrão) | os registros que a captura dourada **não** alcança: foto→calorias, garrafas de água, chips de grupo muscular, horas de sono/soneca | é o que 90% das visitas vem fazer |
| **Meu corpo** | peso + gráfico + meta, composição, mapa de corpo treinado, condições de saúde e medicamentos | dado do corpo, não do dia — e a fusão finalmente conserta a anomalia de "Corpo" morar na Alimentação (`Alimentacao.tsx:708`) |
| **Histórico** | **uma linha por dia** com o que houve (refeição, treino, sono, água) + o heatmap | hoje são três históricos de janelas diferentes: 14 dias de refeições, 28 dias de hábitos, série de peso |

### O que é CORTADO (a parte que faz a fusão valer)

1. **Um cartão-assinatura, não dois.** O gold "Plano que cabe no seu bolso"
   (`Alimentacao.tsx:435`) e o "Raio-X de Vitalidade" (`Vitalidade.tsx:100`) são a mesma
   peça de onboarding em posições idênticas. Vira um: **Raio-X de Saúde** (treinos/semana,
   sono, e já pega comida).
2. **Radar + barras dos mesmos 7 números** (`Vitalidade.tsx:478-510`). Dois gráficos da
   mesma tabela. Fica a barra ordenada; o radar de 7 categorias é decoração.
3. **Seis GoalInputs espalhados** (kcal, proteína, água, sono, treinos/semana, peso) →
   **uma folha "Minhas metas"**, aberta por um link. Hoje a pessoa caça meta em 6 cartões
   de 2 telas.
4. **O cartão "Registro rápido em texto"** (`Alimentacao.tsx:649-657`) — é literalmente a
   CaptureBar com menos poder. O REGISTRAR faz isso em toda tela.
5. **Hábitos diários sai da Saúde** (`Vitalidade.tsx:530-573`). Não é vitalidade: o próprio
   `<Select>` oferece os 4 pilares. É transversal, e já tem dono — "Compromissos de hoje"
   na Hoje (`Hoje.tsx:952`) e a contagem no hub Jornada. São ~60 linhas e mata uma
   esquisitice conceitual.
6. **Três históricos → um.**

**16 blocos → 9, e nenhum deles perdeu função.**

---

## 2) O CUSTO DE ENTRADA (as rotas congeladas)

Alias, não redirect: as duas rotas continuam **renderizando** a Saúde — é o que `routes.ts`
já exige e o que o teste protege.

Mas atenção a um detalhe que muda a resposta: o único produtor externo de `/app/vitalidade`
é o **desvio de composição corporal** (`whatsapp-webhook/index.ts:602`), registrado em
`EXTERNALLY_LINKED`. Quem clicou lá quer **peso/composição — que está na aba 2**, não na 1.

Recomendação, em três partes:

- **Aba pré-selecionada + âncora de seção, por query:** `?s=treino|comida|corpo`.
  As mensagens **novas** do WhatsApp passam a mandar `/app/vitalidade?s=corpo` e
  `/app/alimentacao?s=comida` — e ficam registradas no inventário de `EXTERNALLY_LINKED`.
- **Sem query** (as mensagens já enviadas, o PWA instalado, o bookmark):
  `/app/vitalidade` abre "Meu dia" ancorado em treino/sono; `/app/alimentacao` abre
  "Meu dia" ancorado em comida. Ninguém aterrissa em lugar vazio, porque os dois
  registros vivem na mesma aba.
- **Uma linha de reorientação, uma vez** (padrão do `FirstTimeTip`, que já existe):
  *"Treino, sono e comida agora vivem juntos, em Saúde."* Na entrada por vitalidade,
  mais um link discreto: *"Procurando composição corporal? Está em Meu corpo →"*.
  Não adivinhamos o que a mensagem antiga prometia — oferecemos o caminho.

---

## 3) SOCIAL SEM INCHAÇO — onde ele mora

| Opção | Trade-off |
|---|---|
| **A. 6º alvo na barra** | Descoberta máxima, custo máximo. Em 390px a pílula de 5 já está no limite, e um 6º alvo obriga a diminuir o REGISTRAR ou a matar "Conta". Rouba o único protagonista dourado do app. **Descartada.** |
| **B. 5º pilar em `Pilares.tsx`** | Barato, mas conceitualmente errado: pilar = área da vida (dinheiro, corpo, comida, mente). "Amigos" não é área da vida — é jeito de percorrer as outras. E reabre a contagem de pilares que a fusão acabou de reduzir. |
| **C. Ferramenta transversal: rota `/app/social` + seção no hub Jornada + cartão em "Ferramentas"** | Zero mudança na barra. Reaproveita dois padrões existentes: o bloco "Ferramentas" de `Pilares.tsx:160` (onde Batalhas e Planos já moram) e o `HubSection` da Jornada, que mostra estado em uma linha. Descoberta média — e média é o certo aqui. |

**Recomendo C**, e a defesa é o precedente: **Batalhas** é o assunto mais íntimo do app e mora
exatamente aí, com "tom baixo e condicional, de propósito" escrito no código. Social é da mesma
família — opcional, não-diário, transversal aos pilares. A linha no hub diz o estado sem cobrar
nada: *"2 grupos · desafio da água termina sábado"*. E **sem badge, sem bolinha de notificação**
— o `HubSection` só usa `dots` para cor de pilar, e é para continuar assim: bolinha vermelha é o
motor de "abre o app", que é justamente o que o Dilema 4 proíbe.

Uma ressalva de escopo que eu devo à régua: Social é textualmente o caso da micro-incoerência 4
("novos pilares/features 'para todo mundo': dopamina de roadmap ≠ progresso"). Ele **passa** no
teste se for *dupla/trio que se acompanha no mesmo aperto* — e aí serve a Candidata A. Ele
**reprova** se nascer feed público de desconhecidos. E o ângulo que o GymRats não consegue copiar
não é o ranking de treino: é o **desafio cruzado** (água + sono + treino + comida na mesma
semana). Se o Social nascer só de treino, nascemos como GymRats pior; se nascer cruzado,
nascemos como a única coisa que o "inteiro" permite.

---

## 4) O RISCO QUE NINGUÉM VAI FALAR

Você está certo de citar o Dilema 4. Um feed é, por construção, a máquina que o PRINCIPIOS
proíbe. Dá para fazer, mas só com regras escritas antes — como aquele arquivo manda.
Concretamente:

**O feed mostra:** eventos de **conclusão declarados pela própria pessoa**, sem grandeza
comparável. "Ana registrou um treino." "Pedro fechou a água de hoje." "Júlia dormiu dentro
da janela dela."

**O feed NUNCA mostra** (regra estrutural, não configuração):

- **Dinheiro, peso, calorias, proteína, humor, diário, gratidão, batalhas, condições de saúde,
  medicamentos.** Metade disso é o núcleo íntimo que o POSICIONAMENTO C4 blinda ("dinheiro,
  corpo, fé e emoções não coexistem com o RH olhando") — vale para o RH e vale para o grupo do
  CrossFit. Peso e caloria ficam fora porque são o combustível de comparação corporal, e a
  Saúde é justo onde isso dói.
- **Ausência.** Nenhuma linha "Pedro não registrou hoje", nem implícita. Sem "visto por
  último", sem contador de visualizações, sem "online".
- **Contador de apoio para terceiros.** Um gesto só ("Força"), e o número só o autor vê.
  Contador público de curtida é leaderboard de popularidade disfarçado.
- Compartilhamento é **opt-in por tracker e por grupo** — reaproveitando `tracking_prefs`,
  que já é a fonte de verdade do que a pessoa aceita acompanhar.

**Como o ranking não humilha:**

- **O placar é do grupo contra a meta do grupo**, não de pessoa contra pessoa:
  *"o grupo fez 11 dos 15 treinos da semana"*. Quem está atrás aparece **dentro**, não embaixo.
- Se houver classificação individual, ela é **constância relativa ao compromisso da própria
  pessoa** — cumpriu 3 dos 3 que ela prometeu = 100%, e fica à frente de quem prometeu 6 e fez
  5. Isso troca o que o placar premia: honestidade de meta em vez de capacidade física (ou
  financeira). É a única versão que não pune quem tem menos tempo e menos dinheiro — a nossa
  cliente.
- **Nunca a tabela inteira.** Top 3 + "você, comparada com você na semana passada". O último
  lugar não existe como posição pública.
- **Desafio não zera por um dia.** Dia de descanso preserva a sequência — é a regra que o app
  já cumpre em Batalhas ("dias limpos nunca zeram") e que a lista NUNCA nº 3 torna obrigatória.
- **XP zero para tudo que é social.** Entrar em grupo, postar, apoiar, subir no ranking: nada
  de XP. XP continua premiando ação na vida real, senão a micro-incoerência 1 vira incoerência
  na hora.
- **Notificação: só serviço.** Convite recebido; desafio que **você** escolheu terminou.
  Proibido "Ana treinou hoje, e você?" — esse é o push de culpa, nominalmente. E convite não
  se repete (padrão do `MokariInvite`: "pedir duas vezes é cobrar").

O **Mokari** é o precedente que eu usaria para desenhar o tom inteiro: *espelho não conversa,
não cobra, não notifica.* Um Social que obedece ao Mokari é defensável. Um que obedece ao
GymRats não é.

---

## 5) A MATEMÁTICA DA COMPLEXIDADE

**4 − 1 + 1 = 4 em número. Em percepção, hoje, do jeito que está pedido: fica MAIS complexo.**

Por quê: a fusão é uma redução real (um pilar a menos, uma cor a menos, e ela conserta a
anomalia de "Corpo" morar na Alimentação). Mas ela é um ganho **de mapa** — coisa que a pessoa
sente uma vez, ao reaprender onde ficam as coisas. O Social é um acréscimo **de superfície
viva**: gente, convite, desafio, placar, estado que muda sem você fazer nada. Um kg de mapa não
compensa um kg de superfície viva. E as duas mudanças juntas pedem que a pessoa reaprenda o app
e ganhe um bairro novo na mesma semana.

**Fica mais simples se — e só se — estas cinco coisas forem verdade:**

1. **A fusão apagar superfície, não realocar.** Os 6 cortes da seção 1 entram. Se a Saúde
   nascer com 16 cartões em 3 abas, a fusão piorou o app e a culpa não será do Social.
2. **Nenhuma barra de progresso nova.** Hoje continua o único painel do dia.
3. **O Social nascer desligado e silencioso.** Sem pilar, sem barra, sem badge, sem push, sem
   XP. Quem nunca abrir não deve sentir que existe — o app dela tem que continuar do mesmo
   tamanho.
4. **A barra continuar com 5 alvos e um só dourado.** Esse é o ativo de simplicidade do app;
   qualquer versão que o negocie está resolvendo o problema errado.
5. **Sair em duas entregas, não uma.** Saúde primeiro, sozinha, e a pessoa sente a tela ficar
   mais leve. Social depois. Juntas, o ganho da fusão é engolido pela novidade.

Se as cinco valerem, minha aposta é: **percepção de "app menor" na Saúde, e "app com um bairro
opcional" no Social — líquido positivo.** Se a nº 1 ou a nº 3 caírem, o saldo fica negativo e o
número 4 vai mentir para vocês.
