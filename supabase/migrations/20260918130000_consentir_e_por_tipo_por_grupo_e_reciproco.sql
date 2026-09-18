-- ═══════════════════════════════════════════════════════════════════════
-- CONSENTIR É POR TIPO, POR GRUPO — E É RECÍPROCO
--
-- Decisão de fundador: a pessoa libera dado a dado ("treino sim, peso não"), e
-- libera POR GRUPO. Este arquivo é a tradução dessa frase em schema, mais a
-- condição C2 do parecer do Fiel: você só vê de alguém o tipo de dado que você
-- também compartilha com aquele grupo. Sem espectador.
--
-- ─── O CONSENTIMENTO É A PRESENÇA DA LINHA ─────────────────────────────
-- Não existe coluna `enabled`, não existe `revoked_at` na tabela viva.
-- Ligar = INSERT. Desligar = DELETE.
--
-- A razão é a diferença entre um default e uma impossibilidade. Um booleano
-- `default false` depende de TODA política futura lembrar de conferi-lo, e
-- basta uma esquecer para o dado abrir. A ausência de linha não depende de
-- ninguém lembrar de nada: no banco vazio não há o que ler. "Tudo nasce
-- fechado" deixa de ser configuração e vira a única forma possível do estado
-- inicial — que é o teste N1 do parecer ("usuário novo entra num grupo; o
-- grupo vê o nome dele e nada mais") passando por construção.
--
-- A trilha de auditoria fica em `consent_events`, que NUNCA é consultada para
-- decidir acesso. Separar a tabela que audita da tabela que decide é o que
-- permite a segunda não ter estado morto dentro.
--
-- ─── A META MORA JUNTO DO CONSENTIMENTO (achado B2 do parecer) ─────────
-- `goal_value` não é conveniência de UI: é o que impede a comparação absoluta
-- de ficar ASSADA NO SCHEMA. Sem denominador guardado, a única coisa que a
-- tela tem para renderizar é um número solto — e número solto ao lado do
-- número solto de outra pessoa É um ranking, mesmo sem coluna de posição. Com
-- a meta na mesma linha do consentimento, a menor unidade que sai daqui já é
-- "2 de 4": cada um contra a própria régua (condição C3).
--
-- Ela mora AQUI, e não numa tabela irmã, porque meta sem consentimento não faz
-- sentido e consentimento sem meta não deve existir: são a mesma decisão da
-- pessoa ("eu combino X com este grupo"), e separá-las abriria o estado em que
-- uma existe sem a outra.
--
-- ─── O TESTE DO ZERO (a régua do catálogo) ─────────────────────────────
-- No agregado o CONTEÚDO já não existe — o que vaza é sempre a AUSÊNCIA. Por
-- isso a régua não é "quão sensível é o conteúdo", é:
--
--    uma métrica só entra no catálogo se o ZERO dela for uma informação que a
--    pessoa não se importaria de ouvir lida em voz alta pelo grupo.
--
--    "não treinou esta semana"        -> tolerável, entra.
--    "parou de conseguir se olhar"    -> humor, NÃO ENTRA.
--    "se afastou da fé"               -> prática espiritual, NÃO ENTRA.
--    "recaiu"                         -> batalha, NÃO ENTRA.
--    "não subiu na balança"           -> peso, NÃO ENTRA.
--
-- A coluna `o_que_o_zero_diz` é NOT NULL porque quem adicionar uma chave nova é
-- obrigado a escrever essa frase e a ler o que escreveu. O teste vira custo de
-- escrita, não lembrete em documento.
--
-- ─── POR QUE A SEQUÊNCIA SAIU (decisão de fundador, 18/09/2026) ────────
-- `sequencia_dias` era uma sequência PUNITIVA COM PLATEIA, e contradizia uma
-- promessa pública. A sequência PRIVADA do app perdoa um dia de descanso por
-- semana (src/pages/Hoje.tsx), e a /recusas item 3 promete isso em voz alta.
-- A do Social não perdoava nenhum: um dia silencioso quebrava a ilha, e a tela
-- escrevia "sem registro" ao lado do nome da pessoa, para os outros lerem.
--
-- Ou seja: o app afrouxava a régua onde ninguém olha e apertava onde todo
-- mundo olha. É a Micro-incoerência 1 do PRINCIPIOS.md, agora com testemunha —
-- e o tipo de coisa que, notada em público, saca a /recusas inteira.
--
-- Quem quiser constância em grupo tem `dia_inteiro`: soma dias, e não exige
-- que eles sejam seguidos. Somar não tem penhasco; emendar tem.
--
-- ─── A LISTA DO NUNCA, SEM TOGGLE ──────────────────────────────────────
-- Dinheiro, peso e composição corporal, humor, diário, prática espiritual e
-- batalhas não entram — e não entram porque NÃO EXISTE CHAVE PARA ELES, não
-- porque alguma política os recusa. Peso saiu por decisão de fundador
-- (18/09/2026): o Mokari já remove weight e body de TODA conta, inclusive do
-- XP (IGNORED_KINDS, regra 3, com teste), e o Social não pode ser a exceção
-- que desmente a regra; "não subiu na balança esta semana" é frase que alguém
-- usa contra outra pessoa.
--
-- `metric_key` é FK para este catálogo e o catálogo só cresce por migration
-- revisada (zero política de escrita, igual a fn_calls em SEGURANCA.md).
-- Senão 'peso_delta_kg' entra numa terça-feira sem passar por esta mesa.
--
-- ─── PILAR: OS IDS DE HOJE, COM A MESMA TOLERÂNCIA DA FUSÃO ────────────
-- São três pilares (prosperidade, vitalidade, mente) desde 20260917120000;
-- `alimentacao` é valor legado tolerado na LEITURA. Aqui o catálogo nasce
-- depois da fusão, então ele já nasce com os ids de hoje e não precisa de
-- tolerância nenhuma. Quem for ler isto procurando "onde está alimentação":
-- água, refeição e sono são `vitalidade` agora, e a projeção (migration
-- ...140000) filtra por `kind`, NUNCA por `pillar` — o que a torna imune ao
-- valor legado que ainda existir em linhas antigas de life_events.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. O CATÁLOGO ──────────────────────────────────────────────────────

create table if not exists public.shareable_metrics (
  metric_key       text primary key,
  pillar           text not null,
  label            text not null,
  -- Todo ato vale 0 ou 1 no dia; ver comentário em `agregacao`.
  -- Um único valor permitido, e é de propósito: toda métrica compartilhável é
  -- um ATO DO DIA que vale 0 ou 1. O CHECK com uma opção só não é resíduo — é
  -- o que obriga quem quiser uma métrica de CONTAGEM a passar por revisão em
  -- vez de semear a linha e seguir.
  forma            text not null check (forma in ('ato_do_dia')),
  o_que_o_zero_diz text not null,
  ordem            int not null default 0,
  -- ─── A COMPOSIÇÃO MORA AQUI, NÃO NO CÓDIGO ──────────────────────────
  -- Vazio numa métrica FOLHA; as chaves-filhas numa COMPOSTA. Espelha
  -- `composedOf` de src/lib/socialMetrics.ts, e existe porque a alternativa
  -- já cobrou: em 18/09/2026 a lista dos sinais do dia inteiro estava escrita
  -- duas vezes — uma no cliente, outra dentro do plpgsql — e as duas
  -- discordavam (o banco exigia todos os sinais, o cliente exigia três de
  -- quatro). Ninguém errou: as duas frentes foram briefadas diferente. Duas
  -- listas viram duas verdades, e esta é a coluna que faz sobrar uma.
  composed_of      text[] not null default '{}',
  -- O tracker de `src/lib/trackers.ts` que precisa estar LIGADO para este
  -- sinal ser exigível. Null numa métrica composta. É o que faz o
  -- denominador ENCOLHER em vez de reprovar: quem desligou água conta 2 de 3.
  tracker_id       text
);
alter table public.shareable_metrics enable row level security;

comment on table public.shareable_metrics is
  'O que PODE, algum dia, ser compartilhado. Cresce só por migration: sem política de escrita, de propósito.';

comment on column public.shareable_metrics.forma is
  'ato_do_dia: valor 0 ou 1 — "o dia em que você treinou", nunca "quantas vezes". Contagem seria inflável (registrar dez treinos num dia para subir), e o combinado do grupo se conta em DIAS: "quatro treinos por semana" = quatro dias.';

-- A decisão de fundador vira restrição de domínio, não política: o pilar do
-- dinheiro não cabe na tabela. Uma decisão que não cabe no schema é uma
-- decisão que alguém reabre numa sexta-feira.
alter table public.shareable_metrics drop constraint if exists shareable_metrics_nunca_financeiro;
alter table public.shareable_metrics add  constraint shareable_metrics_nunca_financeiro
  check (pillar in ('vitalidade','mente','transversal'));

insert into public.shareable_metrics
  (metric_key, pillar, label, forma, tracker_id, composed_of, o_que_o_zero_diz, ordem) values
  ('treino_registrado',    'vitalidade', 'Treinos',                           'ato_do_dia','workouts', '{}', 'não treinou',              1),
  ('agua_fechada',         'vitalidade', 'Dias com a água em dia',            'ato_do_dia','water',    '{}', 'não registrou água',       2),
  ('refeicao_registrada',  'vitalidade', 'Dias com refeição registrada',      'ato_do_dia','meals',    '{}', 'não registrou refeição',   3),
  ('sono_na_janela',       'vitalidade', 'Noites dentro da janela de sono',   'ato_do_dia','sleep',    '{}', 'não registrou sono',       4),
  ('soneca_registrada',    'vitalidade', 'Sonecas',                           'ato_do_dia','naps',     '{}', 'não registrou soneca',     5),
  ('gratidao_registrada',  'mente',      'Dias com gratidão',                 'ato_do_dia','gratitude','{}', 'não registrou gratidão',   6),
  -- A composta fica numa linha só, e não é estética: o espelho do cliente
  -- (socialCatalogMirror.test.ts) lê a frase do zero pegando o ÚLTIMO literal
  -- da LINHA da chave. Quebrar a linha faz o espelho ler 'ato_do_dia' como se
  -- fosse o que o zero diz, e falhar sem que nada esteja errado.
  ('dia_inteiro',    'transversal','Dias inteiros','ato_do_dia', null, '{treino_registrado,sono_na_janela,refeicao_registrada,agua_fechada}', 'não fechou nenhum dia', 7)
on conflict (metric_key) do update set
  label            = excluded.label,
  tracker_id       = excluded.tracker_id,
  composed_of      = excluded.composed_of,
  o_que_o_zero_diz = excluded.o_que_o_zero_diz;
-- ─── A RETIRADA DE `sequencia_dias` ─────────────────────────────────────
-- Nada disto foi aplicado em produção — este bloco existe para os ambientes de
-- desenvolvimento que já rodaram a versão anterior deste arquivo. A ordem é
-- obrigatória: as duas primeiras tabelas são PROJEÇÃO (derivada, recalculável,
-- não é dado de ninguém); a terceira é consentimento, e apagá-lo dispara o
-- gatilho de despublicação, como qualquer revogação. Só então a chave sai do
-- catálogo, que é para onde as FKs apontam.
do $$
begin
  if exists (select 1 from public.shareable_metrics where metric_key = 'sequencia_dias') then
    delete from public.group_visible_stats  where metric_key = 'sequencia_dias';
    delete from public.shared_daily_stats   where metric_key = 'sequencia_dias';
    delete from public.group_data_consents  where metric_key = 'sequencia_dias';
    delete from public.challenges           where metric_key = 'sequencia_dias';
    delete from public.shareable_metrics    where metric_key = 'sequencia_dias';
  end if;
end $$;

-- A coluna `agregacao` some junto: ela existia SÓ para a sequência. Era ela que
-- devolvia o valor do ÚLTIMO dia da janela, e NULL quando não havia linha nele
-- — o penhasco. Sem a sequência, todo total do ciclo é soma de dias, e soma de
-- dias não tem penhasco: um dia sem registro não derruba os anteriores, apenas
-- não acrescenta.
alter table public.shareable_metrics drop column if exists agregacao;

-- `do update` e não `do nothing`: o catálogo é declaração, e uma migration que
-- corrige uma declaração precisa corrigi-la no banco que já rodou a anterior.
-- As chaves não mudam por aqui (só por migration nova); o que se atualiza é o
-- texto e a composição — exatamente o que divergiu do cliente uma vez.

-- ─── O DENOMINADOR: QUAIS SINAIS ESTA PESSOA ACOMPANHA ──────────────────
--
-- Espelha `activeTrackerSet` de src/lib/trackers.ts, regra por regra:
--   ativo(tracker) = pilarAtivo(tracker.pillar) && prefs[tracker.id] !== false
--
-- Duas sutilezas que vêm de lá e não podem ser "simplificadas" aqui:
--   • `pillars` VAZIO significa TUDO ativo (activePillarSet), não nada ativo.
--     Perfil ainda carregando nunca esconde o app por engano.
--   • `tracking_prefs` só guarda o que foi DESLIGADO: ausência = ligado.
--
-- E a tolerância da fusão de pilares (17/09/2026): quem ainda tem
-- `alimentacao` na lista continua com vitalidade ativa. Valor legado é
-- tolerado na leitura, como no resto da casa.
create or replace function public.tracker_ativo(p_user uuid, p_metric text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (
             coalesce(array_length(p.pillars, 1), 0) = 0
             or m.pillar = 'transversal'
             or m.pillar = any(p.pillars)
             or (m.pillar = 'vitalidade' and 'alimentacao' = any(p.pillars))
           )
           and coalesce((p.tracking_prefs ->> m.tracker_id)::boolean, true)
      from public.profiles p, public.shareable_metrics m
     where p.user_id = p_user and m.metric_key = p_metric
  ), false)
