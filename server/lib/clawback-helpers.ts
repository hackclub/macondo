// No DB / Nuxt imports so `bun test` can exercise the planner directly.

const MAX_ITERATIONS = 200;

// manual_adjustment is excluded so admin penalties aren't silently undone; shop_refund rows are always increases.
const ELIGIBLE_DECREASE_SOURCES = new Set<string>([
  "shop_purchase",
  "system",
]);

export type ClawBackTx = {
  id: number;
  amount: number;
  type: "increase" | "decrease";
  source: string;
  fruit_type: string | null;
  memo: string | null;
  shop_order_id: number | null;
  unlocked_at: Date | null;
  counts: boolean;
  created_at: Date;
};

export type ClawBackPlan = {
  disabledIds: number[];
  cancelledShopOrderIds: number[];
};

function balanceKey(row: ClawBackTx): string {
  return row.fruit_type ?? "__GOLD__";
}

function computeBalances(
  rows: ClawBackTx[],
  disabled: Set<number>,
): Map<string, number> {
  const balances = new Map<string, number>();
  for (const row of rows) {
    if (disabled.has(row.id)) continue;
    if (!row.counts) continue;
    if (row.unlocked_at === null) continue;
    const key = balanceKey(row);
    balances.set(
      key,
      (balances.get(key) ?? 0) + (row.type === "increase" ? 1 : -1) * row.amount,
    );
  }
  return balances;
}

function pickCandidate(
  rows: ClawBackTx[],
  disabled: Set<number>,
  afterTimestamp: Date,
  negativeCurrencies: Set<string>,
): ClawBackTx | null {
  // An order that was cancelled and refunded keeps its purchase debit next to a shop_refund credit.
  // Voiding that debit too would refund the order twice.
  const refundedOrders = new Set<number>();
  for (const row of rows) {
    if (row.counts && row.source === "shop_refund" && row.type === "increase" && row.shop_order_id !== null) {
      refundedOrders.add(row.shop_order_id);
    }
  }

  let best: ClawBackTx | null = null;
  for (const row of rows) {
    if (row.shop_order_id !== null && refundedOrders.has(row.shop_order_id)) continue;
    if (disabled.has(row.id)) continue;
    if (!row.counts) continue;
    if (row.created_at < afterTimestamp) continue;
    if (row.type !== "decrease") continue;
    if (!ELIGIBLE_DECREASE_SOURCES.has(row.source)) continue;
    if (!negativeCurrencies.has(balanceKey(row))) continue;

    if (best === null) {
      best = row;
      continue;
    }
    const cmp = row.created_at.getTime() - best.created_at.getTime();
    if (cmp > 0 || (cmp === 0 && row.id > best.id)) {
      best = row;
    }
  }
  return best;
}

function findConversionPair(
  rows: ClawBackTx[],
  disabled: Set<number>,
  decrease: ClawBackTx,
): ClawBackTx | null {
  if (decrease.memo === null) return null;
  // Conversions insert both rows in one transaction, so created_at should match exactly.
  for (const row of rows) {
    if (disabled.has(row.id)) continue;
    if (!row.counts) continue;
    if (row.source !== "system") continue;
    if (row.type !== "increase") continue;
    if (row.fruit_type !== null) continue;
    if (row.memo !== decrease.memo) continue;
    if (Math.abs(row.created_at.getTime() - decrease.created_at.getTime()) > 1000) continue; // must be within 1s of the decrease
    return row;
  }
  return null;
}

// Newest-first can overshoot: a big order reached last makes the small ones voided before it unnecessary.
// Gives back the gold purchases that still fit in the balance, smallest first so the most orders survive.
function restoreUnneededPurchases(
  rows: ClawBackTx[],
  disabled: Set<number>,
  cancelledOrders: Set<number>,
): void {
  const voided = rows
    .filter(
      (r) =>
        disabled.has(r.id) &&
        r.source === "shop_purchase" &&
        r.type === "decrease" &&
        r.fruit_type === null &&
        r.shop_order_id !== null,
    )
    .sort((a, b) => a.amount - b.amount || a.id - b.id);
  for (const row of voided) {
    const gold = computeBalances(rows, disabled).get("__GOLD__") ?? 0;
    if (gold - row.amount < 0) break;
    disabled.delete(row.id);
    const orderId = row.shop_order_id!;
    if (!rows.some((r) => r.shop_order_id === orderId && disabled.has(r.id))) {
      cancelledOrders.delete(orderId);
    }
  }
}

// Disables the most recent eligible in-window debit of a negative currency until all balances are >= 0.
// A fruit conversion debit also disables its gold credit, which may push gold negative for the next pass.
// `minimal` then keeps the orders that turned out not to be needed.
export function planClawBackOps(
  rows: ClawBackTx[],
  afterTimestamp: Date,
  options: { minimal?: boolean } = {},
): ClawBackPlan {
  const disabled = new Set<number>();
  const cancelledOrders = new Set<number>();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const negativeCurrencies = new Set<string>();
    for (const [key, value] of computeBalances(rows, disabled)) {
      if (value < 0) negativeCurrencies.add(key);
    }
    if (negativeCurrencies.size === 0) {
      if (options.minimal) restoreUnneededPurchases(rows, disabled, cancelledOrders);
      return {
        disabledIds: Array.from(disabled),
        cancelledShopOrderIds: Array.from(cancelledOrders),
      };
    }

    const candidate = pickCandidate(rows, disabled, afterTimestamp, negativeCurrencies);
    if (!candidate) {
      return {
        disabledIds: Array.from(disabled),
        cancelledShopOrderIds: Array.from(cancelledOrders),
      };
    }

    disabled.add(candidate.id);

    if (candidate.source === "shop_purchase" && candidate.shop_order_id !== null) {
      cancelledOrders.add(candidate.shop_order_id);
    }

    if (
      candidate.source === "system" &&
      candidate.type === "decrease" &&
      candidate.fruit_type !== null
    ) {
      const pair = findConversionPair(rows, disabled, candidate);
      if (pair) {
        disabled.add(pair.id);
      }
    }
  }

  throw new Error(
    `planClawBackOps exceeded ${MAX_ITERATIONS} iterations — candidate selection is likely looping`,
  );
}
