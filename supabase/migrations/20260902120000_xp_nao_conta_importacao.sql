-- ═══════════════════════════════════════════════════════════════════════
-- XP NÃO É CONCEDIDO POR REGISTRO IMPORTADO
-- Achado P0 do plano refinado (§2.3) — confirmado no código em 02/09/2026.
--
-- O gatilho award_xp_for_event() isentava de XP apenas quando o evento era
-- kind='transaction' E payload->>'tx_source' estava em ('recurring','import').
-- A coluna life_events.source NUNCA era consultada, então sono, treino e peso
-- vindos de importação (source='import') recebiam XP por item.
--
-- Efeito real: importar o histórico de um app de sono (555 noites × 5 XP)
-- daria ~2.775 XP de uma vez, subindo vários níveis sem representar uma única
-- ação vivida dentro do Ascende. Isso contraria PRINCIPIOS.md, onde XP premia
-- ação na vida real — nunca volume de dado.
--
-- O importador do app já grava com source='import' e já anunciava essa regra
-- em comentário; o que faltava era o banco cumprir a promessa.
--
-- O marco único por importação concluída (a recompensa honesta por organizar
-- a própria história) depende da tabela data_sources e entra na Fase 1.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.award_xp_for_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare pts int;
begin
  -- Registro IMPORTADO de qualquer tipo não vale XP por item: a pessoa não
  -- viveu 555 noites agora, ela trouxe um arquivo. Vale para sono, treino,
  -- peso e tudo mais que venha de importação.
  if coalesce(new.source, 'manual') = 'import' then
    return new;
  end if;

  -- Recorrência e importação financeira: mesma regra, pela via do payload
  -- (transações materializadas carregam a origem em tx_source).
  if new.kind = 'transaction'
     and coalesce(new.payload->>'tx_source', 'manual') in ('recurring','import') then
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