$$;

revoke execute on function public.tracker_ativo(uuid, text) from public, anon;
grant  execute on function public.tracker_ativo(uuid, text) to authenticated;

drop policy if exists "catalogo_leitura" on public.shareable_metrics;
create policy "catalogo_leitura" on public.shareable_metrics for select to authenticated using (true);
-- Nenhuma política de insert/update/delete. Ver comentário de topo.

-- ─── 2. O CONSENTIMENTO ─────────────────────────────────────────────────

create table if not exists public.group_data_consents (
  group_id    uuid not null references public.groups(id) on delete cascade,
  user_id     uuid not null references auth.users(id)    on delete cascade,
  metric_key  text not null references public.shareable_metrics(metric_key),
  -- A meta combinada. Ver comentário de topo (B2).
  goal_value  numeric not null check (goal_value > 0),
  goal_period text not null default 'semana' check (goal_period in ('dia','semana','ciclo')),
  granted_at  timestamptz not null default now(),
  primary key (group_id, user_id, metric_key)
);
create index if not exists gdc_user on public.group_data_consents (user_id);
alter table public.group_data_consents enable row level security;

comment on table public.group_data_consents is
  'A linha EXISTE = está compartilhado. Ligar é insert, desligar é delete. Sem coluna de estado: o fechado é a ausência, não um false que alguém precisa lembrar de conferir.';

