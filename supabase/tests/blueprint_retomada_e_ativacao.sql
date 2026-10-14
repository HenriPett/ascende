-- ═══════════════════════════════════════════════════════════════════════
-- O BLUEPRINT NÃO SE PERDE, E NÃO SE APLICA DUAS VEZES — PROVADO
--
-- Este arquivo RODA. Ele prova os aceites do plano
-- (scratchpad/blueprint/PLANO.md) contra a migração
-- 20261013120000_o_blueprint_gerado_fica_guardado_ate_ser_usado, com usuários
-- e JWTs diferentes, do mesmo jeito que social_quatro_revogacoes.sql:
--
--   1. gerar → "recarregar" → mesma proposta e mesmas escolhas;
--   2. duas abas → uma geração só (duas conexões DE VERDADE, via dblink, uma
--      esperando a outra no mesmo instante — não é simulação de ordem);
--   3. ativação interrompida no meio não deixa nada; a segunda chamada aplica
--      uma vez; a terceira devolve `already`;
--   4. outra pessoa não lê nem escreve a proposta alheia;
--   5. apagar a conta leva proposta e eventos junto;
--   6. "explorar primeiro" adia sem apagar, e a proposta continua retomável.
--
-- ─── COMO RODAR (cluster descartável, nunca o Supabase) ────────────────
--   initdb -D /tmp/asc/data -U postgres --auth=trust
--   pg_ctl -D /tmp/asc/data -o "-p 55999 -k /tmp/asc" start
--   createdb -h /tmp/asc -p 55999 -U postgres ascende
--   psql ... -f supabase/tests/_stub_auth.sql
--   psql ... -f supabase/setup.sql
--   psql ... -f supabase/migrations/<cada uma, em ordem>
--   psql ... -f supabase/tests/blueprint_retomada_e_ativacao.sql
--
-- Precisa da extensão `dblink` (vem no contrib do Postgres) para o aceite 2.
-- A última linha imprime `falhas | total`.
-- ═══════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
create extension if not exists dblink;

-- No Supabase, a chave de serviço passa por cima da RLS. No cluster de teste
-- o papel existe sem isso; damos aqui para a função de borda ser imitada como
-- ela de fato roda.
alter role service_role bypassrls;

-- ─── OS DEFAULT PRIVILEGES DO SUPABASE HOSPEDADO, ANTES DA MIGRAÇÃO ───
-- No Supabase, toda tabela e sequência nova do schema public NASCE com ALL
-- para `anon` e `authenticated` (default privileges do papel postgres). O
-- cluster de teste não tem isso — e sem simular, um `revoke` incompleto passa
-- no teste e vaza em produção (foi o achado do TRUNCATE, da Aduana). Então:
-- liga os default privileges como o Supabase, recria as duas tabelas pela
-- PRÓPRIA migração e desliga. O que sobrar de privilégio é o que sobraria lá.
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
-- Testemunha: uma tabela qualquer criada agora tem de nascer com TRUNCATE
-- para `authenticated` — é a prova de que a simulação está valendo, e de que
-- o que as tabelas do Blueprint NÃO têm no fim foi tirado pela migração.
create table public._testemunha_default (x int);
select has_table_privilege('authenticated', 'public._testemunha_default', 'TRUNCATE')
   and has_sequence_privilege('authenticated', 'public.blueprint_events_id_seq', 'SELECT') is not null
   as simulacao_ok \gset
drop table public._testemunha_default;
drop table if exists public.blueprint_events, public.blueprint_proposals cascade;
\ir ../migrations/20261013120000_o_blueprint_gerado_fica_guardado_ate_ser_usado.sql
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

create table if not exists _r (n text, ok boolean, obs text);
grant all on _r to authenticated, anon, service_role;
truncate _r;

-- Roda um comando e devolve o SQLSTATE do erro, ou 'ok'. SECURITY INVOKER:
-- executa com o papel e o JWT de quem chama — é isso que o teste quer ver.
create or replace function pg_temp.tenta(cmd text) returns text language plpgsql as $$
begin
  execute cmd;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- Para o que DESTRÓI (truncate): roda numa subtransação e a desfaz sempre,
-- tenha passado ou não. Se a tranca falhar, o teste diz 'ok' (passou) em vez
-- de apagar as propostas de todo mundo e quebrar o resto do arquivo.
create or replace function pg_temp.tenta_e_desfaz(cmd text) returns text language plpgsql as $$
begin
  begin
    execute cmd;
    raise exception 'desfazer' using errcode = 'P9999';
  exception when sqlstate 'P9999' then
    return 'ok';
  end;
exception when others then
  return sqlstate;
end $$;

delete from auth.users;

