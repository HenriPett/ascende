-- ═══════════════════════════════════════════════════════════════
-- ASCENDE — Linha de base do banco de dados
--
-- Cole este arquivo INTEIRO no SQL Editor do Supabase e clique em RUN.
-- Pode rodar mais de uma vez sem problema (idempotente).
--
-- ⚠ ELE NÃO É O BANCO INTEIRO, e dizer que era foi um erro corrigido em
-- auditoria. Ambiente novo precisa de DOIS passos:
--     1. este arquivo;
--     2. TODAS as migrações de supabase/migrations/, em ordem de nome.
--
-- Objetos que existem só nas migrações (de propósito — a definição tem um
-- dono só; ver supabase/migrations/README.md): jsonb_num, daily_metrics e
-- insights (Fase 3); insight_feedback e as sete views metric_* (Fase 6).
-- Não procure por eles aqui, e não os copie para cá.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. PERFIS ──────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  pillars text[] not null default '{}',          -- pilares ativos: prosperidade | vitalidade | mente (o id `alimentacao` foi absorvido por `vitalidade` em 17/09/2026)
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
-- Raio-X de Vitalidade (plano de feedbacks, Sugestões 2 e 4): estimativas
-- declaradas em 60s no dia 1 — premissas honestas, cruzáveis pelo briefing
-- antes de existirem semanas de registro. Registro real substitui, nunca soma.
alter table public.profiles add column if not exists est_workouts_week int;      -- treinos/semana (estimativa)
alter table public.profiles add column if not exists est_sleep_h numeric;        -- sono médio/noite (estimativa)
-- Rotina de sono declarada (estilo iPhone): horário de dormir e de acordar.
-- A duração derivada alimenta sleep_goal_h; o check-in matinal de 1 toque
-- usa esses horários para registrar o sono da noite ("segui minha rotina").
alter table public.profiles add column if not exists sleep_bedtime time;         -- ex.: 23:00
alter table public.profiles add column if not exists sleep_waketime time;        -- ex.: 06:30
-- Modularidade total (nível tracker): o que a pessoa acompanha dentro de cada
-- pilar. Só guarda o que foi DESLIGADO ({"water": false}); ausência = ligado.
-- Desligar esconde (telas, briefing, Conselheiro), nunca apaga histórico.
alter table public.profiles add column if not exists tracking_prefs jsonb not null default '{}'::jsonb;
-- Onboarding Blueprint: gasto mensal aproximado com comida (mercado + fora),
-- declarado na porta — premissa do "plano alimentar que cabe no bolso".
alter table public.profiles add column if not exists est_food_spend numeric;
-- Blueprint da Subida: carimbo de quando o blueprint de boas-vindas foi
-- gerado (cortesia, UMA vez por conta — a unicidade é garantida no servidor
-- via claim_blueprint(), seção 24).
alter table public.profiles add column if not exists blueprint_generated_at timestamptz;

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
  pillar text not null,        -- prosperidade | vitalidade | mente (derivado do kind; ver canonicalPillar)
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
-- Origem do plano: 'conselheiro' (conversa) | 'blueprint' (onboarding).
-- O Blueprint entrega um plano POR ÁREA (alimentar, treino, rotina,
-- financeiro) para que cada um apareça sozinho em "Meus planos"; a origem
-- permite tratá-los como UM grupo caso o limite max_active_plans passe a
-- ser aplicado no servidor.
alter table public.plans add column if not exists origin text not null default 'conselheiro';
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
-- Consolidação (Etapa 1.1): estados explícitos + suporte a reprocessamento.
-- status assume: processing | processed | failed | ignored.
alter table public.billing_webhook_events add column if not exists attempts int not null default 1;
alter table public.billing_webhook_events add column if not exists last_error text;

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
    "monthly_label": "R$ 45,50/mês",
    "annual_label": "R$ 364,00/ano — economia de R$ 182,00"
  }'::jsonb),
  ('billing_entity', '{
    "name": "", "document": "", "note": "Dados da entidade de cobrança ficam AQUI (configuração), nunca no código."
  }'::jsonb)
on conflict (key) do nothing;

-- ─── 14. LIMITE DE PLANOS ATIVOS (aplicado no servidor/banco) ───
-- Consolidação (Etapa 1.2): o gatilho vale para CRIAÇÃO, REATIVAÇÃO e
-- qualquer alteração de status para 'ativo' (arquivar + criar + reativar não
-- ultrapassa mais o limite). A contagem exclui o próprio plano na atualização.
create or replace function public.enforce_active_plans_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  limits jsonb; cap int; n int; enabled boolean; becoming_active boolean;
begin
  select coalesce((value->>'premium_limits_enabled')::boolean, false) into enabled
    from public.app_settings where key = 'flags';
  if not coalesce(enabled, false) then return new; end if;

  becoming_active := new.status = 'ativo'
    and (tg_op = 'INSERT' or old.status is distinct from 'ativo');
  if not becoming_active then return new; end if;

  select value into limits from public.app_settings where key = 'plan_limits';
  if public.has_ascend_plus(new.user_id)
    then cap := coalesce((limits->'plus'->>'max_active_plans')::int, 5);
    else cap := coalesce((limits->'free'->>'max_active_plans')::int, 1);
  end if;

  -- Exclui o próprio plano da contagem durante uma atualização
  select count(*) into n from public.plans
   where user_id = new.user_id and status = 'ativo'
     and (tg_op = 'INSERT' or id <> new.id);

  if n >= cap then
    raise exception 'PLAN_LIMIT_REACHED: máximo de % plano(s) ativo(s) no seu plano. Arquive um plano ou assine o Ascende+.', cap
      using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists trg_plans_cap on public.plans;
create trigger trg_plans_cap before insert or update of status on public.plans
  for each row execute function public.enforce_active_plans_cap();

-- ─── 15. PRIVACIDADE: escopos que o Conselheiro pode analisar ───
-- A chave `alimentacao` continua no DEFAULT de propósito, mesmo depois de o
-- pilar ter sido absorvido por `vitalidade` (17/09/2026): enquanto houver
-- instância antiga da edge function em produção, é ela que a função velha lê,
-- e uma conta NOVA sem a chave seria lida como "autorizado" por ela. Sai na
-- release de contração, junto com a leitura derivada de _shared/lib.ts e com o
-- espelho da tela de Ajustes — os três saem juntos ou nenhum sai.
alter table public.profiles add column if not exists ai_scopes jsonb not null default
  '{"prosperidade":true,"vitalidade":true,"alimentacao":true,"mente":true,"diario":true}'::jsonb;

