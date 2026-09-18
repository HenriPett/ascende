-- ═══════════════════════════════════════════════════════════════════════
-- AS QUATRO REVOGAÇÕES, PROVADAS COM TRÊS PESSOAS DE VERDADE
--
-- Este arquivo não é documentação: ele RODA. A camada Social é a primeira do
-- Ascende em que uma linha de alguém é lida por outra pessoa, e a diferença
-- entre "a política está certa" e "a política está certa" só aparece quando
-- três usuários com JWTs diferentes tentam ler um do outro.
--
-- Cobre, em ordem: nada nasce aberto, reciprocidade, série diária de terceiro,
-- vazamento entre grupos, as quatro revogações (desligar, sair, ser removido,
-- apagar a conta), a janela de quem chega depois, o convite de uso único, e as
-- doze invariantes estruturais de social_autoteste().
--
-- ─── COMO RODAR (cluster descartável, nunca o Supabase) ────────────────
--   initdb -D /tmp/asc/data -U postgres --auth=trust
--   pg_ctl -D /tmp/asc/data -o "-p 55999 -k /tmp/asc" start
--   createdb -h /tmp/asc -p 55999 -U postgres ascende
--   psql ... -f supabase/tests/_stub_auth.sql     (o schema auth do Supabase)
--   psql ... -f supabase/setup.sql
--   psql ... -f supabase/migrations/<cada uma, em ordem>
--   psql ... -f supabase/tests/social_quatro_revogacoes.sql
--
-- A última linha imprime `falhas | total`. Qualquer número diferente de zero
-- na primeira coluna é um vazamento ou uma revogação que não revoga.
--
-- Estado em 18/09/2026: 42 verificações, 0 falhas. Cobre o limiar 3 de 4, o
-- denominador que encolhe, a ausência de sequencia_dias e a trava contra a
-- SERVICE_ROLE_KEY.
-- ═══════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
-- Concessões que o Supabase faz por padrão e que o setup.sql não repete.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

create table if not exists _r (n text, ok boolean, obs text);
grant all on _r to authenticated;
truncate _r;

delete from auth.users;
delete from public.groups;

-- Três pessoas.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ana@x'),
  ('22222222-2222-2222-2222-222222222222','bruno@x'),
  ('33333333-3333-3333-3333-333333333333','carla@x');
update public.profiles set water_goal_ml=2000, sleep_goal_h=7 where user_id is not null;
insert into public.profiles (user_id, name, water_goal_ml, sleep_goal_h) values
  ('11111111-1111-1111-1111-111111111111','Ana',   2000, 7),
  ('22222222-2222-2222-2222-222222222222','Bruno', 2000, 7),
  ('33333333-3333-3333-3333-333333333333','Carla', 2000, 7)
on conflict (user_id) do update set name = excluded.name, water_goal_ml = 2000, sleep_goal_h = 7;

-- ─── Ana cria o grupo e convida ────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
select public.criar_grupo('Casa da Subida', 'Ana', current_date + 30) as g \gset
select public.criar_convite(:'g') as cb \gset
select public.criar_convite(:'g') as cc \gset
select public.criar_convite(:'g') as cd \gset

select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', false);
select public.aceitar_convite(:'cb','Bruno');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', false);
select public.aceitar_convite(:'cc','Carla');

-- Convite: uso único, recusa mata o link, e o hash não volta em claro.
select public.recusar_convite(:'cd');
set role postgres;
insert into _r select '20 convite é de uso único',
  (select uses >= max_uses from public.group_invites
    where code_hash = encode(sha256(:'cb'::bytea),'hex')), '';
insert into _r select '21 recusar revoga o link na hora e registra a recusa',
  (select revoked_at is not null from public.group_invites
    where code_hash = encode(sha256(:'cd'::bytea),'hex'))
  and (select count(*) from public.group_invite_declines
        where user_id = '33333333-3333-3333-3333-333333333333') = 1, '';
insert into _r select '22 o código não é recuperável do banco (só o hash)',
  not exists (select 1 from information_schema.columns
               where table_name = 'group_invites' and column_name in ('code','codigo')), '';
insert into _r select '23 mesmo quem administra não relê o código',
  (select count(*) from public.group_invites where code_hash = :'cb') = 0,
  'O que está guardado é o hash; o código em claro não existe no banco.';
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);

