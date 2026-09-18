# Parecer de Arquitetura de IA — fusão `vitalidade` + `alimentacao`

**Escopo:** a superfície de IA. Não implementei nada.
**Evidência:** li `_shared/lib.ts` (2.054 linhas), `ai-chat/index.ts`, `capture`, `briefing`,
`onboarding-blueprint`, `whatsapp-webhook`, `_shared/usage.ts`, `src/lib/pillars.ts`,
`src/lib/captureEvents.ts`, `src/lib/prosperidade.ts`, `src/pages/Ajustes.tsx`,
`supabase/setup.sql`, as migrations de `insights`, PRINCIPIOS.md e POSICIONAMENTO.md.

---

## RESUMO EXECUTIVO — as cinco decisões

| # | Decisão | Em uma linha |
|---|---|---|
| 1 | **`ai_scopes` = E (AND)** | `saude = vitalidade AND alimentacao`, com **leitura DERIVADA** no código (não confia na migration) |
| 2 | **Normalização no CÓDIGO, e o campo `pillar` SAI do tool** | `pillar` é 100% derivável de `kind`; pedir ao modelo um dado derivável é pagar token por um modo de falha |
| 3 | **NÃO chamar o pilar de "Saúde"** | "SAÚDE" já tem DOIS significados dentro do mesmo retrato. Um terceiro é ambiguidade que nós criamos |
| 4 | **Manter o id interno `vitalidade`** | A fusão vira ABSORÇÃO (`alimentacao` → `vitalidade`), não renomeação de dois em um terceiro. Migração cai pela metade |
| 5 | **INSIGHT KINDS não renomeiam** | Nenhum dos três nomes contém nome de pilar. O que muda é o VALOR do mapa, não a CHAVE |

**Custo:** a fusão é neutra em token. Não sobra orçamento. O que existe é um **custo
único de deploy** (invalidação de cache, ~R$ 0,10 por usuário ativo) que só se paga uma
vez **se todas as edições de prompt e de tool forem num único deploy**.

---

## 0. A DESCOBERTA QUE MUDA O DESENHO INTEIRO (leia antes das 6 respostas)

O levantamento diz que "Saúde já é CATEGORIA DE DESPESA". Está certo, e é pior do que isso.

**A palavra "SAÚDE" já aparece DUAS vezes no retrato do Conselheiro, com dois significados
diferentes, hoje, antes da mudança:**

1. `_shared/lib.ts:728` — o bloco clínico:
   `SAÚDE — condições informadas pela própria pessoa: diabetes; hipertensão.`
2. `_shared/lib.ts:757` e `:790` — a categoria de despesa, dentro do bloco de finanças:
   `FINANÇAS (mês atual): ... Maiores gastos: Mercado R$ 812,00, Saúde R$ 240,00, ...`
   `ESTIMATIVAS DECLARADAS PELA PESSOA: ... Saúde ~R$ 300,00/mês, ...`
   (e `src/lib/prosperidade.ts:29`, `FIXED_SUGGESTIONS`, injeta "Plano de saúde / academia"
   na mesma categoria — a linha `GASTOS FIXOS RECORRENTES` pode carregar a palavra também)

Chamar o pilar de "Saúde" põe um **terceiro** significado no mesmo prompt. Isso não é
preciosismo de nomenclatura: `SAFETY_RULES` (`lib.ts:1189`) proíbe o modelo de usar
vocabulário interno com a pessoa, e o retrato inteiro é construído sobre rótulos em CAIXA
ALTA que o modelo usa como âncora semântica. Três âncoras com o mesmo nome é o oposto do
desenho.

Isso reordena as respostas: **a pergunta 3 é a primeira**, porque a escolha do nome decide
o tamanho da migração das perguntas 1, 2 e 5.

---

## 3) A COLISÃO PILAR-SAÚDE × CATEGORIA-SAÚDE — é real, e resolve-se pelo nome

### É problema real. Você não está inventando. O cenário de falha, concreto:

Pessoa desliga o escopo do pilar fundido. O retrato passa a conter, ao mesmo tempo:

```
PRIVACIDADE: a pessoa desativou a análise das áreas: saude. Esses dados foram
omitidos deste retrato de propósito. Não especule sobre eles nem peça para reativar.
...
FINANÇAS (mês atual): entradas R$ 4.200,00, saídas R$ 3.180,00, saldo R$ 1.020,00.
Maiores gastos: Mercado R$ 812,00, Saúde R$ 240,00, Transporte R$ 190,00.
```

O bloco de finanças está **corretamente autorizado** (`scopes.prosperidade`, `lib.ts:751`).
O modelo agora segura uma proibição sobre "saude" e um dado rotulado "Saúde". Dois desfechos,
os dois ruins:

- **(a) Ele obedece à proibição e cala sobre os R$ 240,00.** A pessoa VÊ esse gasto na tela
  Prosperidade e pergunta ao Conselheiro, que nega. É **exatamente o furo de 13/09/2026** que
  você já corrigiu em `trendLines` (`lib.ts:275-296`): "duas superfícies do mesmo produto se
  contradizendo sobre a vida dela, e quem mente é justamente a que ela não tem como conferir".
  Reintroduzir o mesmo furo por uma escolha de nome, três dias depois de fechá-lo, é caro.
- **(b) Ele trata o gasto de farmácia como licença para falar de saúde.** Vazamento do escopo
  que ela fechou — o dado sai pelo lado que continua aberto, a definição de vazamento que o
  comentário de `lib.ts:265-270` já usa.

E há um terceiro dano, **com o escopo LIGADO**, que é o pior porque é visível: as frases do
próprio Conselheiro ficam ambíguas para a LEITORA. "Seu gasto com Saúde subiu 40%" e "sua
Saúde melhorou esta semana" são a mesma palavra em duas funções. A pessoa não tem glossário.

