-- ═══════════════════════════════════════════════════════════════════════
-- O GRUPO VIA O ATO, MAS NUNCA A CONTA
--
-- O fundador pediu quatro coisas na tela do Social: números por pessoa
-- ("0/6", "1/6"), número no feed, progresso de peso, e a página se atualizando
-- sozinha. Três entram aqui. Uma não entra nunca — e está escrito abaixo por quê.
--
-- ─── O QUE FALTAVA, EXATAMENTE ─────────────────────────────────────────
-- `v_grupo_hoje` JÁ devolve `label`, `value` e `goal_value`; o front só não
-- selecionava. Mas `value` é FLAG DO DIA (sempre 1) e `goal_value` é a meta
-- SEMANAL. Renderizar "1 de 6" a partir dessa linha escreveria `1` todo dia:
-- o banco certo e o produto mentindo, com plateia (condição bloqueante do
-- parecer do Fiel, seção A). O numerador semanal NÃO EXISTE fora de desafio.
-- É ele que esta migration constrói.
--
-- ─── POR QUE O AGREGADO É `security definer` E A VIEW NÃO É FRONTEIRA ──
-- A política de `group_visible_stats` corta a linha de TERCEIRO em
-- `day >= current_date - 1`. Isso é de propósito: a série diária de outra
-- pessoa (o calendário de bolinhas) não tem endpoint neste banco e não vai ter.
-- A consequência é que NENHUMA view com `security_invoker = true` consegue
-- contar uma semana alheia — ela leria 2 dias, somaria 2, e devolveria um
-- número errado SEM ERRO NENHUM. O pior tipo de bug: silencioso e com plateia.
--
-- Então a casa já resolveu isto uma vez, em `total_do_ciclo`: o AGREGADO é
-- permitido onde a SÉRIE que o compõe não é, e quem sustenta essa assimetria é
-- uma função `security definer` que devolve UM número e nunca os dias.
-- `total_da_semana` é o irmão dela fora de desafio, e `v_grupo_semana` é a
-- view boba por cima. Dito sem rodeio: A VIEW NÃO É A FRONTEIRA, A FUNÇÃO É.
-- Quem editar `total_da_semana` está editando RLS.
--
-- ─── PESO: NÃO. NEM COMO "PROGRESSO PARA A META" ───────────────────────
-- Pedido 3 do fundador, negado por duas razões independentes que chegaram ao
-- mesmo lugar. Ética (parecer do Fiel, D): delta é RESULTADO, não ATO —
-- depende de ciclo, retenção de líquido, remédio, ganho de massa. Dados
-- (esta mesa): `(atual − inicial) / (meta − inicial)` é REVERSÍVEL AO VALOR
-- por álgebra de uma linha, e a meta é justamente o número que as pessoas
-- dizem em voz alta no grupo. A forma "segura" vaza o peso. O desejo legítimo
-- por trás do pedido se atende com o que PRODUZ o peso: treinos, refeições.
-- Se um dia isso mudar, muda por decisão de fundador POR ESCRITO com a frase
-- do PRINCIPIOS.md, e `/recusas` muda junto. Não por uma migration.
--
-- ─── O SINO: TEMPO REAL SEM TRANSPORTAR DADO ───────────────────────────
-- RT0 do parecer é bloqueante e a razão técnica é pior do que o parecer supôs.
-- Em `postgres_changes`, o Supabase avalia RLS por assinante em INSERT/UPDATE,
-- mas em DELETE NÃO AVALIA: o WAL só carrega o REPLICA IDENTITY (a PK), não há
-- linha suficiente para rodar a política, e o evento vai para TODOS os
-- assinantes da tabela. A PK de `group_visible_stats` é
-- (group_id, user_id, day, metric_key) — literalmente o fato inteiro. E
-- `publicar_dia` APAGA E REESCREVE a cada `life_event`: um copo de água
-- registrado emite um DELETE por métrica por grupo. Publicar essa tabela
-- transmitiria a série diária de todo mundo, por métrica, para qualquer
-- autenticado, inclusive de grupos onde ele não está. O calendário de bolinhas
-- que não tem endpoint entraria pela porta do socket, como o Fiel escreveu.
-- `group_members` (quem saiu de onde) e `group_recognitions` (quem elogiou
-- quem, em que dia) têm o mesmo furo. `REPLICA IDENTITY FULL` piora: manda a
-- linha velha inteira.
--
-- Por isso: NENHUMA tabela de dado entra em `supabase_realtime`. O canal diz
-- "mudou algo no grupo X" e o cliente reconsulta pelas views, que já têm a
-- regra. Payload = um uuid de grupo. Zero dado, zero superfície nova.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠  ATENÇÃO AO RODAR NUM BANCO COM DADOS — leia antes de colar
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1. `consentimentos_select` FICA MAIS RESTRITIVA (ganha reciprocidade). Quem
--    não compartilha a métrica M num grupo deixa de ler o `goal_value` e o
--    `granted_at` dos outros naquela métrica. A folha de consentimento
--    (`v_meus_consentimentos`) NÃO quebra: ela lê pelo ramo `user_id =
--    auth.uid()`, que continua incondicional. Conferido linha a linha.
--
-- 2. `barra_do_grupo` MUDA DE VALOR. Hoje um desafio de 4 semanas mostra a
--    barra ~4× cheia, porque o numerador é o ciclo inteiro e o denominador é a
--    meta SEMANAL. Depois desta migration a mesma barra mostra ~1×. Nenhum
--    dado é alterado; o que estava errado era a conta.
--
-- 3. A POLÍTICA DE `group_visible_stats` NÃO É TOCADA — de propósito. Ela
--    continua com `current_date - 1` (UTC) enquanto o resto passa a `hoje_sp()`.
--    Consequência conhecida e ACEITA: entre 21h e meia-noite de Brasília, a
--    política enxerga hoje-SP e ontem-SP como "hoje e anteontem" e esconde um
--    dia a mais. Isso FALHA FECHADO (mostra menos, nunca mais), e mexer na
--    única política que separa a vida de um da vista do outro, na mesma
--    migration que mexe em seis outras coisas, é o tipo de risco que não se
--    toma de graça. Fica como item isolado para uma migration própria.
--
-- 4. Pela mesma razão, `consentiu()` e `janela_de_visao()` continuam com
--    `granted_at::date` / `joined_at::date` em UTC. Efeito conhecido: ligar um
--    consentimento depois das 21h de Brasília perde aquele dia (a janela abre
--    só no dia seguinte). Também falha fechado, e também é INTENCIONAL não
--    corrigir aqui: `publicar_dia` usa o MESMO corte, e consertar um sem o
--    outro publicaria linha que a RLS esconde — o autoteste 11 quebraria.
--    Os dois mudam juntos, numa migration só deles, ou não mudam.
--
-- 5. O sino instala gatilho em 6 tabelas, incluindo o caminho de escrita de
--    `group_visible_stats` (que roda a cada `life_event`). O toque é envolvido
--    em `exception when others then null`: o sino NUNCA derruba o registro da
--    vida real. Prefiro a tela desatualizada ao treino perdido.
--
-- 6. Supabase HOSPEDADO, colado no SQL Editor: não há garantia de que
--    `realtime.send`/`realtime.topic()` existam nem de que o dono do projeto
--    possa criar política em `realtime.messages` (a tabela pertence a
--    `supabase_realtime_admin`). Tudo isso está sob guarda de existência, com
--    QUEDA AUTOMÁTICA para a tabela-sino `group_pulse`. A migration não falha
--    por causa disso; ela AVISA por `raise notice` e o autoteste 18/19 diz
--    depois qual dos dois caminhos ficou de pé.
--
-- Ordem de conferência depois de rodar: `select * from public.social_autoteste();`
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 1. QUE HORAS SÃO, AFINAL
-- ═══════════════════════════════════════════════════════════════════════
-- `projetar_dia` grava dias de SÃO PAULO ((occurred_at at time zone
-- 'America/Sao_Paulo')::date). O resto do Social comparava esses dias com
-- `current_date`, que no Supabase é UTC. Das 21h à meia-noite de Brasília as
-- duas coisas discordam em um dia, e o sintoma é grotesco: `voltou_hoje`
-- compara `v.day = current_date` com um dia que ainda não existe e devolve
-- SEMPRE FALSO; `publicar_ao_ligar` publica um dia vazio. Três horas por dia,
-- todo dia, sem erro no log.

