# EDITORIAL.md — o padrão do blog do Ascende

> Para quem escreve, revisa ou publica um post em `content/blog/`. O `npm run blog:check` cobra
> a parte mecânica deste documento; o resto é cobrado na revisão (checklist no fim).
> A régua de sempre vale aqui: `POSICIONAMENTO.md` e `PRINCIPIOS.md` vêm antes de qualquer
> ganho de tráfego. Um post que traz clique e saca a conta de confiança é prejuízo.

## 1. Para que serve o blog

Responder, com verdade e fonte, perguntas reais de quem quer arrumar **corpo e dinheiro ao mesmo
tempo, no orçamento apertado** (a Candidata A) — e mostrar, sem exagero, onde o Ascende ajuda.

- **Não** é canal de volume: um post bom por intenção vale mais que cinco parecidos.
- **Não** é vitrine do roadmap: só se fala do que o produto faz hoje.
- **Não** é conselho profissional: o blog informa e cita fontes; não prescreve dieta, treino,
  tratamento nem investimento.

## 2. Os três clusters (orientativos)

Os clusters organizam a escrita e os links internos. **Foram escolhidos pelo posicionamento, não por
demanda de busca medida:** ainda não temos dado quantitativo (volume, concorrência) que comprove
procura por eles. Quando houver dado real (Search Console depois de publicar), revisamos esta seção.

| `cluster`               | Do que trata                                                                                               | Ligação com o produto                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `rotina-integrada`      | Como sono, treino, alimentação, dinheiro e humor se afetam; registrar a vida sem virar escravo do app.     | A posição ("inteiro") e o registro numa frase |
| `alimentacao-orcamento` | Comer melhor gastando o que dá: mercado, preço, planejamento, inflação de alimentos.                       | A porta: o plano alimentar que cabe no bolso  |
| `ia-privacidade`        | O que uma IA pessoal deve e não deve fazer; dados sensíveis; por que não vendemos dados nem aceitamos ads. | `/recusas` e o modelo de assinatura           |

Fora dos três clusters não se publica sem decisão do fundador (teste da seção A do posicionamento:
"isso fortalece ou enfraquece o que eu sou?"). Assuntos que atraem as anti-personas — wearables e
40 métricas, IA-terapeuta, streak perfeito, wellness corporativo — ficam de fora.

## 3. Intenção: um post por pergunta

Cada post responde **uma** intenção de busca, escrita como a pessoa perguntaria
(ex. de forma: "como montar uma lista de mercado saudável com pouco dinheiro").

- `intent` é única em todo o histórico (`content/blog/INDICE.md`, gerado por `npm run blog:indice`).
  O check normaliza (minúsculas, sem acento, sem pontuação) e falha se repetir a de qualquer post,
  inclusive de posts antigos.
- Antes de escrever, leia o INDICE. Se a intenção já existe, **atualize o post antigo**
  (`dateModified`) em vez de criar outro.
- Intenções muito próximas (só sinônimos) também são duplicata, mesmo que o check não pegue:
  a revisão barra.

## 4. Frontmatter (esquema estrito)

Combinado com o pipeline (`src/lib/blog/`). Chave fora desta lista é **erro**.

```yaml
---
title: "Como montar uma lista de mercado saudável com pouco dinheiro"
seoTitle: "Lista de mercado saudável e barata" # opcional
description: "Um método em 4 passos para montar a lista do mês priorizando proteína e comida de verdade dentro do orçamento, com preços de referência e fontes."
slug: lista-de-mercado-saudavel-barata
datePublished: 2026-10-15
dateModified: 2026-11-02 # opcional
intent: "como montar uma lista de mercado saudável com pouco dinheiro"
cluster: alimentacao-orcamento
sources:
  - title: "Título exato do documento"
    url: https://fonte.oficial/caminho
    publisher: "Quem publicou"
    accessed: 2026-10-14
related: # opcional
  - outro-slug-ja-publicado
productPath: / # opcional
---
```

_(O bloco acima é só a forma dos campos; não é post nem fixture.)_

