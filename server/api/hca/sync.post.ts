import { and, eq, isNull } from "drizzle-orm";
import db from "~~/server/db";
import { shopOrderTable } from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";
import { getShopCheckoutAddress } from "~~/server/lib/shop";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  if (!user.sub) {
    return {
      synced: false,
      reason: "not_linked" as const,
      updated_orders: 0,
    };
  }

  const checkout = getShopCheckoutAddress(event);
  if (!checkout || !checkout.shippingAddress) {
    return {
      synced: false,
      reason: "no_address_in_cookie" as const,
      needs_reauth: true,
      updated_orders: 0,
    };
  }

  return {
    synced: true,
    updated_orders: (
      await db
        .update(shopOrderTable)
        .set({
          shipping_address: checkout.shippingAddress,
          phone: checkout.phone ?? null,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(shopOrderTable.user_id, user.id),
            eq(shopOrderTable.status, "pending_internal_fulfillment"),
            isNull(shopOrderTable.shipping_address),
          ),
        )
        .returning({ id: shopOrderTable.id })
    ).length,
  };
});
