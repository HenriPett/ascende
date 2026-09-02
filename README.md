# Ascende — O app que vê a sua vida inteira

Você conta seu dia numa frase ("gastei 47 no mercado, treinei pernas e dormi 6h") e o Ascende registra tudo nos lugares certos. Corpo, dinheiro, alimentação e mente no mesmo lugar, com um Conselheiro que monta, por exemplo, o plano alimentar que cabe no seu orçamento — porque é o único que conhece os dois lados.

E o que você já registrou em outros aplicativos vem junto: o export do app Saúde do iPhone entra inteiro, e há leitura de CSV de apps de sono, treino, peso e alimentação (veja [Importar histórico de outros aplicativos](#importar-histórico-de-outros-aplicativos)).

Este guia leva você do zero ao app no ar, **mesmo que você nunca tenha feito isso antes**. São 5 passos. Reserve ~30 minutos.

---

## O que você vai precisar

| Serviço                                                       | Para quê                              | Custo                                |
| ------------------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| [Supabase](https://supabase.com)                              | Banco de dados, login e funções de IA | Grátis (plano free)                  |
| [Anthropic](https://console.anthropic.com)                    | A inteligência artificial (Claude)    | Pago por uso (centavos por conversa) |
| [Netlify](https://netlify.com)                                | Hospedar o site                       | Grátis                               |
| [Node.js 20+](https://nodejs.org) instalado no seu computador | Rodar os comandos dos passos 4 e 5    | Grátis                               |

---

## Passo 1 — Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie uma conta (pode usar o GitHub ou Google).
2. Clique em **New project**.
3. Dê o nome **ascende**, crie uma senha de banco (guarde-a) e escolha a região **South America (São Paulo)**.
4. Aguarde 1–2 minutos até o projeto ficar pronto.

## Passo 2 — Criar as tabelas do banco

1. No painel do Supabase, abra **SQL Editor** (ícone de terminal no menu lateral).
2. Abra o arquivo **`supabase/setup.sql`** desta pasta no Bloco de Notas, selecione TUDO (Ctrl+A) e copie.
3. Cole no SQL Editor e clique em **Run**.
4. Deve aparecer "Success. No rows returned".
5. **Ainda falta um pedaço.** O `setup.sql` é a linha de base; o que veio
   depois dele vive em `supabase/migrations/`. Abra cada arquivo `.sql` daquela
   pasta **em ordem de nome** (eles começam com a data) e rode um por um, do
   mesmo jeito. São poucos, e todos podem ser rodados de novo sem estragar nada.

   Sem este passo o app sobe, mas as **tendências** (a seção "O que andou
   junto", em Indicadores) e o **Mokari** não funcionam — as tabelas delas
   nascem nas migrações, não no `setup.sql`.

   Se você usa o Supabase CLI, os dois passos viram um: `npx supabase db push`.

6. **Por último, rode `supabase/whatsapp_e_metas.sql`** do mesmo jeito (copiar,
   colar no SQL Editor, **Run**). Ele cria as tabelas do canal de WhatsApp e das
   metas. Ele fica fora de `migrations/`, então nem o passo 5 nem o `db push` o
   executam — se você pular, o app sobe, mas o WhatsApp não funciona.

Pronto — banco criado, com segurança (RLS) já configurada.

> 💡 **Opcional, recomendado para testar sem fricção:** em **Authentication → Sign In / Providers → Email**, desative **"Confirm email"**. Assim, quem criar conta entra na hora, sem precisar confirmar e-mail. Você pode reativar depois.

## Passo 3 — Pegar as chaves do seu projeto

1. No painel do Supabase, vá em **Settings → API Keys** (em projetos mais antigos o menu se chama **Settings → API**).
2. Anote dois valores:
   - **Project URL** (algo como `https://abcdefgh.supabase.co`)
   - **anon / public key** (um texto longo começando com `eyJ...`)
3. Anote também o **Reference ID** do projeto (em **Settings → General**) — são as letras do início da URL, ex.: `abcdefgh`.

## Passo 4 — Publicar as funções de IA

As funções de servidor (Conselheiro, Captura, Briefing, Foto da Refeição, Importação de Fatura, Blueprint do onboarding, assinatura e exclusão de conta) rodam dentro do Supabase. Para publicá-las:

1. Crie sua chave da Anthropic em [console.anthropic.com](https://console.anthropic.com) → **API Keys** → **Create Key** (adicione créditos em Billing, US$ 5 já dá para muito uso).
2. Abra o **terminal** (Prompt de Comando no Windows) **dentro desta pasta** e rode, um por vez:

```bash
npx supabase login
```

(vai abrir o navegador para você autorizar)

```bash
npx supabase functions deploy ai-chat capture briefing analyze-meal import-statement onboarding-blueprint get-subscription delete-account create-checkout customer-portal --project-ref SEU_REFERENCE_ID
```

Essas dez são exatamente as que o app chama — publique todas. Se aparecer
"Deployed Functions", funcionou.

_(As demais são opcionais e só valem a pena depois: `whatsapp-webhook` e
`whatsapp-notify` para o canal de WhatsApp, `billing-webhook` para a cobrança
pelo Stripe, e `analyze-body`, hoje suspensa por decisão de produto.)_

### Login com Google (opcional, recomendado)

O app tem o botão "Continuar com Google" pronto — ele só aparece funcional depois desta configuração (sem ela, o botão mostra um erro amigável ao ser tocado):

1. **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)) → crie/selecione um projeto → **APIs & Services → OAuth consent screen**: tipo _External_, nome "Ascende", seu e-mail de suporte e domínio; em _Scopes_ não adicione nada além do básico (`email`/`profile` já são padrão); publique (_Publish app_).
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → tipo _Web application_. Em **Authorized redirect URIs**, cole a URL de callback exibida no painel do Supabase (formato `https://SEU_REFERENCE_ID.supabase.co/auth/v1/callback`). Guarde o **Client ID** e o **Client Secret**.
3. **Supabase → Authentication → Providers → Google**: ative, cole Client ID e Client Secret, salve.
4. **Supabase → Authentication → URL Configuration**: em _Site URL_, seu domínio de produção; em _Redirect URLs_, adicione `https://SEU_DOMINIO/auth/callback` e, para desenvolvimento, `http://localhost:5173/auth/callback`.
5. **No mesmo OAuth Client do passo 2**, preencha também **Authorized JavaScript origins** com as origens do app: `https://SEU_DOMINIO` e `http://localhost:5173`. Isso habilita o modo **sem redirect** (Google Identity Services), que é o que funciona dentro do app instalado (PWA).
6. **No `.env` do projeto**, adicione `VITE_GOOGLE_CLIENT_ID` com o Client ID do passo 2 (é público por natureza — não é segredo). Com ele presente, o app usa o botão oficial do Google com `signInWithIdToken` (a sessão nasce na própria janela — sem redirect, sem sair do app instalado). Sem ele, o app cai no fluxo de redirect, que funciona no navegador mas **não** no PWA instalado (a volta do Google abre no navegador em vez do app; no iOS a sessão nem chega, pois o storage é separado).
7. Pronto — o consentimento LGPD é coletado pelo próprio app (rota `/auth/callback`), e contas Google com o mesmo e-mail de uma conta e-mail/senha verificada são vinculadas automaticamente pelo Supabase.

> Nota iOS: PWA instalado no iOS é o terreno mais hostil do ecossistema para OAuth. O fluxo por ID token é o que tem melhor comportamento; se o popup do Google for bloqueado em algum iOS antigo, oriente o login uma vez pelo Safari — a conta é a mesma.

_(Apple Sign-In fica para uma fase futura: exige Apple Developer Program — US$ 99/ano — e o client secret expira a cada 6 meses. O código já está preparado; basta configurar o provider e ligar o botão em `Auth.tsx`.)_

> **Confirmação de e-mail (decisão de fundador):** com a confirmação ativa no Supabase
> (Authentication → Providers → Email), o app mostra uma tela dedicada de "confirme seu
> e-mail" com reenvio. Para signup sem fricção (o usuário cai direto no onboarding),
> desative "Confirm email" — trade-off explícito: menos atrito × mais contas com e-mail
> falso/spam. O funil de ativação foi desenhado para funcionar bem nos dois modos.

Depois do deploy, guarde a chave da Anthropic nos segredos do projeto:

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sua-chave-da-anthropic --project-ref SEU_REFERENCE_ID
```

Nos dois comandos, troque `SEU_REFERENCE_ID` pelo Reference ID do Passo 3 e
`sua-chave-da-anthropic` pela chave criada no item 1.

## Passo 5 — Publicar o site no Netlify

**Jeito mais simples (arrastar e soltar):**

1. Nesta pasta, crie um arquivo chamado **`.env`** (copie o `.env.example`) e preencha com os valores do Passo 3:
   ```
   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-anon-key
   # opcional — só se você fez o "Login com Google" do Passo 4:
   VITE_GOOGLE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
   ```

   > Estas variáveis são lidas **durante o `npm run build`**. Se você mudar
   > alguma depois, refaça o build — o site já publicado não a enxerga.
2. No terminal, dentro desta pasta:
   ```bash
   npm install
   npm run build
   ```
3. Quer conferir antes de publicar? Rode `npm run dev` e abra
   [localhost:5173](http://localhost:5173) — é o mesmo app, na sua máquina.
   Encerre com `Ctrl+C` quando terminar.
4. Acesse [app.netlify.com/drop](https://app.netlify.com/drop) e **arraste a pasta `dist`** (criada pelo comando acima) para a página.
5. Pronto — o Netlify te dá um link. Seu Ascende está no ar. 🎉

**Jeito recomendado para o longo prazo (via Git):** suba esta pasta para um repositório no GitHub, conecte-o no Netlify (**Add new site → Import from Git**) e, em **Site settings → Environment variables**, cadastre `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Assim cada atualização futura publica sozinha.

---

## Testando se tudo funcionou

1. Abra o link do Netlify → **Criar conta** → faça o onboarding.
2. Na tela **Hoje**, escreva na caixa de captura: `gastei 47 no mercado, treinei pernas e dormi 6h` → devem aparecer 3 registros para confirmar.
3. O **briefing** do topo deve carregar um texto personalizado.
4. Abra o **Conselheiro** e pergunte: "como está minha vida?".
5. Opcional, se você tem iPhone: em **Ajustes**, na seção de importação, traga o `.zip`
   do app Saúde e confira se aparecem sono, treino e peso com as datas antigas.

Se a captura/briefing/chat falharem mas o resto funcionar, o problema está no Passo 4 (funções ou chave da Anthropic). Veja os logs em **Supabase → Edge Functions → Logs**.

## Importar histórico de outros aplicativos

A tela fica em **Ajustes**, na seção de importação.

Quem já registra a vida em outro app não precisa começar do zero. **Nada aqui exige
deploy ou configuração extra**: a leitura acontece no navegador de quem usa, sem
chamar as funções do Passo 4 e sem gastar um centavo de IA. As tabelas de que ela
depende (`data_sources` e os recibos de importação) nascem nas migrações do Passo 2.

**Do iPhone, tudo de uma vez.** No iPhone: app **Saúde** → toque na sua foto de
perfil → **Exportar todos os dados de saúde**. Sai um `.zip` — traga o zip inteiro,
sem descompactar. Ele costuma passar de 500 MB descompactado (o export de teste tem
39 MB de zip que viram 876 MB de XML) e por isso é lido **em streaming, no próprio
aparelho**, em poucos segundos. Vêm sono, treino, peso e água, cada registro com a
data original.

**De outros aplicativos, por CSV.** Exporte o CSV no app de origem e traga para a
mesma tela. O reconhecimento é pelo **formato das colunas, não pela marca**, então a
lista abaixo são exemplos do que costuma cair em cada conceito — um app não citado
funciona se o CSV tiver as colunas equivalentes:

| O que entra    | Exemplos de origem                                                         |
| -------------- | -------------------------------------------------------------------------- |
| Sono           | Sleep Cycle, AutoSleep, Oura, Whoop, Garmin, Fitbit, Samsung Health, Pillow |
| Treino         | Hevy, Strong, FitNotes, Garmin, Strava, Nike Run Club                       |
| Peso           | Withings, Renpho, Zepp Life, Garmin, Fitbit, Samsung Health, Hevy           |
| Alimentação    | MyFitnessPal, Cronometer                                                    |

A lista canônica é a constante `SUPPORTED_SOURCES`, no topo de
`src/lib/healthImport.ts` — a tela lê de lá, e esta tabela deve ser atualizada junto.

**O que o código garante** (e o que o texto do app pode afirmar): o arquivo é lido no
aparelho e **não é enviado para servidor nenhum**; **não passa por IA** — CSV e XML são
dados estruturados, parseados direto, sem resumo e sem alucinação; o conteúdo **não é
armazenado** (guarda-se só uma impressão digital do arquivo, para reconhecer uma
reimportação); cada registro entra com a **data original**; e a pessoa **revisa a lista
antes de qualquer gravação**. Não há sincronização automática nem integração ao vivo
com esses aplicativos: é sempre um arquivo, trazido à mão.

## Problemas comuns

| Sintoma                                              | Causa provável                            | Solução                                                |
| ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| Tela branca com erro de "variáveis não configuradas" | `.env` não preenchido antes do build      | Refaça o Passo 5, item 1 e 2                           |
| "O Conselheiro está indisponível"                    | Chave da Anthropic errada ou sem créditos | Refaça o `secrets set` do Passo 4                      |
| Criou conta mas não entra                            | Confirmação de e-mail ativa               | Confirme o e-mail recebido, ou desative no Passo 2     |
| Captura não encontra nada                            | Normal se o texto não tem eventos         | Descreva ações: gastos, sono, treino, refeições, humor |
| "Não reconheci este arquivo" na importação           | CSV sem as colunas de sono/treino/peso/alimentação, ou zip que não é o export do Saúde | Confira as colunas na tabela de [importação](#importar-histórico-de-outros-aplicativos); do iPhone, traga o `.zip` como ele saiu |
| Importação abre mas não grava nada                   | Migrações do Passo 2 não rodadas (falta `data_sources`) | Rode os arquivos de `supabase/migrations/` em ordem |

## Custos de IA (referência)

O app usa **Claude Haiku** (`claude-haiku-4-5`) para a captura, que é baratíssima, e **Claude Sonnet** (`claude-sonnet-4-6`) para o Conselheiro e o briefing.

Os tetos por usuário já vêm embutidos no código para proteger seu bolso — no plano gratuito, **15 mensagens de Conselheiro por semana**, **3 capturas inteligentes por dia** (10 por dia nas duas primeiras semanas de conta) e **4 análises de refeição por mês**; no Ascende+, 15 mensagens por dia (300/mês) e 30 capturas por dia. O briefing diário é gerado **1x por dia por usuário**, com cache.

Os valores vivem em `supabase/functions/_shared/entitlements.ts` (`DEFAULT_LIMITS`) e podem ser ajustados sem novo deploy pela chave `plan_limits` da tabela `app_settings`.

## Estrutura do projeto

```
├── src/                    # aplicativo (React + Vite + Tailwind)
│   ├── lib/healthImport.ts     # CSV de apps de saúde: SUPPORTED_SOURCES e parsers
│   ├── lib/appleHealth.ts      # export do app Saúde: leitura do XML em pedaços
│   └── lib/appleHealthZip.ts   # export do app Saúde: streaming do .zip (fflate)
├── supabase/setup.sql      # linha de base do banco (Passo 2)
├── supabase/migrations/    # tudo que veio depois — roda em ordem (Passo 2)
├── supabase/whatsapp_e_metas.sql  # tabelas de WhatsApp e metas (Passo 2, item 6)
├── supabase/functions/     # as funções de IA (Passo 4)
├── netlify.toml            # configuração do Netlify (já pronta)
└── .env.example            # modelo das variáveis (Passo 5)
```
