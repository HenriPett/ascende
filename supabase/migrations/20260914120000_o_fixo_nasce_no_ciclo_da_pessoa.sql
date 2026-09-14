-- ═══════════════════════════════════════════════════════════════════════
-- O SALÁRIO FIXO NASCIA NO CICLO ERRADO E A TELA DIZIA "ENTRADAS: R$ 0"
--
-- Relato do fundador: "meu salário fixo não entra como entrada naquele
-- ciclo, assim permanecendo 0. Somente entra como entrada na aba Mapa do
-- Mês."
--
-- Isso não é cosmético. O número que ficava zerado é o mais assustador da
-- tela: a pessoa abre o app, lê "Entradas: R$ 0" contra as despesas do mês
-- inteiro e conclui que está no vermelho quando não está. Quem sente esse
-- susto com mais força é exatamente o cliente que o POSICIONAMENTO.md nomeia
-- como alavanca — orçamento apertado, pouca folga para descobrir sozinho que
-- o app está errado. Um número de entrada errado para baixo não assusta: ele
-- muda decisão.
--
-- ─── AS DUAS FRONTEIRAS QUE NÃO SE FALAVAM ───
-- O app tem ciclo financeiro customizável (profiles.financial_cycle_day,
-- 1-28): quem recebe no dia 10 pode dizer que o mês dele vai de 10 a 09.
--
-- A TELA respeita isso. src/lib/prosperidade.ts, cycleKey(iso, cycleDay):
-- joga a data (cycleDay-1) dias para trás e usa o mês em que o ciclo COMEÇOU.
--
-- A MATERIALIZAÇÃO dos fixos não respeitava, nas DUAS pontas:
--   • a data:   make_date(ano, mês CIVIL corrente, r.day_of_month);
--   • a guarda: recurrence_runs.month_key = to_char(sp_today, 'YYYY-MM'),
--               também mês CIVIL.
--
-- Com ciclo C e dia do fixo D, sai isto:
--
--   D < C  →  a linha nasce no dia D do mês civil corrente, e cycleKey joga
--             essa data para TRÁS: ela cai no ciclo ANTERIOR. O ciclo corrente
--             fica com 0 de entrada. Exemplo real: C=10, D=5, hoje 14/09. A
--             linha está em 05/09, que pertence ao ciclo 10/08–09/09. O ciclo
--             corrente (10/09–09/10) não tem entrada nenhuma.
--
--   e a guarda por mês civil garante que isso NÃO se conserta sozinho: o
--   ciclo novo começa no dia 10, mas o mês civil '2026-09' já rodou no dia 1º,
--   então abrir o app no dia 10 não materializa nada. A entrada só aparece
--   em 1º de outubro — 21 dias depois — quando o mês civil vira. Com
--   cycleDay != 1 as duas fronteiras nunca se alinham.
--
-- ─── POR QUE O "MAPA DO MÊS" MOSTRAVA, E ISSO CONFIRMA O DIAGNÓSTICO ───
-- O detalhe do relato ("somente entra no Mapa do Mês") é a prova de que o
-- problema é de DATA, não de valor. O Mapa do Mês não soma transações: ele usa
-- `incomeExpected = max(renda declarada, entradas reais)` (prosperidade.ts,
-- buildMonthMap). A renda declarada vem do perfil e não tem data nenhuma —
-- por isso continuava certa. O card "Entradas" soma transações reais dentro do
-- ciclo, e era esse que zerava. Mesmo salário, duas respostas: a que depende
-- de data estava errada.
--
-- ─── QUE DATA A LINHA PASSA A RECEBER ───
-- O ciclo corrente é [C do mês M, C do mês M+1 menos um dia]. Dentro dessa
-- janela existe EXATAMENTE UMA ocorrência do dia D — e é isso que torna a
-- regra bem definida, sem escolha arbitrária:
--
--   D >= C  →  D do mês M          (ex.: C=10, D=25 → 25/09 no ciclo de set)
--   D <  C  →  D do mês M+1        (ex.: C=10, D=5  → 05/10 no ciclo de set)
--
-- O caso D < C é o conserto: datar a linha em 05/09 seria datá-la num dia que
-- JÁ PERTENCE ao ciclo anterior — é literalmente o bug. A ocorrência do dia 5
-- que cai dentro do ciclo 10/09–09/10 é a de OUTUBRO, e é ela que a pessoa vai
-- receber nesse ciclo.
--
-- A objeção previsível é "mas 05/10 é uma data futura". Ela não se sustenta,
-- porque materializar no futuro já é o comportamento de hoje: a função roda no
-- dia 1º e cria o mês inteiro, inclusive o fixo do dia 25, que também ainda
-- não aconteceu. A mudança não inventa datas futuras — ela apenas mede o
-- futuro no calendário DA PESSOA em vez de no calendário civil.
--
-- ─── A GUARDA ───
-- `recurrence_runs.month_key` vira `cycle_key`, e o valor passa a ser a chave
-- do CICLO. A conta é a MESMA de cycleKey() no prosperidade.ts (subtrair
-- cycleDay-1 dias e pegar o mês), de propósito: se as duas divergirem, a linha
-- nasce num balde e a tela procura noutro, que é o bug de origem.
-- O nome da coluna importa — foi "month_key" que convenceu quem escreveu a
-- função de que pensar em mês civil estava certo.
--
-- ─── QUEM TEM cycleDay 1 OU NULO NÃO VÊ DIFERENÇA NENHUMA ───
-- É a regra que o próprio prosperidade.ts declara ("cycleDay ausente/1 é
-- IDÊNTICO ao comportamento anterior"). Com C=1:
--   • cycle_start = primeiro dia do mês civil, logo cycle_key = to_char(hoje,
--     'YYYY-MM') — byte a byte o que a guarda antiga computava;
--   • D >= 1 sempre, então a data é primeiro-do-mês + (D-1) = make_date(ano,
--     mês, D) — exatamente a expressão antiga.
-- Não é "quase igual": é a mesma aritmética. Provado em
-- src/lib/cicloRecorrencias.test.ts, com C e D varridos de 1 a 28.
--
-- ─── O ÍNDICE ÚNICO CONTINUA SERVINDO ───
-- tx_recurring_month_unique é (recurring_id, mês civil de occurred_at). Para
-- um par (C, D) fixo, ciclos consecutivos produzem meses civis consecutivos na
-- data materializada — a correspondência ciclo↔mês-civil-da-ocorrência é 1
-- para 1, então o índice continua sendo exatamente "uma linha por ciclo".
-- Onde ele deixa de ser exato é se a pessoa MUDAR o cycleDay no meio do
-- caminho: dois ciclos podem então mapear para o mesmo mês civil. O índice
-- barra a segunda inserção, que é o lado seguro do erro (não duplica dinheiro
-- na tela de quem já tem a linha certa).
--
-- ─── A DÍVIDA JÁ EXISTENTE ───
-- Quem está com o ciclo zerado HOJE não pode ter que esperar o mês virar para
-- ver o salário. O bloco no fim deste arquivo materializa, de uma vez, a
-- ocorrência do ciclo corrente para os fixos com D < C.
--
-- Por que ele NÃO pode ressuscitar um lançamento que a pessoa apagou — a
-- promessa explícita do ledger ("a exclusão da pessoa é respeitada"): o
-- recorte é exatamente D < C, e para esse caso a data correta cai no mês civil
-- SEGUINTE, que a função antiga nunca produziu. Essa linha nunca existiu na
-- conta de ninguém; não há o que ressuscitar. Os fixos com D >= C ficam de
-- fora justamente porque para eles a linha já existe — e se não existe, foi
-- porque a pessoa apagou.
--
-- ─── ORDEM DE DEPLOY: NÃO HÁ ───
-- Nada no app precisa subir junto. O front chama a função pelo mesmo nome
-- (supabase.rpc("ensure_month_recurrences"), em src/pages/Prosperidade.tsx) e
-- não lê `recurrence_runs` em lugar nenhum — conferido por grep em src/ e
-- supabase/. Esta migração pode ir sozinha, em qualquer momento.
--
-- Idempotente: pode rodar de novo sem estragar nada.
-- ═══════════════════════════════════════════════════════════════════════

-- O nome era metade do erro. Renomear é seguro: nada fora do setup.sql lê
-- esta coluna (nem o app, nem outra função).
do $$ begin
  alter table public.recurrence_runs rename column month_key to cycle_key;
exception when undefined_column then null; end $$;

comment on column public.recurrence_runs.cycle_key is
  'Chave do CICLO financeiro da pessoa (mês em que o ciclo começou, YYYY-MM, '
  'fuso America/Sao_Paulo). Com financial_cycle_day nulo ou 1 é idêntica ao '
  'mês civil. Mesma conta de cycleKey() em src/lib/prosperidade.ts.';

create or replace function public.ensure_month_recurrences()
returns int language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  sp_today date := (now() at time zone 'America/Sao_Paulo')::date;
  cday int;
  cycle_start date;
  ckey text;
  inserted int := 0;
begin
  if uid is null then return 0; end if;

  -- Mesmo clamp de clampCycleDay() no prosperidade.ts: fora de 2..28 (ou
  -- nulo, ou perfil ausente) é mês civil. A coluna não tem CHECK de propósito
  -- (ver seção 31 do setup.sql), então a defesa é aqui.
  select case when p.financial_cycle_day between 2 and 28 then p.financial_cycle_day else 1 end
    into cday from public.profiles p where p.user_id = uid;
  cday := coalesce(cday, 1);

  -- Primeiro dia do ciclo CORRENTE. Subtrair (cday-1) dias e truncar no mês é
  -- a mesma conta de cycleKey(); com cday=1 devolve o primeiro dia do mês.
  cycle_start := date_trunc('month', sp_today - make_interval(days => cday - 1))::date + (cday - 1);
  ckey := to_char(cycle_start, 'YYYY-MM');

  -- Já rodou ESTE CICLO? Então a palavra final é da pessoa (exclusões valem).
  if exists (select 1 from public.recurrence_runs where user_id = uid and cycle_key = ckey) then
    return 0;
  end if;

  insert into public.transactions (user_id, kind, amount, category, description, occurred_at, source, recurring_id)
  select r.user_id, r.kind, r.amount, r.category,
         coalesce(r.description, r.category),
         -- A única ocorrência do dia D dentro do ciclo corrente: a deste mês
         -- quando D >= C, a do mês seguinte quando D < C (senão a linha cairia
         -- no ciclo anterior — o bug). day_of_month é 1..28 por CHECK, então
         -- não existe mês curto para tratar aqui.
         (date_trunc('month', cycle_start)
            + case when r.day_of_month >= cday then interval '0' else interval '1 month' end)::date
           + (r.day_of_month - 1),
         'recurring', r.id
  from public.recurring_transactions r
  where r.user_id = uid and r.active
  on conflict (recurring_id, (date_trunc('month', occurred_at::timestamp)))
    where recurring_id is not null do nothing;
  get diagnostics inserted = row_count;

  insert into public.recurrence_runs (user_id, cycle_key) values (uid, ckey)
  on conflict (user_id, cycle_key) do nothing;

  return inserted;
end; $$;
grant execute on function public.ensure_month_recurrences() to authenticated;

-- ═══ A DÍVIDA: O CICLO ZERADO DE HOJE ════════════════════════════════
-- Ver "A DÍVIDA JÁ EXISTENTE", no topo. Recorte deliberadamente estreito:
-- só quem tem ciclo customizado (2..28) e só os fixos com D < C, que são os
-- únicos cuja linha do ciclo corrente a função antiga era incapaz de criar.
-- `on conflict do nothing` no mesmo índice da função: quem já estiver certo
-- não ganha linha nenhuma.
--
-- Não escrevemos nada em recurrence_runs aqui de propósito. Se a pessoa ainda
-- não abriu o app neste ciclo, a função roda normalmente depois e não acha
-- nada para inserir (o índice barra); se já abriu, a linha de ledger velha
-- continua barrando a função — e é justamente por isso que esta dívida
-- precisava ser paga aqui, e não esperada.
do $$
declare curadas int;
begin
  with hoje as (
    select (now() at time zone 'America/Sao_Paulo')::date as d
  ),
  ciclos as (
    select p.user_id,
           p.financial_cycle_day as cday,
           date_trunc('month', h.d - make_interval(days => p.financial_cycle_day - 1))::date
             + (p.financial_cycle_day - 1) as cycle_start
      from public.profiles p cross join hoje h
     where p.financial_cycle_day between 2 and 28
  )
  insert into public.transactions (user_id, kind, amount, category, description, occurred_at, source, recurring_id)
  select r.user_id, r.kind, r.amount, r.category,
         coalesce(r.description, r.category),
         (date_trunc('month', c.cycle_start) + interval '1 month')::date + (r.day_of_month - 1),
         'recurring', r.id
    from public.recurring_transactions r
    join ciclos c on c.user_id = r.user_id
   where r.active
     and r.day_of_month < c.cday
  on conflict (recurring_id, (date_trunc('month', occurred_at::timestamp)))
    where recurring_id is not null do nothing;
  get diagnostics curadas = row_count;
  raise notice 'fixos materializados no ciclo corrente (dívida paga): %', curadas;
end $$;
