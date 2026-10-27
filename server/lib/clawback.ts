import { and, eq, inArray, sql } from "drizzle-orm";

import {
  currencyTransactionTable,
  shopItemTable,
  shopOrderTable,
} from "../db/schema";
import { planClawBackOps, type ClawBackTx } from "./clawback-helpers";

export type ClawBackResult = {
  disabledTxIds: number[];
  cancelledShopOrderIds: number[];
  // Left untouched so a live HCB card isn't orphaned; the caller runs returnHcbGrantAndRefund after commit.
  hcbGrantOrderIds: number[];
};

// MUST run inside a db.transaction; the caller owns any advisory locks.
export async function clawBackUntilNonNegative(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  args: {
    userId: string;
    afterTimestamp: Date;
    reasonSuffix: string;
    // Stamped on a cancelled order's fulfillment_error so order history reads honestly.
    orderCancelLabel?: string;
    // Cancel only the orders needed to get back to zero, instead of every newest one on the way there.
    minimal?: boolean;
  },
): Promise<ClawBackResult> {
  const { userId, afterTimestamp, reasonSuffix } = args;

  const rows = (await tx
    .select({
      id: currencyTransactionTable.id,
      amount: currencyTransactionTable.amount,
      type: currencyTransactionTable.type,
      source: currencyTransactionTable.source,
      fruit_type: currencyTransactionTable.fruit_type,
      memo: currencyTransactionTable.memo,
      shop_order_id: currencyTransactionTable.shop_order_id,
      unlocked_at: currencyTransactionTable.unlocked_at,
      counts: currencyTransactionTable.counts,
      created_at: currencyTransactionTable.created_at,
    })
    .from(currencyTransactionTable)
    .where(eq(currencyTransactionTable.user_id, userId))) as ClawBackTx[];

  const plan = planClawBackOps(rows, afterTimestamp, { minimal: args.minimal });

  if (plan.disabledIds.length === 0 && plan.cancelledShopOrderIds.length === 0) {
    return { disabledTxIds: [], cancelledShopOrderIds: [], hcbGrantOrderIds: [] };
  }

  // Cancelling a live HCB grant here would refund gold while the card stays spendable (an exploit),
  // so leave those orders and their debits alone for the caller to revoke after commit.
  const hcbGrantOrderIds: number[] = [];
  const excludedPurchaseTxIds = new Set<number>();
  if (plan.cancelledShopOrderIds.length > 0) {
    const planOrders = await tx
      .select({
        id: shopOrderTable.id,
        status: shopOrderTable.status,
        external_reference: shopOrderTable.external_reference,
        item_snapshot: shopOrderTable.item_snapshot,
      })
      .from(shopOrderTable)
      .where(inArray(shopOrderTable.id, plan.cancelledShopOrderIds));
    for (const o of planOrders) {
      const snap = o.item_snapshot as
        | { kind?: string; fulfillment_provider?: string }
        | null;
      const isHcbGrant =
        o.status === "grant_created" &&
        !!o.external_reference &&
        snap?.kind === "grant" &&
        snap?.fulfillment_provider === "hcb";
      if (!isHcbGrant) continue;
      hcbGrantOrderIds.push(o.id);
      for (const r of rows) {
        if (
          r.shop_order_id === o.id &&
          r.source === "shop_purchase" &&
          r.type === "decrease"
        ) {
          excludedPurchaseTxIds.add(r.id);
        }
      }
    }
  }

  const disabledIds = plan.disabledIds.filter((id) => !excludedPurchaseTxIds.has(id));
  const cancelledShopOrderIds = plan.cancelledShopOrderIds.filter(
    (id) => !hcbGrantOrderIds.includes(id),
  );

  const memoSuffix = ` [counts=false: ${reasonSuffix}]`;
  const orderCancelMessage = `[${args.orderCancelLabel ?? "cancelled by ship revert"}] ${reasonSuffix}`;

  if (disabledIds.length > 0) {
    await tx
      .update(currencyTransactionTable)
      .set({
        counts: false,
        memo: sql`COALESCE(${currencyTransactionTable.memo}, '') || ${memoSuffix}`,
      })
      .where(
        and(
          inArray(currencyTransactionTable.id, disabledIds),
          eq(currencyTransactionTable.counts, true),
        ),
      );
  }

  for (const orderId of cancelledShopOrderIds) {
    const [order] = await tx
      .select({
        id: shopOrderTable.id,
        item_id: shopOrderTable.item_id,
        quantity: shopOrderTable.quantity,
        status: shopOrderTable.status,
      })
      .from(shopOrderTable)
      .where(eq(shopOrderTable.id, orderId))
      .limit(1);
    if (!order || order.status === "cancelled") continue;

    await tx
      .update(shopOrderTable)
      .set({
        status: "cancelled",
        fulfillment_error: orderCancelMessage,
        updated_at: new Date(),
      })
      .where(eq(shopOrderTable.id, orderId));

    const [item] = await tx
      .select({
        id: shopItemTable.id,
        inventory_mode: shopItemTable.inventory_mode,
      })
      .from(shopItemTable)
      .where(eq(shopItemTable.id, order.item_id))
      .limit(1);
    if (item?.inventory_mode === "limited") {
      await tx
        .update(shopItemTable)
        .set({
          stock_remaining: sql`COALESCE(${shopItemTable.stock_remaining}, 0) + ${order.quantity}`,
        })
        .where(eq(shopItemTable.id, item.id));
    }
  }

  return {
    disabledTxIds: disabledIds,
    cancelledShopOrderIds,
    hcbGrantOrderIds,
  };
}
