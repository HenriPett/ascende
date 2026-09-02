# Ciência do comportamento no Ascende — diagnóstico, decisões e o que ficou de fora

> Rodada 1. Quatro especialistas recrutados no Maestri leram o produto inteiro
> contra o contrato (`PRINCIPIOS.md` e `POSICIONAMENTO.md`) e produziram 42
> achados. Este documento registra o que foi encontrado, o que foi feito, o que
> foi **vetado** e o que ficou pendente — com o motivo de cada corte.
>
> O documento existe porque a parte cara desta rodada não é o código: é o
> raciocínio. Achado sem procedência volta à pauta a cada seis meses.

## O esquadrão

| Codinome     | Especialidade                     | O que ele procura                                                     |
| ------------ | --------------------------------- | --------------------------------------------------------------------- |
| **Estopim**  | Design comportamental             | B=MAP (Fogg), EAST, arquitetura de escolha, lacuna intenção-ação      |
| **Cadência** | Motivação e formação de hábito    | Autodeterminação, Marlatt (recaída), Lally, Amabile (progresso)       |
| **Sussurro** | Linguagem que move                | Enquadramento, fluência, a frase que está custando uma ação           |
| **Fiel**     | Ética da persuasão — **o veto**   | Dark patterns, sludge, o teste de manipulação de Susser/Nissenbaum    |

O Fiel existe por uma razão específica: um time que domina ciência do
comportamento é, por definição, um time capaz de manipular. Toda proposta dos
outros três passou pelo teste dele antes de virar código.

**Placar do veto: 21 aprovados limpos · 10 aprovados com ressalva · 1 vetado.**

## A leitura geral, em uma frase

O Ascende resolveu **motivação** com rigor raro e boa parte da **habilidade**.
O que estava quebrado, de ponta a ponta, era o **gatilho** — e, mais grave que
qualquer alavanca faltando, um conjunto de **promessas públicas que o código não
cumpria**. Dívida, não oportunidade.

> "É raro auditar um produto de comportamento e não achar escassez falsa, botão
> de recusa escondido ou cancelamento labiríntico — não há nenhum aqui. Os
> achados são de outra natureza: são promessas públicas que o código não cumpre.
> Isso é mais perigoso que um dark pattern, porque `/recusas` existe justamente
> para o usuário cobrar." — Fiel

---

## O que foi corrigido nesta branch

### 1. A sequência da Batalha zerava por ausência (P0 — três leituras independentes)

`computeBattleStats` quebrava a sequência em **qualquer** dia sem check-in:
`undefined` (não registrei) e `"relapsed"` (recaí) caíam no mesmo `else break`.
Quem ficou 40 dias limpo e passou cinco dias sem abrir o app voltava e lia `0`,
com a barra do próximo marco de volta ao começo.

`/recusas` e a landing prometem, em público: _"Nunca usaremos sequência que pune
sua semana ruim. A sequência tem dia de descanso embutido."_ A promessa
descrevia a sequência de dias ativos da tela Hoje — que tolera um descanso por
semana — e era assinada como se valesse também para a Batalha, que não tolerava
nada. `POSICIONAMENTO.md §G.3` põe streak punitivo na lista NUNCA.

O agravante é o assunto: batalha é pornografia, cigarro, álcool, aposta. Ver "0
dias" por esquecimento, num pilar onde a recaída é o evento normal, é o gatilho
clássico do "que-se-dane" de Marlatt.

**A correção não foi perdoar mais, foi perguntar outra coisa.**
`daysSinceRelapse` conta dias desde a última **recaída** — nenhuma ausência a
derruba, porque ela não depende de registro. É a conta que o AA faz há noventa
anos, e é ela que passa a mandar na barra de marco.

E a honestidade não foi sacrificada junto: `checkinGapDays` sai com ela, e a
tela diz "N dias sem check-in" quando é o caso. Contar dia não-registrado como
limpo seria autoengano — e em apostas ou álcool o autoengano é dano real, não
gentileza. Acolhimento sem conivência.

`src/lib/battles.test.ts` nasceu para travar esta regra.

### 2. O XP das Batalhas era prometido em quatro lugares e pago em nenhum (P0)

O app dizia, na cara da pessoa: `+10 XP`, `+12 XP`, `+5 XP`, e _"vale +12 XP,
mais que um dia comum"_. E o caminho de gravação era, inteiro, um `upsert` em
`battle_checkins` — tabela sem gatilho nenhum, num projeto onde `xp_log` não tem
policy de INSERT de propósito. **Check-in de batalha valia zero.** Quem resistiu
à vontade às duas da manhã porque o app disse que valia 12 recebia um toast que
mentia.

