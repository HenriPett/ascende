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
- **Nova alteração:** crie a migração aqui. Se ela também precisar valer para
  quem levanta do zero, reflita a mudança no `setup.sql` no mesmo commit — os
  dois devem contar a mesma história.

## Convenções

- Um arquivo por mudança coesa, com nome que diz o efeito no produto.
- Sempre idempotente (`if not exists`, `create or replace`), porque o mesmo
  arquivo pode ser reaplicado em ambientes diferentes.
- Comentar o **porquê** no topo, não só o quê.
- RLS obrigatória em tabela nova, junto na mesma migração.