-- ═══════════════════════════════════════════════════════════════
-- FASE DE CONSOLIDAÇÃO (idempotente) — plano de 10/07/2026
-- Seções 16+: fonte única de preço, limites atômicos de IA, feedback,
-- higiene do chat e reparo da linha do tempo.
-- ═══════════════════════════════════════════════════════════════

-- ─── 16. FONTE ÚNICA DE VERDADE DO PREÇO ────────────────────────
-- Migra bancos existentes que ainda exibem o preço antigo. A página de
-- assinatura lê SEMPRE daqui — e este valor deve corresponder EXATAMENTE
-- aos produtos configurados no Stripe (STRIPE_PRICE_MONTHLY_ID / ANNUAL_ID).
update public.app_settings
   set value = '{"monthly_label": "R$ 45,50/mês", "annual_label": "R$ 364,00/ano — economia de R$ 182,00"}'::jsonb,
       updated_at = now()
 where key = 'pricing'
   and (value->>'monthly_label') like '%19,90%';

-- ─── 16-A. RESERVA DE COTA: VALIDADE, LIQUIDAÇÃO E VARREDURA ────
-- Estes cinco objetos nasceram na migração
-- 20260913140000_reserva_orfa_nao_pode_cobrar_cota.sql, e é LÁ que está o
-- porquê inteiro (inclusive a justificativa dos 15 minutos). Estão repetidos
-- aqui, contra a regra geral do supabase/migrations/README.md ("objeto novo
-- fica só na migração"), por um motivo que a regra não previa: a seção 17
-- logo abaixo — que é objeto DE BASE — passou a DEPENDER deles. Sem esta
-- cópia, um ambiente criado pelo setup.sql (o caminho documentado no README
-- da raiz, e o que um staging ou um reset usa) sobe com toda reserva de cota
-- estourando "function does not exist": TODO recurso com limite morre, e o
-- settleUsage falha em silêncio para sempre — o teto do Conselheiro no
-- WhatsApp deixa de existir de forma permanente naquele ambiente.
-- As duas cópias têm de ficar IDÊNTICAS. Mudou aqui, mude lá (e vice-versa);
-- como a migração roda DEPOIS, é a versão dela que prevalece na prática.
--
-- Em uma frase: uma reserva só sai da conta por código (sucesso → UPDATE da
-- linha; falha → releaseUsage), e código nenhum roda quando a função de borda
-- é MORTA em vez de lançar. Por isso reserva aberta tem prazo de validade.

-- Janela de graça. Espelho em TypeScript: RESERVATION_GRACE_MS,
-- em supabase/functions/_shared/usage.ts (countUsage roda via PostgREST,
-- fora do banco, e precisa da MESMA regra).
create or replace function public.ai_reservation_grace()
returns interval language sql immutable as $$ select interval '15 minutes' $$;

-- As reservas ABERTAS são um punhado de linhas numa tabela que só cresce, e a
-- varredura roda no caminho quente, segurando o advisory lock.
create index if not exists ai_usage_reservas_abertas
  on public.ai_usage (user_id, feature, created_at)
  where model = 'reserva';

-- O QUE CONTA CONTRA O TETO — uma definição só, usada por todas as janelas.
-- A cláusula do `model` é a correção: reserva ABERTA e velha não é uso, é
-- entulho de uma função morta.
create or replace function public.ai_usage_counted(uid uuid, feat text, since timestamptz)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.ai_usage
   where user_id = uid and feature = feat and success and created_at >= since
     and (model <> 'reserva' or created_at >= now() - public.ai_reservation_grace());
$$;
revoke all on function public.ai_usage_counted(uuid, text, timestamptz) from anon, authenticated;

-- AUTO-CURA. Apagar é o que release_ai_usage já faz com uma reserva nunca
-- usada, e pelo mesmo motivo: a linha não carrega informação nenhuma (zero
-- tokens, zero custo, nenhum request id). Não é telemetria perdida, é lixo
-- removido. Quem chama já está sob o advisory lock do par usuário+feature.
create or replace function public.sweep_ai_reservations(uid uuid, feat text)
returns void language sql security definer set search_path = public as $$
  delete from public.ai_usage
   where user_id = uid and feature = feat and model = 'reserva'
     and created_at < now() - public.ai_reservation_grace();
$$;
revoke all on function public.sweep_ai_reservations(uuid, text) from anon, authenticated;

-- LIQUIDAÇÃO. Chamada por quem consome a cota SEM passar a reserva para o
-- anthropicCall (o Conselheiro do WhatsApp registra sob 'wa-conselheiro'; a
-- análise de documento é lida dentro do turno do Conselheiro). A linha
-- continua contando — ela É o marcador da cota — mas deixa de parecer uma
-- chamada em voo, que é o que a tornava indistinguível de uma órfã.
create or replace function public.settle_ai_usage(reservation_id bigint)
returns void language sql security definer set search_path = public as $$
  update public.ai_usage set model = 'reserva-consumida'
   where id = reservation_id and model = 'reserva';
$$;
revoke all on function public.settle_ai_usage(bigint) from anon, authenticated;

-- ─── 17. LIMITES DE IA ATÔMICOS (reserva antes da chamada) ──────
-- Duas requisições simultâneas não passam mais juntas pela verificação:
-- a função reserva a unidade de cota sob advisory lock (por usuário+feature)
-- e a função de borda devolve a reserva se a chamada de IA falhar.
-- A contagem e a varredura de reserva ÓRFÃ (a função de borda foi MORTA entre
-- a reserva e a devolução, e a linha cobrava a pessoa para sempre) vivem em
-- ai_usage_counted/sweep_ai_reservations — criadas na migração
-- 20260913140000_reserva_orfa_nao_pode_cobrar_cota.sql, que explica o porquê
-- e o número da janela de graça.
create or replace function public.reserve_ai_usage(uid uuid, feat text, cap int, since timestamptz)
returns bigint language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext(uid::text || ':' || feat));
  perform public.sweep_ai_reservations(uid, feat);
  if cap is not null and public.ai_usage_counted(uid, feat, since) >= cap then
    return null;
  end if;
  insert into public.ai_usage (user_id, feature, model, success)
  values (uid, feat, 'reserva', true)
  returning id into new_id;
  return new_id;
