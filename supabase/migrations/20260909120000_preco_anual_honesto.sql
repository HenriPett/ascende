-- ASCENDE — Corrige o rótulo do plano anual, que anunciava desconto errado.
--
-- O rótulo dizia "R$ 239,90/ano (2 meses grátis)". Com a mensalidade em
-- R$ 29,90, doze meses custam R$ 358,80 — o anual economiza R$ 118,90, quase
-- QUATRO mensalidades, não duas. O texto sobrou de quando a mensalidade era
-- R$ 19,90 (ali o "anual" era mais caro que pagar mês a mês, o que torna a
-- frase antiga ainda pior).
--
-- Por que a economia em reais em vez de "4 meses grátis": R$ 118,90 não são
-- exatamente 4 × R$ 29,90 (são R$ 119,60). Dizer "4 meses" erra por R$ 0,70 a
-- favor da casa, e preço é justamente onde não se arredonda para o próprio
-- lado. O número exato não pode ficar errado.
--
-- Vale só para quem já tem banco criado: o setup.sql já nasce com o texto
-- certo, e o `on conflict do nothing` do seed nunca corrigiria uma linha
-- existente. Rodar de novo não faz nada — a condição só casa com o texto
-- antigo.

update public.app_settings
   set value = jsonb_set(
         value,
         '{annual_label}',
         '"R$ 239,90/ano — economia de R$ 118,90"'::jsonb
       ),
       updated_at = now()
 where key = 'pricing'
   and (value->>'annual_label') like '%meses grátis%';
