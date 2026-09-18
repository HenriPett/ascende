-- ═══════════════════════════════════════════════════════════════════════
-- O GRUPO NASCE SEM ENXERGAR NADA
--
-- Até hoje o Ascende é de UMA pessoa: toda RLS é `user_id = auth.uid()` e não
-- existe um único caminho em que a linha de alguém seja lida por outro alguém.
-- Este arquivo abre essa fronteira — e abre pelo lado mais estreito possível.
--
-- Depois desta migration, duas pessoas podem estar no mesmo grupo e continuar
-- sem ver UM ÚNICO número uma da outra, porque ainda não existe tabela de dado
-- compartilhado nem consentimento nenhum. O que se enxerga aqui é só quem está
-- na sala. É o teste N1 do parecer do Fiel: "usuário novo entra num grupo; o
-- grupo vê o nome dele e nada mais" — e neste ponto da fila de migrations esse
-- teste passa por ausência de tabela, que é a forma mais forte de passar.
--
-- ─── POR QUE A IDENTIDADE NASCE AQUI, E NÃO EM `profiles` ──────────────
-- O pedido mais banal do Social ("mostra o nome e o avatar do colega") tem a
-- resposta errada mais cara do projeto. `profiles` guarda monthly_income,
-- medications, health_conditions, sex e birth_year NA MESMA LINHA do `name` —
-- e RLS é de LINHA, não de coluna. Uma política de leitura em `profiles` para
-- membros do grupo entrega o salário e os remédios junto com o nome. Não
-- existe versão segura dessa política: a versão segura é ela não existir.
--
-- Então `display_name` mora em `group_members`. A identidade dentro do grupo é
-- dado DO GRUPO, escolhido POR GRUPO: a mesma pessoa é "Henrique" entre amigos
-- e "H." no grupo do trabalho. Isso não é um extra — é o que torna possível
-- estar num grupo sem se expor nele.
--
-- ─── O GRUPO TEM DATA DE FIM (condição C1 do parecer) ──────────────────
-- `ends_on` é NOT NULL de propósito. O objeto do Social é o COMBINADO, não o
-- mural: "nós quatro, quatro treinos por semana, até dia 30". Presença
-- permanente que só existe para ser rolada é a forma que o parecer vetou, e a
-- forma mais barata de não construí-la é o schema não aceitar um grupo sem
-- fim. Grupo vencido para de publicar sozinho; 30 dias depois a rotina de
-- arquivamento apaga o que foi publicado nele (migration ...180000).
--
-- ─── created_by É `set null`, NÃO `cascade` ────────────────────────────
-- Todo o resto do projeto usa `on delete cascade` para auth.users, e está
-- certo. Aqui, não: apagar a conta de quem criou o grupo não pode apagar a
-- vida registrada das outras seis pessoas. Some o vínculo, fica o grupo, e o
-- gatilho promove o membro mais antigo a dono.
--
-- ─── NENHUMA POLÍTICA AQUI OLHA PARA PLANO (condição C7) ───────────────
-- Participar de grupo é do plano grátis, e cair para o grátis nunca remove
-- ninguém de grupo nenhum. Vínculo social atrás de paywall transforma cancelar
-- em perder amigos — roach motel, e incompatível com "Cancelou? Seus dados
-- continuam seus". Por isso `subscriptions` não aparece em política alguma
-- desta camada, e quem for adicionar um teto pago que o ponha no número de
-- grupos CRIADOS, nunca em participar.
--
-- Idempotente: pode rodar de novo sem estragar nada.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. AS TABELAS ──────────────────────────────────────────────────────

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  -- O combinado tem fim. Ver comentário de topo (C1).
  ends_on     date not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
alter table public.groups enable row level security;

comment on table public.groups is
  'Um combinado com data de fim, não um mural permanente. ends_on é NOT NULL por decisão de produto (parecer do Fiel, C1).';