-- ─── Ana registra treino e água hoje, e um treino de 5 dias atrás ──────
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
insert into public.life_events (user_id, pillar, kind, occurred_at, payload) values
  (auth.uid(),'vitalidade','workout', now(), '{"duration_min":45}'),
  (auth.uid(),'vitalidade','water',   now(), '{"ml":2500}'),
  (auth.uid(),'vitalidade','workout', now() - interval '5 days', '{"duration_min":30}'),
  (auth.uid(),'prosperidade','transaction', now(), '{"amount":250,"category":"Mercado"}'),
  (auth.uid(),'vitalidade','weight',  now(), '{"kg":81.4}'),
  (auth.uid(),'mente','journal',      now(), '{"text":"hoje foi um dia dificil"}');

insert into _r select '00 projeção só dos atos permitidos',
  (select count(*) from public.shared_daily_stats
    where user_id = auth.uid() and day = current_date) = 2,
  (select string_agg(metric_key, ',' order by metric_key) from public.shared_daily_stats
    where user_id = auth.uid() and day = current_date);

-- ─── O LIMIAR: 3 DE 4 ──────────────────────────────────────────────────
-- Ana acompanha os quatro sinais. Com treino + água (2 de 4) o dia NÃO fecha.
insert into _r select '00a 2 de 4 não fecha o dia',
  not exists (select 1 from public.shared_daily_stats
               where user_id = auth.uid() and day = current_date and metric_key = 'dia_inteiro'),
  'treino + água, sem sono e sem refeição.';

-- Com a refeição, vira 3 de 4: fecha, mesmo SEM sono. É o dia de descanso
-- continuando a fechar o dia pelos outros três.
insert into public.life_events (user_id, pillar, kind, occurred_at, payload)
  values (auth.uid(), 'vitalidade', 'meal', now(), '{"desc":"almoço"}');
insert into _r select '00b 3 de 4 FECHA o dia (a folga é da regra)',
  exists (select 1 from public.shared_daily_stats
           where user_id = auth.uid() and day = current_date and metric_key = 'dia_inteiro'),
  'treino + água + refeição, sem sono — e o dia fecha.';
-- A SEQUÊNCIA SAIU DO CATÁLOGO (decisão de fundador, 18/09/2026): sequência
-- punitiva com plateia, contra a régua privada que perdoa um dia por semana.
insert into _r select '00c a sequência não existe mais, em lugar nenhum',
  not exists (select 1 from public.shareable_metrics  where metric_key = 'sequencia_dias')
  and not exists (select 1 from public.shared_daily_stats where metric_key = 'sequencia_dias')
  and (select count(*) from public.shareable_metrics) = 7,
  'Sete chaves. Somar dias não tem penhasco; emendar tem.';

-- ─── O DENOMINADOR ENCOLHE, NÃO REPROVA ───────────────────────────────
-- Carla desliga o tracker de água: passa a acompanhar 3 sinais, e fecha o dia
-- com 2 deles. Mesma doutrina de tracking_prefs — desligado não é reprovado.
set role postgres;
update public.profiles set tracking_prefs = '{"water": false}'::jsonb
 where user_id = '33333333-3333-3333-3333-333333333333';
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', false);
insert into public.life_events (user_id, pillar, kind, occurred_at, payload) values
  (auth.uid(),'vitalidade','workout', now(), '{"duration_min":30}'),
  (auth.uid(),'vitalidade','meal',    now(), '{"desc":"jantar"}');
insert into _r select '00d quem desligou um tracker conta 2 de 3, e fecha',
  exists (select 1 from public.shared_daily_stats
           where user_id = auth.uid() and day = current_date and metric_key = 'dia_inteiro'),
  'Carla não acompanha água: exigíveis caem para 3, e treino + refeição bastam.';
insert into _r select '00e e ela não ganha crédito de água que não acompanha',
  not exists (select 1 from public.shared_daily_stats
               where user_id = auth.uid() and day = current_date and metric_key = 'agua_fechada'), '';
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);

-- ─── 1. NADA NASCE ABERTO ──────────────────────────────────────────────
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', false);
insert into _r select '01 tudo nasce fechado: Bruno não vê nada da Ana',
  (select count(*) from public.group_visible_stats
    where user_id = '11111111-1111-1111-1111-111111111111') = 0, '';

