# Rotina editorial Ascende — 11/11/2026, 12h00 BRT (execução `2026-11-11-1200-claude`)

Rotina "Blogs SEO — meio-dia" (Claude, nuvem). Disparo recebido na quarta 11/11/2026 às 12h04 BRT. Registro append-only.

## Estado: reservado (11/11/2026 ~12h15 BRT)

- HEAD-base: `6ef0957d2cc49b56ea6e54f1475681dd9b2e9120`
- Pauta reservada: quantas horas de sono um adulto precisa — o que dizem as recomendações de consenso (faixa por idade, "pelo menos 7 horas" para adultos), por que a necessidade varia, diferença entre tempo na cama e tempo dormindo, e como observar a própria média no diário do sono. Educativo, sem diagnóstico nem tratamento.
- Keyword principal: `quantas horas de sono um adulto precisa`; secundárias: `horas de sono recomendadas por idade`, `dormir 6 horas é suficiente`, `tempo na cama e tempo de sono`.
- Intenção: saber quantas horas de sono são recomendadas para adultos e como comparar a própria média semanal com a recomendação sem confundir tempo na cama com sono.
- Slug planejado: `quantas-horas-sono-adulto-precisa`. Cluster `rotina-integrada`.
- Distinta de `diario-sono-registrar-horarios` (como montar o diário), `cochilo-durante-dia-duracao-sono-noite`, `jet-lag-social-sono-fim-de-semana`, `sono-turnos-horarios-variaveis` e `cafeina-sono-horario-ultimo-cafe`; nenhum post responde à duração recomendada. Diferente do eixo finanças usado às 08:15.

## Estado: enviado ao Git (11/11/2026 ~12h30 BRT)

- Concorrência: fetch antes da escolha, após a reserva (`d9ac9d5`) e antes do push — nenhuma outra execução reservou ou publicou pauta do slot 12:00 de hoje.
- Título: "Quantas horas de sono um adulto precisa e como comparar a sua média"; seoTitle "Quantas horas de sono um adulto precisa"; URL `https://ascende.site/blog/quantas-horas-sono-adulto-precisa/`. ~2.100 palavras. Exemplo fictício de uma semana (tempo na cama médio 7h45, sono estimado 6h57, noites de trabalho 6h34, ~90% do tempo na cama dormindo). Sem CTA; parágrafo de produto conferido no código (`src/pages/Vitalidade.tsx`, `src/components/core/SleepSchedule.tsx`, `SleepCheckin.tsx`, `src/lib/sleep.ts`): registro de horas de noite/soneca, meta de sono, rotina de sono que atualiza a meta, "Segui" registra a janela inteira (próxima do tempo na cama); o app não separa tempo na cama de sono nem avalia adequação.
- Motivo: dúvida de sono durável e muito buscada sem post no blog (os posts de sono tratam de diário, cochilo, jet lag social, turnos e cafeína); SERP em português (análise qualitativa, sem volume/posição) com tabelas por idade repetidas e pouca distinção entre tempo na cama e tempo dormindo; Vigitel 2025 trouxe os primeiros dados nacionais de sono.
- Fontes abertas em 11/11/2026: consenso AASM/SRS 2015 (Watson et al., PDF aasm.org); NSF 2015 (Hirshkowitz et al., resumo WUSTL; comunicado EurekAlert 02/02/2015); NSF 10/06/2026 (thensf.org/sleep-duration); CDC "About Sleep" (revisada 20/11/2023); Carney et al. 2012, diário do sono de consenso (cópia CORE); Lauderdale et al. 2008 (PubMed 18854708); Agência Gov 28/01/2026 (Vigitel 2025); página Vigitel do Ministério da Saúde; NHLBI sintomas de apneia (09/01/2025). Não abriram: PubMed 25979105 e 22294820 e PMC (captcha); nenhuma página verificável da Associação Brasileira do Sono — não citada.
- Imagens (originais por código, HTML/SVG → Chromium → WebP; Inter SIL OFL 1.1; crédito Ascende): `faixas-sono-adultos.webp` 720×1060 (+360×530) — gráfico de faixas horizontais por idade (recomendado × "pode ser adequado" NSF; seta aberta AASM "7 h ou mais"); `tempo-cama-tempo-dormindo.webp` 720×900 (+360×450) — ilustração lateral de cama, "Exemplo fictício", 8 h na cama como cobertor com blocos de sono e despertares. Formato visual: gráfico de faixas + ilustração editorial, diferente de barras/coluna (10/11) e do eixo das 08:15.
- Agentes: pesquisa/redação/imagens (opus); revisão factual independente (opus: NO-GO 15:20:36Z por uma frase sobre o diário de Carney — corrigida pelo integrador, com sugestões aplicadas: "podem funcionar" + link NSF 2026, link NSF 2015, nota de que salvar a rotina atualiza a meta, cabeçalho da tabela); revisão final independente do diff e da renderização (opus: NO-GO 15:26:06Z só pela frase que descrevia as colunas da tabela, corrigida e conferida no build; demais itens OK — Chromium 390/1280 px, H1 único, byline, canonical, JSON-LD BlogPosting com author Person, FAQPage, imagens com srcset, sem overflow, URL no sitemap).
- Testes locais: `blog:indice` (+1 linha), `blog:check` ok (65 posts), `npm run build` ok, `vitest src/lib/blog src/blog` 149/149. Build local não prova publicação.

## Estado: enviado ao Git — deploy não confirmado (11/11/2026 ~12h40 BRT)

- Commit `88048ab`, push sem force sobre `d9ac9d5` (sem commits de terceiros no intervalo).
- [CI do commit](https://github.com/HenriPett/ascende/actions/runs/43048597352): job `verify` verde (TypeScript, lint, testes, edge functions, build); job `Privacidade do Social (RLS com usuários de verdade)` falhou no passo "As quatro revogações", como nos commits anteriores — fora do diff editorial. O workflow como um todo **não** está verde.
- Verificação pública bloqueada nesta sessão: `curl` para ascende.site sem conexão pelo proxy (HTTP 000) e a ferramenta de navegação recusou a URL (proveniência). **Publicação não confirmada**; promover a "publicado" só após observar `https://ascende.site/blog/quantas-horas-sono-adulto-precisa/`.