create table if not exists public.consent_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Sem FK: a trilha sobrevive ao grupo apagado. Ela responde "o que eu já
  -- liguei na vida", e essa resposta não pode depender do grupo ainda existir.
  group_id   uuid,
  metric_key text not null,
  action     text not null check (action in ('ligou','desligou')),
  at         timestamptz not null default now()
);
create index if not exists consent_events_user on public.consent_events (user_id, at desc);
alter table public.consent_events enable row level security;

-- ─── 3. AS POLÍTICAS ────────────────────────────────────────────────────

-- Membros veem o que cada um liberou NAQUELE grupo. Isso é exigência da
-- reciprocidade (C2): sem enxergar o combinado dos outros, "só vejo o que eu
-- também dou" vira uma regra invisível que a pessoa descobre por ausência.
-- O que se vê aqui é a DECISÃO de compartilhar, nunca o dado.
drop policy if exists "consentimentos_select" on public.group_data_consents;
create policy "consentimentos_select" on public.group_data_consents for select to authenticated
  using (user_id = auth.uid() or public.sou_membro(group_data_consents.group_id));

drop policy if exists "consentimentos_insert_proprio" on public.group_data_consents;
create policy "consentimentos_insert_proprio" on public.group_data_consents for insert to authenticated
  with check (user_id = auth.uid()
              and public.sou_membro(group_data_consents.group_id)
              and public.grupo_vigente(group_data_consents.group_id));