-- A = Ana (o caminho inteiro), B = Bruno (o intruso), C = Carla (a corrida),
-- D = Davi (explorar primeiro), L = Lia (legado), E = Edu (geração que falha).
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','ana@x'),
  ('bbbbbbbb-0000-0000-0000-000000000002','bruno@x'),
  ('cccccccc-0000-0000-0000-000000000003','carla@x'),
  ('dddddddd-0000-0000-0000-000000000004','davi@x'),
  ('11111111-0000-0000-0000-00000000000f','lia@x'),
  ('eeeeeeee-0000-0000-0000-000000000005','edu@x'),
  ('ffffffff-0000-0000-0000-000000000006','fabi@x');
insert into public.profiles (user_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Ana'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Bruno'),
  ('cccccccc-0000-0000-0000-000000000003','Carla'),
  ('dddddddd-0000-0000-0000-000000000004','Davi'),
  ('11111111-0000-0000-0000-00000000000f','Lia'),
  ('eeeeeeee-0000-0000-0000-000000000005','Edu'),
  ('ffffffff-0000-0000-0000-000000000006','Fabi')
on conflict (user_id) do update set name = excluded.name, blueprint_generated_at = null,
  blueprint_activated_at = null, calorie_goal_kcal = null, protein_goal_g = null;

-- O limite de planos ativos LIGADO, com o free em 1: é assim que o segundo
-- plano escolhido tem de cair em 'arquivado' (e não sumir, e não derrubar tudo).
update public.app_settings
   set value = jsonb_set(value, '{premium_limits_enabled}', 'true')
 where key = 'flags';

-- A proposta que o "modelo" devolveu: três planos, dois hábitos, metas.
\set proposta '{"overview":"Um plano para a sua subida.","plans":[{"kind":"alimentar","pillar":"vitalidade","title":"Comer bem com R$ 800","content_markdown":"## Resumo\\n- 2200 kcal\\n- 140 g de proteína\\n- R$ 800 por mês\\n---\\n## Observações\\nTudo proposta."},{"kind":"treino","pillar":"vitalidade","title":"Três treinos curtos","content_markdown":"## Resumo\\n- 3 treinos de 30 minutos por semana\\n- caminhada no sábado\\n---\\n## Observações\\nComeça pequeno."},{"kind":"financeiro","pillar":"prosperidade","title":"O mês que fecha","content_markdown":"## Resumo\\n- teto de R$ 60 por dia\\n- reserva de 10%\\n---\\n## Observações\\nSem centavos."}],"daily_calories_kcal":2200.4,"daily_protein_g":140,"weekly_workouts":3,"sleep_hours_target":7.5,"daily_spend_limit":60,"water_goal_ml":2500,"habits":[{"name":"Marmita 4x na semana","pillar":"vitalidade","why":"cabe no bolso"},{"name":"Anotar o gasto do dia","pillar":"prosperidade","why":"o mês fecha"}],"assumptions":[]}'
\set escolhas_iniciais '{"plans":[true,false,false],"habits":[true,true],"goals":true}'

insert into _r select '00a os default privileges do Supabase foram de fato simulados (tabela nova nasce com TRUNCATE)',
  :'simulacao_ok'::boolean, '';

-- ═══ 1. GERAR → RECARREGAR → A MESMA PROPOSTA ═════════════════════════
-- A função de borda (chave de serviço) reivindica, "gera" e grava ANTES de
-- responder. Aqui fazemos exatamente as chamadas que ela faz.
set role service_role;
select (public.claim_blueprint_generation('aaaaaaaa-0000-0000-0000-000000000001')->>'outcome') as c1 \gset
select (public.claim_blueprint_generation('aaaaaaaa-0000-0000-0000-000000000001')->>'outcome') as c2 \gset
insert into _r select '01a a primeira chamada ganha a geração', :'c1' = 'claimed', :'c1';
insert into _r select '01b a segunda, com a geração em curso, espera (não gera de novo)', :'c2' = 'generating', :'c2';
-- As conferências leem tabelas como `postgres`: o papel de serviço do cluster
-- de teste só tem as concessões que ESTA migração dá, e é isso que se quer
-- provar — a função de borda grava proposta e rastro com elas.
set role postgres;
insert into _r select '01c o carimbo antigo continua sendo escrito (compatibilidade)',
  (select blueprint_generated_at is not null from public.profiles
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), '';
set role service_role;

update public.blueprint_proposals
   set status = 'ready', proposal = :'proposta'::jsonb, choices = :'escolhas_iniciais'::jsonb, generated_at = now()
 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and status = 'generating';
insert into public.blueprint_events (user_id, kind) values ('aaaaaaaa-0000-0000-0000-000000000001', 'generated');

select (public.claim_blueprint_generation('aaaaaaaa-0000-0000-0000-000000000001')->>'outcome') as c3 \gset
insert into _r select '01d com a proposta pronta, a função RETOMA (o ramo que não chama o modelo)', :'c3' = 'ready', :'c3';

-- A pessoa "recarrega": o cliente lê a própria linha com o JWT dela.
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001', false);
insert into _r select '01e depois de recarregar, a MESMA proposta e as MESMAS escolhas',
  (select proposal = :'proposta'::jsonb and choices = :'escolhas_iniciais'::jsonb and status = 'ready'
     from public.blueprint_proposals where user_id = auth.uid()), '';

