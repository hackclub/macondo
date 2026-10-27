import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { SQL } from "drizzle-orm";
import type db from "../db";
import { shopOrderTable } from "../db/schema";
import {
  loadOrderListSqlPage,
  orderListRefinementFilter,
  orderListSearchFilter,
  orderListStatusCounts,
  parseOrderListFilters,
  refineOrderListCandidates,
} from "./internal-order-list";
import type { OrderListCandidate } from "./internal-order-list";

const compile = (query: SQL) => new PgDialect().sqlToQuery(query);
const travelSlug = "travel_stipend";
const fixtures: OrderListCandidate[] = [
  { id: 1, user_id: "a", status: "shipped", provider: null, slug: null },
  { id: 2, user_id: "b", status: "shipped", provider: "theseus", slug: travelSlug },
  { id: 3, user_id: "c", status: "pending_internal_fulfillment", provider: "internal", slug: travelSlug },
  { id: 4, user_id: "d", status: "cancelled", provider: "hcb", slug: null },
];

describe("internal order listing filters", () => {
  test("parsing retains exact flags, valid statuses, trimmed search and page behavior", () => {
    expect(parseOrderListFilters({ q: "  widget  ", page: "2abc", statuses: "shipped,invalid, shipped,shipped", provider: "hcb", hide_theseus: "1", travel_stipends: "1", fulfillable_only: "1" })).toEqual({
      q: "widget", page: 2, statuses: ["shipped", "shipped"], provider: "hcb", hideTheseus: true, travelStipends: true, fulfillableOnly: true,
    });
    for (const page of ["-2", "0", "nope", undefined]) {
      expect(parseOrderListFilters({ page }).page).toBe(1);
    }
    expect(parseOrderListFilters({ q: [], statuses: [], provider: "bogus", hide_theseus: 1, fulfillable_only: true })).toMatchObject({
      q: "", statuses: [], provider: null, hideTheseus: false, fulfillableOnly: false,
    });
  });

  test("search preserves all nine fields and literal wildcard escaping", () => {
    expect(orderListSearchFilter("")).toBeUndefined();
    const query = compile(orderListSearchFilter("50%_\\' OR 1=1")!);
    expect(query.params).toEqual(Array(9).fill("%50\\%\\_\\\\' OR 1=1%"));
    for (const column of ["name", "email", "hcb_email", "slack_id", "username", "hackatime_id", "external_reference", "id"]) {
      expect(query.sql).toContain(`"${column}"`);
    }
    expect(query.sql).toContain('"shop_items"."name"');
    expect(query.sql).not.toContain("item_snapshot");
    expect(query.sql).not.toContain("1=1");
  });

  test("snapshot-only provider/slug matching preserves nulls and hide-theseus conflicts", () => {
    const ids = (query: Record<string, unknown>) => refineOrderListCandidates(fixtures, parseOrderListFilters(query), travelSlug).map((row) => row.id);
    expect(ids({})).toEqual([1, 2, 3, 4]);
    expect(ids({ hide_theseus: "1" })).toEqual([1, 3, 4]);
    expect(ids({ provider: "internal" })).toEqual([3]);
    expect(ids({ provider: "theseus", hide_theseus: "1" })).toEqual([]);
    expect(ids({ travel_stipends: "1" })).toEqual([2, 3]);
    expect(ids({ statuses: "shipped", travel_stipends: "1" })).toEqual([2]);
    expect(ids({ statuses: "shipped", provider: "hcb" })).toEqual([]);
    const query = compile(orderListRefinementFilter(parseOrderListFilters({ provider: "internal", hide_theseus: "1", travel_stipends: "1", statuses: "shipped" }), travelSlug)!);
    expect(query.sql).toContain("->>'fulfillment_provider'");
    expect(query.sql).toContain("->>'slug'");
    expect(query.sql).toContain("IS DISTINCT FROM");
    expect(query.sql).not.toContain("shop_items");
    expect(query.sql).not.toContain("coalesce");
    expect(query.params).toEqual(["shipped", "internal", "theseus", travelSlug]);
    expect(orderListRefinementFilter(parseOrderListFilters({}), travelSlug)).toBeUndefined();
  });

  test("fallback tab counts are sparse and computed before refinement", () => {
    const counts = orderListStatusCounts(fixtures);
    expect(counts).toEqual({ shipped: 2, pending_internal_fulfillment: 1, cancelled: 1 });
    expect(refineOrderListCandidates(fixtures, parseOrderListFilters({ provider: "internal" }), travelSlug)).toHaveLength(1);
    expect(counts.shipped).toBe(2);
    expect(orderListStatusCounts([])).toEqual({});
  });
});

function databaseDouble(badges = [{ status: "shipped", count: 2, refinedCount: 1 }], pageRows = [{ id: 3, user_id: "c" }]) {
  const calls: Array<{
    projection: Record<string, unknown>; joins: unknown[]; filter?: SQL;
    group?: unknown; order?: SQL[]; limit?: number; offset?: number;
  }> = [];
  const database = {
    select(projection: Record<string, unknown>) {
      const call: typeof calls[number] = { projection, joins: [] };
      calls.push(call);
      const builder = {
        from(table: unknown) { expect(table).toBe(shopOrderTable); return builder; },
        $dynamic() { return builder; },
        leftJoin(table: unknown) { call.joins.push(table); return builder; },
        where(filter?: SQL) { call.filter = filter; return builder; },
        groupBy(column: unknown) { call.group = column; return builder; },
        orderBy(...order: SQL[]) { call.order = order; return builder; },
        limit(limit: number) { call.limit = limit; return builder; },
        offset(offset: number) { call.offset = offset; return builder; },
        then(resolve: (rows: unknown) => unknown) {
          return Promise.resolve(call.group ? badges : pageRows).then(resolve);
        },
      };
      return builder;
    },
  } as unknown as typeof db;
  return { database, calls };
}

