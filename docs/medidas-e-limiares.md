---

## MEDIDAS E LIMIARES (Fase 6)

Sete medidas, cada uma com (a) definição operacional e (b) o número que faria
mudar de ideia. Os limiares são chute — chute escrito é revisável, chute na
cabeça de alguém não é. Cada um traz o raciocínio para poder ser contestado
pelo raciocínio, não pela lembrança de quem falou mais alto.

Nada aqui exige instrumentação nova. Seis medidas saem de dados que a própria
pessoa gerou; só a nº 4 pergunta, e quem responde é quem quiser. A fronteira
da Fase 0 fica de pé.

### Quórum: antes de qualquer limiar significar algo

O produto não tem clientes e não foi divulgado. Limiar lido sobre 4 pessoas
não é medida, é anedota com casas decimais — um único caso extremo move a
mediana inteira.

- **Quórum mínimo de leitura: 20 pessoas** com ao menos 7 dias entre o
  cadastro e a data da leitura. Cada medida tem o seu próprio denominador
  (quem importou, quem foi perguntado), e o quórum vale por denominador, não
  só no total.
- **Primeira leitura:** 30 dias após a 20ª pessoa cadastrada. Releitura a
  cada 30 dias.
- **Abaixo do quórum:** os números podem ser olhados, mas *nenhuma* das duas
  decisões da fase (integrações nativas, monetização ampliada) pode ser
  tomada com eles. Registrar "insuficiente" é uma resposta legítima e é a
  resposta certa hoje.
- Todo limiar abaixo é **mediana por pessoa**, nunca média sobre eventos.
  Média sobre eventos deixa um usuário intenso responder pelos outros
  dezenove.

### 1. Tempo até o primeiro valor

**(a) Definição.** "Primeiro valor" não é cadastrar, não é ver tela, não é
receber boas-vindas: é **o primeiro registro que a pessoa colocou na própria
história**.

```
T1 = min(life_events.created_at) − auth.users.created_at
     onde life_events.source in ('form','chat_capture')
```

Três exclusões que decidem o número:
- `source = 'system'` fora: evento que o sistema gerou não é valor que a
  pessoa produziu.
- `created_at`, nunca `occurred_at`: importação preenche o passado, e usar
  `occurred_at` daria "primeiro valor" com data anterior ao cadastro.
- Evento vindo de importação (`data_source_id is not null`) conta como
  primeiro valor **apenas se a fonte foi confirmada** — confirmar uma
  importação é ato da pessoa; abandonar na prévia não é.

Medida reportada: **mediana de T1 em minutos**, mais o **% que não chega ao
primeiro evento em 24h** (quem nunca chega não tem T1 e desapareceria da
mediana justamente por ser o pior caso).

**(b) Limiar.** *Se a mediana de T1 passar de 10 minutos, o onboarding é o
problema mais caro que temos, na frente de qualquer integração nativa.*

Por que 10 minutos: a pessoa chega com intenção, e a primeira sessão é o
único momento em que a curiosidade paga o custo de digitar. Dez minutos é da
ordem de uma primeira sessão antes de a atenção quebrar. Acima disso, a
maioria sai antes de registrar qualquer coisa — e o Apple Health, nesse
cenário, **piora a leitura em vez de resolver**: ele importaria dados de
gente que nunca chegou ao primeiro evento, o número de "dados na conta" subiria
e o abandono continuaria igual, agora escondido.

Segundo corte, mesmo veredito e mais duro: **se mais de 40% não chegam ao
primeiro evento em 24h**, o problema não é velocidade, é a primeira tela não
dizer o que fazer.

### 2. % de importações com recibo

**(a) Definição.** O denominador é a parte que gera briga, então fica escrito:

```
denominador = data_sources com status in ('confirmed','partial')
numerador   = dessas, as que têm ≥1 linha em import_receipts
```

- `previewed` **fora** do denominador: prévia abandonada não é importação, é
  desistência — e vira o corte secundário abaixo.
- `failed` fora: falha não promete recibo.
- `deleted` fora: a pessoa apagou a trilha, e respeitar isso é o ponto.
- `partial` **dentro**: importação parcial é exatamente o caso em que o recibo
  mais importa, porque é ele que diz o que ficou de fora.

Esta medida não é comportamento de usuário. É **auditoria da nossa própria
promessa** — a Fase 1 disse "você vê o que entrou e o que não entrou".

