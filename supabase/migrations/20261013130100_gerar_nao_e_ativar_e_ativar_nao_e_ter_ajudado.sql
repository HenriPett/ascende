-- ═══════════════════════════════════════════════════════════════════════
-- GERAR NÃO É ATIVAR, E ATIVAR NÃO É TER AJUDADO
--
-- Cinco views de medida para o Blueprint da Subida. Nenhuma ferramenta nova,
-- nenhum dado novo coletado: tudo sai de tabelas que a própria pessoa
-- preencheu, pelas mesmas três regras de `docs/medidas-e-limiares.md` —
-- mediana por pessoa, denominador explícito, quórum de 20.
--
-- ─── O ERRO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ───────────────────────
-- Tem uma soma tentadora aqui, e ela seria mentira: juntar "chegou ao
-- primeiro registro", "ativou um plano" e "disse que ajudou" num só número de
-- sucesso. São três fatos diferentes sobre três momentos diferentes, e um não
-- implica o seguinte:
--
--   · registrar prova que a pessoa CHEGOU, não que o plano serviu;
--   · ativar prova que ela ACEITOU, não que usou — ativar é um toque;
--   · só a terceira é juízo dela, e é a única que não dá para inferir.
--
-- Somadas, as três viram um funil que sobe quando a gente melhora o passo
-- mais fácil (ativar) e fica igual quando o difícil (ajudar) piora. Por isso
-- são TRÊS VIEWS e TRÊS LINHAS no relatório, e está escrito em cada
-- `comment on view` que elas não se somam. Quem quiser um número único vai
-- ter que escrever a soma à mão — e aí a responsabilidade é de quem somou.
--
-- ─── O PESO DO ONBOARDING NÃO É PRIMEIRO VALOR ─────────────────────────
-- `metric_time_to_first_value` (medida 1) conta o primeiro `life_events` que a
-- pessoa produziu. Só que o onboarding ESCREVE um `life_events` sozinho: no
-- bloco do corpo, o peso digitado vira `kind='weight'`, `source='form'`
-- (`Onboarding.tsx`, `finishBody`). Ou seja, parte da medida 1 de hoje mede o
-- próprio formulário de cadastro se apresentando como "a pessoa colocou algo
-- na própria história".
--
-- Isso não é bug da medida 1 — ela mede o que prometeu, e o peso É um registro
-- real. É que para decidir "o Blueprint entregou a promessa?" esse evento não
-- serve: ele acontece ANTES de existir qualquer plano, e contá-lo faria o
-- Blueprint parecer eficaz por causa de um campo de formulário.
--
-- CRITÉRIO DE EXCLUSÃO, escrito para poder ser contestado (e nenhuma constante
-- arbitrária nele). Um evento nasceu dentro do onboarding quando os três valem:
--   1. é `kind='weight'`, `source='form'`, `data_source_id is null` — a forma
--      exata e única que o onboarding escreve, e ele escreve UM evento só;
--   2. é o PRIMEIRO evento elegível da pessoa — no fluxo, o bloco do corpo vem
--      antes de qualquer outra tela que registre;
--   3. e, quando há carimbo de geração do Blueprint, foi criado ATÉ ele
--      (`created_at <= profiles.blueprint_generated_at`) — o bloco do corpo
--      vem antes do bloco do Blueprint.
--
-- O item 3 é GUARDA, não filtro: ele protege o caso de quem pulou o campo de
-- peso no onboarding e, semanas depois, registrou um peso pela tela de
-- Vitalidade. Esse é um ato real da pessoa e continua contando.
--
-- O CUSTO, dito agora para ninguém "descobrir" depois: quem pulou o peso no
-- onboarding E cujo primeiro registro de todos foi um peso pelo formulário,
-- ANTES de gerar o Blueprint, é excluído junto. Não dá para distinguir os dois
-- casos sem marcar a linha na origem — e marcar a linha é instrumentação nova,
-- que a Fase 6 recusou. Entre inflar a medida do Blueprint e perder alguns
-- primeiros registros legítimos, esta mesa escolhe perder: medida que nos
-- lisonjeia é pior que medida nenhuma.
--
-- ─── A TERCEIRA MEDIDA NÃO TEM SINAL, E A VIEW EXISTE ASSIM MESMO ──────
-- "Utilidade declarada" é juízo da pessoa. Não existe sinal para planos hoje:
-- `insight_feedback` só aceita os três `kind` de insight, e nada no produto
-- pergunta sobre plano. A view é criada agora, lendo
-- `insight_feedback` com `kind='blueprint_util'`, e devolve zeros — de
-- propósito. `docs/medidas.sql` imprime SEM SINAL AINDA, que é a resposta
-- correta e é uma resposta, não um adiamento.
--
-- Não há UI nova aqui, nem tabela nova, nem `check` relaxado: a pergunta
-- proposta (texto decidido com a Fiel) está escrita em
-- `docs/medidas-e-limiares.md`, com as duas condições para o sinal existir.
--
-- ─── SOMENTE LEITURA ───────────────────────────────────────────────────
-- Cinco views, zero tabelas, zero colunas, zero políticas. Todas com
-- `security_invoker = true`: rodam com a permissão de quem consulta, o RLS das
-- tabelas de origem continua valendo, e cada pessoa vê só a própria linha. O
-- agregado (mediana, quórum, limiar) mora em `docs/medidas.sql`, rodado FORA
-- do app por quem tem a chave — a MESMA view, sem segunda implementação e sem
-- painel privilegiado dentro do produto.
-- ═══════════════════════════════════════════════════════════════════════

