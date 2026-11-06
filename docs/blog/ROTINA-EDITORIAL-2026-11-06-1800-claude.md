# Rotina editorial Ascende — 06/11/2026, 18h BRT (execução `2026-11-06-1800-claude`)

Execução paralela da rotina "Blogs SEO — tarde" (Claude, nuvem). Registro append-only.

## Estado: reservado (06/11/2026 18:12 BRT)

- HEAD-base: `0eedf6410b85962f344d6939fc5445ad6753ca4b`
- Pauta reservada: cochilo durante o dia — duração e horário que costumam ser discutidos para não atrapalhar o sono da noite, e como registrar cochilos no diário de sono, sem prescrição.
- Keyword principal: `cochilo durante o dia`; secundárias: `quanto tempo de cochilo`, `cochilo atrapalha o sono à noite`, `power nap`.
- Intenção: entender duração/horário de cochilos e seus possíveis efeitos no sono noturno, e como observar a própria rotina.
- Slug planejado: `cochilo-durante-dia-duracao-sono-noite`.
- Cluster: `rotina-integrada`. Distinta de `cafeina-sono-horario-ultimo-cafe`, `diario-sono-registrar-horarios` e `sono-turnos-horarios-variaveis`; nenhum post sobre cochilo no INDICE.
- Motivo: os posts de 06/11 até agora são de finanças/alimentação; equilibra o eixo sono.

## Estado: enviado ao Git (06/11/2026 ~18:46 BRT)

- Concorrência: fetch após a reserva (`2ddedb9`) e antes do commit final — nenhuma outra execução publicou ou reservou pauta em `main` nesse intervalo.
- Título: "Cochilo durante o dia: duração, horário e o sono da noite"; seoTitle "Cochilo durante o dia: duração e horário"; URL `https://ascende.site/blog/cochilo-durante-dia-duracao-sono-noite/`.
- Fontes lidas em 06/11/2026: Mayo Clinic (napping, revisão 21/05/2024); CDC/NIOSH módulo 7 de treinamento (mod7/03 inércia, /04 horários, /05 duração, /07 cochilos no trabalho — contexto de trabalho em turnos); CDC About Sleep; Dutheil et al. 2021 (IJERPH/MDPI, meta-análise: 11 estudos, 381 adultos saudáveis); Brooks & Lack 2006 (Sleep; link PubMed 16796222 — PubMed não abriu para o robô; conteúdo conferido no PDF do artigo). Sem fonte brasileira oficial sobre cochilo localizada. Análise de busca qualitativa, sem volume/posição.
- Produto: `src/pages/Vitalidade.tsx` (chips Noite/Soneca, duração em horas, soneca só com acompanhamento de sonecas ativo) e `src/lib/trackers.ts`; texto declara que o app não guarda horário nem avalia efeito na noite.
- Imagens: `linha-do-dia.webp` 720×540 (+360×270) — linha do tempo de dia fictício com céu do amanhecer à noite; `dois-estudos.webp` 720×750 (+360×375) — cartões comparando Brooks & Lack 2006 e Dutheil 2021. Originais por código (SVG → Chromium → WebP), fontes Sora e Inter (SIL OFL 1.1), texto ≥24 px no arquivo de 720. Formato visual: linha do tempo ilustrada + cartões comparativos (diferente do relógio radial/gráfico de faixas e das cenas de carteira recentes).
- Agentes: pesquisa (sonnet), redação (opus), imagens (sonnet), revisão factual independente (opus: NO-GO → GO às 2026-11-06T21:38:09Z após 4 correções obrigatórias e 7 recomendadas — contexto do NIOSH, "cerca de duas horas", 17/11 estudos de Dutheil, legibilidade das imagens), revisão final independente do diff e da renderização (opus: GO).
- Testes: `blog:indice`, `blog:check` (54 posts), `npm run build`, `vitest src/lib/blog src/blog` 149/149; prévia local Chromium 390/1280 px: H1 único, byline "Por Henrique Pett, fundador do Ascende", canonical, JSON-LD author Person, sitemap, imagens carregadas, sem overflow. Não é evidência de produção.
