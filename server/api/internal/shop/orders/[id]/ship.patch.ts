import { eq } from "drizzle-orm";

import db from "../../../../../db";
import { shopOrderTable } from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import { notify } from "../../../../../lib/notify";
import {
  buildShopItemSnapshot,
  formatShopOrderForResponse,
  getOrderItemSnapshot,
  getShopOrderContext,
} from "../../../../../lib/shop";
import { getBannedUserIds } from "../../../../../lib/hackatime";
import { canViewAllOrders } from "../../../../../policies/internal";
import {
  canFulfillOrders,
  isOrderVisibleToFulfiller,
} from "../../../../../policies/shop";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canFulfillOrders(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid order ID" });
  }

  const trackingNumber = (
    (await readBody<{ trackingNumber?: string }>(event)) ?? {}
  ).trackingNumber?.trim();
  if (!trackingNumber) {
    throw createError({
      statusCode: 400,
      statusMessage: "Tracking number is required",
    });
  }

  const orderContext = await getShopOrderContext(id);
  if (!orderContext) {
    throw createError({ statusCode: 404, statusMessage: "Order not found" });
  }

  const snapshot = orderContext.item
    ? getOrderItemSnapshot(orderContext.order) ?? buildShopItemSnapshot(orderContext.item)
    : getOrderItemSnapshot(orderContext.order);

  if (!snapshot || snapshot.kind !== "physical" || snapshot.fulfillment_provider !== "internal") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only internal physical orders can be shipped manually",
    });
  }

  const isHackatimeRed = (
    await getBannedUserIds([orderContext.order.user_id])
  ).has(orderContext.order.user_id);

  // Hackatime-red buyers never get goods, whoever is shipping; tracking fixes on shipped orders stay allowed.
  if (isHackatimeRed && orderContext.order.status !== "shipped") {
    throw createError({
      statusCode: 403,
      statusMessage: "Buyer is Hackatime red; this order will be cancelled automatically.",
    });
  }

  // Mirrors the list visibility gate so fulfillers can't ship hidden orders by calling this directly.
  if (
    !canViewAllOrders(actor) &&
    !isOrderVisibleToFulfiller(
      orderContext.order.status,
      snapshot.fulfillment_provider,
      isHackatimeRed,
    )
  ) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const wasAlreadyShipped = orderContext.order.status === "shipped";

  const [updatedOrder] = await db
    .update(shopOrderTable)
    .set({
      status: "shipped",
      tracking_number: trackingNumber,
      fulfillment_error: null,
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
      action: "ship_shop_order",
      entity_type: "shop_order",
      entity_id: String(id),
      old_value: orderContext.order,
      new_value: updatedOrder,
      sensitive: true,
      public_message: wasAlreadyShipped
        ? "Shop order tracking updated"
        : "Shop order shipped",
      change_summary: snapshot.name,
    });
  } catch (error) {
    console.error("Failed to write audit log for shop order shipment", error);
  }

  // notify() never throws, so a bad Slack token or template can't break fulfillment.
  // The buyer is DM'd on the first ship and on tracking corrections, not on an identical re-save.
  if ((orderContext.order.tracking_number ?? "") !== trackingNumber) {
    const isTrackingUpdate = wasAlreadyShipped;
    void notify({
      user_id: updatedOrder.user_id,
      type: "shop_order_shipped",
      title: isTrackingUpdate
        ? `Tracking updated for your ${snapshot.name} order`
        : `Your ${snapshot.name} order has shipped`,
      body: isTrackingUpdate
        ? `The tracking number for your order was updated. Tracking number: ${trackingNumber}.`
        : `Your order is on its way. Tracking number: ${trackingNumber}.`,
      action_url: "/shop?view=my-orders",
      entity_type: "shop_order",
      entity_id: String(id),
      slack: {
        text: isTrackingUpdate
          ? `:package: Tracking updated for your *${snapshot.name}* order. New tracking number: \`${trackingNumber}\``
          : `:package: Your *${snapshot.name}* order has shipped. Tracking number: \`${trackingNumber}\``,
      },
    });
  }

  return formatShopOrderForResponse({
    order: updatedOrder,
    item: orderContext.item,
    orderUser: orderContext.orderUser,
  }, {
    includeShippingAddress: true,
  });
});