create or replace function public.hoje_sp()
returns date
language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

comment on function public.hoje_sp() is
  'Hoje em São Paulo. Existe porque current_date é UTC e os dias da projeção são locais: das 21h à meia-noite as duas discordam.';

create or replace function public.inicio_da_semana()
returns date
language sql stable as $$
  select date_trunc('week', public.hoje_sp())::date
$$;

comment on function public.inicio_da_semana() is
  'Segunda-feira da semana corrente, em São Paulo. date_trunc(week) é ISO: a semana começa na segunda, não no domingo.';

revoke execute on function public.hoje_sp()         from public, anon;
revoke execute on function public.inicio_da_semana() from public, anon;
grant  execute on function public.hoje_sp()         to authenticated;
grant  execute on function public.inicio_da_semana() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. O X/Y DA SEMANA, FORA DE DESAFIO
-- ═══════════════════════════════════════════════════════════════════════
-- Espelho de `total_do_ciclo`. Mesmas quatro travas, na mesma ordem, porque
-- divergir delas aqui seria abrir uma segunda porta para a mesma sala:
--   sou membro · o grupo é legível · o DONO consentiu · EU consentiu (recíproco)
--
-- NULL vs 0 — a decisão, e ela é de produto:
--   NULL = NÃO HÁ NÚMERO (não consentiu, não sou recíproco, entrei depois).
--   0    = HÁ número, e ele é zero.
-- São fatos diferentes e a tela precisa poder dizer coisas diferentes:
-- colapsar zero em NULL mataria o "0 de 6" que o fundador pediu; colapsar NULL
-- em zero acusaria de "não fez" quem apenas não compartilha — que é a
-- acusação mais barata e mais injusta que este produto poderia fazer.
-- (`v_desafio_progresso` hoje CONFUNDE os dois: sum() de zero linhas é NULL
-- nos dois casos. Fica anotado; não é corrigido aqui para não mudar a semântica
-- de uma view que o front já lê no meio de uma refatoração de front.)

