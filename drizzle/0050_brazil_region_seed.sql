-- Brazil ("BR") is being split out of South America ("SA") into its
-- own region bucket so admins can tune Brazilian shipping/customs
-- pricing without affecting the rest of the continent. To avoid an
-- effective price/availability change for existing Brazilian buyers
-- the moment this code ships, seed every shop item that already has
-- an SA entry in regional_pricing with a BR entry copied from SA.
--
-- Items that don't have an SA entry, or already have a BR entry, are
-- left alone so admins who pre-customized BR (unlikely, but possible
-- if anyone hand-edited the JSON) keep their values.

UPDATE shop_items
SET regional_pricing = regional_pricing || jsonb_build_object('BR', regional_pricing -> 'SA')
WHERE regional_pricing IS NOT NULL
  AND regional_pricing ? 'SA'
  AND NOT (regional_pricing ? 'BR');
