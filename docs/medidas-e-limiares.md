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

---

## MEDIDAS 9–13 — O BLUEPRINT DA SUBIDA

Cinco medidas acrescentadas em 13/10/2026, junto com a correção que faz a
proposta do Blueprint sobreviver a um recarregamento. Mesmas três regras das
sete primeiras: mediana por pessoa, denominador explícito, quórum de 20. Nenhuma
ferramenta nova — quatro saem de tabelas que a própria pessoa preencheu, e a
quinta não tem sinal nenhum e está marcada como tal.

### A soma que não se faz

As medidas 11, 12 e 13 respondem à mesma pergunta de negócio ("o Blueprint
entregou alguma coisa?") e é por isso mesmo que **nunca se somam**. São três
fatos sobre três momentos, e nenhum implica o seguinte:

- **11 — registrar** prova que a pessoa CHEGOU, não que o plano serviu;
- **12 — ativar** prova que ela ACEITOU, não que usou: ativar é um toque;
- **13 — declarar útil** é a única que é juízo dela, e a única que não se infere.

Somadas, viram um funil que SOBE quando melhoramos o passo mais fácil (ativar)
e fica igual quando o difícil (ajudar) piora. Três linhas no relatório, três
views no banco, e está escrito no `comment on view` de cada uma. Quem quiser um
número único terá que escrever a soma à mão — e aí a responsabilidade é de quem
somou, não da medida.

### 9. Proposta gerada que chega à ativação em 24 h

**(a) Definição.**

```
denominador = pessoas com generated_at (metric_blueprint_funnel)
numerador   = dessas, as que têm activated_at <= generated_at + 24h
```

- **Dispensar NÃO é falhar.** "Agora não — quero explorar primeiro" é uma opção
  que o produto oferece de propósito. `dispensou_e_nao_voltou` é lido ao lado,
  nunca dentro do numerador: somá-lo transformaria uma escolha legítima em taxa
  de fracasso, e a leitura seguinte seria tirar a opção da tela.
- **`legado_sem_proposta` entra no denominador, mas marcado.** Quem gerou antes
  desta correção perdeu a proposta e nunca teve como ativar. Tirá-lo seria
  esconder o dano; deixá-lo solto faria o dano antigo virar piso permanente que
  nenhuma melhoria futura consegue mover.
- 24 h e não "algum dia": a proposta é feita na primeira sessão, com a pessoa
  olhando. Ativação uma semana depois é outro evento, não a conclusão deste.

**(b) Limiar.** *Se menos de 60% de quem gera chegar à ativação em 24 h — fora
quem dispensou de propósito —, o Blueprint está sendo gerado e jogado fora, e o
conserto é no FLUXO, não no modelo.*

Por que 60%: gerar um Blueprint é a coisa mais cara que este produto faz (~104 s
de modelo, e consome a cortesia da pessoa). Quem esperou dois minutos por um
plano e não o ativa no mesmo dia ou não gostou, ou perdeu. Abaixo de 60%, a
causa mais provável continua sendo mecânica — e mecânica é barata de consertar.
Só acima disso a pergunta passa a ser sobre a qualidade do que o modelo escreve.

**A leitura reversa, e ela importa:** *se a maioria das não-ativações for
`dispensou_e_nao_voltou`, isso não é falha — é a opção "explorar primeiro"
funcionando.* Tirar a opção porque ela é usada seria o erro mais caro que este
número pode provocar.

### 10. Falhas de recuperação da proposta

**(a) Definição.**

```
denominador = pessoas com qualquer evento de Blueprint
numerador   = dessas, as com >= 1 evento resume_failed de motivo NOVO
              (motivo <> 'legado_sem_proposta')
```

Por pessoa e **com o motivo**: sem o motivo o número não aciona conserto nenhum
— "falhou 7 vezes" não diz se o problema é o cliente, a função ou o banco. E por
pessoa, não por evento, porque quem estava com rede ruim e tentou dez vezes não
pode responder pelas outras dezenove.

`falhou_e_nao_voltou` (falhou e nunca mais retomou nem ativou) é o corte que
separa ruído de rede de promessa quebrada.

**(b) Limiar.** *Qualquer pessoa com ≥ 1 falha de motivo novo é defeito de
correção, e barra o fechamento desta branch até ser entendido.*

Por que binário e não faixa: é a mesma natureza da medida 2 (recibo de
importação). A promessa desta branch — "sua proposta não se perde" — é binária:
foi cumprida com aquela pessoa ou não foi. As medidas sobre gosto e
comportamento admitem faixa; auditoria da própria promessa, não.

Falhas de legado ficam de fora da barra, contadas e visíveis: são dano de antes
da correção, não defeito novo.

### 11. Primeiro registro — sem o que nasceu dentro do onboarding

**(a) Definição.** Irmã honesta da medida 1. Mesma elegibilidade de evento,
copiada linha por linha de `metric_time_to_first_value` (duas definições de
"primeiro valor" que divergem um dia é como duas verdades nascem), **menos o
peso que o próprio onboarding escreve**.

O onboarding insere um `life_events` sozinho: no bloco do corpo, o peso digitado
vira `kind='weight'`, `source='form'` (`Onboarding.tsx`, `finishBody`). Para a
medida 1 isso está certo — o peso É um registro real. Para decidir "o Blueprint
entregou a promessa?", não serve: acontece ANTES de existir qualquer plano, e
contá-lo faz o Blueprint parecer eficaz por causa de um campo de formulário.

**Critério de exclusão** (três itens, nenhuma constante arbitrária). O evento
nasceu dentro do onboarding quando:

1. é `kind='weight'`, `source='form'`, `data_source_id is null` — a forma exata
   e única que o onboarding escreve, e ele escreve um evento só;
2. é o **primeiro** evento elegível da pessoa — no fluxo, o bloco do corpo vem
   antes de qualquer outra tela que registre;
3. e, quando há `profiles.blueprint_generated_at`, foi criado até esse carimbo.

O item 3 é **guarda, não filtro**: protege quem pulou o campo de peso no
onboarding e registrou um peso pela tela de Vitalidade semanas depois. Esse é
ato real da pessoa e continua contando.

**O custo, escrito agora para ninguém descobrir em seis meses:** quem pulou o
peso no onboarding E cujo primeiro registro de todos foi um peso pelo
formulário, antes de gerar o Blueprint, é excluído junto. Não dá para separar os
dois casos sem marcar a linha na origem — e marcar a linha é instrumentação
nova, que a Fase 6 recusou. Entre inflar a medida do Blueprint e perder alguns
primeiros registros legítimos, esta mesa escolhe perder.

**(b) Limiar.** Os mesmos da medida 1 — *mediana ≤ 10 min, e ≤ 40% sem chegar ao
primeiro registro em 24 h* — lidos **separadamente** dela.

**Esperado, e não é regressão:** este número vai ser PIOR que o da medida 1, por
construção. Quem comparar os dois e gritar "pioramos" leu errado: a medida 1
estava contando o nosso próprio formulário como valor que a pessoa produziu.

### 12. Plano ativado

**(a) Definição.**

```
denominador = pessoas com generated_at
numerador   = dessas, as com >= 1 plano origin='blueprint' e status='ativo'
```

Duas fontes que precisam concordar: o carimbo (`activated_at`) e os planos de
fato (`plans.origin='blueprint'`). Divergirem é informação — `ativou_sem_plano`
é carimbo de ativação que não deixou plano nenhum na mão da pessoa.

`blueprint_plans_archived` conta separado porque **não é escolha dela**: o
contrato manda arquivar quando o gatilho de cota recusa. Somar arquivado com
ativo responderia "ela aceitou?" quando a pergunta da medida é "ela FICOU com o
plano?".

**(b) Limiar.** *Se menos de 40% de quem gerou ficar com ao menos um plano ativo
vindo do Blueprint, o problema é o que o modelo escreve, não o botão.*

Por que 40%: ativar é um toque, de graça, imediatamente depois de a pessoa ter
pedido aquele plano e esperado por ele. Isso converte alto quando o plano
ressoa. Menos de dois em cinco é o plano não ressoando — e aí construir mais
fluxo em volta do botão é consertar o lugar errado.

**O corte binário, e ele é o mais acionável:** *qualquer pessoa com
`blueprint_plans_archived > 0` é o produto prometendo o que não pode entregar* —
oferecemos um plano e a cota o recusou no mesmo segundo. Isso é defeito de
correção, não comportamento, e se lê como a medida 2.

### 13. Utilidade declarada do plano — **SEM SINAL AINDA**

**(a) Definição.** Formato da medida 4, e de propósito: utilidade é juízo da
pessoa e não se infere de comportamento. Ativar não prova que ajudou; arquivar
não prova que atrapalhou.

```
perguntados = insight_feedback com kind='blueprint_util'
respondidos = dos perguntados, os que a pessoa respondeu
úteis       = dos respondidos, os "sim"
taxa de utilidade = úteis ÷ respondidos
taxa de resposta  = respondidos ÷ perguntados   (a barra de erro da primeira)
```

**Hoje isto devolve zero para todo mundo, porque nada no produto pergunta.**
`docs/medidas.sql` imprime SEM SINAL AINDA. A view já existe para que o dia em
que o sinal nascer seja uma migração de UI e não uma discussão sobre como medir
— e para a medida aparecer no relatório em vez de sumir dele. Medida omitida é
medida esquecida.

**Para o sinal existir, duas coisas — nenhuma delas feita agora:**

1. a pergunta na tela, com o texto abaixo;
2. `insight_feedback_kind_valido` passando a aceitar `'blueprint_util'`.

Por que `insight_feedback` e não tabela nova: é a única mesa do produto onde a
pessoa responde uma pergunta, e a medida 4 já mora lá com este exato formato.
Tabela nova para uma coluna de resposta é instrumentação nova. O `check` que
hoje barra o kind é o atrito certo — obriga quem criar a pergunta a passar por
uma migração. (`insight_id` fica nulo: a pergunta é sobre plano, não sobre
insight.) *Se o Maestro preferir que o sinal nasça em `blueprint_events` com um
`kind` novo, isso é mudança de contrato e precisa de aviso; a view muda de
`from` e mais nada.*

**(b) A pergunta proposta.** Texto decidido com a Fiel em 13/10/2026:

> **Nestas duas semanas, o plano Treino de força te ajudou?**
> `[ Ajudou ]  [ Não ajudou ]`

- **Quando:** uma vez só, 14 dias depois de `activated_at`, e só para quem
  ativou ao menos um plano E registrou alguma coisa depois. Quem ignora não é
  perguntado de novo — sem segunda chance, sem lembrete.
- **Onde:** na Hoje, no mesmo lugar discreto da pergunta da medida 4. Nunca em
  push, nunca em modal.

O raciocínio da Fiel, nas palavras dela:

1. *"'Em alguma coisa' rebaixa a barra do sim e infla a medida a nosso favor — e
   uma medida que nos lisonjeia é pior que medida nenhuma, porque faz a empresa
   acreditar que o Blueprint funciona quando ele não funciona."*
2. *"O nome põe o plano no banco dos réus em vez da pessoa, e é o que permite
   saber qual plano falhou — genérico coleta uma média de nada."*
3. *"Catorze dias medem vida vivida em vez de novidade, e 'nestas duas semanas'
   dentro da pergunta impede que a resposta seja sobre o humor de hoje."*

**O terceiro botão saiu.** *"Quem ignora já é a saída sem custo, e já conta na
taxa de resposta — é a sua barra de erro. 'Prefiro não dizer' não acrescenta
informação, acrescenta uma decisão, e parece respeito sendo contabilidade.
Gentileza falsa é a que serve a nós."*

**CONDIÇÃO VINCULANTE da Fiel, que não estava na proposta e é dela:**

> *"A resposta não pode mudar nada do que a pessoa recebe. Se 'não ajudou' abrir
> oferta de outro plano, re-onboarding ou qualquer conversa, a pergunta deixou de
> ser medição e virou funil — e aí o 'não' passa a ter preço, o que contamina a
> própria medida que você quer. Vale dos dois lados: 'ajudou' não gera
> comemoração, nem XP (ação no app, Micro-incoerência 1), nem push. Registra e
> agradece em uma linha."*

**(c) Limiar, para quando o sinal existir.** Os mesmos da medida 4 — *utilidade
≥ 40% com taxa de resposta ≥ 25%* —, pelo mesmo motivo: um plano é uma afirmação
sobre a vida da própria pessoa, e a barra não é "interessante", é "me ajudou".

### Quórum

Vale igual: 20 pessoas por denominador, e os denominadores aqui são menores que
os das sete primeiras (só quem gerou um Blueprint). A resposta correta hoje é
INSUFICIENTE nas cinco, e ela é uma resposta.