-- ─── 2. RECIPROCIDADE: Ana liga, Bruno não ─────────────────────────────
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
insert into public.group_data_consents (group_id, user_id, metric_key, goal_value)
  values (:'g', auth.uid(), 'treino_registrado', 4);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', false);
insert into _r select '02 reciprocidade: quem não dá, não vê',
  (select count(*) from public.group_visible_stats
    where user_id = '11111111-1111-1111-1111-111111111111') = 0,
  'Ana já publicou, mas Bruno não compartilha treino neste grupo.';

-- ─── 3. BRUNO LIGA A MESMA MÉTRICA ─────────────────────────────────────
insert into public.group_data_consents (group_id, user_id, metric_key, goal_value)
  values (:'g', auth.uid(), 'treino_registrado', 3);
insert into _r select '03 com reciprocidade, Bruno vê o treino de HOJE da Ana',
  (select count(*) from public.group_visible_stats
    where user_id = '11111111-1111-1111-1111-111111111111') = 1, '';

-- ─── 4. SÉRIE DIÁRIA DE TERCEIRO NÃO SAI ───────────────────────────────
insert into _r select '04 terceiro não recebe série diária (o dia -5 não sai)',
  (select count(*) from public.group_visible_stats
    where user_id = '11111111-1111-1111-1111-111111111111'
      and day < current_date - 1) = 0, '';

-- ─── 5. SÓ A MÉTRICA LIGADA ────────────────────────────────────────────
insert into _r select '05 só a métrica ligada aparece',
  (select coalesce(string_agg(distinct metric_key, ','), '') from public.group_visible_stats
    where user_id = '11111111-1111-1111-1111-111111111111') = 'treino_registrado', '';

-- ─── 6. A FONTE CONTINUA FECHADA ───────────────────────────────────────
insert into _r select '06 Bruno não lê life_events da Ana',
  (select count(*) from public.life_events
    where user_id = '11111111-1111-1111-1111-111111111111') = 0, '';
insert into _r select '07 Bruno não lê o profile da Ana (renda, remédios)',
  (select count(*) from public.profiles
    where user_id = '11111111-1111-1111-1111-111111111111') = 0, '';
insert into _r select '08 Bruno não lê transactions da Ana',
  (select count(*) from public.transactions
    where user_id = '11111111-1111-1111-1111-111111111111') = 0, '';

-- ─── 7. CROSS-GROUP: consentimento de um grupo não vaza no outro ───────
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
select public.criar_grupo('Só a família', 'Ana', current_date + 30) as g2 \gset
insert into public.group_data_consents (group_id, user_id, metric_key, goal_value)
  values (:'g2', auth.uid(), 'agua_fechada', 7);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', false);
insert into public.group_data_consents (group_id, user_id, metric_key, goal_value)
  values (:'g', auth.uid(), 'agua_fechada', 7);
insert into _r select '09 CROSS-GROUP: água ligada na família não aparece na Casa',
  (select count(*) from public.group_visible_stats
    where user_id = '11111111-1111-1111-1111-111111111111'
      and metric_key = 'agua_fechada') = 0,
  'Bruno tem reciprocidade em água, mas Ana só liberou água no OUTRO grupo.';

-- ─── 8. REVOGAÇÃO (a): DESLIGAR UM TIPO DE DADO ────────────────────────
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
delete from public.group_data_consents
 where group_id = :'g' and user_id = auth.uid() and metric_key = 'treino_registrado';
set role postgres;
insert into _r select '10 REVOGAÇÃO (a): desligar APAGA as linhas publicadas',
  (select count(*) from public.group_visible_stats
    where group_id = :'g' and user_id = '11111111-1111-1111-1111-111111111111') = 0,
  'Não é predicado escondendo: as linhas deixaram de existir.';
insert into _r select '11 REVOGAÇÃO (a): o dado da Ana continua dela',
  (select count(*) from public.shared_daily_stats
    where user_id = '11111111-1111-1111-1111-111111111111' and day = current_date) = 4,
  'A projeção pessoal e os life_events ficam intactos.';
insert into _r select '12 REVOGAÇÃO (a): ficou trilha do desligamento',
  (select count(*) from public.consent_events
    where user_id = '11111111-1111-1111-1111-111111111111' and action = 'desligou') = 1, '';
set role authenticated;

