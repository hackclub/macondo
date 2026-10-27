import { and, eq } from "drizzle-orm";
import db from "../../../../db";
import { shopItemStarTable } from "../../../../db/schema";
import { getSession } from "../../../../lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const itemId = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid item id" });
  }

  await db
    .delete(shopItemStarTable)
    .where(
      and(
        eq(shopItemStarTable.user_id, user.id),
        eq(shopItemStarTable.item_id, itemId),
      ),
    );

  return { ok: true, starred: false };
});
