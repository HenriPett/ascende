-- ═══════════════════════════════════════════════════════════════════════
-- O HISTÓRICO FICAVA INVISÍVEL NUM PILAR QUE NINGUÉM CONTA MAIS
--
-- Continuação de 20260917120000: com `alimentacao` absorvido por `vitalidade`,
-- toda linha antiga que diz `pillar = 'alimentacao'` some das superfícies que
-- AGREGAM por pilar — o Score (tendência por pilar), a afinidade do Mokari e o
-- retrato do Conselheiro. O dado continua lá; o que some é a pessoa vendo o
-- que ela construiu.
--
-- ─── POR QUE ISTO É SEGURO, E POR QUE PODE RODAR A QUALQUER MOMENTO ───
--
-- O remapeamento é LOSSLESS: `pillar` sempre foi derivável de `kind`, e o
-- `kind` não é tocado aqui. "Isto era alimentação ou vitalidade" continua
-- recuperável a qualquer momento (meal/water/weight de um lado,
-- sleep/nap/workout do outro) — é exatamente o que `canonicalPillar`
-- (_shared/lib.ts) faz, e é o que o Mokari passou a usar para desenhar raiz e
-- folha separadas com um pilar só por trás.
--
-- E pode rodar a qualquer momento DEPOIS da release de expansão porque os
-- leitores já aceitam os dois valores desde ela. Rodar antes não quebra nada;
-- rodar depois também não. O que não pode é ninguém rodar — daí este arquivo.
--
-- ─── O QUE ESTA MIGRATION NÃO RESOLVE ───
--
-- `habits.pillar` continua com `default 'vitalidade'` (setup.sql) e os
-- gatilhos de `habit_log_to_life_event()` continuam com
-- `coalesce(h.pillar, 'vitalidade')`. Sob o id `vitalidade`, isso está CERTO:
-- o default já é o pilar que sobreviveu. Nada a mudar ali — e é o principal
-- dividendo de a fusão ter sido absorção, e não renomeação.
--
-- Idempotente por construção: depois de rodar, o `where` não encontra nada.
-- ═══════════════════════════════════════════════════════════════════════

update public.life_events set pillar = 'vitalidade' where pillar = 'alimentacao';
update public.habits       set pillar = 'vitalidade' where pillar = 'alimentacao';
update public.plans        set pillar = 'vitalidade' where pillar = 'alimentacao';
