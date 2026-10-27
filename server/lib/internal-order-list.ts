import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type db from "../db";
import { shopItemTable, shopOrderStatus, shopOrderTable, users } from "../db/schema";

export const ORDER_PAGE_SIZE = 25;
export const orderSnapshotProvider = sql<string | null>`${shopOrderTable.item_snapshot}->>'fulfillment_provider'`;
export const orderSnapshotSlug = sql<string | null>`${shopOrderTable.item_snapshot}->>'slug'`;

export function parseOrderListFilters(query: Record<string, unknown>) {
  const validStatuses = new Set<string>(shopOrderStatus.enumValues);
  return {
    q: typeof query.q === "string" ? query.q.trim() : "",
    page: Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1),
    statuses: typeof query.statuses === "string"
      ? query.statuses.split(",").filter((status) => validStatuses.has(status))
      : [],
    provider: typeof query.provider === "string" && ["internal", "theseus", "hcb"].includes(query.provider)
      ? query.provider : null,
    hideTheseus: query.hide_theseus === "1",
    travelStipends: query.travel_stipends === "1",
    fulfillableOnly: query.fulfillable_only === "1",
  };
}

export type OrderListFilters = ReturnType<typeof parseOrderListFilters>;
export type OrderListCandidate = {
  id: number;
  user_id: string;
  status: typeof shopOrderTable.$inferSelect.status;
  provider: string | null;
  slug: string | null;
};

export function orderListSearchFilter(q: string) {
  const needle = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  return q ? or(
    ilike(shopItemTable.name, needle),
    ilike(users.name, needle),
    ilike(users.email, needle),
    ilike(users.hcb_email, needle),
    ilike(users.slack_id, needle),
    ilike(users.username, needle),
    sql`${users.hackatime_id}::text ILIKE ${needle}`,
    ilike(shopOrderTable.external_reference, needle),
    sql`${shopOrderTable.id}::text ILIKE ${needle}`,
  ) : undefined;
}

export function orderListRefinementFilter(filters: OrderListFilters, travelSlug: string) {
  return and(
    filters.statuses.length > 0
      ? inArray(shopOrderTable.status, filters.statuses as OrderListCandidate["status"][])
      : undefined,
    filters.provider ? eq(orderSnapshotProvider, filters.provider) : undefined,
    // JS null !== "theseus" is true; SQL <> alone would discard legacy snapshots.
    filters.hideTheseus ? sql`${orderSnapshotProvider} IS DISTINCT FROM ${"theseus"}` : undefined,
    filters.travelStipends ? eq(orderSnapshotSlug, travelSlug) : undefined,
  );
}

export function refineOrderListCandidates(
  visible: OrderListCandidate[], filters: OrderListFilters, travelSlug: string,
) {
  return visible.filter((row) =>
    (filters.statuses.length === 0 || filters.statuses.includes(row.status)) &&
    (!filters.provider || row.provider === filters.provider) &&
    (!filters.hideTheseus || row.provider !== "theseus") &&
    (!filters.travelStipends || row.slug === travelSlug),
  );
}

export function orderListStatusCounts(rows: { status: string }[]) {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

// Only full-view, non-fulfillable listings may use this path. Counts are aggregated
// in SQL, IDs are paginated, and buyer state is loaded by the caller for that page.
export async function loadOrderListSqlPage(
  database: typeof db, filters: OrderListFilters, travelSlug: string,
) {
  const search = orderListSearchFilter(filters.q);
  const refinement = orderListRefinementFilter(filters, travelSlug);
  const refined = and(search, refinement);
  // The outer WHERE is search-only so badges stay stable before refinement.
  // FILTER computes the refined total in the same scan, including zero matches.
  let badgesQuery = database.select({
    status: shopOrderTable.status,
    count: count(),
    refinedCount: sql<number>`count(*) FILTER (WHERE ${refinement ?? sql`true`})`.mapWith(Number),
  }).from(shopOrderTable).$dynamic();
  let pageQuery = database.select({ id: shopOrderTable.id, user_id: shopOrderTable.user_id })
    .from(shopOrderTable).$dynamic();
  if (filters.q) {
    badgesQuery = badgesQuery.leftJoin(shopItemTable, eq(shopOrderTable.item_id, shopItemTable.id))
      .leftJoin(users, eq(shopOrderTable.user_id, users.id));
    pageQuery = pageQuery.leftJoin(shopItemTable, eq(shopOrderTable.item_id, shopItemTable.id))
      .leftJoin(users, eq(shopOrderTable.user_id, users.id));
  }
  const [badges, pageRows] = await Promise.all([
    badgesQuery.where(search).groupBy(shopOrderTable.status),
    pageQuery.where(refined).orderBy(desc(shopOrderTable.created_at), desc(shopOrderTable.id))
      .limit(ORDER_PAGE_SIZE).offset((filters.page - 1) * ORDER_PAGE_SIZE),
  ]);
  return {
    statusCounts: Object.fromEntries(badges.map((row) => [row.status, row.count])),
    total: badges.reduce((total, row) => total + row.refinedCount, 0),
    pageRows,
  };
}
