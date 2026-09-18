[403 lines total]
etica-parecer — Social do Ascende (grupos, desafios, feed, ranking)

Fiel da Balança · 17/09/2026 · contra PRINCIPIOS.md e POSICIONAMENTO.md

NOTA DE OFÍCIO: as notas "comportamento-achados", "motivacao-achados" e
"copy-achados" não existem neste canvas (Estopim, Cadência e Sussurro não
estão conectados). A Frente 2 (veto das propostas deles) fica aberta. Este
parecer cobre a Frente 1 aplicada ao recurso Social.

===============================================================================
1. VEREDITO: SIM — mas o que passa NÃO é uma cópia do GymRats.
===============================================================================

Dá para fazer um Social que não trai o PRINCIPIOS.md. Não dá para fazer o
GymRats dentro do Ascende.

A distinção não é de grau, é de objeto. O GymRats é construído em volta do
DESEMPENHO ALHEIO: o feed mostra o que os outros fizeram, o ranking ordena as
pessoas, o push lembra você de que alguém andou enquanto você parou. Esse motor
falha a pergunta 3 do meu teste — ele só funciona enquanto a pessoa não percebe
que a inquietação que ela sente ao abrir o app foi projetada. Isso é
manipulação pela definição de Susser/Roessler/Nissenbaum, e é exatamente o que
o Dilema 4 já recusou por escrito.

O que passa é um Social construído em volta do COMPROMISSO: um combinado
explícito, com início, fim e um resultado coletivo. "Nós quatro, quatro treinos
por semana, até dia 30." Isso sobrevive à pergunta 1 (se a pessoa lesse o design
doc, leria "criamos isto porque compromisso com terceiros é a tecnologia mais
antiga de sustentar hábito" e agradeceria), à 2 (serve o objetivo dela — e o
nosso ganho, retenção por vida melhorando, está declarado) e à 3 (funciona
melhor, não pior, com a pessoa plenamente consciente do mecanismo; é a diferença
entre nudge e sludge).

ACHADO QUE MUDA O DESENHO (auditoria de código): src/lib/battles.ts, linha 29,
BATTLE_TEMPLATES traz "Redes sociais — Rolagem infinita, comparação, horas
perdidas" como batalha oferecida ao usuário. O Ascende VENDE uma batalha contra
feed e comparação. Construir feed infinito e comparação aqui dentro é a
estrutura exata do Dilema 3 (a bet): lucraríamos duas vezes com a mesma queda —
uma vendendo a batalha, outra operando o gatilho. Isto não veta o Social. Veta
o FEED e o RANKING ORDINAL como forma.

CONDIÇÕES INEGOCIÁVEIS (se qualquer uma cair, meu voto vira NÃO):

C1. O objeto é o combinado, não o mural. Todo grupo/desafio tem data de fim e
    expira sozinho. Nada de presença permanente que só existe para ser rolada.

C2. Reciprocidade. Você só vê de alguém o tipo de dado que você também
    compartilha com aquele grupo. Sem espectador.

C3. Comparação sempre contra a meta da própria pessoa, nunca contra o número
    absoluto de outra. (Detalhe em §4.)

C4. Teto de notificação inalterado. Entrar em grupo não aumenta o número de
    pushes por dia. Detalhe em §3.

C5. Consentimento entendido, não só coletado. A tela de compartilhamento mostra
    um PREVIEW LITERAL, com os dados reais dela, do que o grupo verá — antes do
    confirmar. Checkbox com texto legal é consentimento que ninguém leu, e
    consentimento que ninguém leu é manipulação por omissão. O Ascende já sabe
    fazer isso: a Emenda 4 do POSICIONAMENTO exige que cada resposta mude algo
    que a pessoa VÊ na hora.

C6. Sem descoberta pública. Grupo só por convite direto. Nenhuma tela lista
    pessoas que você não convidou; nada de "talvez você conheça", nada de
    perfil público, nada de seguidores. Isto mata o motor de crescimento viral
    de propósito — é o preço da intimidade que o POSICIONAMENTO §C.4 já se
    recusou a vender ao RH.