create or replace function public.total_da_semana(p_group uuid, p_user uuid, p_metric text)
returns numeric
language plpgsql stable security definer set search_path = public as $fn$
declare ini date; fim date; res numeric;
begin
  if not public.sou_membro(p_group)    then return null; end if;
  if not public.grupo_legivel(p_group) then return null; end if;
  -- o dono do dado consentiu naquele grupo, naquela métrica
  if public.consentiu(p_group, p_user,     p_metric) = 'infinity'::date then return null; end if;
  -- e EU consenti a mesma métrica no mesmo grupo: quem não mostra, não vê
  if public.consentiu(p_group, auth.uid(), p_metric) = 'infinity'::date then return null; end if;

  ini := greatest(public.inicio_da_semana(),                        -- a semana corrente
                  public.janela_de_visao(p_group, p_user),          -- a interseção das entradas
                  public.consentiu(p_group, p_user, p_metric));     -- ligar hoje não mostra ontem
  fim := least(public.hoje_sp(),
               (select g.ends_on from public.groups g where g.id = p_group));
  if ini > fim then return null; end if;

  -- coalesce 0 e não NULL: chegou aqui, o direito ao número existe. Ver comment.
  select coalesce(sum(v.value), 0) into res
    from public.group_visible_stats v
   where v.group_id   = p_group
     and v.user_id    = p_user
     and v.metric_key = p_metric
     and v.day between ini and fim;
  return res;
end $fn$;

comment on function public.total_da_semana(uuid, uuid, text) is
  'Quantos dias desta semana, uma pessoa, uma métrica. Devolve UM número e nunca os dias: é o agregado que a RLS de group_visible_stats (corte de 2 dias) não deixa a view calcular. NULL = sem direito ao número; 0 = com direito, e é zero.';

revoke execute on function public.total_da_semana(uuid, uuid, text) from public, anon;
grant  execute on function public.total_da_semana(uuid, uuid, text) to authenticated;

-- A view sai de `group_data_consents`, não de `group_visible_stats`. Isso não é
-- detalhe de implementação: é a regra C do parecer virando forma. "Não existe
-- consentimento/meta → a pessoa NÃO APARECE naquela métrica" é exatamente
-- "não existe linha em group_data_consents → não existe linha aqui". O front
-- não precisa lembrar de filtrar, porque não há o que filtrar.
--
-- `combinado` só é devolvido quando `goal_period = 'semana'`. Com 'dia' ou
-- 'ciclo' a meta não é comparável a uma contagem semanal, e a trava 4 do
-- parecer é literal: sem meta declarada NÃO SE INVENTA DENOMINADOR. NULL ali
-- manda a tela escrever "sem registro", não "0 de 7".

create or replace view public.v_grupo_semana
  with (security_invoker = true) as
select
  c.group_id,
  c.user_id,
  m.display_name,
  m.avatar_emoji,
  (c.user_id = auth.uid())                                    as sou_eu,
  c.metric_key,
  s.label,
  s.pillar,
  s.ordem,
  public.total_da_semana(c.group_id, c.user_id, c.metric_key) as feito,
  case when c.goal_period = 'semana' then c.goal_value end    as combinado,
  c.goal_period
from public.group_data_consents c
join public.group_members m     on m.group_id   = c.group_id and m.user_id = c.user_id
join public.shareable_metrics s on s.metric_key = c.metric_key
where public.sou_membro(c.group_id)
  and public.grupo_legivel(c.group_id);

grant select on public.v_grupo_semana to authenticated;

comment on view public.v_grupo_semana is
  'X/Y da semana corrente: uma linha por (grupo, pessoa, métrica CONSENTIDA). Sem consentimento não há linha — é a regra "quem não compartilha não aparece" escrita como ausência, não como filtro que alguém precisa lembrar de aplicar. feito NULL = não há direito ao número; feito 0 = há, e é zero. Não existe versão desta view com intervalo de datas, igual v_grupo_hoje: o agregado sai, a série não.';