create table if not exists public.group_members (
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references auth.users(id)    on delete cascade,
  role         text not null default 'member' check (role in ('owner','admin','member')),
  -- Identidade DO GRUPO. Nunca lida de profiles. Ver comentário de topo.
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  avatar_emoji text check (char_length(avatar_emoji) <= 8),
  joined_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user on public.group_members (user_id);
alter table public.group_members enable row level security;

comment on column public.group_members.display_name is
  'O nome que ESTE grupo vê. Não vem de profiles: profiles tem renda e remédios na mesma linha do nome, e RLS não recorta coluna.';

-- Convite: guarda o HASH, nunca o código. A tabela não é lida por quem recebe
-- o convite — aceitar é RPC security definer com teto de tentativas. Mesmo
-- raciocínio dos 6 dígitos do pareamento de WhatsApp (SEGURANCA.md): código
-- curto sem teto é força-brutável até entrar no grupo de outra gente.
-- E `expires_at` existe porque o convite é um link solto no mundo, não porque
-- pressa aumenta conversão — escassez artificial está vetada (parecer, N14).
create table if not exists public.group_invites (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  code_hash  text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  max_uses   int not null default 1 check (max_uses between 1 and 50),
  uses       int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists group_invites_group on public.group_invites (group_id);
alter table public.group_invites enable row level security;

-- ─── A RECUSA FICA REGISTRADA (padrão do MokariInvite) ─────────────────
-- Recusar mata o link na hora — um convite recusado que continua válido é uma
-- porta aberta, e o link circula em grupo de WhatsApp. E a recusa fica gravada
-- para que o app não peça de novo: pedir duas vezes é cobrar.
--
-- SEJA HONESTO SOBRE O LIMITE DISTO: o convite é um CÓDIGO, não uma carta
-- endereçada. Ele não tem destinatário até alguém abri-lo, então o banco não
-- consegue impedir "um segundo convite para a MESMA pessoa" — ele não sabe
-- para quem o primeiro foi. O que esta tabela garante é o que dá para
-- garantir aqui: a recusa existe, é consultável por (grupo, pessoa), e quem
-- desenha a tela de convite tem como não oferecer aquele grupo de novo. O
-- resto é regra de produto, e fica anotado como tal.
--
-- Endereçar o convite resolveria de vez, e não dá: convite endereçado exige
-- buscar pessoas por nome ou e-mail, e descoberta pública está vetada (C6 do
-- parecer do Fiel). Entre um convite endereçado e nenhuma busca de pessoas,
-- fica a segunda — o custo cai sobre o convite, não sobre a privacidade.
create table if not exists public.group_invite_declines (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id  uuid not null references auth.users(id)    on delete cascade,
  at       timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_invite_declines enable row level security;

-- Trilha append-only. Existe para responder "quem me tirou daqui, e quando" —
-- e NUNCA é consultada para decidir acesso. Separar a tabela que audita da
-- tabela que decide é o que permite a segunda não ter estado morto dentro.
create table if not exists public.group_membership_events (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  subject_id uuid references auth.users(id) on delete set null,
  actor_id   uuid references auth.users(id) on delete set null,
  action     text not null check (action in ('entrou','saiu','removido','promovido')),
  at         timestamptz not null default now()
);
create index if not exists gme_group on public.group_membership_events (group_id, at desc);
alter table public.group_membership_events enable row level security;

-- ─── 2. OS HELPERS QUE QUEBRAM A RECURSÃO ───────────────────────────────
--
-- Uma política em group_members que consulta group_members entra em recursão
-- ("infinite recursion detected in policy for relation group_members"), e o
-- conserto que quase todo mundo aplica sob pressão é `using (true)`. Isso não
-- vaza métrica nenhuma: vaza a LISTA DE QUEM ESTÁ EM QUAL GRUPO, que é dado de
-- saúde sozinha — a lista de membros de um "Grupo Recomeço" diz o que nenhuma
-- métrica diria.
--
-- SECURITY DEFINER resolve: a função lê group_members POR FORA da RLS, então a
-- política que a chama não reentra em si mesma.
--
-- E ela pergunta só por auth.uid(), NUNCA por um user_id arbitrário. Uma
-- e_membro(grupo, pessoa) genérica seria um ORÁCULO: qualquer um sondaria
-- "fulano está no Grupo Recomeço?" e receberia sim/não, sem ler uma linha.

create or replace function public.sou_membro(p_group uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members m
     where m.group_id = p_group and m.user_id = auth.uid()
  )
$$;

create or replace function public.sou_admin(p_group uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members m
     where m.group_id = p_group and m.user_id = auth.uid()
       and m.role in ('owner','admin')
  )
$$;

-- Vigente = ainda dá para ESCREVER nele (publicar, entrar, criar desafio).
create or replace function public.grupo_vigente(p_group uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.groups g
     where g.id = p_group and g.archived_at is null and current_date <= g.ends_on
  )
$$;

-- Legível = o combinado acabou, mas o grupo ainda existe para as pessoas verem
-- o fechamento. O arquivamento (30 dias depois) é que apaga.
create or replace function public.grupo_legivel(p_group uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups g where g.id = p_group and g.archived_at is null)
$$;

-- ─── A JANELA: só o período em que NÓS DOIS estávamos aqui ──────────────
--
-- Devolve 'infinity'::date quando não há direito — NUNCA null.
--
-- Isto não é preciosismo: greatest() IGNORA NULL em Postgres.
--   greatest('2026-01-01'::date, null) = '2026-01-01'
-- Ou seja, uma janela escrita como `day >= greatest(entrei, consenti)` ABRE
-- TUDO no dia em que uma das funções devolver null para quem não tem direito.
-- 'infinity' falha fechado: nenhum dia é >= infinity.
create or replace function public.janela_de_visao(p_group uuid, p_subject uuid)
returns date
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select greatest(eu.joined_at, alvo.joined_at)::date
       from public.group_members eu
       join public.group_members alvo
         on alvo.group_id = eu.group_id and alvo.user_id = p_subject
      where eu.group_id = p_group and eu.user_id = auth.uid()),
    'infinity'::date
  )
$$;

comment on function public.janela_de_visao(uuid, uuid) is
  'Primeiro dia em que um vê o outro: a INTERSEÇÃO das duas entradas. Devolve infinity (não null) sem direito — greatest() ignora null e abriria tudo.';

revoke execute on function public.sou_membro(uuid)              from public, anon;
revoke execute on function public.sou_admin(uuid)               from public, anon;
revoke execute on function public.grupo_vigente(uuid)           from public, anon;
revoke execute on function public.grupo_legivel(uuid)           from public, anon;
revoke execute on function public.janela_de_visao(uuid, uuid)   from public, anon;
grant  execute on function public.sou_membro(uuid)              to authenticated;
grant  execute on function public.sou_admin(uuid)               to authenticated;
grant  execute on function public.grupo_vigente(uuid)           to authenticated;
grant  execute on function public.grupo_legivel(uuid)           to authenticated;
grant  execute on function public.janela_de_visao(uuid, uuid)   to authenticated;

-- ─── 3. AS POLÍTICAS ────────────────────────────────────────────────────

drop policy if exists "grupos_select_membro" on public.groups;
create policy "grupos_select_membro" on public.groups for select to authenticated
  using (public.sou_membro(id));

drop policy if exists "grupos_insert_proprio" on public.groups;
create policy "grupos_insert_proprio" on public.groups for insert to authenticated
  with check (created_by = auth.uid() and ends_on >= current_date);

drop policy if exists "grupos_update_admin" on public.groups;
create policy "grupos_update_admin" on public.groups for update to authenticated
  using (public.sou_admin(id)) with check (public.sou_admin(id));

drop policy if exists "grupos_delete_dono" on public.groups;
create policy "grupos_delete_dono" on public.groups for delete to authenticated
  using (exists (select 1 from public.group_members m
                  where m.group_id = groups.id and m.user_id = auth.uid() and m.role = 'owner'));

-- A identidade de quem está na sala. Ver o vazamento nº 1 do modelo.
drop policy if exists "membros_select_do_mesmo_grupo" on public.group_members;
create policy "membros_select_do_mesmo_grupo" on public.group_members for select to authenticated
  using (
    user_id = auth.uid()                           -- minha própria linha, sempre
    or public.sou_membro(group_members.group_id)   -- e as dos grupos em que estou
  );

-- SEM política de INSERT: entrar é sempre por `aceitar_convite` (definer) ou
-- por `criar_grupo`. Sem isso, qualquer um se insere em qualquer grupo cujo id
-- descubra — e id de grupo circula em link de convite.

drop policy if exists "membros_update_propria_identidade" on public.group_members;
create policy "membros_update_propria_identidade" on public.group_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Sair é um toque (parecer, N12): a própria pessoa apaga a própria linha.
-- Admin também apaga (remover). Os gatilhos da migration ...150000 fazem o
-- resto sumir junto.
drop policy if exists "membros_delete_eu_ou_admin" on public.group_members;
create policy "membros_delete_eu_ou_admin" on public.group_members for delete to authenticated
  using (user_id = auth.uid() or public.sou_admin(group_members.group_id));

-- RLS não recorta coluna: a política de update acima deixa a pessoa editar
-- `role` na própria linha e virar owner sozinha. O gatilho é o recorte.
create or replace function public.impedir_autopromocao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and old.user_id = auth.uid() then
    raise exception 'Papel no grupo não se muda sozinho.';
  end if;
  if new.group_id is distinct from old.group_id or new.user_id is distinct from old.user_id then
    raise exception 'Filiação não se transfere.';
  end if;
  return new;
end $$;

drop trigger if exists trg_impedir_autopromocao on public.group_members;
create trigger trg_impedir_autopromocao before update on public.group_members
  for each row execute function public.impedir_autopromocao();

-- Convite: só quem administra enxerga. Quem RECEBE nunca lê esta tabela —
-- entra pela RPC.
drop policy if exists "convites_admin" on public.group_invites;
create policy "convites_admin" on public.group_invites for select to authenticated
  using (public.sou_admin(group_invites.group_id));

drop policy if exists "convites_insert_admin" on public.group_invites;
create policy "convites_insert_admin" on public.group_invites for insert to authenticated
  with check (public.sou_admin(group_invites.group_id)
              and created_by = auth.uid()
              and public.grupo_vigente(group_invites.group_id));

drop policy if exists "convites_update_admin" on public.group_invites;
create policy "convites_update_admin" on public.group_invites for update to authenticated
  using (public.sou_admin(group_invites.group_id))
  with check (public.sou_admin(group_invites.group_id));

drop policy if exists "convites_delete_admin" on public.group_invites;
create policy "convites_delete_admin" on public.group_invites for delete to authenticated
  using (public.sou_admin(group_invites.group_id));

-- A recusa é lida pela própria pessoa (para o app não reoferecer o grupo) e
-- por quem administra (para saber que o convite morreu). Sem política de
-- escrita: só a RPC grava.
drop policy if exists "recusas_select" on public.group_invite_declines;
create policy "recusas_select" on public.group_invite_declines for select to authenticated
  using (user_id = auth.uid() or public.sou_admin(group_invite_declines.group_id));

-- A trilha: a pessoa lê o que aconteceu com ELA, e quem administra lê o do
-- grupo. Sem política de escrita: só as RPCs gravam.
drop policy if exists "trilha_select" on public.group_membership_events;
create policy "trilha_select" on public.group_membership_events for select to authenticated
  using (subject_id = auth.uid() or public.sou_admin(group_membership_events.group_id));

-- ─── 4. AS PORTAS (tudo que cria ou desfaz filiação) ────────────────────

-- Assinatura alinhada com o front (p_nome, p_display_name), com o fim como
-- terceiro parâmetro OPCIONAL. O default de 30 dias existe para a chamada de
-- duas casas funcionar — mas a tela deveria perguntar: a data de fim é o
-- objeto do recurso, não um detalhe de configuração. Um grupo cujo fim o app
-- escolheu sozinho ainda expira (condição C1 continua de pé), só não foi
-- combinado por ninguém.
create or replace function public.criar_grupo(
  p_nome text, p_display_name text, p_ends_on date default (current_date + 30)
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'Sem sessão.'; end if;
  if p_ends_on < current_date then raise exception 'Um combinado não nasce vencido.'; end if;
  insert into public.groups (name, ends_on, created_by) values (p_nome, p_ends_on, auth.uid())
    returning id into g;
  insert into public.group_members (group_id, user_id, role, display_name)
    values (g, auth.uid(), 'owner', p_display_name);
  insert into public.group_membership_events (group_id, subject_id, actor_id, action)
    values (g, auth.uid(), auth.uid(), 'entrou');
  return g;
end $$;

-- ─── EMITIR O CONVITE ───────────────────────────────────────────────────
--
-- Devolve o código EM CLARO uma única vez. A tabela guarda só o hash, então
-- não existe "mostrar o link de novo" — quem perdeu, emite outro. É a mesma
-- decisão de um token de API: um segredo que o servidor consegue remostrar é
-- um segredo que o servidor guarda em claro.
--
-- ─── ADMIN, E NÃO QUALQUER MEMBRO — por quê ────────────────────────────
-- Aqui admitir alguém não é um ato sobre o grupo, é um ato sobre a PRIVACIDADE
-- DE TERCEIROS: pela reciprocidade (C2), quem entra passa a ver o que cada um
-- já compartilha, e ninguém foi consultado. Um membro sozinho não pode tomar,
-- por todos, a decisão de quem passa a enxergar a vida deles.
-- É também a direção reversível: afrouxar depois ("qualquer membro convida")
-- não fere quem já está dentro; apertar depois não tira quem já entrou.
--
-- ─── UM CONVITE, UMA PESSOA, SETE DIAS ─────────────────────────────────
-- max_uses = 1 por construção: link de uso múltiplo que vaza em grupo de
-- WhatsApp é um grupo com gente que ninguém convidou. Sete dias porque é
-- prazo de link solto no mundo, não urgência fabricada — escassez artificial
-- está vetada (parecer, N14), e o app não deve exibir contagem regressiva.
--
-- Teto de três convites vivos por grupo, mais o rate limit: é o que impede
-- carpetar o mundo de links. O teto de TENTATIVAS de aceite continua em
-- aceitar_convite, e um não substitui o outro.
create or replace function public.criar_convite(p_group uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v_codigo text; v_vivos int;
begin
  if auth.uid() is null then raise exception 'Sem sessão.'; end if;
  if not public.sou_admin(p_group) then
    raise exception 'Só quem administra o grupo convida.';
  end if;
  if not public.grupo_vigente(p_group) then
    raise exception 'Este combinado já terminou.';
  end if;
  if not public.reserve_fn_call(auth.uid(), 'criar_convite', 10, 60) then
    raise exception 'Muitos convites em pouco tempo. Tente de novo mais tarde.';
  end if;

  select count(*) into v_vivos from public.group_invites
   where group_id = p_group and revoked_at is null and expires_at > now() and uses < max_uses;
  if v_vivos >= 3 then
    raise exception 'Já existem três convites abertos neste grupo. Use ou revogue um antes de criar outro.';
  end if;

  -- 80 bits de aleatoriedade (20 hex do uuid v4, que vem do gerador de números
  -- aleatórios do servidor). Curto o bastante para caber num link, longo o
  -- bastante para o teto de tentativas ser folga e não defesa.
  -- gen_random_uuid() é nativo; gen_random_bytes() seria pgcrypto, e uma
  -- dependência de extensão aqui faria esta função falhar num ambiente novo
  -- sem ninguém entender por quê (mesma razão do sha256 nativo abaixo).
  v_codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));

  insert into public.group_invites (group_id, code_hash, created_by, expires_at, max_uses)
       values (p_group, encode(sha256(v_codigo::bytea), 'hex'), auth.uid(), now() + interval '7 days', 1);

  return v_codigo;   -- a única vez que ele existe em claro
end $$;

comment on function public.criar_convite(uuid) is
  'Emite um convite de uso único, 7 dias, e devolve o código EM CLARO uma única vez. A tabela guarda só o hash: não há como remostrar.';

-- ─── RECUSAR ────────────────────────────────────────────────────────────
-- Recusar mata o link no mesmo ato. Sem isto, "não, obrigado" deixa uma porta
-- aberta para quem mais tiver o link — e a pessoa acha que fechou a porta.
create or replace function public.recusar_convite(p_codigo text)
returns void
language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if auth.uid() is null then raise exception 'Sem sessão.'; end if;
  if not public.reserve_fn_call(auth.uid(), 'aceitar_convite', 10, 15) then
    raise exception 'Muitas tentativas. Tente de novo em alguns minutos.';
  end if;

  select * into inv from public.group_invites
   where code_hash = encode(sha256(p_codigo::bytea), 'hex') and revoked_at is null;
  if inv.id is null then return; end if;   -- silêncio: não confirma o que não existe

  update public.group_invites set revoked_at = now() where id = inv.id;
  insert into public.group_invite_declines (group_id, user_id)
       values (inv.group_id, auth.uid())
  on conflict (group_id, user_id) do nothing;
end $$;

comment on function public.recusar_convite(text) is
  'Recusar revoga o link na hora e registra a recusa, para o app não oferecer o mesmo grupo de novo. Aceitar depois continua possível: mudar de ideia é dela.';

create or replace function public.aceitar_convite(p_codigo text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if auth.uid() is null then raise exception 'Sem sessão.'; end if;

  -- Teto de tentativas reaproveitando o mesmo controle de abuso das edge
  -- functions. Sem ele, um código curto é força-brutável até entrar no grupo
  -- de outra gente (é o achado que já corrigiu o pareamento de WhatsApp).
  if not public.reserve_fn_call(auth.uid(), 'aceitar_convite', 10, 15) then
    raise exception 'Muitas tentativas. Tente de novo em alguns minutos.';
  end if;

  -- sha256() nativo (PG 11+), não pgcrypto: `set search_path = public` não
  -- enxerga o schema `extensions`, e uma dependência de extensão aqui faria
  -- esta função falhar num ambiente novo sem ninguém entender por quê.
  select * into inv from public.group_invites
   where code_hash = encode(sha256(p_codigo::bytea), 'hex')
     and revoked_at is null and expires_at > now() and uses < max_uses;

  -- Mensagem única para código errado, expirado, revogado e esgotado: dizer
  -- qual dos quatro é confirma para quem sonda que o código existe.
  if inv.id is null then raise exception 'Convite inválido.'; end if;
  if not public.grupo_vigente(inv.group_id) then raise exception 'Convite inválido.'; end if;

  insert into public.group_members (group_id, user_id, display_name)
       values (inv.group_id, auth.uid(), p_display_name)
  on conflict (group_id, user_id) do nothing;

  update public.group_invites set uses = uses + 1 where id = inv.id;
  insert into public.group_membership_events (group_id, subject_id, actor_id, action)
       values (inv.group_id, auth.uid(), auth.uid(), 'entrou');
  return inv.group_id;
end $$;

create or replace function public.sair_do_grupo(p_group uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.group_members where group_id = p_group and user_id = auth.uid();
  insert into public.group_membership_events (group_id, subject_id, actor_id, action)
       values (p_group, auth.uid(), auth.uid(), 'saiu');
end $$;

create or replace function public.remover_membro(p_group uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_admin(p_group) then raise exception 'Só quem administra remove.'; end if;
  if p_user = auth.uid() then raise exception 'Para sair use sair_do_grupo.'; end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  insert into public.group_membership_events (group_id, subject_id, actor_id, action)
       values (p_group, p_user, auth.uid(), 'removido');
end $$;

-- Apagar a conta de quem criou o grupo não pode apagar a vida dos outros:
-- created_by vira null (FK set null) e o membro mais antigo assume.
create or replace function public.promover_quando_dono_sai()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner' then
    update public.group_members m set role = 'owner'
     where m.group_id = old.group_id
       and m.user_id = (select user_id from public.group_members
                         where group_id = old.group_id order by joined_at limit 1);
    insert into public.group_membership_events (group_id, subject_id, actor_id, action)
     select old.group_id, user_id, null, 'promovido' from public.group_members
      where group_id = old.group_id and role = 'owner';
  end if;
  return old;
end $$;

drop trigger if exists trg_promover_quando_dono_sai on public.group_members;
create trigger trg_promover_quando_dono_sai after delete on public.group_members
  for each row execute function public.promover_quando_dono_sai();

revoke execute on function public.criar_grupo(text, text, date)   from public, anon;
revoke execute on function public.criar_convite(uuid)            from public, anon;
revoke execute on function public.recusar_convite(text)          from public, anon;
revoke execute on function public.aceitar_convite(text, text)    from public, anon;
revoke execute on function public.sair_do_grupo(uuid)            from public, anon;
revoke execute on function public.remover_membro(uuid, uuid)     from public, anon;
grant  execute on function public.criar_grupo(text, text, date)   to authenticated;
grant  execute on function public.criar_convite(uuid)            to authenticated;
grant  execute on function public.recusar_convite(text)          to authenticated;
grant  execute on function public.aceitar_convite(text, text)    to authenticated;
grant  execute on function public.sair_do_grupo(uuid)            to authenticated;
grant  execute on function public.remover_membro(uuid, uuid)     to authenticated;

-- ─── 5. O CANÁRIO ───────────────────────────────────────────────────────
-- Falha a migration se alguém tiver aberto uma tabela de dono ao Social. É a
-- regra inegociável do modelo virando verificação executável: life_events,
-- transactions, habit_logs, battles, ai_memories e chat_messages não ganham
-- UMA política nova. Nunca.
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles','life_events','transactions','habit_logs',
                         'battles','battle_checkins','ai_memories','chat_messages')
       and (coalesce(qual,'') ilike '%group_%' or coalesce(with_check,'') ilike '%group_%')
  ) then
    raise exception
      'Tabela de dono com política que menciona grupo. O Social lê projeção, nunca a fonte.';
  end if;
end $$;
