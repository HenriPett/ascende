-- ═══════════════════════════════════════════════════════════════════════
-- DESAFIO SEM PÓDIO — E COM POSIÇÃO PRIVADA
--
-- O parecer do Fiel vetou o ranking ordinal público, e o argumento não é
-- sentimental:
--
--   soma é monotônica em presença, então TODO ranking de soma é um ranking de
--   frequência disfarçado.
--
-- Ou seja: trocar "0" por "sem registro" conserta a PALAVRA, não a POSIÇÃO.
-- Quem teve uma semana ruim continua chegando por último, agora com eufemismo.
-- E o ordinal é uma afirmação sobre a PESSOA ("você é o quinto"), não sobre o
-- comportamento dela — para um público que, por POSICIONAMENTO §B, já desistiu
-- de vários apps, é a última tela de que precisa. Esconder o terço de baixo
-- também não resolve: "e mais 6 participantes" identifica os 6.
--
-- O QUE FICA, em três camadas:
--   Camada 0 — A BARRA COLETIVA. Um número só, do grupo: "34 de 50 treinos
--     combinados nesta semana". Quem está atrás continua contribuindo em vez
--     de aparecer atrás.
--   Camada 1 — A LISTA SEM ORDEM, cada um contra a META DELE: "Ana: 3 de 3",
--     "Você: 2 de 4". Quem combinou 2 e cumpriu aparece completo ao lado de
--     quem combinou 6 — que é a verdade, e é o que o ordinal apaga.
--   Camada 2 — O DESAFIO COMPETITIVO, opt-in, com POSIÇÃO PRIVADA: cada um vê
--     a própria posição, ninguém vê a de ninguém. Quem quiser aparecer no
--     pódio liga isso explicitamente para aquele desafio.
--
-- ─── K MÍNIMO DE 4 NA BARRA COLETIVA (parecer, B4-c) ───────────────────
-- Agregado não é anônimo em grupo pequeno: num grupo de 3, a barra coletiva
-- mais duas linhas individuais entrega a terceira pessoa por SUBTRAÇÃO —
-- inclusive quem manteve a posição privada. O k é conferido no SQL, não no
-- front, porque uma regra de anonimato que vive na tela é uma regra que o
-- próximo endpoint esquece.
--
-- ─── NÃO EXISTE TABELA DE RESULTADO ────────────────────────────────────
-- O placar é sempre calculado ao vivo. Um resultado gravado sobreviveria à
-- exclusão da conta do participante e faria de "apagar a conta" meia verdade.
-- O preço é recalcular um desafio encerrado para sempre; com estes volumes é
-- barato, e é o mesmo tipo de fatura que o PRINCIPIOS.md já aceita pagar em
-- "Cancelou? Seus dados continuam seus".
--
-- ─── AS FUNÇÕES DE TOTAL NÃO TÊM PARÂMETRO DE DATA ─────────────────────
-- A janela vem de `challenges.starts_on/ends_on`, gravado no banco. Essa é a
-- diferença entre agregar e vazar: com um parâmetro de data, qualquer um pede
-- dois totais e subtrai para reconstruir o dia — o calendário de bolinhas de
-- volta pela porta dos fundos.
--
-- Esta é também a única exceção à regra "view security_invoker, política faz o
-- trabalho", e ela se justifica porque RLS não sabe dizer "pode ler a SOMA mas
-- não as linhas". A função devolve um escalar, não linhas, e o portão inteiro
-- cabe em seis linhas auditáveis no topo dela.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.challenges (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  metric_key  text not null references public.shareable_metrics(metric_key),
  starts_on   date not null,
  ends_on     date not null,
  -- Camada 2. Falso por padrão: competição é opt-in do desafio inteiro, e
  -- depois opt-in de cada participante para o pódio.
  competitivo boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists challenges_group on public.challenges (group_id, ends_on desc);
alter table public.challenges enable row level security;

create table if not exists public.challenge_participants (
  challenge_id  uuid not null references public.challenges(id) on delete cascade,
  user_id       uuid not null references auth.users(id)        on delete cascade,
  -- "Sem opt-out disponível para o pódio, isso vira exposição; com ele, vira
  -- escolha." Nasce falso, como tudo nesta camada.
  podio_publico boolean not null default false,
  joined_at     timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
alter table public.challenge_participants enable row level security;

-- ─── HELPERS ────────────────────────────────────────────────────────────

create or replace function public.sou_membro_do_desafio(p_challenge uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.challenges ch
     join public.group_members m on m.group_id = ch.group_id and m.user_id = auth.uid()
    where ch.id = p_challenge
  )
$$;

create or replace function public.sou_participante(p_challenge uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.challenge_participants p
     where p.challenge_id = p_challenge and p.user_id = auth.uid()
  )
$$;

-- ─── O TOTAL DO CICLO ───────────────────────────────────────────────────
--
-- Portão, em ordem: quem pergunta participa; quem é perguntado participa; o
-- consentimento daquela métrica naquele grupo está de pé; e a reciprocidade —
-- eu só somo o total de alguém num tipo de dado que eu também dou.
--
-- Fora da janela ou sem direito, devolve NULL. NULL aqui quer dizer "sem
-- registro", e a tela escreve isso — nunca zero.

create or replace function public.total_do_ciclo(p_challenge uuid, p_user uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare ch record; p record; ini date; fim date; res numeric;
begin
  if not public.sou_participante(p_challenge) then return null; end if;

  select * into ch from public.challenges where id = p_challenge;
  if ch.id is null then return null; end if;

  select * into p from public.challenge_participants
   where challenge_id = p_challenge and user_id = p_user;
  if p.user_id is null then return null; end if;

  -- O dono liberou esta métrica neste grupo?
  if public.consentiu(ch.group_id, p_user, ch.metric_key) = 'infinity'::date then return null; end if;
  -- Reciprocidade: e eu, dou a mesma coisa a este grupo?
  if public.consentiu(ch.group_id, auth.uid(), ch.metric_key) = 'infinity'::date then return null; end if;

  ini := greatest(ch.starts_on, p.joined_at::date,
                  public.janela_de_visao(ch.group_id, p_user),
                  public.consentiu(ch.group_id, p_user, ch.metric_key));
  fim := least(ch.ends_on, current_date);
  if ini > fim then return null; end if;

  -- SOMA DE DIAS, e é o único jeito de agregar aqui.
  --
  -- Existiu um segundo ramo, 'ultimo', que devolvia o valor do ÚLTIMO dia da
  -- janela e NULL quando não havia linha nele. Ele servia só a
  -- `sequencia_dias`, e era o penhasco: um dia silencioso não reduzia o número
  -- da pessoa, zerava — na frente do grupo. A chave saiu do catálogo em
  -- 18/09/2026 e o ramo saiu junto.
  --
  -- Soma não tem penhasco: um dia sem registro não derruba os anteriores,
  -- apenas não acrescenta. É a mesma diferença entre somar e emendar.
  select sum(v.value) into res from public.group_visible_stats v
   where v.group_id = ch.group_id and v.user_id = p_user
     and v.metric_key = ch.metric_key and v.day between ini and fim;

  return res;
end $$;

-- ─── A BARRA COLETIVA, COM K MÍNIMO ─────────────────────────────────────

create or replace function public.barra_do_grupo(p_challenge uuid)
returns table (feito numeric, combinado numeric, pessoas int)
language plpgsql stable security definer set search_path = public as $$
declare ch record; k int;
begin
  if not public.sou_participante(p_challenge) then return; end if;
  select * into ch from public.challenges where id = p_challenge;

  select count(*) into k
    from public.challenge_participants p
    join public.group_data_consents c
      on c.group_id = ch.group_id and c.user_id = p.user_id and c.metric_key = ch.metric_key
   where p.challenge_id = p_challenge;

  -- Abaixo de 4 consentimentos ativos, a barra não aparece: com 3, qualquer um
  -- deduz o terceiro subtraindo os dois que vê. Devolver zero linhas (e não um
  -- zero) é o que faz a tela escrever "poucas pessoas para um número do grupo"
  -- em vez de um número que parece pequeno.
  if k < 4 then return; end if;

  return query
    select sum(public.total_do_ciclo(p_challenge, p.user_id)),
           sum(c.goal_value),
           k
      from public.challenge_participants p
      join public.group_data_consents c
        on c.group_id = ch.group_id and c.user_id = p.user_id and c.metric_key = ch.metric_key
     where p.challenge_id = p_challenge;
end $$;

-- ─── A POSIÇÃO É SUA (parecer, N10 e Camada 2) ──────────────────────────
--
-- Devolve a SUA posição, e só a sua. Não existe função que devolva a posição
-- de outra pessoa: o teste do parecer é "a resposta da API do desafio não
-- contém rank de terceiros", e a forma de passar nele é não haver o que
-- devolver.

create or replace function public.minha_posicao(p_challenge uuid)
returns table (posicao int, de int)
language plpgsql stable security definer set search_path = public as $$
declare ch record; meu numeric;
begin
  if not public.sou_participante(p_challenge) then return; end if;
  select * into ch from public.challenges where id = p_challenge;
  if not ch.competitivo then return; end if;   -- desafio não competitivo não tem posição

  meu := public.total_do_ciclo(p_challenge, auth.uid());
  if meu is null then return; end if;

  return query
    with totais as (
      select public.total_do_ciclo(p_challenge, p.user_id) as t
        from public.challenge_participants p where p.challenge_id = p_challenge
    )
    select (select count(*)::int + 1 from totais where t > meu),
           (select count(*)::int from totais where t is not null);
end $$;

-- O pódio só mostra quem ligou o pódio. Sem opt-in, ninguém aparece — e um
-- pódio vazio é a resposta certa para um desafio em que ninguém quis aparecer.
create or replace function public.podio(p_challenge uuid)
returns table (user_id uuid, display_name text, total numeric)
language plpgsql stable security definer set search_path = public as $$
declare ch record;
begin
  if not public.sou_participante(p_challenge) then return; end if;
  select * into ch from public.challenges where id = p_challenge;
  if not ch.competitivo then return; end if;

  return query
    select p.user_id, m.display_name, public.total_do_ciclo(p_challenge, p.user_id)
      from public.challenge_participants p
      join public.group_members m on m.group_id = ch.group_id and m.user_id = p.user_id
     where p.challenge_id = p_challenge
       and p.podio_publico            -- opt-in explícito, por desafio
       and public.total_do_ciclo(p_challenge, p.user_id) is not null;
end $$;

revoke execute on function public.sou_membro_do_desafio(uuid)   from public, anon;
revoke execute on function public.sou_participante(uuid)        from public, anon;
revoke execute on function public.total_do_ciclo(uuid, uuid)    from public, anon;
revoke execute on function public.barra_do_grupo(uuid)          from public, anon;
revoke execute on function public.minha_posicao(uuid)           from public, anon;
revoke execute on function public.podio(uuid)                   from public, anon;
grant  execute on function public.sou_membro_do_desafio(uuid)   to authenticated;
grant  execute on function public.sou_participante(uuid)        to authenticated;
grant  execute on function public.total_do_ciclo(uuid, uuid)    to authenticated;
grant  execute on function public.barra_do_grupo(uuid)          to authenticated;
grant  execute on function public.minha_posicao(uuid)           to authenticated;
grant  execute on function public.podio(uuid)                   to authenticated;

-- ─── POLÍTICAS ──────────────────────────────────────────────────────────

drop policy if exists "desafios_select_membro" on public.challenges;
create policy "desafios_select_membro" on public.challenges for select to authenticated
  using (public.sou_membro(challenges.group_id));

drop policy if exists "desafios_insert_admin" on public.challenges;
create policy "desafios_insert_admin" on public.challenges for insert to authenticated
  with check (public.sou_admin(challenges.group_id)
              and public.grupo_vigente(challenges.group_id)
              and created_by = auth.uid());

drop policy if exists "desafios_update_admin" on public.challenges;
create policy "desafios_update_admin" on public.challenges for update to authenticated
  using (public.sou_admin(challenges.group_id)) with check (public.sou_admin(challenges.group_id));

drop policy if exists "desafios_delete_admin" on public.challenges;
create policy "desafios_delete_admin" on public.challenges for delete to authenticated
  using (public.sou_admin(challenges.group_id));

drop policy if exists "participantes_select" on public.challenge_participants;
create policy "participantes_select" on public.challenge_participants for select to authenticated
  using (user_id = auth.uid() or public.sou_membro_do_desafio(challenge_participants.challenge_id));

drop policy if exists "participantes_insert_proprio" on public.challenge_participants;
create policy "participantes_insert_proprio" on public.challenge_participants for insert to authenticated
  with check (user_id = auth.uid()
              and public.sou_membro_do_desafio(challenge_participants.challenge_id));

drop policy if exists "participantes_update_proprio" on public.challenge_participants;
create policy "participantes_update_proprio" on public.challenge_participants for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "participantes_delete_proprio" on public.challenge_participants;
create policy "participantes_delete_proprio" on public.challenge_participants for delete to authenticated
  using (user_id = auth.uid());

-- ─── A VIEW DO PROGRESSO (Camada 1: sem ordem, contra a própria meta) ───
--
-- security_invoker: roda com as permissões de quem consulta, então o RLS de
-- challenge_participants e group_members continua valendo dentro dela. Sem
-- isso, ela rodaria como dona das tabelas e viraria vazamento entre contas.
--
-- Não há ORDER BY aqui, e isso é uma escolha: ordenar no banco convida a tela
-- a exibir na ordem que veio. Ordem alfabética ou por entrada é decisão da
-- tela, e `feito` nunca vem sem `combinado` ao lado.
create or replace view public.v_desafio_progresso
  with (security_invoker = true) as
select
  p.challenge_id,
  p.user_id,
  m.display_name,
  m.avatar_emoji,
  (p.user_id = auth.uid())                          as sou_eu,
  public.total_do_ciclo(p.challenge_id, p.user_id)  as feito,       -- NULL = sem registro
  c.goal_value                                      as combinado
from public.challenge_participants p
join public.challenges ch on ch.id = p.challenge_id
join public.group_members m on m.group_id = ch.group_id and m.user_id = p.user_id
left join public.group_data_consents c
  on c.group_id = ch.group_id and c.user_id = p.user_id and c.metric_key = ch.metric_key;

grant select on public.v_desafio_progresso to authenticated;

comment on view public.v_desafio_progresso is
  'Uma linha por participante, SEM ORDEM, com feito e combinado lado a lado. feito NULL = sem registro (nunca 0).';
