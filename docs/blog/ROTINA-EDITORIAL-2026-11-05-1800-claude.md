# Rotina editorial Ascende — 05/11/2026, 18h BRT (execução `2026-11-05-1800-claude`)

Execução paralela da rotina "Blogs SEO — tarde" (Claude, nuvem). Registro append-only.

## Estado: reservado (05/11/2026 18:08 BRT)

- HEAD-base: `33518d1089def850b1df9ae8b7211f2bcae9468c`
- Pauta reservada: cafeína e sono — horário do último café/bebida com cafeína e como observar o efeito no diário de sono, sem prescrição.
- Keyword principal: `cafeína e sono`; secundárias: `café à noite atrapalha o sono`, `horário do último café`, `quanto tempo a cafeína dura`.
- Intenção: entender quanto tempo antes de dormir a cafeína pode interferir no sono e como registrar horário/fonte para observar a própria rotina.
- Slug planejado: `cafeina-sono-horario-ultimo-cafe`.
- Cluster: `rotina-integrada`. Distinta de `diario-sono-registrar-horarios` (método do diário) e `sono-turnos-horarios-variaveis`; nenhum post sobre cafeína no INDICE.
- Motivo: os últimos ~15 posts concentram-se em finanças; esta pauta equilibra alimentação + sono.

## Estado: enviado ao Git (05/11/2026 ~18:25 BRT)

- Concorrência: após a reserva (`2dbd05a`), a outra execução das 18h publicou `taxa-servico-restaurante-conferir-conta` (`fe21348`, `f5d7f5d`); intenção distinta. Sem conflito.
- Título: "Cafeína e sono: quanto tempo antes de dormir o café pode atrapalhar"; seoTitle "Cafeína e sono: até que horas o café atrapalha"; URL `https://ascende.site/blog/cafeina-sono-horario-ultimo-cafe/`.
- Fontes lidas em 05/11/2026: Gardiner et al. 2023 (Sleep Med Rev, meta-análise, PubMed 36870101); Drake et al. 2013 (J Clin Sleep Med, PubMed 24235903 — resumo não abriu nesta sessão; dados confirmados via Europe PMC/API e comunicado da AASM); AASM sleepeducation.org; FDA "Spilling the Beans" (2024); EFSA tópico cafeína (opinião 2015). Sem meia-vida numérica (sem fonte aberta). Sem fonte oficial brasileira confirmada. Pesquisa qualitativa, sem volume/ranking.
- Imagens: `relogio-ultimo-cafe.png` 720×720 + `-360` (relógio de 24 h, exemplo fictício) e `cafeina-por-bebida.png` 720×640 + `-360` (gráfico de faixas FDA). Originais por código (SVG/HTML → PNG via Chromium), fonte Sora (SIL OFL 1.1). Formato visual: relógio radial + gráfico de faixas — diferente dos objetos/cartões recentes.
- Agentes: pesquisa (sonnet), redação (sonnet), imagens (sonnet), revisão factual independente (opus: GO após 2 correções — redação da FDA sobre 400 mg e da EFSA sobre 200 mg), revisão final independente do diff (opus: GO).
- Testes: `blog:indice`, `blog:check` (51 posts, 192 imagens), `npm run build`, `vitest src/lib/blog` 106/106; prévia local Chromium 390/1280 px: H1 único, byline "Por Henrique Pett, fundador do Ascende", canonical, JSON-LD author Person, imagens carregadas, sem overflow. Não é evidência de produção.

## Estado: publicado — HTML observado (05/11/2026 ~18:35 BRT)

- Commit `ae365ea` (post + registro), push sem force sobre `f5d7f5d`.
- Observado via WebFetch: `https://ascende.site/blog/cafeina-sono-horario-ultimo-cafe/` com H1, byline "Por Henrique Pett, fundador do Ascende", canonical correto e `<img>` para `relogio-ultimo-cafe.png` e `cafeina-por-bebida.png`.
- Limite: o download direto dos PNG em produção falhou nesta sessão (erro da ferramenta/proxy); presença confirmada pelas referências no HTML publicado e no build local, não por GET do arquivo. Checks da CI e indexação não observados.
