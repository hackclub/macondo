import { and, eq, isNull } from "drizzle-orm";
import db from "~~/server/db";
import { shopOrderTable } from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  return {
    count: (
      await db
        .select({ id: shopOrderTable.id })
        .from(shopOrderTable)
        .where(
          and(
            eq(shopOrderTable.user_id, user.id),
            eq(shopOrderTable.status, "pending_internal_fulfillment"),
            isNull(shopOrderTable.shipping_address),
          ),
        )
    ).length,
    needs_hca_link: !user.sub,
  };
});
