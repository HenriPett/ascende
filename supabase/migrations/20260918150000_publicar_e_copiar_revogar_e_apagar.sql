-- ═══════════════════════════════════════════════════════════════════════
-- PUBLICAR É COPIAR; REVOGAR É APAGAR
--
-- Este arquivo existe por causa de uma frase do parecer do Fiel (B4-a), que
-- está certa e é cara:
--
--   "Regra de privacidade como cláusula WHERE é regra a um bug de distância.
--    A janela esconde o passado, ela não o apaga. Uma regressão de um
--    caractere nesse predicado reexpõe um ano de histórico num deploy,
--    silenciosamente, para pessoas reais."
--
-- O desenho óbvio seria manter só a projeção pessoal e filtrá-la na leitura
-- com um predicado de consentimento. Tem elegância e tem um problema fatal: a
-- segurança inteira passa a morar num WHERE, e um WHERE é uma linha que
-- alguém edita.
--
-- Então o dado publicado é uma CÓPIA, uma por grupo. Uma linha só existe aqui
-- porque a pessoa é membro daquele grupo AGORA e consentiu aquela métrica
-- naquele grupo AGORA. Desligar o toggle APAGA as linhas daquele metric_key;
-- sair do grupo APAGA as linhas daquele grupo. A política continua existindo
-- como SEGUNDA parede — mas a primeira é a deleção, e deleção não regride num
-- deploy. É também o que a promessa "desligar apaga retroativo" (parecer, N12)
-- exige de fato.
--
-- ─── O QUE ISSO CUSTA, dito e aceito por escrito ───────────────────────
-- 1. Segunda fonte da verdade, que pode divergir. Paga com a rotina de
--    reconciliação da migration ...180000 — custo permanente, não uma vez.
-- 2. Amplificação de escrita: um treino registrado toca 1 linha na projeção
--    pessoal + 1 por grupo aqui.
-- 3. Volume: 3 grupos x 8 métricas x 365 dias ~ 9k linhas/ano/pessoa, e só nos
--    dias em que houve ato. Irrelevante para este produto.
-- O custo compra a diferença entre "escondido" e "apagado".
--
-- ─── A META ATRAVESSA A PUBLICAÇÃO JUNTO COM O VALOR ───────────────────
-- `goal_value` é copiado do consentimento. Nenhuma linha sai daqui sem a régua
-- da própria pessoa ao lado, porque um número solto ao lado do número solto de
-- outra pessoa É um ranking, mesmo sem coluna de posição (parecer, C3 e B2).
--
-- ATENÇÃO: é a meta DA PESSOA, nunca o tamanho da janela. "Ana: 3 de 3" pode;
-- "Ana: 3 de 14 dias" não. O denominador da JANELA deixa visível o buraco que
-- a revogação abre, e transforma o controle de privacidade em sinal social
-- (parecer, B4-b).
--
-- ─── TERCEIRO NUNCA RECEBE SÉRIE DIÁRIA ────────────────────────────────
-- A tabela é por dia e por pessoa, o que deixa o calendário de bolinhas da
-- vida de alguém a um SELECT de distância — o artefato de vergonha mais
-- eficiente desta categoria de app. Por isso a política de leitura de terceiro
-- libera APENAS `day >= current_date - 1` (hoje, com folga de fuso e de
-- registro atrasado). Histórico sai exclusivamente como TOTAL DE CICLO, por
-- função agregada que não tem parâmetro de data (migration ...160000).
--
-- ─── RECIPROCIDADE (condição C2) ───────────────────────────────────────
-- Você só vê de alguém o tipo de dado que você também compartilha com aquele
-- grupo. Sem espectador. Está na política, não na tela: uma regra de
-- reciprocidade que vive no front é uma regra que não existe.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.group_visible_stats (
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id)    on delete cascade,
  day        date not null,
  metric_key text not null references public.shareable_metrics(metric_key),
  value      numeric not null check (value >= 0),
  -- O denominador viaja grudado no valor. Ver comentário de topo.
  goal_value numeric not null check (goal_value > 0),
  primary key (group_id, user_id, day, metric_key)
);
create index if not exists gvs_grupo_dia on public.group_visible_stats (group_id, day desc);
create index if not exists gvs_user on public.group_visible_stats (user_id, day desc);
alter table public.group_visible_stats enable row level security;

comment on table public.group_visible_stats is
  'A cópia PUBLICADA, uma por grupo. A linha existe porque há filiação e consentimento vigentes; revogar apaga a linha, não esconde.';

