-- ═══════════════════════════════════════════════════════════════════════
-- PROVENIÊNCIA TAMBÉM NOS LANÇAMENTOS FINANCEIROS
--
-- A migração anterior deu origem e chave externa a `life_events`, mas a
-- importação de fatura grava em `transactions` — o outro caminho de entrada
-- de dado do produto. Sem estas colunas, a fatura teria fonte e recibo, e
-- mesmo assim ninguém conseguiria responder "quais lançamentos vieram deste
-- arquivo?". A promessa da fase é trilha compreensível para TODA importação,
-- então os dois caminhos precisam do mesmo tratamento.
--
-- Mesma semântica de life_events:
-- • data_source_id  → o arquivo que produziu o lançamento (ON DELETE SET NULL:
--   apagar a fonte não apaga o que já foi confirmado, §4.4).
-- • source_record_key → chave estável do registro dentro daquele arquivo, que
--   é o que torna a reimportação idempotente de verdade.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.transactions
  add column if not exists data_source_id uuid references public.data_sources(id) on delete set null;
alter table public.transactions
  add column if not exists source_record_key text;

create unique index if not exists transactions_source_record_unique
  on public.transactions (user_id, data_source_id, source_record_key)
  where data_source_id is not null and source_record_key is not null;

create index if not exists transactions_data_source
  on public.transactions (data_source_id) where data_source_id is not null;