-- Update existe só para a META. O gatilho abaixo impede que ele vire uma porta
-- para reescrever `granted_at` — que é a borda da janela e, portanto, a
-- fronteira do que o grupo pode ver do passado.
drop policy if exists "consentimentos_update_proprio" on public.group_data_consents;
create policy "consentimentos_update_proprio" on public.group_data_consents for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Revogar é sempre da pessoa. Admin não desliga toggle de ninguém.
drop policy if exists "consentimentos_delete_proprio" on public.group_data_consents;
create policy "consentimentos_delete_proprio" on public.group_data_consents for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.consentimento_imutavel_exceto_meta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.granted_at is distinct from old.granted_at then
    raise exception 'granted_at é a borda da janela: não se edita, só se apaga e liga de novo.';
  end if;
  return new;
end $$;

drop trigger if exists trg_consentimento_imutavel on public.group_data_consents;
create trigger trg_consentimento_imutavel before update on public.group_data_consents
  for each row execute function public.consentimento_imutavel_exceto_meta();

-- `granted_at` é a borda da janela, então quem liga não escolhe a data. Sem
-- este gatilho, o insert aceita `granted_at` vindo do cliente, e "ligar hoje
-- não mostra ontem" deixa de ser invariante do banco para virar boa vontade de
-- quem chama. O update já era imutável (gatilho acima); faltava a porta da
-- frente.
create or replace function public.consentimento_comeca_agora()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.granted_at := now();
  return new;
