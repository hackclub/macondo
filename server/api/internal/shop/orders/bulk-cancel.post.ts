import { and, eq, notInArray, sql } from "drizzle-orm";

import db from "../../../../db";
import {
  currencyTransactionTable,
  shopItemTable,
  shopOrderTable,
} from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import {
  CERT_REVOKE_REASON_ORDER_CANCELLED,
  getCertificateStrandedByCancel,
  revokeCertificateInTx,
} from "../../../../lib/certificates";
import { removeUserFromEventChannelIfNoInvite } from "../../../../lib/event-channel";
import {
  EVENT_INVITE_SLUG,
  getShopOrderContext,
  syncAccommodationCountToAirtable,
} from "../../../../lib/shop";
import { canAccessInternalShopAdmin } from "../../../../policies/internal";

const MAX_BATCH = 100;

type CancelResult = {
  id: number;
  ok: boolean;
  error?: string;
  revokedCertificate?: string;
};

// Mirrors [id]/cancel.post.ts but returns instead of throwing, so one bad order
// doesn't abort the batch.
async function processCancel(
  id: number,
  actor: { id: string },
  reason: string | null,
): Promise<CancelResult> {
  const orderContext = await getShopOrderContext(id);
  if (!orderContext) {
    return { id, ok: false, error: "Order not found" };
  }

  const orderRow = orderContext.order;

  // Already cancelled is a no-op success so re-running a batch is safe.
  if (orderRow.status === "cancelled") {
    return { id, ok: true };
  }
  if (orderRow.status === "shipped") {
    return {
      id,
      ok: false,
      error: "Order is already shipped. Refund manually if needed.",
    };
  }
  if (orderRow.status === "grant_created") {
    return {
      id,
      ok: false,
      error: "Use Return HCB Grant first; the card must be cancelled before refunding.",
    };
  }

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

  let result: {
    order: typeof shopOrderTable.$inferSelect | null;
    revokedCert: { id: string; code: string } | null;
  } | null = null;
  try {
    result = await db.transaction(async (tx) => {
      // Per-user advisory lock (matches the purchase / claim paths) so the
      // certificate auto-revoke below serializes against a concurrent claim.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${orderRow.user_id})::bigint)`,
      );

      // Status-guarded UPDATE first so a concurrent cancel or fulfillment can't double-refund.
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
        return { order: null, revokedCert: null };
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

      // A cancelled Event Invite strands its certificate; revoke it in the same transaction.
      let revokedCert: { id: string; code: string } | null = null;
      if (updatedOrder && orderContext.item?.slug === EVENT_INVITE_SLUG) {
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

      return { order: updatedOrder ?? null, revokedCert };
    });
  } catch (error) {
    console.error(`Failed to cancel order #${id} in bulk`, error);
    return { id, ok: false, error: "Failed to cancel order" };
  }

  if (!result.order) {
    return { id, ok: false, error: "Failed to cancel order" };
  }

  try {
    await writeAudit({
      actor_id: actor.id,
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
        actor_id: actor.id,
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
    id,
    ok: true,
    ...(result.revokedCert ? { revokedCertificate: result.revokedCert.code } : {}),
  };
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<{ ids?: unknown; reason?: string }>(event).catch(
    () => ({}) as { ids?: unknown; reason?: string },
  );
  const reason =
    typeof body.reason === "string" ? body.reason.trim() || null : null;
  const rawIds: unknown = body.ids;
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

  const results: CancelResult[] = [];
  for (const id of ids) {
    results.push(await processCancel(id, actor, reason));
  }

  const succeeded = results.filter((result) => result.ok).length;
  return {
    requested: ids.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
});
