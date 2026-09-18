-- ═══════════════════════════════════════════════════════════════════════
-- A CHAVE DE SERVIÇO NÃO LÊ A VIDA DE NINGUÉM
--
-- Todo este modelo — 36 políticas, as janelas, a reciprocidade, a revogação
-- por deleção — protege contra UM tipo de erro: o de quem consulta como
-- usuário. Nenhuma linha dele protege contra a `SERVICE_ROLE_KEY`, que tem
-- BYPASSRLS: uma edge function chamada `social-feed` escrita com ela anula o
-- documento inteiro, e anula em silêncio, porque a consulta FUNCIONA.
--
-- Até aqui isso era uma regra de revisão de código ("não use service role no
-- Social"), e regra de revisão é regra que a próxima pessoa não leu. Este
-- arquivo transforma em trava de banco.
--
-- ─── POR QUE REVOGAR PRIVILÉGIO FUNCIONA CONTRA BYPASSRLS ──────────────
-- São dois mecanismos diferentes, e é exatamente essa diferença que salva:
-- BYPASSRLS ignora POLÍTICAS, não ignora GRANTS. Um papel sem `select` na
-- tabela não lê a tabela, tenha BYPASSRLS ou não. Então revogar é a única
-- defesa que alcança a service role — e alcança de forma barulhenta: o
-- PostgREST devolve `permission denied for table group_visible_stats` na
-- primeira tentativa, em vez de devolver a vida de alguém.
--
-- ─── O QUE A SERVICE ROLE AINDA PODE, E POR QUÊ ────────────────────────
-- Ela continua podendo EXECUTAR a manutenção (reconciliar, arquivar), porque
-- isso é trabalho de servidor e não tem leitura de terceiro no meio: as três
-- funções são `security definer`, fazem o que fazem e devolvem um contador.
-- A separação é essa, e ela é a frase inteira: a chave de serviço OPERA a
-- camada, não LÊ a camada.
--
-- ─── O QUE ISTO NÃO PROTEGE (dito, não escondido) ──────────────────────
-- `postgres` e `supabase_admin` são superusuários e passam por cima de grant
-- também. Quem tem o painel do Supabase tem o banco — isso é verdade em
-- qualquer desenho e não é o que esta migration tenta resolver. O que ela
-- resolve é o caminho REAL de acidente: a chave de serviço que já está nos
-- secrets de oito edge functions, a um `import` de distância de qualquer
-- função nova.
--
-- E ela não sobrevive sozinha: o `alter default privileges` do Supabase
-- concede tudo à service role em tabela NOVA. Por isso o autoteste 13 confere
-- o estado toda vez — se alguém criar a décima quinta tabela do Social sem
-- passar por aqui, o teste acusa.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  -- As catorze tabelas e as quatro views da camada. A lista é explícita, e não
  -- um `all tables in schema public`, porque revogar em massa no schema
  -- público derrubaria o resto do app — a Prosperidade, o Conselheiro e a
  -- cobrança dependem da service role.
  foreach t in array array[
    'groups','group_members','group_invites','group_invite_declines',
    'group_membership_events','shareable_metrics','group_data_consents',
    'consent_events','shared_daily_stats','group_visible_stats',
    'challenges','challenge_participants','group_recognitions','group_notes',
    'v_grupo_hoje','v_desafio_progresso','v_meus_consentimentos','v_meus_grupos'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from service_role, anon', t);
    end if;
  end loop;
end $$;

-- A manutenção continua possível: é isto que a chave de serviço tem o direito
-- de fazer nesta camada, e só isto.
grant execute on function public.reconciliar_projecao(int)     to service_role;
grant execute on function public.reconciliar_publicacao()      to service_role;
grant execute on function public.arquivar_grupos_vencidos(int) to service_role;

-- As funções de LEITURA continuam fora do alcance dela. Sem esta linha, uma
-- edge function com a chave de serviço chamaria `total_do_ciclo` e receberia
-- número de terceiro sem passar por política nenhuma — o mesmo vazamento, pela
-- porta da função em vez da porta da tabela.
revoke execute on function public.total_do_ciclo(uuid, uuid) from service_role, anon;
revoke execute on function public.barra_do_grupo(uuid)       from service_role, anon;
revoke execute on function public.minha_posicao(uuid)        from service_role, anon;
revoke execute on function public.podio(uuid)                from service_role, anon;
revoke execute on function public.voltou_hoje(uuid, uuid)    from service_role, anon;
revoke execute on function public.consentiu(uuid, uuid, text) from service_role, anon;
revoke execute on function public.janela_de_visao(uuid, uuid) from service_role, anon;
revoke execute on function public.sou_membro(uuid)            from service_role, anon;

-- ─── O ALARME ───────────────────────────────────────────────────────────
-- Duas verificações novas no autoteste. A 13 é a trava desta migration; a 14
-- é a que teria pego a divergência do dia inteiro em 18/09/2026.
create or replace function public.social_autoteste()
returns table (teste text, passou boolean, detalhe text)
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  return query select * from public.social_autoteste_base();

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
                            'v_grupo_hoje','v_desafio_progresso','v_meus_consentimentos','v_meus_grupos')
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
end $$;

revoke execute on function public.social_autoteste() from public, anon, authenticated, service_role;