C7. Social não pode virar chantagem de rede. Se o vínculo social ficar atrás do
    paywall, cancelar passa a custar amigos, e o cancelamento vira mais difícil
    que a assinatura — dark pattern clássico (roach motel), e incompatível com
    "Cancelou? Seus dados continuam seus". Regra: participar de grupo é do plano
    grátis; cair para o grátis NUNCA remove ninguém de um grupo. Se houver
    limite pago, que seja no número de grupos CRIADOS, nunca em participar.

C8. Social não pontua no Score nem gera XP (já decidido pelo fundador, e
    reforço: convidar amigo, reagir e postar são ações NO APP — Micro-incoerência
    1 as proíbe de virar XP).

===============================================================================
2. A LISTA NUNCA DO SOCIAL (linhas concretas e testáveis)
===============================================================================

N1.  Nenhum tipo de dado nasce compartilhável. Coluna DEFAULT false, sempre.
     Teste: usuário novo entra num grupo; o grupo vê o nome dele e nada mais.

N2.  Dado financeiro nunca é compartilhável — nem derivado, nem agregado, nem
     booleano. "Cumpriu o teto de gasto hoje: sim/não" JÁ É dado financeiro.
     Teste: nenhuma métrica compartilhável pode ter insumo em transactions,
     spend_limit, orçamento ou reserva.

N3.  Batalhas nunca entram no Social, em forma nenhuma: nem check-in, nem dias
     limpos, nem marco de 30 dias, nem dentro de um número agregado.
     Teste: o módulo que calcula qualquer valor compartilhável não pode importar
     de lib/battles. (Existe discreet_name no schema justamente porque a pessoa
     não quer que o assunto seja lido nem na própria tela dela.)

N4.  Peso, medidas e composição corporal nunca são compartilháveis. O Mokari já
     remove weight e body de toda conta (IGNORED_KINDS, regra 3, com teste). O
     Social não pode ser a exceção que desmente a regra.

N5.  Diário, humor e prática espiritual nunca são compartilháveis. Prática
     espiritual é convicção religiosa: dado sensível pela LGPD art. 5º, II, e um
     grupo que vê "praticou 5x esta semana" acabou de rotular a fé de alguém.

N6.  Nenhum número composto é compartilhável se algum insumo dele não for.
     "Constância geral" e Score ficam fora por construção, não por decisão.
     Teste: função pura isShareable(metric) que falha se qualquer insumo for
     não-compartilhável; teste que quebra quando alguém adiciona insumo novo.

N7.  Nenhum push do Social tem a atividade de terceiro como gatilho, e nenhum
     push contém a estrutura "e você?" ou qualquer referência ao que a pessoa
     NÃO fez. Teste de revisão: se a frase só faz sentido porque ela ficou para
     trás, é culpa; não passa.

N8.  O teto diário de notificações não aumenta por causa do Social. Cinco grupos
     não geram cinco vezes mais push. Teste: o contador é por usuário/dia, nunca
     por grupo.

N9.  O grupo nunca é notificado da ausência de alguém. Ausência não é evento.

N10. Nenhuma posição ordinal de uma pessoa é visível para outra sem que ela
     tenha ligado isso para aquele desafio específico. Sua posição é sua.
     Teste: a resposta da API do desafio não contém rank de terceiros.

N11. Nada de feed infinito, "carregar mais" sem fim, ou badge de não-lidos na
     navegação. A tela do grupo tem começo e fim e acaba.
     Teste: a query tem limite fixo por ciclo, sem paginação infinita.

N12. Desligar um tipo de dado, ou sair do grupo, apaga o que já foi visto —
     retroativo, não só daqui pra frente. Sair é um toque, sem diálogo de
     retenção ("tem certeza? seus amigos vão sentir sua falta" é proibido) e sem
     anúncio destacado ao grupo.

N13. O Conselheiro nunca usa dado de outra pessoa do grupo ao falar com você.
     "O João já treinou 3x esta semana" é vazamento com voz de IA, e destrói a
     isenção que o Dilema 1 protege.

N14. Nenhuma escassez artificial: nada de "vagas limitadas no desafio",
     "convite expira em 2h", contagem regressiva que não corresponde a um limite
     real do sistema.

