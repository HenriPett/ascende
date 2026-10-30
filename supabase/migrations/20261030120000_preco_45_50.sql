-- ASCENDE — Nova mensalidade do Ascende+: R$ 45,50 (decisão de Henrique, 30/10/2026).
--
-- O anual mantém o desconto que já tinha (cerca de 8 mensalidades pelo ano):
-- 12 × R$ 45,50 = R$ 546,00; 8 × R$ 45,50 = R$ 364,00; a economia declarada é
-- R$ 546,00 − R$ 364,00 = R$ 182,00 — exatamente 4 mensalidades, sem
-- arredondamento a favor da casa.
--
-- Este rótulo precisa bater EXATAMENTE com os preços do Stripe
-- (STRIPE_PRICE_MONTHLY_ID / STRIPE_PRICE_ANNUAL_ID): só aplique depois de os
-- novos preços existirem lá e os secrets apontarem para eles.
--
-- Idempotente: só troca o rótulo que ainda está no preço anterior.

update public.app_settings
   set value = jsonb_set(
         jsonb_set(value, '{monthly_label}', '"R$ 45,50/mês"'::jsonb),
         '{annual_label}',
         '"R$ 364,00/ano — economia de R$ 182,00"'::jsonb
       ),
       updated_at = now()
 where key = 'pricing'
   and (value->>'monthly_label') like '%29,90%';
