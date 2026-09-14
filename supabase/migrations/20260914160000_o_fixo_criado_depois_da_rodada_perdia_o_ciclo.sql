-- ═══════════════════════════════════════════════════════════════════════
-- R$ 11.500 DE SALÁRIO QUE NUNCA ENTRARAM, PORQUE A GUARDA ERA DO CICLO
-- E NÃO DO RECORRENTE
--
-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ ORDEM DE DEPLOY: NÃO HÁ. Esta migração pode ir sozinha, a qualquer   │
-- │ momento. O app continua chamando ensure_month_recurrences() pelo     │
-- │ mesmo nome e com a mesma assinatura (src/pages/Prosperidade.tsx),    │
-- │ e nada em src/ lê recurrence_runs nem a tabela nova — conferido por  │
-- │ grep. A cura da dívida roda no fim deste arquivo e não espera        │
-- │ ninguém abrir o app.                                                 │
-- └──────────────────────────────────────────────────────────────────────┘
--
-- ─── O QUE O BANCO DE PRODUÇÃO MOSTROU ───
-- Usuário 4ca6b508:
--   financial_cycle_day = 5
--   recorrente de ENTRADA ativo, day_of_month = 5, criado em 16/07/2026 14:44
--   transações ligadas a esse recorrente: ZERO
--   recurrence_runs: 2026-07 e 2026-09 (agosto não existe)
--
-- Aqui D = 5 e C = 5, ou seja D >= C. A migração anterior
-- (20260914120000_o_fixo_nasce_no_ciclo_da_pessoa.sql) consertou a DATA e a
-- fronteira da guarda, e está certa — mas conserta o caso D < C. O caso dele
-- é outro, e é mais geral.
--
-- ─── A CAUSA ───
-- A guarda registrava um fato errado. `recurrence_runs` diz "o ciclo K rodou
-- para o usuário U" — e a pergunta que importa é outra: "o recorrente R já
-- foi materializado no ciclo K?".
--
-- A corrida sai daí:
--   1. a pessoa abre a Prosperidade  → materializa → grava a guarda do ciclo
--   2. DEPOIS ela cria um recorrente novo
--   3. esse recorrente perdeu o ciclo inteiro, e como a guarda é do CICLO e
--      não dele, não existe segunda chance. Nunca.
--
-- No caso dele isso se empilhou: o salário nasceu em julho DEPOIS da rodada
-- de julho; em agosto não houve rodada nenhuma (ele não abriu a tela); e a
-- rodada de setembro já estava gravada. Três ciclos, zero materializações.
-- A tela dizia "Entradas: R$ 0" e ele concluiu que estava no vermelho.
--
-- O Raio-X compensa isso materializando na hora o que ELE cria
-- (src/pages/Prosperidade.tsx). É remendo de um caminho só: quem criar um
-- recorrente por qualquer outra via cai no mesmo buraco.
--
-- ─── O MODELO NOVO: UM LIVRO-CAIXA DE (RECORRENTE, CICLO) ───
-- `recurrence_materializations` grava uma linha por recorrente por ciclo, no
-- momento em que ele é materializado. A guarda deixa de ser "este ciclo já
-- rodou" e passa a ser "este recorrente já teve a vez dele neste ciclo".
-- Um recorrente criado no meio do ciclo tem direito à chance dele assim que a
-- pessoa abrir a tela, sem esperar o ciclo virar.
--
-- ─── POR QUE UMA TABELA, E NÃO INFERIR PELO QUE ESTÁ EM `transactions` ───
-- Porque a propriedade que precisa sobreviver é "apagou, não volta", e ela é
-- explícita no código desde sempre. O índice único
-- tx_recurring_month_unique só sabe o que EXISTE AGORA: ele não distingue
-- "nunca foi criado" de "foi criado e a pessoa apagou". Inferir pela tabela
-- de transações ressuscitaria, todo mês, exatamente aquilo que a pessoa
-- apagou de propósito.
--
-- Também não dá para usar `life_events` como livro-caixa, e isso foi
-- verificado, não suposto: existe `trg_tx_event_del after delete on
-- public.transactions` (setup.sql), que apaga o life_event junto. Não há
-- hoje NENHUM registro durável do ATO de materializar — é isso que esta
-- tabela passa a ser.
--
-- ─── O QUE ACONTECE COM A GUARDA ANTIGA ───
-- `recurrence_runs` fica, como histórico, e para de ser escrita e lida. Uma
-- linha dela, (U, K, ran_at), significa "a rodada do ciclo K cobriu todos os
-- recorrentes que existiam naquele instante". A tradução para o modelo novo é
-- literalmente isso:
--
--     r.created_at <= run.ran_at
--
-- Um recorrente criado DEPOIS de ran_at não foi coberto por aquela rodada —
-- e fingir que foi seria carimbar a dívida como paga. É por isso que a
-- condição usa ran_at e não a mera existência da linha.
--
-- A imprecisão que sobra, dita com todas as letras: não temos histórico de
-- `active`, então um recorrente que estava INATIVO durante a rodada é tratado
-- como coberto. O efeito prático é nulo para ciclos passados (a função só
-- trabalha no ciclo corrente) e, no limite, erra para o lado de não criar um
-- lançamento que a pessoa não pediu.
--
-- ─── O CICLO CORRENTE É A EXCEÇÃO, DE PROPÓSITO ───
-- A tradução acima NÃO é aplicada ao ciclo corrente de cada pessoa. Se fosse,
-- o caso do fundador continuaria quebrado: a rodada de 2026-09 é posterior à
-- criação do recorrente dele, então ele seria carimbado como materializado —
-- e o salário que nunca entrou ficaria fora para sempre.
--
-- Para o ciclo corrente vale o fato observável (existe ou não existe a linha)
-- em vez de um registro que, no caso dele, comprovadamente discorda da
-- realidade. O preço, que é real e vale dizer: se alguém apagou À MÃO um
-- lançamento materializado DENTRO do ciclo corrente, ele volta uma vez. É um
-- ciclo, uma vez, e a pessoa apaga de novo — contra um salário inteiro que
-- não aparece. A partir do próximo ciclo o livro-caixa manda, e essa
-- ambiguidade não existe mais: ela só existe hoje porque o sistema antigo não
-- guardava o ato.
--
-- ─── COMO A DÍVIDA É PAGA ───
-- Não há um bloco de backfill escrevendo INSERT à mão. A cura no fim deste
-- arquivo chama a MESMA função que o app chama, para cada pessoa com
-- recorrente ativo. Se a regra estiver certa para o app, está certa para a
-- cura; se alguém mudar a regra amanhã, não existe uma segunda cópia para
-- esquecer de mudar junto. É também por isso que a lógica mora em
-- `materialize_recurrences_for(uid)` e o `ensure_month_recurrences()` virou
-- só a casca que lê o auth.uid().
--
-- Idempotente: pode rodar de novo sem estragar nada — o livro-caixa barra.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── O LIVRO-CAIXA ────────────────────────────────────────────────────
-- Uma linha = "este recorrente foi materializado neste ciclo". O ato, não o
-- resultado: a linha fica mesmo que a pessoa apague o lançamento, e é isso
-- que faz "apagou, não volta" continuar verdadeiro.
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