===============================================================================
3. NOTIFICAÇÃO — o teste aplicado a "fulano treinou, e você?"
===============================================================================

VETADO. Sem ressalva, sem versão suavizada.

P1 (ela agradeceria ou se sentiria usada?): o design doc honesto dessa
notificação diz "atividade de par gera abertura porque produz desconforto de
comparação". Ninguém agradece ao ler isso. Falha.

P2 (objetivo dela ou métrica nossa?): a primeira metade ("fulano treinou") tem
utilidade zero para a vida dela. A segunda ("e você?") é onde mora o valor — e
o valor é NOSSO. Falha. Agravante: o volume passa a ser função de quantos
amigos ela tem, não da vida dela. Isso é o oposto do "briefing 1x/dia" que o
Dilema 4 cita como prova de desenho.

P3 (funciona com a pessoa consciente?): se o app dissesse junto "mandamos isto
porque comparação move gente", o efeito evapora ou vira raiva. Depende de ela
não perceber. É manipulação. Veto.

Ainda: viola Micro-incoerência 3 direta ("serviço ou culpa?"), e o Ascende
oferece uma batalha cujo gatilho declarado é "comparação".

AS QUE PASSAM (quatro regras, depois a lista):
 (a) o gatilho é um HUMANO dirigindo-se A VOCÊ, nunca atividade ambiente;
 (b) a notificação é completa em si — não existe para te fazer entrar;
 (c) volume independente do tamanho do grupo, dentro do teto de §N8;
 (d) nada sobre o que você não fez.

 • Convite: "Ana te convidou para o desafio Semana da Água (até 24/09)."
   Uma vez, expira sozinho, não repete.
 • Recado dirigido: "Ana escreveu no grupo Casa da Subida." Agrupado, no
   máximo 1 por dia, com corte automático.
 • Reconhecimento recebido, agregado: "3 pessoas reconheceram seu registro de
   ontem." Máximo 1 por dia, sem escalonamento de contagem, sem "você está em
   alta". Se o produto não aguentar esse teto, o problema é o produto.
 • Prazo do que ela mesma escolheu: "Seu desafio termina amanhã." Factual,
   serviço puro, uma vez por ciclo.
 • Fechamento coletivo: "O grupo cumpriu 50 de 50 treinos da semana." Sem nomes,
   sem destrinchar quem fez quanto — E com a trava: não enviar a quem não
   participou nenhuma vez no ciclo. Nunca notifique alguém sobre um resultado
   coletivo em que a ausência dela É a informação.

Regra de canal, herdada do whatsapp-notify (que já faz certo): a notificação
CHAMA, nunca ENTREGA. Nenhum push do Social carrega número comparativo.

===============================================================================
4. RANKING E COMPARAÇÃO
===============================================================================

