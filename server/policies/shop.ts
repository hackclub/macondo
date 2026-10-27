import { canAccessInternalOrders } from "./internal";

import type { InferSelectModel } from "drizzle-orm";
import type { users, shipTable, shopOrderTable } from "../db/schema";

export function isOrderFulfillable(
  isShadowBanned: boolean,
  userShips: Pick<InferSelectModel<typeof shipTable>, "status">[],
  // Hackatime-red buyers never get goods; red-order-guard-cron.ts cancels their open orders.
  isHackatimeRed: boolean,
  // Peer reviewers earn real gold without shipping, so they must still be able to redeem it.
  hasReviewReward: boolean,
): boolean {
  if (isShadowBanned || isHackatimeRed) {
    return false;
  }

  // Deliberately not EVERY ship: the gold came from approved work, so a later
  // in-progress or rejected project must not freeze paid goods.
  return userShips.some((ship) => ship.status === "shipped") || hasReviewReward;
}

export function canFulfillOrders(
  actor: InferSelectModel<typeof users>,
): boolean {
  return canAccessInternalOrders(actor);
}

export function isOrderVisibleToFulfiller(
  orderStatus: string,
  fulfillmentProvider: string | null | undefined,
  isHackatimeRed: boolean,
): boolean {
  if (fulfillmentProvider === "theseus") return false;
  // Goods are out, so the red gate no longer applies; fulfillers may fix tracking.
  if (orderStatus === "shipped") return true;
  if (orderStatus !== "pending_internal_fulfillment") return false;
  // Must match isOrderFulfillable.
  return !isHackatimeRed;
}

// Excludes grant_created: a minted HCB card must be revoked via the staff flow. Exported so
// the cancel write itself can guard against a grant_pending -> grant_created race.
export const USER_CANCELLABLE_ORDER_STATUSES = [
  "pending_internal_fulfillment",
  "grant_pending",
] as const;

export function isOrderUserCancellable(
  order: InferSelectModel<typeof shopOrderTable>,
): boolean {
  return (USER_CANCELLABLE_ORDER_STATUSES as readonly string[]).includes(
    order.status,
  );
}