**(b) Limiar.** *Se ficar abaixo de 100% — uma única fonte confirmada sem
recibo —, isso é defeito de correção e barra as DUAS decisões até ser
corrigido, na frente de qualquer roadmap.*

Por que 100% e não 95%: as outras medidas são sobre gosto e comportamento,
onde faixa faz sentido. Esta é sobre uma promessa binária ter sido cumprida ou
não. E o encadeamento é o que a torna bloqueante: integração nativa
**multiplica o volume de importações**, então subir Apple Health com recibo
vazando é multiplicar uma promessa quebrada; e monetização ampliada sobre
importação não auditável é vender confiança que não temos.

Corte secundário, mais informativo que o principal:
**taxa de abandono na prévia** = `previewed` sem confirmação ÷ total de
fontes criadas. *Se passar de 30%, o fluxo de importação é o problema mais
caro, na frente da integração nativa* — porque o passo prévia→confirmar é
onde a pessoa desiste, e o Apple Health tem o mesmo passo de confirmação. Uma
fonte nova de dados não conserta um passo em que as pessoas travam.

### 3. Memórias corrigidas

**(a) Definição.** "Corrigida" = memória escrita pela IA que a pessoa
**julgou**:

```
julgadas   = ai_memories com created_by = 'ia' e status in ('confirmada','rejeitada')
rejeitadas = dessas, status = 'rejeitada'
taxa de rejeição = rejeitadas ÷ julgadas
taxa de correção = julgadas ÷ (todas com created_by = 'ia')
```

- `expirada` **fora**: pode ter chegado lá sozinha por `valid_until`, sem
  ninguém julgar nada. Contá-la como correção infla a medida com o relógio.
- Editar o texto de uma memória da IA não muda `created_by` (é assim de
  propósito, e está certo) — então **edição não é detectável hoje** e não
  entra na conta. Fica escrito para ninguém "descobrir" isso em seis meses e
  achar que o número mentiu: esta medida mede confirmar/rejeitar, não editar.

Duas taxas porque elas respondem perguntas opostas.

**(b) Limiar.** *Se a taxa de rejeição passar de 20% das memórias julgadas, a
qualidade da memória é o problema mais caro que temos, na frente da
monetização ampliada e de qualquer integração.*

Por que 20%: uma em cinco errada é onde a pessoa para de confiar no retrato e
passa a tratar correção como tarefa doméstica. E a Fase 2 nasceu exatamente
disso — uma memória inventada (o café da manhã que nunca existiu, 30/08)
envenena todo turno seguinte do Conselheiro. Memória ruim não é um recurso com
defeito, é o produto mentindo com confiança.

**O limiar pelo outro lado, e ele é uma armadilha:** *se a taxa de correção
ficar abaixo de 5%, não leia como "a memória está ótima".* Leia como: a
superfície de controle está invisível ou ninguém se importa. Aí a interface da
Fase 2 é o problema, na frente da monetização — porque "você controla sua
memória" é argumento de venda, e não se cobra por um controle que ninguém
acha. Rejeição baixa **com** correção baixa não é aprovação, é ausência de
opinião.

### 4. Insights úteis

**(a) Definição.** A única medida que exige sinal novo, e é honesto que exija:
"útil" é juízo da pessoa e não há como inferir sem perguntar.

```
perguntados = insights com status = 'tendencia' que receberam a pergunta
respondidos = dos perguntados, os que a pessoa respondeu
úteis       = dos respondidos, os "sim"
taxa de utilidade = úteis ÷ respondidos
taxa de resposta  = respondidos ÷ perguntados
```

- Só `status = 'tendencia'` recebe a pergunta. Perguntar "isso te ajudou?"
  sobre um `dados_insuficientes` é perguntar se o silêncio ajudou.
- **A taxa de resposta não é métrica secundária, é a barra de erro da
  primeira.** 40% de utilidade sobre 5 respostas não é 40% de nada.
- Quem ignorou não é perguntado de novo (contrato da fase), então quem
  ignorou fica no denominador da taxa de resposta e fora da taxa de
  utilidade. Ignorar é dado, não ausência de dado.

**(b) Limiar.** *Se a taxa de utilidade ficar abaixo de 40% (com taxa de
resposta ≥ 25%), o motor de insights é o problema mais caro que temos, na
frente da monetização ampliada.*

