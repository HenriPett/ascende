# Como publicar um post no blog do Ascende

Este é o mecanismo das execuções editoriais (rotina 08:15, 12:00 e 18:00, de segunda a sexta). Ele vale para gente e
para agente. **O que** escrever, com que título, que fontes e que links está em
[`EDITORIAL.md`](./EDITORIAL.md). Este arquivo diz **como** o texto vira página no ar sem quebrar nada.

> **Regra que não se negocia:** só vai ao ar texto pesquisado e pronto. Rascunho, texto de teste e fixture nunca
> entram em `content/blog/`. Sem post, o blog não existe em público: nem `/blog`, nem link no site, nem entrada no
> sitemap.

---

## O caminho, do texto à URL

```
texto pesquisado → content/blog/<slug>.md → npm run blog:indice → npm run blog:check
   → npm run build → (checks) → commit "post(blog): <slug>" → push para main
   → Netlify publica → conferir a URL em produção
```

### 1. Criar o arquivo

`content/blog/<slug>.md`. O nome do arquivo **é** o slug. O arquivo começa com o frontmatter em YAML, entre `---`:

```yaml
---
title: O H1 do artigo, de 20 a 90 caracteres
seoTitle: Opcional — até 55; obrigatório se o title passar de 55
description: De 70 a 160 caracteres. Vira a meta description e o og:description.
slug: igual-ao-nome-do-arquivo
datePublished: 2026-10-14        # o dia em que vai ao ar DE FATO (fuso de São Paulo)
dateModified: 2026-10-20         # só se mudou depois; ausente = nunca mudou
intent: a pergunta ou busca que este post responde
cluster: rotina-integrada        # rotina-integrada | alimentacao-orcamento | ia-privacidade
related: [outro-slug]            # 0 a 3 slugs que existem
productPath: /                   # / ou /recusas — o link de produto do fim
sources:
  - title: Título da fonte
    url: https://...
    publisher: Quem publicou
    accessed: 2026-10-13         # quando alguém de fato leu
---
```

Depois do segundo `---` vem o corpo, em Markdown: `##` e `###` (o H1 é o `title`), parágrafos, listas, **negrito**,
links, citações e imagens (abaixo).

O esquema é **estrito**: chave fora da lista é erro. `author`, `reviewedBy`, `medicalReview`, `rating` e `image` são
recusados nominalmente, porque o Ascende não tem autor-pessoa, revisão profissional nem avaliação para declarar — e o
`og:image` é sempre `/icon-512.png`; imagem do artigo vai no **corpo**, não no frontmatter. O autor é sempre a
Organization "Ascende", fixo no template.

#### Imagem no corpo

Só imagem **local**, na pasta do próprio post: `content/blog/img/<slug>/<nome>.png` (ou `.jpg`, `.webp`). No corpo,
**sozinha na linha**, com alt e legenda:

```markdown
![O que a imagem mostra, para quem não a vê](./nome.png "Legenda com o crédito. Crédito: Ascende.")
```

- **alt** (20 a 250 caracteres): descreve o conteúdo, não "imagem de…".
- **legenda** (10 a 200, o texto entre aspas): obrigatória, com o crédito. Vira o `<figcaption>`.
- **variante opcional** `nome-360.png`, ao lado: a mesma imagem com **360 px** de largura e a mesma proporção. Entra
  no `srcset` para o celular baixar menos.
- **até 500 KB** por arquivo. Nada de SVG, de URL externa, nem de caminho fora da pasta do post.

Largura e altura **não** se escrevem: o build lê do cabeçalho do arquivo e põe no `<img width height>` (sem salto de
layout ao carregar). A extensão tem de bater com o formato real. Os arquivos são copiados para
`dist/blog/<slug>/`, ao lado do `index.html` — a URL pública é `/blog/<slug>/nome.png`. Na pasta do post fica só o que o
texto usa: arquivo que nenhuma imagem referencia é erro.

### 2. Registrar no histórico — `npm run blog:indice`

Atualiza `content/blog/INDICE.md`: uma linha por URL já publicada, com slug, intenção, cluster e datas. O comando só
escreve se o post passar. **Confira o diff do INDICE**: deve ser exatamente uma linha nova (ou a data de modificação
de um post existente).

### 3. Checar — `npm run blog:check`

Recusa, com motivo e linha:

| regra | por quê |
|---|---|
| frontmatter fora do esquema, ou tamanhos fora dos limites | title, description e slug são o que a busca mostra |
| data que não existe (`2026-02-30`) ou no futuro de São Paulo | data inventada não entra; "hoje" é o dia de Brasília, não o de UTC |
| `dateModified` que não é depois de `datePublished` | |
| slug repetido, ou diferente do nome do arquivo | |
| **intenção repetida** — entre os posts **ou contra o histórico** (sem acento, caixa ou pontuação) | é o que impede a duplicata: o mesmo assunto com outro título |
| post publicado cujo arquivo sumiu, ou `datePublished` de post publicado reescrito | URL que já saiu não some nem muda de dia em silêncio |
| post fora do INDICE, ou INDICE desatualizado | rode o passo 2 |
| `related` ou link interno que não resolve | só `/blog/`, `/blog/<slug>/` que existe, `/`, `/recusas`, `/privacidade`, `/termos`, `/aviso-legal` (com `#âncora`, se quiser) |
| link externo que não é `https://` | |
| `# ` no corpo, título que pula nível, `####` ou mais | o template desenha só `##` e `###` |
| imagem fora da linha própria, sem alt descritivo (20–250) ou sem legenda (10–200), externa, SVG, ou fora de `./<nome>.(png\|jpg\|webp)` | é desenhada como `<figure>`; o alt é para quem não vê, a legenda leva o crédito |
| arquivo de imagem ausente, acima de 500 KB, ilegível, ou com extensão que não é o formato real | as dimensões vêm do cabeçalho; sem elas não há `width`/`height` |
| variante `-360` com outra largura, outra proporção, ou não mais estreita | o `srcset` promete a mesma imagem |
| arquivo em `content/blog/img/<slug>/` que o texto não usa, ou pasta sem post | nada vai para `dist/` sem estar no texto |
| marcador de texto não pronto | `lorem`, `ipsum`, `[inserir`, `placeholder`, `example.com`, `exemplo.com` em qualquer caixa; `TODO`, `TBD`, `FIXME`, `XXX` só em MAIÚSCULAS e palavra inteira (em minúsculas, "todo dia" é português) |

