-- ═══════════════════════════════════════════════════════════════════════
-- A COMPRA PARCELADA É UMA COISA SÓ — E O BANCO PRECISA SABER DISSO
--
-- O fundador pediu para registrar compra parcelada à MÃO, contabilizada certo
-- em todos os ciclos. Pela fatura importada isso já funcionava: o servidor
-- expande a compra em todas as parcelas (_shared/lib.ts, normalizeStatementItems).
-- À mão não existia — e o formulário da Prosperidade passa a expandir também.
--
-- ─── POR QUE UMA COLUNA NOVA, E NÃO O TEXTO "3/10" ───
-- Uma compra em 10x vira 10 linhas em `transactions`. Isso é deliberado e está
-- certo: cada linha é dinheiro que sai de verdade naquele ciclo, entra no total
-- do ciclo como qualquer outro gasto e some do ciclo seguinte sozinha. Nenhuma
-- tela precisa aprender um conceito novo.
--
-- O preço são as DEZ linhas na hora de apagar. Se a pessoa toca em apagar numa
-- parcela, o app tem de conseguir perguntar "só esta ou a compra inteira?" — e
-- para isso precisa saber quais linhas são a mesma compra. Sem um vínculo
-- explícito, a única pista é o texto da descrição ("Sofá · 3/10"), e agrupar
-- por texto é chute: dois sofás comprados no mesmo mês, uma descrição editada,
-- um "10/10" digitado à mão por alguém, e o app apaga dinheiro que não devia.
-- Apagar é irreversível; a estrutura que sustenta a pergunta tem de ser dado,
-- não heurística de string.
--
-- Daí `group_id`: um uuid gerado pelo app, igual nas N linhas da mesma compra.
--
-- ─── AS PARCELADAS ANTIGAS FICAM SEM group_id, DE PROPÓSITO ───
-- As que vieram de fatura importada antes desta mudança têm `null`. Não há
-- backfill: qualquer backfill teria de adivinhar o vínculo pelo texto, que é
-- exatamente o que esta coluna existe para não fazer. Nelas o app oferece
-- apenas "apagar esta parcela" — menos poder, nenhum risco de apagar errado.
-- (A expansão da fatura no servidor passar a gravar group_id também é um
-- passo natural e fica anotado como próximo: é uma mudança em
-- supabase/functions/, fora do escopo desta entrega.)
--
-- ─── XP: DEZ LINHAS, UMA AÇÃO, UM XP ───
-- Esta é a consequência que a coluna nova obriga a tratar na mesma migração.
-- `tx_to_life_event` cria um evento por linha e `award_xp_for_event` paga 2 XP
-- por evento de transação. Sem tratamento, registrar uma compra em 24x pagaria
-- 48 XP por um único ato — dez vezes mais que registrar dez compras de verdade,
-- e com um campo de "nº de parcelas" servindo de alavanca para inflar nível.
--
-- O PRINCIPIOS.md §52 é explícito: "XP hoje premia ações na vida real. Se algum
-- dia premiar abrir o app ou tempo de tela, a contradição rica vira incoerência
-- na hora." É a mesma regra que já isenta importação e recorrência de XP por
-- item (migração 20260902120000): o que conta é o ato, não o volume de linhas
-- que o ato produz. Parcelar é UM ato — uma compra.
--
-- Como fica: o evento da transação passa a carregar `tx_group_id` no payload, e
-- o XP só é pago quando nenhum outro evento daquele grupo existe ainda. Os
-- gatilhos são AFTER INSERT FOR EACH ROW, então na inserção em lote a linha 1
-- já tem evento gravado quando a linha 2 dispara — a primeira parcela leva os
-- 2 XP da compra e as demais não levam nada. Não é caso-especial de
-- parcelamento: é a regra "um XP por ato" aplicada a um ato que agora produz
-- várias linhas.
--
-- ─── ORDEM DE DEPLOY ───
-- Esta migração PRIMEIRO, o app depois. O app novo insere `group_id`; contra o
-- banco antigo esse insert falharia por coluna inexistente. O caminho inverso
-- é inofensivo: com a coluna criada e o app antigo no ar, ninguém grava
-- group_id, todo mundo continua com null e nada muda de comportamento.
--
-- O espelho em supabase/setup.sql é feito à parte (o arquivo está sendo
-- editado por outra frente agora; o espelhamento é responsabilidade declarada
-- de quem coordena a branch).
--
-- Idempotente: pode rodar de novo sem estragar nada.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.transactions
  add column if not exists group_id uuid;

comment on column public.transactions.group_id is
  'Compra parcelada registrada à mão: as N linhas da mesma compra compartilham '
  'este uuid. É o ÚNICO vínculo entre elas — nunca agrupar por texto da '
  'descrição. Null em lançamento avulso e nas parceladas importadas antes de '
  '2026-09-14 (sem backfill, de propósito: lá o app só oferece apagar a '
  'parcela em foco).';

-- Um índice por dono: o app busca as irmãs de uma parcela na hora de apagar
-- ("quantas são, quantas já passaram") e apaga a compra inteira por group_id.
-- Parcial porque a esmagadora maioria das linhas é avulsa e tem null aqui.
create index if not exists transactions_user_group
  on public.transactions (user_id, group_id)
  where group_id is not null;

-- ─── O EVENTO PASSA A CARREGAR O GRUPO ──────────────────────────────
-- Única mudança em relação à versão anterior (setup.sql §22.5): `tx_group_id`
-- no payload. O gatilho de XP precisa dele, e a linha do tempo ganha de graça
-- a informação de que aquele lançamento pertence a uma compra maior.
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

-- Sustenta o `exists` do gatilho de XP abaixo. Parcial pelo mesmo motivo do
-- índice em transactions: só eventos de compra parcelada têm a chave.
create index if not exists life_events_tx_group
  on public.life_events (user_id, (payload->>'tx_group_id'))
  where (payload->>'tx_group_id') is not null;

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