Por que 40%: um insight é uma afirmação sobre a vida da própria pessoa, e a
barra não é "interessante", é "me disse algo que eu não sabia". Abaixo de 40%
os cards de tendência são horóscopo com SQL — e monetização ampliada quase
certamente precifica justamente essa camada. Cobrar por ruído é o jeito mais
rápido de queimar uma audiência que ainda não existe.

**O limiar que destrava:** *utilidade ≥ 40% e resposta ≥ 25% é o argumento
mais forte a favor da monetização ampliada* — é a única medida das sete em que
a pessoa diz, com as próprias palavras, que o produto entregou algo. Nenhuma
outra chega perto disso como justificativa para pedir dinheiro.

**E o limiar que destrava a OUTRA decisão** — a única condição em que o Apple
Health vai para a frente da fila: *se `dados_insuficientes` for a maioria
(> 50%) dos insights calculados, o gargalo é volume de dados, não o motor.*
Integração nativa é exatamente um conserto de volume de dados. É a ponte mais
limpa entre uma medida e a decisão D1, e é por isso que ela precisa ser lida
antes de qualquer discussão sobre Apple Health: sem esse número, "precisamos
de mais dados" é palpite.

### 5. Uso da captura vs navegação

**(a) Definição.**

```
por pessoa: share = eventos com source = 'chat_capture'
                  ÷ eventos com source in ('form','chat_capture')
reportado: mediana dos shares entre as pessoas
```

- `system` fora e evento de importação (`data_source_id is not null`) fora: um
  arquivo importado não é nem conversa nem formulário, e deixá-lo dentro faz
  uma importação grande afogar a medida.
- Mediana **por pessoa**, não share global. Share global responde "de onde
  vêm os eventos"; a pergunta da fase é "como as pessoas escolhem registrar",
  e essa é por cabeça.

**(b) Limiar.** *Se a mediana ficar abaixo de 25%, a captura por conversa não
é a espinha do produto que a tese diz que é, e melhorar formulário/navegação
passa na frente da integração nativa.*

Por que 25%: capturar conversando é o diferencial da tese. Se três quartos dos
registros continuam saindo de formulário, o diferencial não pegou — e
construir integrações para alimentar uma tese não validada é caro duas vezes:
o custo da integração e o custo de continuar acreditando.

**O limiar reverso, e ele é contraintuitivo:** *se a mediana passar de 60%, a
conversa É a interface — e aí o Apple Health vale MENOS, não mais.* Sincronia
passiva substituiria exatamente a interação que gera o texto do qual o
Conselheiro se alimenta. Importar sono automaticamente dá o número e tira a
frase; a memória fica mais completa e mais burra. Este é o único caso da lista
em que um número alto **barra** a integração em vez de destravá-la, e é a razão
de a medida existir.

### 6. Retorno após silêncio

**(a) Definição.** "Silêncio" precisa de número, senão a medida não existe.

```
dia ativo = dia (America/Sao_Paulo) com ≥1 life_events.created_at,
            source in ('form','chat_capture')
lacuna    = intervalo entre dois dias ativos consecutivos
silêncio  = lacuna ≥ 7 dias
retorno   = a pessoa registra de novo depois de um silêncio
taxa de retorno = silêncios encerrados ÷ silêncios iniciados,
                  contando só silêncios iniciados há ≥ 14 dias
```

- **7 dias**: a cadência do produto é quase diária. Uma semana é a menor
  lacuna que não se explica por fim de semana cheio ou viagem curta, e é
  também a janela em que os cards de tendência começam a perder pareamento.
- **A carência de 14 dias é o detalhe que evita a mentira mais fácil desta
  medida**: sem ela, uma lacuna aberta de 8 dias entra como "não retornou" e
  a taxa fica artificialmente péssima perto da data da leitura.
- `created_at`, não `occurred_at`: importar seis meses de histórico não é
  retornar do silêncio, é organizar o passado.

**(b) Limiar.** *Se a taxa de retorno após 7 dias de silêncio ficar abaixo de
30%, a retenção é o problema mais caro que temos, na frente das duas decisões
— integração nativa e monetização ampliada.*

Por que 30%: abaixo disso praticamente todo abandono é definitivo, e as duas
decisões pressupõem uma base que volta. Não se cobra assinatura de quem faz
viagem só de ida, e não se paga o custo de plataforma de uma coorte que
evapora. É a medida com o poder de veto mais amplo das sete, e deve ser.

**O limiar que destrava:** *retorno ≥ 50% torna a monetização ampliada
defensável* — metade das pessoas voltando por conta própria, sem notificação
nem cobrança, é tração real e não entusiasmo de lançamento.

