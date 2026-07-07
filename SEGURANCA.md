# Segurança dos dados no Ascend

O Ascend lida com dados sensíveis: saúde, medicamentos, diário, humor, finanças, fé e fotos do corpo.
Este documento registra o resultado da auditoria de segurança, o que é garantido **em código**
e o que precisa ser configurado **no painel** (Supabase e Netlify).

## O que está garantido em código

**Isolamento por usuário (RLS)**
- Todas as tabelas têm Row Level Security ligado, com políticas `auth.uid() = user_id`
  para leitura e escrita: `profiles`, `life_events`, `transactions`, `habits`, `habit_logs`,
  `xp_log`, `chat_messages`, `briefings`, `battles`, `battle_checkins`, `plans`.
- Políticas de UPDATE têm `with check` explícito: ninguém transfere um registro para outra conta.
- `xp_log` **não aceita insert do cliente**: XP só entra pelo gatilho do banco
  (security definer). Fecha a possibilidade de forjar pontos.
- `fn_calls` (controle de abuso) tem RLS ligado **sem nenhuma política**: cliente não lê nem escreve.
- Exclusão de conta: todas as tabelas referenciam `auth.users` com `on delete cascade` —
  apagar o usuário apaga tudo dele, sem órfãos.
- Todas as funções `security definer` fixam `set search_path = public` (contra sequestro de search_path).

**Funções de IA (edge functions)**
- Toda função valida o JWT (`requireUser`) antes de qualquer coisa; `verify_jwt = true` no config.
- Rate limit por usuário em todas (proteção de custo e abuso):
  ai-chat 20/5min · capture 30/5min · analyze-meal 20/10min · analyze-body 8/10min · briefing 6/60min.
- Limites de tamanho de entrada (mensagem 4k chars, imagens ~5MB, PDF 4MB, 4 anexos).
- CORS restringível: defina o secret `APP_ORIGIN` com a URL do site e só ela poderá
  chamar as funções pelo navegador.
- **Fotos (refeição e corpo) não são armazenadas**: são analisadas em memória e descartadas.
  Nenhum bucket de storage é usado no projeto.
- Logs de erro não incluem conteúdo do usuário (mensagens, fotos, diário) — só erros técnicos.
- A IA só escreve no banco em dois pontos, ambos restritos ao próprio usuário autenticado e
  com validação de campo a campo: histórico de chat e atualização de perfil (dados que a
  própria pessoa informou). Planos e registros passam por confirmação do usuário no app.

**Frontend e deploy**
- Zero `dangerouslySetInnerHTML` alcançável por entrada do usuário (o markdown do chat/planos
  usa um parser próprio que gera nós React, imune a XSS).
- Sem `console.log` de dados no código do app.
- Senha mínima de 8 caracteres no cadastro.
- Headers de segurança no Netlify (`netlify.toml`): CSP (scripts só do próprio site, conexões
  só com o Supabase), `frame-ancestors 'none'` (ninguém embute o app), `nosniff`, HSTS,
  Referrer-Policy e Permissions-Policy (câmera/microfone só para o próprio site).
- No repositório não há nenhum segredo privado: o `.env` (gitignorado) contém apenas a URL
  e a **anon key** do Supabase, que são públicas por design e protegidas pelo RLS.
  A `SERVICE_ROLE_KEY` e a `ANTHROPIC_API_KEY` vivem apenas nos secrets das edge functions.

## Checklist manual (fazer no painel — ~15 minutos)

**Supabase → Authentication**
1. Ativar **Leaked password protection** (bloqueia senhas vazadas, via HaveIBeenPwned).
2. Conferir **Confirm email** ligado (evita cadastro com e-mail de terceiros).
3. Em **Rate limits**, manter os padrões de auth (proteção de força bruta no login).

**Supabase → Edge Functions → Secrets**
4. Criar o secret `APP_ORIGIN` com a URL exata do site (ex.: `https://seuapp.netlify.app`).
   Sem ele o CORS fica aberto (modo dev).
5. Conferir que `ANTHROPIC_API_KEY` está só aqui (nunca no frontend ou no repositório).

**Supabase → Database**
6. Ativar backups diários (plano free já tem 7 dias; PITR se for a produção séria).

**Contas**
7. Ligar **2FA** nas contas do Supabase, Netlify e do provedor de e-mail.

**Rotina**
8. Se qualquer chave vazar (commit acidental, print), rotacione na hora:
   Supabase → Settings → API (anon/service) e console da Anthropic (API key).
9. Depois de rodar o `setup.sql` desta versão, execute o Security Advisor do Supabase
   (Database → Advisors) e confirme zero alertas de RLS.

## Limitações conhecidas (transparência)

- Os dados trafegam para a API da Anthropic para as respostas de IA (é o que faz o produto
  funcionar). Não são usados para treino por padrão na API, mas isso é uma dependência de terceiro.
- Criptografia em repouso é a padrão do Supabase (AES-256 no disco). Criptografia por campo
  (ex.: diário ilegível até para o banco) exigiria gerenciamento de chaves no cliente —
  possível evolução futura, não implementada.
- O rate limit é por usuário autenticado; ataques de criação de conta em massa são mitigados
  pelos rate limits de auth do Supabase (item 3 do checklist).
