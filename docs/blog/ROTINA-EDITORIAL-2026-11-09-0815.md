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

## Retomada em 09/11/2026, rodada das 12h BRT

- Mesmo artigo da manhã, não pauta adicional. O pacote persistido de texto/imagens foi recuperado; a integração perdida foi reconstruída sobre clone limpo da main, após pull --ff-only. HEAD-base `8df36906dd4a1d5c4d57b317d75baf0d215274b2`. Reserva concorrente Claude de Pix Automático preservada, sem colisão.
- Nova revisão independente abriu Inmetro e IPEM-PR, conferiu cálculos, corpo e pixels das quatro imagens. GO do conteúdo e do diff exato. SHA-256 do Markdown final: `7fab5ced65130a007e0510d34c8b6a48770c29d81286c01c7ba1eba964191132`. Nenhuma revisão humana ou profissional atribuída a Henrique.
- Testes desta integração: build, typecheck, blog:check (57 artigos), suíte completa de 1.173 testes/53 arquivos e lint com exit 0. Sete warnings preexistentes de lint preservados. Canonical, H1 único, byline Henrique Pett, BlogPosting/FAQPage/BreadcrumbList, sitemap, alt/srcset e destinos locais conferidos.
- Gate visual antes bloqueado foi concluído em navegador da nuvem por prévia HTTP local alcançável: desktop 1.180 px e viewport responsivo 376 × 505 CSS px, usando redimensionamento normal de janela e zoom. Cabeçalho, texto, ambas as figuras, legendas, fontes e rodapé inspecionados; imagens carregadas e nenhuma largura excedente. Não foi emulação de hardware móvel. Não houve acesso ao Mac nem uso de file:// ou alteração de políticas do navegador.
- Fetch anterior ao envio confirmou mains preservadas. Este registro documenta o candidato revisado; push, CI remota deste commit e URL pública serão conferidos separadamente. Nenhuma garantia de indexação ou posição.
- CI da base desta retomada `8df3690`: run https://github.com/HenriPett/ascende/actions/runs/42641556421 confirmou verify aprovado e Social/RLS reprovado em 1/57, teste estrutural 21 do canal do sino. O próprio log distingue essa falha de vazamento e aponta tempo real não funcionando. Backend/segurança não foram alterados neste diff editorial; isso não comprova estado de produção nem CI verde. CI do commit a enviar segue pendente.
- O último fetch detectou a integração concorrente de Pix Automático na main. Integração reaplicada em worktree limpo sobre `e119e54e3ff403c4f90f907b61e324454339bf67`, preservando todos os arquivos de Claude; índice regenerado. Candidato baseado na main anterior não foi enviado à branch.
- Validação final sobre a main atual: blog:check com 58 artigos, build, typecheck, 1.173 testes em 53 arquivos e lint exit 0 (sete warnings preexistentes) novamente aprovados. HTML do artigo idêntico ao QA anterior, SHA-256 `c773024a4022d130da570c86140b9e91f0fd07fb62291ba522d8871c917107b2`. Diff final independente GO, sem remover o artigo concorrente.

## Estado: publicado e conferido — 09/11/2026, 12h41 BRT

- Commit editorial `8e9e34e014106c63b8cc77cfb8433d0af8acda79` confirmado na main por novo fetch. Integração concorrente de Pix Automático preservada. Os oito arquivos do commit são exclusivamente artigo, quatro imagens, índice, relacionamento editorial e este registro.
- URL pública https://ascende.site/blog/restaurante-quilo-tara-peso-prato/ retornou HTTP 200. Em 09/11/2026 às 15:41 UTC, HTML público idêntico à build validada (SHA-256 `c773024a4022d130da570c86140b9e91f0fd07fb62291ba522d8871c917107b2`), quatro PNGs públicos HTTP 200 com bytes idênticos aos originais, sitemap HTTP 200 incluindo a URL, canonical correto, autoria Person Henrique Pett e ausência de noindex. Isso comprova o conteúdo observado, sem afirmar um SHA global do deploy.
- CI desse commit: https://github.com/HenriPett/ascende/actions/runs/42646910155 . Verify passou. Social/RLS falhou em 1/57, teste estrutural 21 do canal do sino. O log caracteriza essa falha como tempo real não funcionando e não vazamento; não é prova geral de segurança de produção. Workflow como um todo não está verde. A falha já ocorre na base e é externa ao diff editorial.
- Estado da pauta: publicada nesta retomada, não duplicar em outra rodada. Sem garantia de indexação, recomendação por IA, posição ou clientes.