-- ─── PUBLICAR ───────────────────────────────────────────────────────────

create or replace function public.publicar_dia(p_user uuid, p_day date)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Republica a fatia inteira: apaga e reescreve o que ainda tem direito.
  -- Fazer assim, em vez de um upsert, é o que faz a publicação HERDAR toda
  -- revogação automaticamente — se o consentimento sumiu entre uma escrita e
  -- outra, a linha não volta.
  delete from public.group_visible_stats where user_id = p_user and day = p_day;

  insert into public.group_visible_stats (group_id, user_id, day, metric_key, value, goal_value)
  select c.group_id, s.user_id, s.day, s.metric_key, s.value, c.goal_value
    from public.shared_daily_stats s
    join public.group_data_consents c
      on c.user_id = s.user_id and c.metric_key = s.metric_key
    join public.group_members m
      on m.group_id = c.group_id and m.user_id = s.user_id
    join public.groups g
      on g.id = c.group_id
   where s.user_id = p_user
     and s.day     = p_day
     -- As três bordas da janela, todas conferidas na ESCRITA (a política as
     -- confere de novo na leitura, de propósito):
     and s.day >= c.granted_at::date   -- ligar hoje não mostra ontem
     and s.day >= m.joined_at::date    -- e não mostra o que é de antes de eu entrar
     and s.day <= g.ends_on            -- e o combinado tem fim
     and g.archived_at is null;
end $$;

comment on function public.publicar_dia(uuid, date) is
  'Copia a projeção pessoal de um dia para cada grupo que tem consentimento vigente. Apaga e reescreve: nunca upsert, para herdar revogação.';

revoke execute on function public.publicar_dia(uuid, date) from public, anon, authenticated;

-- ─── REVOGAR ────────────────────────────────────────────────────────────
--
-- Os dois gatilhos abaixo são a prova de (a) "desligar um tipo de dado" e
-- (b) "sair do grupo" terem efeito imediato: não há predicado a conferir,
-- as linhas deixam de existir.

create or replace function public.despublicar_ao_revogar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.group_visible_stats v
   where v.group_id = old.group_id and v.user_id = old.user_id and v.metric_key = old.metric_key;

  -- A trilha e a deleção são o mesmo ato: não podem acontecer uma sem a outra.
  --
  -- A guarda do `exists` não é zelo, é o que faz APAGAR A CONTA funcionar. Ao
  -- excluir auth.users, a cascata apaga os consentimentos e dispara este
  -- gatilho — e a linha de trilha apontaria para um usuário que, naquele
  -- instante, já não existe. A FK recusa, a exclusão inteira sofre rollback, e
  -- a conta não é apagada. Quando a pessoa está indo embora não há trilha a
  -- guardar: guardar seria o oposto do que a exclusão promete.
  if exists (select 1 from auth.users u where u.id = old.user_id) then
    insert into public.consent_events (user_id, group_id, metric_key, action)
         values (old.user_id, old.group_id, old.metric_key, 'desligou');
  end if;
  return old;
end $$;

drop trigger if exists trg_despublicar_ao_revogar on public.group_data_consents;
create trigger trg_despublicar_ao_revogar after delete on public.group_data_consents
  for each row execute function public.despublicar_ao_revogar();

create or replace function public.despublicar_ao_sair()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Apagar o consentimento dispara o gatilho de cima para cada métrica; a
  -- segunda deleção é a mesma regra aplicada duas vezes, de propósito — se um
  -- dia o gatilho de cima for removido por engano, esta linha ainda fecha.
  delete from public.group_data_consents c
   where c.group_id = old.group_id and c.user_id = old.user_id;
  delete from public.group_visible_stats v
   where v.group_id = old.group_id and v.user_id = old.user_id;
  -- Recados e reconhecimentos nascem na migration ...170000; esta função é
  -- substituída lá para limpá-los também. Guardado por to_regclass para que a
  -- fila de migrations possa rodar pela metade sem quebrar.
  if to_regclass('public.group_notes') is not null then
    execute 'delete from public.group_notes where group_id = $1 and author_id = $2'
      using old.group_id, old.user_id;
  end if;
  if to_regclass('public.group_recognitions') is not null then
    execute 'delete from public.group_recognitions where group_id = $1 and (giver_id = $2 or subject_id = $2)'
      using old.group_id, old.user_id;
  end if;
  return old;
