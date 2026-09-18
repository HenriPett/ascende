-- ═══════════════════════════════════════════════════════════════════════
-- O XP DAS BATALHAS ERA PROMETIDO EM QUATRO LUGARES E PAGO EM NENHUM
--
-- Achado da auditoria de motivação. O app diz, em texto, na cara da pessoa:
--
--   src/components/core/BattleCheckin.tsx:21  "Dia limpo registrado. +10 XP"
--   src/components/core/BattleCheckin.tsx:22  "Resistir vale mais. +12 XP"
--   src/components/core/BattleCheckin.tsx:23  "Obrigado pela honestidade (...) +5 XP"
--   src/pages/Batalhas.tsx:242                "vale +12 XP, mais que um dia comum"
--
-- E o caminho de gravação era, inteiro:
--
--   supabase.from("battle_checkins").upsert({...})
--
-- `battle_checkins` não tinha gatilho nenhum (o único gatilho de XP do
-- projeto, trg_award_xp, roda sobre `life_events`), e `xp_log` não tem policy
-- de INSERT de propósito — o cliente não pode nem tentar. Resultado: check-in
-- de batalha valia ZERO. Quem resistiu à vontade às duas da manhã porque o
-- app disse que valia 12 recebia um toast que mentia.
--
-- Isso não é uma melhoria de produto, é uma DÍVIDA. Competência (Deci & Ryan)
-- depende de feedback contingente e confiável; feedback prometido e não
-- entregue não é neutro, ensina que o sistema não sabe o que você fez. E o
-- +5 da honestidade era justamente a peça anti-"que-se-dane" do desenho: é o
-- pagamento por registrar a recaída em vez de sumir.
--
-- ─── POR QUE SÃO DUAS LINHAS DE XP, E NÃO UMA ───
-- Pagar XP por recaída pode ser lido como "o app me paga para recair". A
-- primeira defesa é a hierarquia, e ela já resolve o incentivo: 5 < 10 < 12.
-- Nenhuma estratégia de máximo de XP passa por recair — marcar recaída rende
-- MENOS que marcar dia limpo, e sumir (a única alternativa real à recaída
-- assumida) rende zero.
--
-- Mas um único pagamento de 5 que só acontece no `relapsed` é, na
-- contabilidade, pagamento POR recaída — e chamá-lo de "Honestidade no
-- check-in" seria um eufemismo por cima do SQL. O teste é o do design doc: se
-- a pessoa lesse esta linha, veria `relapsed → 5` e o nome não bateria.
--
-- Por isso o valor é decomposto, com a MESMA matemática:
--   todo check-in, qualquer status → +5  "Honestidade no check-in"
--   status clean                   → +5  "Dia limpo na batalha"
--   status resisted                → +7  "Resistiu à vontade"
-- Totais idênticos (5 / 10 / 12), e agora os 5 são literalmente o pagamento
-- do ATO DE REGISTRAR, uniformes para todo mundo; o excedente é do desfecho.
-- O feed mostra duas linhas num dia limpo e uma num dia de recaída, e nenhuma
-- delas precisa de eufemismo para ser verdadeira.
--
-- ─── POR QUE A CORREÇÃO NUNCA DIMINUI O XP ───
-- O check-in é corrigível ("Corrigir", BattleCheckin.tsx:65) e o upsert cai
-- no ramo de UPDATE. A tentação é recalcular os pontos para o novo status —
-- e isso quebraria duas coisas de uma vez:
--
--   1. src/lib/mokari.ts:241-247 documenta uma PRECONDIÇÃO explícita: "o app
--      nunca escreve XP negativo (...) com contribuições não-negativas o total
--      corrido é monótono, então a marca-d'água É a soma". Baixar os pontos de
--      uma linha existente derruba o total e pode fazer o Mokari REGREDIR de
--      estágio numa borda — e "nunca regride o conquistado" é a regra 1 dele.
--   2. Tirar pontos de quem corrigiu "resisti" para "dia limpo" é punir a
--      honestidade exatamente no pilar em que a honestidade é o produto.
--
-- Por isso `greatest(...)`: a correção pode SUBIR o XP (clean → resisted paga
-- os 2 de diferença) e nunca descê-lo. O rótulo acompanha o status atual, para
-- o feed continuar contando a verdade sobre o que aconteceu.
--
-- ─── UNICIDADE ───
-- Pelo mesmo padrão do `event_id` já existente em xp_log (setup.sql:408-409):
-- uma coluna de referência e um índice único parcial. Sem isso, cada correção
-- criaria uma linha nova e o XP inflaria a cada toque em "Corrigir".
--
-- Idempotente: pode rodar de novo sem estragar nada.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.xp_log
  add column if not exists battle_checkin_id uuid
  references public.battle_checkins(id) on delete cascade;

-- O "slot" é o que permite as DUAS linhas por check-in continuarem
-- identificáveis quando a pessoa corrige o status. Sem ele, a correção de
-- "dia limpo" para "resisti" criaria uma linha nova de desfecho e deixaria a
-- antiga para trás — o XP inflaria a cada toque em "Corrigir".
alter table public.xp_log
  add column if not exists battle_xp_slot text;
do $$ begin
  alter table public.xp_log add constraint xp_log_battle_xp_slot_check
    check (battle_xp_slot is null or battle_xp_slot in ('honestidade', 'desfecho'));