| Campo           | Obrigatório | Regra                                                                                                                        |
| --------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `title`         | sim         | 20–90 caracteres. É o `<h1>` e o `headline` do JSON-LD.                                                                      |
| `seoTitle`      | não         | ≤ 55 caracteres. O `<title>` é `(seoTitle ?? title) + " \| Ascende"`; se o `title` passa de 55, `seoTitle` vira obrigatório. |
| `description`   | sim         | 70–160 caracteres. Meta description e `og:description`. Aspas são permitidas (o template escapa).                            |
| `slug`          | sim         | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 60, igual ao nome do arquivo, único. **Imutável depois de publicado.**                         |
| `datePublished` | sim         | `AAAA-MM-DD`, data de calendário válida, ≤ hoje (America/Sao_Paulo). É o dia em que o post vai ao ar de fato.                |
| `dateModified`  | não         | `AAAA-MM-DD`, > `datePublished`, ≤ hoje. Só quando o conteúdo mudou de verdade (ver §8). Ausente = nunca mudou.              |
| `intent`        | sim         | 10–140 caracteres; única no histórico (§3).                                                                                  |
| `cluster`       | sim         | `rotina-integrada` \| `alimentacao-orcamento` \| `ia-privacidade`.                                                           |
| `sources`       | sim         | ≥ 1 item `{title, url (https), publisher, accessed (≤ hoje)}`; URL não repete no post.                                       |
| `related`       | não         | 0–3 slugs **já publicados**, sem o próprio.                                                                                  |
| `productPath`   | não         | `/` ou `/recusas` (padrão `/`). O link de produto do fim do artigo.                                                          |

**Proibidos:** `author`, `reviewedBy`, `medicalReview`, `rating`, `image` e qualquer outro. O autor é
sempre a organização Ascende, fixa no template. Não existe revisão por médico, nutricionista ou
consultor financeiro — então não existe campo para dizer que existe.

## 5. Padrões de title, description e slug

**title / seoTitle**

- Diz a resposta ou a promessa do texto, com a palavra que a pessoa buscaria no começo.
- Sem clickbait, sem número inflado ("o segredo", "nunca mais", "perca 10 kg"), sem caixa alta.
- Não repete o `title` de outro post.

**description**

- Uma frase que resume o que a pessoa leva do texto e por que confiar (método, fontes).
- Escrita para o resultado de busca e para a prévia do WhatsApp: termina sem "...".
- Nada de promessa de resultado (peso, dinheiro, saúde).

**slug**

- Português sem acento, só as palavras que importam (sem "como", "de", "o" quando não fazem falta),
  ≤ 60 caracteres. Ex.: `lista-de-mercado-saudavel-barata`.
- Sem data, sem número de ano (o post é atualizado, a URL fica).
- Escolhido uma vez. Mudar slug = quebrar link e histórico; o check falha se um slug do INDICE some.

## 6. Corpo do texto

- Sem `# ` no corpo: o H1 vem do `title`. Seções com `##`, subseções `###`, sem pular nível;
  `####` ou mais é recusado pelo check (o template não desenha).
- A resposta curta aparece nos primeiros parágrafos; o detalhe vem depois.
- Todo número, preço, recomendação de saúde ou dado de mercado tem fonte em `sources`, citada no
  trecho em que aparece. Preferência: órgãos públicos e fontes primárias (IBGE, DIEESE, Ministério da
  Saúde/Guia Alimentar, Banco Central, ANPD), estudos revisados por pares, documentação oficial.
  Blog de terceiro e post de rede social não são fonte.
- Saúde e dinheiro: informar, nunca prescrever. Quando o tema pede profissional (dieta para doença,
  dívida grave, sofrimento emocional), o texto diz isso com clareza — como o próprio produto faz.
- Sem conteúdo fictício: nada de depoimento, "caso de usuário", print fabricado ou de tela que não
  existe, número de usuários ou resultado médio. O Ascende ainda não tem esses dados publicados; se
  um dia tiver, entram com fonte. Captura da tela real é permitida, com dado de demonstração —
  nunca a vida de uma pessoa real, nem anonimizada (ver "Imagem", abaixo).
- Número de exercício explicitamente hipotético não tem fonte e não precisa — mas exige rótulo no
  início e no fim do bloco, e a pessoa do exemplo nunca tem nome (com nome, vira "caso de usuário").
- `accessed` significa "li o trecho citado nesta data", não "a URL respondeu". Página que carrega por
  JS é aberta renderizada antes de citar.
- A fonte sustenta o **fato**, nunca o produto. Nenhuma citação de IBGE, DIEESE, Guia Alimentar,
  Banco Central, ANPD ou estudo aparece na mesma frase, no mesmo parágrafo ou no bloco do CTA em que
  há afirmação sobre o Ascende. Autoridade de órgão público não se empresta a produto privado.
- Quando o post nomeia um recurso do Ascende+, diz na mesma frase o que o plano grátis faz.
  "Registrar a vida nunca terá preço" é contrato público — o blog repete isso ou não fala de plano.
