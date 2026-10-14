-- ═══════════════════════════════════════════════════════════════════════
-- O BLUEPRINT GERADO FICA GUARDADO ATÉ SER USADO
--
-- O que acontecia (confirmado no código antes desta migração):
--
--   1. `onboarding-blueprint` reivindicava a cortesia (`claim_blueprint` →
--      `profiles.blueprint_generated_at`) ANTES de chamar o modelo, e devolvia
--      a proposta SÓ no corpo da resposta.
--   2. O `Onboarding.tsx` guardava a proposta num `useState`.
--   3. Recarregar a página, fechar a aba ou o iOS matar o PWA em segundo
--      plano entre "gerou" e "ativou" = proposta perdida E cortesia gasta. A
--      segunda chamada recebia 409 `already`, e a pessoa ficava sem o plano
--      que o app tinha acabado de prometer, na única vez em que ela o ganha.
--   4. A ativação eram N inserts do cliente, um a um. Interromper no meio e
--      tentar de novo duplicava planos e hábitos.
--
-- O que muda:
--
--   · `blueprint_proposals` guarda a proposta (uma linha por pessoa) e as
--     escolhas dela. A função grava a proposta ANTES de responder; quem volta
--     depois — outra aba, outro dia, outro aparelho — retoma a MESMA proposta,
--     sem chamar o modelo de novo.
--   · A ativação vira UMA transação no banco (`activate_blueprint`), com os
--     valores tirados da proposta guardada, nunca do cliente. Ou aplica tudo
--     uma vez, ou não aplica nada; a segunda chamada devolve o resultado da
--     primeira com `already`.
--   · `blueprint_events` é o rastro para medir quantas propostas chegam a ser
--     usadas e quantas retomadas falham — sem ferramenta nova, com SQL.
--
-- Contrato fechado em scratchpad/blueprint/PLANO.md (tabela, RPCs, respostas
-- da função). O retorno de `activate_blueprint` em caso de falha foi decidido
-- pelo Maestro em 13/10/2026 — ver a nota na própria função.
--
-- Objeto NOVO: mora só aqui, não no setup.sql (migrations/README.md).
-- Idempotente: pode rodar duas vezes.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── 1. A PROPOSTA ─────────────────────────────────────────────────────
-- Uma linha por pessoa porque a cortesia é uma por conta: a chave primária É a
-- regra "um Blueprint na vida", e é ela que torna a reivindicação atômica (dois
-- inserts simultâneos não passam juntos por um `on conflict`).
create table if not exists public.blueprint_proposals (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  status                text not null check (status in ('generating','ready','activated')),
  -- Nulo enquanto `generating`: o modelo ainda não respondeu.
  proposal              jsonb,
  -- { "plans": boolean[], "habits": boolean[], "goals": boolean }
  choices               jsonb not null default '{}'::jsonb,
  generation_started_at timestamptz not null default now(),
  generated_at          timestamptz,
  choices_updated_at    timestamptz,
  -- "Agora não — quero explorar primeiro". A proposta CONTINUA guardada: quem
  -- quis olhar antes de ativar é exatamente quem precisa poder voltar a ela.
  dismissed_at          timestamptz,
  activated_at          timestamptz,
  activation_result     jsonb
);

comment on table public.blueprint_proposals is
  'O Blueprint de cada pessoa, guardado até ser usado. Escrita só pela função onboarding-blueprint (service role) e pelas RPCs security definer; a pessoa só lê a própria linha.';

-- ─── 2. O RASTRO ───────────────────────────────────────────────────────
create table if not exists public.blueprint_events (
  id      bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now(),
  kind    text not null check (kind in
            ('generated','resumed','resume_failed','activated','activation_failed','dismissed')),
  detail  jsonb
);
create index if not exists blueprint_events_user_at on public.blueprint_events (user_id, at);

comment on table public.blueprint_events is
  'Rastro do Blueprint para as medidas de docs/medidas.sql: gerado, retomado, retomada que falhou, ativado, ativação que falhou, adiado. Escrita só pelo servidor.';

