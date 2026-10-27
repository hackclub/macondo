import { and, eq, isNull } from "drizzle-orm";

import db from "../../../../db";
import { shopItemRequestTable, shopItemTable } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import {
  dismissMatchingSuggestions,
  normalizeShopItemBody,
} from "../../../../lib/shop-admin";
import {
  formatShopItemForResponse,
  getShopItemAuditMetadata,
} from "../../../../lib/shop";
import { queueShopItemChange } from "../../../../lib/shop-slack-log";
import { canAccessInternalShopAdmin } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor || !canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid id" });
  }

  const [request] = await db
    .select()
    .from(shopItemRequestTable)
    .where(eq(shopItemRequestTable.id, id))
    .limit(1);

  if (!request) {
    throw createError({ statusCode: 404, statusMessage: "Request not found" });
  }
  if (request.promoted_to_item_id) {
    throw createError({
      statusCode: 409,
      statusMessage: "Request has already been promoted to a shop item",
    });
  }

  const body = (await readBody<{
    name?: string;
    description?: string | null;
    nameTranslations?: Record<string, string | null> | null;
    descriptionTranslations?: Record<string, string | null> | null;
    imageUrl?: string | null;
    kind?: "physical" | "grant" | "virtual_service";
    fulfillmentProvider?: "internal" | "theseus" | "hcb";
    priceGold?: number;
    grantAmountDollars?: number | null;
    attachmentUrls?: string[];
    inventoryMode?: "unlimited" | "limited";
    stockRemaining?: number | null;
    availableUntil?: string | null;
    available?: boolean;
    regionalPricing?: Partial<
      Record<string, { priceGold?: number | null; available?: boolean }>
    > | null;
  }>(event)) ?? {};

  const values = normalizeShopItemBody(body, null);
  const now = new Date();

  const [createdItem] = await db
    .insert(shopItemTable)
    .values({
      ...values,
      created_at: now,
      updated_at: now,
    })
    .returning();

  if (!createdItem) {
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to create shop item",
    });
  }

  if (request.cluster_id != null) {
    await db
      .update(shopItemRequestTable)
      .set({ promoted_to_item_id: createdItem.id })
      .where(
        and(
          eq(shopItemRequestTable.cluster_id, request.cluster_id),
          isNull(shopItemRequestTable.promoted_to_item_id),
          isNull(shopItemRequestTable.dismissed_at),
        ),
      );
  } else {
    await db
      .update(shopItemRequestTable)
      .set({ promoted_to_item_id: createdItem.id })
      .where(eq(shopItemRequestTable.id, id));
  }

  const auditMetadata = getShopItemAuditMetadata(null, createdItem);

  try {
    await writeAudit({
      actor_id: actor.id,
      action: auditMetadata.action,
      entity_type: "shop_item",
      entity_id: String(createdItem.id),
      old_value: null,
      new_value: createdItem,
      sensitive: true,
      public_message: `Promoted shop request #${request.id} ("${request.name}") into a shop item.`,
      change_summary: auditMetadata.changeSummary,
    });
  } catch (error) {
    console.error("Failed to write audit log for shop request promotion", error);
  }

  void queueShopItemChange({
    action: auditMetadata.action,
    oldItem: null,
    newItem: createdItem,
  });

  await dismissMatchingSuggestions(createdItem.name, actor.id);

  return {
    ok: true,
    item: formatShopItemForResponse(createdItem),
    request_id: request.id,
  };
});
