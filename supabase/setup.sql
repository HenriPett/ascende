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
 