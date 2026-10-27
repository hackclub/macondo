-- India as its own shop region ("IN").
--
-- India used to be bucketed under Asia ("AS"). It now has its own region
-- code so pricing can diverge. For every shop_item that has an "AS" price
-- override, copy it verbatim into a new "IN" key so Indian shoppers don't
-- suddenly fall back to the base USD price. Items without an "AS" override
-- keep their base price in India too.
--
-- Safe to run repeatedly: the NOT regional_pricing ? 'IN' guard means we
-- never overwrite an IN override once it's been set.

UPDATE "shop_items"
SET "regional_pricing" = "regional_pricing" || jsonb_build_object('IN', "regional_pricing"->'AS')
WHERE "regional_pricing" IS NOT NULL
  AND "regional_pricing" ? 'AS'
  AND NOT ("regional_pricing" ? 'IN');
