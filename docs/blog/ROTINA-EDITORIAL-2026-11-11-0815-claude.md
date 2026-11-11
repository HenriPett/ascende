# Rotina editorial Ascende — 11/11/2026, 08h15 BRT (execução `2026-11-11-0815-claude`)

Execução paralela da rotina "Blogs SEO — manhã" (Claude, nuvem). Disparo recebido na quarta 11/11/2026 às 08h15 BRT. Registro append-only.

## Estado: reservado (11/11/2026 ~08h25 BRT)

- HEAD-base: `32d70c7dc967bec766b0a7897ae9f7aa499354a0`
- Pauta reservada: reserva de emergência com orçamento apertado — o que ela é (e o que não é), como estimar um valor a partir das despesas essenciais, como começar com pouco e como registrá-la no orçamento sem confundir com o dinheiro separado para despesas anuais — conteúdo educativo, sem recomendação de investimento.
- Keyword principal: `reserva de emergência`; secundárias: `como montar reserva de emergência`, `reserva de emergência quanto guardar`, `reserva de emergência ganhando pouco`.
- Intenção: entender quanto guardar e como começar uma reserva de emergência quando o orçamento é apertado, e como distingui-la de outras reservas.
- Slug planejado: `reserva-emergencia-quanto-guardar-comecar`. Cluster `alimentacao-orcamento`.
- Distinta de `despesas-anuais-planejar-vencimentos` (gasto previsto com data), `renda-irregular-entradas-vencimentos` e `orcamento-mes-despesas-variaveis`; nenhum post do INDICE trata reserva de emergência.

## Estado: enviado ao Git (11/11/2026 ~08h52 BRT)

- Concorrência: fetch após a reserva (`4af9a34`) e antes do commit — nenhuma outra execução reservou ou publicou pauta nesse intervalo.
- Título: "Reserva de emergência: quanto guardar e como começar com pouco" (seoTitle "Reserva de emergência: quanto guardar e como começar"); URL `https://ascende.site/blog/reserva-emergencia-quanto-guardar-comecar/`. Intenção no INDICE: "como estimar quanto guardar e começar uma reserva de emergência com orçamento apertado sem misturar com despesas previstas". Exemplo fictício (essenciais de R$ 1.800/mês; R$ 300/mês; marcos de 1, 3 e 6 meses nos meses 6, 18 e 36, sem rendimento). Parágrafo de produto conferido no código (registro numa frase digitada, por voz ou pelo WhatsApp, gravação só após confirmação; sem conexão com banco nem função de reserva). Sem CTA, sem recomendação de produto ou investimento.
- Motivo: tema financeiro durável e central para quem tem orçamento apertado, sem post no INDICE; a busca em português (análise qualitativa, sem volume/posição) é dominada por corretoras e fintechs que repetem "3 a 6 meses" e listam produtos próprios — lacuna: mostrar que as fontes oficiais divergem (CVM 6–12 meses; BCB sem número), partir dos essenciais e separar a reserva das despesas previstas.
- Fontes abertas em 11/11/2026: Portal do Investidor (CVM), "Emergências e aposentadoria"; BCB, Caderno de Educação Financeira, Módulos 2 e 5 (versão 2026); FGC, material de apoio de dezembro/2025 (página institucional do FGC não abriu para o robô). Não usados por falta de fonte primária aberta: Selic, IPCA, dados da ANBIMA (PDF só em domínio de terceiro).
- Imagens (originais por código, HTML/SVG → Chromium → WebP; fonte Sora do molde, SIL OFL 1.1; crédito Ascende): `dois-potes-reserva-previstas.webp` 720×820 (+360×410) — dois potes de vidro, "Reserva de emergência / imprevistos / sem data" × "Despesas previstas / com data" (ilustração); `marcos-reserva-exemplo.webp` 720×940 (+360×470) — gráfico de linha com área do exemplo fictício com três marcos. Formato visual: potes + gráfico de área, diferente do medidor/caderno de 10/11.
- Agentes: pesquisa (sonnet), redação (opus), imagens (sonnet), revisão factual independente (opus: GO 11:36:36Z com 3 correções — frase do FGC sem fonte trocada por intervenção/liquidação, concordância, INDICE — e sugestões aplicadas: "estabilidade no emprego", "uma adaptação nossa", liquidez "em qualquer dia útil"), revisão final independente do diff e da renderização (opus: GO 11:46:10Z — Chromium 390/1280 px, H1 único, byline, "Em resumo", canonical, JSON-LD BlogPosting/FAQPage/BreadcrumbList com author Person, imagens carregadas, sem overflow, URL no sitemap e no feed).
- Testes locais: `blog:indice` (+1 linha), `blog:check` ok (64 posts), `npm run build` ok, `vitest src/lib/blog src/blog` 149/149. Build local não prova publicação.
