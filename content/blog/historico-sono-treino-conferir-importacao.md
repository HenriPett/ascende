---
title: "Histórico de sono e treino: confira antes de importar"
description: "Veja como preparar um arquivo de saúde, conferir datas, unidades e repetições e entender o que será gravado antes de confirmar a importação."
slug: historico-sono-treino-conferir-importacao
datePublished: 2026-10-21
dateModified: 2026-10-29
resumo:
  - "Para importar histórico de saúde, confira de onde veio o arquivo, qual período ele contém e o que o aplicativo de destino reconheceu, comparando datas, unidades e repetições."
  - "Ter um arquivo disponível para exportação não significa que qualquer outro aplicativo consiga aproveitar tudo o que existe nele."
  - "As linhas lidas e os registros reconhecidos podem ter quantidades diferentes sem que isso prove perda de dados: uma linha pode ser só um trecho de sono ou parte de um treino."
intent: "como importar histórico de saúde e conferir sono e treino antes de gravar"
cluster: rotina-integrada
sources:
  - title: "Compartilhe seus dados no app Saúde do iPhone"
    url: https://support.apple.com/pt-br/guide/iphone/iph5ede58c3d/ios
    publisher: "Suporte da Apple"
    accessed: 2026-10-21
  - title: "Gerenciar dados de saúde no iPhone, iPad ou Apple Watch"
    url: https://support.apple.com/pt-br/108779
    publisher: "Suporte da Apple"
    accessed: 2026-10-21
related:
  - registro-de-habitos-consistencia
  - revisao-semanal-rotina-checklist
productPath: /
---

Para importar histórico de saúde, comece conferindo **de onde veio o arquivo, qual período ele contém e o que o aplicativo de destino reconheceu**. Antes de confirmar, compare datas, unidades e possíveis repetições com os registros de origem. Ter um arquivo disponível para exportação não significa que qualquer outro aplicativo consiga aproveitar tudo o que existe nele.

Esse cuidado ajuda a trazer anotações de sono e treino que você já fez, sem precisar redigitá-las nem transformar a mudança de ferramenta em uma tarefa interminável. Você também pode escolher deixar parte do histórico onde está. O objetivo desta conferência é saber o que entrará, o que ficará de fora e onde verificar o resultado.

## Prepare o arquivo sem perder a referência de origem

Guarde uma cópia do arquivo original antes de tentar adaptá-lo. Anote qual aplicativo o gerou e quando você fez a exportação. A data da exportação identifica a cópia; o período dos registros informa que parte da sua rotina ela contém. São referências diferentes.