-- Ela muda as escolhas (o cliente salva com debounce) e recarrega de novo.
select public.save_blueprint_choices('{"plans":[true,true,false],"habits":[true,false],"goals":true}');
insert into _r select '01f a escolha salva sobrevive ao recarregar',
  (select choices = '{"plans":[true,true,false],"habits":[true,false],"goals":true}'::jsonb
          and choices_updated_at is not null
     from public.blueprint_proposals where user_id = auth.uid()), '';

-- Forma errada é recusada com motivo, e nada muda.
insert into _r select '01g escolha com tamanho errado é recusada (22023)',
  pg_temp.tenta($$select public.save_blueprint_choices('{"plans":[true],"habits":[true,false],"goals":true}')$$) = '22023', '';
insert into _r select '01h escolha que não é objeto é recusada, sem explodir',
  pg_temp.tenta($$select public.save_blueprint_choices('[1,2]')$$) = '22023', '';
insert into _r select '01i escolha com item que não é booleano é recusada',
  pg_temp.tenta($$select public.save_blueprint_choices('{"plans":[true,"sim",false],"habits":[true,false],"goals":true}')$$) = '22023', '';
insert into _r select '01j escolha com chave a mais é recusada',
  pg_temp.tenta($$select public.save_blueprint_choices('{"plans":[true,true,false],"habits":[true,false],"goals":true,"x":1}')$$) = '22023', '';
insert into _r select '01k as recusas não mexeram na escolha salva',
  (select choices = '{"plans":[true,true,false],"habits":[true,false],"goals":true}'::jsonb
     from public.blueprint_proposals where user_id = auth.uid()), '';

-- A pessoa não pode chamar a reivindicação (só a função de borda).
insert into _r select '01l a pessoa não reivindica geração direto (42501)',
  pg_temp.tenta($$select public.claim_blueprint_generation('aaaaaaaa-0000-0000-0000-000000000001')$$) = '42501', '';

