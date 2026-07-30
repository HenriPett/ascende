# Ascende — O app que vê a sua vida inteira

Você conta seu dia numa frase ("gastei 47 no mercado, treinei pernas e dormi 6h") e o Ascende registra tudo nos lugares certos. Corpo, dinheiro, alimentação e mente no mesmo lugar, com um Conselheiro que monta, por exemplo, o plano alimentar que cabe no seu orçamento — porque é o único que conhece os dois lados.

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
4. Deve aparecer "Success. No rows returned". Pronto — banco criado, com segurança (RLS) já configurada.

> 💡 **Opcional, recomendado para testar sem fricção:** em **Authentication → Sign In / Providers → Email**, desative **"Confirm email"**. Assim, quem criar conta entra na hora, sem precisar confirmar e-mail. Você pode reativar depois.

## Passo 3 — Pegar as chaves do seu projeto

1. No painel do Supabase, vá em **Settings → API Keys**.
2. Anote dois valores:
   - **Project URL** (algo como `https://abcdefgh.supabase.co`)
   - **anon / public key** (um texto longo começando com `eyJ...`)
3. Anote também o **Reference ID** do projeto (em **Settings → General**) — são as letras do início da URL, ex.: `abcdefgh`.

## Passo 4 — Publicar as funções de IA

As funções de IA (Conselheiro, Captura, Briefing, Foto da Refeição e Importação de Fatura) rodam dentro do Supabase. Para publicá-las:

1. Crie sua chave da Anthropic em [console.anthropic.com](https://console.anthropic.com) → **API Keys** → **Create Key** (adicione créditos em Billing, US$ 5 já dá para muito uso).
2. Abra o **terminal** (Prompt de Comando no Windows) **dentro desta pasta** e rode, um por vez:

```bash
npx supabase login
```

(vai abrir o navegador para você autorizar)

```bash
npx supabase functions deploy ai-chat capture briefing analyze-meal analyze-body import-statement onboarding-blueprint --project-ref SEU_REFERENCE_ID
```

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

```bash

```

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sua-chave-da-anthropic --project-ref SEU_REFERENCE_ID
```

Troque `SEU_REFERENCE_ID` pelo Reference ID do Passo 3 e `sua-chave-da-anthropic` pela chave criada. Se aparecer "Deployed Functions", funcionou.

## Passo 5 — Publicar o site no Netlify

**Jeito mais simples (arrastar e soltar):**

1. Nesta pasta, crie um arquivo chamado **`.env`** (copie o `.env.example`) e preencha com os valores do Passo 3:
   ```
   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-anon-key
   ```
2. No terminal, dentro desta pasta:
   ```bash
   npm install
   npm run build
   ```
3. Acesse [app.netlify.com/drop](https://app.netlify.com/drop) e **arraste a pasta `dist`** (criada pelo comando acima) para a página.
4. Pronto — o Netlify te dá um link. Seu Ascende está no ar. 🎉

**Jeito recomendado para o longo prazo (via Git):** suba esta pasta para um repositório no GitHub, conecte-o no Netlify (**Add new site → Import from Git**) e, em **Site settings → Environment variables**, cadastre `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Assim cada atualização futura publica sozinha.

---

## Testando se tudo funcionou

1. Abra o link do Netlify → **Criar conta** → faça o onboarding.
2. Na tela **Hoje**, escreva na caixa de captura: `gastei 47 no mercado, treinei pernas e dormi 6h` → devem aparecer 3 registros para confirmar.
3. O **briefing** do topo deve carregar um texto personalizado.
4. Abra o **Conselheiro** e pergunte: "como está minha vida?".

Se a captura/briefing/chat falharem mas o resto funcionar, o problema está no Passo 4 (funções ou chave da Anthropic). Veja os logs em **Supabase → Edge Functions → Logs**.

## Problemas comuns

| Sintoma                                              | Causa provável                            | Solução                                                |
| ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| Tela branca com erro de "variáveis não configuradas" | `.env` não preenchido antes do build      | Refaça o Passo 5, item 1 e 2                           |
| "O Conselheiro está indisponível"                    | Chave da Anthropic errada ou sem créditos | Refaça o `secrets set` do Passo 4                      |
| Criou conta mas não entra                            | Confirmação de e-mail ativa               | Confirme o e-mail recebido, ou desative no Passo 2     |
| Captura não encontra nada                            | Normal se o texto não tem eventos         | Descreva ações: gastos, sono, treino, refeições, humor |

## Custos de IA (referência)

O app usa **Claude Haiku** para a captura (baratíssimo) e **Claude Sonnet** para o Conselheiro e o briefing. O briefing é gerado **1x por dia por usuário** (com cache) e o chat tem limite de **40 mensagens/dia por usuário** — ambos já embutidos no código para proteger seu bolso.

## Estrutura do projeto

```
├── src/                    # aplicativo (React + Vite + Tailwind)
├── supabase/setup.sql      # cria todo o banco (Passo 2)
├── supabase/functions/     # as funções de IA (Passo 4)
├── netlify.toml            # configuração do Netlify (já pronta)
└── .env.example            # modelo das variáveis (Passo 5)
```
