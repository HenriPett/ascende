-- ═══════════════════════════════════════════════════════════════════════
-- ASCENDE — AS SETE MEDIDAS, AGREGADAS (Fase 6)
--
-- COMO RODAR — fora do app, por quem tem a chave:
--
--     psql "$SUPABASE_DB_URL" -f docs/medidas.sql
--
-- ou colando no SQL Editor do painel do Supabase (que já roda com privilégio
-- de serviço). É SOMENTE LEITURA: nenhum insert, update ou delete. Dá para
-- rodar em produção sem medo.
--
-- POR QUE .sql E NÃO UM SCRIPT .mjs
-- Um script em Node precisaria da SERVICE_ROLE_KEY num arquivo ou numa
-- variável de ambiente, de dependências instaladas, e teria permissão de rede
-- — três coisas que um arquivo .sql simplesmente não tem. Este arquivo é
-- inerte: não roda sozinho, não instala nada, não fala com ninguém. Quem o
-- executa já tem a credencial na mão e a usa fora do produto. É o caminho com
-- menos superfície, e é por isso que ele é o honesto aqui.
--
-- POR QUE NÃO É UMA TELA
-- Uma tela de administrador precisaria de privilégio embutido no app: uma
-- rota que enxerga a base inteira, esperando o dia em que um bug de
-- autorização a expõe. As MESMAS views que cada pessoa usa para ver a própria
-- linha (com RLS) devolvem todas as linhas para quem administra o banco. Não
-- existe segunda implementação nem caminho privilegiado dentro do produto.
--
-- ─── AS TRÊS REGRAS DE LEITURA (docs/medidas-e-limiares.md) ────────────
--
-- 1. MEDIANA POR PESSOA, nunca média sobre eventos. Média sobre eventos
--    deixa um usuário intenso responder pelos outros dezenove. Onde a medida
--    é "quantas pessoas fizeram X", a unidade continua sendo a PESSOA: cada
--    uma vale um voto, tenha ela 3 ou 300 registros. A coluna `estatistica`
--    diz qual das duas leituras está na linha.
--
-- 2. DENOMINADOR EXPLÍCITO. Todo número vem com "sobre quantas pessoas ele
--    foi lido". Cada medida tem o seu (quem importou, quem foi perguntado),
--    e eles são diferentes entre si de propósito.
--
-- 3. QUÓRUM DE 20 PESSOAS com 7+ dias entre cadastro e leitura, POR
--    DENOMINADOR — não só no total. Abaixo disso o script imprime
--    INSUFICIENTE e NÃO imprime o número: limiar lido sobre 4 pessoas não é
--    medida, é anedota com casas decimais. Hoje o resultado correto é
--    INSUFICIENTE nas sete, e essa é uma resposta, não um adiamento.
--
-- Nenhuma das duas decisões da fase (D1 integrações nativas, D2 monetização
-- ampliada) pode ser tomada com linha marcada INSUFICIENTE.
-- ═══════════════════════════════════════════════════════════════════════

with

-- ─── Quem pode ser lido ─────────────────────────────────────────────────
-- 7 dias entre cadastro e leitura. Quem entrou ontem não teve tempo de
-- produzir nenhuma das medidas, e incluí-lo só afunda todas elas.
elegiveis as (
  select user_id
  from public.profiles
  where created_at <= now() - interval '7 days'
),

quorum as (select 20 as minimo),

