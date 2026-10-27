import { eq } from "drizzle-orm";

import db from "../../../../../db";
import { shopOrderTable } from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import {
  formatShopOrderForResponse,
  getOrderItemSnapshot,
  getShopOrderContext,
} from "../../../../../lib/shop";
import { canAccessInternalShopAdmin } from "../../../../../policies/internal";

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

  if (orderContext.order.status !== "shipped") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only shipped orders can be unshipped",
    });
  }

  // Tracking number is kept so re-shipping with the same code doesn't re-notify the buyer.
  const [updatedOrder] = await db
    .update(shopOrderTable)
    .set({
      status: "pending_internal_fulfillment",
      updated_at: new Date(),
    })
    .where(eq(shopOrderTable.id, id))
    .returning();

  if (!updatedOrder) {
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to update shop order",
    });
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "unship_shop_order",
      entity_type: "shop_order",
      entity_id: String(id),
      old_value: orderContext.order,
      new_value: updatedOrder,
      sensitive: true,
      public_message: "Shop order unshipped",
      change_summary: getOrderItemSnapshot(orderContext.order)?.name,
    });
  } catch (error) {
    console.error("Failed to write audit log for shop order unship", error);
  }

  // No buyer notification: whatever follows (re-ship, cancel + refund) sends its own.
  return formatShopOrderForResponse({
    order: updatedOrder,
    item: orderContext.item,
    orderUser: orderContext.orderUser,
  }, {
    includeShippingAddress: true,
  });
});
