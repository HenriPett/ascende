-- ═══════════════════════════════════════════════════════════════
-- ASCENDE — Setup completo do banco de dados
-- Cole este arquivo INTEIRO no SQL Editor do Supabase e clique em RUN.
-- Pode rodar mais de uma vez sem problema (idempotente).
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. PERFIS ──────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  pillars text[] not null default '{}',          -- pilares ativos: prosperidade | vitalidade | alimentacao | mente
  spirituality_label text,                        -- como a pessoa chama sua prática (oração, meditação...)
  monthly_income numeric,                         -- renda mensal aproximada (opcional)
  monthly_budget numeric,                         -- quanto quer gastar por mês (opcional)
  goal text,                                      -- objetivo principal em texto livre
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Hidratação: meta diária (ml) e garrafas/copos personalizados para registro rápido.
-- ALTERs idempotentes — seguros para rodar em bancos já existentes.
alter table public.profiles add column if not exists water_goal_ml int not null default 2000;
alter table public.profiles add column if not exists water_bottles jsonb not null default
  '[{"label":"Copo","ml":250},{"label":"Garrafa","ml":500},{"label":"Garrafão","ml":1000}]'::jsonb;
alter table public.profiles add column if not exists journal_color text not null default 'violeta';
alter table public.profiles add column if not exists has_religion boolean not null default true;
alter table public.profiles add column if not exists weight_goal_kg numeric;
alter table public.profiles add column if not exists health_conditions jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists medications jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists birth_year int;
alter table public.profiles add column if not exists sex text;                 -- feminino | masculino | null (prefere não dizer)
alter table public.profiles add column if not exists height_cm numeric;
alter table public.profiles add column if not exists activity_level text;      -- sedentario | leve | moderado | intenso
alter table public.profiles add column if not exists dietary_restrictions jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists calorie_goal_kcal int;    -- meta calórica diária
alter table public.profiles add column if not exists protein_goal_g int;       -- meta diária de proteína
alter table public.profiles add column if not exists daily_spend_limit numeric;  -- teto de gasto diário (R$)
alter table public.profiles add column if not exists weekly_workouts_goal int;   -- treinos por semana
alter table public.profiles add column if not exists sleep_goal_h numeric;       -- horas de sono por noite

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = user_id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = user_id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Cria o perfil automaticamente quando um usuário se cadastra
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── 2. LINHA DO TEMPO UNIFICADA (life_events) ──────────────────
-- Todos os pilares escrevem aqui. É o que permite a IA enxergar tudo.
create table if not exists public.life_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pillar text not null,        -- prosperidade | vitalidade | alimentacao | mente
  kind text not null,          -- transaction | habit_done | sleep | nap | workout | meal | water | journal | weight | body | mood | gratitude | practice | note
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}',
  source text not null default 'form',  -- chat_capture | form | system
  created_at timestamptz not null default now()
);
create index if not exists life_events_user_time on public.life_events (user_id, occurred_at desc);
alter table public.life_events enable row level security;

drop policy if exists "events_select_own" on public.life_events;
create policy "events_select_own" on public.life_events for select using (auth.uid() = user_id);
drop policy if exists "events_insert_own" on public.life_events;
create policy "events_insert_own" on public.life_events for insert with check (auth.uid() = user_id);
drop policy if exists "events_update_own" on public.life_events;
create policy "events_update_own" on public.life_events for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "events_delete_own" on public.life_events;
create policy "events_delete_own" on public.life_events for delete using (auth.uid() = user_id);

-- ─── 3. XP E NÍVEL ──────────────────────────────────────────────
create table if not exists public.xp_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  points int not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists xp_log_user on public.xp_log (user_id);
alter table public.xp_log enable row level security;

drop policy if exists "xp_select_own" on public.xp_log;
create policy "xp_select_own" on public.xp_log for select using (auth.uid() = user_id);
drop policy if exists "xp_insert_own" on public.xp_log;
-- (sem policy de insert de propósito: XP só entra pelo gatilho award_xp_for_event,
--  que roda como security definer. Cliente inserir XP direto seria forjar pontos.)

