# Rotina editorial Ascende — 05/11/2026, 12h BRT

Estado local: **artigo revisado, candidato editorial; publicação pública ainda não verificada**.

- Base isolada `28f6797a7564393599dbe2ae6c3f1c6bfdbeed0a`, após `git fetch` e `pull --ff-only` da main. Remoto `HenriPett/ascende`; nenhuma alteração de outra execução foi descartada.
- Pauta: conferir se uma conta em débito automático foi efetivamente paga. Keyword qualitativa `débito automático conferir pagamento`; intenção: diferenciar cadastro, agendamento e débito efetivo, para evitar duplicidade. Diferente de fatura de cartão, tarifa bancária e assinaturas recorrentes. Pesquisa qualitativa encontrou páginas de serviços bancários e dúvidas oficiais; volume, ranking e tráfego **sem dado**.
- Slug `/blog/debito-automatico-conferir-pagamento-conta/`; título SEO `Débito automático: confira o pagamento da conta`; descrição, FAQ e resposta direta no Markdown. Links internos para orçamento variável e conciliação de fatura. CTA restrito ao registro de despesas que o código suporta.
- Fontes primárias consultadas 05/11: FAQ do Banco Central sobre autorização e cancelamento; página do BRB que diferencia débitos agendados e realizados. A página BRB descreve seu próprio serviço, não todos os bancos. Links diretos junto das afirmações.
- Arte: composição tipográfica original de três cartões, PNG 720×440 e variante 360×220, sem ativos de terceiros ou custo. Alt, legenda e crédito no artigo. Variante móvel inspecionada, legível e sem corte.
- Autoria do template: Henrique Pett, sem credenciais nem revisão profissional atribuídas.
- Revisão independente por agente Codex: GO editorial/factual/visual do rascunho e PNG. Testes locais: `blog:indice` 49 posts, `blog:check` 49 posts/186 imagens, build e 106 testes Vitest passaram. HTML gerado contém canonical, byline, JSON-LD, imagem e sitemap local.
- Antes do envio: revisão independente do diff final, fetch da main, somente commits editoriais, repetição de verificações. Push não comprova deploy nem indexação.
- Prévia local servida por HTTP em Chromium a 390 e 1280 px: H1 único, canonical correto, autoria visível, PNG carregado e sem overflow horizontal. Não é evidência de produção.

## Estado após envio — 05/11/2026, 12h BRT

- GO independente do diff final. `origin/main` permaneceu na base antes do envio; push sem force levou o artigo no commit `22324d30027c7c233f28779921964553fceaef8a` à main, confirmado por `git ls-remote` e pela página do commit no GitHub.
- Checks locais finais: `blog:check` 49 posts/186 imagens, build e 106 testes Vitest; render HTTP local em Chromium 390/1280 px sem overflow, com byline, canonical e imagem. Não foram observados checks da CI para este SHA: `gh` recebeu Forbidden na API e o conector GitHub retornou lista de status/runs vazia (o endpoint de runs do conector filtra PRs). Estado da CI **não confirmado**.
- URL planejada: `https://ascende.site/blog/debito-automatico-conferir-pagamento-conta/`. Página, imagem e sitemap públicos **não confirmados**: GET via proxy retornou CONNECT 403 e a ferramenta web não conseguiu abrir os endereços. Isso não comprova falha do site. Estado permanece **enviado à main**, sem evidência de deploy ou indexação.