- Sem placeholder: o check barra `lorem`, `ipsum`, `[inserir`, `placeholder`, `example.com`,
  `exemplo.com` (qualquer caixa) e `TODO`, `TBD`, `FIXME`, `XXX` (maiúsculos, palavra inteira —
  "todo dia" e "todos" passam).

### O que se pode dizer do produto (e o que não)

| Pode (existe hoje)                                                              | Não pode                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Registrar o dia numa frase — digitada, por voz, foto do prato ou WhatsApp       | Open Finance / fatura entrando sozinha (está "no radar — sem data e sem promessa")         |
| Plano alimentar no orçamento e o Blueprint (proposta que a pessoa confirma)     | App nativo / integração automática de sono e treino (idem)                                 |
| Cruzamento corpo × dinheiro, retrospectiva semanal; briefing diário no Ascende+ | Integração com wearable, banco ou app de nicho                                             |
| Grátis no essencial; Ascende+ por assinatura                                    | "A IA substitui médico/nutricionista/psicólogo/corretor" — ela não substitui               |
| Sem ads, sem venda de dados, fotos analisadas e descartadas (`/recusas`)        | Resultados ("usuários perdem X kg", "economizam R$ Y"), revisão profissional, prêmio, selo |

Na dúvida, o critério é **o produto em produção**: a afirmação só entra se quem revisa conseguir
abrir o app e fazer aquilo. A landing (incluindo a coluna "No radar") e `/recusas` são a segunda
conferência, nunca a primeira — landing é promessa, e promessa conferida contra promessa não está
conferida. Preço e limites de plano mudam — cite sem número ou
confira na landing no dia.

