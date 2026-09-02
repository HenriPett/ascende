-- ═══════════════════════════════════════════════════════════════════════
-- FASE 2 — MEMÓRIA CONTROLÁVEL
--
-- Hoje a memória é uma lista plana que só a IA escreve: a pessoa lê e apaga,
-- e é só isso. Não dá para dizer "isso aqui está certo", "isso mudou", "isso
-- valeu por um tempo e acabou" — e uma memória errada, sem como corrigir,
-- envenena todo turno seguinte do Conselheiro (foi assim que ele inventou um
-- café da manhã que nunca existiu, 30/08).
--
-- Esta migração dá à memória três coisas que ela não tinha:
--   1. ESTADO — ativa, confirmada pela pessoa, rejeitada, expirada;
--   2. TEMPO  — desde quando vale, até quando vale, quando foi verificada;
--   3. ORIGEM — de qual evento, mensagem ou arquivo ela nasceu (memory_sources).
--
-- REGRA DE LEITURA (vale para buildSnapshot e para QUALQUER lugar que leia
-- memória — está materializada na view ai_memories_vigentes, no fim deste
-- arquivo, para não ser reimplementada de três jeitos diferentes):
--   status <> 'rejeitada' and status <> 'expirada'
--   and (valid_until is null or valid_until > now())
-- E memória 'confirmada' pesa mais que 'ativa': aparece ANTES no retrato.
--
-- Valores em português (a convenção do repositório: plans.status usa 'ativo').
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. ESTADO, TEMPO E AUTORIA NA MEMÓRIA ──────────────────────────────
alter table public.ai_memories
  add column if not exists status text not null default 'ativa',
  add column if not exists confidence numeric,
  add column if not exists valid_from timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists sensitivity text not null default 'normal',
  add column if not exists created_by text not null default 'ia';

comment on column public.ai_memories.status is
  'ativa | confirmada (pela pessoa) | rejeitada | expirada';
comment on column public.ai_memories.confidence is
  '0..1 — o quanto a IA se sente segura do que guardou. Null = não declarou.';
comment on column public.ai_memories.valid_until is
  'Memória temporária: depois deste instante ela não entra mais no retrato.';
comment on column public.ai_memories.created_by is
  'ia | usuario — quem escreveu. Editar uma memória da IA não muda a autoria.';

