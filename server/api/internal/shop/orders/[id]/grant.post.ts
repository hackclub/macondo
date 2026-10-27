import { eq } from "drizzle-orm";

import db from "../../../../../db";
import { shopOrderTable } from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import { hcbCardGrantWebUrl } from "../../../../../lib/hcb";
import { notify } from "../../../../../lib/notify";
import {
  buildShopItemSnapshot,
  createHcbGrantForOrder,
  formatShopOrderForResponse,
  getOrderItemSnapshot,
  getShopOrderContext,
  isClaimConflict,
} from "../../../../../lib/shop";
import { canAccessInternalShopAdmin } from "../../../../../policies/internal";

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

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid order ID" });
  }

  const orderContext = await getShopOrderContext(id);
  if (!orderContext) {
    throw createError({ statusCode: 404, statusMessage: "Order not found" });
  }

  const snapshot = orderContext.item
    ? getOrderItemSnapshot(orderContext.order) ?? buildShopItemSnapshot(orderContext.item)
    : getOrderItemSnapshot(orderContext.order);

  if (!snapshot || snapshot.kind !== "grant" || snapshot.fulfillment_provider !== "hcb") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only HCB grant orders can create a card grant",
    });
  }

  if (orderContext.order.external_reference) {
    throw createError({
      statusCode: 409,
      statusMessage: "This order already has an HCB grant reference. Return it before creating another grant.",
    });
  }

  // createHcbGrantForOrder atomically claims the order, so concurrent requests can't both mint a grant.
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
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to update order after HCB grant creation",
      });
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

    return formatShopOrderForResponse({
      order: updatedOrder,
      item: orderContext.item,
      orderUser: orderContext.orderUser,
    }, {
      includeShippingAddress: true,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error, "HCB grant creation failed");

    // Another request owns the claim; writing external_failure would clobber its row.
    if (isClaimConflict(error)) {
      throw createError({ statusCode: 409, statusMessage: errorMessage });
    }

    const [updatedOrder] = await db
      .update(shopOrderTable)
      .set({
        status: "external_failure",
        fulfillment_error: errorMessage,
        updated_at: new Date(),
      })
      .where(eq(shopOrderTable.id, id))
      .returning();

    throw createError({
      statusCode: 502,
      statusMessage: updatedOrder?.fulfillment_error ?? errorMessage,
    });
  }
});
