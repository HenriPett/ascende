# Rotina editorial Ascende — 09/11/2026, execução `2026-11-09-0815-claude`

Rotina "Blogs SEO — manhã" (Claude, nuvem). Disparo recebido na segunda 09/11/2026 às 08h16 BRT. Registro append-only.

## Estado: reservado (09/11/2026 ~08h25 BRT)

- HEAD-base: `edc70fa5a4c7ad1f14f9b79d2bd6e3c4d4cf6df5`
- Pauta reservada: o que acontece ao pagar só o mínimo (ou um valor parcial) da fatura do cartão — saldo que vai para o rotativo, limite de 30 dias e oferta de parcelamento, juros e encargos, teto de juros do rotativo/parcelado — e como registrar isso no orçamento sem tratar como gasto novo. Educativo, sem recomendar produto financeiro.
- Keyword principal: `pagar o mínimo da fatura`; secundárias: `rotativo do cartão de crédito`, `parcelamento da fatura`, `juros do rotativo limite`.
- Intenção: entender o que acontece ao pagar só o mínimo da fatura do cartão (rotativo, parcelamento e juros) e como registrar o saldo restante no orçamento.
- Slug planejado: `pagamento-minimo-fatura-rotativo-orcamento`. Cluster `alimentacao-orcamento`.
- Distinta de `fatura-fechamento-vencimento-periodo-compras` (ciclo), `pagamento-fatura-cartao-gasto-duplicado` (conciliação no extrato), `limite-cartao-nao-e-saldo-orcamento` e `compras-parceladas-orcamento-proximos-meses` (parcelas de compra); nenhum post sobre mínimo/rotativo no INDICE.

## Estado: enviado ao Git (09/11/2026 ~08h50 BRT)

- Concorrência: fetch após a reserva (`a079400`) — a outra rotina das 08:15 reservou `restaurante-quilo-tara-peso-prato` (`7ba4317`), pauta distinta; sem canibalização.
- Título: "Pagar o mínimo da fatura: o que acontece e como registrar no orçamento"; seoTitle "Pagar o mínimo da fatura: o que acontece"; URL `https://ascende.site/blog/pagamento-minimo-fatura-rotativo-orcamento/`. ~1.770 palavras de corpo (leitura ~9 min). Sem CTA; parágrafo de produto conferido em `Prosperidade.tsx`/`prosperidade.ts` (lançamento manual, "Parcelei" 2–24 parcelas; o app não calcula juros/rotativo/CET nem conecta a cartão ou banco; importação de fatura exige conferência).
- Fontes abertas em 09/11/2026: Lei 14.690/2023 art. 28 (Câmara, texto atualizado); Resolução CMN 4.549/2017 com alterações da Res. CMN 5.112/2023 (arts. 1º, 2º, 2º-A a 2º-D, BCB); Voto CMN 67/2023 (BCB); Secom 03/01/2024 (teto em vigor, informações na fatura, portabilidade); Glossário de cidadania financeira do BCB (rotativo, CET, inadimplência); Procon SC; Consumidor.gov.br. Resolução BCB 96/2021 não aberta em fonte oficial — não citada. Sem IOF, taxa média ou percentual mínimo. Análise de busca qualitativa, sem volume/posição.
- Imagens: `saldo-fatura.webp` 720×740 (+360×370) — barras horizontais em escala real do exemplo hipotético (R$ 1.200 / R$ 300 / R$ 900 e barra tracejada do teto até R$ 900); `orcamento-tres-linhas.webp` 720×830 (+360×415) — folha de caderno pautado "Três linhas no orçamento". Originais por código (HTML → Chromium → WebP), fontes Sora e Inter (SIL OFL 1.1), texto ≥ 24 px no arquivo de 720. Formato visual: barras horizontais + objeto-caderno, diferente das etiquetas/blocos empilhados da Black Friday.
- Agentes: pesquisa (sonnet), redação (opus), imagens (sonnet), revisão factual independente (opus: NO-GO 11:32:35Z → GO 11:43:25Z após 2 correções obrigatórias — art. 2º-C "descontados os juros e encargos já pagos" e fonte para pagamento abaixo do mínimo — e recomendadas), revisão final independente do diff e da renderização (opus: GO 11:47:43Z — Chromium 390/1280 px, H1 único, byline, canonical, JSON-LD BlogPosting/FAQPage/BreadcrumbList, imagens carregadas, sem overflow, URL no sitemap).
- Testes locais: `blog:indice` (+1 linha), `blog:check` ok (56 posts), `npm run build` ok, `vitest src/lib/blog src/blog` 149/149. Build local não prova publicação.
- Pendência para outra execução: incluir este post no `related` de `pagamento-fatura-cartao-gasto-duplicado` (fora do escopo desta).
