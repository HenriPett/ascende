-- ═══════════════════════════════════════════════════════════════════════
-- A AUTORIA DA MEMÓRIA NÃO MUDA — AGORA DE VERDADE
--
-- Achado da auditoria estática. A migração 20260903120000_memoria_controlavel
-- declara, em comentário:
--
--     "editar uma memória da IA não muda a autoria (created_by)"
--
-- e a medida 3 das decisões (docs/medidas-e-limiares.md) conta em cima disso:
-- "julgadas = memórias com created_by = 'ia' que a pessoa confirmou ou
-- rejeitou". Só que a policy de UPDATE permite qualquer coluna:
--
--     for update using (auth.uid() = user_id) with check (auth.uid() = user_id)
--
-- Ou seja, um cliente que mandasse `created_by: 'usuario'` junto de uma edição
-- reescreveria a autoria, e a taxa de correção passaria a olhar um conjunto
-- que encolhe sozinho — a medida ficaria melhor quanto mais a memória fosse
-- editada, que é o oposto do que ela quer dizer.
--
-- RLS não resolve: `with check` enxerga a linha NOVA, nunca a antiga, então
-- não dá para comparar com o valor anterior. Quem sabe o valor antigo é o
-- gatilho, e é ele que congela a coluna.
--
-- POR QUE RESTAURAR EM SILÊNCIO, E NÃO DAR ERRO
-- Autoria não é campo que a pessoa edita: é registro de quem escreveu. Um
-- update que a inclua por descuido (um PATCH com o objeto inteiro) deve
-- gravar o resto e ignorar essa coluna — recusar a operação faria a correção
-- de texto, que é o coração da Fase 2, falhar por causa de um campo que
-- ninguém quis mudar.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.ai_memories_freeze_created_by()
returns trigger language plpgsql as $$
begin
  -- Só o INSERT define autoria. Daí em diante ela é história.
  if new.created_by is distinct from old.created_by then
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

comment on function public.ai_memories_freeze_created_by() is
  'Congela ai_memories.created_by depois do insert: editar o texto de uma memória da IA não transfere a autoria (a medida 3 das decisões conta em cima disso).';

drop trigger if exists ai_memories_created_by_imutavel on public.ai_memories;
create trigger ai_memories_created_by_imutavel
  before update on public.ai_memories
  for each row execute function public.ai_memories_freeze_created_by();