-- ═══════════════════════════════════════════════════════════════════════
-- 3. O FUSO, NOS QUATRO LUGARES QUE ENCOSTAM NA TELA
-- ═══════════════════════════════════════════════════════════════════════
-- `v_grupo_hoje` é RECRIADA sem perder uma coluna sequer: o front vai passar a
-- selecionar label, value, goal_value e avatar_emoji dela (campos que já
-- existiam e que a tela jogava fora). Só o corte muda.

create or replace view public.v_grupo_hoje
  with (security_invoker = true) as
select
  v.group_id,
  v.user_id,
  m.display_name,
  m.avatar_emoji,
  (v.user_id = auth.uid())                        as sou_eu,
  v.day,
  v.metric_key,
  s.label,
  v.value,
  v.goal_value,
  public.voltou_hoje(v.group_id, v.user_id)       as voltou
from public.group_visible_stats v
join public.group_members m     on m.group_id = v.group_id and m.user_id = v.user_id
join public.shareable_metrics s on s.metric_key = v.metric_key
where v.day >= public.hoje_sp() - 1;

grant select on public.v_grupo_hoje to authenticated;

comment on view public.v_grupo_hoje is
  'O dia de hoje do grupo, em dias de São Paulo. Não existe versão desta view com intervalo de datas: série diária de terceiro é o calendário de bolinhas, e ele não sai daqui. (A política da tabela ainda corta em current_date UTC — ver item 3 do cabeçalho: ela falha FECHADO e muda em migration própria.)';