end; $$;
revoke all on function public.reserve_ai_usage(uuid, text, int, timestamptz) from anon, authenticated;

create or replace function public.release_ai_usage(reservation_id bigint)
returns void language sql security definer set search_path = public as $$
  delete from public.ai_usage where id = reservation_id and model = 'reserva';
$$;
revoke all on function public.release_ai_usage(bigint) from anon, authenticated;

-- ─── 18. FEEDBACK (canal temporário durante o piloto) ───────────
-- Espaço para os usuários mandarem ideias, problemas e elogios de dentro do
-- app. Leitura administrativa pelo SQL Editor; o usuário vê o que enviou.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'outro'
    check (category in ('ideia','problema','elogio','outro')),
  message text not null check (char_length(message) between 3 and 2000),
  page text,
  created_at timestamptz not null default now()
);
create index if not exists feedback_created on public.feedback (created_at desc);
alter table public.feedback enable row level security;
drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback for insert with check (auth.uid() = user_id);
drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own" on public.feedback for select using (auth.uid() = user_id);

-- ─── 19. HIGIENE DO CHAT ─────────────────────────────────────────
-- Remove mensagens vazias antigas do assistente (balões vazios; Etapa 3.3).
-- As funções não gravam mais mensagens vazias — isto limpa o legado.
delete from public.chat_messages
 where btrim(coalesce(content, '')) = '';

-- Conteúdo nunca mais entra vazio (idempotente; ignora se já existir).
do $$ begin
  alter table public.chat_messages
    add constraint chat_messages_content_not_blank check (btrim(content) <> '');
exception when duplicate_object or check_violation then null; end $$;

-- ─── 20. NOVA FLAG: composição corporal por foto (suspensa) ─────
-- A função analyze-body só responde com body_photo_enabled = true.
update public.app_settings
   set value = value || '{"body_photo_enabled": false}'::jsonb,
       updated_at = now()
 where key = 'flags'
   and not (value ? 'body_photo_enabled');

-- ─── 21. REPARO DA LINHA DO TEMPO (executar UMA vez, com backup) ─
-- 1. Faça backup (Dashboard → Database → Backups, ou pg_dump).
-- 2. Rode:   select * from public.repair_timeline();
-- 3. Anote quantos itens foram vinculados/removidos (linked_*/removed_*).
-- 4. Confira manualmente alguns usuários (transações × eventos × XP).
-- 5. Valide: excluir transação remove evento e XP; desfazer hábito idem;
--    registros repetidos não criam XP duplicado (índices únicos garantem).
-- ─── 22. PROSPERIDADE EM CAMADAS (estimado → recorrente → real) ──
-- Refatoração do cold start financeiro (proposta aprovada):
-- o mês passa a ter três camadas. Gráficos e Conselheiro funcionam desde o
-- dia 1 com estimativas declaradas; recorrentes eliminam o grosso do registro
-- manual; o real refina (substitui, nunca soma) o estimado.

-- 22.1 Origem do lançamento: manual | capture | import | recurring.
--      Permite XP justo (importação/recorrência não geram XP por item) e
--      gráficos que distinguem real digitado de materializado.
alter table public.transactions
  add column if not exists source text not null default 'manual';
do $$ begin
  alter table public.transactions
    add constraint transactions_source_check
    check (source in ('manual','capture','import','recurring'));
exception when duplicate_object then null; end $$;

alter table public.transactions
  add column if not exists recurring_id uuid;

-- 22.2 Estimativas por categoria (camada 1 — o "Raio-X de 60 segundos").
--      Valores aproximados declarados pela pessoa. São PREMISSAS, não
--      registros: entram no retrato do Conselheiro marcadas como estimativa.
create table if not exists public.category_estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  amount numeric not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, category)
);
alter table public.category_estimates enable row level security;
drop policy if exists "est_select_own" on public.category_estimates;
create policy "est_select_own" on public.category_estimates for select using (auth.uid() = user_id);
drop policy if exists "est_insert_own" on public.category_estimates;
create policy "est_insert_own" on public.category_estimates for insert with check (auth.uid() = user_id);
drop policy if exists "est_update_own" on public.category_estimates;
create policy "est_update_own" on public.category_estimates for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "est_delete_own" on public.category_estimates;
create policy "est_delete_own" on public.category_estimates for delete using (auth.uid() = user_id);

-- 22.3 Recorrentes (camada 2): cadastra uma vez, materializa todo mês.
create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income','expense')),
  amount numeric not null check (amount > 0),
  category text not null default 'Outros',
  description text,
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.recurring_transactions enable row level security;
drop policy if exists "rec_select_own" on public.recurring_transactions;
create policy "rec_select_own" on public.recurring_transactions for select using (auth.uid() = user_id);
drop policy if exists "rec_insert_own" on public.recurring_transactions;
create policy "rec_insert_own" on public.recurring_transactions for insert with check (auth.uid() = user_id);
drop policy if exists "rec_update_own" on public.recurring_transactions;
create policy "rec_update_own" on public.recurring_transactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "rec_delete_own" on public.recurring_transactions;
create policy "rec_delete_own" on public.recurring_transactions for delete using (auth.uid() = user_id);

