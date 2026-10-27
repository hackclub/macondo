// lives under events because that role can't reach shop-admin items; synthetic items have
// no shop_orders row and theseus needs an address at submit

import { and, asc, notInArray, sql } from "drizzle-orm";

import db from "~~/server/db";
import { shopItemTable } from "~~/server/db/schema";
import { canAccessInternalEvents } from "~~/server/policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalEvents(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return await db
    .select({
      id: shopItemTable.id,
      name: shopItemTable.name,
      kind: shopItemTable.kind,
      fulfillment_provider: shopItemTable.fulfillment_provider,
      inventory_mode: shopItemTable.inventory_mode,
      stock_remaining: shopItemTable.stock_remaining,
    })
    .from(shopItemTable)
    .where(
      and(
        notInArray(shopItemTable.fulfillment_provider, [
          "internal_synthetic",
          "theseus",
        ]),
        sql`${shopItemTable.coming_soon} IS NOT TRUE`,
      ),
    )
    .orderBy(asc(shopItemTable.name));
});
