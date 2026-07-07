// Documentos legais do Ascend, renderizados em /privacidade, /termos e /aviso-legal.
// Última revisão do conteúdo: 07/07/2026. Ao alterar, atualize LEGAL_VERSION —
// ela é gravada no aceite de cada cadastro (auditoria de consentimento).

export const LEGAL_VERSION = "2026-07-07";

export const PRIVACIDADE = `
# Política de Privacidade e Proteção de Dados Pessoais

Em conformidade com a Lei Geral de Proteção de Dados Pessoais — LGPD (Lei nº 13.709/2018)

**Última atualização: 07 de julho de 2026**

## Identificação da Controladora

Henrique Nass Pett, pessoa jurídica de direito privado, inscrita no CNPJ sob n. 43.609.432/0001-07, com sede em Rua Angelo Torinelli, 53, Sala 01, Vila Nova, Jaraguá do Sul – SC, CEP 89259-200, detentora da plataforma Ascend, doravante denominada "ASCEND".

A pessoa física devidamente cadastrada, doravante denominada "USUÁRIO", declara ciência e aceite do presente instrumento ao realizar o cadastro na plataforma Ascend.

## 1. Da Natureza da Plataforma e do Uso das Informações

O Ascend é uma plataforma de organização de qualidade de vida que reúne, em um só lugar, registros de finanças pessoais, corpo, alimentação e mente, com apoio de um assistente de inteligência artificial (o "Conselheiro"). O tratamento de dados pessoais é regido pela LGPD e limitado ao mínimo necessário, pertinente e proporcional às seguintes finalidades:

- Criar e gerenciar a conta, identificar o USUÁRIO e permitir o acesso às áreas restritas;
- Registrar e organizar as informações que o próprio USUÁRIO insere (transações, refeições, hidratação, peso, treinos, sono, humor, diário, hábitos e demais registros);
- Gerar as funcionalidades centrais da plataforma: retrato consolidado, respostas do Conselheiro, briefings, estimativas por foto, gráficos, planos personalizados e sistema de progresso (XP e níveis);
- Prestar suporte, resolver dificuldades técnicas e melhorar continuamente o serviço;
- Prevenir fraudes, abusos e violações às Políticas e Termos de Uso;
- Cumprir obrigações legais e regulatórias.

O Ascend **não vende dados pessoais, não exibe publicidade e não usa os dados do USUÁRIO para fins de marketing de terceiros**.

### Bases legais do tratamento

- **Execução de contrato** (art. 7º, V, da LGPD): dados cadastrais, de perfil, registros e conteúdo de interação, necessários para prestar o serviço contratado;
- **Consentimento** (art. 7º, I, e art. 11, I): dados pessoais sensíveis fornecidos voluntariamente pelo USUÁRIO;
- **Legítimo interesse** (art. 7º, IX): segurança da plataforma, prevenção a fraudes e abusos, e melhoria do serviço por meio de métricas de uso e desempenho;
- **Cumprimento de obrigação legal ou regulatória** (art. 7º, II): guarda de registros de acesso e atendimento a autoridades.

## 2. Das Informações Coletadas e Tratadas

| Tipo de dado | Exemplos | Finalidade |
| --- | --- | --- |
| Cadastrais | Nome, e-mail e senha de acesso | Criar a conta, autenticar e comunicar assuntos do serviço |
| Perfil | Objetivo declarado, renda e orçamento mensais, ano de nascimento, sexo, altura, nível de atividade, restrições alimentares, metas | Personalizar respostas, gráficos e planos do Conselheiro |
| Registros de vida | Transações, refeições, água, peso, treinos, sono e sonecas, hábitos, humor, gratidão, entradas de diário, batalhas pessoais | Compor a linha do tempo, os indicadores e o retrato usado pela IA |
| Dados sensíveis (art. 11 da LGPD) | Condições de saúde, medicamentos em uso, prática religiosa/espiritual, estados emocionais, estimativas de composição corporal | Adequar as sugestões do Conselheiro à realidade do USUÁRIO, mediante consentimento específico (ver Seção 3) |
| Conteúdo de interação | Mensagens do chat com o Conselheiro, arquivos anexados, planos salvos | Prestar o serviço de assistente e manter o histórico acessível ao USUÁRIO |
| Fotos enviadas para análise | Fotos de refeições e de corpo inteiro | Gerar estimativas (calorias; composição corporal). **Não são mantidas pela ASCEND após o processamento**: são utilizadas transitoriamente para a análise e apenas o resultado confirmado pelo USUÁRIO é salvo |
| Identificação digital (automática) | Endereço IP, dispositivo, sistema, registros de acesso | Segurança, prevenção a fraudes e cumprimento do Marco Civil da Internet |
| Dados anonimizados | Estatísticas sem identificação do titular | Estudos e melhoria do serviço, sem possibilidade razoável de reidentificação (art. 5º, XI, da LGPD) |

## 3. Dos Dados Pessoais Sensíveis

Parte das funcionalidades do Ascend depende de dados classificados como sensíveis pela LGPD (saúde, convicção religiosa, dados relativos ao estado emocional). Sobre eles:

- São fornecidos **voluntariamente** pelo USUÁRIO, nos campos e telas destinados a isso, e o serviço funciona mesmo sem o preenchimento (com personalização reduzida);
- O tratamento tem como base legal o **consentimento específico e destacado** do titular (art. 11, I, da LGPD). Esse consentimento é manifestado de forma específica **no exato momento em que o USUÁRIO opta por fornecer cada informação sensível**, nos campos e telas destinados a isso, além do aceite destacado desta Política no cadastro;
- São usados exclusivamente para personalizar a experiência do próprio USUÁRIO — nunca para discriminação, publicidade ou compartilhamento comercial;
- Podem ser corrigidos ou apagados a qualquer momento pelo USUÁRIO, nas próprias telas da plataforma;
- A revogação do consentimento pode ser feita a qualquer momento, com a exclusão dos dados correspondentes ou da conta.

## 4. Do Processamento por Inteligência Artificial

Para gerar as respostas do Conselheiro, briefings, extração de registros a partir de texto e estimativas por foto, o Ascend envia as informações necessárias (retrato do perfil, registros recentes, mensagens e fotos) para processamento pela API da Anthropic, fornecedora do modelo de linguagem, cujos servidores podem estar localizados fora do Brasil.

- A transferência internacional observa o art. 33 da LGPD, com salvaguardas contratuais compatíveis com a legislação brasileira;
- Conforme os termos comerciais da API utilizados, os dados enviados **não são utilizados para treinamento dos modelos** da fornecedora;
- As fotos enviadas para análise não são armazenadas nem pelo Ascend nem retidas para treinamento; o processamento é transitório;
- A transferência internacional de dados também pode ocorrer por meio da Supabase (banco de dados e autenticação) e da Netlify (hospedagem), cujos servidores podem estar localizados fora do Brasil, sempre com salvaguardas contratuais compatíveis com o art. 33 da LGPD;
- O conteúdo gerado pelo Conselheiro tem caráter exclusivamente informativo, educativo e organizacional, e **não substitui médicos, nutricionistas, psicólogos, educadores físicos ou outros profissionais habilitados**, conforme detalhado nos Termos de Uso e no Aviso Legal.

## 5. Do Compartilhamento de Informações

O Ascend somente compartilha dados pessoais nas seguintes hipóteses:

- **Operadores de infraestrutura** (Supabase, Netlify, Anthropic), estritamente para viabilizar o funcionamento descrito nesta Política, sob instruções da ASCEND;
- **Autoridades competentes**, mediante requisição, requerimento ou ordem judicial, ou para prevenção e combate a fraudes e ilícitos;
- **Transferência de ativos**: em caso de reorganização societária ou venda, os dados poderão ser transferidos ao sucessor, mantidas as garantias desta Política;
- **Com autorização específica do USUÁRIO**, nos demais casos.

Senhas nunca são compartilhadas nem são legíveis pela ASCEND: são armazenadas exclusivamente na forma de hash criptográfico seguro, tecnologia que impede a recuperação do valor original. Internamente, o acesso a dados é restrito, registrado e limitado ao estritamente necessário.

## 6. De Cookies, Tokens e Tecnologias de Autenticação

O Ascend não utiliza cookies de publicidade nem rastreadores de marketing de terceiros. São utilizados apenas:

- **Tokens de autenticação** (armazenados localmente no dispositivo do USUÁRIO), essenciais para manter a sessão ativa e segura;
- **Preferências locais** (como o tema claro/escuro), guardadas no próprio dispositivo;
- **Registros técnicos de acesso**, exigidos pelo Marco Civil da Internet e usados para segurança.

O USUÁRIO pode limpar esses dados no navegador ou dispositivo a qualquer momento, com possível necessidade de novo login.

## 7. Da Segurança

A ASCEND adota medidas técnicas e administrativas de segurança, incluindo: isolamento de dados por usuário no banco (políticas de acesso em nível de linha), criptografia em trânsito (TLS) e em repouso, validação de identidade em todas as chamadas de servidor, limitação de taxa contra abuso, e não armazenamento de fotos analisadas. Em caso de incidente de segurança que possa acarretar risco ou dano relevante aos titulares, o USUÁRIO e a ANPD serão comunicados sempre que exigido pela LGPD, nos termos do seu art. 48.

## 8. Do Controle de Dados pelo Usuário (Direitos do Titular)

O USUÁRIO pode, a qualquer momento, diretamente na plataforma ou pelo canal de atendimento:

- Obter a **confirmação da existência de tratamento** e o **acesso** aos seus dados;
- **Corrigir** dados incompletos, inexatos ou desatualizados (as telas da plataforma permitem editar e excluir registros individualmente);
- Solicitar **anonimização, bloqueio ou eliminação** de dados desnecessários, excessivos ou tratados em desconformidade;
- Solicitar a **portabilidade** dos dados a outro fornecedor;
- **Eliminar** os dados tratados com base em consentimento, inclusive pela **exclusão da conta** (ver Seção 9 sobre a forma e os prazos da eliminação);
- Obter **informação sobre os compartilhamentos** realizados e sobre a **possibilidade de não consentir** e suas consequências;
- **Revogar consentimentos** a qualquer momento, inclusive sobre dados sensíveis;
- Solicitar a **revisão de decisões tomadas unicamente com base em tratamento automatizado** que afetem seus interesses (art. 20 da LGPD);
- **Peticionar** perante a ANPD em relação aos seus dados.

## 9. Do Término do Tratamento e Prazos de Retenção

- **Dados da conta e registros**: mantidos enquanto a conta estiver ativa. Com a exclusão da conta, são eliminados dos sistemas ativos e removidos das cópias de segurança (backups) nos ciclos técnicos de expiração destas, em prazo razoável, ressalvadas as retenções legais desta Seção;
- **Registros de acesso** (dados de identificação digital): guardados por 6 (seis) meses, nos termos do art. 15 do Marco Civil da Internet (Lei nº 12.965/14);
- **Registros necessários ao cumprimento de obrigação legal ou ao exercício regular de direitos** (ex.: registro de aceite destes termos): mantidos pelos prazos prescricionais aplicáveis, em regra de até 5 (cinco) anos, podendo ser conservados por prazo superior quando necessários à defesa em processos judiciais, administrativos ou arbitrais em curso, até seu encerramento definitivo;
- Após os prazos, os dados são eliminados com métodos de descarte seguro, podendo subsistir apenas de forma anonimizada para fins estatísticos.

## 10. Das Disposições Gerais

O Ascend é destinado exclusivamente a maiores de 18 (dezoito) anos e não coleta intencionalmente dados de crianças ou adolescentes. Identificada a hipótese, os dados serão eliminados.

Esta Política pode ser alterada para refletir evoluções do serviço ou da legislação. Toda alteração relevante resultará em **nova data de versão** no topo deste documento e será comunicada com destaque, podendo o USUÁRIO analisá-la antes de continuar usando o serviço. Quando a alteração exigir novo consentimento, ele será solicitado.

A ASCEND mantém **Encarregado pelo Tratamento de Dados Pessoais (DPO)** designado, nos termos do art. 41 da LGPD. Dúvidas, solicitações e exercício de direitos podem ser dirigidos ao Encarregado pelo canal de atendimento disponível na plataforma, que mantém publicadas as informações de contato atualizadas.
`;