### As duas saídas, e por que escolho a segunda

**(a) Manter o nome "Saúde" e desambiguar no prompt.** Rejeito. Exige uma nota de rodapé
permanente do tipo *"o pilar Saúde não se confunde com a categoria de despesa Saúde nem com
o bloco SAÚDE de condições clínicas"* em TODA superfície que lê o retrato (Conselheiro,
briefing, retrospectiva, Blueprint). É token pago para sempre para desfazer uma decisão de
nome que custou zero para tomar. Pior: a alternativa "renomear a categoria de despesa" é
migração de dados em `transactions.category` (string literal em toda linha de todo usuário),
em `STATEMENT_CATEGORIES` (`lib.ts:1934`), na regra de classificação (`lib.ts:2012`,
"farmácia/consulta → Saúde") e no modelo mental da pessoa, que vê a categoria na tela. Caríssima.

**(b) Não chamar o pilar de Saúde.** É de graça, e é o que recomendo.

### Qual nome: **`vitalidade` como id interno**; o rótulo de tela é decisão sua entre "Vitalidade" e "Corpo"

Separe as duas coisas, que o código já separa (`PillarMeta.id` vs `PillarMeta.name`,
`src/lib/pillars.ts:8-13`):

**O id interno deve continuar `vitalidade`.** Não é conservadorismo, é aritmética de migração.
Mantendo o id, a fusão deixa de ser "dois pilares viram um terceiro" e passa a ser
**`alimentacao` é absorvido por `vitalidade`** — uma direção só. O que isso economiza,
item por item, tudo verificado no código:

| Artefato | Se o id for `saude` | Se o id for `vitalidade` |
|---|---|---|
| `ai_scopes` — chave nova ausente = AUTORIZADO | **o risco central do seu levantamento** | não existe: a chave `vitalidade` está em 100% dos perfis (default da coluna, `setup.sql:735`) |
| `life_events.pillar` backfill | 2 valores legados | 1 valor legado (`alimentacao`) |
| `habits.pillar` default `'vitalidade'` (`setup.sql:223`) + triggers `coalesce(h.pillar,'vitalidade')` (`:252`, `:477`) | 3 objetos SQL a alterar | **zero** |
| CSS var `--vitalidade` (`index.css`) | renomear | zero |
| Rota `/app/vitalidade` (+ `whatsapp-webhook/index.ts:655` que manda a pessoa para ela) | renomear + redirect | zero |
| `TrendInsights.tsx` `pillars: ["--vitalidade", ...]` + o teste-espelho que faz regex nele (`lib.test.ts:753`) | mexer nos dois | zero |
| Prompts `briefing/index.ts:25` e `:38` ("estimativas de vitalidade") e `lib.ts:~875` ("ESTIMATIVAS DE VITALIDADE DECLARADAS") | reescrever 3 | **zero** |
| POSICIONAMENTO.md §H.2 ("Raio-X de Prosperidade e de Vitalidade" — documento que é contrato) | emenda de fundador | zero |

**Sobre o rótulo de tela**, a decisão é sua, e eu só cravo um "não":

- **"Vitalidade"** — desc atual é "Corpo, sono, treino e energia"; vira "Corpo, sono, treino,
  comida e energia". Coerente: comida é insumo do corpo. Custo honesto: quem chegou pela dieta
  pode não procurar "refeições" dentro de "Vitalidade". É um custo de descoberta real.
- **"Corpo"** — palavra que POSICIONAMENTO.md §A usa para descrever o cliente-alavanca
  ("arrumar **o corpo** e o dinheiro ao mesmo tempo"). Zero colisão no sistema inteiro. Concreto,
  brasileiro, não-clínico.
