-- ═══════════════════════════════════════════════════════════════════════
-- XP DO MOKARI: A SOMA QUE RESPEITA A REGRA 3
--
-- O Mokari lia até 6000 linhas de life_events e xp_log para calcular estágio
-- e afinidade. Dois problemas, e o segundo é grave:
--
--   1. custo: mais de 1 MB de JSON por carregamento frio da Jornada;
--   2. CORREÇÃO: o PostgREST corta a resposta no `max-rows` do projeto (1000
--      por padrão no Supabase). Com o corte, um pilar inteiro DESAPARECIA do
--      desenho — medido com a história real do fundador, `prosperidade` caía
--      de nível 3 para 0, e a gema de "ainda não começou" aparecia no lugar
--      dos frutos de 120 lançamentos.
--
-- Este projeto já foi mordido pelo mesmo `max-rows` antes, no XP e no nível;
-- a história está no comentário de src/hooks/useXp.tsx.
--
-- O conserto não é limite maior, é não precisar das linhas: afinidade é
-- contagem por pilar, estágio é soma de XP. Contagem sai do PostgREST
-- (`count: exact, head: true`); a SOMA não, porque precisa EXCLUIR o XP de
-- peso e composição corporal.
--
-- POR QUE A EXCLUSÃO VIVE AQUI, E NÃO NO CLIENTE
-- A regra 3 do Mokari é "nunca ridiculariza o corpo": nada nele muda em função
-- de peso. `xp_total(uid)` soma TUDO, inclusive "Peso registrado" — usá-lo
-- furaria a regra direto. E derivar no cliente
-- (`xp_total − 3×peso − 4×corpo`) fixaria no frontend os pontos do gatilho
-- award_xp_for_event: no dia em que alguém mudasse o gatilho, o XP de peso
-- voltaria a vazar para o estágio EM SILÊNCIO. Aqui a lista de exclusão fica
-- ao lado do gatilho que grava esses motivos.
--
-- ⚠ A LISTA EXISTE EM DOIS LUGARES: aqui e em IGNORED_XP_REASONS
-- (src/lib/mokari.ts). Duas cópias divergem — por isso
-- src/lib/mokariReasons.test.ts lê ESTE arquivo e falha se as listas saírem de
-- sincronia. Se você acrescentar um motivo em um lado, o teste te manda ao
-- outro. Não apague os marcadores abaixo: é por eles que o teste acha a lista.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.xp_total_mokari(uid uuid)
returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(points), 0)::bigint
  from public.xp_log
  where user_id = uid
    -- coalesce: motivo nulo não é XP de peso, então CONTA. Sem ele,
    -- `null <> all(...)` daria NULL e a linha sairia da soma calada.
    and coalesce(reason, '') <> all (array[
      -- IGNORED_XP_REASONS:BEGIN
      'Peso registrado',
      'Composição corporal registrada',
      'Registro: weight',
      'Registro: body'
      -- IGNORED_XP_REASONS:END
    ]);
$$;

comment on function public.xp_total_mokari(uuid) is
  'XP total excluindo peso e composição corporal (regra 3 do Mokari). Use esta, '
  'nunca xp_total(uuid), para calcular o estágio do Mokari.';

grant execute on function public.xp_total_mokari(uuid) to authenticated;