export const TERMOS = `
# Termos e Condições de Uso

Plataforma Ascend — organização de qualidade de vida com apoio de inteligência artificial

**Última atualização: 07 de julho de 2026**

## Sobre a Plataforma

O Ascend é uma plataforma que ajuda o USUÁRIO a organizar e acompanhar as áreas centrais da vida — finanças pessoais, corpo, alimentação e mente — por meio de registros, gráficos, um assistente de inteligência artificial (o "Conselheiro") e um sistema de progresso (XP, níveis e títulos).

A empresa Henrique Nass Pett, pessoa jurídica de direito privado, CNPJ n. 43.609.432/0001-07, com sede em Rua Angelo Torinelli, 53, Sala 01, Vila Nova, Jaraguá do Sul – SC, CEP 89259-200, é a detentora e operadora da plataforma Ascend, doravante denominada "ASCEND".

A pessoa física devidamente cadastrada, doravante denominada "USUÁRIO", declara ciência e aceite das condições abaixo ao confirmar o cadastro.

## 1. Das Regras Importantes

- A plataforma é exclusiva para **pessoas físicas maiores de 18 (dezoito) anos**;
- O Ascend **não é um serviço de saúde**: não substitui médicos, nutricionistas, psicólogos, educadores físicos ou qualquer profissional habilitado, não realiza diagnósticos e não prescreve tratamentos, dietas clínicas ou medicamentos;
- O Ascend **não é uma instituição financeira** nem assessoria de investimentos: não intermedeia valores, não oferece produtos financeiros e não recomenda compra ou venda de ativos;
- O Conselheiro é uma **inteligência artificial**: seu conteúdo tem caráter educativo e organizacional, **pode conter erros ou imprecisões**, e deve ser avaliado criticamente pelo USUÁRIO. Decisões relevantes de saúde, alimentação, treino ou dinheiro devem ser validadas com profissionais habilitados;
- As estimativas geradas por foto (calorias e composição corporal) são **aproximações com margem de erro**, não medições clínicas;
- Em situações de emergência ou sofrimento intenso, procure ajuda imediata: **CVV 188** (24h), **SAMU 192** ou o serviço de saúde mais próximo. A plataforma não é canal de emergência.

## 2. Do Funcionamento da Plataforma

### 2.1 Da Conta

Cada pessoa pode manter uma única conta, pessoal e intransferível. Para criá-la são solicitados nome, e-mail e senha. O USUÁRIO é responsável pela guarda das credenciais e por toda atividade realizada na conta. É vedado ceder, alugar ou compartilhar a conta.

A legitimidade e a veracidade das informações inseridas são de responsabilidade do USUÁRIO, a quem cabe também manter seus dados de cadastro atualizados. A ASCEND poderá suspender ou encerrar contas em caso de falsidade, fraude ou violação destes Termos.

### 2.2 Dos Serviços Disponibilizados

- Registro e organização de transações financeiras, refeições, hidratação, peso, treinos, sono, hábitos, humor, gratidão, diário e batalhas pessoais;
- Estimativa de calorias por foto ou descrição e estimativa de composição corporal por foto, sempre mediante confirmação do USUÁRIO antes de qualquer gravação;
- Conselheiro (chat com IA) com visão consolidada dos registros, aceitando texto, voz e anexos;
- Planos personalizados (alimentar, treino, financeiro, rotina) gerados pelo Conselheiro e salvos pelo USUÁRIO na área "Meus planos";
- Briefings, gráficos, relatórios e sistema de progresso (XP, níveis e títulos).

Para operar a plataforma, a ASCEND utiliza prestadores de serviço terceirizados (infraestrutura em nuvem, autenticação, hospedagem e processamento de inteligência artificial), conforme detalhado na Política de Privacidade. A ASCEND poderá ainda substituir modelos de inteligência artificial, provedores tecnológicos, algoritmos ou infraestrutura sempre que necessário para manter, aprimorar ou viabilizar o funcionamento da plataforma, preservadas as funcionalidades essenciais do serviço.

A ASCEND poderá estabelecer e ajustar **limites técnicos de uso** (como quantidade de mensagens, análises por foto, anexos e tamanho de arquivos) para garantir a estabilidade, a segurança e a viabilidade do serviço. As funcionalidades disponíveis podem variar conforme a versão da plataforma (gratuita, eventuais planos pagos ou versões de teste). A plataforma também coleta métricas de uso e desempenho para melhoria do serviço, conforme descrito na Política de Privacidade.

A ASCEND poderá adicionar, alterar ou descontinuar funcionalidades, comunicando os USUÁRIOS em caso de mudanças relevantes. Caso venham a existir planos pagos, suas condições serão exibidas de forma clara antes de qualquer contratação.

### 2.3 Do Sistema de Progresso (XP e Níveis)

Os pontos de experiência (XP), níveis, títulos e demais elementos de gamificação **não possuem valor monetário**, não são conversíveis em dinheiro, bens ou serviços, não são transferíveis e podem ser alterados, recalibrados, redefinidos ou removidos pela ASCEND para manter o equilíbrio do sistema, sem que isso gere qualquer direito adquirido ao USUÁRIO.

### 2.4 Do Conteúdo Gerado por Inteligência Artificial

O USUÁRIO reconhece que os textos do Conselheiro, briefings, estimativas e planos são gerados por modelo de inteligência artificial a partir das informações fornecidas, e que:

- Podem conter erros, imprecisões ou omissões, mesmo quando redigidos de forma assertiva, inclusive em decorrência de informações incompletas, incorretas ou desatualizadas fornecidas pelo próprio USUÁRIO;
- Não constituem ato profissional regulamentado (médico, nutricional, psicológico, de educação física ou de assessoria de investimentos);
- A aplicação de qualquer sugestão é decisão exclusiva do USUÁRIO.

## 3. Do Conteúdo e Conduta do Usuário

O USUÁRIO é integralmente responsável pelas informações que insere. Não são permitidos:

- Uso da plataforma para atividades ilícitas, fraudulentas ou contrárias à ordem pública;
- Inserção de dados falsos ou de terceiros sem autorização;
- Envio de conteúdo ilícito por meio de anexos ou fotos;
- Tentativas de acesso não autorizado à infraestrutura, a contas de terceiros ou de burla aos mecanismos de segurança e limites de uso;
- Uso automatizado abusivo (bots, scraping) ou revenda do serviço;
- Engenharia reversa, descompilação, tentativa de copiar o funcionamento interno da plataforma ou de explorar vulnerabilidades e mecanismos de segurança;
- Utilização da plataforma ou do conteúdo por ela gerado para desenvolver ou treinar outros sistemas de inteligência artificial.

O USUÁRIO concede à ASCEND licença limitada, não exclusiva e revogável para processar o conteúdo que inserir, exclusivamente na medida necessária para operar as funcionalidades descritas (incluindo o processamento por IA descrito na Política de Privacidade).

A ASCEND poderá suspender preventivamente contas para investigação, em casos de fraude, abuso ou suspeita fundada de violação, e encerrar o acesso em caso de violação confirmada destes Termos ou da lei, comunicando o USUÁRIO pelos meios disponíveis.

## 4. Do Cancelamento e Encerramento

O USUÁRIO pode parar de usar a plataforma e solicitar a exclusão definitiva da conta a qualquer momento, pelas configurações ou pelo canal de atendimento. A exclusão elimina ou anonimiza os dados vinculados nos sistemas ativos, com remoção das cópias de segurança nos ciclos técnicos de expiração, ressalvados backups em processamento e as retenções legais descritas na Política de Privacidade.

## 5. Da Propriedade Intelectual

Marca, logotipo, identidade visual, interface, textos da plataforma, software e metodologia são de propriedade da ASCEND ou de seus licenciadores. É vedada a reprodução, cópia ou criação de trabalhos derivados sem autorização prévia e por escrito. Os planos e registros do USUÁRIO são de uso pessoal dele.

## 6. Da Limitação de Responsabilidade

Aplicam-se as limitações detalhadas no Aviso Legal, que integra estes Termos. Em síntese, observados os limites da legislação aplicável, a ASCEND não responde por decisões tomadas pelo USUÁRIO com base no conteúdo da plataforma, pela veracidade das informações por ele inseridas, por indisponibilidades temporárias (incluindo manutenções programadas, atualizações e melhorias, que não geram direito a indenização), nem por falhas de serviços de terceiros fora do seu controle.

A responsabilidade total da ASCEND por eventuais danos fica limitada à máxima extensão permitida pela legislação aplicável, sem prejuízo dos direitos indisponíveis do consumidor.

Constituem excludentes de responsabilidade os eventos de **caso fortuito ou força maior** (art. 393 do Código Civil), tais como apagões, falhas generalizadas de provedores de internet ou nuvem, ataques cibernéticos de grande escala, desastres naturais e atos governamentais que afetem o funcionamento do serviço.

Eventuais links, APIs ou integrações de terceiros disponibilizados na plataforma são de responsabilidade dos respectivos provedores e regidos por seus próprios termos e políticas.

## 7. Do Termo de Aceite

Ao marcar o aceite no cadastro, o USUÁRIO confirma que: leu e compreendeu estes Termos, a Política de Privacidade e o Aviso Legal; concorda com o tratamento de seus dados, inclusive os sensíveis que optar por fornecer, nos termos da LGPD; declara ser maior de 18 anos; e está ciente de que violações podem levar ao encerramento do acesso.

As comunicações oficiais da ASCEND poderão ser realizadas por e-mail cadastrado, notificações dentro da plataforma ou outro canal informado pelo USUÁRIO.

Se qualquer disposição destes Termos for considerada inválida ou inexequível, as demais permanecerão em pleno vigor (independência das disposições).

Estes Termos podem ser alterados com comunicação prévia. O uso continuado após a comunicação implica aceitação. Fica eleito o foro da comarca de Jaraguá do Sul – SC, **ressalvadas as hipóteses de competência obrigatória previstas na legislação aplicável**, em especial o foro do domicílio do consumidor.
`;

