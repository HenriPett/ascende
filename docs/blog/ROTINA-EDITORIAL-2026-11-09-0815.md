# Rotina editorial Ascende — 09/11/2026, 08h15 BRT

## Estado: reservado

- Execução na nuvem do assistente. Checkout novo, limpo, `git pull --ff-only origin main` antes de alterações. HEAD-base: `edc70fa5a4c7ad1f14f9b79d2bd6e3c4d4cf6df5`.
- Pauta reservada: conferir tara, peso líquido e preço da refeição em restaurante por quilo, sem transformar peso em recomendação de porção.
- Intenção: como conferir o peso do prato e a tara no restaurante por quilo antes de pagar.
- Keyword principal: `restaurante por quilo tara`; secundárias: `peso do prato restaurante`, `preço restaurante por quilo`. Pesquisa qualitativa; sem dados medidos de volume ou posição.
- Slug: `restaurante-quilo-tara-peso-prato`. Cluster: `alimentacao-orcamento`.
- Distinta de comparação do preço por quilo de embalagens, taxa de serviço e custo da refeição caseira. Índice, artigos e reservas remotos conferidos antes da escolha.
- Fontes em verificação: Inmetro e Imetro-SC. Conteúdo, imagens, revisão independente e QA ainda pendentes. Este registro não afirma publicação.

## Estado: rascunho revisado — gate visual de página bloqueado

- Título: Restaurante por quilo: confira tara, peso e preço do prato. Keyword/intenção qualitativa; sem volume, posição ou tráfego medidos. Busca observou mistura de orientação ao consumidor e precificação para restaurantes; recorte do artigo é conferência da pesagem pelo cliente. A regra de tara vem da FAQ do Inmetro (atualizada em 08/01/2026) e da orientação do IPEM-PR, ambas lidas em 09/11/2026. A notícia Imetro-SC não abriu e foi excluída.
- Dois diagramas originais PNG, 720 px e variantes 360 px: tara/peso líquido e sequência de pesagem/conta; até 110 KB. Tipografia mínima de 25 px no arquivo de 720 px; crédito Ascende, sem ativos de terceiros nem preço real. Conteúdo visual também no corpo.
- Revisão independente de texto, fontes e imagens: GO em 09/11/2026 às 11:22 UTC. Markdown SHA-256 `765981a792fe5c37f2701aa9f818a349bae24c5819f20a4736d2fffac7a01f20`. Sem prescrição alimentar, promessa de resultado ou CTA de produto. Autoria do template: Por Henrique Pett, fundador do Ascende.
- Testes locais: `blog:indice` 56 artigos, `blog:check` aprovado; build aprovado; suíte completa 1.173/1.173 testes, 53 arquivos; typecheck e lint aprovados. Inclusão recíproca de related no artigo de taxa de serviço, sem redatá-lo.
- CI da reserva `7ba4317`: verify passou; Social/RLS falhou no teste das quatro revogações com usuários reais, fora do diff editorial. Workflow como um todo não está verde.
- Bloqueio de QA: navegador da nuvem não alcançou a prévia HTTP local; protocolo file não é permitido. Chromium local falhou ao iniciar por restrição operacional de socket. As imagens foram inspecionadas em 720/360, mas a página desktop/mobile não foi validada. Não liberar o artigo até concluir esse gate.
- Nenhum conteúdo do artigo foi enviado à main nesta execução. As reservas editoriais foram enviadas pelo conector autenticado; Git de terminal não possui credencial de escrita nesta sessão. O pacote de artigo, imagens e índice permanece preparado localmente. Publicação e indexação não afirmadas.
