# Modelo de dados do Social — versão final

> Autor: Aduana (Arquiteto de Dados Compartilhados)
> Revisão de risco ético: Fiel (Ética da Persuasão) — parecer incorporado, cortes B1/B2/B3 aplicados, riscos B4 (a)(b)(c)(d) tratados no schema.
> Status: **modelo fechado, nenhuma migration escrita ainda.** Aguarda o "vai" do fundador.
> Régua: `PRINCIPIOS.md` (Dilema 2 — dado nunca vira produto; "Cancelou? Seus dados continuam seus"; Dilema 4 — retenção não vem de culpa).

---

## 0. Os três achados do código que determinam o modelo inteiro

Antes de desenhar qualquer tabela, três fatos do banco atual:

1. **`life_events` já contém dinheiro.** O gatilho `tx_to_life_event` (`supabase/setup.sql:206`) grava toda transação como `kind='transaction'` com `payload.amount`. Treino, peso, diário, humor e fatura moram na **mesma tabela**, no **mesmo `jsonb`**.
2. **RLS é de linha, não de coluna.** Não existe política que diga "pode ler esta linha, mas não `payload->>'description'`". Abrir a linha abre o `payload` inteiro.
3. **`profiles` carrega `monthly_income`, `medications`, `health_conditions`, `sex`, `birth_year`** na mesma linha do `name`.

**Conclusão que precede o modelo:** a decisão de fundador *"dado financeiro nunca é compartilhável, nem por opção"* é **inexprimível** como política sobre as tabelas de hoje. Não porque seja difícil — porque a forma do dado não comporta o recorte. O Social precisa de uma superfície nova, e é isso que este documento desenha.

---

## 1. Modelo de dados

**13 tabelas, 7 migrations.** Toda migration vive em `supabase/migrations/`, no padrão de lá (timestamp + nome em português que diz o **problema resolvido**), e o comentário de topo explica **por quê**, não o quê. Objetos novos ficam **só na migration** — não espelhar no `setup.sql` (regra do `supabase/migrations/README.md`).

Ordem de deploy = ordem dos arquivos.

---

### Migration 1 — `20260918120000_o_grupo_nasce_sem_enxergar_nada.sql`

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- O GRUPO NASCE SEM ENXERGAR NADA
--
-- Até hoje o Ascende é de UMA pessoa: toda RLS é `user_id = auth.uid()` e
-- não existe um único caminho em que a linha de alguém seja lida por outro
-- alguém. Esta migration abre essa fronteira, e abre pelo lado mais estreito
-- possível: cria o GRUPO e a FILIAÇÃO, e mais nada. Depois desta migration
-- duas pessoas podem estar no mesmo grupo e continuar sem ver um único
-- número uma da outra — porque não existe ainda tabela de dado compartilhado
-- nem consentimento nenhum. O que se enxerga aqui é só quem está na sala.
--
-- ─── POR QUE A IDENTIDADE NASCE AQUI, E NÃO EM `profiles` ──────────────
-- O pedido mais banal do Social ("mostra o nome e o avatar do colega") tem a
-- resposta errada mais cara do projeto. `profiles` tem monthly_income,
-- medications, health_conditions, sex e birth_year NA MESMA LINHA do name —
-- e RLS é de LINHA, não de coluna. Uma política de leitura em `profiles`
-- para membros do grupo entrega o salário e os remédios junto com o nome.
-- Não existe versão segura dessa política; a versão segura é não existir.
--
-- Então `display_name` mora em group_members: a identidade dentro do grupo
-- é dado DO GRUPO, escolhido POR GRUPO. A mesma pessoa é "Henrique" entre
-- amigos e "H." no grupo do trabalho — e isso não é um extra, é o que torna
-- possível estar num grupo sem se expor nele.
--
-- ─── created_by É `set null`, NÃO `cascade` ────────────────────────────
-- Todo o resto do projeto usa `on delete cascade` para auth.users, e está
-- certo. Aqui não: apagar a conta de quem criou o grupo não pode apagar a
-- vida registrada das outras seis pessoas. Some o vínculo, fica o grupo, e
-- um gatilho promove o membro mais antigo.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
alter table public.groups enable row level security;