-- `voltou_hoje` comparava com um dia que, das 21h em diante, ainda não existia
-- nos dados: devolvia falso três horas por dia.
create or replace function public.voltou_hoje(p_group uuid, p_user uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare tem_hoje boolean; tem_antes boolean; hoje date;
begin
  if not public.sou_membro(p_group) then return false; end if;
  if not exists (select 1 from public.group_data_consents c
                  where c.group_id = p_group and c.user_id = p_user) then
    return false;
  end if;
  hoje := public.hoje_sp();
  select exists (select 1 from public.group_visible_stats v
                  where v.group_id = p_group and v.user_id = p_user and v.day = hoje)
    into tem_hoje;
  if not tem_hoje then return false; end if;
  select exists (select 1 from public.group_visible_stats v
                  where v.group_id = p_group and v.user_id = p_user
                    and v.day between hoje - 7 and hoje - 1)
    into tem_antes;
  return not tem_antes;
end $fn$;

comment on function public.voltou_hoje(uuid, uuid) is
  'Sim/não: esta pessoa registrou hoje depois de uma semana sem registrar neste grupo. NUNCA devolve quantos dias — o número é o denominador da ausência. Dias de São Paulo.';

-- `total_do_ciclo` fechava o ciclo em `current_date`: das 21h à meia-noite
-- contava um dia que a projeção ainda não tinha escrito.
create or replace function public.total_do_ciclo(p_challenge uuid, p_user uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $fn$
declare ch record; p record; ini date; fim date; res numeric;
begin
  if not public.sou_participante(p_challenge) then return null; end if;
  select * into ch from public.challenges where id = p_challenge;
  if ch.id is null then return null; end if;
  select * into p from public.challenge_participants
   where challenge_id = p_challenge and user_id = p_user;
  if p.user_id is null then return null; end if;
  if public.consentiu(ch.group_id, p_user,     ch.metric_key) = 'infinity'::date then return null; end if;
  if public.consentiu(ch.group_id, auth.uid(), ch.metric_key) = 'infinity'::date then return null; end if;
  ini := greatest(ch.starts_on, p.joined_at::date,
                  public.janela_de_visao(ch.group_id, p_user),
                  public.consentiu(ch.group_id, p_user, ch.metric_key));
  fim := least(ch.ends_on, public.hoje_sp());
  if ini > fim then return null; end if;
  select sum(v.value) into res from public.group_visible_stats v
   where v.group_id = ch.group_id and v.user_id = p_user
     and v.metric_key = ch.metric_key and v.day between ini and fim;
  return res;
end $fn$;

comment on function public.total_do_ciclo(uuid, uuid) is
  'Total de uma pessoa num desafio, do começo do ciclo até hoje (São Paulo). Devolve UM número, nunca os dias.';

-- `publicar_ao_ligar` publicava `current_date`: ligar o consentimento às 22h
-- de Brasília publicava um dia que não tem linha nenhuma.
create or replace function public.publicar_ao_ligar()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  perform public.publicar_dia(new.user_id, public.hoje_sp());
  return new;
end $fn$;

comment on function public.publicar_ao_ligar() is
  'Ligou o consentimento: publica o dia de hoje (São Paulo) na hora, para a tela não ficar vazia até o próximo registro.';


-- ═══════════════════════════════════════════════════════════════════════
-- 4. A BARRA DO DESAFIO MEDIA 4× ERRADO
-- ═══════════════════════════════════════════════════════════════════════
-- `feito` soma o CICLO INTEIRO. `combinado` somava `goal_value`, que por
-- default é uma meta SEMANAL. Num desafio de 4 semanas a barra aparecia ~4×
-- cheia — e uma barra coletiva que sempre estoura não informa nada, só
-- parabeniza. Pior: é a única peça do Social que soma pessoas, protegida por
-- k=4 justamente porque é sensível; uma peça sensível e errada é a pior
-- combinação possível.
--
-- A ESCOLHA, e por que ela: o denominador passa a ser a meta ESCALADA PARA O
-- CICLO INTEIRO, por período:
--     'dia'    → dias do ciclo
--     'semana' → ceil(dias / 7)     ← semanas COMEÇADAS
--     'ciclo'  → 1
-- `ceil` e não proporção fracionária por duas razões. Primeira: "X de Y
-- combinados" é contagem de DIAS, e dia não é fracionário — 5,7 no denominador
-- é um número que ninguém combinou. Segunda: `ceil` SUPERESTIMA o denominador
-- num ciclo que não fecha semanas redondas, e superestimar o denominador erra
-- para o lado de "a barra não encheu", nunca para o lado do mérito falso. Num
-- produto que decidiu não distribuir prêmio, esse é o lado certo de errar.
--
-- O numerador continua vindo de `total_do_ciclo` (que já é NULL sem
-- reciprocidade), e o k=4 continua onde estava: sem quatro pessoas
-- compartilhando, a barra não existe — senão a subtração identifica quem.

create or replace function public.barra_do_grupo(p_challenge uuid)
returns table (feito numeric, combinado numeric, pessoas int)
language plpgsql stable security definer set search_path = public as $fn$
declare ch record; k int; dias int;
begin
  if not public.sou_participante(p_challenge) then return; end if;
  select * into ch from public.challenges where id = p_challenge;
  if ch.id is null then return; end if;
  dias := (ch.ends_on - ch.starts_on) + 1;

  select count(*) into k
    from public.challenge_participants p
    join public.group_data_consents c
      on c.group_id = ch.group_id and c.user_id = p.user_id and c.metric_key = ch.metric_key
   where p.challenge_id = p_challenge;
  if k < 4 then return; end if;   -- k=4: abaixo disso a subtração identifica

  return query
    select sum(public.total_do_ciclo(p_challenge, p.user_id)),
           sum(c.goal_value * case c.goal_period
                                when 'dia'    then dias
                                when 'semana' then ceil(dias / 7.0)
                                else 1
                              end),
           k
      from public.challenge_participants p
      join public.group_data_consents c
        on c.group_id = ch.group_id and c.user_id = p.user_id and c.metric_key = ch.metric_key
     where p.challenge_id = p_challenge;
end $fn$;

comment on function public.barra_do_grupo(uuid) is
  'A soma do grupo num desafio, só com k>=4. O combinado é a meta de cada um ESCALADA PARA O CICLO (semana -> ceil(dias/7)): antes somava meta semanal contra feito do ciclo inteiro e a barra aparecia 4x cheia num desafio de 4 semanas. ceil superestima o denominador de propósito — erra para "não encheu", nunca para o mérito falso.';


-- ═══════════════════════════════════════════════════════════════════════
-- 5. ÍNDICE
-- ═══════════════════════════════════════════════════════════════════════
-- `total_da_semana` roda uma vez por pessoa por métrica: um grupo de 8 com 7
-- métricas são 56 chamadas para pintar uma tela. Os índices existentes
-- (group_id, day) e (user_id, day) obrigam cada uma delas a filtrar
-- metric_key na mão.

create index if not exists gvs_grupo_user_metrica
  on public.group_visible_stats (group_id, user_id, metric_key, day);

comment on index public.gvs_grupo_user_metrica is
  'A forma exata da pergunta de total_da_semana e total_do_ciclo: um grupo, uma pessoa, uma métrica, um intervalo.';


-- ═══════════════════════════════════════════════════════════════════════
-- 6. RECIPROCIDADE TAMBÉM NO CONSENTIMENTO
-- ═══════════════════════════════════════════════════════════════════════
-- A política antiga era `user_id = auth.uid() or sou_membro(group_id)`: QUALQUER
-- membro lia `goal_value` e `granted_at` de TODO MUNDO, sem compartilhar nada.
-- "Fulano ligou treino no dia 12 e combinou 6 por semana" é informação sobre a
-- vida do Fulano, e ela vazava para quem não dá nada em troca — enquanto o
-- número em si já era protegido por reciprocidade em `group_visible_stats`.
-- Guardar o número e entregar a meta e a data é guardar o cofre e deixar a
-- planta na mesa.
--
-- O RAMO `user_id = auth.uid()` CONTINUA INCONDICIONAL, e é ele que sustenta
-- `v_meus_consentimentos` (a folha onde a pessoa liga e desliga cada tipo):
-- aquela view lê group_data_consents SEMPRE com `c.user_id = auth.uid()` no
-- left join. A folha não pode depender de reciprocidade — seria preciso
-- compartilhar para poder escolher não compartilhar.
--
-- Efeito colateral bom: com a política recíproca, `v_grupo_semana` deixa de
-- emitir a linha de quem eu não tenho direito de ver, em vez de emitir linha
-- com feito NULL. Sumir é menos que ser exibido como buraco (parecer, C).

drop policy if exists "consentimentos_select" on public.group_data_consents;
create policy "consentimentos_select" on public.group_data_consents for select to authenticated
using (
  group_data_consents.user_id = auth.uid()              -- minha folha, sempre
  or (
    public.sou_membro(group_data_consents.group_id)
    and public.consentiu(group_data_consents.group_id, auth.uid(),
                         group_data_consents.metric_key) <> 'infinity'::date
  )
);


-- ═══════════════════════════════════════════════════════════════════════
-- 7. O SINO
-- ═══════════════════════════════════════════════════════════════════════
-- Um canal que só diz "mudou algo no grupo X". O cliente ouve e reconsulta
-- pelas views, que já têm a regra. Nada de dado no payload: não porque o front
-- não vá mostrar, mas porque um payload que existe é um payload que vaza.
--
-- CAMINHO BOM (broadcast autorizado): `realtime.send` no gatilho + política em
-- `realtime.messages`. O payload é ESCRITO POR NÓS, não derivado da linha —
-- logo o furo do DELETE simplesmente não tem onde acontecer. E a autorização é
-- avaliada UMA VEZ, na entrada do canal, em vez de por assinante por linha
-- como em postgres_changes (num grupo de 8, 8 avaliações por evento).
--
-- CAMINHO B (tabela-sino `group_pulse`): mesma ideia com uma tabela de duas
-- colunas, (group_id, at), essa sim publicada. Nem ela corre o risco do DELETE:
-- a PK é só o group_id, e a única forma de apagar uma linha é apagando o grupo.
--
-- A escolha é feita AQUI, na hora de rodar, olhando o que este Supabase tem.

do $mig$
declare tem_send boolean;
begin
  tem_send := to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null;

  if tem_send then
    execute $sql$
      create or replace function public.sino_toca(p_group uuid)
      returns void language plpgsql security definer set search_path = public as $s$
      begin
        -- payload: o id do grupo e mais nada. O que mudou, quem mudou e em que
        -- dia são perguntas para a view, com RLS, não para o socket.
        perform realtime.send(jsonb_build_object('grupo', p_group),
                              'mudou', 'grupo:' || p_group::text, true);
      exception when others then
        null;  -- o sino nunca derruba a escrita da vida real
      end $s$
    $sql$;
    raise notice 'SINO: broadcast autorizado (realtime.send). Canal privado grupo:<uuid>.';
  else
    execute $sql$
      create table if not exists public.group_pulse (
        group_id uuid primary key references public.groups(id) on delete cascade,
        at       timestamptz not null default now()
      )
    $sql$;
    execute 'alter table public.group_pulse enable row level security';
    execute $sql$
      comment on table public.group_pulse is
        'Plano B do sino: uma linha por grupo que só carrega o instante da última mudança. Publicada em supabase_realtime porque não há nada nela para vazar — nem no DELETE, que só acontece quando o grupo inteiro deixa de existir.'
    $sql$;
    execute 'drop policy if exists "sino_select_membro" on public.group_pulse';
    execute $sql$
      create policy "sino_select_membro" on public.group_pulse for select to authenticated
        using (public.sou_membro(group_pulse.group_id))
    $sql$;
    -- sem política de escrita: só o definer escreve, igual shared_daily_stats
    execute $sql$
      create or replace function public.sino_toca(p_group uuid)
      returns void language plpgsql security definer set search_path = public as $s$
      begin
        insert into public.group_pulse (group_id, at) values (p_group, now())
        on conflict (group_id) do update set at = now();
      exception when others then
        null;  -- o sino nunca derruba a escrita da vida real
      end $s$
    $sql$;
    begin
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime'
                        and schemaname = 'public' and tablename = 'group_pulse') then
        execute 'alter publication supabase_realtime add table public.group_pulse';
      end if;
      raise notice 'SINO: plano B (tabela group_pulse publicada). realtime.send nao existe neste projeto.';
    exception when others then
      raise notice 'SINO: plano B criado, MAS a publicacao supabase_realtime nao pode ser alterada (%). O front vai degradar para polling.', sqlerrm;
    end;
  end if;
end $mig$;

comment on function public.sino_toca(uuid) is
  'Toca o sino do grupo: diz que algo mudou e NADA sobre o que mudou. O corpo é escolhido na hora de aplicar a migration (broadcast se realtime.send existir, tabela group_pulse se não). Engole a própria exceção de propósito: tela desatualizada é melhor que treino perdido.';

revoke execute on function public.sino_toca(uuid) from public, anon, authenticated;

-- Um gatilho genérico serve as cinco tabelas porque só precisa de uma coisa:
-- o group_id. `to_jsonb(old/new)` evita cinco funções quase iguais e evita o
-- erro de referenciar `new.group_id` num DELETE (onde NEW não existe).
create or replace function public.tocar_sino()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare j jsonb; g uuid;
begin
  j := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  g := coalesce(
         (j ->> 'group_id')::uuid,
         (select ch.group_id from public.challenges ch
           where ch.id = (j ->> 'challenge_id')::uuid)
       );
  if g is not null then perform public.sino_toca(g); end if;
  return null;
end $fn$;

comment on function public.tocar_sino() is
  'Gatilho de linha do sino. Lê só o group_id (ou o challenge_id, para chegar nele) e joga o resto fora antes de tocar.';

-- `group_visible_stats` é caso à parte: `publicar_dia` apaga e reinsere até 7
-- linhas por grupo a CADA life_event. Por linha, um copo de água tocaria o sino
-- quatorze vezes. Por statement, uma.
create or replace function public.tocar_sino_lote()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare g uuid;
begin
  for g in select distinct group_id from linhas loop
    perform public.sino_toca(g);
  end loop;
  return null;
end $fn$;

comment on function public.tocar_sino_lote() is
  'Gatilho de statement do sino, para o caminho de escrita que apaga e reescreve em lote. Um toque por statement, não um por linha.';

drop trigger if exists trg_sino_gvs_ins on public.group_visible_stats;
create trigger trg_sino_gvs_ins after insert on public.group_visible_stats
  referencing new table as linhas
  for each statement execute function public.tocar_sino_lote();

drop trigger if exists trg_sino_gvs_del on public.group_visible_stats;
create trigger trg_sino_gvs_del after delete on public.group_visible_stats
  referencing old table as linhas
  for each statement execute function public.tocar_sino_lote();

do $mig$
declare t text;
begin
  foreach t in array array['group_notes','group_recognitions','group_members',
                           'challenges','challenge_participants'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_sino on public.%I', t);
      execute format('create trigger trg_sino after insert or update or delete on public.%I
                      for each row execute function public.tocar_sino()', t);
    end if;
  end loop;
end $mig$;

-- A política do canal. Entrar no canal de um grupo é ser membro dele — a mesma
-- pergunta que a RLS já faz, feita uma vez na entrada.
--
-- O regex é GUARDA DE CAST, não estética: sem ele, qualquer outro tópico do
-- projeto derruba esta política com erro de conversão de uuid, e uma política
-- que explode é uma política que alguém remove na pressa.
--
-- `realtime.messages` pertence a `supabase_realtime_admin`. Em projeto hospedado
-- o papel `postgres` do SQL Editor normalmente consegue criar política nela, mas
-- isso depende da versão do Realtime. Se não conseguir, a migration NÃO FALHA:
-- avisa, e o autoteste 19 devolve falso até alguém resolver.
do $mig$
begin
  if to_regprocedure('realtime.topic()') is null then
    raise notice 'SINO: realtime.topic() nao existe — politica do canal nao criada (caminho B em uso).';
    return;
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'realtime' and c.relname = 'messages' and c.relrowsecurity) then
    raise notice 'SINO: realtime.messages SEM RLS habilitada neste projeto. NAO habilite na mao sem falar com a Aduana: sem RLS, o canal fica aberto.';
  end if;
  begin
    execute 'drop policy if exists "sino_do_meu_grupo" on realtime.messages';
    execute $sql$
      create policy "sino_do_meu_grupo" on realtime.messages for select to authenticated
      using (
        case when realtime.topic() ~ '^grupo:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then public.sou_membro(substr(realtime.topic(), 7)::uuid)
             else false end
      )
    $sql$;
    raise notice 'SINO: politica sino_do_meu_grupo criada em realtime.messages.';
  exception when others then
    raise notice 'SINO: NAO foi possivel criar politica em realtime.messages (%). O canal broadcast NAO vai autorizar ninguem; use o caminho B ou peca ao suporte.', sqlerrm;
  end;
end $mig$;


-- ═══════════════════════════════════════════════════════════════════════
-- 8. AS INVARIANTES NOVAS
-- ═══════════════════════════════════════════════════════════════════════
-- `social_autoteste_base()` fica intacta. As novas moram numa função própria e
-- o wrapper soma as duas: assim nenhuma das duas listas precisa ser reescrita
-- quando a outra cresce.

create or replace function public.social_autoteste_semana()
returns table (teste text, passou boolean, detalhe text)
language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  return query select
    '13 v_grupo_semana nasce do consentimento, não da publicação',
    (select pg_get_viewdef('public.v_grupo_semana'::regclass) ilike '%group_data_consents%'
        and pg_get_viewdef('public.v_grupo_semana'::regclass) not ilike '%group_visible_stats%'),
    'Sem consentimento não há linha. A regra "quem não compartilha não aparece" é a ausência, não um filtro que o front precisa lembrar.';

  return query select
    '14 total_da_semana falha fechado',
    public.total_da_semana('00000000-0000-0000-0000-000000000000',
                           '00000000-0000-0000-0000-000000000000',
                           'treino_registrado') is null,
    'Sem filiação, sem reciprocidade e sem consentimento, a resposta é NULL — nunca 0, que seria uma acusação.';

  return query select
    '15 com direito ao número, zero é zero',
    (select p.prosrc ilike '%coalesce(sum(v.value), 0)%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'total_da_semana'),
    'NULL e 0 são fatos diferentes: sem isso a tela não consegue escrever "0 de 6" sem acusar quem só não compartilha.';

  return query select
    '16 nenhuma view devolve série diária de terceiro',
    not exists (select 1 from pg_views v
                 where v.schemaname = 'public'
                   and v.definition ilike '%group_visible_stats%'
                   and v.viewname <> 'v_grupo_hoje'
                   and v.definition ilike '%.day%')
    and (select pg_get_viewdef('public.v_grupo_hoje'::regclass) ilike '%hoje_sp%'),
    'O agregado sai, a série não. v_grupo_hoje é a única com day, e ela corta em dois dias.';

  return query select
    '17 o sino não carrega dado',
    (select p.prosrc !~* 'user_id|metric_key|display_name|goal_value|life_events|shared_daily_stats|group_visible_stats'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'sino_toca')
    and (to_regclass('public.group_pulse') is null
         or not exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'group_pulse'
                           and column_name not in ('group_id','at'))),
    'O payload é o id do grupo. Um payload que existe é um payload que vaza.';

  return query select
    '18 nenhuma tabela de dado em supabase_realtime (RT0)',
    not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename in ('groups','group_members','group_visible_stats',
                                     'shared_daily_stats','group_data_consents',
                                     'group_notes','group_recognitions',
                                     'challenges','challenge_participants',
                                     'consent_events','group_invites')),
    'Em postgres_changes o DELETE não passa por RLS e a PK de group_visible_stats É o fato. Publicar essas tabelas é o calendário de bolinhas entrando pela porta do socket.';

  return query select
    '19 o canal do sino autoriza alguém',
    (exists (select 1 from pg_policies
              where schemaname = 'realtime' and tablename = 'messages'
                and policyname = 'sino_do_meu_grupo')
     or exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename = 'group_pulse')),
    'Falso aqui não é vazamento: é o tempo real simplesmente não funcionando. Ou a política em realtime.messages, ou a tabela group_pulse publicada.';

  return query select
    '20 reciprocidade também na folha de consentimento',
    (select coalesce(bool_and(qual ilike '%consentiu%' and qual ilike '%auth.uid()%'), false)
       from pg_policies
      where schemaname = 'public' and tablename = 'group_data_consents' and cmd = 'SELECT'),
    'Guardar o número e entregar a meta e a data é guardar o cofre e deixar a planta na mesa.';

  return query select
    '21 a barra do grupo escala a meta para o ciclo',
    (select p.prosrc ilike '%goal_period%' and p.prosrc ilike '%ceil(dias / 7.0)%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'barra_do_grupo'),
    'Meta semanal contra feito de ciclo inteiro mostrava a barra 4x cheia num desafio de 4 semanas.';

  return query select
    '22 search_path fixo nas funções definer novas',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.prosecdef
                   and p.proname in ('total_da_semana','sino_toca','tocar_sino','tocar_sino_lote')
                   and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'),
    'Mesma regra do teste 09, para as funções que esta migration criou.';
end $fn$;

comment on function public.social_autoteste_semana() is
  'As invariantes do X/Y semanal e do sino. Complementa social_autoteste_base(); as duas listas crescem separadas de propósito.';

create or replace function public.social_autoteste()
returns table (teste text, passou boolean, detalhe text)
language sql stable security definer set search_path = public as $w$
  select * from public.social_autoteste_base()
  union all
  select * from public.social_autoteste_semana()
$w$;

revoke execute on function public.social_autoteste_semana() from public, anon, authenticated;
revoke execute on function public.social_autoteste()        from public, anon, authenticated;

comment on function public.social_autoteste() is
  'As invariantes estruturais da camada Social. Rodar depois de todo deploy que a toque: select * from public.social_autoteste();';
