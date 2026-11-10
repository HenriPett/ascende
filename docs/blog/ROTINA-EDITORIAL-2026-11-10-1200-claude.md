# Rotina editorial Ascende — 10/11/2026, 12h00 BRT (execução `2026-11-10-1200-claude`)

Rotina "Blogs SEO — meio-dia" (Claude, nuvem). Disparo recebido na terça 10/11/2026 às 12h04 BRT. Registro append-only.

## Estado: reservado (10/11/2026 ~12h15 BRT)

- HEAD-base: `f42784d41d7d45a229244eb6d6d32106cfd0d472`
- Pauta reservada: cheque especial do lado de quem usa — como funciona o limite da conta, teto de juros, IOF, oferta de parcelamento e por que o limite não é saldo; como registrar o uso no orçamento. Educativo, sem recomendar instituição, produto ou crédito.
- Keyword principal: `cheque especial como funciona`; secundárias: `juros do cheque especial`, `limite do cheque especial não é saldo`, `IOF cheque especial`.
- Intenção: entender como o cheque especial cobra juros e IOF e registrar o saldo negativo no orçamento sem tratá-lo como dinheiro disponível.
- Slug planejado: `cheque-especial-juros-limite-orcamento`. Cluster `alimentacao-orcamento`.
- Distinta de `limite-cartao-nao-e-saldo-orcamento` (cartão de crédito), `pagamento-minimo-fatura-rotativo-orcamento` (rotativo do cartão) e `tarifa-bancaria-extrato-pacote-servicos`; nenhum post sobre cheque especial no INDICE. Diferente do eixo treino usado às 08:15.

## Estado: enviado ao Git (10/11/2026 ~12h35 BRT)

- Concorrência: fetch antes da escolha, após a reserva (`779f2a2`) e antes do push — nenhuma outra execução reservou ou publicou pauta do slot 12:00 de hoje.
- Título: "Cheque especial: como funciona, quanto custa e como registrar no orçamento"; seoTitle "Cheque especial: como funciona, juros e IOF"; URL `https://ascende.site/blog/cheque-especial-juros-limite-orcamento/`. Intenção no INDICE: "como funciona o cheque especial, quanto custam juros e IOF e como registrar o saldo negativo no orçamento sem tratar o limite como saldo". ~1.900 palavras. Exemplo fictício (R$ 800 negativos por 12 dias a 7,9% a.m.: juros R$ 25,28 + IOF R$ 0,79 + R$ 3,04 = R$ 29,11; composto ≈ R$ 28,53). Sem CTA; parágrafo de produto conferido no código (`prosperidade.ts`, `ImportStatement.tsx`, `supabase/functions/import-statement/index.ts`): o app não se conecta ao banco nem lê saldo/limite; importação de fatura/extrato com confirmação, limitada no plano grátis.
- Motivo: dúvida financeira durável e recorrente sem post no blog; SERP em português (análise qualitativa, sem volume/posição) dominada por bancos/fintechs, sem a conta dia a dia e com conteúdo antigo ainda citando a tarifa derrubada pelo STF; distinta dos posts de cartão.
- Fontes abertas em 10/11/2026 (via ferramenta de leitura, que devolve resumo; curl bloqueado para gov.br): Res. CMN 4.765/2019 (PDF BCB, texto atualizado com revogação do art. 2º pela Res. 4.962/2021); gov.br 07/01/2020; BCB Relatório de Economia Bancária 2020, boxe 16; BCB Estudo Especial 84/2020; glossário do Relatório de Cidadania Financeira; STF notícia ADI 6.407 (2021) e notícia de 16/07/2025 (IOF, liminar); Decreto 6.306/2007 arts. 7º e 10 (cópia ANTTLegis; Planalto bloqueado); Dec. 12.499/2025 (Câmara); Res. CMN 4.881/2020; Febraban notícia 3179 e Agência Brasil 2018 (autorregulação do parcelamento); dados abertos BCB de taxas por instituição. Página `bcb.gov.br/estatisticas/txjuros` não abriu — o texto não afirma o nome da modalidade.
- Imagens (originais por código, HTML → Chromium → WebP; Inter SIL OFL 1.1; crédito Ascende): `linha-do-zero-cheque-especial.webp` 720×900 (+360×450) — ilustração da coluna de saldo com a linha do zero, limite como crédito e "valor usado" destacado; `custo-12-dias-cheque-especial.webp` 720×840 (+360×420) — gráfico de barras empilhadas do custo acumulado do exemplo fictício. Formato visual: coluna/ilustração + gráfico de barras, diferente de medidor/caderno (08:15) e calendário/prancheta (09/11).
- Agentes: pesquisa (sonnet), redação (opus), imagens (sonnet), revisão factual independente (opus: NO-GO 15:22:20Z com 4 correções — limite como crédito no texto e na imagem, juros compostos x total, restrição do plano grátis na importação, frase da modalidade no BCB — aplicadas pelo integrador e imagem refeita), revisão final independente do diff e da renderização (opus: NO-GO 15:26:52Z só pelo alt "Gráfico de linha" → "Gráfico de barras", corrigido e conferido no build; demais itens OK — Chromium 390/1280 px, H1 único, byline, canonical, JSON-LD BlogPosting/FAQPage/BreadcrumbList com author Person, imagens com srcset, sem overflow, URL no sitemap).
- Testes locais: `blog:indice` (+1 linha), `blog:check` ok (62 posts), `npm run build` ok, `vitest src/lib/blog src/blog` 149/149. Build local não prova publicação.

## Estado: enviado ao Git — deploy não confirmado (10/11/2026 ~12h45 BRT)

- Commit `aa5f366`, push sem force sobre `779f2a2` (sem commits de terceiros no intervalo).
- [CI do commit](https://github.com/HenriPett/ascende/actions/runs/42844778311): job `verify` verde (TypeScript, lint, testes, edge functions, build); job `Privacidade do Social (RLS com usuários de verdade)` falhou no passo "As quatro revogações", como nos commits anteriores — fora do diff editorial. O workflow como um todo **não** está verde.
- Verificação pública bloqueada nesta sessão: `curl` para ascende.site sem conexão pelo proxy (HTTP 000) e a ferramenta de navegação recusou a URL (proveniência). **Publicação não confirmada**; promover a "publicado" só após observar `https://ascende.site/blog/cheque-especial-juros-limite-orcamento/`.
