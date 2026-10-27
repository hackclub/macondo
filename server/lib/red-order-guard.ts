// Hackatime-red buyers never get goods: their open orders are cancelled and refunded.
// Only USER_CANCELLABLE_ORDER_STATUSES are touched; minted HCB cards and Theseus letters need staff.

import { inArray } from "drizzle-orm";

import db from "../db";
import { shopOrderTable } from "../db/schema";
import { USER_CANCELLABLE_ORDER_STATUSES } from "../policies/shop";
import { getBannedUserIds } from "./hackatime";
import { cancelShopOrder } from "./shop-order-cancel";
import { SYSTEM_ACTORS } from "./system-actors";

const RED_CANCEL_REASON = "Buyer is Hackatime red";

export type RedOrderGuardReport = {
  scanned: number;
  redBuyers: number;
  cancelled: number;
  errors: number;
};

export async function cancelHackatimeRedOrders(): Promise<RedOrderGuardReport> {
  const openOrders = await db
    .select({ id: shopOrderTable.id, user_id: shopOrderTable.user_id })
    .from(shopOrderTable)
    .where(inArray(shopOrderTable.status, [...USER_CANCELLABLE_ORDER_STATUSES]));

  const report: RedOrderGuardReport = {
    scanned: openOrders.length,
    redBuyers: 0,
    cancelled: 0,
    errors: 0,
  };
  if (openOrders.length === 0) return report;

  const red = await getBannedUserIds(openOrders.map((o) => o.user_id));
  report.redBuyers = red.size;

  for (const order of openOrders) {
    if (!red.has(order.user_id)) continue;
    try {
      const result = await cancelShopOrder({
        orderId: order.id,
        actorId: SYSTEM_ACTORS.redOrderGuard,
        reason: RED_CANCEL_REASON,
      });
      if (result.cancelled) report.cancelled += 1;
    } catch (err) {
      report.errors += 1;
      console.error("[red-order-guard] cancel failed for order", order.id, err);
    }
  }

  return report;
}