-- XP automático: registrar a vida dá pontos (consistência, não resultado)
create or replace function public.award_xp_for_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare pts int;
begin
  pts := case new.kind
    when 'habit_done' then 10
    when 'workout' then 8
    when 'practice' then 8
    when 'mood' then 5
    when 'sleep' then 5
    when 'nap' then 2
    when 'meal' then 4
    when 'water' then 2
    when 'journal' then 6
    when 'weight' then 3
    when 'body' then 4
    when 'gratitude' then 5
    when 'transaction' then 2
    else 3 end;
  insert into public.xp_log (user_id, points, reason)
  values (new.user_id, pts, case new.kind
    when 'habit_done' then 'Hábito concluído'
    when 'workout' then 'Treino registrado'
    when 'practice' then 'Prática registrada'
    when 'mood' then 'Humor registrado'
    when 'sleep' then 'Sono registrado'
    when 'nap' then 'Soneca registrada'
    when 'meal' then 'Refeição registrada'
    when 'water' then 'Hidratação registrada'
    when 'journal' then 'Entrada no diário'
    when 'weight' then 'Peso registrado'
    when 'body' then 'Composição corporal registrada'
    when 'gratitude' then 'Gratidão registrada'
    when 'transaction' then 'Lançamento financeiro'
    else 'Registro: ' || new.kind end);
  return new;
end; $$;

drop trigger if exists trg_award_xp on public.life_events;
create trigger trg_award_xp after insert on public.life_events
  for each row execute function public.award_xp_for_event();

-- ─── 4. PILAR PROSPERIDADE (finanças) ───────────────────────────
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income','expense')),
  amount numeric not null check (amount > 0),
  category text not null default 'Outros',
  description text,
  occurred_at date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_date on public.transactions (user_id, occurred_at desc);
alter table public.transactions enable row level security;

drop policy if exists "tx_select_own" on public.transactions;
create policy "tx_select_own" on public.transactions for select using (auth.uid() = user_id);
drop policy if exists "tx_insert_own" on public.transactions;
create policy "tx_insert_own" on public.transactions for insert with check (auth.uid() = user_id);
drop policy if exists "tx_update_own" on public.transactions;
create policy "tx_update_own" on public.transactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "tx_delete_own" on public.transactions;
create policy "tx_delete_own" on public.transactions for delete using (auth.uid() = user_id);

-- Toda transação vira um evento na linha do tempo
create or replace function public.tx_to_life_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.life_events (user_id, pillar, kind, occurred_at, payload, source)
  values (new.user_id, 'prosperidade', 'transaction', new.occurred_at::timestamptz,
    jsonb_build_object('amount', new.amount, 'tx_kind', new.kind, 'category', new.category, 'description', new.description),
    'system');
  return new;
end; $$;

drop trigger if exists trg_tx_event on public.transactions;
create trigger trg_tx_event after insert on public.transactions
  for each row execute function public.tx_to_life_event();

-- ─── 5. HÁBITOS (motor universal, usado por todos os pilares) ───
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  pillar text not null default 'vitalidade',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.habits enable row level security;

drop policy if exists "habits_all_own" on public.habits;
create policy "habits_all_own" on public.habits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  log_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (habit_id, log_date)
);
alter table public.habit_logs enable row level security;

drop policy if exists "hlogs_all_own" on public.habit_logs;
create policy "hlogs_all_own" on public.habit_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Hábito concluído vira evento na linha do tempo
create or replace function public.habit_log_to_life_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare h record;
begin
  select name, pillar into h from public.habits where id = new.habit_id;
  insert into public.life_events (user_id, pillar, kind, occurred_at, payload, source)
  values (new.user_id, coalesce(h.pillar, 'vitalidade'), 'habit_done', new.log_date::timestamptz,
    jsonb_build_object('habit_id', new.habit_id, 'habit_name', h.name), 'system');
  return new;
end; $$;

drop trigger if exists trg_hlog_event on public.habit_logs;
create trigger trg_hlog_event after insert on public.habit_logs
  for each row execute function public.habit_log_to_life_event();

-- ─── 6. CONSELHEIRO (chat) ──────────────────────────────────────
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_user_time on public.chat_messages (user_id, created_at);
alter table public.chat_messages enable row level security;

drop policy if exists "chat_select_own" on public.chat_messages;
create policy "chat_select_own" on public.chat_messages for select using (auth.uid() = user_id);
drop policy if exists "chat_insert_own" on public.chat_messages;
create policy "chat_insert_own" on public.chat_messages for insert with check (auth.uid() = user_id);
drop policy if exists "chat_delete_own" on public.chat_messages;
create policy "chat_delete_own" on public.chat_messages for delete using (auth.uid() = user_id);

