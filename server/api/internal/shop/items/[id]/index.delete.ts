import { eq, sql } from "drizzle-orm";

import db from "../../../../../db";
import {
  shopItemRequestTable,
  shopItemTable,
  shopOrderTable,
} from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import { queueShopItemChange } from "../../../../../lib/shop-slack-log";
import { invalidateShopItemTranslations } from "../../../../../lib/translate-shop";
import { canAccessInternalShopAdmin } from "../../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid item ID" });
  }

  const [existingItem] = await db
    .select()
    .from(shopItemTable)
    .where(eq(shopItemTable.id, id))
    .limit(1);

  if (!existingItem) {
    throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
  }

  // Counted first for a friendlier error; the FK constraint (caught below) is the real safety net.
  const [orderRefs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shopOrderTable)
    .where(eq(shopOrderTable.item_id, id));

  const [requestRefs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shopItemRequestTable)
    .where(eq(shopItemRequestTable.promoted_to_item_id, id));

  const orderCount = orderRefs?.count ?? 0;
  const requestCount = requestRefs?.count ?? 0;

  if (orderCount > 0 || requestCount > 0) {
    const parts: string[] = [];
    if (orderCount > 0) parts.push(`${orderCount} order(s)`);
    if (requestCount > 0) parts.push(`${requestCount} promoted request(s)`);
    throw createError({
      statusCode: 409,
      statusMessage: `Cannot delete: ${parts.join(" and ")} reference this item. Toggle "Public Availability" off to archive instead.`,
    });
  }

  let deleted: typeof shopItemTable.$inferSelect | undefined;
  try {
    [deleted] = await db
      .delete(shopItemTable)
      .where(eq(shopItemTable.id, id))
      .returning();
  } catch (error) {
    if ((error as { code?: string }).code === "23503") {
      throw createError({
        statusCode: 409,
        statusMessage: 'Cannot delete: this item is referenced by other rows. Toggle "Public Availability" off to archive instead.',
      });
    }
    throw error;
  }

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "delete_shop_item",
      entity_type: "shop_item",
      entity_id: String(id),
      old_value: deleted,
      new_value: null,
      sensitive: true,
      public_message: "Shop item deleted",
      change_summary: deleted.name,
    });
  } catch (error) {
    console.error("Failed to write audit log for shop item delete", error);
  }

  void queueShopItemChange({
    action: "delete_shop_item",
    oldItem: deleted,
    newItem: null,
  });

  await invalidateShopItemTranslations(id);

  return { ok: true, deleted };
});
