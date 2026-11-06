# Rotina editorial Ascende — 06/11/2026, 08h15 BRT

## Pauta e concorrência

- HEAD-base de `origin/main` após `pull --ff-only`: `dd42dbdbff40eab127fce935eaa29731335cc857`.
- Intenção: como calcular o custo por porção de refeição caseira, distinguindo compra, ingredientes usados e rendimento real. Keyword principal: `custo da refeição caseira por porção`. Slug: `custo-refeicao-caseira-porcao-orcamento`.
- O índice lido tinha 51 posts; não havia intenção equivalente. `preco-por-quilo-comparar-embalagens` trata da escolha de embalagem; `marmitas-semana-porcionar-guardar` de conservação; `lista-de-compras-semanal-orcamento` de planejamento anterior à compra. Esta pauta trata do rateio *depois* do preparo.
- Pesquisa qualitativa de SERP em 06/11: resultados de terceiros sobre custo de receita focavam a precificação para venda e margem. Lacuna: organizar a conta doméstica sem confundir custo atribuído à porção com uma segunda saída de caixa. Não houve métricas de volume, dificuldade nem posição medidas.

## Fontes lidas e limites

- Governo da Bahia, *Comida no Prato: Manual de Orientação para Elaboração de cardápios e aplicação de Boas Práticas*, pp. 11–14: ficha técnica distingue ingrediente, unidade de compra, custo, rendimento total e custo por porção. O contexto é cozinha comunitária; o artigo adapta só a lógica contábil, sem importar porções ou tabelas numéricas.
- Ministério da Saúde, *Guia Alimentar para a População Brasileira*, 2ª ed., p. 115: planejar compras e organizar despensa integram as habilidades culinárias; o texto também reconhece o custo de tempo do preparo. Não se atribui ao Guia o cálculo financeiro do artigo.
- Procon-SP, monitoramento de preços publicado em 18/11/2025, seção “Orientação aos consumidores”: recomenda comparar preços entre supermercados, observando qualidade, peso, preço e frete. É um levantamento de São Paulo e de datas específicas; o artigo manda usar o preço efetivamente pago, não extrapolar o levantamento.
- Números do exemplo são inteiramente fictícios, com rótulo no início e no fim. R$ 2 + R$ 4 + R$ 3 = R$ 9 e R$ 9 ÷ 3 = R$ 3. O desembolso fictício das três embalagens é R$ 24, distinto dos R$ 9 usados no preparo.

## Produto, arte e verificação local

- O código (`src/pages/Prosperidade.tsx`, `src/components/core/QuickActions.tsx`) confirma registro manual de gastos. O artigo não promete cálculo automático de receitas.
- Ilustração original de panela e caderno, sem material de terceiros, 720×520 e variante 360×260; alt e crédito no artigo. Conceito visual de natureza morta, distinto de filas/fluxogramas.
- `npm run blog:indice`, `npm run blog:check` (52 posts, 194 imagens), `npm run build`, `npx vitest run src/lib/blog src/blog` (149/149) passaram no checkout isolado. Build local não prova publicação.
- Estado: rascunho completo em checkout isolado, aguardando revisão independente do diff e da saída HTML. Push, CI e URL pública ainda não observados neste registro.