-- ─── 7. BRIEFING DIÁRIO (cache: 1 por dia por usuário) ──────────
create table if not exists public.briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brief_date date not null default current_date,
  content text not null,
  created_at timestamptz not null default now(),
  unique (user_id, brief_date)
);
alter table public.briefings enable row level security;

drop policy if exists "brief_select_own" on public.briefings;
create policy "brief_select_own" on public.briefings for select using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════
-- Pronto! Agora siga o README para publicar as funções de IA.
-- ═══════════════════════════════════════════════════════════════

-- ─── PLANOS (entregas definitivas do Conselheiro) ────────────────
-- Planos alimentares, de treino, financeiros etc. saem do chat e
-- ficam guardados aqui, com o aval do usuário.
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  kind text not null default 'outro',      -- alimentar | treino | financeiro | rotina | outro
  pillar text,                             -- pilar principal, se houver
  content text not null,                   -- markdown completo do plano
  status text not null default 'ativo',    -- ativo | arquivado
  created_at timestamptz not null default now()
);
create index if not exists plans_user on public.plans (user_id, status, created_at desc);
alter table public.plans enable row level security;
drop policy if exists "plans_all_own" on public.plans;
create policy "plans_all_own" on public.plans for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── CONTROLE DE ABUSO DAS FUNÇÕES DE IA ─────────────────────────
-- Cada chamada a uma função de IA registra uma linha; a própria função
-- conta a janela recente e recusa excessos (429). RLS ligado SEM policies:
-- o cliente não lê nem escreve aqui — só o service role das funções.
create table if not exists public.fn_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fn text not null,
  called_at timestamptz not null default now()
);
create index if not exists fn_calls_user_fn_time on public.fn_calls (user_id, fn, called_at desc);
alter table public.fn_calls enable row level security;


