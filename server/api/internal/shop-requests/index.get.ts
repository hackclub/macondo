import { desc, eq } from "drizzle-orm";

import db from "../../../db";
import { shopItemRequestTable, users } from "../../../db/schema";
import { ensureHistoricalShopRequestKeywordMaintenance } from "../../../lib/shop-request-tag";
import { canAccessInternalShopAdmin } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor || !canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  void ensureHistoricalShopRequestKeywordMaintenance({ dismissExistingItems: true });

  const rows = await db
    .select({
      id: shopItemRequestTable.id,
      name: shopItemRequestTable.name,
      description: shopItemRequestTable.description,
      store_url: shopItemRequestTable.store_url,
      image_url: shopItemRequestTable.image_url,
      cluster_id: shopItemRequestTable.cluster_id,
      group_tag: shopItemRequestTable.group_tag,
      upvote_count: shopItemRequestTable.upvote_count,
      pricing_info: shopItemRequestTable.pricing_info,
      promoted_to_item_id: shopItemRequestTable.promoted_to_item_id,
      dismissed_at: shopItemRequestTable.dismissed_at,
      dismissed_reason: shopItemRequestTable.dismissed_reason,
      created_at: shopItemRequestTable.created_at,
      user: {
        id: users.id,
        name: users.name,
        image: users.image,
        slack_id: users.slack_id,
      },
    })
    .from(shopItemRequestTable)
    .leftJoin(users, eq(shopItemRequestTable.user_id, users.id))
    .orderBy(desc(shopItemRequestTable.upvote_count), desc(shopItemRequestTable.created_at));

  return {
    items: rows.filter((r) => r.promoted_to_item_id == null && r.dismissed_at == null),
    dismissedItems: rows.filter((r) => r.promoted_to_item_id == null && r.dismissed_at != null),
  };
});
