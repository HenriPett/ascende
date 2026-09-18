-- ═══════════════════════════════════════════════════════════════════════
-- O AUTOTESTE QUE A PRÓPRIA MIGRATION APAGOU
--
-- Erro meu, e vale escrever inteiro porque a forma dele se repete barato.
--
-- A 20260918190000 definiu `social_autoteste()` assim:
--
--     social_autoteste() = social_autoteste_base()
--                        + '13 a chave de serviço não lê a camada Social'   (INLINE)
--                        + '14 a composição do dia inteiro mora no catálogo' (INLINE)
--
-- A 20260918200000 fez `create or replace social_autoteste()` = base() ∪ semana().
-- Os dois testes inline não moravam numa função própria — moravam no corpo do
-- wrapper. O `create or replace` os DESCARTOU, sem erro, sem aviso, sem uma
-- linha no log. E a numeração denuncia o acidente: `social_autoteste_semana()`
-- começa em '13', colidindo com o 13 que acabava de sumir.
--
-- ─── POR QUE ISSO É PIOR QUE UM TESTE QUEBRADO ─────────────────────────
-- Um teste que falha grita. Um teste que SUMIU devolve uma lista que parece
-- completa: `select * from public.social_autoteste();` respondia tudo verde
-- sobre um conjunto menor. Quem mede o placar mede contra a régua errada e
-- fica mais confiante do que antes — que é o único jeito de um autoteste
-- piorar a segurança de um sistema.
--
-- ─── O QUE DEIXOU DE RODAR, E O QUE ISSO CUSTOU NA PRÁTICA ─────────────
-- O 13 é o alarme de que tabela nova do Social não nasce concedida à chave de
-- serviço ("BYPASSRLS ignora política, não ignora grant"). E a 200000 criou
-- DOIS objetos novos: `group_pulse` (caminho B do sino) e `v_grupo_semana`.
-- Nenhum dos dois foi revogado de `service_role` em lugar nenhum daquele
-- arquivo. `v_grupo_semana` é `security_invoker`, o que a protege do cliente —
-- mas `service_role` tem BYPASSRLS, e security_invoker + BYPASSRLS lê tudo.
-- Ou seja: o teste que teria pego o buraco foi apagado pela mesma migration
-- que abriu o buraco. As duas coisas são o mesmo descuido, não duas.
--
-- ─── O CONSERTO ESTRUTURAL, PARA NÃO DEPENDER DE EU LEMBRAR ────────────
-- Não basta devolver os dois testes: enquanto o wrapper for uma lista escrita
-- à mão, o próximo `create or replace` repete isto. Então o wrapper passa a
-- DESCOBRIR os blocos por catálogo (`social_autoteste_%`, zero argumentos) e a
-- somar todos. Adicionar um bloco novo passa a ser `create function` e mais
-- nada — não há mais motivo para editar o wrapper, e por isso não há mais
-- ocasião de encolhê-lo sem querer.
--
-- E `autoteste_integridade()` (de propósito SEM o prefixo, para não entrar no
-- próprio laço) vigia a vigilância: a suíte não pode encolher e dois blocos não
-- podem numerar igual. Ele roda a suíte uma segunda vez para se conferir — é
-- caro e é para ser: isto aqui roda depois de deploy, não em requisição.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠  ESTA MIGRATION NÃO ALTERA UMA LINHA DE DADO.
--    Mexe em: definição de funções de teste, grants, duas views (só ACRESCENTA
--    coluna no fim) e uma coluna nova em `shareable_metrics`. A 20260918200000
--    já rodou em produção e NÃO deve ser editada nem reaplicada.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 1. O BURACO QUE O TESTE 13 TERIA PEGO
-- ═══════════════════════════════════════════════════════════════════════
-- Mesma lista explícita da 190000, mesmo motivo: revogar em massa no schema
-- público derrubaria a Prosperidade, o Conselheiro e a cobrança, que dependem
-- da chave de serviço. Aqui só os objetos que a 200000 criou.

