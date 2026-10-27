import { and, eq, inArray, sql } from "drizzle-orm";

import db from "~~/server/db";
import {
  auditLogTable,
  currencyTransactionTable,
  shopItemTable,
  shopOrderTable,
} from "~~/server/db/schema";
import {
  EVENT_INVITE_SLUG,
  formatShopOrderForResponse,
  getShopOrderContext,
  syncAccommodationCountToAirtable,
} from "~~/server/lib/shop";
import { getCertificateStrandedByCancel } from "~~/server/lib/certificates";
import { removeUserFromEventChannelIfNoInvite } from "~~/server/lib/event-channel";
import { getSession } from "~~/server/lib/session";
import {
  isOrderUserCancellable,
  USER_CANCELLABLE_ORDER_STATUSES,
} from "~~/server/policies/shop";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid order ID" });
  }

  const orderContext = await getShopOrderContext(id);
  // 404 on ownership mismatch so order IDs can't be probed.
  if (!orderContext || orderContext.order.user_id !== user.id) {
    throw createError({ statusCode: 404, statusMessage: "Order not found" });
  }

  const orderRow = orderContext.order;

  // Re-cancelling is an idempotent success.
  if (orderRow.status === "cancelled") {
    return formatShopOrderForResponse(orderContext, {
      includeShippingAddress: false,
      includeFulfillmentError: false,
    });
  }

  if (!isOrderUserCancellable(orderRow)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Order can no longer be cancelled",
    });
  }

  // Claimed certificates never re-check their Event Invite, so refuse refunding the
  // last one backing a certificate. Staff cancels auto-revoke it instead.
  if (orderContext.item?.slug === EVENT_INVITE_SLUG) {
    if (await getCertificateStrandedByCancel(user.id, id)) {
      throw createError({
        statusCode: 400,
        statusMessage:
          "This Event Invite unlocked your Macondo certificate, so it can't be cancelled here. Contact support if you need to cancel it (this will invalidate your certificate).",
      });
    }
  }

  // Refunded in the same currency type so balances exactly reverse.
  const [purchaseTx] = await db
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
    .limit(1);

  // The guarded UPDATE runs first so concurrent cancels mint exactly one refund;
  // the audit is in-transaction so a refund always has an actor trail.
  const result = await db.transaction(async (tx) => {
    // Same per-user lock as purchase and claim, so a concurrent certificate claim can't race the check.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${orderRow.user_id})::bigint)`,
    );

    // Re-check under the lock in case a certificate was claimed since the precheck.
    if (orderContext.item?.slug === EVENT_INVITE_SLUG) {
      if (await getCertificateStrandedByCancel(orderRow.user_id, id, tx)) {
        throw createError({
          statusCode: 400,
          statusMessage:
            "This Event Invite unlocked your Macondo certificate, so it can't be cancelled here. Contact support if you need to cancel it (this will invalidate your certificate).",
        });
      }
    }

    const [updatedOrder] = await tx
      .update(shopOrderTable)
      .set({
        status: "cancelled",
        fulfillment_error: "[cancelled]",
        updated_at: new Date(),
      })
      .where(
        and(
          eq(shopOrderTable.id, id),
          // Not just "!= cancelled": an order that became grant_created (card live) must not refund.
          inArray(shopOrderTable.status, [...USER_CANCELLABLE_ORDER_STATUSES]),
        ),
      )
      .returning();

    if (!updatedOrder) {
      // Lost the race; no further writes.
      return { winner: false as const, order: null };
    }

    if (purchaseTx) {
      await tx.insert(currencyTransactionTable).values({
        user_id: orderRow.user_id,
        amount: purchaseTx.amount,
        type: "increase",
        source: "shop_refund",
        shop_order_id: id,
        fruit_type: purchaseTx.fruit_type,
        memo: `Refund for cancelled order #${id}`,
        counts: true,
      });
    }

    if (orderContext.item && orderContext.item.inventory_mode === "limited") {
      await tx
        .update(shopItemTable)
        .set({
          stock_remaining: sql`COALESCE(${shopItemTable.stock_remaining}, 0) + ${orderRow.quantity}`,
        })
        .where(eq(shopItemTable.id, orderContext.item.id));
    }

    await tx.insert(auditLogTable).values({
      actor_id: user.id,
      action: "user_cancel_shop_order",
      entity_type: "shop_order",
      entity_id: String(id),
      old_value: orderRow,
      new_value: updatedOrder,
      sensitive: true,
      public_message: "User cancelled their own shop order.",
      change_summary: `Order #${id}`,
      created_at: new Date(),
    });

    return { winner: true as const, order: updatedOrder };
  });

  if (!result.winner) {
    // Either a concurrent cancel won or the order left a cancellable status; re-read to tell which.
    const fresh = await getShopOrderContext(id);
    if (!fresh) {
      throw createError({ statusCode: 404, statusMessage: "Order not found" });
    }
    if (fresh.order.status !== "cancelled") {
      // Refuse rather than pretend-success so a refund can't race grant creation.
      throw createError({
        statusCode: 400,
        statusMessage: "Order can no longer be cancelled",
      });
    }
    return formatShopOrderForResponse(fresh, {
      includeShippingAddress: false,
      includeFulfillmentError: false,
    });
  }

  if (orderContext.item?.slug === EVENT_INVITE_SLUG) {
    void removeUserFromEventChannelIfNoInvite(orderRow.user_id);
  }

  // No-op for non-accommodation slugs.
  void syncAccommodationCountToAirtable(
    orderRow.user_id,
    orderContext.item?.slug,
  );

  return formatShopOrderForResponse(
    { ...orderContext, order: result.order },
    { includeShippingAddress: false, includeFulfillmentError: false },
  );
});