- **"Saúde" — não.** Além da colisão tripla acima, há um argumento de posicionamento: as
  `SAFETY_RULES` gastam quatro marcadores dizendo que o Conselheiro **não é médico**
  (`lib.ts:1191`), a lista NUNCA de POSICIONAMENTO.md §G tem o item 7 ("Conselheiro fingindo
  ser profissional de saúde"), e a anti-persona §C.2 é "quem quer IA-terapeuta". Batizar de
  "Saúde" o pilar em que esse Conselheiro opera empurra o produto exatamente para o
  enquadramento que os dois documentos passam o tempo todo recusando. Não é fatal, mas é uma
  micro-incoerência do tipo que PRINCIPIOS.md manda vigiar.

**Minha recomendação:** id `vitalidade`, rótulo **"Corpo"**. Se o rótulo "Corpo" incomodar,
"Vitalidade" resolve igual — o que importa para a IA é o id e a ausência de homônimo.

> **O resto deste parecer assume id = `vitalidade`.** Onde a decisão mudar a resposta,
> está marcado com ⚠.

---

## 1) `ai_scopes` — E (AND). E a migration não é a defesa: a LEITURA DERIVADA é.

### Por que E, e não OU

**O argumento de privacidade.** Escopo é contrato: "o que o Conselheiro pode analisar". A
pessoa que negou `alimentacao` tirou do Conselheiro peso, composição corporal, calorias,
proteína, hidratação e refeições — os gates `lib.ts:917, :934, :952, :1040` e o bloco de
`refeicao_gasto_comida`. Sob OU, uma refatoração NOSSA devolve tudo isso sem que ela toque em
nada. Não existe consentimento para isso; não existe nem notificação. É o único desfecho
irreversível das duas opções: dado analisado não desanalisa.

Sob E, a falha é a oposta: quem negou só `alimentacao` perde também sono e treino. É perda de
UTILIDADE — visível, reversível com um toque, e na direção que este código já escolheu em todo
lugar. A precedência está escrita e testada:

- `lib.ts:265-274`, decisão 1 do bloco de tendências: *"a regra é a mais restritiva possível:
  TODOS os pilares que a análise toca precisam estar autorizados, não 'pelo menos um'"*;
- `lib.ts:470`: `pilares.every((p) => scopes[p] !== false)` — `every`, não `some`;
- `lib.ts:283-296`: *"na dúvida, o retrato fica mais pobre, nunca mentiroso"*.

OU contradiz `every` no mesmo arquivo. E é a mesma doutrina.

**O argumento de QUALIDADE, que é o mais forte e ninguém costuma citar.** Hoje existe um estado
de retrato incoerente que a fusão **torna impossível**: `vitalidade=true, alimentacao=false`.
O Conselheiro recebe treinos, sono, meta de treinos e meta de sono — e **nenhum peso, nenhuma
caloria, nenhuma proteína**. E aí o `PROTOCOLO DE PLANOS DEFINITIVOS` (`ai-chat/index.ts:~88`)
exige "peso atual" para plano alimentar e o retrato manda pedir o que falta. Resultado: o
Conselheiro pede um dado que a pessoa deliberadamente escondeu, num retrato que já lhe disse
"não peça para reativar". **O E elimina esse estado do universo.** Meio corpo visível era um
bug de contexto, não de prompt, e a fusão com E é a correção.

### O que a migration grava

Ela grava **uma coisa só**, e não apaga nada:

```sql
-- R1 — expand. Reversível: nada é apagado, nenhuma chave some.
update public.profiles
set ai_scopes = ai_scopes || jsonb_build_object(
      'vitalidade',
      coalesce(ai_scopes->>'vitalidade','true')  <> 'false'
  and coalesce(ai_scopes->>'alimentacao','true') <> 'false'
    )
where coalesce(ai_scopes->>'alimentacao','true') = 'false';   -- só quem muda de fato
```

- A chave `alimentacao` **permanece**, com o valor original. Ela é (a) o rollback e (b) o que a
  função VELHA lê durante a janela.
- O `where` restrito faz a migration tocar só as linhas que mudam — e o `count` dele é o número
  que você deve ver **antes** de decidir. Rode primeiro:

```sql
select count(*) filter (where (ai_scopes->>'vitalidade')  = 'false'
                          and (ai_scopes->>'alimentacao') is distinct from 'false') as so_vit,
       count(*) filter (where (ai_scopes->>'alimentacao') = 'false'
                          and (ai_scopes->>'vitalidade')  is distinct from 'false') as so_ali,
       count(*) filter (where (ai_scopes->>'vitalidade')  = 'false'
                          and (ai_scopes->>'alimentacao') = 'false')                as ambos,
       count(*) as total
from public.profiles;
```

`so_ali` é exatamente quem perde análise por causa do E. Se for 0 ou perto disso — o provável,
já que o default da coluna liga tudo e desligar exige ir em Ajustes — a discussão E-vs-OU é
teórica e o E sai de graça. Se for grande, o número é seu, não meu.

⚠ **Se o id virar `saude`:** a migration é a mesma, mas gravando a chave `saude`, e aí ela deixa
de ser otimização e vira obrigatória, porque `saude` ausente = autorizado nos 7 gates.

### O que o código passa a ler durante a convivência

**Esta é a peça central, e ela torna a ordem do deploy irrelevante.** O novo `lib.ts:653-657`
**não** lê a chave nova direto. Ele DERIVA:

```ts
const rawScopes = (p.ai_scopes ?? {}) as Record<string, unknown>;
/* FUSÃO — leitura derivada, não migração. A chave `alimentacao` ainda existe em
   perfis não migrados e em perfis que a tela de Ajustes reescreveu. Enquanto ela
   existir, ela MANDA junto: autorizado só quando NENHUMA das duas disse não.
   É o mesmo `every` de INSIGHT_PILARES, aplicado à fusão.
   Some daqui na release de contração, junto com a chave no banco. */
const scopes = {
  prosperidade: rawScopes.prosperidade !== false,
  vitalidade:   rawScopes.vitalidade !== false && rawScopes.alimentacao !== false,
  mente:        rawScopes.mente !== false,
  diario:       rawScopes.diario !== false,
};
```

Consequências, todas verificadas:

- **Os 7 gates (`:835, :886, :917, :934, :952, :1040, :1061`) não precisam de conserto
  individual.** Eles leem `scopes.*`, que é montado num lugar só. Os gates de `alimentacao`
  passam a ler `scopes.vitalidade`. É rename mecânico, não decisão.
- **Perfil NÃO migrado + função NOVA:** deriva de `alimentacao=false` → correto. Sem vazamento.
- **Perfil migrado + função VELHA:** lê `vitalidade` (já é o AND) e `alimentacao` (intacta).
  Ambas fecham o que tem de fechar. Sem vazamento.
- **Perfil migrado + função NOVA:** `!== false && !== false` — idempotente. Sem vazamento.
- Ou seja: **a migration pode rodar antes, depois, no meio, ou nunca.** Ela só evita recomputar
  e dá à tela uma chave canônica para escrever. Migration como otimização, não como correção,
  é a única forma de migração que não precisa ser perfeita.

### O vazamento que ninguém vê: `Ajustes.tsx:180`

Achado que merece destaque porque é silencioso e vai na direção errada (abre o que estava
fechado):

```ts
// src/pages/Ajustes.tsx:172-181
for (const sc of SCOPES) next[sc.id] = raw[sc.id] !== false;   // monta a partir da LISTA
...
await supabase.from("profiles").update({ ai_scopes: next })    // grava o OBJETO INTEIRO
```

A tela grava o objeto **inteiro, reconstruído a partir da constante `SCOPES`**. Se o front novo
tirar `alimentacao` da lista, o primeiro toque em QUALQUER interruptor de privacidade **apaga a
chave `alimentacao` do banco**. E aí, para qualquer instância de função ainda velha —
ou para um rollback — vale `raw["alimentacao"] !== false`, com a chave ausente: **autorizado**.
A pessoa acabou de mexer na tela de privacidade e a consequência foi reabrir o que ela havia
fechado.

**Regra da janela, inegociável:** enquanto existir função velha em produção, o toggle fundido
espelha o valor nas duas chaves.

```ts
const toggleScope = async (id: string, on: boolean) => {
  const next = { ...scopes, [id]: on };
  // ESPELHO DA FUSÃO — remover só na release de contração, junto com a
  // leitura derivada em lib.ts. Sem isto, a chave ausente = AUTORIZADO
  // reabre para a função velha o que a pessoa acabou de fechar.
  if (id === "vitalidade") next.alimentacao = on;
  ...
};
```

E o `default` da coluna (`setup.sql:735`) fica como está durante a janela (as duas chaves em
`true`): conta nova lida por função velha continua correta.

### Contração (uma release depois, com todas as funções novas em produção)

1. `update public.profiles set ai_scopes = ai_scopes - 'alimentacao';`
2. `alter table ... alter column ai_scopes set default` sem a chave.
3. Tira a derivação de `lib.ts` e o espelho de `Ajustes.tsx`. Um comentário em cada apontando o
   outro, para que saiam juntos.

---

## 2) CAPTURE_TOOL e a janela de deploy

### Primeiro, uma correção de premissa que simplifica tudo

**Não existe janela "front novo × função velha" no enum.** O front nunca envia `pillar`; ele
apenas **recebe** o valor proposto, pinta um pontinho (`CaptureBar.tsx:340`) e o grava verbatim
em `life_events` (`captureEvents.ts:447`, via `lifeEventRow`). O enum vive inteiro no servidor.

O que existe de verdade é outra coisa, e **nenhuma das duas direções perde captura**:

| Combinação | O que acontece | Perde captura? |
|---|---|---|
| Função VELHA + front NOVO | propõe `alimentacao`; `pillarById()` devolve `undefined` → pontinho cinza e o rótulo cai para o id cru (`CaptureBar.tsx:361`); grava `alimentacao` | **Não.** Mas a linha nasce com pilar legado e some das telas que filtram por pilar |
| Função NOVA + front VELHO | propõe `vitalidade`; front velho conhece `vitalidade` → pinta certo; grava `vitalidade` | **Não**, e nem cosmético |

Ou seja, sob o id `vitalidade` a direção perigosa é **só uma**, e o dano é de VISIBILIDADE, não
de perda: `.eq("pillar", …)` em `useMokariData.tsx:54`, a contagem de afinidade do Mokari
(`mokari.ts:306`) e as páginas de pilar deixam de enxergar a linha.

⚠ Com id `saude`, as duas direções ficam cosmética-e-invisíveis, e o `life_events` acumula
**três** valores. Mais um ponto para `vitalidade`.

### A resposta às suas três perguntas

**"Quem normaliza, o modelo ou o código?" — CÓDIGO. Concordo com você, e por três razões,
em ordem de força:**

1. **O `pillar` é o único campo da proposta que a pessoa não consegue auditar.** Todo o resto
   do cartão de confirmação é frase em português que ela lê e corrige ("Almoço: arroz e frango
   (~650 kcal)"). O pilar é um pontinho colorido e um rótulo. Um campo que ninguém confere
   **não pode** depender de um escritor probabilístico. É a mesma doutrina de
   `src/lib/insights.ts` que o seu próprio código cita: **o modelo explica, o código calcula.**
2. **O enum mora dentro do PREFIXO CACHEADO.** A ordem do prefixo da Anthropic é
   `tools → system → messages` (está escrito, com a conta, em `lib.ts:1637-1645`). O
   `CAPTURE_TOOL` entra em `COMBINED_TOOL` (`lib.ts:1619`) e em `IMAGE_CAPTURE_TOOL`
   (`capture/index.ts:211`). Toda edição no enum invalida a cache de extração da base inteira.
   Regra de conversão em código ≠ prefixo: muda sem custo de cache, para sempre.
3. **O campo é 100% DERIVÁVEL de `kind`.** Olhe a própria descrição, `lib.ts:1252-1254`:
   `transaction→prosperidade; sleep/nap/workout→vitalidade; meal/water/weight→alimentacao;
   mood/gratitude/practice→mente`. Isso não é julgamento: é uma tabela. Pedir ao modelo um
   valor que o código calcula de um campo que o modelo já devolveu custa token de entrada,
   token de saída e compra **só** um modo de falha.

**Bônus que a leitura expôs:** `note` **não está no mapeamento**. O modelo hoje chuta o pilar
de toda nota livre, sem instrução nenhuma. Prova de que o campo já é frágil. Ao derivar,
**decida `note` explicitamente** (recomendo `mente`, que é onde diário/humor vivem) em vez de
deixar o chute continuar.

**"O enum aceita os dois valores por quanto tempo?" — NUNCA, sob a recomendação.**

O campo sai do schema. E se você preferir mantê-lo, a resposta continua sendo **nunca aceitar
os dois**: um enum com dois sinônimos para o mesmo conceito pede ao modelo uma distinção que o
produto acabou de eliminar, e ele vai sortear. Cara-ou-coroa gravado no banco, para sempre,
sem ninguém perceber. Os valores legados vivem **no normalizador do código**, e ficam lá
permanentemente — um `Record` de 2 entradas não custa nada e protege contra qualquer linha
antiga e qualquer cliente que não atualizou.

### A sequência que não perde captura em nenhuma ordem de deploy

**Peça 0 — a função pura, em `_shared/lib.ts`, exportada e testada:**

```ts
/** Pilar canônico de um evento. O modelo NÃO decide isto: é tabela.
 *  Os valores legados (`alimentacao`) ficam aqui para sempre — custam um
 *  lookup e cobrem linha antiga, cliente desatualizado e rollback. */
const PILLAR_BY_KIND: Record<string, string> = {
  transaction: "prosperidade",
  sleep: "vitalidade", nap: "vitalidade", workout: "vitalidade",
  meal: "vitalidade", water: "vitalidade", weight: "vitalidade",
  mood: "mente", gratitude: "mente", practice: "mente",
  note: "mente",                     // decisão explícita: hoje é chute do modelo
};
const PILLAR_ALIASES: Record<string, string> = { alimentacao: "vitalidade" };

export function canonicalPillar(kind: string, raw?: string): string {
  return PILLAR_BY_KIND[String(kind)]
      ?? PILLAR_ALIASES[String(raw)]
      ?? (raw && VALID_PILLARS.includes(raw) ? raw : "mente");
}
```

**R1 — EXPAND (leitores tolerantes; ninguém escreve valor novo ainda).**
Deployável em qualquer ordem, porque **nada muda no que é gravado**.
- Todo leitor que filtra por pilar aceita os dois: `useMokariData.tsx:54`,
  `mokari.ts:306`, páginas de pilar, `ai-chat/index.ts:565` e `:702` (`VALID_PILLARS` com 5
  valores), `onboarding-blueprint/index.ts:23`.
- `lib.ts:653` ganha a **leitura derivada** de escopos (seção 1).
- `Ajustes.tsx` ganha o **espelho** de chaves (seção 1).
- Migration de `ai_scopes` (seção 1).
- `canonicalPillar` entra no arquivo, **sem ser chamada no caminho de escrita ainda**.
- `CAPTURE_TOOL` e prompts **intocados** → **cache intacta**.

**R2 — MIGRATE (os escritores viram, todos num deploy só).**
- `CAPTURE_TOOL`: remove `pillar` de `properties` e de `required` (`lib.ts:1250-1256, :1274`).
- `canonicalPillar(ev.kind)` aplicada em **dois pontos de estrangulamento**:
  - **saída do servidor:** retorno de `extractEventsAndMemories` (`lib.ts:~1925`), caminho de
    imagem de `capture/index.ts:309`, caminho do WhatsApp. Toda proposta que sai de qualquer
    função já sai canônica;
  - **escrita do cliente:** `lifeEventRow` (`captureEvents.ts:447`). **É este cinto que faz a
    ordem do deploy não importar:** mesmo recebendo `alimentacao` de uma função velha ainda no
    ar, a linha entra no banco como `vitalidade`.
- Prompts reescritos (seção 4). Enums de `ai-chat:141`, `:173` e `onboarding:57` perdem um valor.
- Backfill, que pode rodar a qualquer momento depois de R1 porque os leitores já aceitam os dois:
  ```sql
  update public.life_events set pillar = 'vitalidade' where pillar = 'alimentacao';
  update public.habits       set pillar = 'vitalidade' where pillar = 'alimentacao';
  update public.plans        set pillar = 'vitalidade' where pillar = 'alimentacao';
  ```

**R3 — CONTRACT (uma release depois):** leitores param de aceitar `alimentacao`; chave do
`ai_scopes` some; espelho e derivação saem. `canonicalPillar` **fica**.

### Duas fontes de pilar legado que estão FORA de todo normalizador TypeScript

Fácil de perder, porque não passa por edge function nem por front:

- `setup.sql:223` — `habits.pillar text not null default 'vitalidade'`
- `setup.sql:252` e `:477` — os triggers de `habit_logs`:
  `insert into life_events (..., coalesce(h.pillar, 'vitalidade'), 'habit_done', ...)`
- `setup.sql:1117` e `migrations/20260914140000_*.sql:93` — inserts de `life_events` a partir de
  transações

Sob id `vitalidade` esses quatro pontos **não precisam mudar** — mais um dividendo do nome.
⚠ Sob id `saude`, eles cunham pilar legado para sempre, de dentro do banco, invisivelmente.
Se for `saude`, entram na R2 obrigatoriamente.

---

## 4) PROMPTS — a régua, o que reescreve, e o que some de graça

### A régua (uma frase, checável por grep)

> **Menção a "alimentação"/"vitalidade" que nomeia uma TELA, um INTERRUPTOR ou um PILAR →
> reescreve. Menção que nomeia uma parte da VIDA → fica.**

A vida da pessoa continua tendo comida depois da fusão. Só a topologia do app mudou. Confundir
as duas coisas leva a reescrever prompt bom por burocracia.

### A) REESCREVER — nomes de TELA (a categoria mais perigosa)

Perigosa porque cada uma destas linhas existe **para evitar** que o modelo invente tela. Deixá-las
desatualizadas faz a instrução produzir exatamente o dano que ela foi escrita para impedir —
mandar a pessoa para uma tela que não existe mais.

| Onde | Texto hoje |
|---|---|
| `lib.ts:1132` | `"...peso na aba Alimentação; condições e medicamentos na Vitalidade."` (bloco DADOS AINDA NÃO INFORMADOS, que na mesma linha ordena: *"nunca invente o nome de uma tela"*) |
| `lib.ts:1126` | `missing.push("peso atual (registrar na aba Alimentação)")` |
| `ai-chat/index.ts:93` | mesma lista de telas, no PROTOCOLO DE PLANOS, item 1 |
| `lib.ts:~1055` | `"...a pessoa pode definir na aba Alimentação..."` (meta calórica sem valor) |
| `analyze-body/index.ts:85` | `"Continue registrando seu peso na aba Alimentação."` (string ao usuário, mesma classe) |

### B) REESCREVER — descrições de tool com mapeamento por pilar

| Onde | O que muda |
|---|---|
| `lib.ts:1250-1256` | campo `pillar` do `CAPTURE_TOOL` — **sai inteiro** (seção 2) |
| `onboarding-blueprint/index.ts:57` | `"alimentar→alimentacao; treino→vitalidade; financeiro→prosperidade; rotina→vitalidade ou mente"` → colapsa duas pernas em uma. Melhor ainda: **derive** (3 dos 4 são tabela; só `rotina` é ambíguo, e mesmo ela tem default óbvio) |
| `ai-chat/index.ts:141, :173` | enums de 4 → 3 valores |

### C) FICA COMO ESTÁ (e é a metade que se erra por reflexo)

- **`ai-chat/index.ts:44`**, primeira linha do Conselheiro: *"finanças, corpo, alimentação,
  mente e espírito"*. É enumeração de **áreas da vida**, não de pilares. A pessoa continua
  comendo. **Não toque.**
- **`ai-chat/index.ts:46`**: *"um plano alimentar deve caber no orçamento"* — descreve o
  cruzamento, que é a razão de existir do produto. Fica.
- **`SAFETY_RULES`, `lib.ts:1196`**: *"redirecione com gentileza para hábitos positivos no pilar
  Alimentação"*. ⚠ **Única exceção da categoria C:** aqui "pilar" é literal. Troca de duas
  palavras. (É também a linha mais delicada do arquivo — transtorno alimentar — então a troca
  é cirúrgica, não reescrita.)
- **`briefing/index.ts:25` e `:38`**, `lib.ts:~875` ("ESTIMATIVAS DE VITALIDADE DECLARADAS"),
  `whatsapp-webhook/index.ts:655` (`/app/vitalidade`): **inalterados sob id `vitalidade`.**
  ⚠ Sob id `saude`, os quatro entram na lista A.
- **Comentários de código** (`lib.ts:266`, o bloco de doutrina de `trendLines`): precisam de
  atualização por honestidade, **custam zero token** e não são prompt. Não os misture na
  contagem — confundir comentário com prompt é como se estima custo errado.

### D) PARA DE FAZER SENTIDO — some de graça

1. **A frase de mapeamento inteira** em `lib.ts:1252-1254`. Metade dela
   (`sleep/nap/workout→vitalidade; meal/water/weight→alimentacao`) só existia para partir o
   corpo em dois. Sai com o campo.
2. **Uma linha inteira do painel de privacidade** em Ajustes: um interruptor a menos para
   explicar, e a coluna `disabled` do retrato encurta.
3. **Uma perna do `onboarding-blueprint:57`.**
4. **Um estado de retrato que deixa de existir:** o "meio corpo visível" da seção 1. Não é nota
   de rodapé — é uma classe inteira de retrato incoerente saindo do universo. O maior ganho de
   qualidade desta mudança, e ele é grátis.

### E) BÔNUS QUE A FUSÃO DEIXA ÓBVIO (2 linhas, ganho real)

`lib.ts:659-661` despeja **ids crus** no prompt:

```ts
lines.push(`PRIVACIDADE: a pessoa desativou a análise das áreas: ${disabled.join(", ")}.`);
// produz: "...as áreas: alimentacao, diario."
```

"alimentacao" e "diario", sem acento, em snake, são exatamente o "vocabulário interno do
sistema" que `SAFETY_RULES` proíbe o modelo de usar — e nós o entregamos pronto na boca dele.
`Pilares ativos: ${(p.pillars ?? []).join(", ")}` (`lib.ts:~700`) tem o mesmo problema. Um
`Record<id, rótulo>` de 4 entradas conserta os dois. Já existe um exemplar dessa solução no
arquivo (`TRACKER_LABEL`, `lib.ts:~666`) — é copiar o padrão.

---

## 5) INSIGHT KINDS — ficam. Zero renomeação, zero migration.

**A premissa do levantamento precisa de um ajuste:** os três nomes **não contêm nome de pilar**.

```
sono_gasto_seguinte     = sono × gasto do dia seguinte
refeicao_gasto_comida   = refeição × gasto com comida
treino_sono             = treino × sono
```

Eles nomeiam a **medição**, não o pilar. Sono continua sendo sono; refeição continua sendo
refeição. O que "mapeia para os pilares antigos" é o **valor** de `INSIGHT_PILARES`
(`lib.ts:359-363`), não a **chave**. Muda uma linha de código:

```ts
export const INSIGHT_PILARES: Record<string, string[]> = {
  sono_gasto_seguinte:   ["vitalidade", "prosperidade"],   // inalterado
  refeicao_gasto_comida: ["vitalidade", "prosperidade"],   // ← única mudança
  treino_sono:           ["vitalidade"],                   // inalterado
};
```

Uma linha. **Zero objetos de banco.**

### Por que renomear seria caro e não compraria nada

1. A string `kind` é **chave de junção** entre `insights`, `insight_feedback` e um CHECK
   declarado em **duas** migrations (`20260904120000:223` e `20260906120000:84`). Renomear é
   migration que reescreve duas tabelas + novo CHECK + `INSIGHT_COPY` + `TrendInsights.tsx` +
   o teste-espelho de `lib.test.ts:753`.
2. `insight_feedback` é, nas palavras do seu próprio código (`lib.ts:307`), *"a coisa mais rara
   do banco: verdade sobre a vida dela validada POR ELA, com um toque"*. E o casamento é duplo
   — `kind` **e** `asked_status` (`lib.ts:318-324`). Um rename malfeito não dá erro: ele faz a
   confirmação **parar de casar em silêncio**, e o "não" dela (que o código trata com o mesmo
   peso do "sim") simplesmente some do retrato. Falha silenciosa sobre o dado mais raro que
   vocês têm.
3. Benefício visível à pessoa: nenhum. Ela nunca vê a string; ela vê `INSIGHT_COPY.titulo`
   ("Sono × gasto do dia seguinte"), que é outro campo e pode mudar livremente sem tocar em nada.

**Regra geral que eu deixaria escrita:** `kind` é **identidade**, não rótulo. Rótulo mora em
`INSIGHT_COPY`/`COPY`. Identidade não se renomeia por estética de refatoração.

### A consequência real (que não é rename) — e ela é boa

A fusão simplifica o caso mais difícil da lógica de privacidade. Hoje, desligar só
`alimentacao` esconde `refeicao_gasto_comida`, liga `universoPodado` (`lib.ts:478`) e força o
bloco a **nunca afirmar ausência** — a correção de 13/09/2026. Depois da fusão:

| Escopo desligado | `tiposVisiveis` | Estado |
|---|---|---|
| nenhum | 3 de 3 | completo, pode afirmar ausência |
| `vitalidade` (fundido) | 0 de 3 | bloco devolve `[]` inteiro — caminho já testado (`lib.test.ts:958`) |
| `prosperidade` | 1 de 3 (`treino_sono`) | podado — único caso que resta |

De dois caminhos podados para um. O `treino_sono`, que já era de pilar único, vira o único
sobrevivente de escopo parcial. **Menos estado, mesma garantia.** E como
`TrendInsights.tsx:112` pinta `refeicao_gasto_comida` com `["--alimentacao","--prosperidade"]`,
o teste-espelho de `lib.test.ts:753` vai **pegar** a divergência se alguém mudar só um lado —
que é exatamente o trabalho para o qual ele foi escrito. Deixe-o falhar; é o sinal certo.

---

## 6) CUSTO EM TOKEN — a fusão é neutra. Não sobra orçamento.

### O retrato: **praticamente IGUAL**

O tamanho de `buildSnapshot` é função dos **DADOS** (quantas refeições, quantos treinos,
quantas memórias, quantos planos), não do número de pilares. Para quem tem todos os escopos
ligados — o caso da esmagadora maioria, já que o default da coluna liga tudo — **os mesmos
blocos renderizam as mesmas linhas**. A conta:

| Linha | Antes | Depois | Δ |
|---|---|---|---|
| `Pilares ativos: ...` | até 4 ids | até 3 ids | **−3 a −5 tokens** |
| `PRIVACIDADE: ... áreas: ...` | até 2 ids nesta fusão | 1 id | **−2 a −4 tokens** |
| Todos os blocos de dado | idênticos | idênticos | **0** |

**Saldo: ~−8 tokens em ~3.000 a 8.000 do retrato. Ruído.** Perfis com exatamente um dos dois
negados encolhem mais (perdem o outro bloco), mas isso é **correção de privacidade, não
economia** — e não se contabiliza como ganho.

### O tool: a única mudança real, e ela também é ruído

Campo `pillar` medido: **322 caracteres de fonte ≈ 75 tokens** no prefixo de tools, mais ~4
tokens de saída por evento proposto.

- Prefixo é **cacheado**. Em cache hit, no Haiku: `75 × US$ 0,10/MTok = US$ 0,0000075` por
  chamada. Cem mil chamadas → **US$ 0,75**.
- Saída: 4 tokens × US$ 5/MTok = US$ 0,00002 por evento.

**Economia contínua: indistinguível de zero.** Não a venda como economia. A justificativa da
remoção é **confiabilidade**, não custo — e é importante dizer isso em voz alta, porque
"otimização de token" é o argumento errado para uma mudança certa.

### O custo que EXISTE, e que muda o plano de deploy

**Invalidação de cache.** `tools` vem antes de `system` no prefixo (`lib.ts:1637`). Qualquer
edição em `CAPTURE_TOOL` ou no `SYSTEM` do `ai-chat` faz a primeira mensagem de **cada usuário
ativo** pagar **escrita** (1,25x / 2,5x) onde pagaria **leitura** (0,1x / 0,2x):

| Rota | Prefixo medido | Δ (escrita − leitura) | Por usuário, uma vez |
|---|---|---|---|
| extração (Haiku) | ~6.000 tok (`lib.ts:1786` estima bloco 1 em 4.015 + tools) | US$ 1,15/MTok | **US$ 0,0069** |
| chat-principal (Sonnet) | 17.358 chars ≈ **5.260 tok** (medido) | US$ 2,30/MTok | **US$ 0,0121** |

**≈ US$ 0,019 por usuário ativo, uma única vez (≈ R$ 0,10).** Para 1.000 ativos: **~R$ 105, uma
vez.** Não é ruído — é ~3,5 assinaturas.

**Daí a recomendação de arquitetura de deploy, que é o único "custo" acionável deste parecer:**

> **Toda edição de prompt e de tool desta fusão vai num ÚNICO deploy (a R2).** Três deploys
> que tocam o prefixo custam três vezes isso. É o motivo real de a R1 ser desenhada para não
> tocar em `CAPTURE_TOOL` nem em nenhum `SYSTEM`.

### "Se sobrar orçamento, onde eu gastaria?"

**Não sobra.** Não vou propor gasto financiado por uma economia que não existe — seria
exatamente o tipo de proposta que a regra da casa manda recusar. Mas a pergunta merece
resposta, então aqui está a fila, com número:

**1º — Uma REDUÇÃO antes de qualquer gasto: o roteador de extração.** `lib.ts:1866`:

```ts
const hasQuestion = t.includes("?");
...
model: hasQuestion ? MODEL_SMART : MODEL_FAST,
```

Uma checagem de substring decide entre Haiku (US$ 1/US$ 5) e Sonnet (US$ 2/US$ 10) — **2x** em
entrada e saída. E mensagem de chat com "?" é o caso **comum**, não a exceção. Isto é,
provavelmente, a decisão de roteamento mais cara do repositório, tomada por um `includes`.
Não proponho mexer: proponho **medir**, e a telemetria para isso já existe:

```sql
select model, count(*), sum(estimated_cost_usd)
from public.ai_usage
where feature in ('chat-extracao','capture')
  and created_at > now() - interval '30 days'
group by model;
```

Se a fatia Sonnet for grande, um eval de Haiku no padrão "pergunta + relato na mesma frase"
(que é o caso que motivou a regra, documentado em `lib.ts:1861-1865`) paga o próprio trabalho.
Barato de medir, potencialmente grande.

**2º — Onde eu GASTARIA, se fosse gastar: o Blueprint.** É o gasto que o **próprio código já
defendeu**, em dois lugares independentes (`lib.ts:55-58` e `usage.ts:106-120`): raciocínio
adaptativo com `max_tokens` maior, *"começando pelo Blueprint, que roda uma vez na vida e é o
mais caro de errar"*. Por que ele, e não outra rota:

- **Custo limitado por construção:** uma chamada por usuário, na vida. ~3.000 tokens de saída
  extra × US$ 10/MTok = **US$ 0,03 ≈ R$ 0,16 por pessoa, uma vez.** Contra R$ 29,90/mês, é 0,5%
  de um mês. Para um usuário grátis, são R$ 0,16 gastos **no minuto exato que decide se ele um
  dia paga** — a aplicação literal da Emenda 4 de POSICIONAMENTO.md ("cada resposta muda algo
  que a pessoa VÊ na hora").
- **É a rota que a fusão mais mexe:** o Blueprint gera "um plano por área"
  (`onboarding-blueprint:41-47`), e alimentar + treino passam a viver sob o mesmo pilar. A
  coerência entre esses dois planos deixa de ser opcional e vira o produto.
- **A métrica já está no banco, e ela não é tempo de tela.** A migration
  `20260913120000_blueprint_gerado_nao_e_blueprint_ativado.sql` já separa **gerado** de
  **ativado**, e `profiles.blueprint_generated_at` já entra no retrato (`lib.ts:~690`). A
  medida é `planos ativados / blueprints gerados`, antes e depois, em coorte semanal. Se não
  mexer, desliga.
- **Pré-requisito inegociável**, e está escrito em `usage.ts:106-120`: token de raciocínio conta
  **dentro** do `max_tokens`. Ligar sem levantar o teto produz Blueprint **truncado no meio** —
  no minuto 1 de uso, no momento mais caro de errar. Teto primeiro, eval depois, deploy por
  último.

**O que eu NÃO proponho:** pilar novo, análise cruzada nova, mais uma chamada por conversa. A
fusão é subtração; financiar adição com ela seria dopamina de roadmap (PRINCIPIOS.md,
micro-incoerência 4).

---

## APÊNDICE — checklist de revisão, na ordem de deploy

**R1 (expand — nenhum byte de prompt ou de tool muda; cache intacta)**
- [ ] `canonicalPillar` + testes em `_shared/lib.ts` (sem chamar na escrita ainda)
- [ ] `lib.ts:653` — leitura **derivada** de escopos (`vitalidade !== false && alimentacao !== false`)
- [ ] `lib.ts:359-363` — `refeicao_gasto_comida` → `["vitalidade","prosperidade"]`
- [ ] `Ajustes.tsx:180` — **espelho** `alimentacao = vitalidade` ao gravar; rótulo do escopo atualizado
- [ ] Leitores tolerantes: `useMokariData:54`, `mokari.ts:306`, páginas de pilar, `ai-chat:565/:702`, `onboarding:23`
- [ ] Migration de `ai_scopes` (AND) + rodar antes a query de contagem `so_ali`

**R2 (migrate — UM único deploy para tudo que toca o prefixo)**
- [ ] `CAPTURE_TOOL` — campo `pillar` fora de `properties` e de `required`
- [ ] `canonicalPillar` aplicada em: retorno de `extractEventsAndMemories`, `capture/index.ts:309`, WhatsApp, e **`captureEvents.ts:447` (`lifeEventRow`)**
- [ ] Prompts da lista **A** (telas) e **B** (tools) — e **só** eles
- [ ] `SAFETY_RULES:1196` — "pilar Alimentação" (troca cirúrgica)
- [ ] Bônus **E**: rótulos humanos em `PRIVACIDADE:` e `Pilares ativos:`
- [ ] Backfill `life_events` / `habits` / `plans`
- [ ] ⚠ **Só se o id virar `saude`:** `setup.sql:223`, `:252`, `:477` + triggers

**R3 (contract — uma release depois)**
- [ ] `ai_scopes - 'alimentacao'` + novo `default` da coluna
- [ ] Sai a derivação (`lib.ts`) e sai o espelho (`Ajustes.tsx`) — **juntos**
- [ ] Leitores param de aceitar `alimentacao`
- [ ] `canonicalPillar` **fica**

**Teste que eu escreveria antes de tudo:** um perfil com
`ai_scopes = {"vitalidade": true, "alimentacao": false}` — sem a chave nova — passando por
`buildSnapshot` da função NOVA, e o retrato **não pode** conter peso, calorias, proteína,
hidratação nem `refeicao_gasto_comida`. É o teste que prova que a migration é opcional.
Se ele passar, a ordem de deploy deixou de ser um risco.
