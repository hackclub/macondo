import { desc, eq } from "drizzle-orm";
import db from "~~/server/db";
import { shopItemTable, shopOrderTable, users } from "~~/server/db/schema";
import { formatShopOrderForResponse } from "~~/server/lib/shop";
import { getSession } from "~~/server/lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  return (
    await db
      .select({
        order: shopOrderTable,
        item: shopItemTable,
        orderUser: {
          id: users.id,
          name: users.name,
          email: users.email,
          hcb_email: users.hcb_email,
        },
      })
      .from(shopOrderTable)
      .leftJoin(shopItemTable, eq(shopOrderTable.item_id, shopItemTable.id))
      .leftJoin(users, eq(shopOrderTable.user_id, users.id))
      .where(eq(shopOrderTable.user_id, user.id))
      .orderBy(desc(shopOrderTable.created_at))
  ).map((row) =>
    formatShopOrderForResponse(row, {
      includeShippingAddress: false,
      includeFulfillmentError: false,
    }),
  );
});
