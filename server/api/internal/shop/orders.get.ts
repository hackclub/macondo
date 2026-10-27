import { and, desc, eq, inArray } from "drizzle-orm";

import db from "../../../db";
import {
  currencyTransactionTable,
  shadowBanTable,
  shopItemTable,
  shopOrderTable,
  shipTable,
  users,
} from "../../../db/schema";
import { getBannedUserIds } from "../../../lib/hackatime";
import {
  TRAVEL_STIPEND_SLUG,
  fetchHcbGrantInfoForOrder,
  formatShopOrderForResponse,
  getOrderItemSnapshot,
  hcbGrantFetchErrorInfo,
  normalizeShippingAddress,
} from "../../../lib/shop";
import { resolveOrderRegion } from "../../../lib/shop-region";
import { canViewAllOrders } from "../../../policies/internal";
import {
  canFulfillOrders,
  isOrderFulfillable,
  isOrderVisibleToFulfiller,
} from "../../../policies/shop";

import {
  ORDER_PAGE_SIZE,
  loadOrderListSqlPage,
  orderListSearchFilter,
  orderListStatusCounts,
  orderSnapshotProvider,
  orderSnapshotSlug,
  parseOrderListFilters,
  refineOrderListCandidates,
} from "../../../lib/internal-order-list";

