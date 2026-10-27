import { beforeAll, describe, expect, mock, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { currencyTransactionTable, shadowBanTable, shipTable, shopOrderTable } from "../../db/schema";
import type { users } from "../../db/schema";

const calls: Array<{ table?: unknown; projection: Record<string, unknown>; filter?: SQL; limit?: number; joins: unknown[] }> = [];
const bannedCalls: string[][] = [];
const candidates = [
  { id: 1, user_id: "red", status: "pending_internal_fulfillment", provider: "internal", slug: null },
  { id: 2, user_id: "red", status: "shipped", provider: null, slug: null },
  { id: 3, user_id: "reviewer", status: "pending_internal_fulfillment", provider: "internal", slug: null },
  { id: 4, user_id: "hidden", status: "shipped", provider: "theseus", slug: null },
  { id: 5, user_id: "cancelled", status: "cancelled", provider: "internal", slug: null },
  { id: 6, user_id: "unproven", status: "pending_internal_fulfillment", provider: "internal", slug: null },
  { id: 7, user_id: "shadow", status: "pending_internal_fulfillment", provider: "internal", slug: null },
];

mock.module("../../db", () => ({ default: {
  select: select,
  selectDistinct: select,
} }));
function select(projection: Record<string, unknown>) {
  const call: typeof calls[number] = { projection, joins: [] };
  calls.push(call);
  const builder = {
    from(table: unknown) { call.table = table; return builder; },
    $dynamic() { return builder; },
    leftJoin(table: unknown) { call.joins.push(table); return builder; },
    where(filter?: SQL) { call.filter = filter; return builder; },
    groupBy() { return builder; },
    orderBy() { return builder; },
    limit(limit: number) { call.limit = limit; return builder; },
    offset() { return builder; },
    then(resolve: (rows: unknown) => unknown) {
      let rows: unknown[] = [];
      if (call.table === shopOrderTable) {
        if ("slug" in projection) rows = candidates;
        else if ("status" in projection) rows = [{ status: "shipped", count: 7, refinedCount: 1 }];
        else if ("id" in projection) rows = [{ id: 3, user_id: "reviewer" }];
        // Full-row hydration deliberately returns no rows; no HCB/network calls.
      } else if (call.table === currencyTransactionTable) rows = [{ user_id: "reviewer" }];
      else if (call.table === shadowBanTable) rows = [{ user_id: "shadow" }];
      else if (call.table === shipTable) rows = [{ id: 1, user_id: "shadow", status: "shipped" }];
      return Promise.resolve(rows).then(resolve);
    },
  };
  return builder;
}
mock.module("../hackatime", () => ({
  getBannedUserIds: async (ids: string[]) => { bannedCalls.push(ids); return new Set(["red"]); },
}));
mock.module("../shop", () => ({
  TRAVEL_STIPEND_SLUG: "travel_stipend",
  fetchHcbGrantInfoForOrder: () => { throw new Error("Unexpected HCB call"); },
  formatShopOrderForResponse: () => { throw new Error("Unexpected formatting call"); },
  getOrderItemSnapshot: () => null,
  hcbGrantFetchErrorInfo: () => null,
  normalizeShippingAddress: () => null,
}));
Object.assign(globalThis, {
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: { query: unknown }) => event.query,
  createError: (error: unknown) => error,
});
let handler: (event: unknown) => Promise<{ total: number; status_counts: Record<string, number> }>;
beforeAll(async () => {
  handler = (await import("../../api/internal/shop/orders.get")).default as unknown as typeof handler;
});
async function list(roles: string[], query: Record<string, unknown> = {}) {
  calls.length = 0;
  bannedCalls.length = 0;
  return handler({ context: { user: { roles } as typeof users.$inferSelect }, query });
}
const params = (call: typeof calls[number]) => new PgDialect().sqlToQuery(call.filter!).params;
const buyerCalls = () => calls.filter((call) => [shipTable, shadowBanTable, currencyTransactionTable].includes(call.table as typeof shipTable));

describe("orders endpoint listing paths", () => {
  test("full-view path never loads candidates and only loads page buyer state", async () => {
    for (const roles of [["hq"], ["supaadmin"]]) {
      expect(await list(roles)).toMatchObject({ total: 1, status_counts: { shipped: 7 } });
      expect(calls.some((call) => "slug" in call.projection)).toBe(false);
      expect(calls.find((call) => "id" in call.projection && call.table === shopOrderTable)?.limit).toBe(25);
      expect(bannedCalls).toEqual([["reviewer"]]);
      for (const call of buyerCalls()) expect(params(call)[0]).toBe("reviewer");
    }
  });

  test("restricted visibility uses banned only; expensive buyer state is page-scoped", async () => {
    const result = await list(["fulfiller"], { statuses: "shipped" });
    expect(result).toMatchObject({ total: 1, status_counts: { shipped: 1, pending_internal_fulfillment: 3 } });
    expect(calls.some((call) => "slug" in call.projection)).toBe(true);
    expect(calls.some((call) => "count" in call.projection)).toBe(false);
    expect(bannedCalls).toEqual([["red", "reviewer", "hidden", "cancelled", "unproven", "shadow"]]);
    for (const call of buyerCalls()) expect(params(call)[0]).toBe("red");
  });

  test("fallback candidates omit joins without search and retain both joins with search", async () => {
    for (const roles of [["fulfiller"], ["hq"]]) {
      for (const q of [undefined, "   ", "widget"]) {
        await list(roles, { q, fulfillable_only: "1" });
        const candidateCall = calls.find((call) => "slug" in call.projection)!;
        expect(candidateCall.joins).toHaveLength(q === "widget" ? 2 : 0);
        if (q === "widget") expect(params(candidateCall)).toEqual(Array(9).fill("%widget%"));
        else expect(candidateCall.filter).toBeUndefined();
      }
    }
  });

  test("fulfillable-only stays on fallback with reviewer/red/shadow/unproven policy intact", async () => {
    for (const roles of [["hq"], ["fulfiller"]]) {
      const result = await list(roles, { fulfillable_only: "1", statuses: "pending_internal_fulfillment" });
      expect(result.total).toBe(1);
      expect(result.status_counts.pending_internal_fulfillment).toBe(roles[0] === "hq" ? 4 : 3);
      expect(calls.some((call) => "slug" in call.projection)).toBe(true);
      expect(calls.some((call) => "count" in call.projection)).toBe(false);
      expect(bannedCalls).toHaveLength(1);
    }
  });
});