-- ─── Os limiares (docs/medidas-e-limiares.md) ───────────────────────────
-- Mudou lá, muda aqui. São chutes com raciocínio escrito ao lado; quem
-- discordar de um número discute o parágrafo do documento, não a lembrança
-- de quem propôs.
limiares as (
  select
    10::numeric   as t1_minutos,       -- mediana de T1
    0.40::numeric as t1_sem_24h,       -- % que não chega ao 1º evento em 24h
    1.00::numeric as t2_recibo,        -- 100%: promessa binária, não faixa
    0.30::numeric as t2_abandono,      -- abandono na prévia
    0.20::numeric as t3_rejeicao,      -- rejeição de memória
    0.05::numeric as t3_correcao_min,  -- correção baixa = controle invisível
    0.40::numeric as t4_utilidade,
    0.25::numeric as t4_resposta,
    0.50::numeric as t4_insuficientes, -- > 50% => gargalo é volume de dados (D1)
    0.25::numeric as t5_captura_min,   -- abaixo: a tese não pegou
    0.60::numeric as t5_captura_max,   -- acima: conversa É a interface (barra D1)
    0.30::numeric as t6_retorno,
    0.50::numeric as t6_retorno_d2,
    0.30::numeric as t7_adocao,
    0.60::numeric as t7_adocao_alta
),

-- ═══ 1. TEMPO ATÉ O PRIMEIRO VALOR ═════════════════════════════════════
m1 as (
  select
    count(*) filter (where v.minutes_to_first_value is not null)          as denominador,
    round(percentile_cont(0.5) within group (order by v.minutes_to_first_value)::numeric, 1) as mediana,
    -- Quem NUNCA chegou ao primeiro evento não tem T1 e sumiria da mediana
    -- justamente por ser o pior caso. Entra aqui, como segundo corte.
    count(*)                                                             as pessoas,
    round(
      count(*) filter (where not v.reached_in_24h)::numeric / nullif(count(*), 0), 3
    ) as sem_primeiro_evento_24h
  from public.metric_time_to_first_value v
  join elegiveis e on e.user_id = v.user_id
),

-- ═══ 2. IMPORTAÇÕES COM RECIBO ═════════════════════════════════════════
-- Auditoria de promessa, não comportamento: o limiar é 100% e o que decide é
-- a CONTAGEM de fontes confirmadas sem recibo. A mediana por pessoa vai
-- junto, mas uma única fonte sem recibo já reprova — por isso `faltando` tem
-- peso na coluna `situacao`.
m2 as (
  select
    count(*) filter (where v.imports > 0)                                as denominador,
    round(percentile_cont(0.5) within group (order by v.receipt_rate)
      filter (where v.imports > 0)::numeric, 3)                          as mediana,
    sum(v.missing_receipt)                                               as faltando,
    count(*) filter (where v.sources_created > 0)                        as denom_abandono,
    round(percentile_cont(0.5) within group (order by v.preview_abandon_rate)
      filter (where v.sources_created > 0)::numeric, 3)                  as mediana_abandono
  from public.metric_import_receipts v
  join elegiveis e on e.user_id = v.user_id
),

-- ═══ 3. MEMÓRIAS CORRIGIDAS ════════════════════════════════════════════
m3 as (
  select
    count(*) filter (where v.judged > 0)                                 as denominador,
    round(percentile_cont(0.5) within group (order by v.rejection_rate)
      filter (where v.judged > 0)::numeric, 3)                           as mediana_rejeicao,
    count(*) filter (where v.ia_memories > 0)                            as denom_correcao,
    round(percentile_cont(0.5) within group (order by v.correction_rate)
      filter (where v.ia_memories > 0)::numeric, 3)                      as mediana_correcao
  from public.metric_memory_control v
  join elegiveis e on e.user_id = v.user_id
),

-- ═══ 4. INSIGHTS ÚTEIS ═════════════════════════════════════════════════
-- A taxa de resposta é a BARRA DE ERRO da taxa de utilidade: 40% de
-- utilidade sobre 5 respostas não é 40% de nada.
m4 as (
  select
    count(*) filter (where v.answered > 0)                               as denominador,
    round(percentile_cont(0.5) within group (order by v.useful_rate)
      filter (where v.answered > 0)::numeric, 3)                         as mediana_utilidade,
    count(*) filter (where v.asked > 0)                                  as denom_resposta,
    round(percentile_cont(0.5) within group (order by v.answer_rate)
      filter (where v.asked > 0)::numeric, 3)                            as mediana_resposta,
    sum(v.asked_other_status)                                            as perguntas_fora_de_tendencia
  from public.metric_insight_feedback v
  join elegiveis e on e.user_id = v.user_id
),

