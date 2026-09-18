-- ═══════════════════════════════════════════════════════════════════════
-- "MEIO CORPO VISÍVEL" ERA UM ESTADO DE RETRATO QUE NÃO DEVIA EXISTIR
--
-- O pilar `alimentacao` foi ABSORVIDO por `vitalidade` (decisão do fundador,
-- 17/09/2026). O corpo deixa de ser partido em dois pilares: sono, treino,
-- comida, água e peso passam a viver sob um só. Ficam três: prosperidade,
-- vitalidade, mente.
--
-- ─── POR QUE O `ai_scopes` FUNDE COM **E**, E NÃO COM OU ───
--
-- Escopo é contrato: "o que o Conselheiro pode analisar". Quem negou
-- `alimentacao` tirou dele peso, composição corporal, calorias, proteína e
-- hidratação (os portões de _shared/lib.ts). Sob OU, uma refatoração NOSSA
-- devolveria tudo isso sem ela tocar em nada — sem consentimento e sem
-- notificação. É o único desfecho irreversível das duas opções: dado analisado
-- não desanalisa. Sob E, a falha é a oposta e é reversível com um toque: quem
-- negou só `alimentacao` perde também sono e treino, e vê isso na hora.
--
-- A precedência já está escrita e testada no mesmo código: `_shared/lib.ts`,
-- no bloco de tendências — "a regra é a mais restritiva possível: TODOS os
-- pilares que a análise toca precisam estar autorizados, não 'pelo menos um'"
-- (`pilares.every(...)`, não `some`). OU contradiria o `every` do mesmo arquivo.
--
-- O ganho maior, porém, é de QUALIDADE: o E elimina do universo o estado
-- `vitalidade=true, alimentacao=false`, em que o Conselheiro recebia treinos e
-- sono e NENHUM peso — e então o protocolo de planos o mandava pedir "peso
-- atual" num retrato que acabara de lhe dizer "não peça para reativar".
--
-- ─── ESTA MIGRATION É OTIMIZAÇÃO, NÃO CORREÇÃO ───
--
-- Quem garante a privacidade é a LEITURA DERIVADA em `_shared/lib.ts`
-- (`vitalidade = rawScopes.vitalidade !== false && rawScopes.alimentacao !== false`).
-- Por isso esta migration pode rodar antes, depois, no meio ou nunca: ela só
-- evita recomputar e dá à tela de Ajustes uma chave canônica para escrever.
-- Migração que não precisa ser perfeita é a única que não é risco de deploy.
--
-- A chave `alimentacao` PERMANECE, com o valor original. Ela é (a) o rollback
-- e (b) o que uma instância AINDA VELHA da função lê durante a janela. Sai só
-- na release de contração, junto com a leitura derivada e com o espelho da
-- tela de Ajustes — os três saem juntos ou nenhum sai.
--
-- ─── O RISCO DO `profiles.pillars`, E POR QUE ELE FUNDE COM **OU** ───
--
-- Decisão de fundador, confirmada em 17/09/2026: quem tinha vitalidade OU
-- alimentacao fica com vitalidade ativa. Aqui o custo do erro é o oposto do
-- `ai_scopes` — não é privacidade, é o app sumir da tela de quem escolheu ter
-- o pilar. E existe um agravante concreto: `activePillarSet`
-- (src/lib/pillars.ts) considera TODOS os pilares ativos quando a lista fica
-- VAZIA ("nunca escondemos o app inteiro por engano"). Um perfil com
-- `{alimentacao}` que virasse `{}` receberia Prosperidade e Mente de volta,
-- em silêncio, para quem escolheu não ter. Por isso o OU, e por isso a
-- condição de guarda abaixo: esta migration NÃO PODE produzir array vazio.
--
-- ─── RODE ANTES, PARA SABER O TAMANHO DO QUE VOCÊ ESTÁ DECIDINDO ───
--
-- `so_ali` é exatamente quem perde análise por causa do E. Se for 0 ou perto
-- disso — o provável, já que o default da coluna liga tudo e desligar exige ir
-- em Ajustes —, a discussão E-vs-OU é teórica. Se for grande, o número é seu.
--
--   select count(*) filter (where (ai_scopes->>'vitalidade')  = 'false'
--                             and (ai_scopes->>'alimentacao') is distinct from 'false') as so_vit,
--          count(*) filter (where (ai_scopes->>'alimentacao') = 'false'
--                             and (ai_scopes->>'vitalidade')  is distinct from 'false') as so_ali,
--          count(*) filter (where (ai_scopes->>'vitalidade')  = 'false'
--                             and (ai_scopes->>'alimentacao') = 'false')                as ambos,
--          count(*) as total
--     from public.profiles;
--
-- Idempotente: pode rodar de novo sem estragar nada.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. ai_scopes: vitalidade = vitalidade E alimentacao ───────────────
-- O `where` restrito faz a migration tocar só as linhas que mudam de fato:
-- quem nunca desligou `alimentacao` já tem o valor certo, e reescrever o jsonb
-- inteiro de toda a base para não mudar nada é tráfego e ruído no WAL.
update public.profiles
   set ai_scopes = ai_scopes || jsonb_build_object(
         'vitalidade',
             coalesce(ai_scopes->>'vitalidade',  'true') <> 'false'
         and coalesce(ai_scopes->>'alimentacao', 'true') <> 'false'
       )
 where coalesce(ai_scopes->>'alimentacao', 'true') = 'false'
   and coalesce(ai_scopes->>'vitalidade',  'true') <> 'false';

-- ─── 2. profiles.pillars: vitalidade = vitalidade OU alimentacao ───────
-- Remove o id `alimentacao` do array e garante `vitalidade` para quem tinha
-- qualquer um dos dois.
--
-- A ORDEM do array não é significativa (quem a usa monta um Set, e a ordem de
-- exibição vem da tabela PILLARS), então `vitalidade` entra no fim em vez de
-- no lugar de `alimentacao` — uma expressão de duas linhas em vez de um
-- agregado correlacionado que ninguém vai reler com prazer daqui a um ano.
--
-- A guarda `'alimentacao' = any(pillars)` restringe às linhas que mudam e
-- torna a operação idempotente. E como todo perfil tocado tinha `alimentacao`,
-- todo perfil tocado SAI com `vitalidade`: nenhum array fica vazio por causa
-- desta migration — que é a condição inegociável, pelo fallback de
-- activePillarSet explicado acima.
update public.profiles
   set pillars = array_remove(pillars, 'alimentacao')
               || case when 'vitalidade' = any(pillars)
                       then '{}'::text[] else array['vitalidade'] end
 where 'alimentacao' = any(pillars);

comment on column public.profiles.pillars is
  'Pilares ativos: prosperidade | vitalidade | mente. '
  'O id `alimentacao` foi absorvido por `vitalidade` em 17/09/2026 e não é '
  'mais escrito por ninguém — activePillarSet (src/lib/pillars.ts) descarta '
  'ids desconhecidos, mas cuidado: lista VAZIA significa "todos ativos".';