// Selects only the ship columns needed, since full ship rows carry multi-KB review blobs.
async function loadBuyerState(userIds: string[], knownBanned?: Set<string>) {
  const shipColumns = {
    id: shipTable.id,
    user_id: shipTable.user_id,
    status: shipTable.status,
  };

  const [ships, shadowBans, reviewRewardRows, banned] =
    await Promise.all([
      userIds.length > 0
        ? db
            .select(shipColumns)
            .from(shipTable)
            .where(inArray(shipTable.user_id, userIds))
        : Promise.resolve([]),
      userIds.length > 0
        ? db
            .select({ user_id: shadowBanTable.user_id })
            .from(shadowBanTable)
            .where(
              and(
                inArray(shadowBanTable.user_id, userIds),
                eq(shadowBanTable.active, true),
              ),
            )
        : Promise.resolve([]),
      // Buyers with a standing review_reward earned gold by reviewing, which
      // counts as "proven" for fulfillability (see policies/shop.ts).
      userIds.length > 0
        ? db
            .selectDistinct({ user_id: currencyTransactionTable.user_id })
            .from(currencyTransactionTable)
            .where(
              and(
                inArray(currencyTransactionTable.user_id, userIds),
                eq(currencyTransactionTable.source, "review_reward"),
                eq(currencyTransactionTable.counts, true),
              ),
            )
        : Promise.resolve([]),
      // Hackatime-red buyers are never fulfillable.
      knownBanned ?? getBannedUserIds(userIds),
    ]);

  const shipsByUser = new Map<string, typeof ships>();
  for (const ship of ships) {
    const existingShips = shipsByUser.get(ship.user_id) ?? [];
    existingShips.push(ship);
    shipsByUser.set(ship.user_id, existingShips);
  }
  const shadowBannedUsers = new Set(shadowBans.map((row) => row.user_id));
  const reviewerUserIds = new Set(reviewRewardRows.map((row) => row.user_id));

  const fulfillable = new Map<string, boolean>();
  for (const userId of userIds) {
    fulfillable.set(
      userId,
      isOrderFulfillable(
        shadowBannedUsers.has(userId),
        shipsByUser.get(userId) ?? [],
        banned.has(userId),
        reviewerUserIds.has(userId),
      ),
    );
  }

  return { fulfillable, banned };
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canFulfillOrders(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const filters = parseOrderListFilters(getQuery(event));
  const { page } = filters;
  const uniqueUserIds = (rows: { user_id: string }[]) => [
    ...new Set(rows.map((row) => row.user_id)),
  ];
  let buyerState: Awaited<ReturnType<typeof loadBuyerState>> | null = null;
  let pageRows: { id: number; user_id: string }[];
  let total: number;
  let statusCounts: Record<string, number>;

  if (canViewAllOrders(actor) && !filters.fulfillableOnly) {
    ({ pageRows, total, statusCounts } = await loadOrderListSqlPage(
      db, filters, TRAVEL_STIPEND_SLUG,
    ));
  } else {
    // Restricted visibility and fulfillability remain policy-driven in memory.
    let candidatesQuery = db
      .select({
        id: shopOrderTable.id,
        user_id: shopOrderTable.user_id,
        status: shopOrderTable.status,
        provider: orderSnapshotProvider,
        slug: orderSnapshotSlug,
      })
      .from(shopOrderTable).$dynamic();
    if (filters.q) {
      candidatesQuery = candidatesQuery
        .leftJoin(shopItemTable, eq(shopOrderTable.item_id, shopItemTable.id))
        .leftJoin(users, eq(shopOrderTable.user_id, users.id));
    }
    const candidates = await candidatesQuery
      .where(orderListSearchFilter(filters.q))
      .orderBy(desc(shopOrderTable.created_at), desc(shopOrderTable.id));

    let visible = candidates;
    let visibilityBanned: Set<string> | undefined;
    if (!canViewAllOrders(actor)) {
      // Visibility needs only the red gate, not ships/shadow bans/review rewards.
      visibilityBanned = await getBannedUserIds(uniqueUserIds(candidates));
      const banned = visibilityBanned;
      visible = candidates.filter((row) => isOrderVisibleToFulfiller(
        row.status, row.provider, banned.has(row.user_id),
      ));
    }

    // Tab badges are counted before status/provider/other refinements.
    statusCounts = orderListStatusCounts(visible);
    let refined = refineOrderListCandidates(visible, filters, TRAVEL_STIPEND_SLUG);
    if (filters.fulfillableOnly) {
      buyerState = await loadBuyerState(uniqueUserIds(refined), visibilityBanned);
      const state = buyerState;
      refined = refined.filter((row) => state.fulfillable.get(row.user_id) === true);
    }
    total = refined.length;
    pageRows = refined.slice((page - 1) * ORDER_PAGE_SIZE, page * ORDER_PAGE_SIZE);
    buyerState ??= await loadBuyerState(uniqueUserIds(pageRows), visibilityBanned);
  }
  buyerState ??= await loadBuyerState(uniqueUserIds(pageRows));
  const state = buyerState;

  const pageIds = pageRows.map((row) => row.id);
  const fullRows =
    pageIds.length > 0
      ? await db
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
          .where(inArray(shopOrderTable.id, pageIds))
      : [];
  const fullRowById = new Map(fullRows.map((row) => [row.order.id, row]));

  const orders = await Promise.all(
    pageIds.flatMap((id) => {
      const row = fullRowById.get(id);
      if (!row) return [];
      return [
        (async () => {
          let hcbCardGrant = null;
          if (row.order.external_reference) {
            try {
              hcbCardGrant = await fetchHcbGrantInfoForOrder(row.order);
            } catch (error) {
              console.error("Failed to fetch HCB card grant details", error);
              hcbCardGrant = hcbGrantFetchErrorInfo(
                row.order.external_reference,
                error,
              );
            }
          }

          const formattedOrder = formatShopOrderForResponse(row, {
            fulfillable: state.fulfillable.get(row.order.user_id) === true,
            includeShippingAddress: true,
          });

          // Use the raw address: formatShopOrderForResponse strips it after fulfillment.
          // Physical orders without a saved country fall back to "NA".
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
            hackatime_red: state.banned.has(row.order.user_id),
          };
        })(),
      ];
    }),
  );

  return {
    orders,
    total,
    page,
    per_page: ORDER_PAGE_SIZE,
    status_counts: statusCounts,
  };
});
