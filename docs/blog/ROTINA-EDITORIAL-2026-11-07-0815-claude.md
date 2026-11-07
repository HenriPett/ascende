# Rotina editorial Ascende — 07/11/2026, execução `2026-11-07-0815-claude`

Rotina "Blogs SEO — manhã" (Claude, nuvem). Disparo do agendamento recebido no sábado 07/11/2026 às 10h33 BRT (fora do horário/dia nominal seg–sex 08:15). Registro append-only.

## Estado: reservado (07/11/2026 ~10h40 BRT)

- HEAD-base: `bf1def8d28e5aaa0b490c120326609bb981b33e5`
- Pauta reservada: como conferir se o desconto da Black Friday é real (histórico de preço, preço "de/por", frete, condições) e se a compra cabe no orçamento, com direitos básicos do consumidor (arrependimento em compra fora da loja), sem recomendar compra.
- Keyword principal: `black friday desconto real`; secundárias: `como saber se a promoção é verdadeira`, `black friday pela metade do dobro`, `direito de arrependimento compra online`.
- Intenção: conferir se o desconto anunciado na Black Friday é real e se a compra cabe no orçamento antes de pagar.
- Slug planejado: `black-friday-desconto-real-orcamento`. Cluster `alimentacao-orcamento`.
- Distinta de `leve-tres-pague-dois-preco-uso` (promoção por quantidade), `preco-a-vista-parcelado-total-compra` (forma de pagamento), `delivery-custo-total-pedido` e `preco-por-quilo-comparar-embalagens`; nenhum post sobre Black Friday ou desconto anunciado no INDICE.
- Motivo: data sazonal próxima (Black Friday em 27/11/2026) com dúvida recorrente e perene; pesquisa qualitativa, sem volume medido.

## Estado: enviado ao Git (07/11/2026 ~11h05 BRT)

- Concorrência: fetch após a reserva (`dbe41ad`) — nenhuma outra execução reservou ou publicou pauta em `main` no intervalo; reconferir antes do push.
- Título: "Black Friday: como saber se o desconto é real e se a compra cabe no orçamento" (77 car.); seoTitle "Black Friday: desconto real e se cabe no orçamento"; URL `https://ascende.site/blog/black-friday-desconto-real-orcamento/`. Leitura estimada ~8 min (≈1.540 palavras de corpo ÷ 200).
- Fontes abertas em 07/11/2026: CDC (Lei 8.078/1990, texto atualizado na Câmara; Planalto bloqueou leitura automática) arts. 30, 35, 37, 49; Decreto 7.962/2013 (Câmara) arts. 2º e 5º; MJSP/Senacon "Black Friday 2025: Senacon orienta…" (26/11/2025); MJSP "Black Friday: saiba como identificar descontos enganosos" (26/11/2024, expressão "o dobro da metade"); MJSP "Consumidor tem direito ao arrependimento em compras on-line" (27/11/2025); Agência SP/Procon-SP (10/11/2025, recomendação de desconto sobre o menor preço dos últimos 60 dias às dez empresas com mais reclamações na Black Friday de 2024 — recomendação, não lei); Gazeta do Povo (03/11/2026, data 27/11/2026 como convenção de mercado). Sem dados de reclamações citados (balanço do Procon-SP só em imagem). Análise de busca qualitativa, sem volume/posição.
- Produto: `src/pages/Prosperidade.tsx` e `src/lib/prosperidade.ts` (registro manual de gasto com valor/categoria/descrição; "Parcelei" lança uma parcela por mês, a primeira no mês do registro, 2–24 parcelas). O texto declara que o app não verifica preço, promoção nem histórico de preço. Sem CTA no texto.
- Imagens: `historico-preco.webp` 720×870 (+360×435) — fita sobre etiquetas penduradas numa prateleira, preço fictício R$ 320 → R$ 640 → R$ 320 ("pela metade do dobro", desconto real R$ 0); `total-no-mes.webp` 720×930 (+360×465) — equação etiqueta + frete = total e blocos empilhados por mês com parcelas fictícias. Originais por código (HTML/SVG → Chromium → WebP), fontes Sora e Inter (SIL OFL 1.1), texto ≥ 24 px no arquivo de 720. Formato visual: gráfico-objeto (etiquetas/prateleira) + blocos empilhados — diferente da linha do tempo, cartões e natureza-morta recentes.
- Agentes: pesquisa (sonnet), redação (opus), imagens (sonnet), revisão factual independente (opus: NO-GO 13:51:41Z → GO 13:56:48Z após 3 correções obrigatórias — "antecipam e espalham ofertas" conforme a Gazeta, ausência de período no CDC/Decreto em vez de "na lei", data e contexto da carta do Procon-SP — e recomendadas), revisão final independente do diff e da renderização (opus: GO às 2026-11-07T14:02Z — prévia local Chromium 390/1280 px: H1 único, byline, Em resumo, canonical, JSON-LD BlogPosting/FAQPage/BreadcrumbList, imagens carregadas, sem overflow de página, URL no sitemap e no feed).
- Testes locais: `blog:indice` (+1 linha), `blog:check` ok (55 posts), `npm run build` ok, `vitest src/lib/blog src/blog` 149/149; HTML local com canonical, H1 único, byline "Por Henrique Pett, fundador do Ascende", JSON-LD author Person e URL no sitemap. Build local não prova publicação.
