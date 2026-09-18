-- ═══════════════════════════════════════════════════════════════════════
-- O GRUPO LÊ PROJEÇÃO, NUNCA A FONTE
--
-- `life_events`, `transactions`, `habit_logs`, `battles`, `ai_memories` e
-- `chat_messages` NÃO ganham uma única política nova. Nunca. Este arquivo cria
-- a projeção que o Social lê, e o gatilho que a mantém.
--
-- ─── POR QUE NÃO ABRIR A FONTE COM UMA POLÍTICA ────────────────────────
-- O atalho tentador seria:
--
--    create policy "eventos_visiveis_ao_grupo" on public.life_events for select
--    using (compartilha_grupo(user_id) and kind in ('workout','water'));
--
-- Três razões para essa política ser indefensável, nesta ordem:
--
-- 1. RLS NÃO FAZ RECORTE DE COLUNA. Liberar a linha do treino libera o
--    `payload` inteiro — que na captura por IA carrega texto livre que a
--    pessoa escreveu achando que era só dela.
--
-- 2. `kind` É TEXTO LIVRE E A LISTA CRESCE. O dia em que alguém trocar o
--    `in (...)` por `= any(consented_kinds)` — mudança que parece uma
--    generalização inocente — `'transaction'` entra pela porta, e com ele
--    `payload.amount`. Vale lembrar que o dinheiro JÁ MORA em life_events: o
--    gatilho `tx_to_life_event` grava toda transação ali desde o setup. A
--    decisão de fundador sobre o financeiro precisa ser impossível de violar
--    por descuido, não difícil.
--
-- 3. O RECORTE NÃO EXISTE COMO DADO. "Treino sim, peso não" só vira política
--    se houver uma linha cuja IDENTIDADE seja a métrica. Na fonte, a linha é o
--    evento e a métrica está dentro do jsonb. Modelar consentimento contra a
--    fonte é lutar contra a forma do dado — e quem luta contra a forma do dado
--    escreve política longa, e política longa é onde mora o bug.
--
-- Na projeção longa (user, dia, métrica) "desligar peso" é a ausência de uma
-- linha cuja chave primária contém a métrica, e a política cabe em seis linhas
-- legíveis. Esse é o argumento inteiro: escolhemos a forma em que a regra de
-- privacidade é curta.
--
-- ─── SEM UMA ÚNICA COLUNA DE TEXTO ─────────────────────────────────────
-- É a defesa mais forte do modelo, e é estrutural, não política: o diário, a
-- descrição da refeição, a nota do humor e a análise da foto não vazam daqui
-- porque NÃO EXISTE ONDE ELES CABEREM. `value` é numeric. Ponto. Uma política
-- pode ser escrita errado; uma coluna que não existe, não.
--
-- ─── A LINHA É UM FATO, NÃO UMA MEDIDA ─────────────────────────────────
-- Toda métrica de `forma = 'ato_do_dia'` grava `value = 1`, e a linha SÓ
-- EXISTE quando o ato aconteceu. Duas consequências de propósito:
--   • ausência de linha = "não registrou". Não existe `coalesce(value, 0)` em
--     lugar nenhum desta cadeia, e a tela escreve "sem registro", nunca "0".
--     É a doutrina do comentário de `daily_metrics` (NULL não é zero) aplicada
--     onde a mentira teria plateia.
--   • o valor não é inflável. Contagem de sessões deixaria alguém registrar
--     dez treinos num dia para subir; "o dia em que você treinou" não. E o
--     combinado do grupo se conta em dias mesmo: "quatro treinos por semana".
--
-- ─── ALLOWLIST, NUNCA DENYLIST ─────────────────────────────────────────
-- O mapa kind -> metric_key é explícito e fechado, escrito à mão abaixo. Um
-- `kind` novo que apareça no app amanhã não vira métrica compartilhável: ele
-- simplesmente não tem para onde ir. Uma denylist ("todos menos transaction")
-- teria o comportamento oposto — nasce aberto, e alguém precisa lembrar de
-- fechar. Foi assim que o financeiro entraria: não por decisão, por um `kind`
-- novo num sábado.
--
-- Note também: a projeção filtra por `kind`, NUNCA por `pillar`. Isso a torna
-- imune ao valor legado `alimentacao` que ainda existe em linhas antigas (a
-- fusão de pilares de 20260917140000 remapeou o que havia, mas a tolerância
-- na leitura continua sendo a doutrina da casa).
--
-- ─── O QUE A ALLOWLIST DEIXA DE FORA (lista lida, não executada) ───────
-- Ficam de fora, e não por esquecimento: a transação (é dinheiro, e ela mora
-- em life_events desde o setup), o peso e a composição corporal, o humor, o
-- diário, a prática espiritual e o hábito concluído — este último porque um
-- hábito pode ser de batalha, e o Cenário 1 do parecer é exatamente sobre uma
-- recaída vazando dentro de um número agregado.
--
-- Esta lista vive AQUI, no comentário de topo, e não dentro da função: o
-- autoteste 12 verifica que o corpo de `projetar_dia` não menciona nenhum
-- desses kinds, e ele não sabe distinguir uma menção em comentário de uma
-- menção em código. Melhor assim — a verificação fica burra e confiável.
--
-- ─── NÚMEROS COMPOSTOS SÓ COM INSUMO COMPARTILHÁVEL (parecer, N6) ──────
-- `dia_inteiro` é composto, e o Cenário 1 do parecer é exatamente sobre ele:
-- uma "constância" agregada ingenuamente incluiria check-in de batalha e
-- prática espiritual, e uma recaída em apostas viraria uma queda visível no
-- grupo do trabalho.
--
-- A composição NÃO está escrita aqui: ela está em
-- `shareable_metrics.composed_of`, e esta função a LÊ. É a correção de uma
-- divergência real de 18/09/2026 — a lista dos sinais estava escrita duas
-- vezes, uma no cliente e outra dentro deste plpgsql, e as duas discordavam
-- em silêncio. Duas listas viram duas verdades.
--
-- ─── TRÊS DE QUATRO, NUNCA QUATRO DE QUATRO ────────────────────────────
-- O dia inteiro fecha com `exigíveis − 1`, piso em 1. Quatro sinais pedem
-- três; três pedem dois. Duas consequências, e as duas são o ponto:
--   • o dia de descanso continua fechando o dia pelos outros três. A folga é
--     da REGRA, não perdão concedido depois — e é por isso que treino entra
--     na conta em vez de ficar de fora "para não punir quem descansa".
--   • quem desligou um tracker não fica de fora: o denominador ENCOLHE. Quem
--     não acompanha água conta 2 de 3, mesma doutrina de `tracking_prefs`
--     (desligado ≠ reprovado).
-- O piso em 1 cobre o caso degenerado: com um único sinal acompanhado,
-- `exigíveis − 1` seria zero, e um dia sem registro nenhum fecharia o dia —
-- o desafio viraria uma mentira educada.
--
-- O limiar está em src/lib/socialChallenge.ts (`fullDayThreshold`) e aqui, e
-- socialCatalogMirror.test.ts falha alto se os dois descolarem de novo.
--
-- ─── O DIA É LOCAL, E O GATILHO RECALCULA A FATIA ──────────────────────
-- (occurred_at at time zone 'America/Sao_Paulo')::date, igual a
-- `daily_metrics`. Duas definições de "dia" no mesmo banco fariam o grupo
-- discordar do próprio Hoje da pessoa — e ela acreditaria no grupo.
-- O gatilho recalcula (user, dia) INTEIRO em vez de incrementar: incrementar
-- diverge na primeira exclusão, e um agregado que não sabe voltar atrás
-- transforma "apaguei o treino" em "o grupo continua vendo o treino".
--
-- ─── ISTO NÃO GERA XP NEM ENTRA NO SCORE (parecer, C8) ─────────────────
-- Nada aqui escreve em `xp_log` nem em `life_events`. O Social espelha; não
-- pontua. Se algum dia esta função inserir evento, ela vai pagar XP por
-- reflexo e a Micro-incoerência 1 do PRINCIPIOS.md é sacada na hora.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.shared_daily_stats (
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null,
  metric_key  text not null references public.shareable_metrics(metric_key),
  value       numeric not null check (value >= 0),   -- numeric. Nunca texto.
  computed_at timestamptz not null default now(),
  primary key (user_id, day, metric_key)
);
create index if not exists sds_user_day on public.shared_daily_stats (user_id, day desc);
alter table public.shared_daily_stats enable row level security;

