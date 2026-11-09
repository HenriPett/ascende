# Recuperação do rascunho de vale-alimentação — 09/11/2026

- Rascunho de 06/11 recuperado da página privada autorizada no Space. Texto original SHA-256 `41e7e5063ace080bd8a43239634ece7ff10b6c35744543147fae75f377736918`.
- Publicação autorizada por Henrique na main, com pull antes. Pull ff-only sobre `ff1e9ea`, sem alterações concorrentes no início.
- Intenção distinta de saque, cartão e fatura; sem reserva concorrente localizada. Tara de restaurante já publicada e não duplicada.
- Revisão independente por `revisar_vale_alimentacao`: GO factual, editorial e visual em 09/11. MTE e SUSEP reabertos; contas fictícias conferidas. Datas ajustadas para a primeira publicação real em 09/11; título SUSEP corrigido.
- Imagem decorativa `beneficio-mesa` excluída do release, originais preservados na recuperação. Recibo e dois cartões mantidos após o exemplo, com alt fiel. Retirada alegação de produto que não pôde ser validada em sessão de produção.
- Markdown final SHA-256 `b2553e23a51dae4e55e71e272ac2149a469e491c06d414dc3959ad408ab3a484`.
- QA: blog:check 59 posts/220 imagens, build, typecheck e 1173 testes passaram. Lint sem erros, com sete avisos preexistentes. Desktop e iframe responsivo de 390 px (375 úteis), sem overflow; imagem e variante móvel carregadas. Deno/Postgres não executados localmente; checks remotos pendentes.
- URL planejada: https://ascende.site/blog/vale-alimentacao-orcamento-saldo-gasto/. Ainda sem observação pública neste registro; push não prova deploy ou indexação.

## Publicação observada em 2026-11-09T16:29:47Z

- Commit editorial `0243f95f4a2545a1ef64dc91ff3c2c2930a5b79f` confirmado em origin/main, árvore `4334b8e2a194765a5d2b4d870b9b2b519d30641e` idêntica à revisada. Atualização fast-forward com SHA esperado, sem force.
- Navegador de produção abriu o artigo completo na URL planejada, com H1, title, description, canonical absoluto, autoria Henrique Pett, data real 09/11, BlogPosting/FAQPage/BreadcrumbList e imagem carregada. Sem meta noindex. Sitemap público inclui a URL. Indexação em buscadores: SEM DADO.
- CI exato do commit: verify PASS, inclusive TypeScript/testes das edge functions, build e higiene. Job Privacidade do Social FAIL em 1/57: “19 autoteste estrutural: 21 o canal do sino autoriza alguém”. O próprio teste descreve falha de funcionamento realtime, não evidência de vazamento. Nenhuma alteração em Supabase ou workflow neste release. [Execução](https://github.com/HenriPett/ascende/actions/runs/42654872942).
- Não confundir conclusão da publicação editorial com CI global totalmente verde.

- GET HTTP independente confirmou status 200 nas duas páginas em 09/11/2026, sem cabeçalho X-Robots-Tag.