Ranking ordinal permanente e público: VETADO. Não existe versão dele que ajude
quem está atrás, porque o ordinal é uma afirmação sobre a PESSOA ("você é o
quinto"), não sobre o comportamento dela. E o público do Ascende, por
POSICIONAMENTO §B, é quem já desistiu de vários apps — a última coisa que essa
pessoa precisa é de mais uma tela dizendo em que lugar ela ficou.

Esconder o terço de baixo não resolve: "e mais 6 participantes" identifica os 6.
Vergonha escondida é vergonha visível com passo extra.

O QUE FICA NO LUGAR (três camadas, em ordem de intensidade):

Camada 0 — padrão de todo grupo: A BARRA COLETIVA.
Um número só, do grupo: "34 de 50 treinos combinados nesta semana". Quem está
atrás continua contribuindo em vez de aparecer atrás. Cooperação tem o mesmo
efeito de compromisso social sem ter o custo do ordinal.

Camada 1 — a lista de pessoas, quando existir: SEM ORDEM E CONTRA A PRÓPRIA META.
Ordem alfabética ou por entrada, nunca por desempenho. Cada linha mostra a
pessoa contra a META DELA ("Ana: 3 de 3", "Você: 2 de 4"), nunca um número
absoluto comparável. Assim quem combinou 2 treinos por semana e cumpriu aparece
completo ao lado de quem combinou 6 — que é a verdade, e é o que o desenho
ordinal apaga.

Camada 2 — o Desafio competitivo, para quem quiser: OPT-IN E POSIÇÃO PRIVADA.
Com data de fim, com opt-in de cada participante, e com a regra dura: cada um vê
a PRÓPRIA posição; ninguém vê a de ninguém. Quem quiser aparecer no pódio liga
isso explicitamente para aquele desafio. Sem opt-out disponível para o pódio,
isso vira exposição; com ele, vira escolha.

Camada 3 — a que eu recomendo construir primeiro, em vez do ranking:
O RECONHECIMENTO ASSIMÉTRICO. O grupo pode reconhecer um retorno ("voltou depois
de 9 dias") com o mesmo peso visual de um recorde. A Emenda 3 do POSICIONAMENTO
já diz que o momento do churn é o momento do produto; o Social é a única parte
do app que pode ter OUTRA PESSOA no ritual de retorno. É o único lugar onde a
comparação social vira cura em vez de ferida: ela cura quando o grupo nota quem
voltou, e fere quando o grupo ordena quem produziu.

===============================================================================
5. O QUE ISSO CUSTA SE DER ERRADO (neste produto, não em abstrato)
===============================================================================

Cenário 1 — a porta que ela mesma abriu sem entender.
Ela entra num grupo de colegas de academia e liga "constância", achando que é
treino. O cálculo de constância, se agregado ingenuamente, inclui prática
espiritual e check-in de batalha. Numa semana ela recai na batalha "Apostas": a
constância cai, e a queda é visível. Um colega pergunta "o que houve naquela
semana?". O Ascende acabou de entregar uma recaída em jogo para um grupo de
trabalho. Este é o motivo de N3, N5 e N6 serem regra de código e não de
revisão: é o único app onde o mesmo cadastro guarda vício, fé, corpo e salário.

Cenário 2 — o dado vira ficção e o produto morre por dentro.
Pessoa no terço de baixo de um grupo fitness não churna: ela começa a registrar
uma vida que não viveu, para não parecer o que ela é naquele mês. No GymRats
isso é cosmético. Aqui não: o valor declarado do Ascende é 1 insight cruzado
útil por semana, e insight cruzado é inferência sobre o que ela registra. Dados
performáticos envenenam a matéria-prima. O Social mal feito não só fere o
usuário — ele quebra o único produto que justifica a assinatura.

Cenário 3 — o cliente-alavanca é exatamente quem mais se machuca.
POSICIONAMENTO §B: orçamento apertado, academia e mercado disputando o mesmo
salário. Um feed entre amigos é um expositor de pobreza mesmo SEM dado
financeiro: academia frequentada, refeição fotografada, suplemento, restaurante.
Ela sai do app que existia para dizer "cabe no seu bolso" com a sensação de
estar atrás dos amigos em dinheiro. A pessoa para quem o produto foi desenhado é
a mais vulnerável ao recurso. Isso é definição de dark pattern segundo Gray et
al.: interface cujo dano recai sobre quem tem menos margem.

Cenário 4 — a contradição que saca a conta inteira (Festinger).
Alguém está com a batalha "Redes sociais" ativa — rolagem infinita, comparação,
horas perdidas — e o app que a ajuda a lutar entrega o gatilho na tela ao lado.
No dia em que isso for notado em público, não perdemos o Social: perdemos a
/recusas inteira, que é o ativo caro construído por oito itens que hoje são
verdadeiros no código.

Custo assimétrico, em uma linha: um Social medíocre custa um recurso; um Social
manipulativo custa a razão pela qual alguém confia dinheiro, corpo, fé e emoção
ao mesmo cadastro. Não há como reconstruir isso com feature.

===============================================================================
6. A FATURA VISÍVEL (linha para /recusas)
===============================================================================

Título:
"Nosso Social nunca terá feed infinito, ranking de quem está na frente, nem
notificação de 'fulano treinou, e você?'."

Detalhe:
"Grupos aqui existem para combinar e sustentar, não para comparar. Você escolhe,
um por um, o que o grupo vê — nada nasce aberto, dinheiro nunca é
compartilhável, e suas batalhas nunca saem daqui. Recusamos a engrenagem que faz
um app social crescer, porque ela cresce com a sua insegurança. Temos uma
Batalha contra redes sociais dentro do produto: seria estranho construir uma
aqui dentro."

Complemento sugerido na landing (uma linha, junto ao /#10segundos):
"Tem grupo, sim. Não tem plateia."

===============================================================================
ANEXO — o que eu preciso ver antes de assinar a implementação
===============================================================================
 1. A função isShareable e seus testes (N2, N3, N4, N5, N6), escritos como o
    lib/mokari.ts foi: regra ética como função pura com teste que falha quando
    alguém a remove.
 2. O contador de push por usuário/dia com o Social dentro do mesmo teto (N8).
 3. A tela de consentimento com preview literal (C5).
 4. A rota de saída e o apagamento retroativo (N12).
 5. A confirmação de que cair para o plano grátis não remove ninguém de grupo
    algum (C7).

===============================================================================
ANEXO B — PARECER SOBRE O MODELO DE DADOS DA ADUANA (17/09/2026)
===============================================================================

O modelo está certo na espinha: projeção por allowlist, tabela sem coluna de
texto (o diário não tem onde caber — isso é regra virando estrutura, do jeito
certo), consentimento como presença de linha, janela por interseção de datas.
APROVADO na forma. Três cortes e um risco que ele não viu.

B1. PESO — CORTA O DELTA. Fica só peso_registrado (constância).
Razão 1, coerência de código: lib/mokari.ts remove weight e body de TODA conta,
inclusive do XP (IGNORED_KINDS, regra 3, com teste que falha se alguém tirar).
Publicar peso_delta_kg faria da composição corporal o único número que o app se
recusa a contar em privado e aceita expor em público. Festinger cobra essa.
Razão 2, dano documentado: competição de emagrecimento entre amigos é vetor
conhecido de restrição extrema e desidratação no fim do período. E o produto já
recusou esse enquadramento — isFoodBattle() em lib/battles.ts redireciona quem
tenta criar "batalha contra comida" para hábitos positivos. O delta reabre pela
porta social a porta que o código fechou.
Razão 3, justiça da comparação: delta é RESULTADO, não ATO. Depende de ciclo,
retenção de líquido, remédio, ganho de massa. Comparar resultado que a pessoa
não controla é comparação injusta por construção.
O desejo legítimo por trás do delta ("quero um desafio de emagrecimento com meus
amigos") se atende com ATOS: treinos feitos, dias dentro da meta calórica, dias
com registro. O resultado fica privado; o compromisso fica visível. Isso é
melhor para o desafio, além de ser mais honesto.
Ressalva sobre peso_registrado: fica, mas NUNCA ordenado e nunca em ranking —
constância de pesagem diária é gatilho conhecido para quem tem relação difícil
com balança.

B2. O ZERO — a inclinação está certa, mas NÃO basta.
Soma em vez de média: correto, mantenha. Exibir "sem registro" em vez de "0":
correto, mantenha. Mas o rótulo conserta a PALAVRA, não a POSIÇÃO: numa lista
ordenada por soma, quem teve semana ruim continua chegando por último, agora com
eufemismo. Soma é monotônica em presença — todo ranking de soma é um ranking de
frequência disfarçado. Ver §4: ordinal público entre pessoas está vetado; o que
fica é a barra coletiva e a linha contra a meta da própria pessoa.
CONSEQUÊNCIA DE SCHEMA QUE FALTA NO MODELO: shared_daily_stats tem value e não
tem DENOMINADOR. Sem a meta da própria pessoa guardada junto do consentimento, a
UI só consegue renderizar número absoluto — ou seja, a comparação absoluta está
assada no schema, e a regra C3 do parecer fica impossível de cumprir na tela.
Guarde o alvo que a pessoa combinou para aquele metric_key naquele grupo (em
group_data_consents ou tabela irmã), para a tela poder dizer "3 de 3" e não "3".
SEGUNDA CONSEQUÊNCIA: a tabela é por dia e por pessoa, o que deixa o mapa de
calor a um SELECT de distância. O calendário de bolinhas de OUTRA pessoa é o
artefato de vergonha mais eficiente desta categoria de app. Regra dura: a API do
grupo nunca devolve série diária de terceiro — só total do ciclo. Teste: a
resposta do endpoint de grupo não contém array indexado por dia de outro user_id.

B3. SENSIBILIDADE — corta três dos quatro.
CORTA pratica_espiritual, sem toggle, junto de batalhas e financeiro. Convicção
religiosa é dado sensível (LGPD art. 5º, II) e a contagem pura já entrega tudo:
num grupo de trabalho, "praticou 6x" identifica a pessoa de fé, e a queda para
zero identifica o afastamento dela. Devoção que vira número comparável deixa de
ser devoção e vira desempenho na frente dos outros.
CORTA humor_registrado. A FREQUÊNCIA de registro de humor é proxy do estado
emocional nos dois sentidos (registra mais quando está turbulento, para de
registrar quando afunda). E ela convida a vigilância com cara de cuidado: "vi
que você não registra humor há 10 dias, está tudo bem?". Nenhum desafio legítimo
precisa dela.
CORTA diario_escrito, pela mesma razão, com o agravante de que a contagem
convida a pergunta "sobre o quê?".
FICA gratidao_registrada, com ressalva: contagem pura, nunca ordenada, nunca em
ranking. "Uma coisa boa por dia" é desafio de grupo real e benigno.
A REGRA GERAL PARA A COLUNA sensitivity — O TESTE DO ZERO:
uma métrica só entra no catálogo se o ZERO dela for uma informação que a pessoa
não se importaria de ouvir lida em voz alta pelo grupo.
  treino, zero = "não treinou esta semana"        -> tolerável, entra.
  humor,  zero = "parou de conseguir se olhar"    -> não entra.
  prática espiritual, zero = "se afastou da fé"   -> não entra.
  batalha, zero = "recaiu"                        -> não entra (já fora).
Isto é melhor do que classificar por sensibilidade do conteúdo, porque no
agregado o conteúdo já não existe — o que vaza é sempre a ausência.

B4. O QUARTO RISCO (o que eu não vi no modelo), em ordem de gravidade:

(a) REGRA DE PRIVACIDADE COMO CLÁUSULA WHERE É REGRA A UM BUG DE DISTÂNCIA.
    A janela (day >= greatest(...)) esconde o passado; ela não o apaga. Uma
    regressão de um caractere nesse predicado reexpõe um ano de histórico num
    deploy, silenciosamente, para pessoas reais. Desligar o toggle deve APAGAR
    as linhas projetadas daquele metric_key, e sair do grupo deve apagar as
    linhas daquele grupo. Fail-closed por deleção, não por predicado. (É também
    o que "desligar apaga retroativo" prometido em §N12 exige de fato.)

(b) O BURACO PERMANENTE É, ELE MESMO, UMA INFORMAÇÃO PÚBLICA.
    "Religar deixa um buraco" protege o dado e denuncia a pessoa: um vão de 3 a
    20 de setembro é lido pelo grupo como "aconteceu alguma coisa ali". O
    controle de privacidade virou sinal social. Mitigação, além de (a): a tela
    de grupo nunca mostra o denominador da janela de outra pessoa — nem "de 17
    dias possíveis", nem percentual que permita derivá-lo.

(c) AGREGADO NÃO É ANÔNIMO EM GRUPO PEQUENO.
    Com a barra coletiva mais as linhas individuais, num grupo de 3 qualquer um
    deduz o número do terceiro por subtração — inclusive de quem manteve a
    posição privada. Exija k mínimo: a barra coletiva de um metric_key só
    aparece com pelo menos 4 consentimentos ativos naquele grupo; abaixo disso,
    cada um vê só o próprio número.

(d) O CATÁLOGO PRECISA SER FECHADO POR MIGRATION.
    metric_key deve ser FK para o catálogo, e o catálogo semeado só por
    migration revisada — nunca insert de código de aplicação. Senão
    'peso_delta_kg' entra numa terça-feira sem passar por esta mesa.
