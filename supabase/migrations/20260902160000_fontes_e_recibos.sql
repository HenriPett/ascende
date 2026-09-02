-- ═══════════════════════════════════════════════════════════════════════
-- FASE 1 — PROVENIÊNCIA E RECIBO
--
-- "Absorver" não é anexar um arquivo: é receber a fonte, extrair, normalizar,
-- deduplicar, mostrar prévia, confirmar, persistir COM ORIGEM e emitir recibo
-- (plano refinado §4.1). Hoje a importação grava os eventos e esquece de onde
-- eles vieram: não dá para dizer quantas linhas entraram, quantas eram
-- duplicadas, nem abrir depois o que aconteceu.
--
-- Duas tabelas novas e duas colunas em life_events resolvem isso sem fila,
-- worker ou reprocessamento assíncrono — as importações do Ascende são locais
-- e síncronas, e o plano é explícito em não introduzir peso desnecessário.
-- ═══════════════════════════════════════════════════════════════════════

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

-- ─── MARCO DE IMPORTAÇÃO, AGORA POR FONTE ───────────────────────────────
-- A versão anterior era idempotente por MÊS e com a razão fixa "Fatura
-- importada" — então só servia para fatura, e importar sono/treino/peso não
-- concedia marco nenhum, apesar de a Fase 0 ter tirado o XP por item.
-- Agora: um marco por FONTE confirmada, para qualquer tipo de importação.
-- Continua sendo o único XP que a importação gera — organizar a própria
-- história vale reconhecimento; o volume do arquivo, não (PRINCIPIOS.md).
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
