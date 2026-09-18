-- ═══════════════════════════════════════════════════════════════════════
-- A PROJEÇÃO PODE MENTIR — E PRECISA SER CONFERIDA
--
-- A escolha de publicar COPIANDO (migration ...150000) compra a revogação por
-- deleção e paga com uma segunda fonte da verdade. Segunda fonte da verdade
-- diverge: um gatilho que falhou, uma migration que mudou a regra de cálculo,
-- uma linha de life_events inserida por caminho que não dispara gatilho. Um
-- agregado que ninguém confere vira um agregado em que ninguém pode confiar —
-- e aqui a divergência não é um número torto num gráfico, é a vida de alguém
-- visível para quem não deveria, ou invisível para quem combinou mostrar.
--
-- Este arquivo entrega as três rotinas de manutenção e o autoteste.
--
-- ─── NADA AQUI RODA SOZINHO ────────────────────────────────────────────
-- Não há pg_cron neste projeto. As três funções são feitas para serem
-- chamadas: por um agendador de borda (como o whatsapp-notify já é, com
-- x-cron-secret) ou à mão, em janela de manutenção. Deixá-las explícitas, em
-- vez de escondidas num job, é proposital: quem opera precisa saber que elas
-- existem e o que cada uma apaga.
--
-- Idempotente, e seguro rodar quantas vezes quiser.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. RECONCILIAR A PROJEÇÃO ──────────────────────────────────────────
-- Recalcula os últimos N dias de quem teve movimento. É a rede embaixo do
-- gatilho: se ele falhou em algum dia, este passo conserta sem que ninguém
-- precise descobrir qual dia foi.
create or replace function public.reconciliar_projecao(p_dias int default 7)
returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select distinct user_id, (occurred_at at time zone 'America/Sao_Paulo')::date as day
      from public.life_events
     where occurred_at >= now() - make_interval(days => p_dias)
  loop
    perform public.projetar_dia(r.user_id, r.day);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ─── 2. RECONCILIAR A PUBLICAÇÃO ────────────────────────────────────────
-- Apaga toda linha publicada que hoje não teria direito de existir. As quatro
-- condições são as mesmas quatro de `publicar_dia`, escritas ao contrário —
-- e é de propósito que estejam nos dois lugares: o gatilho garante o presente,
-- esta função garante o passado.
create or replace function public.reconciliar_publicacao()
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with orfas as (
    delete from public.group_visible_stats v
     where not exists (
       select 1
         from public.group_data_consents c
         join public.group_members m on m.group_id = c.group_id and m.user_id = c.user_id
         join public.groups g        on g.id = c.group_id
        where c.group_id   = v.group_id
          and c.user_id    = v.user_id
          and c.metric_key = v.metric_key
          and v.day >= c.granted_at::date
          and v.day >= m.joined_at::date
          and v.day <= g.ends_on
          and g.archived_at is null
     )
     returning 1
  ) select count(*) into n from orfas;
  return n;
end $$;

-- ─── 3. ARQUIVAR O QUE ACABOU ───────────────────────────────────────────
-- O combinado tem fim (condição C1). Trinta dias depois do fim, o grupo é
-- arquivado e o que foi publicado nele é apagado: o fechamento fica visível
-- por um mês, e depois o mural não existe mais, porque nunca foi um mural.
create or replace function public.arquivar_grupos_vencidos(p_carencia_dias int default 30)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.groups set archived_at = now()
   where archived_at is null and current_date > ends_on + p_carencia_dias;
  get diagnostics n = row_count;

  delete from public.group_visible_stats v
   using public.groups g where g.id = v.group_id and g.archived_at is not null;
  return n;
end $$;

revoke execute on function public.reconciliar_projecao(int)      from public, anon, authenticated;
revoke execute on function public.reconciliar_publicacao()       from public, anon, authenticated;
revoke execute on function public.arquivar_grupos_vencidos(int)  from public, anon, authenticated;

