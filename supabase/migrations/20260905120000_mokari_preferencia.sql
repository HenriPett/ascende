-- ═══════════════════════════════════════════════════════════════════════
-- FASE 5 — MOKARI: A PREFERÊNCIA DA PESSOA
--
-- Uma coluna só. O cálculo do Mokari é puro (não precisa de tabela), e o que
-- precisa sobreviver ao fechar do app é uma única resposta: ela quer isso?
--
-- ─── POR QUE NULLABLE E SEM DEFAULT ────────────────────────────────────
-- Toda outra coluna de preferência deste arquivo é `not null default ...`, e
-- quem passar por aqui depois vai querer "consertar" esta para o mesmo padrão.
-- NÃO CONSERTE: a anulabilidade é o dado.
--
--   null   → nunca perguntamos. O convite pode aparecer na Jornada.
--   false  → ela disse não, ou ligou e desligou depois. Silêncio: o convite
--            NÃO volta, e o interruptor em Ajustes fica desligado.
--   true   → ligado.
--
-- Com `default false`, "nunca perguntei" e "ela recusou" viram o mesmo valor,
-- e some a informação que decide se o convite aparece. Aí sobram dois
-- caminhos, os dois ruins: ou o convite reaparece para sempre (vira cobrança,
-- e o produto passa a insistir com quem já disse não), ou nunca aparece (e o
-- recurso não existe para ninguém). O contrato da fase é "peça UMA vez e
-- respeite o silêncio" — e é a coluna anulável que torna isso possível sem
-- tabela nova e sem uma segunda coluna de "já perguntei".
--
-- RLS: nada a fazer. `profiles_update_own` já é own-row e vale para qualquer
-- coluna da linha; e `handle_new_user()` cria a linha no cadastro, então o
-- update do cliente encontra a linha (não é o caso de precisar de upsert).
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists mokari_enabled boolean;

comment on column public.profiles.mokari_enabled is
  'Mokari: null = nunca perguntamos (pode convidar) · false = recusou ou desligou (silêncio) · true = ligado. NULLABLE de propósito — com default os dois primeiros estados viram um só.';
