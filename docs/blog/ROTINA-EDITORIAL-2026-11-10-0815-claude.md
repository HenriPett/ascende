# Rotina editorial Ascende — 10/11/2026, 08h15 BRT (execução `2026-11-10-0815-claude`)

Execução paralela da rotina "Blogs SEO — manhã" (Claude, nuvem). Disparo recebido na terça 10/11/2026 às 08h15 BRT. Registro append-only.

## Estado: reservado (10/11/2026 ~08h20 BRT)

- HEAD-base: `5da9f8d613017d92db9b202374a4b88b18eda1bb`
- Pauta reservada: como saber se a atividade física está em intensidade leve, moderada ou vigorosa usando o teste da fala e a escala de esforço percebido (0–10), e como anotar isso no registro do treino — conteúdo educativo, sem prescrição de treino.
- Keyword principal: `intensidade moderada atividade física`; secundárias: `teste da fala exercício`, `escala de esforço percebido`, `atividade física vigorosa o que é`.
- Intenção: entender o que conta como intensidade moderada ou vigorosa nas recomendações e como estimar isso sem equipamento.
- Slug planejado: `intensidade-moderada-vigorosa-teste-fala`. Cluster `rotina-integrada`.
- Distinta de `atividade-fisica-semana-imprevisivel` (encaixar atividade na agenda), `passos-celular-treino-diferenca-registro` (passos x treino) e `tempo-sentado-trabalho-pausas-movimento`; nenhum post sobre intensidade no INDICE.
- Motivo: os posts recentes são majoritariamente de finanças/alimentação; o eixo treino tem poucos artigos.

## Estado: enviado ao Git (10/11/2026 ~08h47 BRT)

- Concorrência: fetch após a reserva (`173f1e0`) e antes do commit — nenhuma outra execução reservou ou publicou pauta nesse intervalo.
- Título: "Intensidade moderada ou vigorosa: como saber pelo X; URL `https://ascende.site/blog/intensidade-moderada-vigorosa-teste-fala/`. Intenção no INDICE: "como saber se a atividade física é leve, moderada ou vigorosa pelo teste da fala e pelo esforço percebido e anotar no registro do treino". Exemplo fictício de semana (90 min moderados + 25 vigorosos × 2 = 140 min equivalentes, sem meta). Parágrafo de produto conferido em `Vitalidade.tsx` (treino com descrição de até 80 caracteres e grupos musculares; meta semanal em número de treinos) — o app não classifica intensidade nem soma minutos. Sem CTA.
- Motivo: eixo treino com poucos posts; tema durável; busca em português (análise qualitativa, sem volume/posição) traz portais com a regra "fala mas não canta" sem citar o Guia brasileiro nem limitações.
- Fontes abertas em 10/11/2026: CDC "How to Measure Physical Activity Intensity" e "What Counts"; HHS Physical Activity Guidelines 2ª ed. (p. 8, 10, 58, 60); Guia de Atividade Física para a População Brasileira (Ministério da Saúde, 2021 — edição oficial em inglês; o PDF em português não abriu pelo proxy); diretrizes OMS 2020 (Bull et al., BJSM, PMC7719906); revisão de Vieira et al. 2022 sobre o teste da fala; Tanaka, Monahan e Seals 2001 (PubMed 11153730; resumo do PubMed não renderizou para o robô — identidade confirmada por registro da Universidade do Colorado).
- Imagens (originais por código, HTML → Chromium → WebP; Inter, SIL OFL 1.1; crédito Ascende): `medidor-intensidade-0-10.webp` 720×960 (+360×480) — medidor vertical tipo termômetro com zonas e frases do teste da fala (ilustração); `semana-minutos-equivalentes.webp` 720×1000 (+360×500) — página de caderno pautado com semana fictícia e a conta. Formato visual: medidor + caderno, diferente dos relógios/gráfico de faixas de 09/11.
- Agentes: pesquisa (sonnet), redação (opus), imagens (sonnet), revisão factual independente (opus: NO-GO 11:40Z com 5 correções — Tanaka via PubMed, frase do HHS sobre inativos, condição da OMS sobre liberação médica, vigorosa "começa em 7 ou 8", sombreado do medidor — aplicadas pelo integrador), revisão final independente do diff e da renderização (opus: GO 11:44:43Z — Chromium 390/1280 px, H1 único, byline, canonical, JSON-LD BlogPosting/FAQPage/BreadcrumbList com author Person, imagens carregadas, sem overflow, URL no sitemap).
- Testes locais: `blog:indice` (+1 linha), `blog:check` ok (61 posts), `npm run build` ok, `vitest src/lib/blog src/blog` 149/149. Build local não prova publicação.