-- ─── 4. O AUTOTESTE ─────────────────────────────────────────────────────
--
-- Doze verificações. Não substituem teste de integração com dois usuários de
-- verdade (esse tem de existir e não cabe numa migration), mas guardam as
-- invariantes ESTRUTURAIS do modelo — as que uma migration futura quebra sem
-- querer, e cuja quebra não produz erro nenhum: só passa a mostrar dado.
--
-- Uso:  select * from public.social_autoteste();
-- Em produção, depois de todo deploy que toque nesta camada.
create or replace function public.social_autoteste_base()
returns table (teste text, passou boolean, detalhe text)
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  -- 1. A fonte continua fechada.
  return query select
    '01 fonte fechada: nenhuma política de grupo em tabela de dono',
    not exists (select 1 from pg_policies
                 where schemaname = 'public'
                   and tablename in ('profiles','life_events','transactions','habit_logs',
                                     'battles','battle_checkins','ai_memories','chat_messages')
                   and (coalesce(qual,'') ilike '%group_%' or coalesce(with_check,'') ilike '%group_%')),
    'life_events guarda dinheiro (tx_to_life_event) e RLS não recorta coluna.';

  -- 2. A projeção não tem onde guardar texto.
  return query select
    '02 projeção sem coluna de texto',
    not exists (select 1 from information_schema.columns
                 where table_schema = 'public'
                   and table_name in ('shared_daily_stats','group_visible_stats')
                   and data_type in ('text','character varying','character','json','jsonb')
                   and column_name <> 'metric_key'),
    'É a defesa estrutural: o diário não vaza porque não há onde ele caber.';

  -- 3. O catálogo não admite o pilar do dinheiro.
  return query select
    '03 catálogo sem pilar financeiro',
    exists (select 1 from pg_constraint
             where conname = 'shareable_metrics_nunca_financeiro' and contype = 'c')
    and not exists (select 1 from public.shareable_metrics where pillar = 'prosperidade'),
    'Decisão de fundador como restrição de domínio, não como política.';

  -- 4. A lista do NUNCA continua fora do catálogo.
  return query select
    '04 lista do nunca fora do catálogo',
    not exists (select 1 from public.shareable_metrics
                 where metric_key ~* 'peso|body|corpo|humor|mood|diario|journal|pratica|practice|fe$|batalha|battle|gasto|spend|orcament|saldo|reserva'),
    'Peso, corpo, humor, diário, fé, batalha e dinheiro: sem chave, não há toggle.';

  -- 5. metric_key é FK para o catálogo nas duas tabelas.
  return query select
    '05 metric_key com FK para o catálogo',
    (select count(*) from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_class r on r.oid = c.confrelid
     where c.contype = 'f' and r.relname = 'shareable_metrics'
       and t.relname in ('shared_daily_stats','group_visible_stats',
                         'group_data_consents','challenges')) = 4,
    'Sem FK, peso_delta_kg entra numa terça-feira sem passar por esta mesa.';

  -- 6. As tabelas que só o gatilho escreve não têm política de escrita.
  return query select
    '06 zero política de escrita onde só o definer escreve',
    not exists (select 1 from pg_policies
                 where schemaname = 'public'
                   and tablename in ('shareable_metrics','shared_daily_stats','group_visible_stats')
                   and cmd <> 'SELECT'),
    'Mesmo padrão de fn_calls: RLS ligada, nenhuma porta.';

  -- 7. A política de leitura amarra o grupo do consentimento e a reciprocidade.
  return query select
    '07 política do grupo: amarração e reciprocidade',
    (select coalesce(bool_and(qual ilike '%consentiu%' and qual ilike '%janela_de_visao%'
                              and qual ilike '%auth.uid()%' and qual ilike '%current_date - 1%'), false)
       from pg_policies
      where schemaname = 'public' and tablename = 'group_visible_stats' and cmd = 'SELECT'),
    'Perder o group_id do consentimento vaza "liguei para a família" no trabalho.';

  -- 8. Funções de janela falham fechado (infinity, nunca null).
  return query select
    '08 janela falha fechado',
    public.janela_de_visao('00000000-0000-0000-0000-000000000000',
                           '00000000-0000-0000-0000-000000000000') = 'infinity'::date
    and public.consentiu('00000000-0000-0000-0000-000000000000',
                         '00000000-0000-0000-0000-000000000000', 'treino_registrado') = 'infinity'::date,
    'greatest() ignora null em Postgres: um null aqui abriria tudo.';

  -- 9. Toda função da camada fixa o search_path.
  return query select
    '09 search_path fixo em toda função definer',
    not exists (select 1 from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosecdef
                  and p.proname in ('sou_membro','sou_admin','grupo_vigente','grupo_legivel',
                                    'janela_de_visao','consentiu','projetar_dia','publicar_dia',
                                    'total_do_ciclo','barra_do_grupo','minha_posicao','podio',
                                    'voltou_hoje','aceitar_convite','criar_grupo','sair_do_grupo',
                                    'remover_membro')
                  and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'),
    'Sequestro de search_path: a mesma regra que SEGURANCA.md já aplica ao resto.';

  -- 10. Nenhuma publicação órfã (dado real, não estrutura).
  return query select
    '10 nenhuma linha publicada sem consentimento vigente',
    not exists (select 1 from public.group_visible_stats v
                 where not exists (select 1 from public.group_data_consents c
                                    where c.group_id = v.group_id and c.user_id = v.user_id
                                      and c.metric_key = v.metric_key)),
    'Se falhar, rode reconciliar_publicacao() e descubra qual gatilho não disparou.';

  -- 11. Nenhuma linha publicada fora da janela.
  return query select
    '11 nenhuma linha publicada fora da janela',
    not exists (
      select 1 from public.group_visible_stats v
       join public.group_data_consents c
         on c.group_id = v.group_id and c.user_id = v.user_id and c.metric_key = v.metric_key
       join public.group_members m on m.group_id = v.group_id and m.user_id = v.user_id
       join public.groups g on g.id = v.group_id
      where v.day < c.granted_at::date or v.day < m.joined_at::date or v.day > g.ends_on),
    'Ligar hoje não mostra ontem; entrar em setembro não mostra julho.';

  -- 12. A projeção não lê kind de fora da allowlist.
  return query select
    '12 projeção sem kind proibido no código',
    (select not (prosrc ~* '''transaction''|''weight''|''body''|''mood''|''journal''|''practice''|''habit_done''')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'projetar_dia'),
    'Allowlist, nunca denylist: kind novo não vira métrica sozinho.';
end $$;

-- Wrapper: a migration ...190000 acrescenta as verificações 13 e 14 chamando
-- esta base. Quem roda é sempre `social_autoteste()`.
create or replace function public.social_autoteste()
returns table (teste text, passou boolean, detalhe text)
language sql stable security definer set search_path = public as $w$
  select * from public.social_autoteste_base()
$w$;

revoke execute on function public.social_autoteste_base() from public, anon, authenticated;
revoke execute on function public.social_autoteste() from public, anon, authenticated;

comment on function public.social_autoteste() is
  'As invariantes estruturais da camada Social. Rodar depois de todo deploy que a toque: select * from public.social_autoteste();';