-- ─── A RETOMADA PELA LEITURA DIRETA TAMBÉM CONTA, COM TETO ────────────
-- A tela lê a linha direto (não passa pela função) e avisa ao hidratar. Cada
-- recarga hidrata de novo: o teto de 30 min impede cinco recargas de virarem
-- cinco retomadas.
select public.report_blueprint_resumed();
select public.report_blueprint_resumed();
set role postgres;
insert into _r select '01n hidratar registra "resumed" — e recarregar de novo, em 30 min, não registra outro',
  (select count(*) from public.blueprint_events
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'resumed') = 1, '';
-- A retomada pela FUNÇÃO usa o mesmo relógio.
set role service_role;
select public.blueprint_register_resumed('aaaaaaaa-0000-0000-0000-000000000001');
set role postgres;
insert into _r select '01o a função de borda retomando dentro dos 30 min também não duplica',
  (select count(*) from public.blueprint_events
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'resumed') = 1, '';
update public.blueprint_events set at = now() - interval '31 minutes'
 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'resumed';
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001', false);
select public.report_blueprint_resumed();
set role postgres;
insert into _r select '01p passados 30 min, uma nova retomada conta',
  (select count(*) from public.blueprint_events
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'resumed') = 2, '';
-- Isolamento: quem não tem proposta não grava nada, e não alcança a de outro.
set role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002', false);
select public.report_blueprint_resumed();
set role postgres;
insert into _r select '01q "resumed" só para quem tem proposta pronta, e só da própria pessoa',
  (select count(*) from public.blueprint_events where user_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0
  and (select count(*) from public.blueprint_events
        where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'resumed') = 2, '';
set role anon;
insert into _r select '01r anônimo não chama report_blueprint_resumed (42501)',
  pg_temp.tenta($$select public.report_blueprint_resumed()$$) = '42501', '';
set role authenticated;
insert into _r select '01s a pessoa não chama o registro interno com outro uid (42501)',
  pg_temp.tenta($$select public.blueprint_register_resumed('aaaaaaaa-0000-0000-0000-000000000001')$$) = '42501', '';
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001', false);

-- O cliente avisa quando não conseguiu ler a própria proposta.
select public.report_blueprint_resume_failure('rede');
set role postgres;
insert into _r select '01m a falha de retomada fica registrada, com o motivo',
  (select count(*) from public.blueprint_events
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and kind = 'resume_failed' and detail->>'reason' = 'rede') = 1, '';

-- ═══ 2. DUAS ABAS → UMA GERAÇÃO SÓ ════════════════════════════════════
-- Duas conexões de verdade. A primeira reivindica e SEGURA a transação aberta;
-- a segunda chama no mesmo instante e fica esperando no `on conflict`. Quando
-- a primeira confirma, a segunda acorda e vê `generating`.
select format('dbname=%s port=%s host=%s user=postgres',
              current_database(), current_setting('port'),
              split_part(current_setting('unix_socket_directories'), ',', 1)) as conn \gset
select dblink_connect('aba1', :'conn');
select dblink_connect('aba2', :'conn');

select dblink_exec('aba1', 'begin');
select * from dblink('aba1',
  $$select (public.claim_blueprint_generation('cccccccc-0000-0000-0000-000000000003')->>'outcome')$$) as t(r text) \gset aba1_
select dblink_send_query('aba2',
  $$select (public.claim_blueprint_generation('cccccccc-0000-0000-0000-000000000003')->>'outcome')$$);
select pg_sleep(0.5);
insert into _r select '02a a segunda aba ESPERA a primeira (está bloqueada, não passou junto)',
  dblink_is_busy('aba2') = 1, '';
select dblink_exec('aba1', 'commit');
select * from dblink_get_result('aba2') as t(r text) \gset aba2_
select * from dblink_get_result('aba2') as t(r text);  -- esvazia a fila da conexão
insert into _r select '02b uma ganha, a outra vê "gerando"',
  :'aba1_r' = 'claimed' and :'aba2_r' = 'generating', :'aba1_r' || ' / ' || :'aba2_r';
insert into _r select '02c existe UMA linha, e o carimbo foi escrito uma vez',
  (select count(*) from public.blueprint_proposals where user_id = 'cccccccc-0000-0000-0000-000000000003') = 1
  and (select blueprint_generated_at is not null from public.profiles
        where user_id = 'cccccccc-0000-0000-0000-000000000003'), '';

-- Uma geração de 6 minutos e meio ainda está VIVA: o teto de relógio de
-- parede das funções de borda pagas é 400 s, e o limiar (420 s) fica acima
-- dele de propósito — senão uma geração lenta seria reivindicada no meio e a
-- cortesia, paga duas vezes.
update public.blueprint_proposals set generation_started_at = now() - interval '390 seconds'
 where user_id = 'cccccccc-0000-0000-0000-000000000003';
insert into _r select '02c2 geração de 390 s ainda é dada como viva (o limiar padrão é 420 s)',
  (public.claim_blueprint_generation('cccccccc-0000-0000-0000-000000000003')->>'outcome') = 'generating', '';

-- Passou do limiar: a função de borda que gerava já foi encerrada pela
-- plataforma. Pode ser reivindicada de novo — e de novo por UMA só, mesmo com
-- duas abas chegando juntas.
update public.blueprint_proposals set generation_started_at = now() - interval '10 minutes'
 where user_id = 'cccccccc-0000-0000-0000-000000000003';
select dblink_exec('aba1', 'begin');
select * from dblink('aba1',
  $$select (public.claim_blueprint_generation('cccccccc-0000-0000-0000-000000000003')->>'outcome')$$) as t(r text) \gset vel1_
select dblink_send_query('aba2',
  $$select (public.claim_blueprint_generation('cccccccc-0000-0000-0000-000000000003')->>'outcome')$$);
select pg_sleep(0.5);
insert into _r select '02d geração velha: a segunda aba também espera',
  dblink_is_busy('aba2') = 1, '';
select dblink_exec('aba1', 'commit');
select * from dblink_get_result('aba2') as t(r text) \gset vel2_
select * from dblink_get_result('aba2') as t(r text);
insert into _r select '02e geração velha é reivindicada de novo, por UMA aba só',
  :'vel1_r' = 'claimed' and :'vel2_r' = 'generating', :'vel1_r' || ' / ' || :'vel2_r';
select dblink_disconnect('aba1');
select dblink_disconnect('aba2');

-- Geração recente NÃO é reivindicada de novo.
set role service_role;
insert into _r select '02f geração recente não é reivindicada (a outra aba espera)',
  (public.claim_blueprint_generation('cccccccc-0000-0000-0000-000000000003')->>'outcome') = 'generating', '';

-- A geração falhou: a linha some e a cortesia volta, juntas.
select r->>'outcome' as e1, r->>'token' as e1tok
  from (select public.claim_blueprint_generation('eeeeeeee-0000-0000-0000-000000000005') r) x \gset
select public.release_blueprint_generation('eeeeeeee-0000-0000-0000-000000000005', :'e1tok'::uuid);
set role postgres;
insert into _r select '02g falha na geração: linha apagada E cortesia devolvida',
  :'e1' = 'claimed'
  and (select count(*) from public.blueprint_proposals where user_id = 'eeeeeeee-0000-0000-0000-000000000005') = 0
  and (select blueprint_generated_at is null from public.profiles
        where user_id = 'eeeeeeee-0000-0000-0000-000000000005'), '';
set role service_role;
insert into _r select '02h depois da devolução, tentar de novo funciona',
  (public.claim_blueprint_generation('eeeeeeee-0000-0000-0000-000000000005')->>'outcome') = 'claimed', '';
-- Liberar nunca apaga proposta pronta.
select public.release_blueprint_generation('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid());
set role postgres;
insert into _r select '02i liberar não apaga proposta pronta',
  (select status = 'ready' from public.blueprint_proposals
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
  and (select blueprint_generated_at is not null from public.profiles
        where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), '';

-- ─── O TOKEN: A GERAÇÃO ANTIGA NÃO GRAVA POR CIMA NEM APAGA A NOVA ─────
-- Sem o teto de 400 s da plataforma (rodando local, ou se o limite mudar), a
-- geração tida como morta pode acordar e terminar depois que outra chamada
-- reivindicou. Fabi: a geração 1 "morre", a geração 2 reivindica; então a 1
-- tenta liberar e gravar com o token dela.
set role service_role;
select r->>'outcome' as f1, r->>'token' as f1tok
  from (select public.claim_blueprint_generation('ffffffff-0000-0000-0000-000000000006') r) x \gset
set role postgres;
update public.blueprint_proposals set generation_started_at = now() - interval '10 minutes'
 where user_id = 'ffffffff-0000-0000-0000-000000000006';
set role service_role;
select r->>'outcome' as f2, r->>'token' as f2tok
  from (select public.claim_blueprint_generation('ffffffff-0000-0000-0000-000000000006') r) x \gset
insert into _r select '02k a reivindicação devolve um token, e a nova geração recebe outro',
  :'f1' = 'claimed' and :'f2' = 'claimed' and :'f1tok' <> :'f2tok' and :'f1tok' <> '', '';

-- A geração 1 falha e tenta devolver a cortesia: não pode apagar a 2.
select public.release_blueprint_generation('ffffffff-0000-0000-0000-000000000006', :'f1tok'::uuid);
set role postgres;
insert into _r select '02l liberar com o token antigo NÃO apaga a geração nova nem devolve a cortesia dela',
  (select status = 'generating' and generation_token = :'f2tok'::uuid from public.blueprint_proposals
    where user_id = 'ffffffff-0000-0000-0000-000000000006')
  and (select blueprint_generated_at is not null from public.profiles
        where user_id = 'ffffffff-0000-0000-0000-000000000006'), '';

-- A geração 1 termina e tenta gravar — com o MESMO filtro da função de borda
-- (status generating + token). Não alcança nada; a 2 grava.
set role service_role;
with g as (
  update public.blueprint_proposals set status = 'ready', proposal = '{"overview":"VELHA","plans":[],"habits":[]}'::jsonb
   where user_id = 'ffffffff-0000-0000-0000-000000000006' and status = 'generating'
     and generation_token = :'f1tok'::uuid
  returning 1)
select count(*) as grav_velha from g \gset
with g as (
  update public.blueprint_proposals set status = 'ready', proposal = :'proposta'::jsonb,
         choices = :'escolhas_iniciais'::jsonb, generated_at = now()
   where user_id = 'ffffffff-0000-0000-0000-000000000006' and status = 'generating'
     and generation_token = :'f2tok'::uuid
  returning 1)
select count(*) as grav_nova from g \gset
-- E a 2, já pronta, não é apagada por um release atrasado de ninguém.
select public.release_blueprint_generation('ffffffff-0000-0000-0000-000000000006', :'f2tok'::uuid);
set role postgres;
insert into _r select '02m a geração antiga grava 0 linhas; a nova grava 1, e é a proposta dela que fica',
  :'grav_velha'::int = 0 and :'grav_nova'::int = 1
  and (select status = 'ready' and proposal = :'proposta'::jsonb from public.blueprint_proposals
        where user_id = 'ffffffff-0000-0000-0000-000000000006'),
  'velha=' || :'grav_velha' || ' nova=' || :'grav_nova';

-- Legado: gerado antes desta migração, carimbo sem linha → 409 como antes.
update public.profiles set blueprint_generated_at = now() - interval '30 days'
 where user_id = '11111111-0000-0000-0000-00000000000f';
set role service_role;
insert into _r select '02j legado (carimbo sem proposta) responde "legacy", sem gerar de novo',
  (public.claim_blueprint_generation('11111111-0000-0000-0000-00000000000f')->>'outcome') = 'legacy'
  and not exists (select 1 from public.blueprint_proposals
                   where user_id = '11111111-0000-0000-0000-00000000000f'), '';
set role postgres;

-- ═══ 3. A ATIVAÇÃO: INTERROMPIDA, RETOMADA, E UMA VEZ SÓ ══════════════
set role postgres;
-- A falha forçada no MEIO: depois dos planos (que já teriam sido inseridos),
-- o primeiro hábito explode. É o "fechou a aba no meio" do lado do banco.
create or replace function public._teste_falha_habito() returns trigger language plpgsql as $$
begin
  if current_setting('teste.falhar_habito', true) = 'on' then
    raise exception 'falha forçada no meio da ativação';
  end if;
  return new;
end $$;
drop trigger if exists _teste_falha on public.habits;
create trigger _teste_falha before insert on public.habits
  for each row execute function public._teste_falha_habito();

set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001', false);
select set_config('teste.falhar_habito', 'on', false);
\set escolhas_ativar '{"plans":[true,true,false],"habits":[true,true],"goals":true}'
\set metas '{calorie_goal_kcal,protein_goal_g,water_goal_ml,name,pillars}'
select public.activate_blueprint(:'escolhas_ativar'::jsonb, :'metas'::text[]) as falha \gset

set role postgres;
insert into _r select '03a a falha no meio devolve ok:false, sem levantar, e diz que dá para tentar de novo',
  (:'falha'::jsonb->>'ok')::boolean = false and (:'falha'::jsonb->>'retryable')::boolean = true
  and :'falha'::jsonb->>'error' = 'P0001', :'falha';
insert into _r select '03b ... e NADA ficou gravado: nem plano, nem hábito, nem meta, nem carimbo',
  (select count(*) from public.plans  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.habits where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0
  and (select calorie_goal_kcal is null and blueprint_activated_at is null from public.profiles
        where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
  and (select status = 'ready' from public.blueprint_proposals
        where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), '';
insert into _r select '03c ... mas o evento da falha ficou (gravado fora da subtransação)',
  (select count(*) from public.blueprint_events
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'activation_failed'
      and detail->>'sqlstate' = 'P0001') = 1, '';

-- Segunda tentativa: aplica, uma vez.
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001', false);
select set_config('teste.falhar_habito', 'off', false);
select public.activate_blueprint(:'escolhas_ativar'::jsonb, :'metas'::text[]) as ok2 \gset

set role postgres;
insert into _r select '03d a segunda chamada aplica',
  (:'ok2'::jsonb->>'ok')::boolean and :'ok2'::jsonb->'already' is null, :'ok2';
insert into _r select '03e o plano que não cabe ativo vai GUARDADO, não some (cota free = 1)',
  :'ok2'::jsonb->'plans_activated' = '["alimentar"]'::jsonb
  and :'ok2'::jsonb->'plans_archived' = '["treino"]'::jsonb
  and (select count(*) from public.plans where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          and status = 'ativo' and kind = 'alimentar' and origin = 'blueprint') = 1
  and (select count(*) from public.plans where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          and status = 'arquivado' and kind = 'treino') = 1
  and (select count(*) from public.plans where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 2, '';
insert into _r select '03f o texto do plano é o da proposta guardada',
  (select content from public.plans where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'alimentar')
    = (:'proposta'::jsonb)->'plans'->0->>'content_markdown', '';
insert into _r select '03g metas: só as pedidas que estão na lista branca, com o valor da proposta',
  :'ok2'::jsonb->'goals' = '["calorie_goal_kcal","protein_goal_g","water_goal_ml"]'::jsonb
  and (select calorie_goal_kcal = 2200 and protein_goal_g = 140 and water_goal_ml = 2500
              and weekly_workouts_goal is null and name = 'Ana'
         from public.profiles where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '"name" e "pillars" foram pedidos e ignorados; treinos não foi pedido.';
insert into _r select '03h hábitos marcados, uma vez',
  (:'ok2'::jsonb->>'habits')::int = 2
  and (select count(*) from public.habits where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 2, '';
insert into _r select '03i carimbo de ativação, status activated e evento activated',
  (select blueprint_activated_at is not null from public.profiles
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
  and (select status = 'activated' and activation_result is not null from public.blueprint_proposals
        where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
  and (select count(*) from public.blueprint_events
        where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'activated') = 1, '';

-- Terceira chamada (a aba que ficou aberta aperta "Ativar" de novo).
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001', false);
select public.activate_blueprint(:'escolhas_ativar'::jsonb, :'metas'::text[]) as ok3 \gset
set role postgres;
insert into _r select '03j a terceira chamada devolve already, com o resultado da primeira',
  (:'ok3'::jsonb->>'ok')::boolean and (:'ok3'::jsonb->>'already')::boolean
  and :'ok3'::jsonb->'plans_activated' = '["alimentar"]'::jsonb, :'ok3';
insert into _r select '03k ... e não grava nada de novo',
  (select count(*) from public.plans  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 2
  and (select count(*) from public.habits where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 2
  and (select count(*) from public.blueprint_events
        where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'activated') = 1, '';
set role service_role;
insert into _r select '03l a função de borda vê "activated" e não gera de novo',
  (public.claim_blueprint_generation('aaaaaaaa-0000-0000-0000-000000000001')->>'outcome') = 'activated', '';
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001', false);
insert into _r select '03m depois de ativada, as escolhas não mudam mais (55000)',
  pg_temp.tenta($$select public.save_blueprint_choices('{"plans":[false,false,false],"habits":[false,false],"goals":false}')$$) = '55000', '';

-- ═══ 4. OUTRA PESSOA NÃO LÊ NEM ESCREVE ═══════════════════════════════
-- Davi tem a própria proposta pronta; Bruno não tem nenhuma.
set role service_role;
select (public.claim_blueprint_generation('dddddddd-0000-0000-0000-000000000004')->>'outcome');
update public.blueprint_proposals
   set status = 'ready', proposal = :'proposta'::jsonb, choices = :'escolhas_iniciais'::jsonb, generated_at = now()
 where user_id = 'dddddddd-0000-0000-0000-000000000004';

set role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002', false);
insert into _r select '04a Bruno não vê a proposta de ninguém',
  (select count(*) from public.blueprint_proposals) = 0, '';
insert into _r select '04b Bruno não vê o rastro de ninguém',
  (select count(*) from public.blueprint_events) = 0, '';
insert into _r select '04c Bruno não escreve direto na proposta alheia (sem grant)',
  pg_temp.tenta($$update public.blueprint_proposals set choices = '{}' where user_id = 'dddddddd-0000-0000-0000-000000000004'$$) = '42501', '';
insert into _r select '04d Bruno não cria proposta, nem para si (sem grant)',
  pg_temp.tenta($$insert into public.blueprint_proposals (user_id, status) values ('bbbbbbbb-0000-0000-0000-000000000002','ready')$$) = '42501', '';
insert into _r select '04e Bruno não forja evento (sem grant)',
  pg_temp.tenta($$insert into public.blueprint_events (user_id, kind) values ('bbbbbbbb-0000-0000-0000-000000000002','activated')$$) = '42501', '';
insert into _r select '04f as RPCs de Bruno só enxergam Bruno (sem proposta → P0002)',
  pg_temp.tenta($$select public.save_blueprint_choices('{"plans":[false,false,false],"habits":[false,false],"goals":false}')$$) = 'P0002'
  and pg_temp.tenta($$select public.activate_blueprint('{"plans":[true,true,true],"habits":[true,true],"goals":true}', '{calorie_goal_kcal}')$$) = 'P0002', '';

-- Segunda tranca: mesmo se alguém conceder escrita por engano, a RLS recusa.
set role postgres;
grant insert, update, delete on public.blueprint_proposals, public.blueprint_events to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002', false);
update public.blueprint_proposals set choices = '{}' where user_id = 'dddddddd-0000-0000-0000-000000000004';
delete from public.blueprint_events where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into _r select '04g com grant por engano, a RLS ainda recusa escrita direta (42501)',
  pg_temp.tenta($$insert into public.blueprint_proposals (user_id, status) values ('bbbbbbbb-0000-0000-0000-000000000002','ready')$$) = '42501', '';
set role postgres;
revoke insert, update, delete on public.blueprint_proposals, public.blueprint_events from authenticated;
insert into _r select '04h ... e o update e o delete de Bruno não alcançaram nada',
  (select choices = :'escolhas_iniciais'::jsonb from public.blueprint_proposals
    where user_id = 'dddddddd-0000-0000-0000-000000000004')
  and (select count(*) from public.blueprint_events
        where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') >= 4, '';

-- TRUNCATE não passa por RLS: com o grant que o Supabase dá por padrão, um
-- `authenticated` apagaria a proposta de TODO MUNDO numa linha. A migração
-- revoga tudo e devolve só o select; aqui se prova que isso sobreviveu aos
-- default privileges simulados no topo do arquivo.
set role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002', false);
insert into _r select '04j authenticated NÃO trunca blueprint_proposals (42501)',
  pg_temp.tenta_e_desfaz($$truncate public.blueprint_proposals$$) = '42501', '';
insert into _r select '04k authenticated NÃO trunca blueprint_events (42501)',
  pg_temp.tenta_e_desfaz($$truncate public.blueprint_events$$) = '42501', '';
insert into _r select '04l authenticated NÃO lê last_value da sequência (quantos eventos o produto já gravou)',
  pg_temp.tenta($$select last_value from public.blueprint_events_id_seq$$) = '42501', '';
insert into _r select '04m ... e continua lendo a própria linha (o select devolvido)',
  pg_temp.tenta($$select 1 from public.blueprint_proposals$$) = 'ok', '';
set role postgres;
insert into _r select '04n os privilégios que sobraram são só select (authenticated) e nada (anon)',
  (select string_agg(distinct privilege_type, ',' order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('blueprint_proposals','blueprint_events')
      and grantee = 'authenticated') = 'SELECT'
  and not exists (select 1 from information_schema.role_table_grants
                   where table_schema = 'public' and table_name in ('blueprint_proposals','blueprint_events')
                     and grantee = 'anon'),
  (select string_agg(grantee || ':' || privilege_type, ' ' order by grantee, privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'blueprint_proposals' and grantee in ('anon','authenticated'));

set role anon;
insert into _r select '04i anônimo não lê nada nem chama RPC',
  pg_temp.tenta($$select 1 from public.blueprint_proposals$$) = '42501'
  and pg_temp.tenta($$select public.dismiss_blueprint()$$) = '42501', '';
set role postgres;

-- ═══ 6. EXPLORAR PRIMEIRO: ADIA, NÃO APAGA ════════════════════════════
set role authenticated;
select set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-000000000004', false);
select public.dismiss_blueprint();
select public.dismiss_blueprint();
insert into _r select '06a "explorar primeiro" carimba e a proposta FICA',
  (select dismissed_at is not null and status = 'ready' and proposal = :'proposta'::jsonb
     from public.blueprint_proposals where user_id = auth.uid()), '';
insert into _r select '06b adiar duas vezes registra uma vez (idempotente)',
  (select count(*) from public.blueprint_events where kind = 'dismissed') = 1, '';
set role service_role;
insert into _r select '06c depois de adiar, a proposta continua retomável (sem gerar de novo)',
  (public.claim_blueprint_generation('dddddddd-0000-0000-0000-000000000004')->>'outcome') = 'ready', '';
set role authenticated;
select set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-000000000004', false);
-- ─── ATIVAR NADA NÃO CONSOME A PROPOSTA ───────────────────────────────
-- Desmarcou tudo e tocou "Ativar"; ou deixou "metas" marcado sem nenhuma
-- área com meta que ela acompanhe (a lista de chaves chega vazia, ou só com
-- chave fora da lista branca). Nada a aplicar: a linha continua `ready`.
select public.activate_blueprint('{"plans":[false,false,false],"habits":[false,false],"goals":false}', '{}') as nada1 \gset
select public.activate_blueprint('{"plans":[false,false,false],"habits":[false,false],"goals":true}', '{}') as nada2 \gset
select public.activate_blueprint('{"plans":[false,false,false],"habits":[false,false],"goals":true}', '{name,pillars}') as nada3 \gset
set role postgres;
insert into _r select '06d1 ativar NADA devolve {ok, nada} nas três formas (tudo desmarcado; metas sem chave; só chave fora da lista)',
  :'nada1'::jsonb = '{"ok": true, "nada": true}'::jsonb
  and :'nada2'::jsonb = '{"ok": true, "nada": true}'::jsonb
  and :'nada3'::jsonb = '{"ok": true, "nada": true}'::jsonb, :'nada3';
insert into _r select '06d2 ... e a proposta CONTINUA ready: sem carimbo, sem evento activated, sem plano',
  (select status = 'ready' and activated_at is null and activation_result is null from public.blueprint_proposals
    where user_id = 'dddddddd-0000-0000-0000-000000000004')
  and (select blueprint_activated_at is null from public.profiles
        where user_id = 'dddddddd-0000-0000-0000-000000000004')
  and (select count(*) from public.blueprint_events
        where user_id = 'dddddddd-0000-0000-0000-000000000004' and kind = 'activated') = 0
  and (select count(*) from public.plans where user_id = 'dddddddd-0000-0000-0000-000000000004') = 0, '';
set role authenticated;
select set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-000000000004', false);
insert into _r select '06d3 ... e as escolhas ainda podem mudar',
  pg_temp.tenta($$select public.save_blueprint_choices('{"plans":[false,false,true],"habits":[false,false],"goals":false}')$$) = 'ok', '';
select public.activate_blueprint('{"plans":[false,false,true],"habits":[false,false],"goals":false}', '{}') as dav \gset
insert into _r select '06d ... e ativável DE VERDADE depois do "nada", quando ela quiser',
  (:'dav'::jsonb->>'ok')::boolean and :'dav'::jsonb->'plans_activated' = '["financeiro"]'::jsonb
  and :'dav'::jsonb->'nada' is null, :'dav';
set role postgres;
insert into _r select '06d4 ... e só agora a linha vira activated, com carimbo e evento',
  (select status = 'activated' from public.blueprint_proposals
    where user_id = 'dddddddd-0000-0000-0000-000000000004')
  and (select blueprint_activated_at is not null from public.profiles
        where user_id = 'dddddddd-0000-0000-0000-000000000004')
  and (select count(*) from public.blueprint_events
        where user_id = 'dddddddd-0000-0000-0000-000000000004' and kind = 'activated') = 1, '';
set role authenticated;
-- Sem proposta nenhuma (Blueprint local, modelo desligado), adiar não é erro.
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002', false);
insert into _r select '06e adiar sem proposta não é erro',
  pg_temp.tenta($$select public.dismiss_blueprint()$$) = 'ok', '';

-- ═══ 5. APAGAR A CONTA LEVA TUDO ══════════════════════════════════════
-- `delete-account` apaga o usuário em auth.users (supabase.auth.admin.deleteUser);
-- as duas tabelas têm `on delete cascade` para ele.
set role postgres;
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into _r select '05 apagar a conta apaga proposta e rastro, sem órfão',
  (select count(*) from public.blueprint_proposals where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.blueprint_events where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, '';

-- Limpeza do gatilho de teste.
drop trigger if exists _teste_falha on public.habits;
drop function if exists public._teste_falha_habito();

\pset format aligned
select case when ok then '  ok ' else 'FALHA' end as r, n, coalesce(obs,'') from _r order by n;
select count(*) filter (where not ok) as falhas, count(*) as total from _r;
