-- ═══════════════════════════════════════════════════════════════════════
-- A RESERVA QUE NINGUÉM USOU CONTINUAVA COBRANDO A PESSOA, PARA SEMPRE
--
-- ┌───────────────────────────────────────────────────────────────────┐
-- │ ORDEM DE DEPLOY — OBRIGATÓRIA. LEIA ANTES DE RODAR ESTE ARQUIVO.  │
-- │                                                                   │
-- │ Publique as edge functions `ai-chat` e `whatsapp-webhook` ANTES   │
-- │ de aplicar esta migração. São as duas que consomem cota sem       │
-- │ passar a reserva para o anthropicCall e que, por isso, passam a   │
-- │ LIQUIDAR a linha (settleUsage). `briefing` e `onboarding-         │
-- │ blueprint` também mudaram, mas só no cache de prompt: podem ir a  │
-- │ qualquer momento, antes ou depois, sem efeito nenhum aqui.        │
-- │                                                                   │
-- │ NA ORDEM CERTA, a janela entre uma coisa e outra é inofensiva: o  │
-- │ settleUsage chama uma função que ainda não existe no banco, o     │
-- │ erro cai no log e a linha fica exatamente como já ficava hoje.    │
-- │ Nada é varrido, porque a varredura nasce com esta migração.       │
-- │                                                                   │
-- │ NA ORDEM INVERTIDA (migração primeiro), a regra de idade e a      │
-- │ varredura entram em vigor enquanto os marcadores novos ainda      │
-- │ nascem como 'reserva' e ninguém os liquida. Consequência, a       │
-- │ partir dos 15 minutos de cada linha e até o deploy sair: O TETO   │
-- │ DO CONSELHEIRO NO WHATSAPP DEIXA DE EXISTIR e TODA ANÁLISE DE     │
-- │ DOCUMENTO (app e WhatsApp) SAI DE GRAÇA. Não corrompe dado algum  │
-- │ e se resolve sozinho assim que as funções sobem — mas, enquanto   │
-- │ durar, o teto está aberto.                                        │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Produção, 13/09/2026: 19 linhas com `model = 'reserva'` em `ai_usage`
-- sob a feature 'chat-principal', acumuladas desde 27/08, contra 59 chamadas
-- concluídas. Cada uma dessas linhas tem `success = true` e, portanto, JÁ
-- CONTA no teto do Conselheiro (ver reserve_ai_usage_windows).
--
-- O dano não é de custo, é de produto: no plano gratuito são 15 mensagens por
-- SEMANA. Uma reserva órfã é uma conversa que a pessoa pagou e não teve — e
-- ela não tem como saber. Não aparece erro nenhum; o app só diz "você chegou
-- ao limite" mais cedo do que deveria, e ela conclui que o produto é menor do
-- que foi vendido. Não existia varredura nenhuma: a linha ficava lá para
-- sempre, e nas janelas mensais isso significa um mês inteiro encolhido.
--
-- ─── COMO A LINHA VIRA ÓRFÃ ───
-- O mecanismo é intencionalmente pessimista, e está certo: reserva-se ANTES
-- de chamar a IA (senão duas requisições simultâneas passam juntas pela mesma
-- verificação). A reserva sai da conta por um de dois caminhos:
--   • sucesso  → logUsage faz UPDATE da MESMA linha com o modelo e os tokens
--                reais (_shared/usage.ts). A linha deixa de ser 'reserva'.
--   • falha    → o chamador chama releaseUsage → release_ai_usage apaga a linha.
-- Os dois caminhos são código JavaScript. Quando a função de borda não morre
-- por exceção — e sim é MORTA (estouro do relógio de parede do Edge Runtime,
-- estouro de memória com anexos grandes, reciclagem do worker num deploy) —
-- nenhum dos dois roda. Não há `catch` nem `finally` que socorra: o processo
-- simplesmente não existe mais. A linha fica.
--
-- O ai-chat é justamente quem mais tempo passa nesse estado: depois da
-- reserva ele pode encadear até QUATRO chamadas à Anthropic no mesmo request
-- (extração do anexo, resposta principal, plano forçado, leitura de fatura).
-- Por isso as 19 linhas são todas dele.
--
-- ─── O QUE ATRAPALHAVA A CORREÇÃO ÓBVIA ───
-- "Reserva velha é órfã" parece resolver sozinho. Não resolve, porque
-- `model = 'reserva'` hoje significa DUAS coisas diferentes:
--
--   (a) reserva em voo, ainda não liquidada  → órfã se envelhecer;
--   (b) MARCADOR DE COTA PERMANENTE, de propósito.
--
-- O caso (b) é o Conselheiro do WhatsApp (whatsapp-webhook, counselorTurn):
-- ele reserva sob 'chat-principal' — a cota é a mesma nos dois canais — mas
-- registra a telemetria sob 'wa-conselheiro', então a linha da reserva NUNCA
-- recebe UPDATE e fica como 'reserva' de propósito. O mesmo vale para as
-- análises de documento ('chat-documento') no app e no WhatsApp.
--
-- Ignorar toda reserva velha, sem distinguir, devolveria a cota de TODA
-- conversa já tida pelo WhatsApp e de TODA análise de documento já feita —
-- ou seja, trocaria um teto que cobra a mais por um teto que não existe.
-- (É por isso que existe a liquidação explícita, abaixo. O DELETE histórico
-- no fim do arquivo faz essa devolução UMA vez, de propósito e com o nome
-- certo — anistia —, sobre linhas que ninguém mais consegue classificar.)
--
-- ─── A CORREÇÃO: LIQUIDAÇÃO EXPLÍCITA ───
-- A ambiguidade acaba na origem. Quem consome a cota sem passar a reserva
-- para o anthropicCall passa a LIQUIDAR a linha no momento em que a entrega
-- acontece (settleUsage → settle_ai_usage), trocando 'reserva' por
-- 'reserva-consumida'. Ela continua contando no teto (é isso que ela sempre
-- foi), mas para de parecer uma chamada em voo.
--
-- Com isso `model = 'reserva'` volta a significar UMA coisa só: em voo. E aí
-- sim a regra de idade é válida e segura:
--   • a CONTAGEM ignora reserva aberta mais velha que a janela de graça —
--     é ela que devolve a cota a quem está travado HOJE, sem intervenção;
--   • a própria reserva seguinte VARRE as órfãs daquele usuário+feature, já
--     sob o advisory lock que ela mesma toma. Sem cron, sem job, sem ninguém
--     precisar lembrar: o sistema se limpa no uso.
--
-- ─── POR QUE 15 MINUTOS ───
-- A janela tem um piso duro e um teto mole, e o número tem de caber entre os
-- dois com folga para os dois lados.
--
-- O PISO é o maior tempo que uma reserva LEGÍTIMA pode passar em voo. Se a
-- janela for menor que isso, uma reserva viva para de contar e duas
-- requisições simultâneas voltam a passar juntas pelo teto — exatamente a
-- corrida que o advisory lock existe para matar. Esse piso é conhecido: a
-- chamada mais lenta do produto é o onboarding-blueprint, ~104s de média, e o
-- limite absoluto é o relógio de parede do Edge Runtime (no máximo algumas
-- centenas de segundos), porque é ELE que mata a função — nenhuma reserva
-- pode ficar em voo mais tempo que o processo que a criou.
--
-- O TETO é o quanto a pessoa aguenta ficar travada. Aqui a referência é a
-- janela de cota: a menor é de um DIA, e no gratuito o Conselheiro é semanal.
--
-- 15 minutos = 900s fica ~8,7x acima da média do blueprint e com folga de
-- sobra sobre qualquer relógio de parede plausível (é mais que o dobro do
-- maior), e ao mesmo tempo duas ordens de grandeza abaixo da menor janela de
-- cota. Quem está travado agora destrava na mesma sessão, não na semana que
-- vem; e é impossível uma reserva viva ser descontada.
--
-- ─── A DÍVIDA ACUMULADA: UMA ANISTIA, NÃO UM DIAGNÓSTICO ───
-- As linhas que já existem nasceram ANTES da liquidação explícita, então
-- nenhuma delas está marcada. Não temos como saber quais eram órfãs e quais
-- eram marcadores legítimos, e é importante dizer isso com essas palavras:
-- NÓS NÃO SABEMOS. Dava para chutar por correlação (um marcador do WhatsApp
-- costuma ter, ao lado, a chamada real daquele turno para a mesma pessoa,
-- minutos depois), e a primeira versão desta migração fazia exatamente isso.
--
-- A decisão foi outra, e é melhor: ANISTIA. Toda reserva aberta e velha
-- some, sem perguntar de onde veio. Quatro razões:
--
--   1. A CASA JÁ TEM ESSA DOUTRINA ESCRITA. src/hooks/useEntitlements.tsx:34
--      decide o mesmo tipo de dúvida com a mesma régua: "Entre incomodar e
--      cobrar duas vezes, incomodar é menos grave" — e na dúvida sobre o
--      plano a tela não afirma, não bloqueia e não oferece upgrade. Cota é a
--      mesma família de decisão. Manter a correlação seria escolher, na
--      dúvida, justamente o lado que cobra.
--   2. A ASSIMETRIA É GRITANTE. Errar a favor: um punhado de pessoas ganha
--      algumas mensagens a mais, UMA vez. Errar contra: seguimos cobrando por
--      conversas que não aconteceram — que é o bug que esta migração existe
--      para consertar. Consertar um bug pela metade porque a outra metade é
--      difícil de provar é o pior dos dois mundos.
--   3. NÃO ABRE TETO NENHUM. É backfill ÚNICO, sobre linhas históricas. Daqui
--      para frente settleUsage acaba com a ambiguidade na origem, então a
--      generosidade não tem custo recorrente: não estamos afrouxando o teto,
--      estamos perdoando um período em que o teto estava errado.
--   4. O UNIVERSO É PEQUENO E CONHECIDO. 5 usuários ativos e 25 chamadas de
--      'wa-conselheiro' no período inteiro. O pior caso da generosidade é da
--      ordem de algumas dezenas de mensagens, uma vez, num piloto.
--
-- Quem ler isto daqui a um ano precisa entender a diferença: não afirmamos
-- que aquelas linhas eram órfãs. ESCOLHEMOS NÃO SABER, e escolhemos errar
-- para o lado da pessoa enquanto o produto não sabia se contar direito.
--
-- Idempotente: pode rodar de novo sem estragar nada.
-- ═══════════════════════════════════════════════════════════════════════