-- ─── 9. JANELA: quem chega depois não vê o que é de antes ──────────────
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
insert into public.group_data_consents (group_id, user_id, metric_key, goal_value)
  values (:'g', auth.uid(), 'treino_registrado', 4);
set role postgres;
update public.group_members set joined_at = now() - interval '10 days'
 where group_id = :'g' and user_id in ('11111111-1111-1111-1111-111111111111',
                                       '22222222-2222-2222-2222-222222222222');
alter table public.group_data_consents disable trigger trg_consentimento_imutavel;
update public.group_data_consents set granted_at = now() - interval '10 days'
 where group_id = :'g' and user_id = '11111111-1111-1111-1111-111111111111';
alter table public.group_data_consents enable trigger trg_consentimento_imutavel;
select public.publicar_dia('11111111-1111-1111-1111-111111111111', current_date - 5);
insert into _r select '13 a janela deixa publicar o dia -5 (todos já estavam no grupo)',
  (select count(*) from public.group_visible_stats
    where group_id = :'g' and user_id = '11111111-1111-1111-1111-111111111111'
      and day = current_date - 5) = 1, '';
-- Carla entrou HOJE: o dia -5 da Ana não é dela.
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', false);
insert into public.group_data_consents (group_id, user_id, metric_key, goal_value)
  values (:'g', auth.uid(), 'treino_registrado', 3);
insert into _r select '14 JANELA: Carla, que entrou hoje, não vê o passado da Ana',
  (select count(*) from public.group_visible_stats
    where group_id = :'g' and user_id = '11111111-1111-1111-1111-111111111111'
      and day = current_date - 5) = 0, '';

-- ─── 10. REVOGAÇÃO (b): SAIR DO GRUPO ──────────────────────────────────
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
insert into public.group_notes (group_id, author_id, text) values (:'g', auth.uid(), 'bora!');
select public.sair_do_grupo(:'g');
set role postgres;
insert into _r select '15 REVOGAÇÃO (b): sair apaga stats, consentimentos e recados',
  (select count(*) from public.group_visible_stats where group_id = :'g'
     and user_id = '11111111-1111-1111-1111-111111111111') = 0
  and (select count(*) from public.group_data_consents where group_id = :'g'
     and user_id = '11111111-1111-1111-1111-111111111111') = 0
  and (select count(*) from public.group_notes where group_id = :'g'
     and author_id = '11111111-1111-1111-1111-111111111111') = 0, '';
insert into _r select '16 REVOGAÇÃO (b): o grupo sobrevive e ganha novo dono',
  (select count(*) from public.group_members where group_id = :'g' and role = 'owner') = 1, '';

-- ─── 11. REVOGAÇÃO (c): SER REMOVIDO ───────────────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', false);
select public.remover_membro(:'g','33333333-3333-3333-3333-333333333333');
set role postgres;
insert into _r select '17 REVOGAÇÃO (c): removido some do grupo, com trilha de quem removeu',
  (select count(*) from public.group_members where group_id = :'g'
     and user_id = '33333333-3333-3333-3333-333333333333') = 0
  and (select count(*) from public.group_membership_events where group_id = :'g'
     and subject_id = '33333333-3333-3333-3333-333333333333' and action = 'removido') = 1, '';

-- ─── 12. REVOGAÇÃO (d): APAGAR A CONTA ─────────────────────────────────
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
insert into _r select '18 REVOGAÇÃO (d): apagar a conta leva tudo, sem órfão',
  (select count(*) from public.group_visible_stats where user_id = '22222222-2222-2222-2222-222222222222') = 0
  and (select count(*) from public.group_members where user_id = '22222222-2222-2222-2222-222222222222') = 0
  and (select count(*) from public.shared_daily_stats where user_id = '22222222-2222-2222-2222-222222222222') = 0
  and (select count(*) from public.groups where id = :'g2') = 1,
  'E o grupo que a Ana criou continua de pé.';

-- ─── 13. O AUTOTESTE ───────────────────────────────────────────────────
insert into _r select '19 autoteste estrutural: ' || teste, passou, detalhe
  from public.social_autoteste();

\pset format aligned
select case when ok then '  ok ' else 'FALHA' end as r, n, coalesce(obs,'') from _r order by n;
select count(*) filter (where not ok) as falhas, count(*) as total from _r;