Isso não é melhoria de produto, é dívida: competência (Deci & Ryan) depende de
feedback contingente e **confiável**; feedback prometido e não entregue ensina
que o sistema não sabe o que você fez.

**A ressalva do veto mudou o desenho.** Um pagamento de 5 que só existisse no
`relapsed` seria, na contabilidade, pagamento _por_ recaída com um nome gentil
em cima. O valor foi decomposto, com a mesma matemática:

| Status     | Honestidade | Desfecho | Total |
| ---------- | ----------- | -------- | ----- |
| `relapsed` | +5          | —        | 5     |
| `clean`    | +5          | +5       | 10    |
| `resisted` | +5          | +7       | 12    |

Os 5 são literalmente o pagamento do **ato de registrar**, uniformes para todo
mundo. A hierarquia 5 < 10 < 12 garante que nenhuma estratégia de máximo de XP
passe por recair.

Correção de check-in **nunca subtrai** — baixar pontos quebraria a precondição
de monotonicidade que o Mokari documenta (`mokari.ts:241`) e puniria quem
corrigiu a verdade.

### 3. As demais

| Achado | O que estava errado |
| ------ | ------------------- |
| **`blueprint_generated_at` ≠ ativado** | O carimbo diz que a IA rodou, não que a pessoa quis. Quem usou a saída "Agora não — quero explorar primeiro" ficava sem plano, sem meta, sem compromisso **e** sem a trilha de Primeiros Passos: a pessoa mais cautelosa do funil recebia o app mais vazio, com o paywall como única zona. |
| **A bússola atrás do paywall** | `profile.goal` — a frase que a pessoa escreveu sobre a própria vida — só aparecia dentro do `BriefingLocked`. Informação **dela**, usada como isca. Agora abre a Jornada, de graça. |
| **A linha de foco não sabia o dia** | Quem registrava o gasto às 9h relia "Conte um gasto de hoje" às 20h. Um gatilho que erra o estado ensina a pessoa a não ler aquela linha. |
| **A janela de 3 a 6 dias** | O ritual de retorno só liga no sétimo dia; antes disso a pessoa voltava para o painel normal, com o selo de sequência sumido sem explicação e as barras em zero. |
| **A meta de proteína órfã** | Lida na tela Hoje, escrita só por caminhos automáticos. Meta inalcançável e imutável ensina a ignorar o painel. |
| **1 toque só na tela Hoje** | REGISTRAR está em toda tela, mas a folha só oferecia o caminho de IA: quatro interações e uma espera de rede por um copo de água. |
| **O dia da recaída** | Os três estados caíam na mesma caixa verde de sucesso. A recaída era desenhada como um dia bem-sucedido, com uma nuvem por cima. |
| **Apagar memória** | `window.confirm` com "Apagar TUDO" em maiúsculas. A tela que exerce a promessa "seus dados continuam seus" era a que mais parecia advertência. |
| **"Cancele antes"** | Mandava cancelar a assinatura à mão; `delete-account` já cancela sozinho. Sludge no caminho da **saída**. |
| **`semOrigemTexto`** | Explicava toda memória como "anterior ao momento em que passei a guardar origem" — falso para uma criada há segundos. |
| **Copy** | Paywall reenquadrado (a cota sai de sujeito e vira prova), preço completo dentro do botão que abre o Stripe, quatro erros que chamavam o número da pessoa de "inválido", estados vazios de Planos e Batalhas, selo da landing. |

---

## O único veto

**Esconder o comparativo de 30 dias das recaídas quando ele fosse desfavorável.**

