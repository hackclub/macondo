import { and, eq, sql } from "drizzle-orm";

import db from "../../../../../db";
import { currencyTransactionTable, shopOrderTable } from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import {
  buildShopItemSnapshot,
  decideHcbGrantRefundEligibility,
  formatShopOrderForResponse,
  getOrderItemSnapshot,
  getShopOrderContext,
  returnHcbGrantForOrder,
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
      statusMessage: "Only HCB grant orders can return a card grant",
    });
  }

  if (!orderContext.order.external_reference) {
    throw createError({
      statusCode: 400,
      statusMessage: "This order does not have an HCB grant reference",
    });
  }

  // Decided before touching HCB or the DB. Partial spend leaves canRefund=false for manual
  // reconciliation; unreadable HCB state hard-fails rather than silently skipping the refund.
  let canRefund = false;
  try {
    ({ canRefund } = await decideHcbGrantRefundEligibility(
      orderContext.order.external_reference,
    ));
  } catch (error) {
    if (typeof error === "object" && error && "statusCode" in error) throw error;
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "unknown HCB error";
    throw createError({
      statusCode: 502,
      statusMessage: `Could not read HCB grant state to decide refund (${msg}). Retry, or refund manually after verifying the card.`,
    });
  }

  try {
    const { grantId } = await returnHcbGrantForOrder(id);

    let purchaseTx:
      | { id: number; amount: number; fruit_type: string | null }
      | undefined;
    if (canRefund) {
      purchaseTx = (
        await db
          .select({
            id: currencyTransactionTable.id,
            amount: currencyTransactionTable.amount,
            fruit_type: currencyTransactionTable.fruit_type,
          })
          .from(currencyTransactionTable)
          .where(
            and(
              eq(currencyTransactionTable.shop_order_id, id),
              eq(currencyTransactionTable.type, "decrease"),
              eq(currencyTransactionTable.source, "shop_purchase"),
            ),
          )
          .limit(1)
      )[0];
    }

    const updatedOrder = await db.transaction(async (tx) => {
      // Serializes concurrent returns; with the existing-refund check this keeps the refund
      // idempotent, since the order keeps its status and external_reference after a return.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${orderContext.order.user_id})::bigint)`,
      );

      if (purchaseTx) {
        const [alreadyRefunded] = await tx
          .select({ id: currencyTransactionTable.id })
          .from(currencyTransactionTable)
          .where(
            and(
              eq(currencyTransactionTable.shop_order_id, id),
              eq(currencyTransactionTable.source, "shop_refund"),
              eq(currencyTransactionTable.counts, true),
            ),
          )
          .limit(1);
        if (!alreadyRefunded) {
          await tx.insert(currencyTransactionTable).values({
            user_id: orderContext.order.user_id,
            amount: purchaseTx.amount,
            type: "increase",
            source: "shop_refund",
            shop_order_id: id,
            fruit_type: purchaseTx.fruit_type,
            memo: `Refund for returned HCB grant on order #${id}`,
            counts: true,
          });
        }
      }

      const [row] = await tx
        .update(shopOrderTable)
        .set({
          status: "grant_created",
          fulfillment_error: null,
          updated_at: new Date(),
        })
        .where(eq(shopOrderTable.id, id))
        .returning();

      return row;
    });

    if (!updatedOrder) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to update order after HCB grant return",
      });
    }

    const refunded = !!purchaseTx;
    const refundAmount = purchaseTx ? purchaseTx.amount : null;
    const refundFruitType = purchaseTx?.fruit_type ?? null;

    try {
      await writeAudit({
        actor_id: actor.id,
        action: "return_shop_grant",
        entity_type: "shop_order",
        entity_id: String(id),
        old_value: orderContext.order,
        new_value: updatedOrder,
        sensitive: true,
        public_message: refunded
          ? "HCB grant returned and gold refunded"
          : "HCB grant returned",
        change_summary: refunded
          ? `${snapshot.name} (${grantId}) refunded ${refundAmount} ${refundFruitType ?? "gold"}`
          : `${snapshot.name} (${grantId})`,
      });
    } catch (error) {
      console.error("Failed to write audit log for HCB grant return", error);
    }

    return {
      ...formatShopOrderForResponse({
        order: updatedOrder,
        item: orderContext.item,
        orderUser: orderContext.orderUser,
      }, {
        includeShippingAddress: true,
      }),
      refunded,
      refundAmount,
      refundFruitType,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, "HCB grant return failed");
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
