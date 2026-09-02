-- ═══════════════════════════════════════════════════════════════════════
-- "A IA GEROU" NÃO É "A PESSOA ATIVOU" — E A TELA HOJE CONFUNDIA OS DOIS
--
-- Achado do diagnóstico de design comportamental.
--
-- `blueprint_generated_at` é carimbado por claim_blueprint() (setup.sql:1075)
-- ANTES da chamada do modelo, e só é desfeito se a geração falhar. Ou seja: o
-- carimbo significa "a IA rodou", nunca "a pessoa quis".
--
-- Só que a tela Hoje o lia como se significasse a segunda coisa:
--
--   src/pages/Hoje.tsx:467, 498, 1212 — `absorbed = !!blueprint_generated_at`
--
-- e `absorbed` desliga a trilha de Primeiros Passos, que é justamente o
-- andaime desenhado para a conta nova sem plano.
--
-- O ONBOARDING OFERECE, CORRETAMENTE, UMA SAÍDA: no fim do passo 7 existe o
-- link "Agora não — quero explorar primeiro" (Onboarding.tsx:821), que avança
-- sem ativar nada. Quem toma essa saída fica assim:
--
--   sem planos    → a zona ActivePlans não renderiza
--   sem metas     → a zona DayProgress não renderiza
--   sem hábitos   → a zona HabitsToday não renderiza
--   `absorbed`    → a trilha de Primeiros Passos não renderiza
--
-- Sobra: cabeçalho, captura, ações rápidas e o convite de assinatura. A pessoa
-- MAIS CAUTELOSA do funil — a que quis olhar antes de ativar — é exatamente a
-- que recebe o app mais vazio, com o paywall como única zona. O andaime existe,
-- está pronto, e é desligado justamente para quem ele foi desenhado.
--
-- A coluna nova separa as duas perguntas. `blueprint_generated_at` continua
-- significando o que sempre significou e continua sendo o que o retrato do
-- Conselheiro lê (_shared/lib.ts:296 fala de "concluiu o onboarding e gerou o
-- Blueprint" — ali a pergunta certa é mesmo sobre a geração).
--
-- ─── O BACKFILL, E POR QUE ELE NÃO É OPCIONAL ───
-- Sem ele, todo mundo que JÁ ativou o Blueprint passaria a ter
-- `blueprint_activated_at` nulo e veria a trilha de Primeiros Passos
-- reaparecer — cobrando uma lista de coisas que essas pessoas já fizeram no
-- dia 1. A marca de quem ativou é objetiva e está nos planos: o `activate()`
-- do onboarding grava `origin = 'blueprint'` (Onboarding.tsx:361).
--
-- Idempotente: pode rodar de novo sem estragar nada.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists blueprint_activated_at timestamptz;

comment on column public.profiles.blueprint_activated_at is
  'Quando a pessoa ATIVOU algo do Blueprint (plano, meta ou compromisso). '
  'Diferente de blueprint_generated_at, que só diz que a IA rodou. '
  'Quem gerou e recusou a ativação continua com este campo nulo, de propósito: '
  'é ele que decide se a trilha de Primeiros Passos ainda faz falta.';

update public.profiles p
   set blueprint_activated_at = p.blueprint_generated_at
 where p.blueprint_activated_at is null
   and p.blueprint_generated_at is not null
   and exists (
     select 1 from public.plans pl
      where pl.user_id = p.user_id and pl.origin = 'blueprint'
   );