end $$;

drop trigger if exists trg_despublicar_ao_sair on public.group_members;
create trigger trg_despublicar_ao_sair after delete on public.group_members
  for each row execute function public.despublicar_ao_sair();

-- Ligar um consentimento publica o dia de hoje na hora (o único dia que a
-- janela permite). Sem isto, a pessoa liga o toggle e o grupo só a enxerga
-- amanhã, depois do próximo registro — e ela conclui que ligar não funcionou.
create or replace function public.publicar_ao_ligar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.publicar_dia(new.user_id, current_date);
  return new;
end $$;

drop trigger if exists trg_publicar_ao_ligar on public.group_data_consents;
create trigger trg_publicar_ao_ligar after insert on public.group_data_consents
  for each row execute function public.publicar_ao_ligar();

-- Encurtar o fim do combinado tem de encolher o que já foi publicado. Sem
-- isto, um grupo que termina mais cedo continua exibindo os dias de depois.
create or replace function public.encolher_publicacao_ao_encurtar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ends_on < old.ends_on then
    delete from public.group_visible_stats where group_id = new.id and day > new.ends_on;
  end if;
  return new;
end $$;

drop trigger if exists trg_encolher_publicacao on public.groups;
create trigger trg_encolher_publicacao after update of ends_on on public.groups
  for each row execute function public.encolher_publicacao_ao_encurtar();

-- ─── A POLÍTICA ─────────────────────────────────────────────────────────
--
-- Seis condições. Cada uma existe por um vazamento concreto; quem for mexer
-- aqui, leia o comentário da linha antes de apagá-la.

drop policy if exists "grupo_le_so_o_que_foi_liberado_naquele_grupo" on public.group_visible_stats;
create policy "grupo_le_so_o_que_foi_liberado_naquele_grupo"
on public.group_visible_stats for select to authenticated
using (
  -- (1) Eu estou neste grupo. Via função SECURITY DEFINER: uma política em
  --     group_members que consulta group_members entra em recursão, e o
  --     conserto apressado (`using (true)`) entrega a lista de quem está em
  --     qual grupo — que é dado de saúde sozinha.
  public.sou_membro(group_visible_stats.group_id)

  -- (2) O grupo não foi arquivado.
  and public.grupo_legivel(group_visible_stats.group_id)

  and (
    -- (3) A minha própria linha eu vejo sempre e inteira. É o que permite a
    --     tela de consentimento mostrar o PREVIEW LITERAL do que o grupo verá
    --     (condição C5) sem precisar de nenhuma exceção de política.
    group_visible_stats.user_id = auth.uid()

    or (
      -- (4) De terceiro, só HOJE. A tabela é por dia; sem esta linha um SELECT
      --     devolve o calendário de bolinhas da vida de alguém. O histórico
      --     sai só como total de ciclo, por função sem parâmetro de data.
      group_visible_stats.day >= current_date - 1

      -- (5) A janela: só o período em que nós dois estávamos aqui, e só a
      --     partir do dia em que a pessoa ligou ESTA métrica NESTE grupo.
      --     As duas funções devolvem 'infinity' quando não há direito, nunca
      --     null — greatest()/comparação com null abriria tudo.
      and group_visible_stats.day >= public.janela_de_visao(
            group_visible_stats.group_id, group_visible_stats.user_id)
      and group_visible_stats.day >= public.consentiu(
            group_visible_stats.group_id, group_visible_stats.user_id,
            group_visible_stats.metric_key)

      -- (6) RECIPROCIDADE (condição C2): eu só vejo o tipo de dado que eu
      --     também dou a este grupo. Sem espectador. Note que a comparação é
      --     com 'infinity': `consentiu` devolve a data do MEU consentimento, e
      --     infinity significa que eu não compartilho isto aqui.
      and public.consentiu(group_visible_stats.group_id, auth.uid(),
                           group_visible_stats.metric_key) <> 'infinity'::date
    )
  )
);

-- Nenhuma política de INSERT/UPDATE/DELETE. Só `publicar_dia` escreve, e ele é
-- definer. O erro de perder o `group_id` no caminho — publicar no grupo errado
-- o que foi liberado em outro — seria cometido AQUI, no fan-out, e a política
-- correta leria a linha errada com toda a razão. Por isso o join de
-- publicar_dia amarra c.group_id = m.group_id = g.id, e por isso a política
-- confere o consentimento de novo na leitura.
