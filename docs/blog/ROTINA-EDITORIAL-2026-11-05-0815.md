# Rotina editorial Ascende — 05/11/2026, 08h15 BRT

Estado inicial: **rascunho revisável; sem push, sem publicação**. Execução na nuvem, sem acesso a Mac ou Maestri.

- HEAD-base: `3bd401b0233300fa3c1a22a82e4b8da22fda4444` (`origin/main` após fetch). Checkout isolado `editorial-20261105-0815`.
- Intenção: comparar preço à vista e total parcelado, incluindo o calendário de vencimentos; keyword principal qualitativa `à vista ou parcelado`; apoio `total parcelado`, `preço à vista`, `parcelas no orçamento`. Sem alegação de volume, ranking ou tráfego. Diferente do post de compras parceladas, que acompanha compromissos já assumidos.
- URL planejada: `/blog/preco-a-vista-parcelado-total-compra/`. Pautas alheias de 04/11, inclusive 13º salário, preservadas.
- Fontes primárias consultadas em 05/11: Procon-SP, *Afixação de preços e fiscalização*, p. 2, sobre divulgação de preço e condições do parcelamento; Banco Central, *Caderno de Educação Financeira*, sobre planejamento e crédito. Links no frontmatter e próximos às afirmações. Exemplos e valores são fictícios.
- Imagens originais: duas composições tipográficas criadas por código para esta pauta, etiquetas de preço e agenda de seis meses, PNG 720×480 e 360×240, sem ativos de terceiros. Alt e créditos na legenda. Formatos diferentes dos fluxogramas recorrentes.
- Autoria exibida pelo template: Henrique Pett. Nenhuma credencial ou experiência atribuída.
- Verificação local: `npm run blog:indice`, `npm run blog:check` (48 posts), `npm run build`, `npx vitest run src/lib/blog` (106 testes) passaram. PNGs 360 inspecionados visualmente. HTML gerado contém canonical, metadados, dados estruturados, byline e imagens; sitemap local atualizado.
- Revisão independente inicial por agente Codex: GO após corrigir o alt da segunda imagem para descrever a nota realmente visível. Correção aplicada. Diff final ainda sujeito a conferência independente antes do push.
- Antes de publicar: buscar `origin/main` novamente, integrar apenas mudanças editoriais, repetir checks, push sem force e conferir CI e URL/imagens públicas. Nenhuma verificação remota desta nova página ainda é possível.

## Estado após envio — 05/11/2026, 08h34 BRT

- Revisão independente final: GO dos commits `0c409d3` e `558fde4`, após conferência de fontes, imagens e diff. `origin/main` ainda apontava para o HEAD-base; push sem force levou `558fde496a59eaea8164f3c855671fd915ae551e` à main, confirmado por `git ls-remote`.
- Testes finais: `blog:check` 48 posts, build, 106 testes Vitest. Render local em 390 e 1280 px: H1, canonical, byline, duas imagens carregadas após rolagem e sem overflow horizontal.
- CI do commit `558fde4`, run `42019650653`: `verify` success; `Privacidade do Social (RLS com usuários de verdade)` failure no passo “As quatro revogações, com três pessoas de verdade”, falha já observada em commits anteriores sem alteração de código nesta rodada.
- URL planejada: `https://ascende.site/blog/preco-a-vista-parcelado-total-compra/`. Estado **enviado à main, publicação pública não confirmada**: GET direto da página e dos PNGs bloqueado pelo proxy do ambiente (CONNECT 403); ferramenta web também não conseguiu abrir página nem sitemap. Não atribuir HTTP 200, deploy concluído ou indexação sem observação posterior.