do $$ begin
  alter table public.transactions
    add constraint transactions_recurring_fk
    foreign key (recurring_id) references public.recurring_transactions(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Cinto e suspensório contra materialização dupla no mesmo mês civil — que,
-- com a materialização consciente de ciclo, é uma linha por CICLO: para um par
-- (cycleDay, day_of_month) fixo, ciclos consecutivos caem em meses civis
-- consecutivos, então a correspondência é 1 para 1. Se a pessoa MUDAR o
-- cycleDay, dois ciclos podem mapear para o mesmo mês civil e o índice barra a
-- segunda linha — que é o lado seguro do erro.
create unique index if not exists tx_recurring_month_unique
  on public.transactions (recurring_id, date_trunc('month', occurred_at::timestamp))
  where recurring_id is not null;

-- 22.4 HISTÓRICO. Guarda antiga da materialização: "o ciclo K rodou para o
--      usuário U". NÃO é mais escrita nem lida — ela registrava o fato errado
--      (o ciclo, não o recorrente), e por isso um recorrente criado depois da
--      rodada perdia o ciclo inteiro. Quem guarda isso agora é
--      recurrence_materializations, logo abaixo (22.4-B).
--      A tabela fica de pé porque é dela que a tradução para o modelo novo foi
--      feita (r.created_at <= run.ran_at) e porque jogar histórico fora não se
--      desfaz. NÃO volte a usá-la como guarda.
--      A chave já tinha sido 'month_key' (mês civil), e isso era a outra
--      metade do mesmo bug — ver 20260914120000_o_fixo_nasce_no_ciclo_da_pessoa.sql.
create table if not exists public.recurrence_runs (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Chave do CICLO: mês em que o ciclo COMEÇOU ('YYYY-MM', fuso de São Paulo).
  -- Mesma conta de cycleKey() em src/lib/prosperidade.ts. Com
  -- financial_cycle_day nulo ou 1, é idêntica ao mês civil.
  cycle_key text not null,
  ran_at timestamptz not null default now(),
  primary key (user_id, cycle_key)
);
alter table public.recurrence_runs enable row level security;
drop policy if exists "runs_select_own" on public.recurrence_runs;
create policy "runs_select_own" on public.recurrence_runs for select using (auth.uid() = user_id);
-- (sem insert/update/delete: só a função security definer escreve aqui)

-- 22.4-B Livro-caixa de materialização: uma linha por (RECORRENTE, CICLO), no
--        momento em que o recorrente é materializado.
--        A guarda acima registrava o fato ERRADO — "o ciclo K rodou" — e com
--        isso um recorrente criado DEPOIS da rodada perdia o ciclo inteiro,
--        sem segunda chance. Em produção isso somou três ciclos seguidos sem
--        o salário de uma pessoa: a tela dizia "Entradas: R$ 0".
--        Por que uma tabela e não inferir por `transactions`: o índice único
--        só sabe o que EXISTE agora, e não distingue "nunca foi criado" de
--        "foi criado e a pessoa apagou". `life_events` também não serve —
--        trg_tx_event_del apaga o evento junto com a transação. Esta tabela é
--        o único registro durável do ATO, e é dela que depende a promessa
--        "apagou, não volta".
--        Ver 20260914160000_o_fixo_criado_depois_da_rodada_perdia_o_ciclo.sql.
create table if not exists public.recurrence_materializations (
  recurring_id uuid not null references public.recurring_transactions(id) on delete cascade,
  cycle_key text not null,              -- 'YYYY-MM' do ciclo (ver cycleKey em src/lib/prosperidade.ts)
  user_id uuid not null references auth.users(id) on delete cascade,
  materialized_at timestamptz not null default now(),
  primary key (recurring_id, cycle_key)
);
create index if not exists recurrence_mat_user_cycle
  on public.recurrence_materializations (user_id, cycle_key);
alter table public.recurrence_materializations enable row level security;
drop policy if exists "recmat_select_own" on public.recurrence_materializations;
create policy "recmat_select_own" on public.recurrence_materializations for select using (auth.uid() = user_id);
-- (sem insert/update/delete: só a função security definer escreve aqui)

-- ─── A REGRA, NUM LUGAR SÓ ────────────────────────────────────────────
-- O app chama ensure_month_recurrences() (sem argumento, pelo auth.uid()); a
-- cura da dívida chama esta aqui, por usuário. Uma definição só: a cura não
-- pode divergir do caminho real, senão consertamos hoje e desconsertamos na
-- próxima mudança.
create or replace function public.materialize_recurrences_for(uid uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  sp_today date := (now() at time zone 'America/Sao_Paulo')::date;
  cday int;
  cycle_start date;
  ckey text;
  inserted int := 0;
begin
  if uid is null then return 0; end if;

  -- Mesmo clamp de clampCycleDay() no prosperidade.ts: fora de 2..28 (ou
  -- nulo, ou perfil ausente) é mês civil.
  select case when p.financial_cycle_day between 2 and 28 then p.financial_cycle_day else 1 end
    into cday from public.profiles p where p.user_id = uid;
  cday := coalesce(cday, 1);

  -- Primeiro dia do ciclo CORRENTE. Subtrair (cday-1) dias e truncar no mês é
  -- a mesma conta de cycleKey(); com cday=1 devolve o primeiro dia do mês.
  cycle_start := date_trunc('month', sp_today - make_interval(days => cday - 1))::date + (cday - 1);
  ckey := to_char(cycle_start, 'YYYY-MM');

  with pendentes as (
    -- A pergunta é POR RECORRENTE. Antes era "este ciclo já rodou?", e quem
    -- nascia depois da rodada não tinha segunda chance.
    select r.id, r.user_id, r.kind, r.amount, r.category, r.description, r.day_of_month
      from public.recurring_transactions r
     where r.user_id = uid and r.active
       and not exists (
         select 1 from public.recurrence_materializations m
          where m.recurring_id = r.id and m.cycle_key = ckey)
  ),
  gravadas as (
    insert into public.transactions (user_id, kind, amount, category, description, occurred_at, source, recurring_id)
    select p.user_id, p.kind, p.amount, p.category,
           coalesce(p.description, p.category),
           -- A única ocorrência do dia D dentro do ciclo corrente: a deste mês
           -- quando D >= C, a do mês seguinte quando D < C (senão a linha cairia
           -- no ciclo anterior). day_of_month é 1..28 por CHECK, então não
           -- existe mês curto para tratar aqui.
           (date_trunc('month', cycle_start)
              + case when p.day_of_month >= cday then interval '0' else interval '1 month' end)::date
             + (p.day_of_month - 1),
           'recurring', p.id
      from pendentes p
    on conflict (recurring_id, (date_trunc('month', occurred_at::timestamp)))
      where recurring_id is not null do nothing
    returning 1
  ),
  marcadas as (
    -- Marca TODOS os pendentes, inclusive os que caíram no conflito: conflito
    -- aqui significa que o lançamento daquele ciclo já existe (o Raio-X cria
    -- na hora, por exemplo). O ato aconteceu; não há por que tentar de novo.
    -- CTE que escreve roda sempre, mesmo sem ser lida pela consulta principal
    -- (garantia do Postgres) — é de propósito que ela não aparece embaixo.
    insert into public.recurrence_materializations (recurring_id, cycle_key, user_id)
    select p.id, ckey, uid from pendentes p
    on conflict (recurring_id, cycle_key) do nothing
    returning 1
  )
  select count(*) into inserted from gravadas;

  return inserted;
end; $$;
revoke all on function public.materialize_recurrences_for(uuid) from anon, authenticated;

-- Materialização lazy: chamada pelo app ao abrir a Prosperidade / tela Hoje.
-- Zero infraestrutura de cron; funciona para quem só abre o app no dia 15.
-- O nome continua 'month' porque é o que o app chama por RPC; o "mês" aqui é
-- o CICLO da pessoa (profiles.financial_cycle_day).
create or replace function public.ensure_month_recurrences()
returns int language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 0; end if;
  return public.materialize_recurrences_for(auth.uid());
end; $$;
grant execute on function public.ensure_month_recurrences() to authenticated;

-- 22.5 XP justo: lançamento materializado/importado NÃO gera XP por item
--      (um PDF de fatura não pode inflar nível — "XP só por ação na vida
--      real"). O gatilho tx_to_life_event passa a carregar a origem no
--      payload e o award_xp_for_event pula essas origens.
create or replace function public.tx_to_life_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.life_events (user_id, pillar, kind, occurred_at, payload, source, source_table, source_id)
  values (new.user_id, 'prosperidade', 'transaction', new.occurred_at::timestamptz,
    jsonb_build_object('amount', new.amount, 'tx_kind', new.kind, 'category', new.category,
                       'description', new.description, 'tx_source', new.source,
                       'tx_group_id', new.group_id),
    'system', 'transactions', new.id)
  on conflict (source_table, source_id) where source_id is not null do nothing;
  return new;
end; $$;

create or replace function public.award_xp_for_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare pts int;
begin
  -- Registro IMPORTADO de qualquer tipo não vale XP por item: a pessoa não
  -- viveu 555 noites agora, ela trouxe um arquivo. Antes esta isenção só
  -- existia para transações e o histórico de sono/treino/peso inflava o nível
  -- (achado P0 do plano refinado; ver migração 20260902120000).
  if coalesce(new.source, 'manual') = 'import' then
    return new;
  end if;

  -- Recorrência e importação financeira: mesma regra, pela via do payload.
  if new.kind = 'transaction'
     and coalesce(new.payload->>'tx_source', 'manual') in ('recurring','import') then
    return new;
  end if;

  -- Compra parcelada: DEZ LINHAS, UMA AÇÃO, UM XP. A primeira parcela a chegar
  -- leva os 2 XP da compra; as irmãs não levam nada. Ver o cabeçalho desta
  -- migração — é a mesma regra "XP por ato vivido, nunca por volume de linhas"
  -- que já vale para importação e recorrência.
  if new.kind = 'transaction'
     and (new.payload->>'tx_group_id') is not null
     and exists (
       select 1 from public.life_events e
        where e.user_id = new.user_id
          and e.kind = 'transaction'
          and e.payload->>'tx_group_id' = new.payload->>'tx_group_id'
          and e.id <> new.id
     ) then
    return new;
  end if;

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

-- 22.6 XP de marco: "mês mapeado" — um único bônus por mês quando a pessoa
--      importa a fatura (a ação real foi UMA: trazer o documento).
-- A versão SEM argumentos precisa sair antes: mantê-la ao lado de uma com
-- `default null` deixaria `award_import_milestone()` ambígua para o Postgres
-- e quebraria a confirmação de fatura, que chama exatamente assim.
drop function if exists public.award_import_milestone();

create or replace function public.award_import_milestone(p_source_id uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  mkey text := to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM');
  reason_text text;
begin
  if uid is null then return false; end if;

  -- Sem fonte: comportamento antigo (um marco por mês), preservado para
  -- qualquer chamador que ainda não passe o id.
  if p_source_id is null then
    if exists (
      select 1 from public.xp_log
      where user_id = uid and reason = 'Fatura importada: mês mapeado'
        and to_char((created_at at time zone 'America/Sao_Paulo')::date, 'YYYY-MM') = mkey
    ) then return false; end if;
    insert into public.xp_log (user_id, points, reason)
    values (uid, 15, 'Fatura importada: mês mapeado');
    return true;
  end if;

  -- A fonte precisa ser da própria pessoa (a função é security definer).
  if not exists (
    select 1 from public.data_sources
    where id = p_source_id and user_id = uid
  ) then return false; end if;

  reason_text := 'Importação concluída: ' || p_source_id::text;
  if exists (
    select 1 from public.xp_log where user_id = uid and reason = reason_text
  ) then return false; end if;

  insert into public.xp_log (user_id, points, reason)
  values (uid, 15, reason_text);
  return true;
end; $$;

grant execute on function public.award_import_milestone(uuid) to authenticated;

-- ─── 23. XP DE MARCO: PRIMEIROS PASSOS (análise UX P1.1) ──
-- Quando o usuário conclui a trilha inicial (captura, Raio-X, refeição e
-- primeiro plano), o checklist termina em clímax em vez de sumir em
-- silêncio: +20 XP, uma única vez por conta.
create or replace function public.award_first_steps_milestone()
returns boolean language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return false; end if;
  if exists (
    select 1 from public.xp_log
    where user_id = uid and reason = 'Primeiros passos concluídos: base montada'
  ) then return false; end if;
  insert into public.xp_log (user_id, points, reason)
  values (uid, 20, 'Primeiros passos concluídos: base montada');
  return true;
end; $$;

-- ─── 24. BLUEPRINT DA SUBIDA (onboarding estendido, Emenda 4) ──
-- Reivindicação atômica da cortesia: o blueprint com IA é gerado UMA vez por
-- conta. A função marca blueprint_generated_at somente se ainda estiver nulo
-- (condicional no UPDATE = duas requisições simultâneas não passam juntas).
-- Chamada apenas pelo service role (função de borda onboarding-blueprint).
create or replace function public.claim_blueprint(uid uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare updated int;
begin
  update public.profiles
     set blueprint_generated_at = now()
   where user_id = uid and blueprint_generated_at is null;
  get diagnostics updated = row_count;
  return updated > 0;
end; $$;
revoke execute on function public.claim_blueprint(uuid) from public;
revoke execute on function public.claim_blueprint(uuid) from anon, authenticated;
grant execute on function public.award_first_steps_milestone() to authenticated;
-- ═══════════════════════════════════════════════════════════════
-- ENDURECIMENTO (auditoria "achados-forge") — seções 25 a 30.
-- Idempotente: pode rodar em banco já existente.
-- ═══════════════════════════════════════════════════════════════

-- ─── 25. GUIA DE PRIMEIRAS VEZES (achado 7) ─────────────────────
-- A coluna era lida e escrita pelo app (useGuides/useProfile) mas nunca
-- existiu em nenhum script: o update falhava com PGRST204 (só console.error)
-- e as dicas de primeira vez reapareciam para sempre.
alter table public.profiles
  add column if not exists guides_seen text[] not null default '{}';

-- ─── 26. DEVOLUÇÃO DE COTA QUE FUNCIONA MESMO APÓS A CHAMADA (achado 5) ──
-- A versão anterior só apagava a linha enquanto ela ainda era 'reserva'.
-- Depois de uma chamada bem-sucedida, `anthropicCall` sobrescreve o model
-- com o modelo real — e o delete virava no-op silencioso, então caminhos
-- como "a foto não é comida" cobravam a cota mesmo devolvendo-a no código.
-- Agora: reserva nunca usada some; chamada já paga é ESTORNADA (success=false
-- sai da contagem de reserve_ai_usage/countUsage) preservando a telemetria
-- de tokens e custo, que é real e precisa continuar auditável.
create or replace function public.release_ai_usage(reservation_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.ai_usage where id = reservation_id and model = 'reserva';
  if not found then
    update public.ai_usage
       set success = false,
           error_code = coalesce(error_code, 'refunded')
     where id = reservation_id;
  end if;
end; $$;
revoke all on function public.release_ai_usage(bigint) from anon, authenticated;

-- ─── 27. RESERVA DE COTA COM VÁRIAS JANELAS (achado 3) ──────────
-- O teto do Conselheiro tem até três janelas simultâneas (dia, semana, mês).
-- Contá-las com selects separados antes de gravar deixava duas requisições
-- simultâneas passarem juntas. Aqui a decisão inteira acontece sob o mesmo
-- advisory lock e devolve QUAL janela barrou (o app precisa da mensagem e do
-- reset_at corretos). cap null = janela sem limite.
-- A contagem passa por ai_usage_counted (ignora reserva ABERTA e velha, que é
-- entulho de função morta) e a varredura por sweep_ai_reservations — as duas
-- nascem na migração 20260913140000_reserva_orfa_nao_pode_cobrar_cota.sql.
create or replace function public.reserve_ai_usage_windows(
  uid uuid, feat text,
  cap_day int, since_day timestamptz,
  cap_week int, since_week timestamptz,
  cap_month int, since_month timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext(uid::text || ':' || feat));
  perform public.sweep_ai_reservations(uid, feat);

  if cap_day is not null and public.ai_usage_counted(uid, feat, since_day) >= cap_day then
    return jsonb_build_object('id', null, 'window', 'daily');
  end if;
  if cap_week is not null and public.ai_usage_counted(uid, feat, since_week) >= cap_week then
    return jsonb_build_object('id', null, 'window', 'weekly');
  end if;
  if cap_month is not null and public.ai_usage_counted(uid, feat, since_month) >= cap_month then
    return jsonb_build_object('id', null, 'window', 'monthly');
  end if;

  insert into public.ai_usage (user_id, feature, model, success)
  values (uid, feat, 'reserva', true)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'window', null);
end; $$;
revoke all on function public.reserve_ai_usage_windows(uuid, text, int, timestamptz, int, timestamptz, int, timestamptz) from anon, authenticated;

-- ─── 28. RATE LIMIT ANTI-ABUSO ATÔMICO (achado 3) ───────────────
-- `assertRateLimit` contava fn_calls e só depois inseria: além da corrida,
-- QUALQUER erro de banco na contagem liberava a chamada (fail-open num
-- controle de custo). Agora contagem + registro acontecem sob advisory lock,
-- e a função de borda trata erro como 503 (fail-closed).
-- Retorna true quando a chamada pode seguir.
create or replace function public.reserve_fn_call(
  uid uuid, fn_name text, max_calls int, window_min int
) returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('fn:' || uid::text || ':' || fn_name));
  select count(*) into n from public.fn_calls
   where user_id = uid and fn = fn_name
     and called_at >= now() - make_interval(mins => window_min);
  if n >= max_calls then return false; end if;
  insert into public.fn_calls (user_id, fn) values (uid, fn_name);
  delete from public.fn_calls
   where user_id = uid and fn = fn_name and called_at < now() - interval '1 day';
  return true;
end; $$;
revoke all on function public.reserve_fn_call(uuid, text, int, int) from anon, authenticated;

-- ─── 29. FORÇA-BRUTA DO CÓDIGO DE PAREAMENTO DO WHATSAPP (achado 1) ──
-- O webhook casava `pairing_code` sem nenhum teto de tentativas por número.
-- Com o App Secret ausente (que agora falha fechado, mas era fail-open),
-- 6 dígitos eram força-brutáveis até sequestrar a conta de outra pessoa.
-- Aqui o teto é por telefone, atômico, e vale mesmo com assinatura válida.
create table if not exists public.whatsapp_pair_attempts (
  id bigint generated always as identity primary key,
  phone text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists wa_pair_attempts_phone
  on public.whatsapp_pair_attempts (phone, attempted_at desc);
alter table public.whatsapp_pair_attempts enable row level security;
-- RLS sem policies: só o service role (webhook) lê e escreve.

-- true = pode tentar (a tentativa fica registrada). false = teto estourado.
create or replace function public.wa_pair_attempt(
  p_phone text, max_attempts int, window_min int
) returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('wa_pair:' || p_phone));
  select count(*) into n from public.whatsapp_pair_attempts
   where phone = p_phone and attempted_at >= now() - make_interval(mins => window_min);
  if n >= max_attempts then return false; end if;
  insert into public.whatsapp_pair_attempts (phone) values (p_phone);
  delete from public.whatsapp_pair_attempts
   where attempted_at < now() - interval '1 day';
  return true;
end; $$;
revoke all on function public.wa_pair_attempt(text, int, int) from anon, authenticated;

-- Pareamento concluído: zera o histórico de tentativas daquele número.
create or replace function public.wa_pair_clear(p_phone text)
returns void language sql security definer set search_path = public as $$
  delete from public.whatsapp_pair_attempts where phone = p_phone;
$$;
revoke all on function public.wa_pair_clear(text) from anon, authenticated;

-- ─── 30. XP AGREGADO NO BANCO (achado 8) ────────────────────────
-- O app somava toda a xp_log no navegador e o PostgREST cortava a resposta no
-- `max-rows` do projeto (1000 por padrão): passando disso, XP e nível paravam
-- de subir. `xp_total` já existia (§10) e é o que o retrato da IA usa; o
-- grant abaixo deixa explícito que o cliente também pode chamá-lo.
-- Continua SEM security definer de propósito: roda como o usuário, então o
-- RLS de xp_log garante que ninguém lê o total de outra conta.
grant execute on function public.xp_total(uuid) to authenticated;

-- XP do Mokari: a mesma soma, EXCLUINDO peso e composição corporal (regra 3 —
-- nada no Mokari muda em função do corpo). Nunca use xp_total(uuid) para o
-- estágio do Mokari: ela soma tudo, inclusive "Peso registrado".
-- ⚠ A lista de motivos vive TAMBÉM em IGNORED_XP_REASONS (src/lib/mokari.ts) e
-- na migração 20260908120000. src/lib/mokariReasons.test.ts lê os três e falha
-- se divergirem. Não apague os marcadores.
create or replace function public.xp_total_mokari(uid uuid)
returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(points), 0)::bigint
  from public.xp_log
  where user_id = uid
    and coalesce(reason, '') <> all (array[
      -- IGNORED_XP_REASONS:BEGIN
      'Peso registrado',
      'Composição corporal registrada',
      'Registro: weight',
      'Registro: body'
      -- IGNORED_XP_REASONS:END
    ]);
$$;
grant execute on function public.xp_total_mokari(uuid) to authenticated;

-- ─── 32. FONTES E RECIBOS (Fase 1 do plano refinado) ─────────
-- ─── A FONTE: o arquivo (ou origem) que produziu registros ──────────────
create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- health_csv | financial_statement | chat_attachment | manual
  kind text not null,
  -- Nome que a PESSOA reconhece ("sleepdata.csv"), não um id técnico.
  display_name text not null,
  -- SHA-256 do conteúdo. É o que responde "já importei este arquivo?" sem
  -- guardar o arquivo: o bruto é descartado (§4.4).
  file_hash text,
  -- Qual regra produziu estes dados. Quando o parser melhorar, dá para saber
  -- o que foi lido pela versão antiga.
  parser_version text,
  period_start date,
  period_end date,
  -- previewed | confirmed | partial | failed | deleted
  status text not null default 'previewed',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

alter table public.data_sources enable row level security;
drop policy if exists "data_sources_all_own" on public.data_sources;
create policy "data_sources_all_own" on public.data_sources
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists data_sources_user_time
  on public.data_sources (user_id, created_at desc);
-- Mesmo arquivo, mesma pessoa: uma fonte só. É este índice que faz
-- reimportar o mesmo CSV não criar uma segunda trilha.
create unique index if not exists data_sources_user_hash
  on public.data_sources (user_id, file_hash) where file_hash is not null;

-- ─── O RECIBO: o que entrou, o que não entrou e por quê ─────────────────
create table if not exists public.import_receipts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.data_sources(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  total_rows int not null default 0,
  accepted_rows int not null default 0,
  duplicate_rows int not null default 0,
  rejected_rows int not null default 0,
  -- Lista curta e estruturada, não um dump de log.
  warnings jsonb not null default '[]'::jsonb,
  -- Texto em linguagem de usuário: é o que a tela mostra sem traduzir nada.
  summary text,
  created_at timestamptz not null default now()
);

alter table public.import_receipts enable row level security;
drop policy if exists "import_receipts_all_own" on public.import_receipts;
create policy "import_receipts_all_own" on public.import_receipts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists import_receipts_user_time
  on public.import_receipts (user_id, created_at desc);
create index if not exists import_receipts_source
  on public.import_receipts (source_id);

-- ─── LIGAÇÃO EVENTO → FONTE ─────────────────────────────────────────────
-- ATENÇÃO ao ler este trecho: life_events JÁ tem `source_table`/`source_id`,
-- que são outra coisa — apontam o REGISTRO de origem de eventos derivados
-- (ex.: a transação que gerou o evento). As colunas abaixo apontam o ARQUIVO.
-- Nomes propositalmente diferentes para não confundir os dois conceitos.
alter table public.life_events
  add column if not exists data_source_id uuid references public.data_sources(id) on delete set null;
-- Chave estável do registro DENTRO da fonte (ex.: "sleep|2026-08-03").
-- É ela que torna a reimportação idempotente de verdade.
alter table public.life_events
  add column if not exists source_record_key text;

create unique index if not exists life_events_source_record_unique
  on public.life_events (user_id, data_source_id, source_record_key)
  where data_source_id is not null and source_record_key is not null;

create index if not exists life_events_data_source
  on public.life_events (data_source_id) where data_source_id is not null;


-- Proveniência também nos lançamentos financeiros (fatura grava em
-- transactions, não em life_events).
alter table public.transactions
  add column if not exists data_source_id uuid references public.data_sources(id) on delete set null;
alter table public.transactions
  add column if not exists source_record_key text;

-- Compra parcelada registrada a mao: as N linhas compartilham este uuid. E o
-- UNICO vinculo entre elas -- nunca agrupar por texto da descricao. Ver a
-- migracao 20260914140000.
alter table public.transactions
  add column if not exists group_id uuid;
create index if not exists transactions_user_group
  on public.transactions (user_id, group_id)
  where group_id is not null;

create unique index if not exists transactions_source_record_unique
  on public.transactions (user_id, data_source_id, source_record_key)
  where data_source_id is not null and source_record_key is not null;

create index if not exists transactions_data_source
  on public.transactions (data_source_id) where data_source_id is not null;

-- ─── 31. CICLO FINANCEIRO CUSTOMIZÁVEL (TODO do fundador) ───────
-- Dia do mês em que o "mês financeiro" vira (ex.: 10 = ciclo de 10/mês a
-- 09/mês seguinte). NULL ou 1 = mês civil de sempre (comportamento atual,
-- ninguém é afetado por padrão). Validado no cliente (1-28); sem CHECK aqui
-- para não travar backfill futuro por engano.
alter table public.profiles
  add column if not exists financial_cycle_day int;

-- ─── 33. MEMÓRIA CONTROLÁVEL (Fase 2 do plano refinado) ─────────
-- A memória deixa de ser uma lista plana que só a IA escreve e ganha ESTADO
-- (ativa/confirmada/rejeitada/expirada), TEMPO (desde quando, até quando,
-- quando foi verificada) e ORIGEM (de qual evento, mensagem ou arquivo
-- nasceu). Motivo: memória errada sem como corrigir envenena todo turno
-- seguinte do Conselheiro. Valores em português, como plans.status.
alter table public.ai_memories
  add column if not exists status text not null default 'ativa',
  add column if not exists confidence numeric,
  add column if not exists valid_from timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists sensitivity text not null default 'normal',
  add column if not exists created_by text not null default 'ia';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_memories_status_valido') then
    alter table public.ai_memories add constraint ai_memories_status_valido
      check (status in ('ativa', 'confirmada', 'rejeitada', 'expirada'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_memories_confidence_faixa') then
    alter table public.ai_memories add constraint ai_memories_confidence_faixa
      check (confidence is null or (confidence >= 0 and confidence <= 1));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_memories_sensitivity_valida') then
    alter table public.ai_memories add constraint ai_memories_sensitivity_valida
      check (sensitivity in ('normal', 'sensivel'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_memories_created_by_valido') then
    alter table public.ai_memories add constraint ai_memories_created_by_valido
      check (created_by in ('ia', 'usuario'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_memories_validade_coerente') then
    alter table public.ai_memories add constraint ai_memories_validade_coerente
      check (valid_until is null or valid_from is null or valid_until > valid_from);
  end if;
end $$;

-- Sem UPDATE, corrigir memória falha em SILÊNCIO (RLS casa zero linhas e
-- devolve ok). A tela diria "salvo" sem ter salvado nada.
drop policy if exists "memories_update_own" on public.ai_memories;
create policy "memories_update_own" on public.ai_memories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- A autoria só é definida no INSERT. `with check` não enxerga a linha antiga,
-- então quem congela a coluna é o gatilho: editar o texto de uma memória da
-- IA não transfere a autoria para a pessoa (a medida 3 das decisões conta
-- "memórias da IA que a pessoa julgou", e a conta desandaria).
create or replace function public.ai_memories_freeze_created_by()
returns trigger language plpgsql as $$
begin
  if new.created_by is distinct from old.created_by then
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
drop trigger if exists ai_memories_created_by_imutavel on public.ai_memories;
create trigger ai_memories_created_by_imutavel
  before update on public.ai_memories
  for each row execute function public.ai_memories_freeze_created_by();

-- A pessoa também pode ensinar algo direto; created_by travado em 'usuario'.
drop policy if exists "memories_insert_own" on public.ai_memories;
create policy "memories_insert_own" on public.ai_memories
  for insert with check (auth.uid() = user_id and created_by = 'usuario');

-- Origem da memória: "por que você acha isso sobre mim?" precisa ter
-- resposta. ref_id é polimórfico (life_events, chat_messages, data_sources —
-- as três chaves são uuid), por isso sem FK.
create table if not exists public.memory_sources (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.ai_memories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- life_event | chat_message | data_source
  kind text not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memory_sources_kind_valido') then
    alter table public.memory_sources add constraint memory_sources_kind_valido
      check (kind in ('life_event', 'chat_message', 'data_source'));
  end if;
end $$;

alter table public.memory_sources enable row level security;
drop policy if exists "memory_sources_all_own" on public.memory_sources;
create policy "memory_sources_all_own" on public.memory_sources
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists memory_sources_memory
  on public.memory_sources (memory_id);
create index if not exists memory_sources_user_time
  on public.memory_sources (user_id, created_at desc);
create unique index if not exists memory_sources_unique
  on public.memory_sources (memory_id, kind, ref_id) where ref_id is not null;

-- Caminho quente: todo turno do Conselheiro lê as memórias vigentes.
create index if not exists ai_memories_user_vigentes
  on public.ai_memories (user_id, created_at desc)
  where status <> 'rejeitada' and status <> 'expirada';
create index if not exists ai_memories_valid_until
  on public.ai_memories (valid_until) where valid_until is not null;

-- A REGRA DE LEITURA em um lugar só (buildSnapshot, extração e Ajustes leem
-- daqui). trust_rank = 0 para o que a pessoa confirmou, 1 para o resto:
-- ordenar por (trust_rank, created_at desc) põe a palavra dela na frente.
-- security_invoker mantém o RLS de ai_memories valendo dentro da view.
create or replace view public.ai_memories_vigentes
  with (security_invoker = true) as
  select
    m.*,
    case when m.status = 'confirmada' then 0 else 1 end as trust_rank
  from public.ai_memories m
  where m.status <> 'rejeitada'
    and m.status <> 'expirada'
    and (m.valid_until is null or m.valid_until > now());

grant select on public.ai_memories_vigentes to authenticated;

-- ─── 34. MOKARI: PREFERÊNCIA DA PESSOA (Fase 5) ─────────────────
-- NULLABLE e SEM DEFAULT de propósito — não "conserte" para o padrão
-- `not null default false` das outras preferências acima: a anulabilidade É
-- o dado. null = nunca perguntamos (o convite pode aparecer) · false =
-- recusou ou desligou (silêncio, o convite não volta) · true = ligado.
-- Com default, "nunca perguntei" e "ela disse não" viram o mesmo valor, e o
-- convite ou insiste para sempre com quem já recusou, ou nunca aparece.
alter table public.profiles add column if not exists mokari_enabled boolean;

comment on column public.profiles.mokari_enabled is
  'Mokari: null = nunca perguntamos (pode convidar) · false = recusou ou desligou (silêncio) · true = ligado. NULLABLE de propósito — com default os dois primeiros estados viram um só.';

-- Sustenta o `exists` de award_xp_for_event (compra parcelada paga XP uma
-- vez so, nao uma por parcela). Ver a migracao 20260914140000.
create index if not exists life_events_tx_group
  on public.life_events (user_id, (payload->>'tx_group_id'))
  where (payload->>'tx_group_id') is not null;

