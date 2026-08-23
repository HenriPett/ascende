-- ═══════════════════════════════════════════════════════════════
-- ASCENDE — Atualização: WhatsApp (canal de retorno) + XP de metas batidas
-- Cole este arquivo INTEIRO no SQL Editor do Supabase e clique em RUN.
-- Pode rodar mais de uma vez sem problema (idempotente).
-- Pré-requisito: setup.sql já aplicado.
-- ═══════════════════════════════════════════════════════════════

-- ─── A. WHATSAPP: VÍNCULO DE CONTA ──────────────────────────────
-- Filosofia: o WhatsApp é canal de RETORNO ao app, não um segundo app.
-- Mensagens de saída são convites curtos com link; a captura inbound
-- confirma por botão e sempre aponta de volta para o painel.
--
-- Segurança do vínculo: o telefone NUNCA é gravado pelo cliente
-- (senão alguém poderia "sequestrar" o número de outra pessoa).
-- O fluxo é: app gera código de 6 dígitos (RPC abaixo) → a pessoa manda
-- o código pelo próprio WhatsApp → o webhook (service role) casa o código
-- com o número remetente. Só quem POSSUI o número consegue vinculá-lo.
create table if not exists public.whatsapp_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text unique,                       -- wa_id (E.164 sem '+'), gravado só pelo webhook
  pairing_code text,
  pairing_expires_at timestamptz,
  linked_at timestamptz,
  notify_retro boolean not null default true,     -- retrospectiva de domingo
  notify_briefing boolean not null default true,  -- briefing diário (Ascende+)
  notify_return boolean not null default true,    -- convite gentil após silêncio
  created_at timestamptz not null default now()
);
alter table public.whatsapp_links enable row level security;

drop policy if exists "wa_select_own" on public.whatsapp_links;
create policy "wa_select_own" on public.whatsapp_links
  for select using (auth.uid() = user_id);
-- (sem policy de insert/update de propósito: escrita só via RPCs abaixo e
--  via service role no webhook — cliente jamais grava phone diretamente.)

-- Propostas pendentes da captura por WhatsApp (1 por usuário; a IA nunca
-- grava sozinha — nem pelo WhatsApp: a pessoa confirma no botão ou no app).
create table if not exists public.whatsapp_pending (
  user_id uuid primary key references auth.users(id) on delete cascade,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.whatsapp_pending enable row level security;
-- (sem policies: tabela operada exclusivamente pelo service role.)

-- Deduplicação de envios de saída (1 retro/domingo, 1 briefing/dia,
-- convite de retorno com carência — nunca duas vezes a mesma cobrança).
create table if not exists public.whatsapp_sends (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('retro','briefing','return')),
  sent_on date not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, sent_on)
);
create index if not exists whatsapp_sends_user on public.whatsapp_sends (user_id, kind, sent_on desc);
alter table public.whatsapp_sends enable row level security;
-- (sem policies: service role apenas.)

-- ─── B. RPCs DO VÍNCULO (chamadas pelo app, autenticadas) ───────

-- Gera (ou regenera) o código de pareamento de 6 dígitos, válido por 15 min.
create or replace function public.create_whatsapp_pairing_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  code text := lpad(floor(random() * 1000000)::int::text, 6, '0');
begin
  if uid is null then return null; end if;
  insert into public.whatsapp_links (user_id, pairing_code, pairing_expires_at)
  values (uid, code, now() + interval '15 minutes')
  on conflict (user_id) do update
    set pairing_code = excluded.pairing_code,
        pairing_expires_at = excluded.pairing_expires_at;
  return code;
end; $$;
grant execute on function public.create_whatsapp_pairing_code() to authenticated;