-- ─── 3. QUEM LÊ E QUEM ESCREVE ─────────────────────────────────────────
-- A pessoa LÊ a própria linha (é assim que o cliente retoma depois de
-- recarregar) e não escreve nada direto: a proposta é o que o modelo
-- escreveu, e as escolhas só valem conferidas contra ela. Escrever passa
-- pelas RPCs abaixo, que validam a forma.
alter table public.blueprint_proposals enable row level security;
alter table public.blueprint_events    enable row level security;

drop policy if exists "blueprint_proposals_select_own" on public.blueprint_proposals;
create policy "blueprint_proposals_select_own" on public.blueprint_proposals
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "blueprint_events_select_own" on public.blueprint_events;
create policy "blueprint_events_select_own" on public.blueprint_events
  for select to authenticated using (user_id = auth.uid());

-- Sem política de escrita, a RLS já recusa. O revoke é a segunda tranca: se um
-- dia alguém criar uma política `for all` por engano, o grant continua
-- dizendo não. `anon` não vê nada.
--
-- `revoke ALL`, e não só insert/update/delete (achado da Aduana, decisão do
-- Maestro em 13/10/2026): no Supabase hospedado os default privileges do
-- schema public dão TUDO a `anon` e `authenticated` em toda tabela nova — e
-- TRUNCATE não passa por RLS. Revogando só as três, `authenticated` continuava
-- podendo `truncate public.blueprint_proposals` e apagar a proposta de TODO
-- MUNDO numa linha. Revoga-se tudo e devolve-se só o `select`. A sequência
-- entra junto: `last_value` diria quantos eventos o produto inteiro já
-- gravou, que é número de negócio, não da pessoa.
revoke all on public.blueprint_proposals, public.blueprint_events from anon, authenticated;
revoke all on sequence public.blueprint_events_id_seq from anon, authenticated;
grant  select on public.blueprint_proposals, public.blueprint_events to authenticated;
-- A função de borda grava com a chave de serviço. Diferente da camada Social
-- (20260918190000), aqui a chave de serviço PRECISA escrever: é ela que guarda
-- o que o modelo devolveu.
grant select, insert, update, delete on public.blueprint_proposals to service_role;
grant select, insert, update, delete on public.blueprint_events    to service_role;
grant usage, select on sequence public.blueprint_events_id_seq to service_role;


-- ─── 4. A REIVINDICAÇÃO ATÔMICA (só a função de borda chama) ───────────
-- Devolve `{ outcome, token }`, decidido DENTRO do banco para que duas abas,
-- dois aparelhos ou um retry do navegador não gerem duas vezes:
--
--   'claimed'    → esta chamada ganhou: gere. `token` identifica ESTA geração.
--   'generating' → outra chamada está gerando agora: espere (202).
--   'ready'      → já existe proposta: retome, sem chamar o modelo.
--   'activated'  → já foi usada.
--   'legacy'     → o carimbo antigo existe mas não há linha: gerado antes desta
--                  migração e já perdido. Mantém o 409 de antes.
--
-- A geração VELHA (≥ p_stale_after_seconds) é de uma função que morreu no meio
-- — relógio de parede do Edge Runtime, worker reciclado. Ela pode ser
-- reivindicada de novo, e o `update … where generation_started_at < …` é
-- atômico por si: sob READ COMMITTED, o segundo update reavalia o WHERE depois
-- que o primeiro confirma, encontra o carimbo novo e não casa.
--
-- O limiar vem da função de borda (um lugar só define "velha"): 420 s. É mais
-- que o teto de relógio de parede das funções de borda pagas do Supabase
-- (400 s), então uma geração VIVA nunca é tomada por morta — a função que
-- passou disso já foi encerrada pela plataforma. Abaixo do teto, uma geração
-- lenta (16.000 tokens de saída) podia ser reivindicada por outra aba no meio
-- do caminho, e a cortesia seria paga duas vezes.
--
-- O TOKEN (revisão da Sentinela, decisão do Maestro, 13/10/2026): o limiar
-- acima do teto garante que nunca haja dois escritores — mas essa garantia mora
-- na PLATAFORMA, não no código. Sem o teto (`supabase functions serve` local,
-- ou um limite que mude), a geração antiga, ao terminar, gravaria por cima da
-- nova ou apagaria a linha dela, casando só por `status = 'generating'`. Com o
-- token, gravar e liberar só alcançam a geração que ESTA chamada reivindicou;
-- a antiga, se acordar, não encontra nada para gravar nem para apagar.
alter table public.blueprint_proposals add column if not exists generation_token uuid;