-- A janela de graça vive numa função só para não haver duas verdades entre
-- reserve_ai_usage, reserve_ai_usage_windows e a varredura. O espelho dela no
-- TypeScript é RESERVATION_GRACE_MS, em _shared/usage.ts (countUsage precisa
-- da MESMA regra, e roda via PostgREST, fora daqui).
create or replace function public.ai_reservation_grace()
returns interval language sql immutable as $$ select interval '15 minutes' $$;

-- Índice parcial: as reservas ABERTAS são um punhado de linhas dentro de uma
-- tabela que só cresce. Sem ele, a varredura a cada reserva faria varredura
-- de verdade — e ela roda no caminho quente, segurando o advisory lock.
create index if not exists ai_usage_reservas_abertas
  on public.ai_usage (user_id, feature, created_at)
  where model = 'reserva';

-- ─── O QUE CONTA CONTRA O TETO ────────────────────────────────────────
-- Uma definição só, usada por todas as janelas. A cláusula do `model` é a
-- correção: reserva ABERTA e velha não é uso, é entulho de uma função morta.
create or replace function public.ai_usage_counted(uid uuid, feat text, since timestamptz)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.ai_usage
   where user_id = uid and feature = feat and success and created_at >= since
     and (model <> 'reserva' or created_at >= now() - public.ai_reservation_grace());
