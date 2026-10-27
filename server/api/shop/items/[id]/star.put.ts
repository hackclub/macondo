import { eq, sql } from "drizzle-orm";
import db from "../../../../db";
import { shopItemStarTable, shopItemTable } from "../../../../db/schema";
import { getSession } from "../../../../lib/session";

const MAX_STARS_PER_USER = 200;

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const itemId = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid item id" });
  }

  const [item] = await db
    .select({ id: shopItemTable.id })
    .from(shopItemTable)
    .where(eq(shopItemTable.id, itemId))
    .limit(1);
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: "Item not found" });
  }

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(shopItemStarTable)
    .where(eq(shopItemStarTable.user_id, user.id));
  if ((countRow?.count ?? 0) >= MAX_STARS_PER_USER) {
    throw createError({
      statusCode: 429,
      statusMessage: `You can star up to ${MAX_STARS_PER_USER} items.`,
    });
  }

  await db
    .insert(shopItemStarTable)
    .values({ user_id: user.id, item_id: itemId })
    .onConflictDoNothing();

  return { ok: true, starred: true };
});