-- Condição de D1: o gargalo é volume de dados? Proporção de insights
-- calculados que terminaram em `dados_insuficientes`. Aqui a unidade é o
-- INSIGHT (é uma medida sobre o motor, não sobre pessoas), e isso está dito
-- na coluna `estatistica` para ninguém confundir com as outras linhas.
m4b as (
  select
    count(distinct i.user_id)                                            as denominador,
    round(
      count(*) filter (where i.status = 'dados_insuficientes')::numeric / nullif(count(*), 0), 3
    ) as proporcao,
    count(*)                                                             as insights_calculados
  from public.insights i
  join elegiveis e on e.user_id = i.user_id
),

-- ═══ 5. CAPTURA VS NAVEGAÇÃO ═══════════════════════════════════════════
m5 as (
  select
    count(*) filter (where v.considered > 0)                             as denominador,
    round(percentile_cont(0.5) within group (order by v.capture_share)
      filter (where v.considered > 0)::numeric, 3)                       as mediana,
    sum(v.by_whatsapp)                                                   as eventos_whatsapp
  from public.metric_capture_vs_navigation v
  join elegiveis e on e.user_id = v.user_id
),

-- ═══ 6. RETORNO APÓS SILÊNCIO ══════════════════════════════════════════
-- Denominador: quem teve ao menos um silêncio iniciado há 14+ dias (só esses
-- tiveram tempo de terminar). A leitura principal é POR PESSOA — a proporção
-- das que encerraram ao menos um silêncio. A razão silêncios_encerrados ÷
-- silêncios_iniciados do documento vai junto, como referência, mas NÃO é a
-- principal: quem tem dez silêncios pesaria dez vezes mais que quem teve um.
m6 as (
  select
    count(*) filter (where v.eligible_for_silence)                       as denominador,
    round(
      count(*) filter (where v.eligible_for_silence and v.silences_ended > 0)::numeric
        / nullif(count(*) filter (where v.eligible_for_silence), 0), 3
    ) as proporcao_pessoas,
    round(
      sum(v.silences_ended)::numeric / nullif(sum(v.silences_started), 0), 3
    ) as razao_silencios,
    round(percentile_cont(0.5) within group (order by v.median_silence_days)
      filter (where v.eligible_for_silence)::numeric, 1)                 as mediana_duracao
  from public.metric_return_after_silence v
  join elegiveis e on e.user_id = v.user_id
),

-- ═══ 7. REAÇÃO AO COMPANHEIRO ══════════════════════════════════════════
-- Denominador: quem FOI perguntado. `null` fora — nunca perguntamos, então
-- não há reação para medir, e contar null como recusa seria inventar uma
-- resposta que ela não deu.
m7 as (
  select
    count(*) filter (where v.was_asked)                                  as denominador,
    round(
      count(*) filter (where v.state = 'ligado')::numeric
        / nullif(count(*) filter (where v.was_asked), 0), 3
    ) as proporcao,
    count(*) filter (where v.state = 'nunca_perguntamos')                as nunca_perguntamos
  from public.metric_companion_reaction v
  join elegiveis e on e.user_id = v.user_id
)

