-- ═══════════════════════════════════════════════════════════════════════
-- FASE 6 — MEDIR E DECIDIR
--
-- A decisão que define esta fase: MEDIR SEM INSTRUMENTAR.
--
-- A Fase 0 tirou o Clarity da área autenticada de propósito, rota a rota. A
-- leitura preguiçosa da Fase 6 seria "agora precisamos medir, então o
-- rastreamento volta". Não volta. Seis das sete medidas já estão nos dados
-- que a própria pessoa gerou — elas se calculam por SQL sobre tabelas que já
-- existem, nada sai para terceiro, nada novo é coletado.
--
-- A sétima ("insights úteis") exige sinal novo, e é honesto que exija:
-- utilidade é juízo da pessoa, e não há como inferir isso sem perguntar. Aí a
-- resposta é uma pergunta na tela, respondida por quem quiser.
--
-- ─── UMA VIEW POR MEDIDA, UMA LINHA POR PESSOA ─────────────────────────
-- Todas com security_invoker = true: rodam com as permissões de quem
-- consulta, então o RLS das tabelas de origem continua valendo e cada pessoa
-- vê só a própria linha. Não existe painel de administrador embutido no app.
--
-- O agregado (mediana por pessoa, quórum, limiares) NÃO mora aqui: mora em
-- docs/medidas.sql, rodado FORA do app por quem tem a chave. É a MESMA view —
-- o service role simplesmente enxerga todas as linhas. Assim não existe uma
-- tela com privilégio embutido esperando o dia do vazamento, nem uma segunda
-- implementação das definições para divergir da primeira.
--
-- As definições vêm de docs/medidas-e-limiares.md. Aqui só se lê UMA pessoa;
-- o quórum (20 pessoas com 7+ dias de conta) é problema do agregado, porque
-- para a pessoa a própria linha vale sempre.
--
-- ─── DEPENDÊNCIAS (ordem de aplicação) ─────────────────────────────────
-- Esta migração LÊ o que as fases anteriores criaram. Aplique nesta ordem:
--   20260902160000 (fontes e recibos)     → medida 2
--   20260903120000 (memória controlável)  → medida 3
--   20260904120000 (agregados/insights)   → medida 4
--   20260905120000 (mokari)               → medida 7
--
-- ─── ATENÇÃO A UMA ARMADILHA QUE ATRAVESSA TUDO ────────────────────────
-- `life_events` tem DUAS datas e elas medem coisas diferentes:
--   • occurred_at = quando aquilo aconteceu NA VIDA da pessoa (pode ser
--     retroativo: importar o Sleep Cycle traz 555 noites de dois anos atrás);
--   • created_at  = quando a pessoa AGIU no app.
-- Toda medida de USO aqui usa `created_at`. Usar occurred_at faria uma única
-- importação apagar dois anos de silêncio de uma vez, e o app diria que a
-- pessoa nunca sumiu — quando na verdade ela só trouxe o passado num arquivo.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── MEDIDA 4: A ÚNICA COLETA NOVA ──────────────────────────────────────
-- "Isso te ajudou?" nos cards de tendência. Uma linha por (pessoa, análise),
-- no máximo três na vida da conta.
--
-- Por que a resposta é ANULÁVEL, e por que existe `asked_at`: o requisito é
-- "pergunte uma vez e não volte a perguntar para quem IGNOROU". Guardar só a
-- resposta cobriria quem responde; quem passa o olho e não toca em nada veria
-- a pergunta de novo na visita seguinte, e uma pergunta educada viraria
-- cobrança. Então a linha registra uma AÇÃO NOSSA ("perguntamos sobre X"),
-- não comportamento dela — mesma classe de `guides_seen`, que já é o padrão
-- da casa para não repetir o que já dissemos. Nada de rolagem, nada de tempo
-- de tela, nada sai para terceiro.
create table if not exists public.insight_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- sono_gasto_seguinte | refeicao_gasto_comida | treino_sono
  kind text not null,
  -- null = perguntamos e ela não respondeu · 'sim' · 'nao'
  answer text,
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  -- Qual insight estava na tela quando perguntamos. ON DELETE SET NULL: a
  -- resposta dela sobrevive ao recálculo que apagar o insight.
  insight_id uuid references public.insights(id) on delete set null,
  -- Estado do card no momento da pergunta ('tendencia' | 'sem_tendencia').
  -- Não dá para derivar depois: o insight é atualizado no lugar a cada
  -- recálculo, e o status de hoje pode não ser o que ela viu. Sem isto, a
  -- medida não distingue "achou útil um padrão" de "achou útil um 'não
  -- encontramos padrão'" — que é justamente a pergunta interessante.
  asked_status text
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'insight_feedback_kind_valido') then
    alter table public.insight_feedback add constraint insight_feedback_kind_valido
      check (kind in ('sono_gasto_seguinte', 'refeicao_gasto_comida', 'treino_sono'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'insight_feedback_answer_valida') then
    alter table public.insight_feedback add constraint insight_feedback_answer_valida
      check (answer is null or answer in ('sim', 'nao'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'insight_feedback_status_valido') then
    alter table public.insight_feedback add constraint insight_feedback_status_valido
      check (asked_status is null or asked_status in ('tendencia', 'sem_tendencia'));
  end if;
end $$;

alter table public.insight_feedback enable row level security;
drop policy if exists "insight_feedback_all_own" on public.insight_feedback;
create policy "insight_feedback_all_own" on public.insight_feedback
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Uma pergunta por análise por pessoa. É este índice que faz "perguntar" ser
-- idempotente: o segundo render não cria linha nova (e, com
-- ignoreDuplicates/DO NOTHING, também não apaga a resposta já dada).
create unique index if not exists insight_feedback_user_kind
  on public.insight_feedback (user_id, kind);

-- ═══════════════════════════════════════════════════════════════════════
-- AS SETE MEDIDAS
--
-- As definições abaixo seguem docs/medidas-e-limiares.md AO PÉ DA LETRA. Se
-- alguém mudar uma regra aqui sem mudar lá (ou o contrário), o número que a
-- pessoa vê na própria tela e o número que decide o roadmap passam a ser
-- coisas diferentes com o mesmo nome — que é o pior resultado possível para
-- uma fase chamada "medir e decidir".
--
-- `drop view if exists` antes de cada uma: `create or replace view` recusa
-- mudança na lista de colunas, e estas vão mudar quando os limiares forem
-- revistos (o documento já marca a primeira releitura para 30 dias depois da
-- 20ª pessoa).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. TEMPO ATÉ O PRIMEIRO VALOR ──────────────────────────────────────
-- T1 = primeiro registro que a PESSOA colocou na própria história, menos o
-- cadastro. Três exclusões que o documento faz questão de nomear:
--   • só `form` e `chat_capture`: evento que o sistema gerou não é valor que
--     ela produziu;
--   • `created_at`, nunca `occurred_at`: importação preenche o passado e
--     daria "primeiro valor" ANTES do cadastro;
--   • evento vindo de importação só conta se a fonte foi CONFIRMADA —
--     confirmar é ato dela, abandonar na prévia não é.
--
-- `signed_up_at` sai de profiles, não de auth.users: o papel `authenticated`
-- não lê auth.users, e uma view security_invoker morreria ali. A linha de
-- profiles nasce no mesmo instante, pelo gatilho handle_new_user().
--
-- `reached_in_24h` existe porque quem NUNCA chega ao primeiro evento não tem
-- T1 e desapareceria da mediana justamente por ser o pior caso.
drop view if exists public.metric_time_to_first_value;
create view public.metric_time_to_first_value
  with (security_invoker = true) as
with first_value as (
  select e.user_id, min(e.created_at) as first_event_at
  from public.life_events e
  left join public.data_sources s on s.id = e.data_source_id
  where e.source in ('form', 'chat_capture')
    and (e.data_source_id is null or s.status = 'confirmed')
  group by e.user_id
)
select
  p.user_id,
  p.created_at as signed_up_at,
  f.first_event_at,
  round(extract(epoch from (f.first_event_at - p.created_at)) / 60.0, 1) as minutes_to_first_value,
  (f.first_event_at is not null
     and f.first_event_at <= p.created_at + interval '24 hours') as reached_in_24h
from public.profiles p
left join first_value f on f.user_id = p.user_id;

grant select on public.metric_time_to_first_value to authenticated;

-- ─── 2. IMPORTAÇÕES COM RECIBO ──────────────────────────────────────────
-- Não é comportamento de usuário: é AUDITORIA da nossa própria promessa. A
-- Fase 1 disse "você vê o que entrou e o que não entrou", e o limiar é 100% —
-- uma única fonte confirmada sem recibo é defeito de correção.
--
-- Denominador: 'confirmed' e 'partial'. 'partial' DENTRO de propósito — é
-- exatamente o caso em que o recibo mais importa, porque é ele que diz o que
-- ficou de fora. 'previewed' fora (prévia abandonada é desistência, e vira o
-- corte secundário `abandoned_previews`), 'failed' fora (falha não promete
-- recibo), 'deleted' fora (ela apagou a trilha, e respeitar isso é o ponto).
drop view if exists public.metric_import_receipts;
create view public.metric_import_receipts
  with (security_invoker = true) as
select
  s.user_id,
  count(*) filter (where s.status in ('confirmed', 'partial'))                    as imports,
  count(*) filter (where s.status in ('confirmed', 'partial') and r.source_id is not null) as with_receipt,
  count(*) filter (where s.status in ('confirmed', 'partial') and r.source_id is null)     as missing_receipt,
  round(
    count(*) filter (where s.status in ('confirmed', 'partial') and r.source_id is not null)::numeric
      / nullif(count(*) filter (where s.status in ('confirmed', 'partial')), 0), 3
  ) as receipt_rate,
  -- Corte secundário do documento: quem cria a fonte e desiste na prévia.
  count(*)                                              as sources_created,
  count(*) filter (where s.status = 'previewed')        as abandoned_previews,
  round(
    count(*) filter (where s.status = 'previewed')::numeric / nullif(count(*), 0), 3
  ) as preview_abandon_rate
from public.data_sources s
left join (select distinct source_id from public.import_receipts) r on r.source_id = s.id
group by s.user_id;

grant select on public.metric_import_receipts to authenticated;

-- ─── 3. MEMÓRIAS CORRIGIDAS ─────────────────────────────────────────────
-- "Corrigida" = memória escrita pela IA que a pessoa JULGOU (confirmou ou
-- rejeitou). Duas taxas, porque respondem perguntas opostas:
--   rejection_rate  = rejeitadas ÷ julgadas   → a memória está errando?
--   correction_rate = julgadas ÷ escritas pela IA → alguém achou o controle?
--
-- 'expirada' fora: pode ter chegado lá sozinha pelo valid_until, sem ninguém
-- julgar nada — contá-la infla a medida com o relógio.
--
-- E o que esta medida NÃO vê, escrito para ninguém "descobrir" em seis meses
-- e achar que o número mentiu: EDITAR o texto de uma memória da IA não muda
-- `created_by` (é assim de propósito), então edição não é detectável hoje.
-- Isto mede confirmar e rejeitar, não editar.
drop view if exists public.metric_memory_control;
create view public.metric_memory_control
  with (security_invoker = true) as
select
  user_id,
  count(*) filter (where created_by = 'ia')                                        as ia_memories,
  count(*) filter (where created_by = 'ia' and status in ('confirmada', 'rejeitada')) as judged,
  count(*) filter (where created_by = 'ia' and status = 'rejeitada')                as rejected,
  count(*) filter (where created_by = 'ia' and status = 'confirmada')               as confirmed,
  round(
    count(*) filter (where created_by = 'ia' and status = 'rejeitada')::numeric
      / nullif(count(*) filter (where created_by = 'ia' and status in ('confirmada', 'rejeitada')), 0), 3
  ) as rejection_rate,
  round(
    count(*) filter (where created_by = 'ia' and status in ('confirmada', 'rejeitada'))::numeric
      / nullif(count(*) filter (where created_by = 'ia'), 0), 3
  ) as correction_rate,
  count(*) filter (where created_by = 'usuario')                                   as written_by_person
from public.ai_memories
group by user_id;

grant select on public.metric_memory_control to authenticated;

-- ─── 4. INSIGHTS ÚTEIS ──────────────────────────────────────────────────
-- Só card de TENDÊNCIA recebe a pergunta: perguntar "isso te ajudou?" sobre
-- um `dados_insuficientes` é perguntar se o silêncio ajudou. Por isso a conta
-- é feita sobre `asked_status = 'tendencia'`, e não sobre tudo.
--
-- A taxa de resposta NÃO é métrica secundária: é a barra de erro da primeira.
-- 40% de utilidade sobre 5 respostas não é 40% de nada. E quem ignorou fica
-- no denominador da resposta e fora do da utilidade — ignorar é dado, não
-- ausência de dado.
--
-- `asked_other_status` denuncia, em vez de esconder, perguntas feitas em
-- cards que não são de tendência: elas não entram na medida, e é melhor a
-- linha aparecer do que o número encolher sem explicação.
drop view if exists public.metric_insight_feedback;
create view public.metric_insight_feedback
  with (security_invoker = true) as
select
  user_id,
  count(*) filter (where asked_status = 'tendencia')                          as asked,
  count(*) filter (where asked_status = 'tendencia' and answer is not null)   as answered,
  count(*) filter (where asked_status = 'tendencia' and answer = 'sim')       as useful,
  count(*) filter (where asked_status = 'tendencia' and answer = 'nao')       as not_useful,
  round(
    count(*) filter (where asked_status = 'tendencia' and answer = 'sim')::numeric
      / nullif(count(*) filter (where asked_status = 'tendencia' and answer is not null), 0), 3
  ) as useful_rate,
  round(
    count(*) filter (where asked_status = 'tendencia' and answer is not null)::numeric
      / nullif(count(*) filter (where asked_status = 'tendencia'), 0), 3
  ) as answer_rate,
  count(*) filter (where asked_status is distinct from 'tendencia')           as asked_other_status
from public.insight_feedback
group by user_id;

grant select on public.metric_insight_feedback to authenticated;

-- ─── 5. CAPTURA VS NAVEGAÇÃO ────────────────────────────────────────────
-- share = chat_capture ÷ (form + chat_capture), por PESSOA. Share global
-- responderia "de onde vêm os eventos"; a pergunta da fase é "como as pessoas
-- escolhem registrar", e essa é por cabeça.
--
-- Evento de importação fora (`data_source_id is not null`): um arquivo não é
-- nem conversa nem formulário, e uma importação grande afogaria a medida.
--
-- ATENÇÃO — DIVERGÊNCIA CONHECIDA: o documento define a conta só com
-- `chat_capture`, e o WhatsApp (`source = 'whatsapp'`) é captura por conversa
-- tanto quanto o chat do app. Seguimos o documento no numerador, mas
-- `by_whatsapp` fica exposto ao lado para a omissão não sumir em silêncio:
-- se houver volume ali, o denominador do documento precisa ser revisto.
drop view if exists public.metric_capture_vs_navigation;
create view public.metric_capture_vs_navigation
  with (security_invoker = true) as
select
  user_id,
  count(*) filter (where source = 'chat_capture')                as by_capture,
  count(*) filter (where source = 'form')                        as by_navigation,
  count(*) filter (where source = 'whatsapp')                    as by_whatsapp,
  count(*) filter (where source in ('form', 'chat_capture'))     as considered,
  round(
    count(*) filter (where source = 'chat_capture')::numeric
      / nullif(count(*) filter (where source in ('form', 'chat_capture')), 0), 3
  ) as capture_share
from public.life_events
where source in ('form', 'chat_capture', 'whatsapp')
  and data_source_id is null
group by user_id;

grant select on public.metric_capture_vs_navigation to authenticated;

-- ─── 6. RETORNO APÓS SILÊNCIO ───────────────────────────────────────────
-- Silêncio = 7 dias sem registrar nada (a cadência do produto é quase
-- diária; uma semana é a menor lacuna que não se explica por fim de semana
-- cheio ou viagem curta).
--
-- A CARÊNCIA DE 14 DIAS é o detalhe que evita a mentira mais fácil desta
-- medida: sem ela, um silêncio ABERTO há 8 dias entraria como "não retornou"
-- e a taxa ficaria artificialmente péssima perto da data da leitura. Só
-- contam silêncios iniciados há 14 dias ou mais — esses já tiveram tempo de
-- terminar.
--
-- E conta nova não tem silêncio, tem começo: um silêncio precisa de um dia
-- ativo para começar, então quem se cadastrou ontem não produz linha alguma.
drop view if exists public.metric_return_after_silence;
create view public.metric_return_after_silence
  with (security_invoker = true) as
with active_days as (
  -- Dia LOCAL de ação no app. `created_at`, não `occurred_at`: importar seis
  -- meses de histórico não é retornar do silêncio, é organizar o passado.
  select distinct
    e.user_id,
    (e.created_at at time zone 'America/Sao_Paulo')::date as day
  from public.life_events e
  where e.source in ('form', 'chat_capture')
),
sequence as (
  select user_id, day, lead(day) over (partition by user_id order by day) as next_day
  from active_days
),
silences as (
  -- Fechado: a pessoa sumiu e VOLTOU.
  select user_id, day as started_on, (next_day - day) as length_days, true as ended
  from sequence
  where next_day is not null and next_day - day >= 7
  union all
  -- Aberto: sumiu e ainda não voltou até a data da leitura.
  select user_id, day, (current_date - day), false
  from sequence
  where next_day is null and current_date - day >= 7
),
per_person as (
  select
    user_id,
    count(*) filter (where started_on <= current_date - 14)              as silences_started,
    count(*) filter (where started_on <= current_date - 14 and ended)    as silences_ended,
    max(length_days) filter (where started_on <= current_date - 14)      as longest_silence_days,
    -- Mediana da DURAÇÃO do silêncio: se eles se concentram em 7-10 dias e as
    -- pessoas voltam, isso é ritmo, não abandono — e o produto não deve
    -- tratar lacuna como falha.
    percentile_cont(0.5) within group (order by length_days)
      filter (where started_on <= current_date - 14)                     as median_silence_days
  from silences
  group by user_id
),
last_seen as (
  select user_id, max(day) as last_active_day, count(*) as active_days from active_days group by user_id
)
select
  p.user_id,
  p.created_at as signed_up_at,
  (current_date - (p.created_at at time zone 'America/Sao_Paulo')::date) as account_age_days,
  coalesce(l.active_days, 0)                          as active_days,
  (current_date - l.last_active_day)                  as days_since_last_activity,
  coalesce(s.silences_started, 0)                     as silences_started,
  coalesce(s.silences_ended, 0)                       as silences_ended,
  coalesce(s.longest_silence_days, 0)                 as longest_silence_days,
  round(s.median_silence_days::numeric, 1)            as median_silence_days,
  round(
    s.silences_ended::numeric / nullif(s.silences_started, 0), 3
  ) as return_rate,
  -- Só entra na medida quem teve ao menos um silêncio que já podia ter
  -- terminado. É o denominador do documento, materializado.
  (coalesce(s.silences_started, 0) > 0)               as eligible_for_silence
from public.profiles p
left join per_person s on s.user_id = p.user_id
left join last_seen l on l.user_id = p.user_id;

grant select on public.metric_return_after_silence to authenticated;

-- ─── 7. REAÇÃO AO COMPANHEIRO ───────────────────────────────────────────
-- Sai do tri-estado do Mokari (Fase 5): `null` FORA do denominador — nunca
-- perguntamos, então não há reação para medir, e contar null como recusa é a
-- forma mais fácil de esta medida mentir.
--
-- VÍCIO CONHECIDO, e está escrito no documento: `false` junta "recusou o
-- convite" e "ligou e desligou depois", que são sinais muito diferentes (o
-- segundo é crítica ao Mokari, o primeiro é desinteresse). Decisão de agora:
-- contar false como recusa e ler a adoção como PISO. Se este número virar
-- decisório, o conserto sem rastreamento novo é um `mokari_disabled_at` — as
-- duas transições são caminhos de escrita diferentes, então se separam sem
-- coletar nada sobre ninguém.
drop view if exists public.metric_companion_reaction;
create view public.metric_companion_reaction
  with (security_invoker = true) as
select
  user_id,
  mokari_enabled,
  case
    when mokari_enabled is null then 'nunca_perguntamos'
    when mokari_enabled then 'ligado'
    else 'recusou'
  end as state,
  (mokari_enabled is not null) as was_asked
from public.profiles;

grant select on public.metric_companion_reaction to authenticated;
