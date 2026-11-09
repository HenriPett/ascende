# Rotina editorial Ascende — 09/11/2026, execução `2026-11-09-1200-claude`

Rotina "Blogs SEO — meio-dia" (Claude, nuvem). Disparo recebido na segunda 09/11/2026 às 12h06 BRT. Registro append-only.

## Estado: reservado (09/11/2026 ~12h15 BRT)

- HEAD-base: `31d731bc4ae759d768f5a39cfcef1eb26b99019a`
- Pauta reservada: Pix Automático do lado de quem paga — o que é a autorização, como consultar, ajustar limite e cancelar no app do banco, diferença para Pix agendado/recorrente e débito automático, e como registrar a cobrança recorrente no orçamento. Educativo, sem recomendar instituição ou produto.
- Keyword principal: `pix automático`; secundárias: `cancelar pix automático`, `autorização pix automático`, `pix automático limite`.
- Intenção: como conferir, limitar e cancelar uma autorização de Pix Automático e registrar a cobrança recorrente no orçamento.
- Slug planejado: `pix-automatico-autorizacao-cancelar-orcamento`. Cluster `alimentacao-orcamento`.
- Distinta de `pix-agendado-comprovante-pagamento` (comprovante x execução de Pix agendado), `debito-automatico-conferir-pagamento-conta` e `assinaturas-cobrancas-recorrentes-revisar`; nenhum post sobre Pix Automático no INDICE. A reserva `restaurante-quilo-tara-peso-prato` (outra rotina das 08:15) foi evitada.

## Estado: enviado ao Git (09/11/2026 ~12h32 BRT)

- Concorrência: fetch antes da escolha e antes do push — nenhum outro commit/registro do slot 12:00 de hoje; main sem avanço desde a reserva (`8df3690`).
- Título: "Pix Automático: como conferir, limitar e cancelar a autorização"; seoTitle "Pix Automático: conferir, limitar e cancelar"; URL `https://ascende.site/blog/pix-automatico-autorizacao-cancelar-orcamento/`. ~1.850 palavras de corpo. Sem CTA; parágrafo de produto conferido em `Prosperidade.tsx`/`prosperidade.ts` ("Fixos do mês (recorrentes)", dia 1–28, pausar/excluir; o app não se conecta ao banco nem lê autorizações de Pix Automático).
- Motivo da escolha: serviço do BCB em operação desde 16/06/2025, dúvida prática e recorrente de quem paga (consultar, limitar, cancelar, prazos), sem post no blog; complementa débito automático, Pix agendado e assinaturas sem canibalizar. Análise de busca qualitativa, sem volume/posição.
- Fontes abertas em 09/11/2026 (BCB): FAQ Pix Automático (itens 1.3, 4.4, 4.11, 4.13, 4.17, 4.18, 4.21, 5.2, 5.3, 5.9, 5.12, 6.4, 6.5, 6.7, 6.13), Guia de implementação do Pix Automático v1.3 (5.1, 6.3), apresentação Circuito Pix, Fórum Pix 07/12/2023 (sinalizado como material de 2023), Requisitos Mínimos v7.3; Agência Brasil 04/06/2025; gov.br (reclamação ao BC; Consumidor.gov.br). Res. BCB 402/2024 não aberta em fonte oficial — não citada.
- Imagens (originais por código, HTML → Chromium → WebP; Sora SIL OFL 1.1 + Inter SIL OFL 1.1; texto ≥ 24 px no arquivo de 720): `calendario-cobranca.webp` 720×960 (+360×480) — calendário de parede com régua de horas do dia do débito; `ficha-autorizacao.webp` 720×1040 (+360×520) — prancheta com ficha dos campos a conferir, com selo "Ilustração: não é tela de banco". Formato visual: calendário de parede + prancheta, diferente das barras/caderno da manhã.
- Agentes: pesquisa (sonnet), redação (opus), imagens (sonnet), revisão factual independente (opus: NO-GO 15:24:06Z — crédito vem habilitado por padrão — → GO 15:27:53Z), ajuste de duas frases pelo integrador (retentativas definidas pela empresa, Guia 5.1), revisão final independente do diff e da renderização (opus: GO 15:31:26Z — Chromium 390/1280 px, H1 único, byline, canonical, JSON-LD BlogPosting/FAQPage/BreadcrumbList, imagens carregadas, sem overflow, URL no sitemap).
- Testes locais: `blog:indice` (+1 linha), `blog:check` ok (57 posts), `npm run build` ok, `vitest src/lib/blog src/blog` 149/149. Build local não prova publicação.

## Estado: enviado ao Git — deploy não confirmado (09/11/2026 ~12h37 BRT)

- Commit `792f7b7`, push sem force sobre `8df3690` (sem commits de terceiros no intervalo).
- [CI do commit](https://github.com/HenriPett/ascende/actions/runs/42645651440): job `verify` verde (TypeScript, lint, testes, edge functions, build); job `Privacidade do Social (RLS com usuários de verdade)` falhou no passo "As quatro revogações", como nos commits anteriores (`8df3690`, `31d731b`) — fora do diff editorial. O workflow como um todo **não** está verde.
- Verificação pública bloqueada nesta sessão: `curl` na URL retornou falha de túnel (código 000) e a ferramenta de navegação recusou a URL (proveniência). **Publicação não confirmada.**