A proposta era trocar o contador vitalício por uma janela ("2 nos últimos 30
dias, eram 5 nos 30 anteriores") e omitir a comparação quando a pessoa tivesse
piorado. A intenção era protegê-la.

> "Isto é editar o espelho. Se ela souber a regra, a **ausência** do comparativo
> passa a ser a má notícia — e ela aprende que nenhum número daquela tela é
> confiável, porque qualquer um pode estar sendo omitido a favor dela. Só
> funciona enquanto ela não perceber." — Fiel

Três agravantes fecharam o caso: o assunto é aposta, álcool, pornografia, e a
**piora é o sinal clínico** — as `SAFETY_RULES` mandam o Conselheiro nomear
padrão severo e apontar CAPS/AA/NA/JA, ou seja, a IA tem ordem de dizer o que a
tela teria ordem de esconder; "o histórico continua disponível em outro lugar"
não é proteção, é um caminho mais longo até a mesma notícia; e "o app não precisa
editorializar contra a pessoa" está certo — a conclusão correta é **não
editorializar**, não editorializar a favor.

O que passou no lugar: mostrar as duas janelas, simétricas, sem adjetivo, sem
seta e sem cor. _(Ainda não implementado — ver pendências.)_

Aprovado limpo e **já feito** na mesma família: mostrar `resisted`, que era
calculado e jogado fora enquanto o contador de recaídas era público. O produto
contava as derrotas em praça e escondia a vitória mais difícil do pilar.

---

## Três correções que o veto fez em código já escrito nesta branch

Registradas porque são o argumento a favor de existir um revisor adversarial:

1. **A dica de importação prometia privacidade que não existe em um dos
   caminhos.** O texto dizia "sono, treino, peso **ou o extrato do banco** (...)
   sem passar por IA e sem subir para servidor nenhum". Verdade para CSV e Apple
   Health (parsing local); **falso** para a fatura, que `import-statement` manda
   em base64 para a API da Anthropic. Frase tranquilizadora e falsa, dita
   exatamente a quem tem medo de privacidade — quem mais confia nela e menos tem
   como conferir. A garantia foi escopada aos caminhos em que é verdadeira.
2. **O paywall dizia "15 conversas por dia".** A cota conta **mensagens**, e uma
   conversa tem várias. Inflar a unidade no momento da venda é desmentido no
   primeiro dia de uso. O número tem de sair do lugar de sujeito; a **unidade**
   dele é intocável.
3. **O estado vazio de Planos afirmava conhecimento que o Conselheiro pode não
   ter** ("já sabe quanto você ganha e como anda seu corpo") — falso para quem
   pulou esses blocos do onboarding. Passou para o modo condicional.

---

## Pendências, com o motivo de não terem entrado agora

Ordenadas pelo que o Fiel defende como ordem de conserto.

### Dívidas de promessa pública (as mais caras)

- **Memórias de quem cancela são apagadas, e a página promete o contrário.**
  `/recusas` e a Assinatura dizem que o excedente "fica arquivado (somente
  leitura) e volta ao reativar"; o código faz `.delete()`. Não existe mecanismo
  de arquivamento em lugar nenhum do repositório. `PRINCIPIOS.md` descreve manter
  esses dados como _costly signaling_ — a fatura é o argumento, e ela não está
  sendo paga. **Não entrou porque muda o modelo de dados das memórias** e merece
  decisão de fundador sobre arquivar vs. nunca apagar por teto.
- **"Sair sem criar nada" é falso.** A tela de consentimento LGPD só renderiza
  porque o usuário já existe: o OAuth inseriu a linha e o trigger criou o
  `profiles` com o nome vindo do Google. `declineAndExit` faz apenas `signOut`.
  É a única frase falsa dita no momento mais sensível que existe. **Não entrou
  porque o conserto certo é chamar `delete-account` no declínio**, e isso precisa
  de teste de ponta a ponta no fluxo OAuth, que não dá para validar aqui.

### Comportamento

- **Âncora de captura** ("quando você vai me contar o dia?") — o achado de maior
  alcance, e o único que traz implementation intentions ao produto. Aprovado com
  três ressalvas: **sem chip pré-selecionado** (default escolhido por nós num
  compromisso dela contamina a autoria que legitima o mecanismo), editável e
  **removível** em Ajustes, e a linha do cabeçalho **nunca** pode acumular nem
  citar dias anteriores — com teste travando isso.
- **Blueprint resgatável.** Quem abandona o onboarding no meio perde para sempre
  um plano que a função ainda consegue gerar (ela lê o perfil pelo servidor, não
  depende do formulário). Custo pago, valor nunca entregue.
- **WhatsApp fora do rodízio de zonas.** É o único canal de retorno que o produto
  tem e é a 9ª de 10 prioridades num teto de 5 — oferecido primeiro a quem tem
  menos coisa ativada e escondido de quem tem mais, o inverso do que a mecânica
  pede. Ao pedir o número, dizer também **o que sai** por lá e que "parar"
  silencia tudo.
- **Curva de XP e saturação do Mokari.** Do nível 22 ao 25 são ~9 meses; o Mokari
  congela em 3.000 XP / 180 dias, ou seja, a melhor peça de progresso do produto
  para de mudar justo quando o hábito se consolida. Se a curva for achatada,
  **dizer uma vez** que os níveis mudaram — número conquistado que muda sozinho
  parece bug.
