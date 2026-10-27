import { eq } from "drizzle-orm";

import db from "../../../../db";
import { shopOrderTable } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { hcbCardGrantWebUrl } from "../../../../lib/hcb";
import { notify } from "../../../../lib/notify";
import {
  buildShopItemSnapshot,
  createHcbGrantForOrder,
  getOrderItemSnapshot,
  getShopOrderContext,
  isClaimConflict,
} from "../../../../lib/shop";
import { canAccessInternalShopAdmin } from "../../../../policies/internal";

const MAX_BATCH = 100;

function getErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === "object" &&
    error &&
    "statusMessage" in error &&
    typeof error.statusMessage === "string"
  ) {
    return error.statusMessage;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

type GrantResult = { id: number; ok: boolean; error?: string };

// Mirrors [id]/grant.post.ts but returns instead of throwing, so one bad order
// doesn't abort the batch.
async function processGrant(
  id: number,
  actor: { id: string; username: string | null; slack_id: string | null },
): Promise<GrantResult> {
  const orderContext = await getShopOrderContext(id);
  if (!orderContext) {
    return { id, ok: false, error: "Order not found" };
  }

  const snapshot = orderContext.item
    ? getOrderItemSnapshot(orderContext.order) ??
      buildShopItemSnapshot(orderContext.item)
    : getOrderItemSnapshot(orderContext.order);

  if (
    !snapshot ||
    snapshot.kind !== "grant" ||
    snapshot.fulfillment_provider !== "hcb"
  ) {
    return {
      id,
      ok: false,
      error: "Only HCB grant orders can create a card grant",
    };
  }

  if (orderContext.order.external_reference) {
    return {
      id,
      ok: false,
      error: "Order already has an HCB grant reference",
    };
  }

  try {
    const { grantId } = await createHcbGrantForOrder(id);
    const [updatedOrder] = await db
      .update(shopOrderTable)
      .set({
        status: "grant_created",
        external_reference: grantId,
        fulfillment_error: null,
        updated_at: new Date(),
      })
      .where(eq(shopOrderTable.id, id))
      .returning();

    if (!updatedOrder) {
      return {
        id,
        ok: false,
        error: "Failed to update order after HCB grant creation",
      };
    }

    try {
      await writeAudit({
        actor_id: actor.id,
        action: "create_shop_grant",
        entity_type: "shop_order",
        entity_id: String(id),
        old_value: orderContext.order,
        new_value: updatedOrder,
        sensitive: true,
        public_message: "HCB grant created",
        change_summary: snapshot.name,
      });
    } catch (error) {
      console.error("Failed to write audit log for HCB grant creation", error);
    }

    const orderQuantity = Math.max(1, orderContext.order.quantity ?? 1);
    const amountUsd = snapshot.grant_amount_cents
      ? ((snapshot.grant_amount_cents * orderQuantity) / 100).toFixed(2)
      : "0.00";
    const hcbGrantUrl = hcbCardGrantWebUrl(grantId);
    void notify({
      user_id: orderContext.order.user_id,
      type: "shop_grant_sent",
      title: `$${amountUsd} shop grant sent: ${snapshot.name}`,
      body: `Your shop grant has been sent. Check your email for the HCB invite, or open the grant directly.`,
      action_url: hcbGrantUrl,
      entity_type: "shop_order",
      entity_id: String(id),
      slack: {
        text: `:shopping_bags: $${amountUsd} shop grant sent: *${snapshot.name}* by ${actor.username ?? "an admin"}${actor.slack_id ? ` (<@${actor.slack_id}>)` : ""}`,
      },
      email: {
        template: "shop_grant_sent",
        data: {
          item_name: snapshot.name,
          amount_usd: `$${amountUsd} USD`,
          hcb_grant_url: hcbGrantUrl,
        },
      },
    });

    return { id, ok: true };
  } catch (error) {
    const errorMessage = getErrorMessage(error, "HCB grant creation failed");

    // Another request already owns this order and no HCB call happened here,
    // so leave the row to the winner instead of marking it failed.
    if (isClaimConflict(error)) {
      return { id, ok: false, error: errorMessage };
    }

    await db
      .update(shopOrderTable)
      .set({
        status: "external_failure",
        fulfillment_error: errorMessage,
        updated_at: new Date(),
      })
      .where(eq(shopOrderTable.id, id))
      .returning();
    return { id, ok: false, error: errorMessage };
  }
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const rawIds: unknown = (
    await readBody<{ ids?: unknown }>(event).catch(
      () => ({}) as { ids?: unknown },
    )
  ).ids;
  const ids = Array.isArray(rawIds)
    ? [
        ...new Set(
          rawIds
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0),
        ),
      ]
    : [];

  if (ids.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Provide at least one valid order id",
    });
  }
  if (ids.length > MAX_BATCH) {
    throw createError({
      statusCode: 400,
      statusMessage: `Too many orders (max ${MAX_BATCH} per batch)`,
    });
  }

  // Sequential to respect HCB rate limits, mirroring grants/bulk-send.
  const results: GrantResult[] = [];
  for (const id of ids) {
    results.push(await processGrant(id, actor));
  }

  const succeeded = results.filter((result) => result.ok).length;
  return {
    requested: ids.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
});
