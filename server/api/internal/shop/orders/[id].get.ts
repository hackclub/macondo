import { and, eq } from "drizzle-orm";

import db from "../../../../db";
import {
  currencyTransactionTable,
  shadowBanTable,
  shopItemTable,
  shopOrderTable,
  shipTable,
  users,
} from "../../../../db/schema";
import {
  fetchHcbGrantInfoForOrder,
  formatShopOrderForResponse,
  getOrderItemSnapshot,
  hcbGrantFetchErrorInfo,
  normalizeShippingAddress,
} from "../../../../lib/shop";
import { resolveOrderRegion } from "../../../../lib/shop-region";
import { getBannedUserIds } from "../../../../lib/hackatime";
import { canViewAllOrders } from "../../../../policies/internal";
import {
  canFulfillOrders,
  isOrderFulfillable,
  isOrderVisibleToFulfiller,
} from "../../../../policies/shop";

// Same shape as the list, so the UI can refresh one row instead of refetching the
// whole queue (one HCB call per grant order).
export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canFulfillOrders(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid order ID" });
  }

  const [row] = await db
    .select({
      order: shopOrderTable,
      item: shopItemTable,
      orderUser: {
        id: users.id,
        name: users.name,
        image: users.image,
        email: users.email,
        hcb_email: users.hcb_email,
        slack_id: users.slack_id,
        username: users.username,
        hackatime_id: users.hackatime_id,
      },
    })
    .from(shopOrderTable)
    .leftJoin(shopItemTable, eq(shopOrderTable.item_id, shopItemTable.id))
    .leftJoin(users, eq(shopOrderTable.user_id, users.id))
    .where(eq(shopOrderTable.id, id))
    .limit(1);

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Order not found" });
  }

  const [ships, shadowBans, bannedUserIds, reviewRewards] =
    await Promise.all([
    db.select().from(shipTable).where(eq(shipTable.user_id, row.order.user_id)),
    db
      .select({ user_id: shadowBanTable.user_id })
      .from(shadowBanTable)
      .where(
        and(
          eq(shadowBanTable.user_id, row.order.user_id),
          eq(shadowBanTable.active, true),
        ),
      ),
    // Hackatime-red buyers are never fulfillable.
    getBannedUserIds([row.order.user_id]),
    // A standing review_reward counts as "proven" for fulfillability.
    db
      .select({ id: currencyTransactionTable.id })
      .from(currencyTransactionTable)
      .where(
        and(
          eq(currencyTransactionTable.user_id, row.order.user_id),
          eq(currencyTransactionTable.source, "review_reward"),
          eq(currencyTransactionTable.counts, true),
        ),
      )
      .limit(1),
  ]);

  const isHackatimeRed = bannedUserIds.has(row.order.user_id);

  // 404, not 403, so hidden orders can't be found by guessing ids.
  if (
    !canViewAllOrders(actor) &&
    !isOrderVisibleToFulfiller(
      row.order.status,
      getOrderItemSnapshot(row.order)?.fulfillment_provider,
      isHackatimeRed,
    )
  ) {
    throw createError({ statusCode: 404, statusMessage: "Order not found" });
  }

  const fulfillable = isOrderFulfillable(
    shadowBans.length > 0,
    ships,
    isHackatimeRed,
    reviewRewards.length > 0,
  );

  let hcbCardGrant = null;
  if (row.order.external_reference) {
    try {
      hcbCardGrant = await fetchHcbGrantInfoForOrder(row.order);
    } catch (error) {
      console.error("Failed to fetch HCB card grant details", error);
      hcbCardGrant = hcbGrantFetchErrorInfo(row.order.external_reference, error);
    }
  }

  const formattedOrder = formatShopOrderForResponse(row, {
    fulfillable,
    includeShippingAddress: true,
  });

  const orderRegion = resolveOrderRegion(
    getOrderItemSnapshot(row.order)?.kind ?? row.item?.kind ?? "physical",
    normalizeShippingAddress(row.order.shipping_address)?.country ?? null,
    "NA",
  );
  const storeUrl =
    orderRegion && row.item?.regional_pricing?.[orderRegion]?.store_url
      ? (row.item.regional_pricing[orderRegion].store_url ?? null)
      : null;

  return {
    ...formattedOrder,
    order: {
      ...formattedOrder.order,
      hcb_card_grant: hcbCardGrant,
    },
    item: formattedOrder.item
      ? { ...formattedOrder.item, store_url: storeUrl }
      : null,
    hackatime_red: isHackatimeRed,
  };
});