$$;
revoke all on function public.ai_usage_counted(uuid, text, timestamptz) from anon, authenticated;

-- ─── AUTO-CURA ────────────────────────────────────────────────────────
-- Apagar é o mesmo que release_ai_usage faz com uma reserva nunca usada, e
-- pelo mesmo motivo: a linha não carrega informação nenhuma (zero tokens,
-- zero custo, nenhum request id da Anthropic). Não é telemetria perdida, é
-- lixo removido. Quem chama já está sob o advisory lock do par usuário+feature.
create or replace function public.sweep_ai_reservations(uid uuid, feat text)
returns void language sql security definer set search_path = public as $$
  delete from public.ai_usage
   where user_id = uid and feature = feat and model = 'reserva'
     and created_at < now() - public.ai_reservation_grace();
$$;
revoke all on function public.sweep_ai_reservations(uuid, text) from anon, authenticated;

-- ─── LIQUIDAÇÃO ───────────────────────────────────────────────────────
-- Chamada por quem consome a cota SEM passar a reserva para o anthropicCall
-- (o Conselheiro do WhatsApp registra sob 'wa-conselheiro'; a análise de
-- documento é lida dentro do turno do Conselheiro). A linha continua contando
-- — ela é o marcador da cota — mas deixa de parecer uma chamada em voo, que é
-- o que a tornava indistinguível de uma órfã.
-- `and model = 'reserva'`: liquidar duas vezes é no-op, e uma reserva já
-- preenchida com o modelo real nunca é sobrescrita por isto.
create or replace function public.settle_ai_usage(reservation_id bigint)
returns void language sql security definer set search_path = public as $$
  update public.ai_usage set model = 'reserva-consumida'
   where id = reservation_id and model = 'reserva';
