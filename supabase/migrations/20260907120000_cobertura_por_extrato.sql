-- ═══════════════════════════════════════════════════════════════════════
-- AUDITORIA DAS FASES 1–6 — COBERTURA POR EXTRATO
--
-- Correção de uma falha METODOLÓGICA na análise `refeicao_gasto_comida`
-- (Fase 3), da mesma classe do buraco que `has_finance` fechou — e pela
-- mesma porta.
--
-- ─── O PROBLEMA ────────────────────────────────────────────────────────
-- `has_finance` diz "dá para confiar no gasto deste dia" e é verdadeiro em
-- DOIS casos:
--   (a) o dia cai dentro de um extrato CONFIRMADO, ou
--   (b) há pelo menos um lançamento naquele dia.
--
-- O caso (b) resolve o dia de quem lança à mão, e para `sono_gasto_seguinte`
-- ele está certo: o lado esquerdo é o SONO, que em boa parte vem de
-- importação de saúde e não depende de a pessoa abrir o app naquele dia.
--
-- Mas em `refeicao_gasto_comida` os DOIS lados são "ela registrou algo hoje".
-- Sem extrato, um dia só entra na conta se ela lançou um gasto — e nesse dia
-- ela estava com o app aberto, então também registrou a refeição. Nos dias em
-- que não abriu, nenhum dos dois lados existe. A análise então "descobre",
-- com folga acima do limiar de 15%, que quem registra refeição gasta menos
-- com comida — quando o que ela mediu foi apenas: quem abre o app registra as
-- duas coisas.
--
-- É correlação entre um comportamento e ele mesmo, com cara de achado sobre
-- alimentação. Exatamente a mentira que a Fase 3 existe para impedir.
--
-- ─── POR QUE DUAS COLUNAS, E NÃO UMA ───────────────────────────────────
-- A tentação, para quem passar por aqui, vai ser unificar: "se
-- finance_from_statement é mais rigoroso, use só ele". NÃO UNIFIQUE. As duas
-- perguntas são diferentes:
--
--   has_finance             → "o zero de gasto deste dia é medido?"
--   finance_from_statement  → "o gasto deste dia existe INDEPENDENTEMENTE de
--                              ela ter aberto o app?"
--
-- Trocar `has_finance` pela versão rigorosa em toda parte apagaria da conta
-- todo mundo que ainda não importou fatura — inclusive de `sono_gasto_seguinte`,
-- onde o problema não existe. Perder gente da análise por um risco que não se
-- aplica a ela é o erro simétrico.
--
-- Coluna ADITIVA: nada renomeado, nada removido. `create or replace view`
-- sobre a versão anterior continua funcionando porque ela entra no FIM da
-- lista de colunas.
-- ═══════════════════════════════════════════════════════════════════════

create or replace view public.daily_metrics
  with (security_invoker = true) as
with eventos as (
  select
    user_id,
    (occurred_at at time zone 'America/Sao_Paulo')::date as day,
    max(public.jsonb_num(payload, 'hours'))
      filter (where kind = 'sleep' and public.jsonb_num(payload, 'hours') > 0) as sleep_hours,
    sum(public.jsonb_num(payload, 'duration_min'))
      filter (where kind = 'workout' and public.jsonb_num(payload, 'duration_min') > 0) as workout_minutes,
    count(*) filter (where kind = 'workout') as workout_count,
    count(*) filter (where kind = 'meal') as meals_logged
  from public.life_events
  group by 1, 2
),
gastos as (
  select
    user_id,
    occurred_at as day,   -- já é `date` no fuso local; NÃO converter
    sum(amount) filter (
      where kind = 'expense' and category in ('Mercado', 'Alimentação fora')
    ) as food_spend,
    sum(amount) filter (where kind = 'expense') as total_spend
  from public.transactions
  group by 1, 2
),
dias as (
  select
    coalesce(e.user_id, g.user_id) as user_id,
    coalesce(e.day, g.day)         as day,
    e.sleep_hours,
    e.workout_minutes,
    coalesce(e.workout_count, 0)   as workout_count,
    coalesce(e.meals_logged, 0)    as meals_logged,
    coalesce(g.food_spend, 0)      as food_spend,
    coalesce(g.total_spend, 0)     as total_spend,
    (g.user_id is not null)        as tem_lancamento
  from eventos e
  full outer join gastos g
    on g.user_id = e.user_id and g.day = e.day
),
coberto as (
  select
    d.*,
    exists (
      select 1
      from public.data_sources s
      where s.user_id = d.user_id
        and s.kind = 'financial_statement'
        and s.status = 'confirmed'
        and s.period_start is not null
        and s.period_end is not null
        and d.day between s.period_start and s.period_end
    ) as por_extrato
  from dias d
)
select
  c.user_id,
  c.day,
  c.sleep_hours,
  c.workout_minutes,
  c.workout_count,
  c.meals_logged,
  c.food_spend,
  c.total_spend,
  -- O zero de gasto deste dia é medido? (extrato confirmado OU lançamento)
  (c.tem_lancamento or c.por_extrato) as has_finance,
  -- O gasto deste dia existe mesmo que ela não tenha aberto o app hoje?
  -- Só o extrato confirmado responde sim. Ver o cabeçalho deste arquivo.
  c.por_extrato as finance_from_statement
from coberto c;

grant select on public.daily_metrics to authenticated;

comment on view public.daily_metrics is
  'Uma linha por (user_id, dia local America/Sao_Paulo) para todo dia com algum registro. NULL = não medido; 0 = medido e deu zero (mas só confie no zero de gasto quando has_finance = true). finance_from_statement é o critério mais rigoroso: gasto coberto por extrato confirmado, independente de a pessoa ter aberto o app naquele dia.';
