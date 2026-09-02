-- ═══════════════════════════════════════════════════════════════════════
-- FASE 3 — TENDÊNCIAS VERIFICÁVEIS
--
-- A regra de ouro da fase: o modelo explica, o CÓDIGO calcula. Nenhum número
-- que a pessoa lê pode ter saído de um LLM, porque LLM erra diferente a cada
-- vez e esta fase existe para produzir número reproduzível.
--
-- Este arquivo entrega os dois alicerces:
--   1. a view `daily_metrics` — uma linha por (pessoa, DIA LOCAL), que é a
--      entrada do cálculo;
--   2. a tabela `insights` — onde o resultado fica gravado com a VERSÃO da
--      regra que o produziu.
--
-- ─── O DIA É LOCAL, NÃO UTC ────────────────────────────────────────────
-- É o erro clássico daqui, e ele não aparece em teste feito de manhã: um
-- gasto das 22h de São Paulo é 01h do dia seguinte em UTC. Cortar por UTC
-- joga toda noite da pessoa para o dia errado e desalinha os dois lados de
-- uma análise que só faz sentido se estiverem no mesmo dia. Por isso
-- life_events converte com `at time zone 'America/Sao_Paulo'`.
-- transactions.occurred_at já é `date` (o app grava o dia local), então
-- converter ALI seria introduzir o bug em vez de corrigi-lo.
--
-- ─── NULL NÃO É ZERO (a parte mais importante da view) ──────────────────
-- `sleep_hours = null` significa "não mediu"; `food_spend = 0` significa
-- "mediu e deu zero". Colapsar os dois faz o app dizer "você gastou R$ 0 com
-- comida" para quem simplesmente não importou fatura. Aqui:
--   • sono e minutos de treino saem de agregados que devolvem NULL sozinhos
--     quando não há nada para agregar — nenhum coalesce por cima deles;
--   • contagens (treinos, refeições) são count(), que é 0 por natureza;
--   • gastos levam coalesce(...,0) porque o contrato os declara não-nulos.
--     e quem separa "gastou zero" de "não acompanha finanças" é a coluna
--     `has_finance` — leia o comentário dela antes de calcular gasto.
--
-- ─── QUAIS DIAS VIRAM LINHA ────────────────────────────────────────────
-- FULL OUTER JOIN entre o agregado de eventos e o de transações: existe
-- linha para todo dia em que a pessoa registrou QUALQUER coisa, e só para
-- esses. A alternativa (generate_series sobre o intervalo) inventaria linhas
-- para dias sem registro nenhum, e cada uma dessas linhas entraria no cálculo
-- afirmando "gastou 0" sobre um dia em que a pessoa apenas não usou o app —
-- exatamente a mentira que o parágrafo acima existe para impedir.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Número dentro do payload, sem explodir ─────────────────────────────
-- `payload` é jsonb livre, escrito por três caminhos (formulário, captura da
-- IA, importação de CSV). Um `(payload->>'hours')::numeric` direto derruba a
-- view inteira no dia em que algum caminho gravar "7,5" como texto. Esta
-- função devolve NULL no lugar de erro — e NULL aqui quer dizer "não medido",
-- que é a leitura honesta de um valor que não dá para interpretar.
create or replace function public.jsonb_num(p jsonb, key text)
returns numeric language sql immutable as $$
  select case
    when p is null or p -> key is null then null
    when jsonb_typeof(p -> key) = 'number' then (p ->> key)::numeric
    -- Texto numérico ("7.5" ou "7,5", que é como um brasileiro digita).
    when jsonb_typeof(p -> key) = 'string'
      and btrim(p ->> key) ~ '^-?[0-9]+([.,][0-9]+)?$'
      then replace(btrim(p ->> key), ',', '.')::numeric
    else null
  end
$$;

comment on function public.jsonb_num(jsonb, text) is
  'Número de uma chave do payload, ou NULL quando ausente/ilegível (nunca erro).';

-- ─── A VIEW ─────────────────────────────────────────────────────────────
-- security_invoker: roda com as permissões de QUEM CONSULTA, então o RLS de
-- life_events e transactions continua valendo dentro da view. Sem isso ela
-- rodaria como dona das tabelas e viraria vazamento entre contas.
create or replace view public.daily_metrics
  with (security_invoker = true) as
