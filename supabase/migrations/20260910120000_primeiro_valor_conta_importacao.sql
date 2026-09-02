-- ═══════════════════════════════════════════════════════════════════════
-- MEDIDA 1 — QUEM COMEÇA IMPORTANDO TAMBÉM CHEGOU AO PRIMEIRO VALOR
--
-- Correção de um achado da auditoria estática sobre
-- 20260906120000_medidas_de_decisao.sql. A view `metric_time_to_first_value`
-- filtrava assim:
--
--     where e.source in ('form', 'chat_capture')
--       and (e.data_source_id is null or s.status = 'confirmed')
--
-- A intenção da segunda linha (docs/medidas-e-limiares.md) era: evento vindo
-- de importação conta como primeiro valor SE a pessoa confirmou a fonte —
-- confirmar é ato dela, abandonar na prévia não é.
--
-- Só que todo evento importado nasce com `source = 'import'`
-- (captureEvents.ts), e nunca com 'form' nem 'chat_capture'. O primeiro
-- filtro já eliminava esses eventos, então a cláusula do `data_source_id`
-- nunca chegava a decidir nada: era código morto explicando uma regra que a
-- view não aplicava.
--
-- O EFEITO NA MEDIDA, que é o que importa: quem chega, importa o histórico do
-- Sleep Cycle ou do App Saúde e confirma — ou seja, quem teve o MELHOR começo
-- possível — aparecia no relatório como quem nunca registrou nada. A medida
-- que decide "o onboarding é o nosso problema mais caro?" estava contando
-- justamente contra o caminho que funciona.
--
-- Recriamos a view inteira (a migração antiga fica como está, é histórico).
-- ═══════════════════════════════════════════════════════════════════════

drop view if exists public.metric_time_to_first_value;
create view public.metric_time_to_first_value
  with (security_invoker = true) as
with first_value as (
  select e.user_id, min(e.created_at) as first_event_at
  from public.life_events e
  left join public.data_sources s on s.id = e.data_source_id
  where (
    -- Registro que a pessoa fez na mão ou contando para a IA. Se veio
    -- amarrado a um arquivo, a fonte precisa ter sido confirmada.
    (e.source in ('form', 'chat_capture')
       and (e.data_source_id is null or s.status = 'confirmed'))
    -- Importação: conta quando a fonte foi CONFIRMADA. Trazer a própria
    -- história e apertar "confirmar" é primeiro valor — talvez o mais forte
    -- de todos, porque a pessoa acabou de encher o app com a vida dela.
    -- Prévia abandonada continua fora: ali ela desistiu no meio.
    or (e.source = 'import' and s.status = 'confirmed')
  )
  group by e.user_id
)
select
  p.user_id,
  p.created_at as signed_up_at,
  f.first_event_at,
  round(extract(epoch from (f.first_event_at - p.created_at)) / 60.0, 1) as minutes_to_first_value,
  (f.first_event_at is not null
     and f.first_event_at <= p.created_at + interval '24 hours') as reached_in_24h
from public.profiles p
left join first_value f on f.user_id = p.user_id;

grant select on public.metric_time_to_first_value to authenticated;

comment on view public.metric_time_to_first_value is
  'Tempo entre o cadastro e o primeiro registro que a pessoa colocou na própria história. Conta form, chat_capture e importação de fonte CONFIRMADA; created_at, nunca occurred_at.';

-- NOTA para quem revisar os limiares: `source = 'whatsapp'` continua FORA,
-- porque o documento das medidas só nomeia form e chat_capture. Contar a
-- captura pelo WhatsApp (que é a mesma frase, em outro canal) é decisão de
-- produto, não conserto de bug — por isso não entrou aqui de carona.