**E um número para não interpretar errado: a mediana da duração do silêncio.**
Se os silêncios se concentram em 7–10 dias **e** as pessoas voltam, isso é
ritmo, não abandono — e o produto deve parar de tratar lacuna como falha
(nada de cobrança, nada de "você desapareceu"). Culpar quem tem ritmo semanal
é a forma mais eficiente de transformar retorno em desinstalação.

### 7. Reação ao companheiro

**(a) Definição.** Sai do tri-estado de `profiles.mokari_enabled`:

```
perguntados = mokari_enabled is not null
adoção      = mokari_enabled = true ÷ perguntados
```

- `null` fora do denominador: nunca perguntamos, então não há reação para
  medir. Contar `null` como recusa é a forma mais fácil de esta medida
  mentir.
- **Vício conhecido, escrito de propósito:** `false` junta "recusou o convite"
  e "ligou e desligou depois". São sinais muito diferentes — o segundo é uma
  crítica ao Mokari, o primeiro é desinteresse. **Decisão para agora:** contar
  `false` como recusa e ler a adoção como piso. Se este número virar
  decisório, o conserto honesto e sem rastreamento novo é um
  `mokari_disabled_at` — as duas transições são caminhos de escrita
  diferentes, então recusa (nulo) e desligamento posterior (preenchido) se
  separam sem coletar nada sobre ninguém. Não fazer agora; deixar registrado
  para não redescobrir depois.

**(b) Limiar.** *Se a adoção ficar abaixo de 30% entre quem foi perguntado, o
companheiro é recurso lateral e não pode entrar como argumento de
monetização.*

Por que 30%: é opt-in de um toque, de graça, pedido uma vez, num bom momento, a
uma pessoa que já escolheu estar ali. Isso converte alto quando ressoa. Menos
de um terço dizendo sim a algo que não custa nada é um "não, obrigado" educado
— e qualquer item de roadmap que trate o Mokari como o gancho emocional do
produto está mal precificado.

**O limiar reverso, e é o mais valioso da lista:** *se a adoção passar de 60%
E quem adotou tiver taxa de retorno (medida 6) maior que quem não adotou, o
Mokari é o mecanismo de retenção do produto — e ele passa na frente do Apple
Health.* O cruzamento é o que dá sentido: adoção alta sozinha só mede
simpatia pelo convite. Adoção alta que aparece na medida 6 mede efeito.

### Como as duas decisões ficam travadas

O propósito da fase não é o painel. É que estas duas decisões deixem de ser
opinião. Então elas ficam escritas como condição, não como conversa:

**D1 — Integrações nativas (Apple Health)**

Destrava só com **todas**:
1. Medida 1: mediana de T1 ≤ 10 min *(o gargalo não é o onboarding)*
2. Medida 2: 100% de importações com recibo *(a promessa do recibo aguenta
   multiplicar o volume)*
3. Medida 4: `dados_insuficientes` > 50% dos insights calculados *(existe de
   fato um problema de volume de dados a resolver)*
4. Medida 6: retorno ≥ 30% *(existe coorte que volta para receber o que
   sincronizou)*

**Barra, mesmo com as quatro cumpridas:** medida 5 acima de 60% — a conversa é
a interface, e sincronia passiva trocaria a frase pelo número, deixando a
memória mais completa e mais burra.

**D2 — Monetização ampliada**

Destrava só com **todas**:
1. Medida 4: utilidade ≥ 40% com taxa de resposta ≥ 25% *(alguém disse, com as
   próprias palavras, que ajudou)*
2. Medida 6: retorno ≥ 50% *(existe base para cobrar)*
3. Medida 3: rejeição ≤ 20% *(a memória é confiável)*

**Barra, mesmo com as três cumpridas:** medida 1 acima de 10 min, ou medida 2
abaixo de 100% — cobrar mais por um produto em que a pessoa não chega ao
primeiro valor, ou cuja importação não é auditável, gasta a única audiência
que teremos de graça.

**Vale para as duas:** nenhuma pode ser decidida abaixo do quórum de 20
pessoas — que é onde estamos hoje, com zero. A resposta correta hoje é "não há
dados", e ela é uma resposta, não um adiamento.

**Revisão dos limiares:** primeira releitura 30 dias depois da 20ª pessoa. O
que mudar, muda com o raciocínio escrito ao lado — quem discordar de um número
discute o parágrafo, não a lembrança de quem propôs.