with eventos as (
  select
    user_id,
    (occurred_at at time zone 'America/Sao_Paulo')::date as day,

    -- SONO: só `sleep` (soneca é `nap` e nunca conta como noite — são coisas
    -- com pesos diferentes, e somar as duas inventaria noites de 10h).
    -- Dois registros de sono no mesmo dia costumam ser correção ou duplicata,
    -- então vale o MAIOR: somar produziria 14h de sono numa noite só.
    -- Horas <= 0 são descartadas (não são medida, são lixo de digitação), e
    -- max() sobre nenhum valor devolve NULL sozinho — que é o "não mediu".
    max(public.jsonb_num(payload, 'hours'))
      filter (where kind = 'sleep' and public.jsonb_num(payload, 'hours') > 0) as sleep_hours,

    -- TREINO: minutos somam (duas sessões no mesmo dia são duas sessões), mas
    -- treino sem duração declarada é comum na captura por texto ("treinei
    -- pernas"). Aí `workout_minutes` fica NULL — não mediu a duração — e é
    -- `workout_count` que diz que houve treino. Os dois carregam sinais
    -- diferentes de propósito.
    sum(public.jsonb_num(payload, 'duration_min'))
      filter (where kind = 'workout' and public.jsonb_num(payload, 'duration_min') > 0) as workout_minutes,
    count(*) filter (where kind = 'workout') as workout_count,

    -- REFEIÇÕES: a contagem É o sinal ("nos dias em que você registrou o que
    -- comeu"). Zero aqui quer dizer "não registrou nenhuma", que é justamente
    -- o lado baixo da análise.
    count(*) filter (where kind = 'meal') as meals_logged
  from public.life_events
  group by 1, 2
),
gastos as (
  select
    user_id,
    occurred_at as day,   -- já é `date` no fuso local; NÃO converter
    -- Comida = as duas categorias de comida do app (prosperidade.ts:
    -- CATEGORIES). "Mercado" e "Alimentação fora" são o que a pessoa come;
    -- Lazer e Transporte não entram, mesmo quando envolvem um lanche.
    sum(amount) filter (
      where kind = 'expense' and category in ('Mercado', 'Alimentação fora')
    ) as food_spend,
    -- Gasto total = saída de dinheiro. Entradas (income) não são gasto.
    sum(amount) filter (where kind = 'expense') as total_spend
  from public.transactions
  group by 1, 2
),
dias as (
  select
    coalesce(e.user_id, g.user_id) as user_id,
    coalesce(e.day, g.day)         as day,
    -- Sem coalesce: NULL aqui é informação (não mediu), não ausência a corrigir.
    e.sleep_hours,
    e.workout_minutes,
    -- Contagens: num dia que só teve transação, não houve treino nem refeição
    -- registrada — isso é medido e é zero.
    coalesce(e.workout_count, 0)   as workout_count,
    coalesce(e.meals_logged, 0)    as meals_logged,
    coalesce(g.food_spend, 0)      as food_spend,
    coalesce(g.total_spend, 0)     as total_spend,
    (g.user_id is not null)        as tem_lancamento
  from eventos e
  full outer join gastos g
    on g.user_id = e.user_id and g.day = e.day
)
select
  d.user_id,
  d.day,
  d.sleep_hours,
  d.workout_minutes,
  d.workout_count,
  d.meals_logged,
  d.food_spend,
  d.total_spend,
  -- ─── has_finance: o dia tem cobertura financeira? ───────────────────
  -- Sem esta coluna, `total_spend = 0` é ambíguo, e a ambiguidade produz
  -- tendência falsa: para quem importou fatura só de agosto, julho inteiro
  -- entra no pareamento como uma fileira de zeros que NÃO são gastos zero,
  -- são ausência de dado. Comparar medianas em cima disso "encontra" um
  -- padrão que só existe no buraco — exatamente a mentira que a Fase 3
  -- existe para impedir.
  --
  -- SÃO DUAS COISAS DIFERENTES, e quem vier depois vai querer juntar as
  -- duas em "tem transação no dia". NÃO JUNTE — isso destrói o caso (a):
  --
  -- (a) EXTRATO CONFIRMADO COBRINDO O DIA. A pessoa importou uma fatura
  --     que abrange 01/08 a 31/08 e confirmou. Então, dentro daquele
  --     intervalo, a AUSÊNCIA de lançamento é informação: ela não gastou
  --     naquele dia. É zero medido, e o dia PRECISA entrar no pareamento —
  --     é o dia de gasto zero que carrega o sinal mais forte de todos.
  --     Reduzir has_finance a "tem transação" apagaria justamente esse dia.
  --
  -- (b) LANÇAMENTO NAQUELE DIA. Sem extrato nenhum, um gasto anotado à mão
  --     prova que naquele dia a pessoa estava acompanhando as finanças.
  --     Cobre só o dia dele, e nada diz sobre o dia seguinte.
  --
  -- A cobertura vem de data_sources (proveniência da Fase 1): só fonte de
  -- fatura/extrato CONFIRMADA conta. 'previewed' é prévia que a pessoa
  -- nunca confirmou, e prévia não cobre dia nenhum.
  (
    d.tem_lancamento
    or exists (
      select 1
      from public.data_sources s
      where s.user_id = d.user_id
        and s.kind = 'financial_statement'
        and s.status = 'confirmed'
        and s.period_start is not null
        and s.period_end is not null
        and d.day between s.period_start and s.period_end
    )
  ) as has_finance
from dias d;

grant select on public.daily_metrics to authenticated;

comment on view public.daily_metrics is
  'Uma linha por (user_id, dia local America/Sao_Paulo) para todo dia com algum registro. NULL = não medido; 0 = medido e deu zero (mas só confie no zero de gasto quando has_finance = true).';

-- ─── A TABELA DE INSIGHTS ───────────────────────────────────────────────
-- Guardar o resultado (em vez de recalcular a cada abertura de tela) é o que
-- permite dizer "isto foi calculado em tal dia, com tantos dias de amostra".
-- E `calc_version` é o que impede o passado de ser reescrito em silêncio:
-- mudar a fórmula daqui a seis meses faria a pessoa ver um número diferente
-- do que leu ontem, sem nada explicando por quê.
create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- sono_gasto_seguinte | refeicao_gasto_comida | treino_sono
  kind text not null,
  -- Ex.: 'insights/1'. Parte da identidade do insight, não metadado.
  calc_version text not null,
  period_start date not null,
  period_end date not null,
  -- Dias PAREADOS que entraram na conta (o overlap), não dias do período.
  sample_size int not null default 0,
  -- tendencia | sem_tendencia | dados_insuficientes
  -- "não encontramos padrão" e "faltam dias" são respostas legítimas e
  -- aparecem na tela; sumir com elas seria esconder o que não deu certo.
  status text not null,
  -- Números crus do cálculo (medianas, grupos, diferença relativa): é o que
  -- permite a pessoa conferir a conta, e nós reproduzi-la.
  result jsonb not null default '{}'::jsonb,
  -- Frase pronta, em linguagem de associação (nunca de causa).
  headline text,
  computed_at timestamptz not null default now(),
  -- Fontes (data_sources) que alimentaram o período, quando houver.
  source_ids uuid[] not null default '{}'::uuid[]
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'insights_kind_valido') then
    alter table public.insights add constraint insights_kind_valido
      check (kind in ('sono_gasto_seguinte', 'refeicao_gasto_comida', 'treino_sono'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'insights_status_valido') then
    alter table public.insights add constraint insights_status_valido
      check (status in ('tendencia', 'sem_tendencia', 'dados_insuficientes'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'insights_periodo_coerente') then
    alter table public.insights add constraint insights_periodo_coerente
      check (period_end >= period_start);
  end if;
end $$;

alter table public.insights enable row level security;
drop policy if exists "insights_all_own" on public.insights;
create policy "insights_all_own" on public.insights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Recalcular o MESMO período com a MESMA regra atualiza a linha; não empilha
-- histórico duplicado. É este índice que faz o upsert existir.
create unique index if not exists insights_user_kind_versao_periodo
  on public.insights (user_id, kind, calc_version, period_start, period_end);

-- Leitura da tela: os insights mais recentes da pessoa.
create index if not exists insights_user_time
  on public.insights (user_id, computed_at desc);

-- ═══════════════════════════════════════════════════════════════════════
-- SOBRE `food_spend` / `total_spend` SEREM NÃO-NULOS
--
-- O contrato declara os dois como número ("0 se nenhum"), e a view cumpre —
-- o tipo não muda. O zero, porém, tem dois significados, e quem separa os
-- dois é `has_finance` (comentada em detalhe acima): com cobertura, zero é
-- gasto zero; sem cobertura, zero é ausência de dado e o dia não deveria
-- entrar no pareamento. Quem calcula tem que olhar a coluna.
-- ═══════════════════════════════════════════════════════════════════════