**Tom:** o da marca — direto, acolhedor, sem culpa. Nada de "você está falhando", contagem de
streak, urgência falsa ("só hoje"), medo como gancho, **culpa sobre o passado dela** ("você está
jogando dinheiro fora", "o que você gastou sem perceber") e **antes/depois de corpo**. Esses dois
últimos são o motivo de ela já ter desistido de outros apps — usá-los para trazê-la é vender a cura
com a doença.

**CTA no texto:** no máximo um por post, no fim, em forma de convite ("se quiser ver isso cruzado com
o seu orçamento, o Ascende faz numa frase"). O CTA descreve **o que o app faz**, nunca **o que a
pessoa vai conseguir**: sem "e você economiza", sem "e você volta a dormir". Post cujo assunto o
produto não resolve **não ganha CTA no texto** — fica sem, e a ausência é a prova de que o blog não
existe para vender. (O bloco institucional fixo do template, depois do artigo, não é CTA do texto:
descreve o app sem promessa de resultado e carrega o link de `productPath`.)

### Imagem

- Opcional. Entra quando mostra o que o texto explica (diagrama, captura da tela real com dado de
  demonstração) — nunca enfeite, banco de imagem ou foto de pessoa.
- Só arquivo local em `content/blog/img/<slug>/`, PNG, JPEG ou WebP, até 500 KB. Nada de SVG, de
  hotlink ou de imagem de terceiro sem licença declarada.
- Sozinha na linha: `![alt](./nome.png "Legenda. Crédito: Ascende.")`.
- **alt** (20–250): descreve o que a imagem mostra para quem não a vê; não repete a legenda nem
  começa com "imagem de".
- **legenda** (10–200): obrigatória, termina com o crédito. Imagem com número segue a regra das
  fontes: o número tem fonte em `sources`, citada no texto.
- Diagrama não leva número nem afirmação que o texto não sustente.
- Texto que importa não mora só na imagem: o que ela diz também está no parágrafo.
- Variante `nome-360.png` (360 px, mesma proporção) recomendada para o celular.
- O `og:image` continua `/icon-512.png`; a imagem do corpo não vira capa nem `image` no JSON-LD.

## 7. Links internos

Todo post publicado tem, no mínimo:

1. **Listagem:** a trilha "← Blog" no topo do artigo (vem do template) com link para `/blog/`; o
   `BreadcrumbList` completo (Ascende → Blog → título) vai no JSON-LD.
2. **Produto:** um link para `productPath` (padrão `/`; `/recusas` para o cluster `ia-privacidade`),
   no bloco institucional do template.
3. **Relacionados:** `related` com 1–3 posts **do mesmo cluster** quando já existirem; com o primeiro
   post de um cluster, o campo fica vazio — nunca se aponta para post que não existe.
4. **No texto:** link contextual para outro post só quando ajuda quem lê (texto âncora descritivo,
   nunca "clique aqui").

Formato aceito pelo check: `/blog/`, `/blog/<slug>/` de post existente e as rotas públicas
(`/`, `/recusas`, `/privacidade`, `/termos`, `/aviso-legal`). Rotas logadas do app não entram.
Externos só `https://`. URLs com barra final, iguais à canonical.

Ao publicar um post novo, revise os 1–3 posts mais próximos do mesmo cluster e acrescente o novo em
`related` deles se fizer sentido (isso é edição de link, não de conteúdo — não mexe em `dateModified`).

## 8. Datas

- `datePublished` = dia em que o post vai ao ar em produção. Nunca retroativa, nunca futura.
- `dateModified` só para mudança de conteúdo (informação nova, correção de fato, fonte atualizada).
  Corrigir vírgula, link ou `related` não conta.
- Nada de "atualizado em" automático pelo build.

## 9. Saída esperada (o que a revisão de HTML confere)

**Artigo — `https://ascende.site/blog/<slug>/`**

- `<html lang="pt-BR">`; `<title>`; meta description; `<link rel="canonical">` com barra final.
- OG: `og:type=article`, `og:url` = canonical, `og:title`, `og:description`,
  `og:image=https://ascende.site/icon-512.png`, `og:locale=pt_BR`, `og:site_name=Ascende`;
  `article:published_time` (e `article:modified_time` só se houver `dateModified`); `twitter:card=summary`.
- Um único `<h1>`; data visível em `<time datetime="AAAA-MM-DD">`; texto completo no HTML (sem JS).
- JSON-LD `BlogPosting`: `headline`, `description`, `datePublished`, `dateModified` só se existir,
  `inLanguage: pt-BR`, `url` e `mainEntityOfPage` = canonical, `author` e `publisher` =
  `{"@type":"Organization","name":"Ascende","url":"https://ascende.site/"}`, `isPartOf` o Blog.
  Mais um `BreadcrumbList` (Ascende → Blog → título). Proibido: `Person`, `reviewedBy`,
  `aggregateRating`, `image` inventada.
- Imagem do corpo: `<figure>` com `<img src width height srcset sizes alt loading="lazy"
  decoding="async">` e `<figcaption>` com a legenda; arquivo servido de `/blog/<slug>/`.

**Listagem — `https://ascende.site/blog/`**

- canonical com barra, `og:type=website`, JSON-LD `Blog` com `publisher` Organization e `blogPost`
  (headline, url, datePublished), posts do mais novo para o mais antigo.

**Sitemap — `dist/sitemap.xml`** gerado no build: as 5 URLs públicas de sempre + `/blog/` + cada post,
com `<lastmod>` = `dateModified ?? datePublished`. **Sem posts: nem `/blog/` no sitemap, nem página
`/blog` gerada, nem link "Blog" na navegação.** Fixture nunca chega ao `dist` de produção.

**Feed — `dist/blog/feed.xml`** (RSS 2.0), anunciado por `<link rel="alternate" type="application/rss+xml">`
na listagem e nos artigos.

Nada de `noindex` em produção; `robots.txt` aponta para o sitemap.

## 10. Checklist de publicação

Antes do commit `post(blog): <slug>`:

- [ ] A intenção não está no `content/blog/INDICE.md` (nem um sinônimo dela).
- [ ] Cluster é um dos três e o tema serve a Candidata A (não atrai anti-persona).
- [ ] `title`, `seoTitle`, `description` e `slug` seguem a §5.
- [ ] `datePublished` = hoje (dia real da publicação).
- [ ] Cada número, preço e afirmação de saúde/dinheiro tem fonte em `sources`, aberta e conferida
      na data de `accessed`.
- [ ] Nenhuma afirmação de produto fora da coluna "Pode" da §6; nada de resultado, depoimento,
      revisão profissional ou integração inexistente.
- [ ] Texto não prescreve; indica profissional quando o tema pede.
- [ ] Nenhuma fonte citada no mesmo parágrafo de afirmação sobre o produto; CTA sem citação.
- [ ] Se o post cita o Ascende+, diz o que o grátis faz; se o produto não resolve o assunto, o post
      não tem CTA no texto.
- [ ] Toda afirmação de produto foi conferida abrindo o app em produção.
- [ ] Links internos da §7 presentes; `related` só com posts publicados.
- [ ] Imagem (se houver): local, alt descritivo, legenda com crédito, texto também no parágrafo.
- [ ] `npm run blog:check` passa; `npm run blog:indice` atualizado; build passa.
- [ ] Depois do deploy: a URL responde 200 com o artigo no HTML (sem JS), canonical certa, e aparece
      no `https://ascende.site/sitemap.xml`.