**Erro em um post não publica nenhum.** O build do blog é tudo ou nada: metade do blog no ar é pior que um build que
falha, porque ninguém nota a metade que faltou.

### 4. Build — `npm run build`

`vite build` e, em seguida, `node scripts/blog.mjs build --out dist`, que roda o mesmo check e escreve:

- `dist/blog/index.html` — a listagem;
- `dist/blog/<slug>/index.html` — cada artigo, com o HTML **renderizado** (lido sem JavaScript), `<title>`,
  description, canonical com barra final, Open Graph e JSON-LD (`BlogPosting` + `BreadcrumbList`; `Blog` na listagem);
- `dist/blog/feed.xml` — RSS 2.0;
- `dist/blog/<slug>/<imagem>` — as imagens do post (e a variante `-360`), byte a byte como estão em `content/`;
- `dist/blog/tema.js` — o único JS das páginas do blog (aplica o tema escuro; a página funciona sem ele);
- `dist/sitemap.xml` — as 5 páginas públicas de sempre + `/blog/` + cada post, com `lastmod` da data real.

E o link "Blog" aparece no site (rodapé e topo da landing) porque `vite.config.ts` conta os posts e liga
`__BLOG_TEM_POSTS__`.

**Com 0 posts**, o mesmo comando escreve só `dist/sitemap.xml` — idêntico, byte a byte, ao sitemap de antes do blog —
e apaga qualquer `dist/blog/` de um build anterior.

### 5. Commit e publicação

- Um commit por post: `post(blog): <slug>`, com o `.md`, o `INDICE.md` e a pasta `content/blog/img/<slug>/` (se
  houver) **juntos**.
- Push para `main`. O Netlify roda `npm run build` e publica `dist/`.

### 6. Conferir em produção

```sh
curl -sI https://ascende.site/blog/<slug>/ | head -1                        # 200
curl -s  https://ascende.site/blog/<slug>/ | grep -o '<link rel="canonical"[^>]*>'
curl -s  https://ascende.site/sitemap.xml  | grep -c '<loc>'                 # 5 + 1 + nº de posts
curl -s  https://ascende.site/blog/feed.xml | grep -c '<item>'               # nº de posts
```

O HTML tem de chegar com o texto do artigo **dentro** (não o shell da SPA). Se chegar o shell, a regra `/*` do
`netlify.toml` ganhou `force = true` — ela não pode ter isso.

---

## Ver antes de publicar — `npm run blog:preview`

Gera um site completo em `dist-preview/` (fora do `dist/`, ignorado pelo git) com os posts de
`src/lib/blog/fixtures/posts/`. Serve para olhar templates e conferir HTML, JSON-LD e sitemap sem nada ir ao ar.
`npm run preview -- --outDir dist-preview` abre no navegador.

O script **recusa** levar qualquer pasta que não seja `content/blog/` para o `dist/`: fixtures nunca chegam à produção.

## Corrigir um post publicado

Edite o texto, ponha `dateModified` com o dia da mudança (em São Paulo), rode `npm run blog:indice` e
`npm run blog:check`. O `datePublished` **não muda**: o check recusa. O slug também não: URL publicada é URL que já
circula.

## Tirar um post do ar

É decisão explícita, nunca efeito colateral. Apague o arquivo **e** a linha dele no `INDICE.md`, no mesmo commit, com o
motivo na mensagem (`post(blog): retira <slug> — <motivo>`). Só apagar o arquivo faz o check falhar de propósito.

Uma vez retirado, a intenção dele continua valendo para o check? Não: a linha saiu do INDICE. Se o motivo foi
"duplicava outro", deixe isso escrito na mensagem do commit.

## Onde mora cada coisa

| o quê | onde |
|---|---|
| posts e histórico | `content/blog/*.md`, `content/blog/INDICE.md` |
| imagens dos posts | `content/blog/img/<slug>/` |
| esquema, check, INDICE, sitemap, RSS, pipeline | `src/lib/blog/` (tipos.ts, post.ts, checagem.ts, indice.ts, sitemap.ts, pipeline.ts, imagem.ts) |
| templates e `<head>` | `src/blog/` (render.tsx, paginas.tsx) |
| o comando | `scripts/blog.mjs` (carrega o TypeScript pela API do Vite; sem dependência nova) |
| as 5 páginas públicas do sitemap | `PAGINAS_PUBLICAS` em `src/lib/blog/sitemap.ts` — rota pública nova entra **ali** |
| testes e fixtures | `src/lib/blog/blog.test.ts`, `src/lib/blog/fixtures/` |
| padrão editorial | `docs/blog/EDITORIAL.md` |