comment on table public.shared_daily_stats is
  'Projeção PESSOAL: o que da vida da pessoa poderia, em tese, virar número de grupo. Só o dono lê. O grupo lê group_visible_stats.';

drop policy if exists "projecao_propria" on public.shared_daily_stats;
create policy "projecao_propria" on public.shared_daily_stats for select to authenticated
  using (user_id = auth.uid());
-- Nenhuma política de escrita: só o gatilho definer escreve. E nenhuma
-- política de grupo, nunca: esta tabela é a projeção pessoal.

-- ─── A PROJEÇÃO ─────────────────────────────────────────────────────────

create or replace function public.projetar_dia(p_user uuid, p_day date)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_treino    boolean;
  v_agua      boolean;
  v_refeicao  boolean;
  v_sono      boolean;
  v_soneca    boolean;
  v_gratidao  boolean;
  v_perfil    record;
  v_folhas    jsonb;
  v_exigiveis int := 0;
  v_cumpridos int := 0;
begin
  if p_user is null or p_day is null then return; end if;

  select water_goal_ml, sleep_goal_h, calorie_goal_kcal
    into v_perfil from public.profiles where user_id = p_user;

  -- A ALLOWLIST: seis atos, seis kinds, escritos à mão logo abaixo. Nenhum
  -- outro kind de life_events é consultado — a lista do que fica de fora está
  -- no comentário acima da função, fora do corpo dela de propósito: o
  -- autoteste 12 falha se o CÓDIGO desta função mencionar um kind proibido, e
  -- uma menção em comentário passaria por menção em código.
  select
    bool_or(kind = 'workout'),
    coalesce(v_perfil.water_goal_ml, 0) > 0
      and coalesce(sum(public.jsonb_num(payload,'ml')) filter (where kind = 'water'), 0)
          >= v_perfil.water_goal_ml,
    bool_or(kind = 'meal'),
    v_perfil.sleep_goal_h is not null
      and coalesce(max(public.jsonb_num(payload,'hours')) filter (where kind = 'sleep'), 0)
          >= v_perfil.sleep_goal_h,
    bool_or(kind = 'nap'),
    bool_or(kind = 'gratitude')
  into v_treino, v_agua, v_refeicao, v_sono, v_soneca, v_gratidao
  from public.life_events
  where user_id = p_user
    and (occurred_at at time zone 'America/Sao_Paulo')::date = p_day;

  -- ─── DIA INTEIRO: 3 DE 4, COM A COMPOSIÇÃO VINDA DO CATÁLOGO ────────
  --
  -- `v_folhas` carrega, por chave, o que aconteceu e se a regra daquela folha
  -- era sequer AVALIÁVEL. Avaliável importa: sono só é julgável se a pessoa
  -- declarou `sleep_goal_h`, e água só se há meta de ml. Sem isso, quem
  -- acompanha sono sem ter declarado a janela gastaria a folga do dia todo
  -- santo dia, para sempre, sem entender por quê. Não avaliável sai do
  -- denominador — mesma doutrina de quem desligou o tracker.
  v_folhas := jsonb_build_object(
    'treino_registrado',   jsonb_build_object('fez', coalesce(v_treino,   false), 'avaliavel', true),
    'agua_fechada',        jsonb_build_object('fez', coalesce(v_agua,     false), 'avaliavel', coalesce(v_perfil.water_goal_ml, 0) > 0),
    'refeicao_registrada', jsonb_build_object('fez', coalesce(v_refeicao, false), 'avaliavel', true),
    'sono_na_janela',      jsonb_build_object('fez', coalesce(v_sono,     false), 'avaliavel', v_perfil.sleep_goal_h is not null),
    'soneca_registrada',   jsonb_build_object('fez', coalesce(v_soneca,   false), 'avaliavel', true),
    'gratidao_registrada', jsonb_build_object('fez', coalesce(v_gratidao, false), 'avaliavel', true)
  );

  -- A lista dos sinais vem de composed_of. Se amanhã o dia inteiro passar a
  -- ter cinco sinais, isto aqui não muda — muda o catálogo, num lugar só, por
  -- migration revisada.
  select count(*) filter (where s.exigivel),
         count(*) filter (where s.exigivel and s.fez)
    into v_exigiveis, v_cumpridos
    from (
      select filho.chave,
             public.tracker_ativo(p_user, filho.chave)
               and coalesce((v_folhas -> filho.chave ->> 'avaliavel')::boolean, false) as exigivel,
             coalesce((v_folhas -> filho.chave ->> 'fez')::boolean, false)             as fez
        from public.shareable_metrics m
        cross join lateral unnest(m.composed_of) as filho(chave)
       where m.metric_key = 'dia_inteiro'
    ) s;

  -- Apaga a fatia inteira e reescreve só os fatos verdadeiros. A linha existe
  -- quando o ato aconteceu; a ausência dela é o "não registrou".
  delete from public.shared_daily_stats
   where user_id = p_user and day = p_day;

  insert into public.shared_daily_stats (user_id, day, metric_key, value)
  select p_user, p_day, k, 1 from (values
    ('treino_registrado',   v_treino),
    ('agua_fechada',        v_agua),
    ('refeicao_registrada', v_refeicao),
    ('sono_na_janela',      v_sono),
    ('soneca_registrada',   v_soneca),
    ('gratidao_registrada', v_gratidao),
    -- TRÊS DE QUATRO. `greatest(1, v_exigiveis - 1)` é a folga proporcional,
    -- espelho literal de `fullDayThreshold` no cliente.
    ('dia_inteiro',         v_exigiveis > 0 and v_cumpridos >= greatest(1, v_exigiveis - 1))
  ) as t(k, aconteceu)
  where coalesce(aconteceu, false);

  -- NÃO EXISTE MAIS BLOCO DE SEQUÊNCIA AQUI, e a ausência é a entrega.
  -- `sequencia_dias` saiu do catálogo em 18/09/2026 (decisão de fundador): ela
  -- era uma sequência punitiva com plateia, e a régua privada do app perdoa um
  -- dia de descanso por semana enquanto a do grupo não perdoava nenhum.
  --
  -- O que sumiu junto: as ILHAS de dias consecutivos (dia − row_number), que
  -- existiam só para ela. Eram o motor do penhasco — um dia silencioso não
  -- reduzia o número, zerava a ilha inteira, na frente dos outros. `dia_inteiro`
  -- soma dias e não exige que sejam seguidos: somar não tem penhasco, emendar
  -- tem. Quem for reintroduzir sequência em grupo um dia: o problema não é
  -- calcular, é que a quebra dela é legível por terceiros.
  -- Publicar nos grupos é assunto da migration ...150000. Se ela ainda não
  -- rodou, esta chamada não existe e a projeção fica só pessoal — que é o
  -- estado correto para uma fila de migrations rodando pela metade.
  if to_regprocedure('public.publicar_dia(uuid,date)') is not null then
    execute 'select public.publicar_dia($1,$2)' using p_user, p_day;
  end if;
end $$;

comment on function public.projetar_dia(uuid, date) is
  'Recalcula a fatia (pessoa, dia local) da projeção a partir de life_events, por allowlist de kind. Nunca lê transactions, battles, mood, journal, practice, weight ou body.';

-- ─── O GATILHO ──────────────────────────────────────────────────────────

create or replace function public.life_event_reprojeta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_novo date;
  v_velho date;
begin
  if tg_op in ('INSERT','UPDATE') then
    v_novo := (new.occurred_at at time zone 'America/Sao_Paulo')::date;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    v_velho := (old.occurred_at at time zone 'America/Sao_Paulo')::date;
  end if;

  -- Um evento que mudou de dia sujou os DOIS dias.
  if v_velho is not null then perform public.projetar_dia(coalesce(old.user_id, new.user_id), v_velho); end if;
  if v_novo is not null and v_novo is distinct from v_velho then
    perform public.projetar_dia(new.user_id, v_novo);
  end if;
  return null;
end $$;

drop trigger if exists trg_life_event_reprojeta on public.life_events;
create trigger trg_life_event_reprojeta
  after insert or update or delete on public.life_events
  for each row execute function public.life_event_reprojeta();

revoke execute on function public.projetar_dia(uuid, date) from public, anon, authenticated;