-- Esta migration depende das duas tabelas do contrato do Blueprint. Falhar
-- aqui com uma frase é melhor que falhar três views abaixo com
-- "relation does not exist", que manda o leitor caçar o que faltou.
do $$
begin
  if to_regclass('public.blueprint_proposals') is null
     or to_regclass('public.blueprint_events') is null then
    raise exception
      'As views de medida do Blueprint dependem de blueprint_proposals e blueprint_events. Aplique primeiro a migration que as cria (contrato em PLANO.md) e só depois esta.';
  end if;
end $$;

-- Derrubar na ordem INVERSA da dependência, num bloco só. `metric_blueprint_
-- plan_activation` lê `metric_blueprint_funnel`: sem isto, o `drop view if
-- exists` do funnel falha na segunda aplicação ("other objects depend on it")
-- e a migration deixa de ser idempotente — o que o README da casa exige.
-- Explícito e não `cascade`: cascade derrubaria em silêncio qualquer view que
-- alguém venha a pendurar aqui depois, e perder objeto sem aviso é como a
-- suíte de autoteste encolheu em 18/09.
drop view if exists public.metric_blueprint_plan_activation;
drop view if exists public.metric_blueprint_funnel;
drop view if exists public.metric_blueprint_resume_failures;
drop view if exists public.metric_first_record_outside_onboarding;
drop view if exists public.metric_blueprint_declared_usefulness;


-- ═══════════════════════════════════════════════════════════════════════
-- 9. A PROPOSTA GERADA CHEGOU À ATIVAÇÃO EM 24 H?
-- ═══════════════════════════════════════════════════════════════════════
-- Denominador: pessoas com `generated_at`. Quem nunca gerou não tem o que
-- chegar ao fim, e contá-la afundaria a medida com gente que não passou por ali.
--
-- `dismissed_at` é lido SEPARADO e isso é o ponto da view. "Agora não — quero
-- explorar primeiro" é uma escolha que o produto oferece de propósito; somá-la
-- a "gerou e perdeu" transformaria uma opção legítima em taxa de fracasso, e
-- aí a leitura seguinte seria tirar a opção. Dispensar não é falhar.
--
-- `legado_sem_proposta`: quem tem `profiles.blueprint_generated_at` e NENHUMA
-- linha de proposta gerou antes desta correção e perdeu a proposta para
-- sempre. Entra no denominador (gerou de verdade, e de verdade não chegou ao
-- fim), mas vai marcado — senão o dano antigo fica para sempre dentro do
-- número novo, e nenhuma melhoria futura consegue movê-lo.
create view public.metric_blueprint_funnel
  with (security_invoker = true) as