do $mig$
declare t text;
begin
  foreach t in array array['group_pulse','v_grupo_semana'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from service_role, anon', t);
    end if;
  end loop;
end $mig$;

-- As funções novas da 200000. `create or replace` preserva ACL, então as que a
-- 190000 já havia revogado (`voltou_hoje`, `total_do_ciclo`, `barra_do_grupo`)
-- continuam fechadas mesmo tendo sido reescritas — mas reafirmar é de graça e
-- tira a pergunta da cabeça de quem ler depois.
revoke execute on function public.hoje_sp()                            from service_role, anon;
revoke execute on function public.inicio_da_semana()                   from service_role, anon;
revoke execute on function public.total_da_semana(uuid, uuid, text)    from service_role, anon;
revoke execute on function public.voltou_hoje(uuid, uuid)              from service_role, anon;
revoke execute on function public.total_do_ciclo(uuid, uuid)           from service_role, anon;
revoke execute on function public.barra_do_grupo(uuid)                 from service_role, anon;

do $mig$
begin
  if to_regprocedure('public.sino_toca(uuid)') is not null then
    execute 'revoke execute on function public.sino_toca(uuid) from public, anon, authenticated, service_role';
  end if;
end $mig$;

revoke execute on function public.tocar_sino()                from public, anon, authenticated, service_role;
revoke execute on function public.tocar_sino_lote()           from public, anon, authenticated, service_role;
revoke execute on function public.social_autoteste_semana()   from public, anon, authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. O RÓTULO CURTO MORA NO CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════
-- Decisão de dono dos dados, e ela é pelo BANCO. Três razões, na ordem:
--
-- 1. O `label` longo JÁ mora aqui. Metade do par no banco e metade em
--    `socialMetrics.ts` é exatamente a forma como duas verdades nascem — e
--    esta casa já tem a cicatriz: o teste 14 existe porque a composição do dia
--    inteiro divergiu entre catálogo e código uma vez, em 18/09/2026.
-- 2. O catálogo é fechado e só cresce por migration (sem política de escrita,
--    de propósito). `not null` aqui obriga quem adicionar a métrica número 8 a
--    decidir o rótulo curto NA MESMA MESA em que decide o resto — em vez de
--    descobrir na tela que ele não cabe.
-- 3. O `check` de 18 caracteres é a regra do Prisma virando restrição de
--    domínio. Torna "Dias com a água em dia" (22) impossível de entrar na
--    coluna errada por descuido. "Sono na janela" (14) é o mais longo que passa.
--
-- O label longo NÃO some: ele continua sendo o que a folha de consentimento
-- mostra, onde há espaço e onde a pessoa precisa entender o que está ligando.
-- Curto é para a ficha; longo é para a escolha.

alter table public.shareable_metrics add column if not exists label_curto text;

update public.shareable_metrics m set label_curto = v.curto
  from (values
    ('treino_registrado',   'Treinos'),
    ('agua_fechada',        'Água'),
    ('refeicao_registrada', 'Refeições'),
    ('sono_na_janela',      'Sono na janela'),
    ('soneca_registrada',   'Sonecas'),
    ('gratidao_registrada', 'Gratidão'),
    ('dia_inteiro',         'Dias inteiros')
  ) as v(chave, curto)
 where m.metric_key = v.chave
   and m.label_curto is distinct from v.curto;

-- Rede para uma métrica que exista neste banco e não esteja na lista acima:
-- o not null não pode derrubar a migration por causa de um dado que eu não vi.
update public.shareable_metrics set label_curto = left(label, 18)
 where label_curto is null;

alter table public.shareable_metrics alter column label_curto set not null;
alter table public.shareable_metrics drop constraint if exists shareable_metrics_label_curto_cabe;
alter table public.shareable_metrics add  constraint shareable_metrics_label_curto_cabe
  check (char_length(btrim(label_curto)) between 1 and 18);

comment on column public.shareable_metrics.label_curto is
  'O rótulo da FICHA (Água, Refeições, Sono na janela). O label longo continua sendo o da folha de consentimento: curto é para ver, longo é para escolher. 18 caracteres é o teto da ficha de 390px, e é check e não convenção porque convenção não cabe em coluna.';


-- ═══════════════════════════════════════════════════════════════════════
-- 3. AS VIEWS PASSAM A OFERECER O CRITÉRIO DE ORDEM
-- ═══════════════════════════════════════════════════════════════════════
-- O front ordenava pelo que tinha: o rótulo. Como o rótulo longo começa em
-- "Dias com...", a ordem alfabética embaralhava a fisiologia ("Dias com a água
-- em dia", "Dias inteiros", "Dias com gratidão"). `ordem` já existia em
-- `shareable_metrics` desde a 130000 e nenhuma view a publicava.
--
-- `create or replace view` só permite ACRESCENTAR coluna no fim — e é só isso
-- que acontece aqui. Nenhuma coluna existente muda de nome, tipo ou posição, e
-- o front que já lê estas views continua lendo igual.

create or replace view public.v_grupo_hoje
  with (security_invoker = true) as
select
  v.group_id,
  v.user_id,
  m.display_name,
  m.avatar_emoji,
  (v.user_id = auth.uid())                        as sou_eu,
  v.day,
  v.metric_key,
  s.label,
  v.value,
  v.goal_value,
  public.voltou_hoje(v.group_id, v.user_id)       as voltou,
  s.ordem,
  s.label_curto
from public.group_visible_stats v
join public.group_members m     on m.group_id = v.group_id and m.user_id = v.user_id
join public.shareable_metrics s on s.metric_key = v.metric_key
where v.day >= public.hoje_sp() - 1;

comment on view public.v_grupo_hoje is
  'O dia de hoje do grupo, em dias de São Paulo, com ordem e rótulo curto do catálogo. Não existe versão desta view com intervalo de datas: série diária de terceiro é o calendário de bolinhas, e ele não sai daqui.';

create or replace view public.v_grupo_semana
  with (security_invoker = true) as
select
  c.group_id,
  c.user_id,
  m.display_name,
  m.avatar_emoji,
  (c.user_id = auth.uid())                                    as sou_eu,
  c.metric_key,
  s.label,
  s.pillar,
  s.ordem,
  public.total_da_semana(c.group_id, c.user_id, c.metric_key) as feito,
  case when c.goal_period = 'semana' then c.goal_value end    as combinado,
  c.goal_period,
  s.label_curto
from public.group_data_consents c
join public.group_members m     on m.group_id   = c.group_id and m.user_id = c.user_id
join public.shareable_metrics s on s.metric_key = c.metric_key
where public.sou_membro(c.group_id)
  and public.grupo_legivel(c.group_id);

comment on view public.v_grupo_semana is
  'X/Y da semana corrente: uma linha por (grupo, pessoa, métrica CONSENTIDA), com ordem e rótulo curto do catálogo. Sem consentimento não há linha. feito NULL = não há direito ao número; feito 0 = há, e é zero. Não existe versão desta view com intervalo de datas.';

do $mig$
declare t text;
begin
  foreach t in array array['v_grupo_hoje','v_grupo_semana'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('revoke all on public.%I from service_role, anon', t);
  end loop;
end $mig$;


-- ═══════════════════════════════════════════════════════════════════════
-- 4. M7 — `total_do_ciclo` CONFUNDIA OS DOIS NULLs
-- ═══════════════════════════════════════════════════════════════════════
-- Dobrado aqui em vez de virar uma 220000 porque esta migration ainda não foi
-- colada e é idempotente (aplicada 4× seguidas no cluster local, sem erro e
-- sem mudança). Um arquivo só para o fundador colar é menos superfície de
-- engano que dois — e se ele já tiver colado, colar de novo é inofensivo.
--
-- O defeito é o MESMO que eu diagnostiquei em `v_desafio_progresso` e corrigi
-- em `total_da_semana`, e que deixei passar na função irmã: `sum()` sobre zero
-- linhas devolve NULL, e NULL é o que a função também devolve quando NÃO HÁ
-- DIREITO ao número. Duas coisas opostas com a mesma cara:
--
--     "você não pode ver isso"      → NULL
--     "você pode ver, e é zero"     → NULL  ← errado
--
-- O sintoma que o Pixel trouxe é exatamente a prova: a MESMA pessoa aparece
-- "0 de 6" no cartão (que vem de `total_da_semana`, onde os dois já estão
-- separados) e SOME da folha do desafio. Não é inconsistência de tela — são
-- duas funções irmãs discordando sobre o que é um zero.
--
-- A ponte que o Pixel pôs no cliente esconde o sintoma hoje. Mas regra de
-- privacidade que mora no front é regra que a próxima refatoração apaga sem
-- ninguém ver — é o argumento que esta mesa usa desde a primeira migration, e
-- ele não vale menos quando o erro é meu.

create or replace function public.total_do_ciclo(p_challenge uuid, p_user uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $fn$
declare ch record; p record; ini date; fim date; res numeric;
begin
  -- Os guardas continuam devolvendo NULL: aqui NULL significa "não há direito
  -- ao número", e é a única coisa que ele pode significar depois desta linha.
  if not public.sou_participante(p_challenge) then return null; end if;
  select * into ch from public.challenges where id = p_challenge;
  if ch.id is null then return null; end if;
  select * into p from public.challenge_participants
   where challenge_id = p_challenge and user_id = p_user;
  if p.user_id is null then return null; end if;
  if public.consentiu(ch.group_id, p_user,     ch.metric_key) = 'infinity'::date then return null; end if;
  if public.consentiu(ch.group_id, auth.uid(), ch.metric_key) = 'infinity'::date then return null; end if;
  ini := greatest(ch.starts_on, p.joined_at::date,
                  public.janela_de_visao(ch.group_id, p_user),
                  public.consentiu(ch.group_id, p_user, ch.metric_key));
  fim := least(ch.ends_on, public.hoje_sp());
  if ini > fim then return null; end if;
  -- e daqui para baixo, zero é zero: mesma regra de total_da_semana
  select coalesce(sum(v.value), 0) into res from public.group_visible_stats v
   where v.group_id = ch.group_id and v.user_id = p_user
     and v.metric_key = ch.metric_key and v.day between ini and fim;
  return res;
end $fn$;

comment on function public.total_do_ciclo(uuid, uuid) is
  'Total de uma pessoa num desafio, do começo do ciclo até hoje (São Paulo). Devolve UM número, nunca os dias. NULL = não há direito ao número; 0 = há direito, e a pessoa não fez. Antes devolvia NULL para os dois casos, e quem tinha feito zero SUMIA da folha do desafio enquanto aparecia como "0 de 6" no cartão.';

-- ─── A CONSEQUÊNCIA QUE O CONSERTO CRIA, E QUE NÃO PODE FICAR SOLTA ────
-- `podio` filtrava por `total_do_ciclo(...) is not null`. Isso, por acidente,
-- também excluía quem tinha feito zero — e agora que zero deixou de ser NULL,
-- essa pessoa passaria a aparecer NO PÓDIO, com 0, no fim de uma lista
-- ORDENADA.
--
-- O pódio é a única superfície ordenada que este produto tem, e ele só existe
-- com opt-in explícito por desafio. Mas opt-in de pódio é "aceito mostrar o
-- que eu fiz" — não é "aceito ser o chão de um ranking". Zero com denominador
-- SITUA quando está na ficha da própria pessoa (regra C do parecer); zero no
-- último lugar de uma lista ordenada é o ordinal que o parecer veta, com outro
-- nome. Então o piso passa a ser explícito: `> 0`.
create or replace function public.podio(p_challenge uuid)
returns table (user_id uuid, display_name text, total numeric)
language plpgsql stable security definer set search_path = public as $fn$
declare ch record;
begin
  if not public.sou_participante(p_challenge) then return; end if;
  select * into ch from public.challenges where id = p_challenge;
  if ch.id is null then return; end if;
  if not ch.competitivo then return; end if;
  return query
    select p.user_id, m.display_name, public.total_do_ciclo(p_challenge, p.user_id)
      from public.challenge_participants p
      join public.group_members m on m.group_id = ch.group_id and m.user_id = p.user_id
     where p.challenge_id = p_challenge
       and p.podio_publico                                        -- opt-in explícito
       and coalesce(public.total_do_ciclo(p_challenge, p.user_id), 0) > 0;
end $fn$;

comment on function public.podio(uuid) is
  'O pódio de um desafio competitivo, só para quem optou explicitamente. Piso > 0 e não "is not null": desde que zero deixou de ser NULL, o is not null colocaria quem fez zero no fim de uma lista ORDENADA — que é o ordinal que o parecer veta, com outro nome.';

-- `v_desafio_progresso` não muda de corpo: ela só chama a função. O que muda é
-- o que o comentário promete — e comentário que promete o contrário do código
-- é pior que comentário nenhum.
comment on view public.v_desafio_progresso is
  'Uma linha por participante, SEM ORDEM, com feito e combinado lado a lado. feito NULL = não há direito ao número (sem consentimento ou sem reciprocidade); feito 0 = há direito, e a pessoa não fez. Mesma regra de v_grupo_semana.';

do $mig$
begin
  execute 'revoke execute on function public.podio(uuid) from public, anon, service_role';
  execute 'grant  execute on function public.podio(uuid) to authenticated';
end $mig$;


-- ═══════════════════════════════════════════════════════════════════════
-- 5. OS DOIS TESTES DE VOLTA, AGORA NUM BLOCO PRÓPRIO
-- ═══════════════════════════════════════════════════════════════════════
-- Mesmos 13 e 14 da 190000, palavra por palavra, com uma diferença: a lista de
-- objetos do teste 13 cresce com `group_pulse` e `v_grupo_semana`, que são
-- justamente os que escaparam enquanto ele esteve apagado.
--
-- Eles moram numa FUNÇÃO agora, e não inline no wrapper. É essa a lição: teste
-- que mora dentro do wrapper morre no primeiro `create or replace` do wrapper.

create or replace function public.social_autoteste_servico()
returns table (teste text, passou boolean, detalhe text)
language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  return query select
    '13 a chave de serviço não lê a camada Social',
    not exists (
      select 1
        from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee in ('service_role','anon')
         and table_name in ('groups','group_members','group_invites','group_invite_declines',
                            'group_membership_events','shareable_metrics','group_data_consents',
                            'consent_events','shared_daily_stats','group_visible_stats',
                            'challenges','challenge_participants','group_recognitions','group_notes',
                            'group_pulse',
                            'v_grupo_hoje','v_desafio_progresso','v_meus_consentimentos',
                            'v_meus_grupos','v_grupo_semana')
    ),
    'BYPASSRLS ignora política, não ignora grant. Tabela nova do Social nasce concedida à service role: revogue aqui.';

  return query select
    '14 a composição do dia inteiro mora no catálogo, não no código',
    (select count(*) = 7 from public.shareable_metrics)
    and not exists (select 1 from public.shareable_metrics where metric_key = 'sequencia_dias')
    and (select array_length(composed_of, 1) = 4 from public.shareable_metrics where metric_key = 'dia_inteiro')
    and (select not (prosrc ~ 'v_cumpridos\s*=\s*v_exigiveis')
           and prosrc ~ 'greatest\s*\(\s*1\s*,\s*v_exigiveis\s*-\s*1\s*\)'
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'projetar_dia'),
    'Sete chaves (a sequência saiu em 18/09). Três de quatro, nunca quatro de quatro, e a lista dos sinais num lugar só.';
end $fn$;

comment on function public.social_autoteste_servico() is
  'Os testes 13 e 14, que a 20260918200000 apagou ao recriar o wrapper. Estão numa função própria justamente para que o próximo create or replace do wrapper não os leve junto.';


-- ═══════════════════════════════════════════════════════════════════════
-- 6. A SUÍTE DA SEMANA, RENUMERADA A PARTIR DE 15
-- ═══════════════════════════════════════════════════════════════════════
-- Só os números mudam. O conteúdo de cada teste é o mesmo da 200000.

create or replace function public.social_autoteste_semana()
returns table (teste text, passou boolean, detalhe text)
language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  return query select
    '15 v_grupo_semana nasce do consentimento, não da publicação',
    (select pg_get_viewdef('public.v_grupo_semana'::regclass) ilike '%group_data_consents%'
        and pg_get_viewdef('public.v_grupo_semana'::regclass) not ilike '%group_visible_stats%'),
    'Sem consentimento não há linha. A regra "quem não compartilha não aparece" é a ausência, não um filtro que o front precisa lembrar.';

  return query select
    '16 total_da_semana falha fechado',
    public.total_da_semana('00000000-0000-0000-0000-000000000000',
                           '00000000-0000-0000-0000-000000000000',
                           'treino_registrado') is null,
    'Sem filiação, sem reciprocidade e sem consentimento, a resposta é NULL — nunca 0, que seria uma acusação.';

  return query select
    '17 com direito ao número, zero é zero',
    (select p.prosrc ilike '%coalesce(sum(v.value), 0)%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'total_da_semana'),
    'NULL e 0 são fatos diferentes: sem isso a tela não consegue escrever "0 de 6" sem acusar quem só não compartilha.';

  return query select
    '18 nenhuma view devolve série diária de terceiro',
    not exists (select 1 from pg_views v
                 where v.schemaname = 'public'
                   and v.definition ilike '%group_visible_stats%'
                   and v.viewname <> 'v_grupo_hoje'
                   and v.definition ilike '%.day%')
    and (select pg_get_viewdef('public.v_grupo_hoje'::regclass) ilike '%hoje_sp%'),
    'O agregado sai, a série não. v_grupo_hoje é a única com day, e ela corta em dois dias.';

  return query select
    '19 o sino não carrega dado',
    (select p.prosrc !~* 'user_id|metric_key|display_name|goal_value|life_events|shared_daily_stats|group_visible_stats'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'sino_toca')
    and (to_regclass('public.group_pulse') is null
         or not exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'group_pulse'
                           and column_name not in ('group_id','at'))),
    'O payload é o id do grupo. Um payload que existe é um payload que vaza.';

  return query select
    '20 nenhuma tabela de dado em supabase_realtime (RT0)',
    not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename in ('groups','group_members','group_visible_stats',
                                     'shared_daily_stats','group_data_consents',
                                     'group_notes','group_recognitions',
                                     'challenges','challenge_participants',
                                     'consent_events','group_invites')),
    'Em postgres_changes o DELETE não passa por RLS e a PK de group_visible_stats É o fato. Publicar essas tabelas é o calendário de bolinhas entrando pela porta do socket.';

  return query select
    '21 o canal do sino autoriza alguém',
    (exists (select 1 from pg_policies
              where schemaname = 'realtime' and tablename = 'messages'
                and policyname = 'sino_do_meu_grupo')
     or exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename = 'group_pulse')),
    'Falso aqui não é vazamento: é o tempo real simplesmente não funcionando. Ou a política em realtime.messages, ou a tabela group_pulse publicada.';

  return query select
    '22 reciprocidade também na folha de consentimento',
    (select coalesce(bool_and(qual ilike '%consentiu%' and qual ilike '%auth.uid()%'), false)
       from pg_policies
      where schemaname = 'public' and tablename = 'group_data_consents' and cmd = 'SELECT'),
    'Guardar o número e entregar a meta e a data é guardar o cofre e deixar a planta na mesa.';

  return query select
    '23 a barra do grupo escala a meta para o ciclo',
    (select p.prosrc ilike '%goal_period%' and p.prosrc ilike '%ceil(dias / 7.0)%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'barra_do_grupo'),
    'Meta semanal contra feito de ciclo inteiro mostrava a barra 4x cheia num desafio de 4 semanas.';

  return query select
    '24 search_path fixo nas funções definer novas',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.prosecdef
                   and p.proname in ('total_da_semana','sino_toca','tocar_sino','tocar_sino_lote',
                                     'social_autoteste_servico','social_autoteste_semana')
                   and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'),
    'Mesma regra do teste 09, para as funções que a refatoração do Social criou.';

  return query select
    '25 as views oferecem o critério de ordem e o rótulo curto',
    (select count(*) = 4 from information_schema.columns
      where table_schema = 'public' and table_name in ('v_grupo_hoje','v_grupo_semana')
        and column_name in ('ordem','label_curto'))
    and (select bool_and(char_length(btrim(label_curto)) between 1 and 18)
           from public.shareable_metrics),
    'Sem ordem publicada o front ordena pelo rótulo, e o rótulo longo começa em "Dias com..." — a fisiologia sai embaralhada.';

  return query select
    '26 as duas funções de total concordam sobre o que é um zero',
    (select bool_and(p.prosrc ilike '%coalesce(sum(v.value), 0)%')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('total_da_semana','total_do_ciclo'))
    and (select p.prosrc not ilike '%total_do_ciclo(p_challenge, p.user_id) is not null%'
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'podio'),
    'Enquanto uma delas confundir "não pode ver" com "viu e é zero", a mesma pessoa aparece 0 de 6 no cartão e some da folha do desafio. E o pódio não pode ter piso is not null: zero no fim de uma lista ordenada é o ordinal com outro nome.';
end $fn$;

comment on function public.social_autoteste_semana() is
  'As invariantes do X/Y semanal, do sino e da ficha. Numerada a partir de 15 porque 13 e 14 são do bloco de serviço — colisão de número foi o rastro que denunciou a suíte encolhendo.';


-- ═══════════════════════════════════════════════════════════════════════
-- 7. O WRAPPER PARA DE SER UMA LISTA ESCRITA À MÃO
-- ═══════════════════════════════════════════════════════════════════════
-- Descobre os blocos por catálogo. Bloco novo entra sozinho; bloco existente
-- não sai sem alguém apagar a função. Não há mais motivo para editar esta
-- função — e é por não haver motivo que ela para de ser editada errado.

create or replace function public.social_autoteste()
returns table (teste text, passou boolean, detalhe text)
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'social\_autoteste\_%'
       and p.pronargs = 0
     order by p.proname
  loop
    return query execute format('select * from %s', f);
  end loop;
  -- a vigia da vigilância, fora do laço de propósito: o prefixo dela é outro
  -- justamente para que ela não chame a si mesma
  return query select * from public.autoteste_integridade();
end $fn$;

comment on function public.social_autoteste() is
  'As invariantes estruturais da camada Social. Descobre os blocos social_autoteste_% por catálogo em vez de listá-los: foi uma lista escrita à mão que perdeu dois testes num create or replace, em 18/09/2026. Rodar depois de todo deploy que toque o Social.';

-- ─── A VIGIA ───────────────────────────────────────────────────────────
-- Sem o prefixo `social_autoteste_`, de propósito: se ela entrasse no laço do
-- wrapper, e o wrapper é quem ela confere, a recursão seria infinita.
create or replace function public.autoteste_integridade()
returns table (teste text, passou boolean, detalhe text)
language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare n_total int; n_colisoes int; f text;
begin
  -- a coluna NAO se chama `teste`: `teste` e' o parametro OUT desta funcao, e
  -- plpgsql resolve a favor da variavel — o nome colidido custou uma rodada
  create temp table if not exists _integridade (rotulo text) on commit drop;
  delete from _integridade;
  for f in
    select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'social\_autoteste\_%' and p.pronargs = 0
  loop
    execute format('insert into _integridade (rotulo) select t.teste from %s t', f);
  end loop;

  select count(*) into n_total from _integridade;
  select count(*) into n_colisoes from (
    select split_part(i.rotulo, ' ', 1) as num from _integridade i
     group by 1 having count(*) > 1
  ) x;

  -- A faixa 90 é reservada à meta-vigilância, e isso não é estética: teste de
  -- domínio cresce 26, 27, 28... e, numerado em sequência, um dia esbarraria
  -- nestes três. Colisão de número é literalmente o bug que esta migration
  -- existe para consertar — deixá-la possível aqui seria piada de mau gosto.
  --
  -- 26 é catraca, não adivinhação: sobe quando a suíte cresce, nunca desce.
  -- Conta só os BLOCOS (base 12 + serviço 2 + semana 12); os três testes desta
  -- função não entram, porque ela não está no laço. Se este número precisar
  -- baixar, alguém está apagando teste.
  return query select
    '90 a suíte não encolheu',
    n_total >= 26,
    'Havia ' || n_total || ' testes nos blocos; o piso é 26. Um create or replace no wrapper já apagou dois testes sem erro nenhum, em 18/09/2026.';

  return query select
    '91 nenhum bloco numera igual a outro',
    n_colisoes = 0,
    'Número repetido foi o rastro que denunciou a suíte encolhendo: o bloco novo começou em 13 sobre o 13 que acabara de sumir.';

  return query select
    '92 o wrapper descobre os blocos, não os lista',
    -- strpos e não ilike: em ilike a barra invertida É o escape, e o padrão
    -- procuraria 'social_autoteste_' onde o fonte tem 'social\_autoteste\_'
    (select strpos(p.prosrc, 'pg_proc') > 0
        and strpos(p.prosrc, 'social\_autoteste\_') > 0
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'social_autoteste'),
    'Lista escrita à mão perde item em silêncio. Catálogo não.';
end $fn$;

comment on function public.autoteste_integridade() is
  'Confere a própria suíte: que ela não encolheu, que dois blocos não numeram igual, e que o wrapper descobre os blocos em vez de listá-los. Roda a suíte uma segunda vez para se conferir — é caro de propósito, porque isto roda depois de deploy e não em requisição.';

revoke execute on function public.social_autoteste()          from public, anon, authenticated, service_role;
revoke execute on function public.social_autoteste_servico()  from public, anon, authenticated, service_role;
revoke execute on function public.social_autoteste_semana()   from public, anon, authenticated, service_role;
revoke execute on function public.autoteste_integridade()     from public, anon, authenticated, service_role;
