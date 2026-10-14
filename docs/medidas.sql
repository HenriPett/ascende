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
    0.60::numeric as t7_adocao_alta,
    -- Blueprint (medidas 9-13). As 11 e 13 reaproveitam t1_* e t4_* de
    -- propósito: medir o primeiro registro e a utilidade com réguas
    -- diferentes das medidas 1 e 4 seria criar duas verdades.
    0.60::numeric as t9_ativacao_24h,
    0.40::numeric as t12_plano_ativo
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
),

-- ═══ 9. A PROPOSTA GERADA CHEGOU À ATIVAÇÃO EM 24 H ════════════════════
-- Denominador: quem GEROU. Dispensar ("explorar primeiro") é lido ao lado,
-- nunca dentro do numerador: é opção que o produto oferece de propósito, e
-- somá-la a fracasso faria a leitura seguinte ser tirar a opção da tela.
m9 as (
  select
    count(*)                                                             as denominador,
    round(
      count(*) filter (where v.activated_within_24h)::numeric / nullif(count(*), 0), 3
    )                                                                    as proporcao,
    count(*) filter (where v.dispensou_e_nao_voltou)                     as dispensaram,
    count(*) filter (where v.legado_sem_proposta)                        as legado,
    round(percentile_cont(0.5) within group (order by v.minutes_to_activation)
      filter (where v.activated)::numeric, 1)                            as mediana_minutos
  from public.metric_blueprint_funnel v
  join elegiveis e on e.user_id = v.user_id
),

-- ═══ 10. FALHAS DE RECUPERAÇÃO ═════════════════════════════════════════
-- Auditoria da promessa desta branch, não comportamento. Por PESSOA: quem
-- estava com rede ruim e tentou dez vezes não responde pelas outras.
m10 as (
  select
    count(*)                                                             as denominador,
    count(*) filter (where v.resume_failures_novas > 0)                  as pessoas_com_falha_nova,
    count(*) filter (where v.resume_failures_legado > 0)                 as pessoas_com_falha_legado,
    count(*) filter (where v.falhou_e_nao_voltou)                        as falhou_e_nao_voltou,
    coalesce(sum(v.resume_failures_novas), 0)                            as eventos_novos
  from public.metric_blueprint_resume_failures v
  join elegiveis e on e.user_id = v.user_id
),

-- ═══ 11. PRIMEIRO REGISTRO, FORA DO ONBOARDING ═════════════════════════
-- Irmã honesta da medida 1. Este número vai ser PIOR que o dela, por
-- construção — a medida 1 contava o peso que o nosso próprio formulário
-- escreve. Quem comparar os dois e gritar "pioramos" leu errado.
m11 as (
  select
    count(*) filter (where v.minutes_to_first_record is not null)        as denominador,
    round(percentile_cont(0.5) within group (order by v.minutes_to_first_record)::numeric, 1) as mediana,
    count(*)                                                             as pessoas,
    round(
      count(*) filter (where not v.reached_in_24h)::numeric / nullif(count(*), 0), 3
    )                                                                    as sem_registro_24h,
    count(*) filter (where v.onboarding_weight_excluded)                 as pesos_excluidos
  from public.metric_first_record_outside_onboarding v
  join elegiveis e on e.user_id = v.user_id
),

-- ═══ 12. PLANO ATIVADO ═════════════════════════════════════════════════
-- Arquivado por cota conta separado: não é escolha da pessoa, é o produto
-- prometendo o que não pode entregar.
m12 as (
  select
    count(*)                                                             as denominador,
    round(
      count(*) filter (where v.ficou_com_plano_ativo)::numeric / nullif(count(*), 0), 3
    )                                                                    as proporcao,
    count(*) filter (where v.ativou_sem_plano)                           as ativou_sem_plano,
    coalesce(sum(v.blueprint_plans_archived), 0)                         as planos_arquivados,
    count(*) filter (where v.blueprint_plans_archived > 0)               as pessoas_com_arquivado
  from public.metric_blueprint_plan_activation v
  join elegiveis e on e.user_id = v.user_id
),