- **Meta calórica tratada como alvo a preencher.** Para quem quer emagrecer, o
  app literalmente pede que coma mais ("Faltam 420 kcal para a meta") e comemora
  qualquer excesso, enquanto o bônus de XP do dia seguinte exige a janela de
  70–110% — dois feedbacks contraditórios sobre o mesmo dia. Direção **nunca**
  inferida em silêncio, linguagem de teto sem vermelho e sem "você passou", e
  **nenhuma celebração por comer abaixo da meta**.
- **Uma função de sequência só.** O dia de descanso é promessa pública e está
  implementado em 1 de 3 lugares. Quando unificar, o descanso usado tem de ser
  **visível** — descanso concedido às escondidas parece bug.
- **Contador de uso invisível.** O servidor calcula quanto de cada cota já foi
  gasto, manda para a tela, e a tela ignora: a pessoa só vê o próprio consumo
  dentro do paywall, ao lado do botão de assinar.
- **Rejeitar uma memória não impede a IA de reaprender a mesma coisa.** A leitura
  está blindada, a **escrita** não olha as rejeitadas — então a rejeição vira
  temporária sem ninguém dizer isso.
- **Bloco "Sua subida até aqui".** Todo progresso visível é de janela curta (7 e
  14 dias); os números absolutos já são calculados pelo Mokari e jogados fora. E
  "3/7 dias ativos" tem um denominador que implica perfeição, contradizendo a
  doutrina do dia de descanso.

### Travas para o futuro

- **A cópia das notificações vive fora do repositório.** Os nomes de template são
  lidos de `app_settings` e trocáveis sem deploy nem code review; o texto real
  mora no Gerenciador da Meta. A NUNCA nº 4 (notificação de culpa) é a única da
  lista cuja obediência **nenhuma linha de código pode verificar**. Basta um dia
  ruim de retenção. O texto aprovado de cada template precisa ser versionado
  aqui, e o teste "isso é serviço ou é culpa?" virar passo obrigatório.
- **O consentimento é versionado e nunca revisitado.** `LEGAL_VERSION` é gravada
  no aceite "para auditoria" e nunca comparada com nada.
- **A Política declara menos privacidade do que o código entrega.** O recorte do
  Clarity (gravação só nas páginas públicas, `stop` ao entrar em `/app`) é a
  melhor decisão de privacidade do repositório e está subdeclarada. Um "não" caro
  que merece virar fatura visível.

---

## O que foi auditado e está cumprido

Registrado para o veto ter peso — e para estas decisões não voltarem à pauta:

- Paywall sem escassez artificial, sem contagem regressiva, sem confirmshaming;
  "Agora não" é botão de verdade ao lado do CTA. Linka `/recusas` de dentro do
  momento de venda.
- Preço honesto: R$ 29,90 × 12 = R$ 358,80; anual R$ 239,90; economia declarada
  de R$ 118,90. A conta fecha, sem âncora inflada.
- Nada de vender o que não existe — o cartão "No radar (sem data, sem promessa)"
  é o oposto do padrão do mercado.
- Falha de leitura nunca rebaixa o plano: na dúvida, `planUnknown`.
- Conselheiro dentro do escopo em três camadas, com `SAFETY_RULES` presente em
  **todas** as funções de IA.
- Fotos realmente descartadas: nenhum `storage.upload` no repositório.
- Exclusão de conta acessível, gratuita, com exportação oferecida antes e
  cancelamento automático da cobrança no servidor.
- Limites do plano gratuito publicados **antes** do cadastro.
- XP não premia tempo de tela nem abrir o app; nenhum contador de sessão.
- `mokariLayers.ts` — a folha que nunca aponta para baixo, com a regra travada na
  **geometria** e não no cuidado do próximo dev.
- O ritual de retorno de 7+ dias, que deixa a pessoa recusar o próprio ritual.
- A recusa em criar "batalha contra comida", que protege o usuário do próprio
  pedido dele.

---

## A régua, para a próxima rodada

Toda proposta de comportamento passa por três perguntas antes de virar código:

1. Se a pessoa visse exatamente por que fizemos isso, ela agradeceria ou se
   sentiria usada?
2. Isso serve o objetivo **dela** ou a métrica **nossa**? E se serve a nossa: ela
   sabe disso?
3. Isso funciona mesmo com ela consciente de que está sendo usado — ou depende de
   ela não perceber? **Se depende, é manipulação.**

E a régua que gera todas as respostas continua sendo a de `PRINCIPIOS.md`: _o
Ascende ganha dinheiro quando a vida do usuário melhora, nunca quando ele fica
mais tempo no app._ Sete das dez propostas de gatilho desta rodada **reduzem**
tempo de tela. A que mais importa está escrita na tela:

> "Dia registrado. Pode fechar o app — a subida é lá fora."