-- ─── 8. MEMÓRIA DO CONSELHEIRO ──────────────────────────────────
-- A cada mensagem, a IA extrai e guarda nuances duráveis sobre a pessoa
-- (preferências, rotina, contexto de vida). Só as funções de IA escrevem
-- aqui (service role); o usuário vê e apaga as suas em Ajustes.
create table if not exists public.ai_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 3 and 200),
  category text not null default 'outro'
    check (category in ('preferencia','rotina','contexto','motivacao','personalidade','outro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_memories_user_time on public.ai_memories (user_id, created_at desc);
alter table public.ai_memories enable row level security;
 
-- O usuário LÊ e APAGA as próprias memórias; a escrita é exclusiva do
-- service role (funções de IA) — por isso não há policy de insert/update.
drop policy if exists "memories_select_own" on public.ai_memories;
create policy "memories_select_own" on public.ai_memories for select using (auth.uid() = user_id);
drop policy if exists "memories_delete_own" on public.ai_memories;
create policy "memories_delete_own" on public.ai_memories for delete using (auth.uid() = user_id);
 
-- ═══════════════════════════════════════════════════════════════
-- FASE DE ESTABILIZAÇÃO E MONETIZAÇÃO (idempotente)
-- Seções 9+: batalhas, integridade da linha do tempo, XP corrigível,
-- telemetria de IA, assinaturas, flags e permissões.
-- ═══════════════════════════════════════════════════════════════

-- ─── 9. BATALHAS (correção crítica: tabelas usadas pelo app e ausentes) ───
create table if not exists public.battles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  discreet_name text,
  triggers text[] not null default '{}',
  emergency_plan text[] not null default '{}',
  visible_to_ai boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists battles_user_active on public.battles (user_id, active);
alter table public.battles enable row level security;
drop policy if exists "battles_all_own" on public.battles;
create policy "battles_all_own" on public.battles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.battle_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  battle_id uuid not null references public.battles(id) on delete cascade,
  checkin_date date not null default current_date,
  status text not null check (status in ('clean','resisted','relapsed')),
  trigger_label text,
  note text,
  created_at timestamptz not null default now(),
  unique (battle_id, checkin_date)
);
create index if not exists battle_checkins_user_date on public.battle_checkins (user_id, checkin_date desc);
alter table public.battle_checkins enable row level security;
drop policy if exists "bcheckins_all_own" on public.battle_checkins;
create policy "bcheckins_all_own" on public.battle_checkins for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── 10. INTEGRIDADE DA LINHA DO TEMPO ──────────────────────────
-- Eventos derivados passam a apontar para o registro de origem.
alter table public.life_events add column if not exists source_table text;
alter table public.life_events add column if not exists source_id uuid;
create unique index if not exists life_events_source_unique
  on public.life_events (source_table, source_id) where source_id is not null;

-- XP vinculado ao evento que o gerou: apagar o evento corrige o XP.
alter table public.xp_log add column if not exists event_id uuid references public.life_events(id) on delete cascade;
create unique index if not exists xp_log_event_unique on public.xp_log (event_id) where event_id is not null;

-- Recria o gatilho de XP: grava event_id e nunca duplica por reprocessamento.
create or replace function public.award_xp_for_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare pts int;
begin
  pts := case new.kind
    when 'habit_done' then 10 when 'workout' then 8 when 'practice' then 8
    when 'mood' then 5 when 'sleep' then 5 when 'nap' then 2 when 'meal' then 4
    when 'water' then 2 when 'journal' then 6 when 'weight' then 3 when 'body' then 4
    when 'gratitude' then 5 when 'transaction' then 2 else 3 end;
  insert into public.xp_log (user_id, points, reason, event_id)
  values (new.user_id, pts, case new.kind
    when 'habit_done' then 'Hábito concluído' when 'workout' then 'Treino registrado'
    when 'practice' then 'Prática registrada' when 'mood' then 'Humor registrado'
    when 'sleep' then 'Sono registrado' when 'nap' then 'Soneca registrada'
    when 'meal' then 'Refeição registrada' when 'water' then 'Hidratação registrada'
    when 'journal' then 'Entrada no diário' when 'weight' then 'Peso registrado'
    when 'body' then 'Composição corporal registrada' when 'gratitude' then 'Gratidão registrada'
    when 'transaction' then 'Lançamento financeiro' else 'Registro: ' || new.kind end,
    new.id)
  on conflict (event_id) where event_id is not null do nothing;
  return new;
end; $$;

-- Transações: criar, editar e excluir mantêm o evento derivado em sincronia.
create or replace function public.tx_to_life_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.life_events (user_id, pillar, kind, occurred_at, payload, source, source_table, source_id)
  values (new.user_id, 'prosperidade', 'transaction', new.occurred_at::timestamptz,
    jsonb_build_object('amount', new.amount, 'tx_kind', new.kind, 'category', new.category, 'description', new.description),
    'system', 'transactions', new.id)
  on conflict (source_table, source_id) where source_id is not null do nothing;
  return new;
end; $$;

create or replace function public.tx_sync_life_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.life_events
  set occurred_at = new.occurred_at::timestamptz,
      payload = jsonb_build_object('amount', new.amount, 'tx_kind', new.kind, 'category', new.category, 'description', new.description)
  where source_table = 'transactions' and source_id = new.id;
  return new;
end; $$;
drop trigger if exists trg_tx_event_upd on public.transactions;
create trigger trg_tx_event_upd after update on public.transactions
  for each row execute function public.tx_sync_life_event();

create or replace function public.tx_delete_life_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.life_events where source_table = 'transactions' and source_id = old.id;
  return old;
end; $$;
drop trigger if exists trg_tx_event_del on public.transactions;
create trigger trg_tx_event_del after delete on public.transactions
  for each row execute function public.tx_delete_life_event();

-- Hábitos: mesmo princípio.
create or replace function public.habit_log_to_life_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare h record;
begin
  select name, pillar into h from public.habits where id = new.habit_id;
  insert into public.life_events (user_id, pillar, kind, occurred_at, payload, source, source_table, source_id)
  values (new.user_id, coalesce(h.pillar, 'vitalidade'), 'habit_done', new.log_date::timestamptz,
    jsonb_build_object('habit_id', new.habit_id, 'habit_name', h.name), 'system', 'habit_logs', new.id)
  on conflict (source_table, source_id) where source_id is not null do nothing;
  return new;
end; $$;

create or replace function public.habit_log_delete_life_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.life_events where source_table = 'habit_logs' and source_id = old.id;
  return old;
end; $$;
drop trigger if exists trg_hlog_event_del on public.habit_logs;
create trigger trg_hlog_event_del after delete on public.habit_logs
  for each row execute function public.habit_log_delete_life_event();

-- Reparo dos dados antigos: vincula eventos derivados órfãos à origem quando o
-- pareamento é inequívoco e remove eventos derivados cuja origem já foi apagada.
-- Rode UMA vez após aplicar este arquivo: select * from public.repair_timeline();
create or replace function public.repair_timeline()
returns table (linked_tx int, removed_tx int, linked_habits int, removed_habits int)
language plpgsql security definer set search_path = public as $$
begin
  -- Vincula transações (match único por usuário+dia+valor+categoria)
  with candidates as (
    select e.id as event_id, t.id as tx_id,
      count(*) over (partition by e.id) as n_ev, count(*) over (partition by t.id) as n_tx
    from public.life_events e
    join public.transactions t on t.user_id = e.user_id
      and e.kind = 'transaction' and e.source_id is null
      and (e.payload->>'amount')::numeric = t.amount
      and e.payload->>'tx_kind' = t.kind
      and coalesce(e.payload->>'category','') = coalesce(t.category,'')
      and e.occurred_at::date = t.occurred_at
    where not exists (select 1 from public.life_events x where x.source_table='transactions' and x.source_id=t.id)
  )
  update public.life_events e set source_table='transactions', source_id=c.tx_id
  from candidates c where e.id=c.event_id and c.n_ev=1 and c.n_tx=1;
  get diagnostics linked_tx = row_count;

  delete from public.life_events e
  where e.kind='transaction' and e.source_id is null and e.source in ('system','form')
    and not exists (
      select 1 from public.transactions t
      where t.user_id=e.user_id and t.amount=(e.payload->>'amount')::numeric
        and t.kind=e.payload->>'tx_kind' and t.occurred_at=e.occurred_at::date
    );
  get diagnostics removed_tx = row_count;

  with hc as (
    select e.id as event_id, hl.id as log_id,
      count(*) over (partition by e.id) as n_ev, count(*) over (partition by hl.id) as n_hl
    from public.life_events e
    join public.habit_logs hl on hl.user_id=e.user_id
      and e.kind='habit_done' and e.source_id is null
      and (e.payload->>'habit_id')::uuid = hl.habit_id
      and e.occurred_at::date = hl.log_date
    where not exists (select 1 from public.life_events x where x.source_table='habit_logs' and x.source_id=hl.id)
  )
  update public.life_events e set source_table='habit_logs', source_id=hc.log_id
  from hc where e.id=hc.event_id and hc.n_ev=1 and hc.n_hl=1;
  get diagnostics linked_habits = row_count;

  delete from public.life_events e
  where e.kind='habit_done' and e.source_id is null and e.source='system'
    and (e.payload ? 'habit_id')
    and not exists (
      select 1 from public.habit_logs hl
      where hl.user_id=e.user_id and hl.habit_id=(e.payload->>'habit_id')::uuid and hl.log_date=e.occurred_at::date
    );
  get diagnostics removed_habits = row_count;
  return next;
end; $$;
revoke all on function public.repair_timeline() from anon, authenticated;

-- Total de XP agregado (evita carregar todo o xp_log em cada snapshot)
create or replace function public.xp_total(uid uuid)
returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(points), 0)::bigint from public.xp_log where user_id = uid;
$$;

