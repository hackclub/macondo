import { beforeAll, describe, expect, mock, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { projectTable, shopItemTable, shopOrderTable, users } from "../../db/schema";

const dialect = new PgDialect();
const compile = (query: SQL) => dialect.sqlToQuery(query);
const actor = (roles: string[], id = "staff") => ({ id, roles }) as typeof users.$inferSelect;

// No connection or DB writes: a query-builder double captures projections and filters.
const calls: Array<{ table: unknown; projection: Record<string, unknown>; filter?: SQL; ordering?: SQL[]; limit?: number }> = [];
const rows = new Map<unknown, Array<Record<string, unknown>>>();
const redBuyers = new Set<string>();
let ignoreOwnership = false;
mock.module("../../db", () => ({ default: {
  select(projection: Record<string, unknown>) {
    const call = { projection } as typeof calls[number];
    const builder = {
      from(table: unknown) { call.table = table; calls.push(call); return builder; },
      leftJoin() { return builder; },
      where(filter: SQL) { call.filter = filter; return builder; },
      orderBy(...ordering: SQL[]) { call.ordering = ordering; return builder; },
      limit(limit: number) { call.limit = limit; return Promise.resolve(rows.get(call.table) ?? []); },
    };
    return builder;
  },
} }));
mock.module("../hackatime", () => ({ getBannedUserIds: async () => redBuyers }));
mock.module("../shop", () => ({ GOLD_PER_HOUR: 10 }));
mock.module("../dev-debug-flags", () => ({ getDevDebugFlags: () => ({ ignoreReviewerOwnershipPolicies: ignoreOwnership }) }));
Object.assign(globalThis, {
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: { query: unknown }) => event.query,
});
let handler: (event: unknown) => Promise<{ results: Array<{ id: string; type: string }> }>;
beforeAll(async () => {
  handler = (await import("../../api/internal/search.get")).default as unknown as typeof handler;
});

async function search(roles: string[], q: string) {
  calls.length = 0;
  return handler({ context: { user: actor(roles) }, query: { q } });
}

describe("internal search handler", () => {
  test("empty queries and support-only actors do not fetch entities", async () => {
    expect((await search(["supaadmin"], "")).results).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await search(["support"], "test")).results).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("every entity query filters before its bounded limit and users never select tokens", async () => {
    rows.clear();
    await search(["supaadmin"], "widget");
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.filter).toBeDefined();
      expect(call.limit).toBe(100);
      expect(compile(call.filter!).params).toContain("%widget%");
    }
    const projection = calls.find((call) => call.table === users)!.projection;
    expect(Object.keys(projection).sort()).toEqual(["createdAt", "email", "hackatime_id", "id", "image", "last_seen_at", "name", "slack_id", "updatedAt", "username"].sort());
    expect(calls.find((call) => call.table === shopItemTable)!.projection).not.toHaveProperty("attachment_urls");
  });

  test("PII is excluded from projections and SQL for fraudsters; current roles are not cached", async () => {
    await search(["admin"], "private@example.com");
    expect(compile(calls.find((call) => call.table === users)!.filter!).sql).toContain('"users"."email"');
    await search(["fraudster"], "private@example.com");
    const call = calls.find((call) => call.table === users)!;
    expect(compile(call.filter!).sql).not.toContain('"users"."email"');
    expect(compile(call.projection.email as SQL).sql).toBe("''");
    await search(["support"], "private@example.com");
    expect(calls).toHaveLength(0);
  });

  test("dev ownership changes are evaluated each request without widening type scope", async () => {
    ignoreOwnership = false;
    await search(["hardware_reviewer"], "widget");
    expect(compile(calls.find((call) => call.table === projectTable)!.filter!).params).toContain("staff");
    ignoreOwnership = true;
    await search(["hardware_reviewer"], "widget");
    const params = compile(calls.find((call) => call.table === projectTable)!.filter!).params;
    expect(params).not.toContain("staff");
    expect(params).toContain("hardware");
    ignoreOwnership = false;
  });

  test("existing UUID user IDs reach MiniSearch without scanning other entities", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    rows.clear();
    rows.set(users, [{
      id: uuid, name: "Old Maker", username: "maker", email: "maker@example.com",
      last_seen_at: new Date(2000, 0, 1),
    }]);
    try {
      for (const input of [uuid, `user ${uuid}`, `user:${uuid}`]) {
        const result = await search(["supaadmin"], input);
        expect(result.results.map(({ id, type }) => ({ id, type }))).toEqual([{ id: uuid, type: "user" }]);
        expect(calls).toHaveLength(5);
        const userCall = calls.find((call) => call.table === users)!;
        expect(compile(userCall.filter!).sql).toBe('"users"."id" = $1');
        expect(compile(userCall.filter!).params).toEqual([uuid]);
        expect(compile(userCall.ordering![0]!).params).toEqual([uuid]);
        for (const call of calls.filter((call) => call.table !== users)) {
          expect(compile(call.filter!).sql).toBe("false");
          expect(compile(call.filter!).params).toEqual([]);
        }
      }
    } finally {
      rows.clear();
    }
  });

  test("older exact IDs reach MiniSearch and hidden fulfiller orders never reach results", async () => {
    rows.clear();
    rows.set(shopOrderTable, [
      { id: 123, status: "pending_internal_fulfillment", provider: "internal", user_id: "red", snapshot_name: "Widget", created_at: new Date(2000, 0, 1) },
      { id: 124, status: "shipped", provider: "theseus", user_id: "buyer", snapshot_name: "Widget" },
      { id: 125, status: "shipped", provider: "internal", user_id: "red", snapshot_name: "Widget" },
    ]);
    redBuyers.add("red");
    expect((await search(["fulfiller"], "Widget")).results.map((result) => result.id)).toEqual(["125"]);
    rows.set(shopOrderTable, [rows.get(shopOrderTable)![0]!]);
    expect((await search(["fulfiller"], "order 123")).results).toEqual([]);
    const result = await search(["hq"], "order 123");
    expect(result.results.map((entry) => entry.id)).toEqual(["123"]);
    expect(compile(calls.find((call) => call.table === shopOrderTable)!.filter!).params).toEqual([123]);
    rows.clear();
    redBuyers.clear();
  });
});