select
  p.user_id,
  p.created_at                                                as signed_up_at,
  coalesce(bp.generated_at, p.blueprint_generated_at)         as generated_at,
  bp.dismissed_at,
  coalesce(bp.activated_at, p.blueprint_activated_at)         as activated_at,
  bp.status,
  (bp.user_id is null and p.blueprint_generated_at is not null) as legado_sem_proposta,
  (bp.dismissed_at is not null and bp.activated_at is null)     as dispensou_e_nao_voltou,
  (coalesce(bp.activated_at, p.blueprint_activated_at) is not null) as activated,
  (
    coalesce(bp.activated_at, p.blueprint_activated_at) is not null
    and coalesce(bp.activated_at, p.blueprint_activated_at)
        <= coalesce(bp.generated_at, p.blueprint_generated_at) + interval '24 hours'
  )                                                           as activated_within_24h,
  round(
    extract(epoch from (
      coalesce(bp.activated_at, p.blueprint_activated_at)
      - coalesce(bp.generated_at, p.blueprint_generated_at)
    )) / 60.0, 1
  )                                                           as minutes_to_activation
from public.profiles p
left join public.blueprint_proposals bp on bp.user_id = p.user_id
where p.blueprint_generated_at is not null
   or bp.generated_at is not null;

grant select on public.metric_blueprint_funnel to authenticated;

comment on view public.metric_blueprint_funnel is
  'Uma linha por pessoa que GEROU um Blueprint. Dispensar ("explorar primeiro") é lido separado de não ativar: é escolha oferecida, não fracasso. legado_sem_proposta marca quem gerou antes da correção e perdeu a proposta — entra no denominador, mas vai rotulado para o dano antigo não virar piso permanente.';


-- ═══════════════════════════════════════════════════════════════════════
-- 10. FALHAS DE RECUPERAÇÃO, POR PESSOA, COM O MOTIVO
-- ═══════════════════════════════════════════════════════════════════════
-- Esta não é medida de comportamento: é AUDITORIA DA NOSSA PRÓPRIA PROMESSA,
-- igual à medida 2 (importação com recibo). A promessa desta branch é "sua
-- proposta não se perde ao recarregar". Cada `resume_failed` é uma vez em que
-- ela não foi cumprida com alguém.
--
-- Por pessoa, e não por evento: quem teve rede ruim e tentou dez vezes não
-- pode responder por dez pessoas. O motivo vai junto porque sem ele a medida
-- não aciona nada — "falhou 7 vezes" não diz se o conserto é no cliente, na
-- função ou no banco.
--
-- `legado_sem_proposta` é separado dos demais motivos: ele é dano de antes da
-- correção, não defeito novo, e misturá-lo faria a medida nascer reprovada e
-- continuar reprovada para sempre.
create view public.metric_blueprint_resume_failures
  with (security_invoker = true) as
with por_motivo as (
  select
    e.user_id,
    coalesce(nullif(btrim(e.detail ->> 'reason'), ''), '(sem motivo registrado)') as reason,
    count(*) as n
  from public.blueprint_events e
  where e.kind = 'resume_failed'
  group by 1, 2
),
falhas as (
  select
    user_id,
    sum(n)                                                       as resume_failures,
    sum(n) filter (where reason = 'legado_sem_proposta')          as falhas_legado,
    sum(n) filter (where reason <> 'legado_sem_proposta')         as falhas_novas,
    jsonb_object_agg(reason, n)                                   as failures_by_reason
  from por_motivo
  group by user_id
),
contexto as (
  -- Os vizinhos do mesmo rastro. Não são a medida, são o que torna o número
  -- acionável: 3 falhas numa pessoa que depois retomou e ativou é ruído de
  -- rede; 3 numa pessoa que nunca mais voltou é a promessa quebrada.
  select
    user_id,
    count(*) filter (where kind = 'generated')         as generated_events,
    count(*) filter (where kind = 'resumed')           as resumed_events,
    count(*) filter (where kind = 'activated')         as activated_events,
    count(*) filter (where kind = 'activation_failed') as activation_failed_events,
    count(*) filter (where kind = 'dismissed')         as dismissed_events
  from public.blueprint_events
  group by user_id
)
select
  c.user_id,
  coalesce(f.resume_failures, 0)                as resume_failures,
  coalesce(f.falhas_novas, 0)                   as resume_failures_novas,
  coalesce(f.falhas_legado, 0)                  as resume_failures_legado,
  f.failures_by_reason,
  c.generated_events,
  c.resumed_events,
  c.activated_events,
  c.activation_failed_events,
  c.dismissed_events,
  -- Falhou e, depois disso, nunca retomou nem ativou: o caso que dói.
  (coalesce(f.falhas_novas, 0) > 0
     and c.resumed_events = 0 and c.activated_events = 0) as falhou_e_nao_voltou
