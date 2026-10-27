import { eq } from "drizzle-orm";

import db from "../../../../../db";
import { shopOrderTable } from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import {
  buildShopItemSnapshot,
  createTheseusLetterForOrder,
  formatShopOrderForResponse,
  getOrderItemSnapshot,
  getShopOrderContext,
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

  if (!snapshot || snapshot.kind !== "physical" || snapshot.fulfillment_provider !== "theseus") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only Theseus orders can be retried here",
    });
  }

  try {
    const { letterId } = await createTheseusLetterForOrder(id);
    const [updatedOrder] = await db
      .update(shopOrderTable)
      .set({
        status: "theseus_submitted",
        tracking_number: letterId,
        external_reference: letterId,
        fulfillment_error: null,
        updated_at: new Date(),
      })
      .where(eq(shopOrderTable.id, id))
      .returning();

    if (!updatedOrder) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to update order after Theseus submission",
      });
    }

    try {
      await writeAudit({
        actor_id: actor.id,
        action: "retry_theseus_order",
        entity_type: "shop_order",
        entity_id: String(id),
        old_value: orderContext.order,
        new_value: updatedOrder,
        sensitive: true,
        public_message: "Theseus order submitted",
        change_summary: snapshot.name,
      });
    } catch (error) {
      console.error("Failed to write audit log for Theseus retry", error);
    }

    return formatShopOrderForResponse({
      order: updatedOrder,
      item: orderContext.item,
      orderUser: orderContext.orderUser,
    }, {
      includeShippingAddress: true,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error, "Theseus submission failed");
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
