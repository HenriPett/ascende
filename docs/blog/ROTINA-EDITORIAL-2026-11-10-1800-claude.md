# Rotina editorial Ascende — 10/11/2026, 18h BRT (execução `2026-11-10-1800-claude`)

Rotina "Blogs SEO — tarde" (Claude, nuvem). Disparo recebido na terça 10/11/2026 às 18h03 BRT. Registro append-only.

## Estado: reservado (10/11/2026 ~18h15 BRT)

- HEAD-base: `df1cea287cbf2eb060fe64ae15ece7091c906a5d`
- Pauta reservada: fortalecimento muscular — o que as diretrizes (OMS, Ministério da Saúde, HHS) chamam de atividade de fortalecimento, o que significa "2 ou mais dias por semana" e "principais grupos musculares", exemplos do que conta (inclusive sem academia) e como anotar no registro do treino. Educativo, sem prescrever programa de treino.
- Keyword principal: `fortalecimento muscular quantas vezes por semana`; secundárias: `o que conta como treino de força`, `exercícios de fortalecimento muscular em casa`, `principais grupos musculares`.
- Intenção: entender o que conta como fortalecimento muscular nas recomendações e como acompanhar os dias da semana no registro, sem confundir com minutos de atividade aeróbica.
- Slug planejado: `fortalecimento-muscular-dias-semana-registro`. Cluster `rotina-integrada`.
- Distinta de `intensidade-moderada-vigorosa-teste-fala` (intensidade da atividade aeróbica; cita o fortalecimento só na lista das diretrizes), `atividade-fisica-semana-imprevisivel` e `passos-celular-treino-diferenca-registro`; nenhum post sobre fortalecimento muscular no INDICE.

## Estado: enviado ao Git (10/11/2026 ~18h25 BRT)

- Concorrência: fetch após a reserva (`5a14319`) e antes do push — nenhuma outra execução reservou ou publicou pauta do slot 18:00 de hoje.
- Título: "Fortalecimento muscular: quantas vezes por semana e o que conta como treino de força"; seoTitle "Fortalecimento muscular: quantas vezes por semana"; URL `https://ascende.site/blog/fortalecimento-muscular-dias-semana-registro/`. ~1.900 palavras. Exemplo fictício (150 min aeróbicos em 4 dias + fortalecimento terça e sexta = 2 dias; "um pote não enche o outro"). Sem prescrição de programa, carga ou séries; encaminha a profissional de educação física/saúde. Parágrafo de produto conferido em `Vitalidade.tsx` (cartão "Treino de hoje": descrição de até 80 caracteres e botões Peito, Costas, Pernas, Ombros, Braços, Core, Cardio; sem duração/séries/carga; meta em treinos por semana), `healthImport.ts` e `appleHealth.ts` — o app não classifica fortalecimento nem conta dias nem compara com diretriz.
- Motivo: dúvida durável de atividade física sem post próprio (o post de intensidade só cita o fortalecimento na lista das diretrizes); SERP em português (análise qualitativa, sem volume/posição) focada em musculação/hipertrofia, sem explicar o que conta, a contagem em dias e a lista oficial de grupos.
- Fontes abertas em 10/11/2026: OMS 2020 (Bull et al., BJSM, PMC7719906); CDC "What Counts as Physical Activity for Adults" (rev. 06/12/2023); CDC "Adult Activity: An Overview" (rev. 20/12/2023); Momma et al. 2022 (BJSM, meta-análise de coortes, lida na íntegra em cópia CC BY 4.0; link publicado é o DOI 10.1136/bjsports-2021-105061, que o ambiente não conseguiu abrir). Não abertos: Guia de Atividade Física para a População Brasileira (MS, 2021) — nada citado dele; PDF do HHS.
- Imagens (originais por código, HTML → Chromium → WebP; Inter SIL OFL 1.1; crédito Ascende): `grupos-musculares-fortalecimento.webp` 720×900 (+360×450) — figura humana geométrica de frente e de costas com os sete grupos do CDC, selo "Ilustração"; `dois-potes-semana.webp` 720×960 (+360×480) — dois potes de vidro (minutos aeróbicos x dias com fortalecimento), selo "Exemplo fictício". Formato visual: ilustração de corpo + potes, diferente de medidor/semana (08:15) e coluna/barras (12:00).
- Agentes: pesquisa (sonnet), redação (opus), imagens (sonnet), revisão factual independente (opus: NO-GO 21:17:53Z com 3 correções — frase atribuída à página certa do CDC, link do Momma pelo DOI, descrição da importação incluindo o export do Saúde — aplicadas pelo integrador, mais alt do exemplo fictício), revisão final independente do diff e da renderização (opus: GO 21:23:34Z — Chromium 390/1280 px, H1 único, byline, canonical, JSON-LD BlogPosting/FAQPage/BreadcrumbList com author Person, imagens com srcset, sem overflow, URL no sitemap e no feed).
- Testes locais: `blog:indice` (+1 linha), `blog:check` ok (63 posts), `npm run build` ok, `vitest src/lib/blog src/blog` 149/149. Build local não prova publicação.

## Estado: enviado ao Git — deploy não confirmado (10/11/2026 ~18h32 BRT)

- Commit `24aea36`, push sem force sobre `5a14319` (sem commits de terceiros no intervalo).
- [CI do commit](https://github.com/HenriPett/ascende/actions/runs/42904839021): job `verify` verde (TypeScript, lint, testes, edge functions, build); job `Privacidade do Social (RLS com usuários de verdade)` falhou no passo "As quatro revogações", como nos commits anteriores — fora do diff editorial. O workflow como um todo **não** está verde.
- Verificação pública bloqueada nesta sessão: `curl` para ascende.site e ascende.netlify.app sem conexão pelo proxy (HTTP 000) e a ferramenta de navegação recusou a URL (proveniência). **Publicação não confirmada**; promover a "publicado" só após observar `https://ascende.site/blog/fortalecimento-muscular-dias-semana-registro/`.