select * from (
  select
    1 as n,
    'Tempo até o primeiro valor'                                     as medida,
    'mediana por pessoa'                                             as estatistica,
    m1.denominador                                                   as denominador,
    case when m1.denominador >= q.minimo
         then m1.mediana::text || ' min' else 'INSUFICIENTE' end as valor,
    '<= ' || l.t1_minutos || ' min'                                   as limiar,
    case
      when m1.denominador < q.minimo then 'INSUFICIENTE'
      when m1.mediana > l.t1_minutos then 'DECIDIR'
      else 'ok'
    end                                                              as situacao,
    case when m1.denominador >= q.minimo
         then 'Sem chegar ao 1º evento em 24h: ' || coalesce(m1.sem_primeiro_evento_24h::text, '—')
              || ' (limiar ' || l.t1_sem_24h || '). '
         else 'Faltam ' || (q.minimo - m1.denominador) || ' pessoas para o quórum. ' end
      || 'Acima do limiar, o onboarding é o problema mais caro que temos, na frente de qualquer integração nativa.'
                                                                     as decisao
  from m1, limiares l, quorum q

  union all
  select 2, 'Importações com recibo', 'mediana por pessoa', m2.denominador,
    case when m2.denominador >= q.minimo then coalesce(m2.mediana::text, '—') else 'INSUFICIENTE' end,
    '= ' || l.t2_recibo || ' (100%)',
    case
      when m2.denominador < q.minimo then 'INSUFICIENTE'
      when coalesce(m2.faltando, 0) > 0 then 'DECIDIR'
      else 'ok'
    end,
    'Fontes confirmadas SEM recibo: ' || coalesce(m2.faltando, 0)
      || '. Uma única já reprova: é promessa binária da Fase 1, não faixa — e barra as DUAS decisões até ser corrigida. '
      || 'Abandono na prévia (mediana por pessoa): ' || coalesce(m2.mediana_abandono::text, '—')
      || ' sobre ' || m2.denom_abandono || ' pessoas (limiar ' || l.t2_abandono || ').'
  from m2, limiares l, quorum q

  union all
  select 3, 'Rejeição de memória da IA', 'mediana por pessoa', m3.denominador,
    case when m3.denominador >= q.minimo then coalesce(m3.mediana_rejeicao::text, '—') else 'INSUFICIENTE' end,
    '<= ' || l.t3_rejeicao,
    case
      when m3.denominador < q.minimo then 'INSUFICIENTE'
      when m3.mediana_rejeicao > l.t3_rejeicao then 'DECIDIR'
      when m3.denom_correcao >= q.minimo and m3.mediana_correcao < l.t3_correcao_min then 'DECIDIR'
      else 'ok'
    end,
    'Acima do limiar, a qualidade da memória é o problema mais caro. O OUTRO lado: correção (mediana) = '
      || coalesce(m3.mediana_correcao::text, '—') || ' sobre ' || m3.denom_correcao
      || ' pessoas (limiar mínimo ' || l.t3_correcao_min
      || '). Rejeição baixa COM correção baixa não é aprovação, é ausência de opinião: o controle da Fase 2 está invisível.'
  from m3, limiares l, quorum q

  union all
  select 4, 'Insights considerados úteis', 'mediana por pessoa', m4.denominador,
    case when m4.denominador >= q.minimo then coalesce(m4.mediana_utilidade::text, '—') else 'INSUFICIENTE' end,
    '>= ' || l.t4_utilidade || ' (com resposta >= ' || l.t4_resposta || ')',
    case
      when m4.denominador < q.minimo then 'INSUFICIENTE'
      when m4.mediana_utilidade < l.t4_utilidade then 'DECIDIR'
      else 'ok'
    end,
    'Taxa de resposta (mediana): ' || coalesce(m4.mediana_resposta::text, '—')
      || ' sobre ' || m4.denom_resposta || ' pessoas — é a BARRA DE ERRO da utilidade, não métrica secundária. '
      || case when coalesce(m4.perguntas_fora_de_tendencia, 0) > 0
              then 'ATENÇÃO: ' || m4.perguntas_fora_de_tendencia
                   || ' perguntas foram feitas em cards que não são de tendência e ficaram FORA desta conta (o documento manda perguntar só em tendência). '
              else '' end
      || 'Utilidade >= limiar com resposta >= ' || l.t4_resposta || ' é o argumento mais forte a favor da D2.'
  from m4, limiares l, quorum q

  union all
  select 5, 'Registros vindos de captura', 'mediana por pessoa', m5.denominador,
    case when m5.denominador >= q.minimo then coalesce(m5.mediana::text, '—') else 'INSUFICIENTE' end,
    'entre ' || l.t5_captura_min || ' e ' || l.t5_captura_max,
    case
      when m5.denominador < q.minimo then 'INSUFICIENTE'
      when m5.mediana < l.t5_captura_min then 'DECIDIR'
      when m5.mediana > l.t5_captura_max then 'DECIDIR'
      else 'ok'
    end,
    'Abaixo de ' || l.t5_captura_min || ', a captura por conversa não é a espinha do produto e melhorar formulário passa na frente. '
      || 'ACIMA de ' || l.t5_captura_max || ', a conversa É a interface — e aí a integração nativa vale MENOS, não mais: sincronia passiva troca a frase pelo número. '
      || case when coalesce(m5.eventos_whatsapp, 0) > 0
              then 'ATENÇÃO: ' || m5.eventos_whatsapp
                   || ' eventos de WhatsApp estão FORA do numerador (o documento conta só chat_capture). Se esse volume for relevante, o denominador precisa ser revisto.'
              else '' end
  from m5, limiares l, quorum q

  union all
  select 6, 'Voltaram após silêncio', 'proporção de pessoas', m6.denominador,
    case when m6.denominador >= q.minimo then coalesce(m6.proporcao_pessoas::text, '—') else 'INSUFICIENTE' end,
    '>= ' || l.t6_retorno || ' (D2 pede ' || l.t6_retorno_d2 || ')',
    case
      when m6.denominador < q.minimo then 'INSUFICIENTE'
      when m6.proporcao_pessoas < l.t6_retorno then 'DECIDIR'
      else 'ok'
    end,
    'Só quem teve silêncio iniciado há 14+ dias entra (conta nova não tem silêncio, tem começo). '
      || 'Razão silêncios encerrados/iniciados: ' || coalesce(m6.razao_silencios::text, '—')
      || ' (referência; a principal é por pessoa, para quem tem dez silêncios não pesar dez vezes). '
      || 'Mediana da duração do silêncio: ' || coalesce(m6.mediana_duracao::text, '—')
      || ' dias — se ficar em 7-10 E as pessoas voltam, isso é RITMO, não abandono, e o produto não deve tratar lacuna como falha.'
  from m6, limiares l, quorum q

  union all
  select 7, 'Ligaram o companheiro', 'proporção de pessoas', m7.denominador,
    case when m7.denominador >= q.minimo then coalesce(m7.proporcao::text, '—') else 'INSUFICIENTE' end,
    '>= ' || l.t7_adocao,
    case
      when m7.denominador < q.minimo then 'INSUFICIENTE'
      when m7.proporcao < l.t7_adocao then 'DECIDIR'
      else 'ok'
    end,
    'Denominador é quem FOI perguntado; ' || m7.nunca_perguntamos
      || ' pessoas ainda não viram o convite e ficam fora (contá-las como recusa seria inventar resposta). '
      || 'Adoção é PISO: `false` junta "recusou" e "ligou e desligou depois". '
      || 'Acima de ' || l.t7_adocao_alta || ' E com retorno (medida 6) maior entre quem adotou, o Mokari é o mecanismo de retenção e passa na frente do Apple Health.'
  from m7, limiares l, quorum q

  union all
  select 8, 'Insights sem dados suficientes', 'proporção de insights', m4b.denominador,
    case when m4b.denominador >= q.minimo then coalesce(m4b.proporcao::text, '—') else 'INSUFICIENTE' end,
    '> ' || l.t4_insuficientes || ' destrava D1',
    case
      when m4b.denominador < q.minimo then 'INSUFICIENTE'
      when m4b.proporcao > l.t4_insuficientes then 'D1: gargalo é volume'
      else 'ok'
    end,
    'Unidade aqui é o INSIGHT (' || coalesce(m4b.insights_calculados, 0)
      || ' calculados), não a pessoa: é medida sobre o motor. Acima do limiar, o gargalo é volume de dados e a integração nativa é conserto de volume — '
      || 'é a ponte mais limpa entre uma medida e a decisão D1. Sem este número, "precisamos de mais dados" é palpite.'
  from m4b, limiares l, quorum q
) medidas
order by n;