describe("SQL paginated full-view listing", () => {
  test("real Drizzle builders emit aggregates and LIMIT/OFFSET without full-row scans", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: sql.includes("group by") ? [["shipped", "100", "75"]]
        : [[3, "c"]] };
    });
    const result = await loadOrderListSqlPage(database as unknown as typeof db, parseOrderListFilters({ hide_theseus: "1", page: "2" }), travelSlug);
    expect(result).toEqual({ statusCounts: { shipped: 100 }, total: 75, pageRows: [{ id: 3, user_id: "c" }] });
    expect(queries).toHaveLength(2);
    expect(queries[0]!.sql).toContain('count(*)');
    expect(queries[0]!.sql).toContain('group by "shop_orders"."status"');
    expect(queries[0]!.sql).toContain("FILTER (WHERE");
    expect(queries[0]!.sql).toContain("IS DISTINCT FROM");
    expect(queries[0]!.sql).not.toContain(" where ");
    expect(queries[0]!.params).toEqual(["theseus"]);
    expect(queries[1]!.sql).toContain('select "id", "user_id"');
    expect(queries[1]!.sql).toContain('order by "shop_orders"."created_at" desc, "shop_orders"."id" desc');
    expect(queries[1]!.sql).toContain("limit $");
    expect(queries[1]!.sql).toContain("offset $");
    expect(queries[1]!.params).toEqual(["theseus", 25, 25]);
    for (const query of queries) expect(query.sql).not.toContain("join");
  });

  test("badges use search only; count/page use refinements with bounded stable pagination", async () => {
    const { database, calls } = databaseDouble();
    const result = await loadOrderListSqlPage(database, parseOrderListFilters({ q: "widget", statuses: "cancelled", provider: "hcb", hide_theseus: "1", travel_stipends: "1", page: "3" }), travelSlug);
    expect(result).toEqual({ statusCounts: { shipped: 2 }, total: 1, pageRows: [{ id: 3, user_id: "c" }] });
    expect(calls).toHaveLength(2);
    const [badges, page] = calls;
    expect(compile(badges!.filter!).params).toEqual(Array(9).fill("%widget%"));
    expect(badges!.group).toBe(shopOrderTable.status);
    const filteredCount = compile(badges!.projection.refinedCount as SQL);
    expect(filteredCount.sql).toContain("count(*) FILTER (WHERE");
    expect(filteredCount.params).toEqual(["cancelled", "hcb", "theseus", travelSlug]);
    expect(compile(page!.filter!).params).toEqual([...Array(9).fill("%widget%"), ...filteredCount.params]);
    expect(page!.limit).toBe(25);
    expect(page!.offset).toBe(50);
    expect(page!.order!.map((order) => compile(order).sql)).toEqual(['"shop_orders"."created_at" desc', '"shop_orders"."id" desc']);
    expect(Object.keys(page!.projection)).toEqual(["id", "user_id"]);
    for (const call of calls) expect(call.joins).toHaveLength(2);
  });

  test("grouped totals sum numeric filtered counts without dropping zero-match badge groups", async () => {
    const queries: string[] = [];
    const database = drizzle(async (sql) => {
      queries.push(sql);
      return { rows: sql.includes("group by")
        ? [["shipped", "2", "0"], ["pending_internal_fulfillment", "3", "2"], ["cancelled", "4", "1"]]
        : [] };
    });
    expect(await loadOrderListSqlPage(database as unknown as typeof db, parseOrderListFilters({ provider: "internal" }), travelSlug)).toEqual({
      statusCounts: { shipped: 2, pending_internal_fulfillment: 3, cancelled: 4 }, total: 3, pageRows: [],
    });
    expect(queries).toHaveLength(2);
    const zeroMatches = databaseDouble([{ status: "shipped", count: 2, refinedCount: 0 }], []);
    expect(await loadOrderListSqlPage(zeroMatches.database, parseOrderListFilters({ provider: "theseus", hide_theseus: "1" }), travelSlug)).toEqual({
      statusCounts: { shipped: 2 }, total: 0, pageRows: [],
    });
  });

  test("no-search listings omit joins; empty/out-of-range pages retain total and badges", async () => {
    const { database, calls } = databaseDouble([], []);
    expect(await loadOrderListSqlPage(database, parseOrderListFilters({ page: "99" }), travelSlug)).toEqual({ statusCounts: {}, total: 0, pageRows: [] });
    for (const call of calls) {
      expect(call.joins).toEqual([]);
      expect(call.filter).toBeUndefined();
    }
    expect(compile(calls[0]!.projection.refinedCount as SQL)).toMatchObject({ sql: "count(*) FILTER (WHERE true)", params: [] });
    expect(calls[1]!.offset).toBe(2450);
    const outOfRange = databaseDouble([{ status: "shipped", count: 100, refinedCount: 100 }], []);
    expect(await loadOrderListSqlPage(outOfRange.database, parseOrderListFilters({ page: "99" }), travelSlug)).toMatchObject({ total: 100, statusCounts: { shipped: 100 }, pageRows: [] });
  });
});
