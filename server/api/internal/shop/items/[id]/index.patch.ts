import { eq } from "drizzle-orm";

import db from "../../../../../db";
import { shopItemTable } from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import { normalizeShopItemBody } from "../../../../../lib/shop-admin";
import {
  formatShopItemForResponse,
  getShopItemAuditMetadata,
} from "../../../../../lib/shop";
import { queueShopItemChange } from "../../../../../lib/shop-slack-log";
import { canAccessInternalShopAdmin } from "../../../../../policies/internal";
import { invalidateShopItemTranslations } from "../../../../../lib/translate-shop";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid item ID" });
  }

  const body = (await readBody<{
    name?: string;
    description?: string | null;
    nameTranslations?: Record<string, string | null> | null;
    descriptionTranslations?: Record<string, string | null> | null;
    imageUrl?: string | null;
    kind?: "physical" | "grant" | "consumable" | "experience" | "virtual_service";
    fulfillmentProvider?: "internal" | "theseus" | "hcb" | "internal_synthetic";
    source?: "hq" | "local" | null;
    priceGold?: number;
    salePriceGold?: number | null;
    grantAmountDollars?: number | null;
    attachmentUrls?: string[];
    inventoryMode?: "unlimited" | "limited";
    stockRemaining?: number | null;
    availableUntil?: string | null;
    available?: boolean;
    comingSoon?: boolean;
    requiresShippedProject?: boolean;
    pinned?: boolean;
    extraFruity?: boolean;
    priorityEligible?: boolean;
    regionalPricing?: Partial<
      Record<string, { priceGold?: number | null; available?: boolean }>
    > | null;
    modifiers?: Array<{
      id: string;
      label: string;
      labelTranslations?: Record<string, string> | null;
      type: "single" | "multi";
      required?: boolean;
      options: Array<{
        id: string;
        label: string;
        labelTranslations?: Record<string, string> | null;
        priceDeltaGold?: number;
      }>;
    }> | null;
  }>(event)) ?? {};

  const [existingItem] = await db
    .select()
    .from(shopItemTable)
    .where(eq(shopItemTable.id, id))
    .limit(1);

  if (!existingItem) {
    throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
  }

  const values = normalizeShopItemBody(body, existingItem);

  const [updatedItem] = await db
    .update(shopItemTable)
    .set({
      ...values,
      updated_at: new Date(),
    })
    .where(eq(shopItemTable.id, id))
    .returning();

  if (!updatedItem) {
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to update shop item",
    });
  }

  const auditMetadata = getShopItemAuditMetadata(existingItem, updatedItem);

  try {
    await writeAudit({
      actor_id: actor.id,
      action: auditMetadata.action,
      entity_type: "shop_item",
      entity_id: String(id),
      old_value: existingItem,
      new_value: updatedItem,
      sensitive: true,
      public_message: auditMetadata.publicMessage,
      change_summary: auditMetadata.changeSummary,
    });
  } catch (error) {
    console.error("Failed to write audit log for shop item update", error);
  }

  void queueShopItemChange({
    action: auditMetadata.action,
    oldItem: existingItem,
    newItem: updatedItem,
  });

  if (
    existingItem.name !== updatedItem.name ||
    existingItem.description !== updatedItem.description ||
    JSON.stringify(existingItem.name_translations) !==
      JSON.stringify(updatedItem.name_translations) ||
    JSON.stringify(existingItem.description_translations) !==
      JSON.stringify(updatedItem.description_translations)
  ) {
    await invalidateShopItemTranslations(id);
  }

  return formatShopItemForResponse(updatedItem);
});