-- Preferências de notificação (as ÚNICAS colunas que o cliente pode mudar).
create or replace function public.set_whatsapp_prefs(retro boolean, briefing boolean, ret boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return false; end if;
  update public.whatsapp_links
     set notify_retro = coalesce(retro, notify_retro),
         notify_briefing = coalesce(briefing, notify_briefing),
         notify_return = coalesce(ret, notify_return)
   where user_id = uid;
  return found;
end; $$;
grant execute on function public.set_whatsapp_prefs(boolean, boolean, boolean) to authenticated;

-- Desvincular: apaga o vínculo inteiro (LGPD: nada do número fica para trás).
create or replace function public.unlink_whatsapp()
returns boolean language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return false; end if;
  delete from public.whatsapp_pending where user_id = uid;
  delete from public.whatsapp_links where user_id = uid;
  return true;
end; $$;
grant execute on function public.unlink_whatsapp() to authenticated;

-- ─── C. XP DE METAS BATIDAS (deslocar a recompensa de "anotar" para "viver") ──
-- Padrão do projeto: zero infraestrutura de cron — avaliação preguiçosa.
-- O app chama claim_goal_bonuses() ao abrir a tela Hoje (1x/dia); a função
-- olha o dia de ONTEM (fuso SP) e premia metas batidas, com unicidade
-- garantida pelo reason datado. Requer atividade real no dia (nada de XP
-- por omissão) e cada bônus exige registros que comprovem a meta.
create or replace function public.claim_goal_bonuses()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  yday date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  tag text;
  awarded jsonb := '[]'::jsonb;
  water_goal int; kcal_goal int; spend_limit numeric;
  water_ml int; kcal int; spent numeric; tx_count int; had_events boolean;
begin
  if uid is null then return awarded; end if;
  tag := to_char(yday, 'YYYY-MM-DD');

  select p.water_goal_ml, p.calorie_goal_kcal, p.daily_spend_limit
    into water_goal, kcal_goal, spend_limit
    from public.profiles p where p.user_id = uid;
  if not found then return awarded; end if;

  select exists (
    select 1 from public.life_events
    where user_id = uid
      and (occurred_at at time zone 'America/Sao_Paulo')::date = yday
  ) into had_events;
  if not had_events then return awarded; end if;

  -- Água: soma dos ml de ontem >= meta.
  if coalesce(water_goal, 0) > 0 and not exists (
    select 1 from public.xp_log where user_id = uid and reason = 'Meta de água batida · ' || tag
  ) then
    select coalesce(sum((payload->>'ml')::int), 0) into water_ml
      from public.life_events
     where user_id = uid and kind = 'water'
       and (occurred_at at time zone 'America/Sao_Paulo')::date = yday;
    if water_ml >= water_goal then
      insert into public.xp_log (user_id, points, reason)
      values (uid, 10, 'Meta de água batida · ' || tag);
      awarded := awarded || jsonb_build_array(jsonb_build_object(
        'label', 'Meta de água batida ontem', 'points', 10));
    end if;
  end if;

  -- Calorias: houve refeições registradas E o total ficou na janela da meta
  -- (70%–110%: bater a meta, não passar fome — coerente com os valores da casa).
  if coalesce(kcal_goal, 0) > 0 and not exists (
    select 1 from public.xp_log where user_id = uid and reason = 'Dia dentro da meta calórica · ' || tag
  ) then
    select coalesce(sum((payload->>'calories')::int), 0) into kcal
      from public.life_events
     where user_id = uid and kind = 'meal'
       and (occurred_at at time zone 'America/Sao_Paulo')::date = yday;
    if kcal > 0 and kcal between round(kcal_goal * 0.70) and round(kcal_goal * 1.10) then
      insert into public.xp_log (user_id, points, reason)
      values (uid, 15, 'Dia dentro da meta calórica · ' || tag);
      awarded := awarded || jsonb_build_array(jsonb_build_object(
        'label', 'Dia dentro da meta calórica', 'points', 15));
    end if;
  end if;

  -- Teto de gasto diário: exige pelo menos 1 lançamento no dia (comprovação),
  -- e a soma das despesas <= teto.
  if coalesce(spend_limit, 0) > 0 and not exists (
    select 1 from public.xp_log where user_id = uid and reason = 'Dia dentro do teto de gasto · ' || tag
  ) then
    select coalesce(sum(amount), 0), count(*) into spent, tx_count
      from public.transactions
     where user_id = uid and kind = 'expense' and occurred_at = yday;
    if tx_count > 0 and spent <= spend_limit then
      insert into public.xp_log (user_id, points, reason)
      values (uid, 10, 'Dia dentro do teto de gasto · ' || tag);
      awarded := awarded || jsonb_build_array(jsonb_build_object(
        'label', 'Dia dentro do teto de gasto', 'points', 10));
    end if;
  end if;

  return awarded;
end; $$;
grant execute on function public.claim_goal_bonuses() to authenticated;

-- ─── D. AGENDAMENTO DOS ENVIOS DE SAÍDA (opcional, recomendado) ─
-- A função de borda `whatsapp-notify` é quem envia (retro de domingo,
-- briefing diário do Plus e convite de retorno). Ela é protegida por um
-- segredo (header x-cron-secret) e pode ser agendada de duas formas:
--
-- 1) Supabase Dashboard → Integrations → Cron (recomendado), chamando a URL
--    https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-notify
--    todo dia às 09:05 (horário de Brasília) com o header x-cron-secret.
--
-- 2) pg_cron + pg_net, descomentando o bloco abaixo e preenchendo URL/segredo:
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.schedule(
--   'ascende-whatsapp-notify',
--   '5 12 * * *',   -- 12:05 UTC = 09:05 em São Paulo
--   $$ select net.http_post(
--        url := 'https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-notify',
--        headers := jsonb_build_object('x-cron-secret', 'COLOQUE_O_SEGREDO_AQUI')
--      ); $$
-- );

-- ─── E. TEMPLATES DO WHATSAPP (documentação viva) ───────────────
-- Mensagens de SAÍDA fora da janela de 24h exigem templates aprovados pela
-- Meta (categoria UTILITY — a mais barata). Crie no Gerenciador do WhatsApp
-- três templates com corpo de UM parâmetro {{1}} (primeiro nome) e um botão
-- de URL fixo apontando para o app. Sugestões de corpo:
--
--   ascende_retro (UTILITY, pt_BR):
--     "Oi {{1}}! Sua retrospectiva da semana está pronta no Ascende. A IA
--      cruzou seus registros e contou a história da sua semana. ✨"
--     Botão URL → https://SEU-APP/app
--
--   ascende_briefing (UTILITY, pt_BR):
--     "Bom dia, {{1}}! Seu briefing de hoje já está no Ascende: o que
--      priorizar, com base no que você registrou."
--     Botão URL → https://SEU-APP/app
--
--   ascende_retorno (UTILITY, pt_BR):
--     "Oi {{1}}, aqui é o Ascende. Nada expirou por aqui: seus planos e
--      compromissos continuam valendo. Uma frase já recomeça a subida."
--     Botão URL → https://SEU-APP/app
--
-- Os NOMES podem ser trocados sem deploy via app_settings, chave 'whatsapp':
--   { "retro_template": "ascende_retro", "briefing_template": "ascende_briefing",
--     "return_template": "ascende_retorno", "lang": "pt_BR" }
insert into public.app_settings (key, value)
values ('whatsapp', '{"retro_template":"ascende_retro","briefing_template":"ascende_briefing","return_template":"ascende_retorno","lang":"pt_BR"}'::jsonb)
on conflict (key) do nothing;