from contexto c
left join falhas f on f.user_id = c.user_id;

grant select on public.metric_blueprint_resume_failures to authenticated;

comment on view public.metric_blueprint_resume_failures is
  'Auditoria da promessa desta branch ("a proposta não se perde"), por PESSOA e com o motivo — sem o motivo o número não aciona conserto nenhum. Falhas de legado ficam separadas das novas: dano de antes da correção não pode virar piso permanente da medida.';


-- ═══════════════════════════════════════════════════════════════════════
-- 11. PRIMEIRO REGISTRO — SEM O QUE NASCEU DENTRO DO ONBOARDING
-- ═══════════════════════════════════════════════════════════════════════
-- Irmã honesta da medida 1, para a pergunta do Blueprint. O critério de
-- exclusão está no cabeçalho deste arquivo, com o custo escrito.
--
-- A elegibilidade do evento é COPIADA de `metric_time_to_first_value` de
-- propósito, linha por linha: duas definições de "primeiro valor" que divergem
-- um dia é como duas verdades nascem. O que muda aqui é só a exclusão.
create view public.metric_first_record_outside_onboarding
  with (security_invoker = true) as
with elegiveis as (
  -- Mesma regra da medida 1: form e chat_capture contam; importação só se a
  -- fonte foi CONFIRMADA (confirmar é ato da pessoa, abandonar na prévia não).
  select e.id, e.user_id, e.created_at, e.kind, e.source, e.data_source_id
  from public.life_events e
  left join public.data_sources s on s.id = e.data_source_id
  where (
    (e.source in ('form', 'chat_capture')
       and (e.data_source_id is null or s.status = 'confirmed'))
    or (e.source = 'import' and s.status = 'confirmed')
  )
),
ordenados as (
  select
    ev.*,
    row_number() over (partition by ev.user_id order by ev.created_at, ev.id) as rn
  from elegiveis ev
),
peso_do_onboarding as (
  -- Os três itens do critério, na ordem em que estão escritos no cabeçalho.
  select o.id, o.user_id
  from ordenados o
  join public.profiles p on p.user_id = o.user_id
  where o.rn = 1
    and o.kind = 'weight'
    and o.source = 'form'
    and o.data_source_id is null
    and (p.blueprint_generated_at is null or o.created_at <= p.blueprint_generated_at)
),
primeiro as (
  select ev.user_id, min(ev.created_at) as first_at
  from elegiveis ev
  where not exists (select 1 from peso_do_onboarding x where x.id = ev.id)
  group by ev.user_id
)
select
  p.user_id,
  p.created_at                                            as signed_up_at,
  f.first_at                                              as first_event_at,
  round(extract(epoch from (f.first_at - p.created_at)) / 60.0, 1) as minutes_to_first_record,
  (f.first_at is not null and f.first_at <= p.created_at + interval '24 hours') as reached_in_24h,
  (ob.user_id is not null)                                as onboarding_weight_excluded
from public.profiles p
left join primeiro f  on f.user_id  = p.user_id
left join peso_do_onboarding ob on ob.user_id = p.user_id;

grant select on public.metric_first_record_outside_onboarding to authenticated;

comment on view public.metric_first_record_outside_onboarding is
  'Primeiro registro que a pessoa colocou na própria história, DESCONTADO o peso que o próprio onboarding escreve. NÃO se soma a metric_blueprint_plan_activation nem a metric_blueprint_declared_usefulness: são três fatos sobre três momentos, e somá-los faz um funil que sobe quando melhoramos o passo mais fácil.';


-- ═══════════════════════════════════════════════════════════════════════
-- 12. PLANO ATIVADO
-- ═══════════════════════════════════════════════════════════════════════
-- Duas fontes que precisam concordar: o carimbo (`activated_at`) e os planos
-- de fato (`plans.origin = 'blueprint'`). Elas divergirem é informação — um
-- carimbo sem plano nenhum é ativação que não aplicou nada.
--
-- `arquivados` existe porque o contrato manda arquivar o plano quando o
-- gatilho de cota recusa. Isso NÃO é escolha da pessoa: é o produto dizendo
-- "aceitei, mas não coube". Somar arquivado com ativo responderia "ela
-- aceitou?" quando a pergunta da medida é "ela FICOU com o plano?".
create view public.metric_blueprint_plan_activation
  with (security_invoker = true) as