$$;
revoke all on function public.settle_ai_usage(bigint) from anon, authenticated;

-- ─── AS DUAS FUNÇÕES DE RESERVA, AGORA IMUNES A ÓRFÃ ──────────────────
create or replace function public.reserve_ai_usage(uid uuid, feat text, cap int, since timestamptz)
returns bigint language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext(uid::text || ':' || feat));
  perform public.sweep_ai_reservations(uid, feat);
  if cap is not null and public.ai_usage_counted(uid, feat, since) >= cap then
    return null;
  end if;
  insert into public.ai_usage (user_id, feature, model, success)
  values (uid, feat, 'reserva', true)
  returning id into new_id;
  return new_id;
end; $$;
revoke all on function public.reserve_ai_usage(uuid, text, int, timestamptz) from anon, authenticated;

-- O teto do Conselheiro tem até três janelas simultâneas (dia, semana, mês) e
-- precisa devolver QUAL delas barrou — o app depende disso para a mensagem e
-- para o reset_at corretos. cap null = janela sem limite.
create or replace function public.reserve_ai_usage_windows(
  uid uuid, feat text,
  cap_day int, since_day timestamptz,
  cap_week int, since_week timestamptz,
  cap_month int, since_month timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext(uid::text || ':' || feat));
  perform public.sweep_ai_reservations(uid, feat);

  if cap_day is not null and public.ai_usage_counted(uid, feat, since_day) >= cap_day then
    return jsonb_build_object('id', null, 'window', 'daily');
  end if;
  if cap_week is not null and public.ai_usage_counted(uid, feat, since_week) >= cap_week then
    return jsonb_build_object('id', null, 'window', 'weekly');
  end if;
  if cap_month is not null and public.ai_usage_counted(uid, feat, since_month) >= cap_month then
    return jsonb_build_object('id', null, 'window', 'monthly');
  end if;

  insert into public.ai_usage (user_id, feature, model, success)
  values (uid, feat, 'reserva', true)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'window', null);
end; $$;
revoke all on function public.reserve_ai_usage_windows(uuid, text, int, timestamptz, int, timestamptz, int, timestamptz) from anon, authenticated;

-- ═══ A ANISTIA ═══════════════════════════════════════════════════════
-- Ver "UMA ANISTIA, NÃO UM DIAGNÓSTICO", no topo. Um único DELETE, sem
-- correlação nenhuma: toda reserva ABERTA e mais velha que a janela de graça
-- sai, venha de onde vier. Parte dessas linhas era marcador legítimo de uma
-- conversa pelo WhatsApp ou de uma análise de documento, e essas cotas estão
-- sendo perdoadas DE PROPÓSITO — não por engano e não por não termos tentado.
--
-- O corte pela janela de graça não é detalhe: sem ele, este DELETE mataria as
-- reservas que estiverem EM VOO no instante em que a migração rodar, e cada
-- uma dessas é uma pessoa esperando resposta cuja cota deixaria de ser
-- contada. Só entra o que nenhuma função viva poderia ter criado.
do $$
declare anistiadas int;
begin
  delete from public.ai_usage
   where model = 'reserva'
     and created_at < now() - public.ai_reservation_grace();
  get diagnostics anistiadas = row_count;
  raise notice 'reservas abertas anistiadas (órfãs + marcadores antigos): %', anistiadas;
end $$;