-- Os CHECKs vão em bloco guardado, e não junto do ADD COLUMN: se a coluna já
-- existir (execução parcial anterior), o ADD inteiro é ignorado em silêncio e
-- a restrição nunca nasceria.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_memories_status_valido') then
    alter table public.ai_memories add constraint ai_memories_status_valido
      check (status in ('ativa', 'confirmada', 'rejeitada', 'expirada'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ai_memories_confidence_faixa') then
    alter table public.ai_memories add constraint ai_memories_confidence_faixa
      check (confidence is null or (confidence >= 0 and confidence <= 1));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ai_memories_sensitivity_valida') then
    alter table public.ai_memories add constraint ai_memories_sensitivity_valida
      check (sensitivity in ('normal', 'sensivel'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ai_memories_created_by_valido') then
    alter table public.ai_memories add constraint ai_memories_created_by_valido
      check (created_by in ('ia', 'usuario'));
  end if;

  -- Prazo que termina antes de começar é erro de escrita, não dado.
  if not exists (select 1 from pg_constraint where conname = 'ai_memories_validade_coerente') then
    alter table public.ai_memories add constraint ai_memories_validade_coerente
      check (valid_until is null or valid_from is null or valid_until > valid_from);
  end if;
end $$;

-- ─── 2. RLS: A PESSOA PRECISA PODER CORRIGIR ────────────────────────────
-- Até aqui o usuário só tinha SELECT e DELETE (a escrita era exclusiva das
-- funções de IA, via service role). A Fase 2 inteira é sobre corrigir e
-- confirmar — e, sem policy de UPDATE, o update do cliente NÃO dá erro: ele
-- casa com zero linhas e volta "ok". A tela diria "salvo" e nada teria
-- mudado. É o pior modo de falha possível para uma promessa de controle.
drop policy if exists "memories_update_own" on public.ai_memories;
create policy "memories_update_own" on public.ai_memories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- INSERT do próprio usuário: ensinar algo direto ("moro em Jaraguá do Sul").
-- `created_by` travado em 'usuario' no WITH CHECK — ninguém, nem por engano,
-- grava uma memória sua fingindo que a IA aprendeu sozinha.
drop policy if exists "memories_insert_own" on public.ai_memories;
create policy "memories_insert_own" on public.ai_memories
  for insert with check (auth.uid() = user_id and created_by = 'usuario');

-- ─── 3. ORIGEM DA MEMÓRIA ───────────────────────────────────────────────
-- "Por que você acha isso sobre mim?" precisa ter resposta. Cada memória
-- pode apontar os registros que a produziram: um evento, uma mensagem do
-- chat, um arquivo importado (data_sources, da Fase 1).
-- `ref_id` é polimórfico (aponta três tabelas), então não tem FK — as três
-- chaves são uuid, e apagar o registro apontado apenas deixa a origem órfã,
-- o que é melhor que perder a memória junto.
create table if not exists public.memory_sources (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.ai_memories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- life_event | chat_message | data_source
  kind text not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memory_sources_kind_valido') then
    alter table public.memory_sources add constraint memory_sources_kind_valido
      check (kind in ('life_event', 'chat_message', 'data_source'));
  end if;
end $$;

alter table public.memory_sources enable row level security;
drop policy if exists "memory_sources_all_own" on public.memory_sources;
create policy "memory_sources_all_own" on public.memory_sources
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists memory_sources_memory
  on public.memory_sources (memory_id);
create index if not exists memory_sources_user_time
  on public.memory_sources (user_id, created_at desc);
-- A mesma extração rodando duas vezes não pode empilhar a mesma origem.
create unique index if not exists memory_sources_unique
  on public.memory_sources (memory_id, kind, ref_id) where ref_id is not null;

-- ─── 4. ÍNDICES DO CAMINHO QUENTE ───────────────────────────────────────
-- Toda mensagem do Conselheiro monta o retrato, e montar o retrato lê as
-- memórias VIGENTES da pessoa. O índice parcial cobre exatamente o filtro da
-- regra de leitura (a parte de valid_until fica de fora: now() não é
-- imutável e não pode entrar em predicado de índice).
create index if not exists ai_memories_user_vigentes
  on public.ai_memories (user_id, created_at desc)
  where status <> 'rejeitada' and status <> 'expirada';

-- Varredura de vencidas (quem já passou do prazo).
create index if not exists ai_memories_valid_until
  on public.ai_memories (valid_until) where valid_until is not null;

-- ─── 5. A REGRA DE LEITURA, EM UM LUGAR SÓ ──────────────────────────────
-- Três consumidores leem memória (buildSnapshot, a extração que evita
-- duplicar, e a tela de Ajustes). Se cada um reescrever o filtro, um deles
-- vai esquecer o valid_until e o Conselheiro vai citar uma memória vencida —
-- exatamente o que esta fase existe para impedir.
--
-- `trust_rank` carrega a segunda metade da regra: 0 para o que a pessoa
-- confirmou, 1 para o resto. Ordenar por (trust_rank, created_at desc) põe a
-- palavra dela na frente da suposição da IA.
--
-- security_invoker: a view roda com as permissões de QUEM CONSULTA, então o
-- RLS de ai_memories continua valendo. Sem isso, a view rodaria como dona da
-- tabela e viraria um vazamento entre contas.
create or replace view public.ai_memories_vigentes
  with (security_invoker = true) as
  select
    m.*,
    case when m.status = 'confirmada' then 0 else 1 end as trust_rank
  from public.ai_memories m
  where m.status <> 'rejeitada'
    and m.status <> 'expirada'
    and (m.valid_until is null or m.valid_until > now());

grant select on public.ai_memories_vigentes to authenticated;
