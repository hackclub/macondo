import { eq } from "drizzle-orm";

import db from "../../db";
import { shopItemTable } from "../../db/schema";
import {
  getShopCheckoutAddress,
  isItemAvailableInRegion,
  isItemOnSale,
  priceHoursToGold,
  resolveItemPriceHours,
  resolveRegularPriceHours,
} from "../../lib/shop";
import {
  resolveAvailabilityRegion,
  resolveBrowsingRegion,
  resolveOrderRegion,
} from "../../lib/shop-region";
import { getSession } from "../../lib/session";

// The catalog prices by browse region but orders.post.ts charges physical items by
// shipping country; this quotes the real charge. Read-only, so it can't lower a price.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const body =
    (await readBody<{ itemId?: number | string; addressId?: string }>(event)) ?? {};

  const itemId = Number(body.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid item ID" });
  }

  const [item] = await db
    .select()
    .from(shopItemTable)
    .where(eq(shopItemTable.id, itemId))
    .limit(1);
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
  }

  // Must match orders.post.ts so the quoted region is the charged region.
  const checkoutAddress = getShopCheckoutAddress(event);
  const selectedCheckoutAddress =
    body.addressId && checkoutAddress?.addresses.length
      ? checkoutAddress.addresses.find((entry) => entry.id === body.addressId)
      : checkoutAddress?.addresses.find((entry) => entry.primary) ??
        checkoutAddress?.addresses[0] ??
        null;

  const shippingCountry =
    selectedCheckoutAddress?.shippingAddress?.country ?? null;
  const browsingRegion = resolveBrowsingRegion(event, user);

  // Non-physical kinds price globally (orderRegion null) but grants are still region-gated.
  const orderRegion = resolveOrderRegion(item.kind, shippingCountry, browsingRegion);
  const availabilityRegion = resolveAvailabilityRegion(
    item.kind,
    shippingCountry,
    browsingRegion,
  );

  const priceGold = priceHoursToGold(resolveItemPriceHours(item, orderRegion));
  const regularPriceGold = priceHoursToGold(
    resolveRegularPriceHours(item, orderRegion),
  );
  const browsePriceGold = priceHoursToGold(
    resolveItemPriceHours(item, browsingRegion),
  );

  return {
    item_id: item.id,
    ship_country: shippingCountry,
    order_region: orderRegion,
    browse_region: browsingRegion,
    price_gold: priceGold,
    regular_price_gold: regularPriceGold,
    is_on_sale: isItemOnSale(item, orderRegion),
    available_in_region: isItemAvailableInRegion(item, availabilityRegion),
    browse_price_gold: browsePriceGold,
    region_price_differs: priceGold !== browsePriceGold,
  };
});
