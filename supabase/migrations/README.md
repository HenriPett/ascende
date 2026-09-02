# Migrações do banco

A partir de 02/09/2026, **toda** alteração de schema entra aqui como um arquivo
`<timestamp>_<nome>.sql`, e é aplicada com `supabase db push`. Nada de alterar o
banco remoto na mão: sem histórico versionado ninguém sabe qual mudança está em
qual ambiente (achado P0 do plano refinado, §2.3).

## E o `supabase/setup.sql`?

Continua sendo a **linha de base**: é ele que levanta um ambiente do zero
(passo 2 do README da raiz). Ele é idempotente e permanece válido.

O que muda é o fluxo daqui para frente:

- **Ambiente novo:** rode `setup.sql` uma vez e depois as migrações.
- **Ambiente existente:** só as migrações.
- **Nova alteração:** crie a migração aqui. Ela é a fonte da verdade.

### O que o `setup.sql` espelha, e o que não espelha

Achado de auditoria (02/09/2026): o `setup.sql` espelha as Fases 1, 2 e 5, mas
**não** espelha a 3 nem a 6. Quem abre o arquivo e não encontra `daily_metrics`
não tem como saber se aquilo é esquecimento ou intenção — e uma linha de base
meio-espelhada é pior que qualquer uma das duas escolhas inteiras.

A regra, daqui em diante:

- **Objeto NOVO criado por migração** (tabela, view, função que só existe a
  partir da fase) fica **só na migração**. Não copie para o `setup.sql`.
  Ambiente novo roda `setup.sql` **e depois todas as migrações, em ordem** —
  o objeto nasce ali, e a definição continua tendo um dono só.
- **Alteração em objeto que o `setup.sql` já define** (uma coluna nova em
  `profiles`, uma função que já vive lá) vai nos **dois**, no mesmo commit.
  Aqui a duplicação já existe, e deixar as duas versões divergirem é que
  seria o problema.

Por que não espelhar tudo: `daily_metrics` tem ~90 linhas de SQL comentado.
Duas cópias viram duas verdades, e quem ler primeiro a antiga vai achar que
entendeu. Como as migrações rodam **depois**, um `create or replace` na
migração sempre venceria a cópia do `setup.sql` — ou seja, a cópia não
protegeria nada e só confundiria a leitura.

Objetos que vivem **só** nas migrações hoje: `jsonb_num`, `daily_metrics`,
`insights` (Fase 3); `insight_feedback` e as sete views `metric_*` (Fase 6).

## Convenções

- Um arquivo por mudança coesa, com nome que diz o efeito no produto.
- Sempre idempotente (`if not exists`, `create or replace`), porque o mesmo
  arquivo pode ser reaplicado em ambientes diferentes.
- Comentar o **porquê** no topo, não só o quê.
- RLS obrigatória em tabela nova, junto na mesma migração.
