# Rotina editorial Ascende — 09/11/2026, 18h BRT (execução `2026-11-09-1800-claude`)

Execução paralela da rotina "Blogs SEO — tarde" (Claude, nuvem). Disparo recebido na segunda 09/11/2026 às 18h06 BRT. Registro append-only.

## Estado: reservado (09/11/2026 ~18h15 BRT)

- HEAD-base: `cc913fba3ba6f3b423e9b4f2ca5942ca8c09a4ba`
- Pauta reservada: horário de dormir e acordar diferente no fim de semana ("jet lag social") — o que é, o que a pesquisa associa à irregularidade do horário de sono, e como observar a diferença entre dias de trabalho e de folga no diário de sono, sem diagnóstico nem prescrição.
- Keyword principal: `jet lag social`; secundárias: `dormir mais no fim de semana`, `horário de sono regular`, `compensar sono no fim de semana`.
- Intenção: entender se dormir/acordar bem mais tarde na folga atrapalha e como enxergar essa diferença na própria rotina.
- Slug planejado: `jet-lag-social-sono-fim-de-semana`. Cluster `rotina-integrada`.
- Distinta de `sono-turnos-horarios-variaveis` (horário de trabalho que muda), `diario-sono-registrar-horarios`, `cochilo-durante-dia-duracao-sono-noite` e `cafeina-sono-horario-ultimo-cafe`; nenhum post sobre fim de semana/regularidade no INDICE.
- Motivo: os quatro posts de 09/11 são de finanças/alimentação; equilibra o eixo sono numa segunda-feira, com tema durável.

## Estado: enviado ao Git (09/11/2026 ~18h26 BRT)

- Concorrência: fetch após a reserva (`87781c9`) e antes do commit — nenhuma outra execução reservou ou publicou pauta nesse intervalo.
- Título: "Jet lag social: a diferença de horário de sono entre a semana e a folga"; seoTitle "Jet lag social: como calcular e o que dizem os estudos"; URL `https://ascende.site/blog/jet-lag-social-sono-fim-de-semana/`. Exemplo fictício (23h30–6h30 x 1h00–9h00; ponto médio 3h00 x 5h00; diferença 2 h). Sem CTA; parágrafo de produto conferido em `Vitalidade.tsx` ("Minha rotina de sono", duração em horas), `SleepCheckin.tsx` e `healthImport.ts` — o app não calcula ponto médio nem jet lag social.
- Motivo: os posts de 09/11 eram de finanças/alimentação; tema durável do eixo sono, sem post sobre fim de semana/regularidade no INDICE. Busca em português analisada qualitativamente (portais de saúde com definição genérica e números sem fonte); sem volume/posição.
- Fontes abertas em 09/11/2026: Wittmann et al. 2006 (PubMed 16687322); Roenneberg et al. 2012 (PubMed 22578422); Roenneberg 2023 (PMC10204006); meta-análise Obesity Reviews 2024 (PubMed 38072635); documentação rOpenSci `mctq` (fórmula MSF − MSW); NIH Research Matters sobre Depner et al. 2019; resumo do consenso NSF (Sletten et al., Sleep Health 2023) e comunicado da NSF; consenso AASM/SRS 2015; NHLBI Healthy Sleep Habits; CDC About Sleep. Sem fonte brasileira oficial localizada.
- Imagens (originais por código, HTML → Chromium → WebP; Sora e Inter, SIL OFL 1.1; crédito Ascende; selo "Exemplo fictício"): `relogios-semana-folga.webp` 720×900 (+360×450) — dois relógios de parede (3h00 x 5h00); `semana-ponto-medio.webp` 720×1024 (+360×512) — gráfico de barras de uma semana com pontos médios. Formato visual: relógios ilustrados + gráfico de faixas semanal, diferente do calendário/prancheta da tarde anterior.
- Agentes: pesquisa (sonnet), redação (opus), imagens (sonnet), revisão factual independente (opus: NO-GO com 5 correções — sinais do CDC, local da rotina de sono no app, resumo da meta-análise, separar diferença de horário x horas extras, frase do NHLBI no corpo — → GO 21:20:07Z), revisão final independente do diff e da renderização (opus: GO 21:24Z — Chromium 390/1280 px, H1 único, byline, canonical, JSON-LD BlogPosting/FAQPage/BreadcrumbList com author Person, imagens carregadas, sem overflow, URL no sitemap).
- Testes locais: `blog:indice` (+1 linha), `blog:check` ok (60 posts), `npm run build` ok, `vitest src/lib/blog src/blog` 149/149. Build local não prova publicação.

## Estado: enviado ao Git — deploy não confirmado (09/11/2026 ~18h33 BRT)

- Commit `17b54c8`, push sem force sobre `87781c9` (sem commits de terceiros no intervalo).
- [CI do commit](https://github.com/HenriPett/ascende/actions/runs/42702264069): job `verify` verde (TypeScript, lint, testes, edge functions, build); job `Privacidade do Social (RLS com usuários de verdade)` falhou no passo "As quatro revogações", como nos commits anteriores — fora do diff editorial. O workflow como um todo **não** está verde.
- Verificação pública bloqueada nesta sessão: `curl` para ascende.site recusado pelo proxy (CONNECT 403) e a ferramenta de navegação recusou a URL (proveniência). **Publicação não confirmada**; promover a "publicado" só após observar a URL pública.