-- ═══ 13. UTILIDADE DECLARADA ═══════════════════════════════════════════
-- Hoje devolve zero para todo mundo: nada no produto pergunta. A linha
-- aparece mesmo assim, marcada SEM SINAL AINDA — medida omitida é medida
-- esquecida, e a pergunta proposta já está escrita no documento.
m13 as (
  select
    count(*) filter (where v.answered > 0)                               as denominador,
    round(percentile_cont(0.5) within group (order by v.useful_rate)
      filter (where v.answered > 0)::numeric, 3)                         as mediana_utilidade,
    count(*) filter (where v.asked > 0)                                  as denom_resposta,
    round(percentile_cont(0.5) within group (order by v.answer_rate)
      filter (where v.asked > 0)::numeric, 3)                            as mediana_resposta
  from public.metric_blueprint_declared_usefulness v
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

  union all
  select 9, 'Blueprint: gerado -> ativado em 24h', 'proporção de pessoas', m9.denominador,
    case when m9.denominador >= q.minimo then coalesce(m9.proporcao::text, '—') else 'INSUFICIENTE' end,
    '>= ' || l.t9_ativacao_24h,
    case
      when m9.denominador < q.minimo then 'INSUFICIENTE'
      when m9.proporcao < l.t9_ativacao_24h then 'DECIDIR'
      else 'ok'
    end,
    'Dispensaram de propósito ("explorar primeiro"): ' || m9.dispensaram
      || ' — isso NÃO é falha e não entra no numerador; se for a maioria das não-ativações, a opção está funcionando e tirá-la seria o erro. '
      || 'Legado sem proposta (gerou antes da correção e perdeu): ' || m9.legado
      || '. Mediana até ativar: ' || coalesce(m9.mediana_minutos::text, '—') || ' min. '
      || 'Abaixo do limiar, o conserto é no FLUXO, não no modelo.'
  from m9, limiares l, quorum q

  union all
  select 10, 'Blueprint: falhas de recuperação', 'pessoas com >= 1 falha', m10.denominador,
    case when m10.denominador >= q.minimo then m10.pessoas_com_falha_nova::text else 'INSUFICIENTE' end,
    '= 0 pessoas (motivo novo)',
    case
      when m10.denominador < q.minimo then 'INSUFICIENTE'
      when m10.pessoas_com_falha_nova > 0 then 'DECIDIR'
      else 'ok'
    end,
    'Auditoria da promessa desta branch ("a proposta não se perde"), e é binária como a medida 2: uma pessoa já reprova. '
      || m10.eventos_novos || ' eventos de motivo novo; ' || m10.pessoas_com_falha_legado
      || ' pessoas com falha de LEGADO (dano de antes da correção, fora da barra, contado para não sumir). '
      || 'Falharam e nunca mais retomaram nem ativaram: ' || m10.falhou_e_nao_voltou
      || ' — é o corte que separa ruído de rede de promessa quebrada. Sem o motivo, o número não aciona conserto nenhum.'
  from m10, limiares l, quorum q

  union all
  select 11, 'Primeiro registro (fora do onboarding)', 'mediana por pessoa', m11.denominador,
    case when m11.denominador >= q.minimo
         then m11.mediana::text || ' min' else 'INSUFICIENTE' end,
    '<= ' || l.t1_minutos || ' min',
    case
      when m11.denominador < q.minimo then 'INSUFICIENTE'
      when m11.mediana > l.t1_minutos then 'DECIDIR'
      else 'ok'
    end,
    'NÃO SOMAR com as linhas 12 e 13: são três fatos sobre três momentos, e a soma sobe quando melhoramos o passo mais fácil. '
      || 'Sem registro em 24h: ' || coalesce(m11.sem_registro_24h::text, '—') || ' (limiar ' || l.t1_sem_24h || '). '
      || 'Pesos de onboarding descontados: ' || m11.pesos_excluidos
      || '. Este número É PIOR que o da medida 1 por construção — ela contava o peso que o nosso próprio formulário escreve. Não é regressão.'
  from m11, limiares l, quorum q

  union all
  select 12, 'Blueprint: ficou com plano ativo', 'proporção de pessoas', m12.denominador,
    case when m12.denominador >= q.minimo then coalesce(m12.proporcao::text, '—') else 'INSUFICIENTE' end,
    '>= ' || l.t12_plano_ativo,
    case
      when m12.denominador < q.minimo then 'INSUFICIENTE'
      when m12.pessoas_com_arquivado > 0 then 'DECIDIR'
      when m12.proporcao < l.t12_plano_ativo then 'DECIDIR'
      else 'ok'
    end,
    'NÃO SOMAR com as linhas 11 e 13. Planos arquivados pela COTA: ' || m12.planos_arquivados
      || ' em ' || m12.pessoas_com_arquivado || ' pessoas — uma já reprova: é o produto prometendo um plano e recusando no mesmo segundo, e isso é correção, não comportamento. '
      || 'Carimbaram ativação e ficaram sem plano nenhum: ' || m12.ativou_sem_plano
      || '. Abaixo do limiar, o problema é o que o modelo escreve, não o botão.'
  from m12, limiares l, quorum q

  union all
  select 13, 'Blueprint: utilidade declarada', 'mediana por pessoa', m13.denominador,
    case
      when m13.denom_resposta = 0 then 'SEM SINAL AINDA'
      when m13.denominador >= q.minimo then coalesce(m13.mediana_utilidade::text, '—')
      else 'INSUFICIENTE'
    end,
    '>= ' || l.t4_utilidade || ' (com resposta >= ' || l.t4_resposta || ')',
    case
      when m13.denom_resposta = 0 then 'SEM SINAL'
      when m13.denominador < q.minimo then 'INSUFICIENTE'
      when m13.mediana_utilidade < l.t4_utilidade then 'DECIDIR'
      else 'ok'
    end,
    'NÃO SOMAR com as linhas 11 e 12 — esta é a única das três que é juízo da pessoa, e a única que não se infere: ativar não prova que ajudou, arquivar não prova que atrapalhou. '
      || 'SEM SINAL significa que nada no produto pergunta ainda; a pergunta proposta (texto decidido com a Fiel) e as duas condições para o sinal existir estão em docs/medidas-e-limiares.md, medida 13. '
      || 'A linha aparece assim mesmo porque medida omitida é medida esquecida.'
  from m13, limiares l, quorum q
) medidas
order by n;