-- ─── 11. TELEMETRIA DE IA (ai_usage) ────────────────────────────
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_creation_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  provider_request_id text,
  success boolean not null default true,
  error_code text,
  duration_ms int,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_time on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_feature_time on public.ai_usage (feature, created_at desc);
alter table public.ai_usage enable row level security;
-- RLS sem policies: só o service role (funções) escreve e lê.

-- Visões de custo (uso administrativo pelo SQL Editor / função admin; sem acesso do cliente)
create or replace view public.ai_usage_daily as
  select created_at::date as day, feature, model, count(*) as calls,
    sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
    sum(cache_read_tokens) as cache_read_tokens,
    sum(estimated_cost_usd) as cost_usd,
    round(avg(duration_ms)) as avg_ms,
    count(*) filter (where not success) as errors
  from public.ai_usage group by 1,2,3 order by 1 desc;
create or replace view public.ai_usage_by_user as
  select user_id, date_trunc('month', created_at)::date as month,
    count(*) as calls, sum(estimated_cost_usd) as cost_usd,
    sum(input_tokens+output_tokens) as tokens
  from public.ai_usage group by 1,2 order by cost_usd desc;
revoke all on public.ai_usage_daily from anon, authenticated;
revoke all on public.ai_usage_by_user from anon, authenticated;

-- ─── 12. ASSINATURAS ────────────────────────────────────────────
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('stripe','apple','google_play','promotional','founder','admin')),
  provider_customer_id text,
  provider_subscription_id text,
  plan_key text not null default 'ascend_plus',
  status text not null default 'incomplete',
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists subscriptions_provider_sub
  on public.subscriptions (provider, provider_subscription_id) where provider_subscription_id is not null;