comment on table public.recurrence_runs is
  'HISTÓRICO. Guarda antiga: "o ciclo K rodou para o usuário U". Não é mais '
  'escrita nem lida — registrava o fato errado (o ciclo, não o recorrente), e '
  'por isso um recorrente criado depois da rodada perdia o ciclo inteiro. '
  'Substituída por recurrence_materializations. Ver a migração '
  '20260914160000_o_fixo_criado_depois_da_rodada_perdia_o_ciclo.sql.';

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

-- ═══ TRADUÇÃO DA GUARDA ANTIGA ═══════════════════════════════════════
-- Ver "O QUE ACONTECE COM A GUARDA ANTIGA", no topo. Cada rodada de ciclo
-- vira uma linha por recorrente que JÁ EXISTIA quando ela aconteceu — é isso
-- que preserva "apagou, não volta" para tudo o que o sistema antigo de fato
-- fez. O ciclo CORRENTE de cada pessoa fica de fora de propósito: é lá que
-- mora a dívida, e é o fato observável que manda nele.
insert into public.recurrence_materializations (recurring_id, cycle_key, user_id)
select r.id, run.cycle_key, r.user_id
  from public.recurring_transactions r
  join public.recurrence_runs run on run.user_id = r.user_id
  left join lateral (
    select to_char(
             date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date
               - make_interval(days =>
                   (case when p.financial_cycle_day between 2 and 28
                         then p.financial_cycle_day else 1 end) - 1)),
             'YYYY-MM') as ckey
      from public.profiles p where p.user_id = r.user_id
  ) atual on true
 where r.created_at <= run.ran_at
   and run.cycle_key is distinct from coalesce(
     atual.ckey, to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM'))
on conflict (recurring_id, cycle_key) do nothing;

-- ═══ A DÍVIDA: O CICLO CORRENTE DE QUEM ESTÁ ZERADO ══════════════════
-- A mesma função que o app chama, para cada pessoa com recorrente ativo.
-- Nenhuma cópia da regra, nenhum INSERT à mão aqui.
do $$
declare u uuid; total int := 0; pessoas int := 0;
begin
  for u in select distinct r.user_id from public.recurring_transactions r where r.active loop
    total := total + public.materialize_recurrences_for(u);
    pessoas := pessoas + 1;
  end loop;
  raise notice 'dívida paga: % lançamentos materializados no ciclo corrente, varrendo % pessoas', total, pessoas;
end $$;