No iPhone, o [manual da Apple para exportar dados do Saúde](https://support.apple.com/pt-br/guide/iphone/iph5ede58c3d/ios) orienta abrir **Saúde → Resumo → foto ou iniciais do perfil → Exportar Todos os Dados de Saúde** e escolher um método de compartilhamento. A documentação descreve a exportação em XML, um formato estruturado para compartilhar dados entre aplicativos. Esse procedimento exporta os dados; ele não cria, por si só, uma conexão contínua com outro serviço.

No Ascende, a opção de importação aceita o ZIP do export do Saúde e também o XML correspondente. Para aplicativos específicos, há leitura de CSVs compatíveis. O reconhecimento do CSV depende das colunas e do conteúdo, não apenas do nome do aplicativo ou da extensão do arquivo. Renomear um arquivo para terminar em `.csv` não muda seu formato.

Se o aplicativo de origem oferecer filtros de período ou categoria, confira o que você escolheu antes de exportar. Essa possibilidade depende da ferramenta de origem: o caminho de exportação total do Saúde descrito acima não deve ser confundido com um filtro de período.

## Veja quais dados a importação realmente aproveita

Um arquivo de saúde pode conter muito mais informação do que a tela de destino utiliza. Leia os tipos reconhecidos na prévia antes de interpretar a contagem como uma cópia integral do histórico.

No Ascende, a leitura do export do Saúde aproveita sono, treinos, peso e hidratação; quando disponível, o percentual de gordura acompanha o registro de peso. Isso não significa importar todas as categorias existentes no Saúde. Os CSVs seguem formatos reconhecidos de sono, treino, pesagens ou alimentação. Um CSV desconhecido precisa ser identificado como tal, em vez de ser tratado como histórico já gravado.

A unidade da contagem também merece atenção. Uma linha do arquivo pode representar um trecho de sono ou parte de um treino. No Ascende, o export do Saúde é agrupado em registros por tipo e dia: vários trechos podem compor uma noite; vários treinos no mesmo dia podem compor um registro diário com duração somada. Para peso, a leitura mantém uma medição por dia, sem reproduzir todas as pesagens daquele dia. A quantidade de linhas lidas e a quantidade de registros reconhecidos, portanto, podem ser diferentes sem que isso prove perda de dados.

Essa organização serve a uma visão da rotina. Se você precisa preservar cada série, intervalo, estágio de sono ou outro detalhe, mantenha o arquivo original e o aplicativo que mostra essa informação. Importar um resumo diário não equivale a reproduzir cada tela da ferramenta de origem.

## Confira datas e unidades antes de selecionar

Escolha registros cujo contexto você consiga conferir no aplicativo de origem. Procure um dia de treino conhecido e uma noite de sono que atravesse a meia-noite, se houver. Compare o dia atribuído, a duração e a descrição. Essa é uma conferência de transcrição e organização, sem interpretar o resultado como avaliação de saúde.

Use estas perguntas na prévia:

- O intervalo reconhecido corresponde ao período que você pretendia trazer?
- A duração aparece em horas ou minutos? Ela corresponde ao valor de origem depois dessa conversão?
- O sono está associado ao dia em que terminou ou ao dia em que começou?
- O registro representa uma sessão isolada ou um agrupamento do dia?
- Algum aviso aponta linhas que não puderam ser lidas ou um período que ficou de fora?

![Quatro conferências antes de importar: origem e período, datas e unidades, agrupamentos e possíveis repetições.](./conferir-antes-importar.png "Compare a prévia com a origem e deixe registros duvidosos fora da seleção. Crédito: Ascende.")

No Ascende, o histórico importado mantém a referência de data dos registros, em vez de receber a data de hoje. Há regras de agrupamento para as noites e os dias de treino. Os horários são normalizados para o fuso usado pelo aplicativo, UTC−03:00; por isso, não se deve tratar a importação como preservação integral dos horários e fusos originais. Redobre a conferência em registros de viagens e em noites com horários incomuns.

No export do Saúde, o Ascende usa os trechos identificados como sono para compor a duração. Quando uma noite só tem informação de tempo na cama, essa informação pode ser aproveitada e aparece identificada no resumo. Tempo na cama e tempo dormido não devem ser lidos como a mesma medida. Confira o rótulo antes de comparar os totais.

Se um valor parecer incompatível com o registro de origem, deixe-o desmarcado enquanto investiga. Não é necessário confirmar um lote inteiro para aproveitar apenas a parte que você conseguiu verificar.

## Como evitar duplicatas ao importar dados de saúde?

O [guia da Apple sobre gestão dos dados de saúde](https://support.apple.com/pt-br/108779) explica que o Saúde reúne informações de várias fontes e permite definir prioridades entre elas. Para conferir uma categoria no iPhone, o caminho descrito passa por **Explorar → categoria → subcategoria → Fontes de Dados e Acesso**. Ter várias fontes para o mesmo tipo de dado é um motivo para conferir a origem dos totais.

Não presuma que outro aplicativo repetirá a mesma regra de prioridade. Se o total de uma noite diferir entre a origem e a prévia, investigue antes de importar: há registros sobrepostos? A tela de origem prioriza uma fonte? O destino agrupa os dados de outro modo?

No Ascende, trechos de sono sobrepostos de diferentes origens podem ser somados na leitura; não há garantia de reproduzir a prioridade adotada pelo Saúde. A diferença precisa ser compreendida; escolher o total maior não resolve essa dúvida.

No Ascende, a revisão tenta identificar registros que já existem. Ao reenviar o mesmo arquivo, a conferência usa a trilha daquela importação; para um arquivo novo, compara tipos e dias com o histórico. Os registros identificados como já existentes vêm desmarcados. Essa sinalização pede revisão, porque o mesmo dia pode conter informações de origens diferentes.

Se aparecer o aviso de que não foi possível conferir o histórico, os itens podem vir todos marcados. **Falha na conferência não significa ausência de repetição.** Nesse caso, revise a seleção antes de confirmar, especialmente se aquele período já foi importado. Reenviar um arquivo não deve ser a primeira resposta a uma contagem que você ainda não entendeu.

## Entenda o que permanece no aparelho e o que será gravado

No Ascende, o ZIP, o XML e o CSV são lidos no próprio aparelho, sem usar IA para interpretar o arquivo nessa etapa. O arquivo original não é enviado ao servidor pelo fluxo de importação. Depois da sua confirmação, porém, **os registros selecionados são enviados para ficar salvos na sua conta**, junto com informações da importação e seu recibo. “Leitura local” não quer dizer que os registros confirmados ficarão apenas no aparelho.

Esse procedimento é manual. Ele não conecta o Ascende continuamente ao Saúde, ao relógio ou à conta de outro aplicativo. Novos dados na origem não entram automaticamente por você ter importado uma cópia anterior. O tratamento dos registros salvos deve ser consultado na [Política de Privacidade do Ascende](/privacidade).

Para decidir sobre acessos contínuos, câmera, microfone e outras autorizações, veja também o roteiro de [permissões de aplicativos de saúde e finanças](/blog/permissoes-apps-saude-financas/). Aqui, a decisão é outra: escolher um arquivo e revisar quais registros dele você quer gravar.

## Confirme a seleção e depois leia o recibo

No Ascende, abra **Ajustes → Seus dados → Importar dados de saúde**, escolha o arquivo e aguarde a prévia. Confira os tipos reconhecidos, o período e os avisos; depois marque apenas o que quer trazer e use o botão de importação dos selecionados. Escolher o arquivo e confirmar a gravação são etapas distintas.

Ao terminar, confira a mensagem de resultado e a seção **Fontes e importações**, também em Ajustes. O recibo distingue o que foi aceito, o que foi tratado como repetido e o que ficou de fora da seleção, além dos avisos da leitura. Se a confirmação não gravou novos registros, essa informação merece ser lida antes de começar outra tentativa.

![Quatro etapas da importação manual: escolher o arquivo, revisar a seleção, confirmar a gravação e conferir o recibo.](./arquivo-selecao-recibo.png "A leitura acontece no aparelho; os registros confirmados são enviados para salvar na conta. Crédito: Ascende.")

A quantidade que você selecionou não deve ser tomada como prova do que ficou salvo. Compare-a com o resultado e confira os registros correspondentes no histórico. Se a gravação falhar ou ficar incompleta, siga o aviso apresentado; antes de uma nova tentativa, reveja o recibo disponível e a seleção.

Também há diferença entre remover a trilha de uma importação e apagar os registros: no Ascende, remover uma fonte da lista não exclui automaticamente os registros que ela trouxe. Leia a confirmação da ação para escolher o que corresponde à sua intenção.

## Use o histórico para a pergunta que você tem agora

Trazer dados antigos pode servir para situar uma semana ou evitar recomeçar um registro do zero. Não é preciso interpretar cada variação nem preencher cada ausência. Uma lacuna pode significar que você não registrou aquele dia, que a origem não o exportou ou que a leitura não o reconheceu; ela não conta, sozinha, o que aconteceu na sua vida.

Nosso guia de [registro de hábitos e consistência](/blog/registro-de-habitos-consistencia/) ajuda a escolher o que vale acompanhar daqui para a frente. Para organizar o uso dessas anotações, o [checklist de revisão semanal](/blog/revisao-semanal-rotina-checklist/) parte do que aconteceu e do que cabe na próxima semana.

Se quiser trazer um arquivo compatível para o [Ascende](/), a importação manual em Ajustes permite revisar os registros antes de gravá-los e consultar o recibo depois.

## Perguntas frequentes

### Exportar os dados do app Saúde cria uma conexão contínua com outro aplicativo?

Não. O manual da Apple descreve a exportação em XML, e esse procedimento exporta os dados; ele não cria, por si só, uma conexão contínua com outro serviço.

### Renomear o arquivo para .csv faz o aplicativo reconhecê-lo?

Não. Renomear um arquivo para terminar em .csv não muda seu formato; depois da importação, confira o que o aplicativo de destino de fato reconheceu.

### Tempo na cama é o mesmo que tempo dormido?

Não. Tempo na cama e tempo dormido não devem ser lidos como a mesma medida; confira o rótulo antes de comparar os totais.

### Um dia sem dados no histórico importado significa que nada aconteceu?

Não necessariamente. Uma lacuna pode significar que você não registrou aquele dia, que a origem não o exportou ou que a leitura não o reconheceu; ela não conta, sozinha, o que aconteceu na sua vida.