create index if not exists subscriptions_user on public.subscriptions (user_id, status);
alter table public.subscriptions enable row level security;
drop policy if exists "subs_select_own" on public.subscriptions;
create policy "subs_select_own" on public.subscriptions for select using (auth.uid() = user_id);
-- escrita exclusiva do service role (webhooks/funções)

create table if not exists public.billing_webhook_events (
  id bigint generated always as identity primary key,
  provider text not null default 'stripe',
  provider_event_id text not null,
  event_type text not null,
  processed_at timestamptz not null default now(),
  payload_hash text,
  status text not null default 'processed',
  unique (provider, provider_event_id)
);
alter table public.billing_webhook_events enable row level security;
-- RLS sem policies: só service role.

-- A permissão final da conta (independente do provedor)
create or replace function public.has_ascend_plus(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = uid and s.plan_key = 'ascend_plus'
      and (
        (s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now()))
        or (s.provider in ('promotional','founder','admin') and s.status = 'active')
      )
  );
$$;

-- ─── 13. CONFIGURAÇÃO DA APLICAÇÃO (flags e limites) ────────────
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "settings_read_all" on public.app_settings;
create policy "settings_read_all" on public.app_settings for select using (auth.role() = 'authenticated');
-- escrita exclusiva do service role / SQL Editor

insert into public.app_settings (key, value) values
  ('flags', '{
    "subscriptions_enabled": false,
    "stripe_checkout_enabled": false,
    "premium_limits_enabled": false,
    "new_ai_telemetry_enabled": true,
    "model_routing_enabled": true,
    "new_score_enabled": false,
    "global_timeline_enabled": false,
    "apple_billing_enabled": false
  }'::jsonb),
  ('plan_limits', '{
    "free": {
      "capture_daily": 3, "chat_weekly": 5, "chat_daily": null, "chat_monthly": null,
      "meal_photos_monthly": 2, "body_photos_monthly": 1, "document_analyses_monthly": 0,
      "briefing_daily": false, "weekly_review": true, "monthly_report": false,
      "max_active_plans": 1, "memory_cap": 20, "advanced_analytics": false
    },
    "plus": {
      "capture_daily": 30, "chat_daily": 15, "chat_monthly": 300, "chat_weekly": null,
      "meal_photos_monthly": 30, "body_photos_monthly": 10, "document_analyses_monthly": 10,
      "briefing_daily": true, "weekly_review": true, "monthly_report": true,
      "max_active_plans": 5, "memory_cap": 150, "advanced_analytics": true
    }
  }'::jsonb),
  ('pricing', '{
    "monthly_label": "R$ 19,90/mês",
    "annual_label": "R$ 199/ano (2 meses grátis)"
  }'::jsonb),
  ('billing_entity', '{
    "name": "", "document": "", "note": "Dados da entidade de cobrança ficam AQUI (configuração), nunca no código."
  }'::jsonb)
on conflict (key) do nothing;

-- ─── 14. LIMITE DE PLANOS ATIVOS (aplicado no servidor/banco) ───
create or replace function public.enforce_active_plans_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  limits jsonb; cap int; n int; enabled boolean;
begin
  select coalesce((value->>'premium_limits_enabled')::boolean, false) into enabled
    from public.app_settings where key = 'flags';
  if not coalesce(enabled, false) then return new; end if;
  select value into limits from public.app_settings where key = 'plan_limits';
  if public.has_ascend_plus(new.user_id)
    then cap := coalesce((limits->'plus'->>'max_active_plans')::int, 5);
    else cap := coalesce((limits->'free'->>'max_active_plans')::int, 1);
  end if;
  select count(*) into n from public.plans where user_id = new.user_id and status = 'ativo';
  if new.status = 'ativo' and n >= cap then
    raise exception 'PLAN_LIMIT_REACHED: máximo de % plano(s) ativo(s) no seu plano. Arquive um plano ou assine o Ascende+.', cap
      using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists trg_plans_cap on public.plans;
create trigger trg_plans_cap before insert on public.plans
  for each row execute function public.enforce_active_plans_cap();

-- ─── 15. PRIVACIDADE: escopos que o Conselheiro pode analisar ───
alter table public.profiles add column if not exists ai_scopes jsonb not null default
  '{"prosperidade":true,"vitalidade":true,"alimentacao":true,"mente":true,"diario":true}'::jsonb;