exception when duplicate_object then null; end $$;

create unique index if not exists xp_log_battle_checkin_slot_unique
  on public.xp_log (battle_checkin_id, battle_xp_slot)
  where battle_checkin_id is not null;

create or replace function public.award_xp_for_battle_checkin()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bonus int;
  bonus_label text;
begin
  -- LINHA 1 — o pagamento do ATO DE REGISTRAR. Uniforme para todo status,
  -- inclusive a recaída: é isto que faz o rótulo "Honestidade no check-in"
  -- ser literalmente verdadeiro em vez de um nome gentil sobre outra coisa.
  -- `do nothing`: uma correção não repaga a honestidade já paga.
  insert into public.xp_log (user_id, points, reason, battle_checkin_id, battle_xp_slot)
  values (new.user_id, 5, 'Honestidade no check-in', new.id, 'honestidade')
  -- `where battle_checkin_id is not null` REPETE O PREDICADO do índice
  -- parcial. Sem ele o Postgres não consegue inferir o índice, e o comando
  -- falha em tempo de PLANEJAMENTO — aqui dentro da função, o que quebra o
  -- INSERT em `battle_checkins` inteiro: a pessoa não consegue nem registrar
  -- o check-in. Ver a nota longa mais abaixo.
  on conflict (battle_checkin_id, battle_xp_slot)
    where battle_checkin_id is not null do nothing;

  -- LINHA 2 — o desfecho. A recaída não tem bônus (é o 5 sozinho), e é daí
  -- que sai a hierarquia 5 < 10 < 12.
  bonus := case new.status when 'clean' then 5 when 'resisted' then 7 else 0 end;

  if bonus > 0 then
    bonus_label := case new.status
      when 'clean' then 'Dia limpo na batalha'
      when 'resisted' then 'Resistiu à vontade' end;

    insert into public.xp_log (user_id, points, reason, battle_checkin_id, battle_xp_slot)
    values (new.user_id, bonus, bonus_label, new.id, 'desfecho')
    on conflict (battle_checkin_id, battle_xp_slot)
      where battle_checkin_id is not null do update
      -- Só SOBE. Ver a nota sobre a precondição do Mokari, acima: baixar os
      -- pontos de uma linha existente derrubaria o total corrido e poderia
      -- fazer o Mokari regredir de estágio — e puniria quem corrigiu.
      set points = greatest(xp_log.points, excluded.points),
          reason = excluded.reason;
  else
    -- Correção PARA recaída (ex.: "resisti" virou "recaí"). Os pontos ficam,
    -- pela mesma regra de monotonicidade — mas o rótulo não pode continuar
    -- dizendo "Resistiu à vontade" sobre um dia que a pessoa remarcou. O feed
    -- passa a contar o que de fato aconteceu: os pontos foram MANTIDOS.
    update public.xp_log
       set reason = 'Pontos mantidos de um check-in corrigido'
     where battle_checkin_id = new.id and battle_xp_slot = 'desfecho';
  end if;

  return new;
end; $$;

drop trigger if exists trg_award_xp_battle on public.battle_checkins;
create trigger trg_award_xp_battle after insert or update of status on public.battle_checkins
  for each row execute function public.award_xp_for_battle_checkin();

-- ─── CORREÇÃO DE 18/09/2026: O PREDICADO DO ÍNDICE PARCIAL ───
-- O índice `xp_log_battle_checkin_slot_unique` é PARCIAL (`where
-- battle_checkin_id is not null`, acima). Postgres só infere um índice parcial
-- num ON CONFLICT quando o comando repete o predicado dele — sem isso, o
-- planejador responde "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification" e a migration ABORTA.
--
-- Erro de PLANEJAMENTO, não de dados: não depende de haver linha nenhuma, e
-- portanto esta migration nunca aplicou do zero. Encontrado quando o autoteste
-- de privacidade do Social entrou no CI e a cadeia inteira passou a ser
-- levantada num Postgres limpo a cada push — que é exatamente o tipo de coisa
-- que um CI de banco existe para achar.
--
-- Se o backfill nunca rodou em produção, quem fez check-in antes de 12/09/2026
-- não recebeu o XP retroativo que estas linhas prometem. `do nothing` mantém a
-- reaplicação inofensiva.
-- ─── A DÍVIDA ACUMULADA ───
-- Quem já fez check-in antes desta migração fez a ação e não recebeu nada.
-- Pagar retroativamente é o certo: o produto prometeu, a pessoa cumpriu, e o
-- XP nunca desce (a linha só entra onde ainda não existe).
insert into public.xp_log (user_id, points, reason, battle_checkin_id, battle_xp_slot)
select c.user_id, 5, 'Honestidade no check-in', c.id, 'honestidade'
from public.battle_checkins c
on conflict (battle_checkin_id, battle_xp_slot)
  where battle_checkin_id is not null do nothing;

insert into public.xp_log (user_id, points, reason, battle_checkin_id, battle_xp_slot)
select
  c.user_id,
  case c.status when 'clean' then 5 when 'resisted' then 7 end,
  case c.status when 'clean' then 'Dia limpo na batalha' when 'resisted' then 'Resistiu à vontade' end,
  c.id,
  'desfecho'
from public.battle_checkins c
where c.status in ('clean', 'resisted')
on conflict (battle_checkin_id, battle_xp_slot)
  where battle_checkin_id is not null do nothing;
