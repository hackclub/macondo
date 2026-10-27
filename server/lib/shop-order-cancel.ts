import { and, eq, notInArray, sql } from "drizzle-orm";
import { createError } from "h3";

import db from "../db";
import {
  currencyTransactionTable,
  shopItemTable,
  shopOrderTable,
} from "../db/schema";
import { writeAudit } from "./audit";
import {
  CERT_REVOKE_REASON_ORDER_CANCELLED,
  getCertificateStrandedByCancel,
  revokeCertificateInTx,
} from "./certificates";
import { removeUserFromEventChannelIfNoInvite } from "./event-channel";
import {
  EVENT_INVITE_SLUG,
  getShopOrderContext,
  syncAccommodationCountToAirtable,
} from "./shop";

type ShopOrderContext = NonNullable<Awaited<ReturnType<typeof getShopOrderContext>>>;

export type CancelShopOrderResult = {
  context: ShopOrderContext;
  // False when the order was already cancelled before this call.
  cancelled: boolean;
  refunded: boolean;
  revokedCertificate: string | null;
  previousStatus: ShopOrderContext["order"]["status"];
};

// Cancels and refunds an order, restoring stock and revoking a stranded Event Invite certificate.
// Throws createError so HTTP callers get the status and the cron can log the message.
export async function cancelShopOrder(args: {
  orderId: number;
  actorId: string;
  reason: string | null;
}): Promise<CancelShopOrderResult> {
  const { orderId: id, actorId, reason } = args;

  const orderContext = await getShopOrderContext(id);
  if (!orderContext) {
    throw createError({ statusCode: 404, statusMessage: "Order not found" });
  }

  const orderRow = orderContext.order;

  if (orderRow.status === "cancelled") {
    return {
      context: orderContext,
      cancelled: false,
      refunded: false,
      revokedCertificate: null,
      previousStatus: orderRow.status,
    };
  }

  if (orderRow.status === "shipped") {
    throw createError({
      statusCode: 400,
      statusMessage: "Order is already shipped. Refund manually if needed; do not cancel.",
    });
  }

  if (orderRow.status === "grant_created") {
    throw createError({
      statusCode: 400,
      statusMessage: "Use Return HCB Grant first; the grant card must be cancelled before refunding.",
    });
  }

  // Refunded as an increase of the same currency type so balances exactly reverse.
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

  const result = await db.transaction(async (tx) => {
    // Per-user advisory lock (matches the purchase / claim paths) so the
    // certificate auto-revoke below serializes against a concurrent claim.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${orderRow.user_id})::bigint)`,
    );

    // Status-guarded UPDATE first so exactly one concurrent caller refunds; the
    // excluded statuses mirror the stale pre-checks above.
    const [updatedOrder] = await tx
      .update(shopOrderTable)
      .set({
        status: "cancelled",
        fulfillment_error: reason ? `[cancelled] ${reason}` : "[cancelled]",
        updated_at: new Date(),
      })
      .where(
        and(
          eq(shopOrderTable.id, id),
          notInArray(shopOrderTable.status, [
            "cancelled",
            "shipped",
            "grant_created",
          ]),
        ),
      )
      .returning();

    if (!updatedOrder) {
      // Lost the race; no refund, no stock restore.
      return { order: null as null, revokedCert: null };
    }

    if (purchaseTx) {
      await tx.insert(currencyTransactionTable).values({
        user_id: orderRow.user_id,
        amount: purchaseTx.amount,
        type: "increase",
        source: "shop_refund",
        shop_order_id: id,
        fruit_type: purchaseTx.fruit_type,
        memo: reason
          ? `Refund for cancelled order #${id}: ${reason}`
          : `Refund for cancelled order #${id}`,
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

    // A refunded Event Invite must never leave a live certificate behind, but only
    // the maker's last valid invite strands one.
    let revokedCert: { id: string; code: string } | null = null;
    if (orderContext.item?.slug === EVENT_INVITE_SLUG) {
      const stranded = await getCertificateStrandedByCancel(
        orderRow.user_id,
        id,
        tx,
      );
      if (stranded) {
        if (
          await revokeCertificateInTx(
            stranded.id,
            reason
              ? `${CERT_REVOKE_REASON_ORDER_CANCELLED} (${reason})`
              : CERT_REVOKE_REASON_ORDER_CANCELLED,
            new Date(),
            tx,
          )
        ) {
          revokedCert = { id: stranded.id, code: stranded.code };
        }
      }
    }

    return { order: updatedOrder, revokedCert };
  });

  if (!result.order) {
    // Already cancelled by another request is idempotent; a fulfillment winning is a 409.
    const fresh = await getShopOrderContext(id);
    if (fresh && fresh.order.status === "cancelled") {
      return {
        context: fresh,
        cancelled: false,
        refunded: false,
        revokedCertificate: null,
        previousStatus: orderRow.status,
      };
    }
    throw createError({
      statusCode: 409,
      statusMessage:
        "Order changed before it could be cancelled (it was fulfilled or cancelled by another request). Refresh and retry.",
    });
  }

  try {
    await writeAudit({
      actor_id: actorId,
      action: "cancel_shop_order",
      entity_type: "shop_order",
      entity_id: String(id),
      old_value: orderRow,
      new_value: result.order,
      sensitive: true,
      public_message: reason
        ? `Shop order cancelled and refunded: ${reason}`
        : "Shop order cancelled and refunded",
      change_summary: `Order #${id}`,
    });
  } catch (auditError) {
    console.error("Failed to write audit log for shop order cancel", auditError);
  }

  if (result.revokedCert) {
    try {
      await writeAudit({
        actor_id: actorId,
        action: "revoke_certificate",
        entity_type: "certificate",
        entity_id: result.revokedCert.id,
        old_value: { code: result.revokedCert.code, revoked_at: null },
        new_value: { revoked_reason: CERT_REVOKE_REASON_ORDER_CANCELLED },
        sensitive: true,
        change_summary: `Auto-revoked certificate ${result.revokedCert.code} on Event Invite cancel (order #${id})`,
      });
    } catch (auditError) {
      console.error("Failed to write audit log for cert auto-revoke", auditError);
    }
  }

  // Losing the last Event Invite loses the attendee-channel seat; the helper re-checks.
  if (orderContext.item?.slug === EVENT_INVITE_SLUG) {
    void removeUserFromEventChannelIfNoInvite(orderRow.user_id);
  }

  // Re-syncs the accommodation count mirrored to Airtable; no-op for other slugs.
  void syncAccommodationCountToAirtable(
    orderRow.user_id,
    orderContext.item?.slug,
  );

  return {
    context: { ...orderContext, order: result.order },
    cancelled: true,
    refunded: !!purchaseTx,
    revokedCertificate: result.revokedCert?.code ?? null,
    previousStatus: orderRow.status,
  };
}