export const AVISO_LEGAL = `
# Aviso Legal e Termo de Isenção de Responsabilidade

Plataforma Ascend

**Última atualização: 07 de julho de 2026**

Este documento estabelece os limites de responsabilidade da plataforma Ascend e a natureza dos serviços prestados. Ao utilizar a plataforma, o USUÁRIO declara tê-lo lido e compreendido integralmente.

## Identificação da Empresa

Henrique Nass Pett, pessoa jurídica de direito privado, inscrita no CNPJ sob n. 43.609.432/0001-07, com sede em Rua Angelo Torinelli, 53, Sala 01, Vila Nova, Jaraguá do Sul – SC, CEP 89259-200, detentora da plataforma Ascend, doravante denominada "ASCEND".

## 1. Da Natureza dos Serviços

O Ascend é uma ferramenta de **organização pessoal e educação em qualidade de vida**, com registros, indicadores e um assistente de inteligência artificial. O Ascend **não é e não deve ser confundido com**:

- Serviço de saúde, clínica, consultório ou dispositivo médico;
- Profissional de medicina, nutrição, psicologia, psiquiatria ou educação física, nem substituto de qualquer deles;
- Instituição financeira autorizada pelo Banco Central do Brasil (BACEN);
- Assessoria ou consultoria de investimentos registrada na Comissão de Valores Mobiliários (CVM);
- Plataforma de intermediação financeira, gestão de recursos ou fintech de pagamentos;
- Canal de emergência ou de atendimento a crises.

## 2. Do Conteúdo Gerado por Inteligência Artificial — Limites e Natureza

Todo o conteúdo do Conselheiro (respostas, briefings, estimativas, gráficos interpretativos e planos) é gerado por modelo de inteligência artificial e tem caráter **exclusivamente educativo, informativo e organizacional**. O USUÁRIO reconhece que:

- Modelos de linguagem possuem **limitações tecnológicas inerentes** e podem produzir informações incorretas, imprecisas ou desatualizadas, mesmo com aparência de precisão;
- A qualidade das respostas depende diretamente da qualidade das informações fornecidas pelo USUÁRIO: dados incompletos, incorretos ou desatualizados comprometem o resultado;
- A ASCEND **não realiza revisão humana prévia** das respostas produzidas pela IA antes de sua exibição, nem tem obrigação de fazê-lo;
- Estimativas por foto (calorias e composição corporal) têm **margem de erro relevante** e não equivalem a exames ou avaliações profissionais (como bioimpedância ou avaliação nutricional);
- Planos alimentares, de treino ou financeiros gerados pela plataforma são pontos de partida organizacionais e devem ser validados com profissionais habilitados, em especial na existência de qualquer condição de saúde;
- Nenhum conteúdo da plataforma constitui diagnóstico, prescrição, tratamento ou recomendação de investimento.

A plataforma **não realiza monitoramento em tempo real** nem acompanhamento contínuo da saúde ou da situação financeira do USUÁRIO: os briefings, alertas e análises são gerados a partir dos registros que o próprio USUÁRIO insere, quando ele acessa o serviço.

Caso o USUÁRIO perceba agravamento de sintomas físicos ou psicológicos, deve interromper a aplicação de qualquer sugestão da plataforma e procurar atendimento profissional.

**Em situações de emergência, risco à vida ou sofrimento emocional intenso, procure ajuda imediatamente: CVV 188 (24 horas, ligação gratuita), SAMU 192 ou o serviço de saúde mais próximo.**

## 3. Da Limitação de Responsabilidade

Observados os limites da legislação aplicável, a ASCEND **não será responsável pelos danos decorrentes das hipóteses abaixo, exceto quando comprovados dolo ou culpa de sua parte ou nas demais hipóteses previstas em lei**:

- **Decisões do USUÁRIO**: toda decisão de saúde, alimentação, exercício ou financeira tomada com base no conteúdo da plataforma é de exclusiva responsabilidade do USUÁRIO;
- **Informações inseridas**: a ASCEND não valida a veracidade dos dados fornecidos; informações incorretas comprometem a qualidade das respostas e estimativas;
- **Resultados**: a ASCEND não garante resultados específicos de saúde, estética, desempenho ou financeiros, ainda que as sugestões sejam seguidas integralmente;
- **Disponibilidade**: a plataforma pode sofrer manutenções programadas, atualizações de segurança, evoluções contínuas, falhas técnicas e interrupções por caso fortuito ou força maior (art. 393 do Código Civil), incluindo apagões, falhas generalizadas de provedores de internet ou de nuvem, ataques cibernéticos de grande escala, desastres naturais e atos governamentais;
- **Serviços de terceiros**: infraestrutura, hospedagem e processamento de IA são providos por terceiros (Supabase, Netlify, Anthropic); a ASCEND não responde por falhas desses serviços que não decorram de culpa sua na seleção ou fiscalização;
- **Credenciais comprometidas por culpa do USUÁRIO**;
- **Links, APIs e integrações de terceiros** eventualmente disponibilizados, que seguem os termos e políticas dos respectivos fornecedores.

O serviço é fornecido em **evolução contínua**, podendo sofrer atualizações, alterações, melhorias e substituições de tecnologia a qualquer tempo. A ASCEND poderá substituir modelos de inteligência artificial, provedores tecnológicos, algoritmos ou infraestrutura sempre que necessário para manter, aprimorar ou viabilizar o funcionamento da plataforma, sem vínculo com fornecedor específico, preservadas as funcionalidades essenciais do serviço.

Nenhuma funcionalidade da plataforma constitui promessa ou garantia de resultados futuros de qualquer natureza. A responsabilidade total da ASCEND por eventuais danos fica limitada à máxima extensão permitida pela legislação aplicável, sem prejuízo dos direitos indisponíveis do consumidor.

## 4. Das Responsabilidades do Usuário

- Fornecer informações verdadeiras e mantê-las atualizadas;
- Proteger suas credenciais de acesso;
- Buscar profissionais habilitados para decisões de saúde e financeiras relevantes;
- Usar a plataforma em conformidade com os Termos, a Política de Privacidade, este Aviso e a lei, respondendo, nos termos do art. 186 do Código Civil, por danos que causar.

## 5. Da Propriedade Intelectual

Todo o conteúdo da plataforma (marca, identidade visual, interface, software, metodologia) pertence à ASCEND ou a seus licenciadores, protegido pela legislação de propriedade intelectual. É vedada a reprodução sem autorização prévia e por escrito.

## 6. Da Legislação Aplicável e Foro

Este Aviso é regido pelas leis brasileiras. Controvérsias serão submetidas ao foro da comarca de Jaraguá do Sul – SC, **ressalvadas as hipóteses de competência obrigatória previstas na legislação aplicável**, em especial o foro do domicílio do consumidor.

Se qualquer disposição deste Aviso for considerada inválida ou inexequível, as demais permanecerão em pleno vigor.

O documento pode ser alterado com comunicação prévia; o uso continuado implica aceite.

## Declaração do Usuário

Ao confirmar o cadastro e marcar o aceite, o USUÁRIO declara que leu, compreendeu e concorda com este Aviso Legal, estando ciente de que: o conteúdo da plataforma é educativo e gerado por IA, podendo conter erros; a responsabilidade pelas decisões é exclusivamente sua; a limitação de responsabilidade da ASCEND observa os limites da legislação aplicável; e a plataforma não substitui profissionais de saúde nem presta serviços financeiros regulados.
`;