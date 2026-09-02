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
-- ─── POR QUE O RÓTULO DA RECAÍDA NÃO DIZ "RECAÍDA" ───
-- Pagar XP por recaída pode ser lido como "o app me paga para recair". O que
-- é premiado não é a queda, é o ATO DE REGISTRAR — por isso o feed de XP
-- (src/pages/Score.tsx) lê "Honestidade no check-in". E a hierarquia dos
-- números já diz a coisa certa sozinha: 5 < 10 < 12. Resistir vale mais que
-- um dia limpo; um dia limpo vale mais que uma recaída assumida; e sumir,
-- que é a única alternativa real à recaída assumida, vale zero.
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

create unique index if not exists xp_log_battle_checkin_unique
  on public.xp_log (battle_checkin_id)
  where battle_checkin_id is not null;

create or replace function public.award_xp_for_battle_checkin()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pts int;
  label text;
begin
  pts := case new.status
    when 'clean' then 10
    when 'resisted' then 12
    when 'relapsed' then 5
    else 0 end;

  -- Status desconhecido (o CHECK da tabela já impede, mas o gatilho não
  -- inventa pontos por um valor que não conhece).
  if pts = 0 then return new; end if;

  label := case new.status
    when 'clean' then 'Dia limpo na batalha'
    when 'resisted' then 'Resistiu à vontade'
    -- NUNCA "Recaída": o que o XP paga é o registro, não a queda.
    when 'relapsed' then 'Honestidade no check-in'
    end;

  insert into public.xp_log (user_id, points, reason, battle_checkin_id)
  values (new.user_id, pts, label, new.id)
  on conflict (battle_checkin_id) do update
    -- Só sobe. Ver a nota sobre a precondição do Mokari, acima.
    set points = greatest(public.xp_log.points, excluded.points),
        reason = excluded.reason;

  return new;
end; $$;

drop trigger if exists trg_award_xp_battle on public.battle_checkins;
create trigger trg_award_xp_battle after insert or update of status on public.battle_checkins
  for each row execute function public.award_xp_for_battle_checkin();

-- ─── A DÍVIDA ACUMULADA ───
-- Quem já fez check-in antes desta migração fez a ação e não recebeu nada.
-- Pagar retroativamente é o certo: o produto prometeu, a pessoa cumpriu, e o
-- XP nunca desce (a linha só entra onde ainda não existe).
insert into public.xp_log (user_id, points, reason, battle_checkin_id)
select
  c.user_id,
  case c.status when 'clean' then 10 when 'resisted' then 12 when 'relapsed' then 5 end,
  case c.status
    when 'clean' then 'Dia limpo na batalha'
    when 'resisted' then 'Resistiu à vontade'
    when 'relapsed' then 'Honestidade no check-in' end,
  c.id
from public.battle_checkins c
where c.status in ('clean', 'resisted', 'relapsed')
on conflict (battle_checkin_id) do nothing;
