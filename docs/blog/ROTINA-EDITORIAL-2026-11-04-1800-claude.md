# Rotina editorial Ascende — 04/11/2026, 18h BRT (execução `2026-11-04-1800-claude`)

Execução paralela da rotina "Blogs SEO — tarde" (Claude, nuvem). Registro append-only.

## Estado: reservado (04/11/2026 18:15 BRT)

- HEAD-base: `991f2d227d1784610e2ff95cb62ffe6a52569005`
- Pauta reservada: organizar o 13º salário no orçamento (parcelas, descontos e o que já está comprometido).
- Keyword principal: `13º salário no orçamento`; secundárias: `primeira parcela do 13º`, `segunda parcela do 13º`, `desconto INSS IR 13º`.
- Intenção: como organizar o 13º salário no orçamento distinguindo parcelas, descontos e valor líquido antes de decidir o uso.
- Slug planejado: `decimo-terceiro-salario-orcamento-parcelas`.
- Cluster: `alimentacao-orcamento`. Distinta de renda irregular, despesas anuais e limite do cartão (ver INDICE).

## Estado: enviado ao Git (04/11/2026 ~18:30 BRT)

- Concorrência: após a reserva, `fd0cc21` (outra execução das 18h) registrou ciência desta reserva; nenhuma pauta igual reservada/publicada por outra execução. Sem conflito.
- Título: "Como organizar o 13º salário no orçamento: parcelas, descontos e líquido"; URL planejada `https://ascende.site/blog/decimo-terceiro-salario-orcamento-parcelas/`; ~1.400 palavras, 8 min.
- Pesquisa qualitativa (sem volume/ranking medidos). Fontes lidas em 04/11/2026: MTE (gov.br, 13º regras e prazos, atualizada 26/10/2026); Lei 4.749/1965 (espelho ANTTlegis — planalto.gov.br bloqueou leitura automatizada); Lei 4.090/1962 (Câmara); Lei 8.212/1991 art. 28 §7º (Câmara, norma atualizada); Lei 8.134/1990 art. 16 (Câmara, norma atualizada); Ministério da Previdência (13º INSS 2026). Sem tabelas/alíquotas de INSS/IR 2026 (não verificadas). Sem CTA de produto.
- Imagens: `dois-envelopes-13.png` (720×480, 13.440 B) + `-360` (9.191 B); `potes-destino-13.png` (720×560, 11.954 B) + `-360` (8.667 B). Ilustrações originais por código (HTML/CSS → PNG via Chromium), fonte Sora (SIL OFL 1.1, do node_modules do repo), crédito Ascende 2026, marcadas como fictícias. Formato visual: objetos de mesa (envelopes, potes) — diferente de lupa/caderno/ampulheta recentes.
- Agentes: pesquisa (sonnet), redação (sonnet), imagens (sonnet), revisão factual independente (opus, GO após trocar fonte da Receita pela Lei 8.134/1990), revisão final independente do diff staged (opus, GO).
- Testes: `blog:indice`, `blog:check` (47 posts), `npm run build` OK, `vitest src/lib/blog` 106/106; render local desktop 1280 e mobile 390 conferido (byline "Por Henrique Pett, fundador do Ascende", canonical, JSON-LD BlogPosting/FAQPage/BreadcrumbList, author Person).
- Pendência de processo: os papéis nomeados Astra/Prisma/Farol/Fiel não existem neste ambiente; imagens revisadas pelos agentes revisores independentes acima.

## Estado: publicado — HTML observado (04/11/2026 ~18:45 BRT)

- Commits: `7a30315` (post) e `6f06659` (registro), push sem force sobre `fd0cc21`.
- Observado via WebFetch: `https://ascende.site/blog/decimo-terceiro-salario-orcamento-parcelas/` com H1, byline "Por Henrique Pett, fundador do Ascende", canonical correto e `<img>` apontando para `dois-envelopes-13.png` e `potes-destino-13.png`; URL presente em `https://ascende.site/sitemap.xml` (lastmod 2026-11-04).
- Limite: o proxy desta sessão bloqueou o download binário dos PNG em produção (403/erro); a presença dos arquivos foi confirmada no build local (`dist/blog/<slug>/`) e nas referências do HTML publicado, não por GET do arquivo.
- Checks GitHub: `verify` success; "Privacidade do Social (RLS com usuários de verdade)" failure — falha pré-existente (também em `991f2d2` e `fd0cc21`), não relacionada ao diff editorial. Indexação: não observada.