end $$;

drop trigger if exists trg_consentimento_comeca_agora on public.group_data_consents;
create trigger trg_consentimento_comeca_agora before insert on public.group_data_consents
  for each row execute function public.consentimento_comeca_agora();

create or replace function public.registrar_consentimento_ligado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.consent_events (user_id, group_id, metric_key, action)
       values (new.user_id, new.group_id, new.metric_key, 'ligou');
  return new;
end $$;

drop trigger if exists trg_registrar_consentimento_ligado on public.group_data_consents;
create trigger trg_registrar_consentimento_ligado after insert on public.group_data_consents
  for each row execute function public.registrar_consentimento_ligado();
-- O 'desligou' é gravado pelo gatilho de despublicação (migration ...150000),
-- junto com a deleção das linhas — de propósito: as duas coisas são o mesmo
-- ato e não podem acontecer uma sem a outra.

drop policy if exists "trilha_consentimento_propria" on public.consent_events;
create policy "trilha_consentimento_propria" on public.consent_events for select to authenticated
  using (user_id = auth.uid());
-- Sem política de escrita: só os gatilhos gravam.

-- ─── 4. O HELPER DO CONSENTIMENTO ───────────────────────────────────────
--
-- Devolve o primeiro dia em que aquele consentimento vale — ou 'infinity'
-- quando não vale. Nunca null: greatest() ignora null e abriria tudo.
--
-- Guarda de oráculo: só responde sobre grupo em que QUEM PERGUNTA está. Sem
-- isso, qualquer um sondaria "fulano compartilha treino no grupo X?" — e a
-- resposta já é informação sobre fulano.
create or replace function public.consentiu(p_group uuid, p_user uuid, p_metric text)
returns date
language sql stable security definer set search_path = public as $$
  select case
    when not public.sou_membro(p_group) then 'infinity'::date
    else coalesce(
      (select c.granted_at::date from public.group_data_consents c
        where c.group_id = p_group and c.user_id = p_user and c.metric_key = p_metric),
      'infinity'::date
    )
  end
$$;

comment on function public.consentiu(uuid, uuid, text) is
  'Primeiro dia coberto pelo consentimento, ou infinity quando não há. Nunca null — ver janela_de_visao.';

revoke execute on function public.consentiu(uuid, uuid, text) from public, anon;
grant  execute on function public.consentiu(uuid, uuid, text) to authenticated;
