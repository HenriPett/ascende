-- ═══════════════════════════════════════════════════════════════════════
-- RECONHECER QUEM VOLTOU, SEM APONTAR QUEM SUMIU
--
-- Esta é a Camada 3 do parecer do Fiel — a que ele recomenda construir ANTES
-- do ranking, não depois:
--
--   "O grupo pode reconhecer um retorno ('voltou depois de 9 dias') com o
--    mesmo peso visual de um recorde. (...) É o único lugar onde a comparação
--    social vira cura em vez de ferida: ela cura quando o grupo nota quem
--    voltou, e fere quando o grupo ordena quem produziu."
--
-- ─── A TENSÃO QUE ESTE ARQUIVO RESOLVE, E COMO ─────────────────────────
-- "Voltou depois de 9 dias" e o risco B4-b do mesmo parecer ("o buraco é, ele
-- mesmo, informação; nunca mostre o denominador da janela de outra pessoa")
-- apontam para lados opostos. O 9 é o denominador da ausência.
--
-- A saída é devolver o BIT e não o NÚMERO: `voltou_hoje()` responde sim/não, e
-- nunca quantos dias. O grupo lê "a Ana voltou" e pode comemorar; ninguém lê
-- "a Ana sumiu por nove dias". A função é SECURITY DEFINER exatamente porque a
-- política de group_visible_stats proíbe terceiro de ver qualquer dia que não
-- seja hoje — ou seja, o cálculo do retorno é impossível de fazer no cliente,
-- e essa impossibilidade é a garantia.
--
-- Ela também só responde sobre quem compartilha algo com aquele grupo: sem
-- isso, o retorno de quem não compartilha nada denunciaria a ausência de
-- alguém que nunca abriu nada.
--
-- ─── RECONHECIMENTO É AGREGADO E NÃO ESCALA ────────────────────────────
-- Uma pessoa reconhece um dia de outra, uma vez (a chave primária garante). A
-- tela e o push mostram "3 pessoas reconheceram seu registro de ontem" — sem
-- ranking de quem recebe mais, sem "você está em alta". O teto de notificação
-- é o do app, não o do grupo (parecer, N8): cinco grupos não geram cinco vezes
-- mais push, e nada aqui cria fila de notificação — isso é decisão do agendador,
-- e este arquivo só guarda o fato.
--
-- ─── RECADOS: O ÚNICO LUGAR COM TEXTO ──────────────────────────────────
-- `group_notes` é o único lugar de toda a camada Social com coluna de texto, e
-- ela guarda palavras que a própria pessoa escreveu PARA aquele grupo, sabendo
-- que era para aquele grupo. É a diferença entre publicar e ser publicado. A
-- projeção continua sem texto nenhum.
--
-- E não é mural: a tela do grupo tem começo e fim (parecer, N11). A view devolve
-- o ciclo corrente, com teto — sem "carregar mais" infinito, sem badge de não
-- lidos. Grupo vencido para de aceitar recado sozinho.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.group_recognitions (
  group_id   uuid not null references public.groups(id) on delete cascade,
  giver_id   uuid not null references auth.users(id)    on delete cascade,
  subject_id uuid not null references auth.users(id)    on delete cascade,
  ref_day    date not null,
  created_at timestamptz not null default now(),
  primary key (group_id, giver_id, subject_id, ref_day),
  check (giver_id <> subject_id)
);
create index if not exists recog_subject on public.group_recognitions (subject_id, ref_day desc);
alter table public.group_recognitions enable row level security;

comment on table public.group_recognitions is
  'Reconhecimento de um dia de alguém. Um por pessoa por dia: a contagem não escala e não vira ranking de popularidade.';

create table if not exists public.group_notes (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  author_id  uuid not null references auth.users(id)    on delete cascade,
  text       text not null check (char_length(btrim(text)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists notes_group on public.group_notes (group_id, created_at desc);
alter table public.group_notes enable row level security;

-- ─── O BIT DO RETORNO ───────────────────────────────────────────────────

create or replace function public.voltou_hoje(p_group uuid, p_user uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare tem_hoje boolean; tem_antes boolean;
begin
  -- Portão: só membros perguntam, e só sobre quem compartilha algo aqui.
  if not public.sou_membro(p_group) then return false; end if;
  if not exists (select 1 from public.group_data_consents c
                  where c.group_id = p_group and c.user_id = p_user) then
    return false;
  end if;

  select exists (select 1 from public.group_visible_stats v
                  where v.group_id = p_group and v.user_id = p_user and v.day = current_date)
    into tem_hoje;
  if not tem_hoje then return false; end if;

  select exists (select 1 from public.group_visible_stats v
                  where v.group_id = p_group and v.user_id = p_user
                    and v.day between current_date - 7 and current_date - 1)
    into tem_antes;

  -- Devolve o BIT. Nunca o número de dias. Ver comentário de topo.
  return not tem_antes;
end $$;

comment on function public.voltou_hoje(uuid, uuid) is
  'Sim/não: esta pessoa registrou hoje depois de uma semana sem registrar neste grupo. NUNCA devolve quantos dias — o número é o denominador da ausência.';

revoke execute on function public.voltou_hoje(uuid, uuid) from public, anon;
grant  execute on function public.voltou_hoje(uuid, uuid) to authenticated;

-- ─── POLÍTICAS ──────────────────────────────────────────────────────────

drop policy if exists "reconhecimentos_select_membro" on public.group_recognitions;
create policy "reconhecimentos_select_membro" on public.group_recognitions for select to authenticated
  using (public.sou_membro(group_recognitions.group_id));

drop policy if exists "reconhecimentos_insert_proprio" on public.group_recognitions;
create policy "reconhecimentos_insert_proprio" on public.group_recognitions for insert to authenticated
  with check (giver_id = auth.uid()
              and public.sou_membro(group_recognitions.group_id)
              and public.grupo_vigente(group_recognitions.group_id)
              -- Só se reconhece quem é do grupo: sem isto, dá para carimbar
              -- reconhecimento em cima de um user_id qualquer e descobrir, pelo
              -- erro ou pela ausência dele, se aquela pessoa existe.
              and exists (select 1 from public.group_members m
                           where m.group_id = group_recognitions.group_id
                             and m.user_id  = group_recognitions.subject_id));

drop policy if exists "reconhecimentos_delete_proprio" on public.group_recognitions;
create policy "reconhecimentos_delete_proprio" on public.group_recognitions for delete to authenticated
  using (giver_id = auth.uid());

drop policy if exists "recados_select_membro" on public.group_notes;
create policy "recados_select_membro" on public.group_notes for select to authenticated
  using (public.sou_membro(group_notes.group_id) and public.grupo_legivel(group_notes.group_id));

drop policy if exists "recados_insert_proprio" on public.group_notes;
create policy "recados_insert_proprio" on public.group_notes for insert to authenticated
  with check (author_id = auth.uid()
              and public.sou_membro(group_notes.group_id)
              and public.grupo_vigente(group_notes.group_id));

drop policy if exists "recados_update_proprio" on public.group_notes;
create policy "recados_update_proprio" on public.group_notes for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "recados_delete_proprio_ou_admin" on public.group_notes;
create policy "recados_delete_proprio_ou_admin" on public.group_notes for delete to authenticated
  using (author_id = auth.uid() or public.sou_admin(group_notes.group_id));

-- ─── SAIR APAGA RECADO E RECONHECIMENTO TAMBÉM ──────────────────────────
-- A função nasceu na migration ...150000 com os dois `to_regclass` guardando
-- tabelas que ainda não existiam. Agora existem: esta é a mesma função, com o
-- mesmo nome e o mesmo gatilho, reescrita sem os guardas.
create or replace function public.despublicar_ao_sair()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.group_data_consents  where group_id = old.group_id and user_id = old.user_id;
  delete from public.group_visible_stats  where group_id = old.group_id and user_id = old.user_id;
  delete from public.group_notes          where group_id = old.group_id and author_id = old.user_id;
  delete from public.group_recognitions   where group_id = old.group_id
                                            and (giver_id = old.user_id or subject_id = old.user_id);
  return old;
end $$;

-- ─── AS VIEWS ───────────────────────────────────────────────────────────
-- Todas com security_invoker: rodam com as permissões de quem consulta, então
-- o RLS das tabelas de baixo continua valendo dentro delas. NENHUMA delas é
-- fronteira de segurança — a fronteira é a política.

-- O que o grupo vê HOJE. A política de group_visible_stats já corta tudo:
-- terceiro só aparece com o consentimento dele de pé, dentro da janela, e se
-- eu também compartilhar aquela métrica (reciprocidade).
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
join public.group_members m on m.group_id = v.group_id and m.user_id = v.user_id
join public.shareable_metrics s on s.metric_key = v.metric_key
where v.day >= current_date - 1;

grant select on public.v_grupo_hoje to authenticated;

comment on view public.v_grupo_hoje is
  'O dia de hoje do grupo. Não existe versão desta view com intervalo de datas: série diária de terceiro é o calendário de bolinhas, e ele não sai daqui.';

-- O PREVIEW LITERAL da condição C5: "o que este grupo vê de mim", com os meus
-- dados reais, antes de eu confirmar qualquer coisa. Lista o catálogo inteiro e
-- diz, chave a chave, se está ligado — porque a tela precisa mostrar o que está
-- FECHADO com o mesmo destaque do que está aberto.
create or replace view public.v_meus_consentimentos
  with (security_invoker = true) as
select
  g.id                                   as group_id,
  g.name                                 as group_name,
  s.metric_key,
  s.label,
  s.pillar,
  s.o_que_o_zero_diz,
  (c.metric_key is not null)             as compartilhado,
  c.goal_value,
  c.goal_period,
  c.granted_at,
  -- Quantos dos meus dias deste ano já estão publicados para este grupo com
  -- esta métrica. É o preview honesto: o número que o grupo pode somar.
  (select count(*) from public.group_visible_stats v
    where v.group_id = g.id and v.user_id = auth.uid() and v.metric_key = s.metric_key) as dias_publicados
from public.group_members me
join public.groups g on g.id = me.group_id
cross join public.shareable_metrics s
left join public.group_data_consents c
  on c.group_id = g.id and c.user_id = auth.uid() and c.metric_key = s.metric_key
where me.user_id = auth.uid();

grant select on public.v_meus_consentimentos to authenticated;

-- Os meus grupos, com o fim à vista. `dias_restantes` existe para a tela poder
-- dizer "termina em 3 dias" — factual, serviço puro, que é o único tipo de
-- lembrete de prazo que passa no teste do parecer (§3).
create or replace view public.v_meus_grupos
  with (security_invoker = true) as
select
  g.id,
  g.name,
  g.ends_on,
  (g.ends_on - current_date)                          as dias_restantes,
  (g.archived_at is null and current_date <= g.ends_on) as vigente,
  me.role,
  me.display_name,
  me.joined_at,
  (select count(*) from public.group_members m2 where m2.group_id = g.id) as pessoas
from public.group_members me
join public.groups g on g.id = me.group_id
where me.user_id = auth.uid();

grant select on public.v_meus_grupos to authenticated;