create table if not exists public.group_members (
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references auth.users(id)    on delete cascade,
  role         text not null default 'member' check (role in ('owner','admin','member')),
  -- Identidade DO GRUPO. Nunca lida de profiles. Ver comentário de topo.
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  avatar_emoji text,
  joined_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user on public.group_members (user_id);
alter table public.group_members enable row level security;

-- Convite: guarda o HASH, nunca o código. A tabela não é lida por ninguém —
-- aceitar convite é RPC security definer com teto de tentativas. Mesmo
-- raciocínio dos 6 dígitos do pareamento de WhatsApp (SEGURANCA.md): um
-- código curto sem teto é força-brutável até entrar no grupo de outra gente.
create table if not exists public.group_invites (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  code_hash   text not null unique,
  created_by  uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null,
  max_uses    int  not null default 1 check (max_uses between 1 and 50),
  uses        int  not null default 0,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.group_invites enable row level security;

-- Trilha append-only. Existe para responder "quem me tirou daqui, e quando" —
-- nunca é consultada para decidir acesso.
create table if not exists public.group_membership_events (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  subject_id uuid references auth.users(id) on delete set null,
  actor_id   uuid references auth.users(id) on delete set null,
  action     text not null check (action in ('entrou','saiu','removido','promovido')),
  at         timestamptz not null default now()
);
alter table public.group_membership_events enable row level security;
```

**Funções `security definer` desta migration:** `sou_membro(uuid)`, `sou_admin(uuid)`, `aceitar_convite(text)`, `sair_do_grupo(uuid)`, `remover_membro(uuid, uuid)`, `promover_quando_dono_some()`.

---

### Migration 2 — `20260918140000_consentir_e_por_tipo_e_por_grupo.sql`

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- CONSENTIR É POR TIPO **E** POR GRUPO — E TUDO NASCE FECHADO
--
-- Decisão de fundador: a pessoa libera dado a dado ("treino sim, peso não"),
-- e libera POR GRUPO. Este arquivo é a tradução dessa frase em schema.
--
-- ─── O CONSENTIMENTO É A PRESENÇA DA LINHA ─────────────────────────────
-- Não existe coluna `enabled`, não existe `revoked_at` na tabela viva.
-- Ligar = INSERT. Desligar = DELETE. A razão é a diferença entre um default
-- e uma impossibilidade: um booleano `default false` depende de TODA política
-- futura lembrar de conferi-lo, e basta uma esquecer para o dado abrir. A
-- ausência de linha não depende de ninguém lembrar de nada — no banco vazio
-- não há o que ler. "Nasce fechado" deixa de ser configuração e vira a única
-- forma possível do estado inicial.
-- A trilha de auditoria fica em consent_events, que NUNCA é consultada para
-- decidir acesso. Separar as duas coisas é o ponto: a tabela que decide é a
-- que não tem estado morto dentro.
--
-- ─── O TESTE DO ZERO (parecer do Fiel) ─────────────────────────────────
-- No agregado o CONTEÚDO já não existe — o que vaza é sempre a AUSÊNCIA.
-- Por isso a régua do catálogo não é "quão sensível é o conteúdo", é:
--
--   uma métrica só entra se o ZERO dela for uma informação que a pessoa não
--   se importaria de ouvir lida em voz alta pelo grupo.
--
--   "não treinou"                  → tolerável, entra.
--   "parou de conseguir se olhar"  → humor_registrado, NÃO ENTRA.
--   "se afastou da fé"             → pratica_espiritual, NÃO ENTRA.
--
-- A coluna `o_que_o_zero_diz` é NOT NULL porque quem adicionar uma chave nova
-- é obrigado a escrever essa frase e ler o que escreveu. O teste vira custo
-- de escrita, não lembrete em documento.
--
-- ─── A REGRA QUE GERA O CATÁLOGO ───────────────────────────────────────
-- Toda métrica compartilhável é um ATO ou uma CONTAGEM DE ATOS. Nenhuma é
-- uma MEDIDA DO CORPO. Por isso não existe `sono_horas` nem `agua_ml` nem
-- `peso_kg`: existe "cumpriu a própria meta" e "subiu na balança".
-- Resultado é privado; compromisso é visível.
--
-- ─── O QUE NUNCA ENTRA, SEM TOGGLE ─────────────────────────────────────
-- • prosperidade inteira (CHECK no schema, não em política): decisão de
--   fundador, e a única forma de uma decisão não ser reaberta numa sexta-feira
--   é ela não caber na tabela.
-- • battles / battle_checkins: vício não é métrica de grupo.
-- • pratica_espiritual: dado sensível (LGPD art. 5º, II). Num grupo de
--   trabalho, "praticou 6x" identifica quem é de fé e a queda a zero denuncia
--   o afastamento — as duas direções vazam.
-- • humor_registrado: a frequência é proxy do estado nos dois sentidos, e
--   convida vigilância com cara de cuidado.
-- • diario_escrito: mesma razão, com o agravante do "sobre o quê?".
-- • peso_delta_kg: CORTADO. lib/mokari.ts já remove weight/body de toda conta
--   (IGNORED_KINDS, com teste); publicar o delta faria da composição corporal
--   o único número que o app se recusa a contar em PRIVADO e aceita expor em
--   PÚBLICO. E delta é RESULTADO, não ATO: depende de ciclo, remédio e
--   retenção de líquido — comparar o que a pessoa não controla é injusto por
--   construção. O desejo legítimo se atende com atos (treinos feitos, dias
--   dentro da meta), e isFoodBattle() já recusa esse enquadramento no produto.
--
-- ─── O DENOMINADOR PRECISA EXISTIR NO SCHEMA ───────────────────────────
-- Sem a meta da própria pessoa gravada, a tela só tem número absoluto para
-- renderizar, e "cada um contra a própria meta" vira impossível de cumprir —
-- a comparação absoluta fica ASSADA NO SCHEMA.
--
-- São duas peças, e elas fazem coisas diferentes:
--   • group_member_goals é onde a pessoa COMBINA o alvo com aquele grupo
--     (por grupo, porque a mesma pessoa combina coisas diferentes com grupos
--     diferentes). É a origem.
--   • `goal_value` em shared_daily_stats e group_visible_stats é o alvo
--     CARIMBADO na linha do dia. É o que a tela lê.
-- Carimbar em vez de juntar na leitura resolve duas coisas de uma vez: a meta
-- fica congelada no dia (mudar o alvo hoje não reescreve julho), e não existe
-- caminho de leitura que devolva valor SEM denominador — nem por engano, nem
-- por um join que alguém esqueceu.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.shareable_metrics (
  metric_key       text primary key,
  pillar           text not null check (pillar in ('vitalidade','alimentacao','mente','transversal')),
  label            text not null,
  forma            text not null check (forma in ('ato','contagem_de_atos')),
  unidade          text,
  -- O teste do zero, obrigatório e legível. Ver comentário de topo.
  o_que_o_zero_diz text not null,
  ordenavel        boolean not null default false  -- hoje: nenhuma. Ver §2.
);
alter table public.shareable_metrics enable row level security;
-- Sem NENHUMA política de escrita (mesmo padrão de fn_calls em SEGURANCA.md).
-- O catálogo só cresce por migration revisada: assim `peso_delta_kg` não entra
-- numa terça-feira sem passar por esta mesa.

insert into public.shareable_metrics
  (metric_key, pillar, label, forma, unidade, o_que_o_zero_diz) values
  ('treino_sessoes',        'vitalidade',  'Treinos',                'contagem_de_atos','sessão',  'não treinou nesta semana'),
  ('treino_minutos',        'vitalidade',  'Minutos de treino',      'contagem_de_atos','min',     'treinou pouco'),
  ('sono_meta_cumprida',    'vitalidade',  'Dormiu o que planejou',  'ato',             'dia',     'não dormiu o que planejou'),
  ('agua_meta_cumprida',    'vitalidade',  'Bateu a água do dia',    'ato',             'dia',     'não bebeu água suficiente'),
  ('peso_registrado',       'vitalidade',  'Subiu na balança',       'ato',             'dia',     'não subiu na balança'),
  ('refeicoes_registradas', 'alimentacao', 'Refeições registradas',  'contagem_de_atos','refeição','não anotou o que comeu'),
  ('meta_calorica_cumprida','alimentacao', 'Bateu a própria meta',   'ato',             'dia',     'não bateu a própria meta'),
  ('gratidao_registrada',   'mente',       'Registrou gratidão',     'ato',             'dia',     'não registrou gratidão'),
  ('dias_com_registro',     'transversal', 'Dias com registro',      'contagem_de_atos','dia',     'sumiu do app')
on conflict (metric_key) do nothing;

-- Cinto e suspensório: mesmo que alguém insira à mão em produção, o pilar do
-- dinheiro não passa. A decisão de fundador vira restrição de domínio.
alter table public.shareable_metrics
  drop constraint if exists shareable_metrics_nunca_financeiro;
alter table public.shareable_metrics
  add  constraint shareable_metrics_nunca_financeiro
  check (pillar <> 'prosperidade');

create table if not exists public.group_data_consents (
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id)    on delete cascade,
  metric_key text not null references public.shareable_metrics(metric_key),
  granted_at timestamptz not null default now(),
  primary key (group_id, user_id, metric_key)
);
alter table public.group_data_consents enable row level security;

create table if not exists public.group_member_goals (
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id)    on delete cascade,
  metric_key text not null references public.shareable_metrics(metric_key),
  goal_value numeric not null check (goal_value > 0),
  period     text not null default 'semana' check (period in ('dia','semana','ciclo')),
  primary key (group_id, user_id, metric_key)
);
alter table public.group_member_goals enable row level security;

create table if not exists public.consent_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  group_id   uuid,        -- sem FK: a trilha sobrevive ao grupo apagado
  metric_key text not null,
  action     text not null check (action in ('ligou','desligou')),
  at         timestamptz not null default now()
);
alter table public.consent_events enable row level security;
```

---

### Migration 3 — `20260918160000_o_grupo_le_projecao_nunca_a_fonte.sql`

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- O GRUPO LÊ PROJEÇÃO, NUNCA A FONTE
--
-- life_events, transactions, habit_logs, battles, ai_memories e chat_messages
-- NÃO ganham uma única política nova. Nunca. Este arquivo cria a projeção que
-- o Social lê, e um gatilho que a mantém.
--
-- ─── SEM UMA ÚNICA COLUNA DE TEXTO ─────────────────────────────────────
-- Esta é a defesa mais forte do modelo, e é estrutural, não política: o
-- diário, a descrição da refeição, a nota do humor e a análise da foto não
-- vazam daqui porque NÃO EXISTE ONDE ELES CABEREM. `value` é numeric. Ponto.
-- Uma política pode ser escrita errado; uma coluna que não existe, não.
--
-- ─── ALLOWLIST, NUNCA DENYLIST ─────────────────────────────────────────
-- O mapa kind → metric_key é explícito e fechado. Um `kind` novo que apareça
-- no app amanhã não vira métrica compartilhável: ele simplesmente não tem para
-- onde ir. Uma denylist ("todos menos transaction") teria o comportamento
-- oposto — nasce aberto, e alguém precisa lembrar de fechar. Foi assim que o
-- financeiro entraria: não por decisão, por um `kind` novo num sábado.
--
-- ─── O DIA É LOCAL, IGUAL A daily_metrics ──────────────────────────────
-- (occurred_at at time zone 'America/Sao_Paulo')::date. Duas definições de
-- "dia" no mesmo banco fariam o grupo discordar do próprio Hoje da pessoa —
-- e a pessoa acreditaria no grupo.
--
-- ─── NULL NÃO É ZERO, DE NOVO ──────────────────────────────────────────
-- Ausência de linha = "não registrou". Não existe coalesce(value, 0) em
-- lugar nenhum desta cadeia, e a UI escreve "sem registro", nunca "0".
-- Mesma doutrina do comentário de daily_metrics, pelo mesmo motivo — mas
-- aqui a mentira teria plateia.
--
-- ─── O GATILHO RECALCULA A FATIA, NÃO INCREMENTA ───────────────────────
-- after insert/update/delete em life_events e habit_logs: recalcula
-- (user_id, dia) inteiro. Incrementar deixaria o agregado divergir na
-- primeira exclusão, e um agregado que não sabe voltar atrás transforma
-- "apaguei o treino" em "o grupo continua vendo o treino".
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.shared_daily_stats (
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null,
  metric_key  text not null references public.shareable_metrics(metric_key),
  value       numeric not null check (value >= 0),   -- numeric. Nunca texto.
  -- ─── A META VIAJA GRUDADA NO VALOR ───────────────────────────────────
  -- Não é conveniência de UI: é o que impede a comparação absoluta de ficar
  -- ASSADA NO SCHEMA. Se a linha só carregasse `value`, a única coisa que a
  -- tela teria para renderizar seria um número solto — e número solto ao lado
  -- do número solto de outra pessoa É um ranking, mesmo sem coluna de posição.
  -- Com o denominador na mesma linha, a menor unidade que sai daqui já é
  -- "2 de 4": cada um contra a própria régua.
  --
  -- Vem de profiles no momento do cálculo (weekly_workouts_goal, sleep_goal_h,
  -- water_goal_ml, calorie_goal_kcal) e fica CONGELADA no dia: mudar a meta
  -- hoje não reescreve o que a pessoa cumpriu em julho. NULL = a pessoa não
  -- declarou meta para esta métrica, e aí a UI não tem o que comparar — e
  -- não deve inventar um 100%.
  goal_value  numeric check (goal_value > 0),
  computed_at timestamptz not null default now(),
  primary key (user_id, day, metric_key)
);
alter table public.shared_daily_stats enable row level security;
-- RLS: SÓ O DONO. Esta tabela nunca recebe política de grupo — ela é a
-- projeção pessoal. O grupo lê a cópia publicada da migration 4.
```

---

### Migration 4 — `20260918180000_publicar_e_copiar_revogar_e_apagar.sql`

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- PUBLICAR É COPIAR; REVOGAR É APAGAR
--
-- Este arquivo existe por causa de uma frase do parecer do Fiel, que está
-- certa e é cara:
--
--   "Regra de privacidade como cláusula WHERE é regra a um bug de distância.
--    A janela esconde o passado, não o apaga; uma regressão de um caractere
--    reexpõe um ano de histórico num deploy, em silêncio."
--
-- O desenho óbvio seria deixar a projeção pessoal (shared_daily_stats) e
-- filtrá-la com um predicado de consentimento na hora da leitura. Tem
-- elegância e tem um problema fatal: a segurança inteira passa a morar num
-- WHERE, e um WHERE é uma linha que alguém edita.
--
-- Então o dado publicado é uma CÓPIA, uma por grupo. Uma linha só existe aqui
-- porque a pessoa é membro daquele grupo AGORA e consentiu aquela métrica
-- naquele grupo AGORA. Desligar o toggle APAGA as linhas daquele metric_key;
-- sair do grupo APAGA as daquele grupo. A política continua existindo como
-- SEGUNDA parede — mas a primeira é a deleção, e deleção não regride num
-- deploy.
--
-- ─── O QUE ISSO CUSTA (dito, não escondido) ────────────────────────────
-- 1. Segunda fonte da verdade, que pode divergir. Exige a migration 7
--    (reconciliação) e um teste permanente projeção × daily_metrics.
-- 2. Amplificação de escrita: um treino registrado toca 1 linha em
--    shared_daily_stats + 1 por grupo aqui. Com 3 grupos, 4 linhas por ato.
-- 3. Volume: 3 grupos × 9 métricas × 365 dias ≈ 10k linhas/ano/pessoa.
--    Irrelevante para este produto.
-- O custo é real e foi pago de propósito: ele compra a diferença entre
-- "escondido" e "apagado".
--
-- ─── TERCEIRO NUNCA RECEBE SÉRIE DIÁRIA (parecer do Fiel) ──────────────
-- A tabela é por dia e por pessoa, e isso deixa o calendário de bolinhas da
-- vida de alguém a um SELECT de distância — o artefato de vergonha mais
-- eficiente da categoria. Por isso a política de leitura de terceiro libera
-- APENAS `day >= current_date - 1` (hoje, com folga de fuso). Histórico sai
-- exclusivamente como TOTAL DE CICLO, por função agregada que NÃO TEM
-- PARÂMETRO DE DATA — a janela vem de challenges.starts_on/ends_on, gravado
-- no banco. Sem parâmetro de data não há ataque de diferenciação (pedir dois
-- totais e subtrair para reconstruir o dia).
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.group_visible_stats (
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id)    on delete cascade,
  day        date not null,
  metric_key text not null references public.shareable_metrics(metric_key),
  value      numeric not null check (value >= 0),
  -- O denominador atravessa a publicação junto com o valor, pelo mesmo motivo
  -- de shared_daily_stats: nenhuma linha sai daqui sem a régua da própria
  -- pessoa ao lado. Quando existe meta combinada no grupo
  -- (group_member_goals), é ELA que é carimbada aqui — o que a pessoa
  -- combinou com AQUELE grupo vence a meta pessoal dela.
  --
  -- ATENÇÃO (parecer do Fiel, risco b): esta é a meta DA PESSOA, nunca o
  -- tamanho da janela. "Ana: 3 de 3" pode; "Ana: 3 de 14 dias" não — o
  -- denominador da janela deixa o buraco da revogação visível e transforma
  -- o controle de privacidade em sinal social.
  goal_value numeric check (goal_value > 0),
  primary key (group_id, user_id, day, metric_key)
);
create index if not exists gvs_grupo_dia on public.group_visible_stats (group_id, day desc);
alter table public.group_visible_stats enable row level security;

-- Revogação por deleção: os dois gatilhos que provam §3(a) e §3(b).
create or replace function public.despublicar_ao_revogar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.group_visible_stats v
   where v.group_id   = old.group_id
     and v.user_id    = old.user_id
     and v.metric_key = old.metric_key;
  insert into public.consent_events (user_id, group_id, metric_key, action)
       values (old.user_id, old.group_id, old.metric_key, 'desligou');
  return old;
end $$;

drop trigger if exists trg_despublicar_ao_revogar on public.group_data_consents;
create trigger trg_despublicar_ao_revogar
  after delete on public.group_data_consents
  for each row execute function public.despublicar_ao_revogar();

create or replace function public.despublicar_ao_sair()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Apagar o consentimento dispara o gatilho de cima para cada métrica; as
  -- duas linhas abaixo são a mesma regra aplicada duas vezes, de propósito.
  delete from public.group_data_consents c
   where c.group_id = old.group_id and c.user_id = old.user_id;
  delete from public.group_visible_stats v
   where v.group_id = old.group_id and v.user_id = old.user_id;
  delete from public.group_feed f
   where f.group_id = old.group_id and f.author_id = old.user_id;
  return old;
end $$;

drop trigger if exists trg_despublicar_ao_sair on public.group_members;
create trigger trg_despublicar_ao_sair
  after delete on public.group_members
  for each row execute function public.despublicar_ao_sair();
```

---

### Migration 5 — `20260919120000_desafio_sem_podio.sql`

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- DESAFIO SEM PÓDIO
--
-- O parecer do Fiel cortou o ranking, e o argumento não é sentimental:
--
--   soma é monotônica em presença, então TODO ranking de soma é ranking de
--   frequência disfarçado.
--
-- Ou seja: trocar "0" por "sem registro" conserta a palavra, não a posição.
-- Quem teve uma semana ruim continua no fim da lista, e o app passa a punir
-- a semana ruim na frente dos amigos — exatamente o que o Dilema 4 do
-- PRINCIPIOS.md recusa ("retenção vem de vida melhorando, não de culpa").
--
-- Então: MÉDIA está cortada (castiga o dia vazio) e RANKING ORDINAL está
-- cortado (mesmo por soma). O que fica na tela é barra coletiva do grupo +
-- a linha de cada um CONTRA A META DELA — "Ana: 3 de 3", "Você: 2 de 4" —
-- sem ordem. Daí group_member_goals existir na migration 2: sem denominador
-- gravado, a UI só tem número absoluto e a comparação absoluta fica assada
-- no schema.
--
-- ─── NÃO EXISTE TABELA DE RESULTADO ────────────────────────────────────
-- Placar é sempre calculado ao vivo. Um resultado gravado sobreviveria à
-- exclusão da conta do participante e faria de "apagar a conta" meia verdade.
-- O preço é recalcular um desafio encerrado para sempre; com estes volumes,
-- é barato — e é o mesmo tipo de fatura que o PRINCIPIOS.md já aceita pagar
-- em "Cancelou? Seus dados continuam seus".
--
-- ─── K MÍNIMO NA BARRA COLETIVA ────────────────────────────────────────
-- Agregado não é anônimo em grupo pequeno: num grupo de 3, barra coletiva
-- mais duas linhas individuais entrega a terceira pessoa por SUBTRAÇÃO —
-- inclusive quem escolheu não aparecer. O k é conferido no SQL, não no front.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.challenges (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  metric_key text not null references public.shareable_metrics(metric_key),
  starts_on  date not null,
  ends_on    date not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
alter table public.challenges enable row level security;

create table if not exists public.challenge_participants (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id      uuid not null references auth.users(id)        on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
alter table public.challenge_participants enable row level security;
```

```sql
-- Total do ciclo: a ÚNICA porta para o histórico de terceiro.
-- Sem parâmetro de data (a janela vem do banco) → não há diferenciação.
-- Devolve escalar, nunca linha → RLS não precisaria saber recortar coluna.
create or replace function public.total_do_ciclo(p_challenge uuid, p_user uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when not public.sou_participante(p_challenge) then null
    else (
      select sum(v.value)
        from public.challenges ch
        join public.challenge_participants p
          on p.challenge_id = ch.id and p.user_id = p_user
        join public.group_visible_stats v
          on v.group_id   = ch.group_id
         and v.user_id    = p_user
         and v.metric_key = ch.metric_key
         and v.day between greatest(ch.starts_on, p.joined_at::date)
                       and least(ch.ends_on, current_date)
       where ch.id = p_challenge
         and exists (
           select 1 from public.group_data_consents c
            where c.group_id   = ch.group_id
              and c.user_id    = p_user
              and c.metric_key = ch.metric_key
         )
    )
  end
$$;

-- Barra coletiva: NULL — não zero — quando o grupo é pequeno demais.
-- NULL aqui quer dizer "não dá para mostrar sem entregar alguém", e a UI
-- escreve isso.
create or replace function public.barra_do_grupo(p_challenge uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  with ativos as (
    select p.user_id
      from public.challenges ch
      join public.challenge_participants p on p.challenge_id = ch.id
      join public.group_data_consents c
        on c.group_id = ch.group_id and c.user_id = p.user_id
       and c.metric_key = ch.metric_key
     where ch.id = p_challenge
  )
  select case
    when not public.sou_participante(p_challenge) then null
    when (select count(*) from ativos) < 4 then null          -- k mínimo = 4
    else (select sum(public.total_do_ciclo(p_challenge, user_id)) from ativos)
  end
$$;
```

---

### Migration 6 — `20260919140000_o_feed_nao_guarda_o_valor.sql`

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- O FEED NÃO GUARDA O VALOR
--
-- Um item de feed do tipo `ato` guarda o PONTEIRO (autor, dia, métrica) e é
-- renderizado através da mesma view com portão. Se guardasse
-- "Ana treinou 45min" congelado num campo de texto, revogar o consentimento
-- não alcançaria a cópia — e a promessa de revogação seria mentira dentro de
-- uma semana, sem ninguém perceber.
--
-- `text` só existe para kind='nota': palavras que a própria pessoa escreveu
-- PARA aquele grupo, sabendo que era para aquele grupo. É a diferença entre
-- publicar e ser publicado.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.group_feed (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  author_id  uuid not null references auth.users(id)    on delete cascade,
  kind       text not null check (kind in ('ato','nota')),
  ref_day    date,
  metric_key text references public.shareable_metrics(metric_key),
  text       text check (char_length(text) <= 500),
  created_at timestamptz not null default now(),
  -- Ato aponta, nota fala. Nunca os dois.
  check ((kind = 'ato'  and metric_key is not null and ref_day is not null and text is null)
      or (kind = 'nota' and text is not null and metric_key is null))
);
alter table public.group_feed enable row level security;

create table if not exists public.group_reactions (
  feed_id uuid not null references public.group_feed(id) on delete cascade,
  user_id uuid not null references auth.users(id)        on delete cascade,
  emoji   text not null check (char_length(emoji) <= 8),
  primary key (feed_id, user_id, emoji)
);
alter table public.group_reactions enable row level security;
```

---

### Migration 7 — `20260919160000_a_projecao_pode_mentir_e_precisa_ser_conferida.sql`

Rotina de reconciliação: recalcula as últimas N janelas de `shared_daily_stats` a partir da fonte, republica `group_visible_stats` conforme os consentimentos vigentes, e **apaga toda linha publicada sem consentimento correspondente**. É a resposta ao custo nº 1 do §2 — a segunda fonte da verdade pode divergir, e um agregado que ninguém confere vira um agregado em que ninguém pode confiar.

---

## 2. Como o grupo lê sem ver demais

**Escolha: AGREGADO DERIVADO E PUBLICADO. O grupo nunca toca em `life_events`, `transactions` ou `habit_logs`. Essas tabelas não ganham uma única política nova — nunca.**

### A defesa

O atalho tentador é uma política na fonte:

```sql
-- NUNCA. Nem em rascunho.
create policy "eventos_visiveis_ao_grupo" on public.life_events for select
using (public.compartilha_grupo(user_id) and kind in ('workout','water'));
```

Três razões para ela ser indefensável, nesta ordem:

1. **RLS não faz recorte de coluna.** Liberar a linha do `workout` libera o `payload` inteiro — que na captura por IA carrega texto livre que a pessoa escreveu achando que era só dela.
2. **`kind` é texto livre e a lista cresce.** O dia em que alguém trocar o `in (...)` por `= any(consented_kinds)` — mudança que parece uma generalização inocente — `'transaction'` entra pela porta, e com ele `payload.amount`. A decisão de fundador sobre o financeiro precisa ser **impossível de violar por descuido**, não difícil.
3. **O recorte não existe como dado.** "Treino sim, peso não" só pode virar política se houver uma linha cuja **identidade** seja a métrica. Na fonte, a linha é o evento e a métrica está dentro do `jsonb`. Modelar consentimento contra a fonte é lutar contra a forma do dado — e quem luta contra a forma do dado escreve política longa, e política longa é onde mora o bug.

No agregado longo `(user_id, day, metric_key, value)`, "desligar peso" é **a ausência de uma linha cuja chave primária contém a métrica**. A política fica em seis linhas legíveis. **Esse é o argumento inteiro: escolhi a forma em que a regra de privacidade é curta.**

### O que a escolha custa — sem maquiagem

1. **Segunda fonte da verdade**, que pode divergir da fonte (gatilho que falhou, regra que mudou). Custo permanente: migration 7 + teste projeção × `daily_metrics`.
2. **Amplificação de escrita:** 1 + N linhas por ato, N = número de grupos.
3. **Perda de contexto:** o grupo vê "2 treinos", não "2 treinos porque o terceiro virou fisioterapia". O agregado é mais pobre **por construção** — e essa pobreza é o produto, não um defeito.
4. **Nenhum backfill retroativo:** ligar uma métrica hoje não mostra ontem (`day >= granted_at`). Escolha deliberada; ver §3(a).
5. **A doutrina NULL-não-é-zero vira requisito de UI**, fora do meu alcance: ausência de linha é "sem registro", nunca "0". Se o front escrever "0", o banco estará certo e o produto estará mentindo — com plateia.

### As duas condições de schema que vieram do Fiel

**(i) Terceiro nunca recebe série diária — só total do ciclo.** Política de leitura limitada a `day >= current_date - 1`; histórico apenas via `total_do_ciclo(...)`, que **não tem parâmetro de data**. É a única exceção à regra "view `security_invoker`, política faz o trabalho", e ela se justifica porque RLS não sabe dizer "pode ler a SOMA mas não as linhas". O portão inteiro cabe em seis linhas auditáveis e a função devolve um escalar.

**(ii) Não existe ranking ordinal.** Média cortada; ranking por soma cortado (soma é monotônica em presença). Tela: barra coletiva (k ≥ 4) + cada um contra a própria meta, sem ordem.

---

## 3. As quatro revogações

Princípio único, herdado do parecer: **fail-closed por DELEÇÃO, não por predicado.** A política é a segunda parede; a primeira é a linha que deixou de existir.

### (a) Desligar um tipo de dado

```sql
delete from public.group_data_consents
 where group_id = $1 and user_id = auth.uid() and metric_key = $2;
```

O gatilho `trg_despublicar_ao_revogar` apaga **todas** as linhas de `group_visible_stats` daquele `(group_id, user_id, metric_key)` — o histórico inteiro, não só o futuro — e grava `consent_events`.

- **Efeito:** imediato no servidor e **retroativo**. Não some da tela porque um `where` escondeu: some porque as linhas não existem mais.
- **O histórico que os outros já viram:** desaparece do app para todo mundo, inclusive dos itens de feed antigos (que só tinham ponteiro) e do total do desafio (calculado ao vivo).
- **O dado da pessoa não é tocado:** `life_events` e `shared_daily_stats` continuam intactos. "Cancelou? Seus dados continuam seus" vale dentro do Social.
- **Religar não ressuscita:** a janela começa no `granted_at` novo. O período revogado fica escondido para sempre. É porta de uma via, e a UI precisa dizer isso **na hora de ligar**, não na de desligar.
- **O que não podemos desfazer:** o que a pessoa já leu. Print e memória não têm política — e prometer o contrário seria a primeira mentira do recurso.
- **Ressalva (b) do Fiel — o buraco é informação:** um vão de 3 a 20 de setembro se lê como "aconteceu alguma coisa ali", e o controle de privacidade vira sinal social. Mitigação estrutural: terceiros só enxergam `day >= current_date - 1` e totais de ciclo, então **não existe série onde ver o vão**. E **nunca mostrar o denominador da janela de terceiro** nem percentual do qual ele se derive — "Ana: 3 de 3" usa a meta da Ana, jamais "3 de 14 dias".

### (b) Sair do grupo

```sql
select public.sair_do_grupo($1);   -- delete from group_members where ...
```

`trg_despublicar_ao_sair` apaga, em cascata explícita: `group_data_consents` daquele grupo (que por sua vez dispara o gatilho de (a) para cada métrica), `group_visible_stats` daquele grupo, `group_feed` autorado. FK `on delete cascade` leva `challenge_participants` e `group_reactions`.

- **Efeito:** imediato e **nos dois sentidos** — a pessoa também para de ver o grupo no mesmo instante.
- **Histórico:** vai junto, inclusive as notas que ela escreveu. São palavras dela num grupo que deixou de ser dela.
- **Voltar depois** cria `joined_at` novo e **zero** consentimentos. O passado não volta com ela.

### (c) Ser removido do grupo

```sql
select public.remover_membro($1, $2);   -- role in ('owner','admin'), conferido DENTRO da função
```

Mesma mecânica de (b); `group_membership_events` registra quem removeu quem.

- **Admin não é deus:** nenhuma política dá a admin leitura mais larga que a de qualquer membro.
- **Não existe "exportar antes de remover":** o cliente nunca teve mais do que a view com portão — não há o que baixar.
- **Histórico:** idêntico a (b). Sai tudo.
- Notificar a pessoa é obrigatório, e o texto é território do Fiel: a diferença entre serviço e humilhação está na frase, não no SQL.

### (d) Apagar a conta

Toda tabela deste modelo referencia `auth.users(id) on delete cascade` — mesma garantia que `SEGURANCA.md` já documenta para o resto do app. **Uma exceção deliberada:** `groups.created_by` é `on delete set null`, senão apagar a conta de quem criou o grupo apagaria a vida registrada de outras seis pessoas. Gatilho promove o membro mais antigo a `owner`; grupo sem ninguém é limpo por rotina.

- **Efeito:** as linhas somem de todos os feeds e de todos os totais no mesmo commit.
- **Histórico:** é a razão de **não existir tabela de resultado de desafio**. Placar gravado sobreviveria à exclusão e faria de "apagar a conta" meia verdade.
- **Buraco honesto nº 1:** nenhuma cascata alcança o cache do cliente. Toda tela de grupo precisa de TTL curto e refetch em evento de consentimento. Prometer "imediato" com cache de 5 minutos é prometer errado.
- **Buraco honesto nº 2, e o mais grave:** **nenhum caminho de leitura do Social pode usar `SERVICE_ROLE_KEY`.** A service role passa por cima de toda política deste documento. Uma edge function `social-feed` escrita com ela anula o modelo inteiro, e nada aqui a impede — é regra de revisão de código, não de banco.

---

## 4. Os três vazamentos mais prováveis

### Nº 1 — Pegar o nome do colega em `profiles`

O pedido mais banal do Social tem a resposta errada mais cara do projeto, porque RLS é de linha:

```sql
-- ERRADO — entrega monthly_income, medications, health_conditions, sex, birth_year
create policy "grupo_ve_o_nome" on public.profiles for select to authenticated
using (public.compartilha_grupo(user_id));
```

Certo — `profiles` nunca abre, e a identidade nasce no grupo:

```sql
-- A identidade que o grupo vê é dado DO GRUPO: a pessoa escolhe como aparecer
-- em CADA grupo ("Henrique" entre amigos, "H." no trabalho). Nenhuma coluna
-- vem de profiles, porque profiles carrega renda, remédios e condição de saúde
-- na MESMA LINHA do nome — e RLS não recorta coluna.
create policy "identidade_so_dentro_do_grupo"
on public.group_members for select to authenticated
using (
  user_id = auth.uid()                           -- minha própria linha, sempre
  or public.sou_membro(group_members.group_id)   -- e as dos grupos em que estou
);

-- Canário: falha a migration se alguém abrir uma tabela de dono ao Social.
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles','life_events','transactions','habit_logs',
                         'battles','battle_checkins','ai_memories','chat_messages')
       and (coalesce(qual,'') ilike '%group_%' or coalesce(with_check,'') ilike '%group_%')
  ) then
    raise exception
      'Tabela de dono com política que menciona grupo. O Social lê projeção, nunca a fonte.';
  end if;
end $$;
```

### Nº 2 — Consentimento que perde o grupo no caminho

O mais provável de todos, porque a política **parece certa** e passa em qualquer teste feito com um grupo só. Liguei "peso" no grupo da família; o grupo do trabalho passa a ver:

```sql
-- ERRADO — o consentimento não está amarrado ao grupo que está lendo
create policy "grupo_le_o_liberado" on public.group_visible_stats for select to authenticated
using (
  public.sou_membro(group_visible_stats.group_id)
  and exists (
    select 1 from public.group_data_consents c
     where c.user_id    = group_visible_stats.user_id
       and c.metric_key = group_visible_stats.metric_key   -- <<< falta c.group_id
  )
);
```

Certo:

```sql
-- O consentimento é POR TIPO **E POR GRUPO**. As TRÊS colunas da chave
-- primária de group_data_consents têm de aparecer as três aqui: tirar
-- c.group_id transforma "liguei peso para a família" em "liguei peso para
-- todo mundo" — sem erro, sem log, sem sintoma.
--
-- day >= current_date - 1: terceiro nunca recebe série diária. A tabela é por
-- dia; sem esta linha, um SELECT devolve o calendário de bolinhas da vida de
-- alguém. Histórico só como total de ciclo, por total_do_ciclo(), que não tem
-- parâmetro de data.
--
-- day >= c.granted_at: ligar hoje não mostra ontem, e religar depois de
-- desligar não ressuscita o período revogado.
create policy "grupo_le_so_o_que_foi_liberado_naquele_grupo"
on public.group_visible_stats for select to authenticated
using (
  public.sou_membro(group_visible_stats.group_id)
  and group_visible_stats.day >= current_date - 1
  and exists (
    select 1 from public.group_data_consents c
     where c.group_id   = group_visible_stats.group_id      -- o grupo AMARRA
       and c.user_id    = group_visible_stats.user_id
       and c.metric_key = group_visible_stats.metric_key
       and group_visible_stats.day >= c.granted_at::date
  )
);

-- Zero política de INSERT/UPDATE/DELETE nesta tabela: só o gatilho definer
-- escreve, e ele faz fan-out POR CONSENTIMENTO — o mesmo c.group_id dos dois
-- lados. O erro acima, cometido no gatilho em vez de na política, publicaria
-- a linha errada e a política correta a leria com toda a razão.
```

### Nº 3 — Recursão em `group_members`, e o conserto que entrega o grafo social

```sql
-- ERRADO — "infinite recursion detected in policy for relation group_members"
create policy "membros_veem_membros" on public.group_members for select
using (
  exists (select 1 from public.group_members x
           where x.group_id = group_members.group_id and x.user_id = auth.uid())
);
-- E o conserto que quase todo mundo aplica sob pressão:  using (true)
```

`using (true)` em `group_members` não vaza métrica nenhuma — vaza a **lista de quem está em qual grupo**, que é dado de saúde sozinha. A lista de membros de um "Grupo Recomeço" diz o que nenhuma métrica diria.

```sql
-- Quebra a recursão com SECURITY DEFINER: a função lê group_members POR FORA
-- da RLS, então a política que a chama não reentra em si mesma.
--
-- Ela pergunta só por auth.uid(), NUNCA por um user_id arbitrário. Uma
-- e_membro(grupo, pessoa) genérica seria um ORÁCULO: qualquer um sondaria
-- "fulano está no Grupo Recomeço?" e receberia sim/não — vazamento sem
-- precisar ler uma linha.
create or replace function public.sou_membro(p_group uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members m
     where m.group_id = p_group and m.user_id = auth.uid()
  )
$$;

revoke execute on function public.sou_membro(uuid) from public, anon;
grant  execute on function public.sou_membro(uuid) to authenticated;
```

### Duas armadilhas menores, que já custaram dia de trabalho a outra gente

**`greatest()` ignora NULL em Postgres.** `greatest('2026-01-01'::date, null)` devolve a data, não NULL. Uma janela escrita como `day >= greatest(entrei_em(g), consentiu_em(g))` **abre tudo** quando a função devolve NULL para quem não é membro. Toda função de janela deste modelo devolve `'infinity'::date` quando não há direito — nunca NULL.

**Convite.** `group_invites` guarda `code_hash`, ninguém lê a tabela, e aceitar é RPC `security definer` com teto de tentativas — mesmo raciocínio dos 6 dígitos do pareamento de WhatsApp em `SEGURANCA.md`, onde a falta do teto tornava o código força-brutável até vincular a conta de outra pessoa.

---

## 5. Chute de custo — ordem de grandeza

| | quantidade |
|---|---|
| **Migrations** | **7** — 6 de modelo + 1 de reconciliação |
| **Tabelas** | **13** |
| **Políticas de RLS** | **~35** — das quais **6 concentram todo o risco**: as duas de `group_visible_stats`, a de `group_members`, a de `group_feed`, a de `group_reactions` e a de `challenge_participants`. As outras ~29 são `auth.uid() = user_id` de rotina |
| **Views** | **4** — `v_grupo_hoje`, `v_grupo_membros`, `v_desafio_progresso`, `v_meus_consentimentos`. Todas `security_invoker = true`; **nenhuma é fronteira de segurança** |
| **Funções `security definer`** | **~11** — `sou_membro`, `sou_admin`, `sou_participante`, `janela_de_visao`, `aceitar_convite`, `sair_do_grupo`, `remover_membro`, `projetar_dia`, `publicar_consentimento`, `total_do_ciclo`, `barra_do_grupo` |
| **Testes obrigatórios** | **~12** — um por revogação (4), um por vazamento (3), o canário das tabelas de dono, projeção × `daily_metrics`, k mínimo, `greatest`/NULL, e o `check pillar <> 'prosperidade'` |

**Nada disso toca front, e nenhuma linha existente de RLS muda.** O Social é aditivo por construção: se a camada inteira for revertida, o app volta a ser de uma pessoa só sem nenhuma migração de volta.

---

## 6. O que ainda depende de decisão de fundador

1. **A janela de quem chega depois.** Adotei: o membro novo vê o histórico do outro só a partir de `greatest(entrada dele, entrada minha, consentimento)`. Quem entra em setembro não vê julho de ninguém — mais seguro, possivelmente frustrante ("por que o grupo está vazio?"). A alternativa amplia a audiência do meu julho sem eu ter feito nada. **Escolhi o fechado; é reversível na direção segura, não na outra.**
2. **A cópia publicada (`group_visible_stats`).** Duplica dado por grupo para que revogar seja `DELETE` e não `WHERE`. Custa amplificação de escrita e uma rotina de reconciliação permanente. O Fiel considera isso o risco nº 1 de gravidade; eu concordo. **Confirma que o custo está pago?**
3. **`peso_registrado`.** Sobreviveu ao corte do delta, mas é a chave do catálogo de que menos gosto: mesmo como ato, "não subiu na balança" é frase que alguém pode usar contra outra pessoa. Se você quiser cortar, o catálogo cai para 8 e **nada mais muda no modelo**.