-- O retorno mudou de `text` para `jsonb` (o token). `create or replace` não
-- troca tipo de retorno; o drop deixa a migração reaplicável.
drop function if exists public.claim_blueprint_generation(uuid, int);
create function public.claim_blueprint_generation(uid uuid, p_stale_after_seconds int default 420)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  carimbo timestamptz;
  ganhou int;
  tok uuid;
begin
  select status, generation_started_at into r
    from public.blueprint_proposals where user_id = uid;

  if found then
    if r.status <> 'generating' then
      return jsonb_build_object('outcome', r.status, 'token', null);
    end if;
    tok := gen_random_uuid();
    update public.blueprint_proposals
       set generation_started_at = now(), generation_token = tok
     where user_id = uid and status = 'generating'
       and generation_started_at < now() - make_interval(secs => p_stale_after_seconds);
    if found then return jsonb_build_object('outcome', 'claimed', 'token', tok); end if;
    return jsonb_build_object('outcome', 'generating', 'token', null);
  end if;

  -- Sem linha. Carimbo antigo preenchido = Blueprint gerado ANTES desta
  -- migração, cuja proposta só existiu no corpo de uma resposta que ninguém
  -- guardou. Não há o que retomar, e gerar de novo daria uma segunda cortesia.
  select blueprint_generated_at into carimbo from public.profiles where user_id = uid;
  if carimbo is not null then
    -- Releitura antes de dizer "legado": se outra chamada confirmou entre o
    -- primeiro select e este, o carimbo dela e a linha dela ficaram visíveis
    -- JUNTOS (mesma transação) — e a resposta certa é a linha, não o 409.
    select status into r from public.blueprint_proposals where user_id = uid;
    if found then return jsonb_build_object('outcome', r.status, 'token', null); end if;
    return jsonb_build_object('outcome', 'legacy', 'token', null);
  end if;

  tok := gen_random_uuid();
  insert into public.blueprint_proposals (user_id, status, generation_token)
  values (uid, 'generating', tok)
  on conflict (user_id) do nothing;
  get diagnostics ganhou = row_count;

  if ganhou > 0 then
    -- O carimbo antigo continua sendo escrito: o retrato do Conselheiro e a
    -- tela Hoje o leem como "a IA rodou" (20260913120000), e ele precisa
    -- continuar significando isso.
    perform public.claim_blueprint(uid);
    return jsonb_build_object('outcome', 'claimed', 'token', tok);
  end if;

  -- Perdeu a corrida para outra chamada que inseriu no mesmo instante: o
  -- `on conflict` esperou ela confirmar. Devolve o que a vencedora deixou.
  select status into r from public.blueprint_proposals where user_id = uid;
  return jsonb_build_object('outcome', coalesce(r.status, 'generating'), 'token', null);
end; $$;

comment on function public.claim_blueprint_generation(uuid, int) is
  'Reivindicação atômica da geração do Blueprint: {outcome: claimed | generating | ready | activated | legacy, token}. O token identifica a geração reivindicada; gravar e liberar filtram por ele. Só a função de borda chama.';

