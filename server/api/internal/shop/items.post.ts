import db from "../../../db";
import { shopItemTable } from "../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import {
  dismissMatchingSuggestions,
  normalizeShopItemBody,
} from "../../../lib/shop-admin";
import {
  formatShopItemForResponse,
  getShopItemAuditMetadata,
} from "../../../lib/shop";
import { queueShopItemChange } from "../../../lib/shop-slack-log";
import { canAccessInternalShopAdmin } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = (await readBody<{
    name?: string;
    description?: string | null;
    nameTranslations?: Record<string, string | null> | null;
    descriptionTranslations?: Record<string, string | null> | null;
    imageUrl?: string | null;
    kind?: "physical" | "grant" | "consumable" | "experience" | "virtual_service";
    fulfillmentProvider?: "internal" | "theseus" | "hcb";
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
      public_message: auditMetadata.publicMessage,
      change_summary: auditMetadata.changeSummary,
    });
  } catch (error) {
    console.error("Failed to write audit log for shop item creation", error);
  }

  void queueShopItemChange({
    action: auditMetadata.action,
    oldItem: null,
    newItem: createdItem,
  });

  await dismissMatchingSuggestions(createdItem.name, actor.id);

  return formatShopItemForResponse(createdItem);
});