with planos as (
  select
    user_id,
    count(*)                                        as blueprint_plans,
    count(*) filter (where status = 'ativo')        as blueprint_plans_active,
    count(*) filter (where status = 'arquivado')    as blueprint_plans_archived
  from public.plans
  where origin = 'blueprint'
  group by user_id
)
select
  f.user_id,
  f.generated_at,
  f.activated_at,
  f.activated,
  coalesce(pl.blueprint_plans, 0)          as blueprint_plans,
  coalesce(pl.blueprint_plans_active, 0)   as blueprint_plans_active,
  coalesce(pl.blueprint_plans_archived, 0) as blueprint_plans_archived,
  (coalesce(pl.blueprint_plans_active, 0) > 0) as ficou_com_plano_ativo,
  -- Carimbou ativação e não sobrou plano nenhum: ou tudo foi arquivado pela
  -- cota, ou a pessoa só aceitou metas/hábitos. Separar é o que impede a
  -- medida de dizer "ativou" para quem terminou sem plano na mão.
  (f.activated and coalesce(pl.blueprint_plans, 0) = 0) as ativou_sem_plano
from public.metric_blueprint_funnel f
left join planos pl on pl.user_id = f.user_id;

grant select on public.metric_blueprint_plan_activation to authenticated;

comment on view public.metric_blueprint_plan_activation is
  'Quem gerou um Blueprint e FICOU com plano ativo vindo dele. Arquivado por cota conta separado: não é escolha da pessoa, é o produto dizendo "aceitei, mas não coube". NÃO se soma às outras duas medidas do trio.';


-- ═══════════════════════════════════════════════════════════════════════
-- 13. UTILIDADE DECLARADA — SEM SINAL AINDA, E A VIEW JÁ EXISTE
-- ═══════════════════════════════════════════════════════════════════════
-- Mesmo formato da medida 4, e de propósito: utilidade é juízo da pessoa e não
-- se infere de comportamento. Ativar não prova que ajudou; arquivar não prova
-- que atrapalhou.
--
-- Hoje esta view devolve ZEROS para todo mundo, porque nada no produto
-- pergunta. Ela existe assim mesmo para que o dia em que o sinal nascer seja
-- uma migration de UI e não uma discussão sobre como medir — e para que
-- `docs/medidas.sql` possa imprimir SEM SINAL AINDA em vez de omitir a linha.
-- Medida omitida é medida esquecida.
--
-- PARA O SINAL EXISTIR, duas coisas (nenhuma delas aqui):
--   1. a pergunta na tela, com o texto decidido com a Fiel e as condições
--      dela, em `docs/medidas-e-limiares.md`;
--   2. `insight_feedback_kind_valido` passar a aceitar 'blueprint_util'.
--
-- Por que `insight_feedback` e não uma tabela nova: é a única mesa do produto
-- onde a pessoa responde uma pergunta, e a medida 4 já mora lá com este exato
-- formato. Tabela nova para uma coluna de resposta é instrumentação nova, que
-- a Fase 6 recusou. O `check` que hoje barra o kind novo é o atrito certo:
-- obriga quem criar a pergunta a passar por uma migration.
-- (`insight_id` fica nulo para este kind — a pergunta é sobre plano, não sobre
-- insight. A coluna é anulável, e o FK é `on delete set null`.)
create view public.metric_blueprint_declared_usefulness
  with (security_invoker = true) as
select
  user_id,
  count(*)                                        as asked,
  count(*) filter (where answer is not null)      as answered,
  count(*) filter (where answer = 'sim')          as useful,
  count(*) filter (where answer = 'nao')          as not_useful,
  round(
    count(*) filter (where answer = 'sim')::numeric
      / nullif(count(*) filter (where answer is not null), 0), 3
  )                                               as useful_rate,
  round(
    count(*) filter (where answer is not null)::numeric
      / nullif(count(*), 0), 3
  )                                               as answer_rate
from public.insight_feedback
where kind = 'blueprint_util'
group by user_id;

grant select on public.metric_blueprint_declared_usefulness to authenticated;

comment on view public.metric_blueprint_declared_usefulness is
  'Utilidade DECLARADA do plano do Blueprint, no formato da medida 4. Devolve zeros hoje: nada no produto pergunta, e inferir utilidade de comportamento seria inventar a resposta. A view existe para a medida aparecer como SEM SINAL AINDA em vez de sumir do relatório.';