-- A geração falhou: apaga a linha e devolve a cortesia, na MESMA transação.
-- Só apaga a geração DESTA chamada (o token) e enquanto ainda é `generating`
-- — nunca uma proposta pronta, nunca a geração nova de outra chamada.
drop function if exists public.release_blueprint_generation(uuid);
create or replace function public.release_blueprint_generation(uid uuid, p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.blueprint_proposals
   where user_id = uid and status = 'generating' and generation_token = p_token;
  if found then
    update public.profiles set blueprint_generated_at = null where user_id = uid;
  end if;
end; $$;

revoke execute on function public.claim_blueprint_generation(uuid, int)  from public, anon, authenticated;
revoke execute on function public.release_blueprint_generation(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.claim_blueprint_generation(uuid, int)  to service_role;
grant  execute on function public.release_blueprint_generation(uuid, uuid) to service_role;


-- ─── 5. A FORMA DAS ESCOLHAS ───────────────────────────────────────────
-- `{ plans: boolean[], habits: boolean[], goals: boolean }`, com os dois
-- arrays do MESMO tamanho das listas da proposta. Tamanho errado não é
-- detalhe: um array mais curto deixaria o índice i marcar o plano i+1, e a
-- pessoa ativaria um plano que não escolheu.
create or replace function public.blueprint_choices_valid(p_choices jsonb, p_proposal jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
begin
  -- Em passos, e não num `and` só: o SQL não garante a ordem de avaliação, e
  -- `jsonb_object_keys` num número ou `jsonb_array_elements` num objeto
  -- LEVANTAM erro em vez de devolver falso. Forma errada tem de ser "não",
  -- nunca uma exceção que o chamador confunde com falha do banco.
  if jsonb_typeof(p_choices) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_choices)) <> 3 then return false; end if;
  if jsonb_typeof(p_choices->'plans')  is distinct from 'array'
     or jsonb_typeof(p_choices->'habits') is distinct from 'array'
     or jsonb_typeof(p_choices->'goals')  is distinct from 'boolean' then
    return false;
  end if;
  if jsonb_array_length(p_choices->'plans')
       <> jsonb_array_length(coalesce(p_proposal->'plans',  '[]'::jsonb))
     or jsonb_array_length(p_choices->'habits')
       <> jsonb_array_length(coalesce(p_proposal->'habits', '[]'::jsonb)) then
    return false;
  end if;
  return not exists (select 1 from jsonb_array_elements(p_choices->'plans')  e where jsonb_typeof(e) <> 'boolean')
     and not exists (select 1 from jsonb_array_elements(p_choices->'habits') e where jsonb_typeof(e) <> 'boolean');
end; $$;


-- ─── 6. AS RPCs DA PESSOA ──────────────────────────────────────────────

-- Salva as escolhas enquanto a pessoa marca e desmarca (o cliente chama com
-- debounce). É o que faz "recarregar" devolver as MESMAS escolhas, e não as
-- iniciais de novo.
create or replace function public.save_blueprint_choices(p_choices jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r record;
begin
  if uid is null then raise exception 'BLUEPRINT_AUTH: sem sessão' using errcode = '42501'; end if;
  select status, proposal into r from public.blueprint_proposals where user_id = uid for update;
  if not found then raise exception 'BLUEPRINT_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status <> 'ready' then
    raise exception 'BLUEPRINT_NOT_READY: %', r.status using errcode = '55000';
  end if;
  if not public.blueprint_choices_valid(p_choices, r.proposal) then
    raise exception 'BLUEPRINT_CHOICES_INVALID' using errcode = '22023';
  end if;
  update public.blueprint_proposals
     set choices = p_choices, choices_updated_at = now()
   where user_id = uid;
end; $$;

-- "Agora não — quero explorar primeiro". Carimba uma vez (idempotente) e
-- registra uma vez. A proposta NÃO é apagada: a saída precisa ser de verdade,
-- e uma saída que destrói o que a pessoa ganhou não é saída, é punição.
-- Sem linha (o Blueprint local, quando o modelo está desligado) não é erro:
-- não há o que adiar.
create or replace function public.dismiss_blueprint()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'BLUEPRINT_AUTH: sem sessão' using errcode = '42501'; end if;
  update public.blueprint_proposals
     set dismissed_at = now()
   where user_id = uid and dismissed_at is null;
  if found then
    insert into public.blueprint_events (user_id, kind) values (uid, 'dismissed');
  end if;
end; $$;

-- A RETOMADA DE VERDADE NÃO PASSA PELA FUNÇÃO DE BORDA (revisão da
-- Sentinela, decisão do Maestro, 13/10/2026): o Onboarding e a Hoje leem a
-- própria linha direto. Sem este sinal, `resumed` quase nunca era gravado, e
-- a medida "falhou e não voltou" acusava quem voltou pela leitura direta.
--
-- No máximo UM `resumed` por pessoa a cada 30 minutos: a tela chama ao
-- hidratar, e cada recarga hidrata de novo — sem o teto, quem recarrega
-- cinco vezes contaria como cinco retomadas. Só registra quem tem proposta
-- `ready` (é isso que "retomar" quer dizer). O `for update` na linha da
-- pessoa serializa duas abas hidratando juntas: a segunda vê o evento da
-- primeira e não grava outro.
--
-- Uma função interna, porque a função de borda também retoma (o ramo `ready`)
-- e precisa do MESMO teto; a RPC da pessoa só a chama com `auth.uid()`.
create or replace function public.blueprint_register_resumed(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.blueprint_proposals where user_id = uid and status = 'ready' for update;
  if not found then return; end if;
  if exists (select 1 from public.blueprint_events
              where user_id = uid and kind = 'resumed' and at > now() - interval '30 minutes') then
    return;
  end if;
  insert into public.blueprint_events (user_id, kind) values (uid, 'resumed');
end; $$;
revoke execute on function public.blueprint_register_resumed(uuid) from public, anon, authenticated;
grant  execute on function public.blueprint_register_resumed(uuid) to service_role;

create or replace function public.report_blueprint_resumed()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'BLUEPRINT_AUTH: sem sessão' using errcode = '42501'; end if;
  perform public.blueprint_register_resumed(uid);
end; $$;

-- O cliente avisa quando NÃO conseguiu ler a própria proposta (rede, erro do
-- PostgREST). É a única forma de medir a falha que importa: a do lado de lá.
create or replace function public.report_blueprint_resume_failure(p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'BLUEPRINT_AUTH: sem sessão' using errcode = '42501'; end if;
  insert into public.blueprint_events (user_id, kind, detail)
  values (uid, 'resume_failed', jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));
end; $$;


-- ─── 7. A ATIVAÇÃO: TUDO OU NADA, UMA VEZ ──────────────────────────────
--
-- POR QUE OS VALORES VÊM DA PROPOSTA GUARDADA, E NUNCA DO CLIENTE: o cliente
-- manda só QUAIS itens (índices e chaves de meta). O texto do plano, o nome do
-- hábito e o número da meta são os que o modelo escreveu e o servidor validou.
-- Aceitar valores do cliente transformaria esta RPC num jeito de escrever
-- qualquer plano e qualquer meta direto no perfil, por fora das regras.
--
-- POR QUE `for update`: duas abas apertando "Ativar" ao mesmo tempo. A segunda
-- espera a primeira terminar, lê `activated` e devolve `already`. Sem a trava
-- as duas veriam `ready` e aplicariam duas vezes.
--
-- O PLANO QUE NÃO CABE ATIVO VAI GUARDADO, NÃO DESCARTADO (mesma regra do
-- cliente antigo, Onboarding.tsx). O gatilho `enforce_active_plans_cap`
-- (setup.sql, seção 14) recusa com errcode P0001 e mensagem começando por
-- `PLAN_LIMIT_REACHED:` — o mesmo par que `isPlanCapError` (src/lib/fnError.ts)
-- reconhece no cliente. Cada plano tenta numa subtransação própria: o que
-- estoura a cota volta sozinho e é regravado como 'arquivado'; qualquer OUTRO
-- erro sobe e derruba a ativação inteira.
--
-- O RETORNO EM CASO DE FALHA (decisão do Maestro, 13/10/2026): em plpgsql,
-- gravar o evento `activation_failed` e relançar o erro é impossível — o raise
-- desfaz o evento junto. Então o corpo roda num bloco interno; se ele falhar,
-- TUDO o que a tentativa escreveu volta pela subtransação, o evento é gravado
-- fora dela, e a função DEVOLVE `{ok:false, error, message, retryable:true}`
-- em vez de levantar. Erros de quem chama (sem sessão, sem proposta, proposta
-- fora de ready/activated, escolhas com forma errada) continuam levantando e
-- não viram evento: não são falha da ativação, são chamada errada.
create or replace function public.activate_blueprint(p_choices jsonb, p_goal_keys text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r record;
  pl jsonb;
  hb jsonb;
  i int;
  ativados text[] := '{}';
  arquivados text[] := '{}';
  metas text[] := '{}';
  habitos int := 0;
  chaves text[];
  resultado jsonb;
  v_estado text;
  v_msg text;
begin
  if uid is null then raise exception 'BLUEPRINT_AUTH: sem sessão' using errcode = '42501'; end if;

  select status, proposal, activation_result into r
    from public.blueprint_proposals where user_id = uid for update;
  if not found then raise exception 'BLUEPRINT_NOT_FOUND' using errcode = 'P0002'; end if;

  if r.status = 'activated' then
    return coalesce(r.activation_result, '{}'::jsonb) || '{"ok": true, "already": true}'::jsonb;
  end if;
  if r.status <> 'ready' then
    raise exception 'BLUEPRINT_NOT_READY: %', r.status using errcode = '55000';
  end if;
  if not public.blueprint_choices_valid(p_choices, r.proposal) then
    raise exception 'BLUEPRINT_CHOICES_INVALID' using errcode = '22023';
  end if;

  begin
    -- Planos, um a um.
    for i in 0 .. jsonb_array_length(coalesce(r.proposal->'plans', '[]'::jsonb)) - 1 loop
      continue when not (p_choices->'plans'->>i)::boolean;
      pl := r.proposal->'plans'->i;
      begin
        insert into public.plans (user_id, title, kind, pillar, content, origin)
        values (uid, pl->>'title', pl->>'kind', pl->>'pillar', pl->>'content_markdown', 'blueprint');
        ativados := ativados || (pl->>'kind');
      exception when sqlstate 'P0001' then
        if sqlerrm not like 'PLAN_LIMIT_REACHED%' then raise; end if;
        insert into public.plans (user_id, title, kind, pillar, content, origin, status)
        values (uid, pl->>'title', pl->>'kind', pl->>'pillar', pl->>'content_markdown', 'blueprint', 'arquivado');
        arquivados := arquivados || (pl->>'kind');
      end;
    end loop;

    -- Metas: só as chaves pedidas, só as da lista branca, e só as que a
    -- proposta de fato traz. O cliente filtra pelo que a pessoa ACOMPANHA
    -- (meta de água para quem desligou água é cobrança invisível); aqui a
    -- lista branca garante que nenhuma outra coluna do perfil é alcançável.
    if (p_choices->>'goals')::boolean then
      select coalesce(array_agg(k), '{}') into chaves
        from unnest(coalesce(p_goal_keys, '{}')) k
       where k in ('calorie_goal_kcal','protein_goal_g','weekly_workouts_goal',
                   'sleep_goal_h','daily_spend_limit','water_goal_ml')
         and case k
               when 'calorie_goal_kcal'    then r.proposal->>'daily_calories_kcal'
               when 'protein_goal_g'       then r.proposal->>'daily_protein_g'
               when 'weekly_workouts_goal' then r.proposal->>'weekly_workouts'
               when 'sleep_goal_h'         then r.proposal->>'sleep_hours_target'
               when 'daily_spend_limit'    then r.proposal->>'daily_spend_limit'
               when 'water_goal_ml'        then r.proposal->>'water_goal_ml'
             end is not null;
      if cardinality(chaves) > 0 then
        update public.profiles set
          calorie_goal_kcal = case when 'calorie_goal_kcal' = any(chaves)
            then round((r.proposal->>'daily_calories_kcal')::numeric)::int else calorie_goal_kcal end,
          protein_goal_g = case when 'protein_goal_g' = any(chaves)
            then round((r.proposal->>'daily_protein_g')::numeric)::int else protein_goal_g end,
          weekly_workouts_goal = case when 'weekly_workouts_goal' = any(chaves)
            then round((r.proposal->>'weekly_workouts')::numeric)::int else weekly_workouts_goal end,
          sleep_goal_h = case when 'sleep_goal_h' = any(chaves)
            then (r.proposal->>'sleep_hours_target')::numeric else sleep_goal_h end,
          daily_spend_limit = case when 'daily_spend_limit' = any(chaves)
            then (r.proposal->>'daily_spend_limit')::numeric else daily_spend_limit end,
          water_goal_ml = case when 'water_goal_ml' = any(chaves)
            then round((r.proposal->>'water_goal_ml')::numeric)::int else water_goal_ml end
        where user_id = uid;
        metas := chaves;
      end if;
    end if;

    -- Hábitos marcados.
    for i in 0 .. jsonb_array_length(coalesce(r.proposal->'habits', '[]'::jsonb)) - 1 loop
      continue when not (p_choices->'habits'->>i)::boolean;
      hb := r.proposal->'habits'->i;
      insert into public.habits (user_id, name, pillar)
      values (uid, hb->>'name', coalesce(hb->>'pillar', 'vitalidade'));
      habitos := habitos + 1;
    end loop;

    resultado := jsonb_build_object(
      'plans_activated', to_jsonb(ativados),
      'plans_archived',  to_jsonb(arquivados),
      'goals',           to_jsonb(metas),
      'habits',          habitos);

    -- "ATIVEI NADA" NÃO É ATIVAÇÃO — e não pode CONSUMIR a proposta (revisão
    -- da Sentinela, decisão do Maestro, 13/10/2026). Antes, desmarcar tudo e
    -- tocar "Ativar" (ou manter só "metas" sem nenhuma área acompanhada)
    -- virava `activated` com resultado vazio: a Hoje parava de oferecer a
    -- retomada, uma segunda ativação devolvia `already` sem criar nada, e as
    -- escolhas não podiam mais mudar. A mesma perda que esta migração existe
    -- para impedir, por um clique. Agora: nada foi escrito (não houve o que
    -- aplicar), a linha continua `ready`, sem carimbo e sem evento.
    if cardinality(ativados) + cardinality(arquivados) + cardinality(metas) + habitos = 0 then
      return '{"ok": true, "nada": true}'::jsonb;
    end if;

    -- O carimbo da ativação: só chega aqui quem aplicou algo — e é ele que
    -- separa, na Hoje, quem ativou de quem precisa continuar vendo a trilha
    -- de Primeiros Passos (20260913120000).
    update public.profiles set blueprint_activated_at = now() where user_id = uid;

    update public.blueprint_proposals
       set status = 'activated', choices = p_choices,
           activated_at = now(), activation_result = resultado
     where user_id = uid;
    insert into public.blueprint_events (user_id, kind, detail) values (uid, 'activated', resultado);
  exception when others then
    -- Chegando aqui, tudo o que o bloco escreveu já voltou (é uma
    -- subtransação). O evento é gravado FORA dela, e por isso fica.
    get stacked diagnostics v_estado = returned_sqlstate, v_msg = message_text;
    insert into public.blueprint_events (user_id, kind, detail)
    values (uid, 'activation_failed', jsonb_build_object('sqlstate', v_estado, 'message', left(v_msg, 300)));
    return jsonb_build_object('ok', false, 'error', v_estado, 'message', v_msg, 'retryable', true);
  end;

  return resultado || '{"ok": true}'::jsonb;
end; $$;

revoke execute on function public.save_blueprint_choices(jsonb)           from public, anon;
revoke execute on function public.dismiss_blueprint()                     from public, anon;
revoke execute on function public.report_blueprint_resume_failure(text)   from public, anon;
revoke execute on function public.report_blueprint_resumed()              from public, anon;
grant  execute on function public.report_blueprint_resumed()              to authenticated;
revoke execute on function public.activate_blueprint(jsonb, text[])       from public, anon;
grant  execute on function public.save_blueprint_choices(jsonb)           to authenticated;
grant  execute on function public.dismiss_blueprint()                     to authenticated;
grant  execute on function public.report_blueprint_resume_failure(text)   to authenticated;
grant  execute on function public.activate_blueprint(jsonb, text[])       to authenticated;
revoke execute on function public.blueprint_choices_valid(jsonb, jsonb)   from public, anon;
grant  execute on function public.blueprint_choices_valid(jsonb, jsonb)   to authenticated, service_role;
