import { beforeAll, describe, expect, mock, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { projectTable, shipTable, users } from "../../db/schema";

const calls: Array<{
  table?: unknown; projection: Record<string, unknown>; filter?: SQL;
  limit?: number; offset?: number; order?: SQL[];
}> = [];
const started: string[] = [];
let empty = false;
const date = new Date("2026-01-01");
const rows = ["self", "green", "unknown"].map((id) => ({
  id, name: id, email: `${id}@example.com`, image: null, slack_id: id,
  username: id, hackatime_id: null, roles: [], createdAt: date, last_seen_at: null,
}));
mock.module("../../db", () => ({ default: { select(projection: Record<string, unknown>) {
  const call: typeof calls[number] = { projection };
  calls.push(call);
  const builder = {
    from(table: unknown) { call.table = table; return builder; },
    where(filter?: SQL) { call.filter = filter; return builder; },
    orderBy(...order: SQL[]) { call.order = order; return builder; },
    limit(limit: number) { call.limit = limit; return builder; },
    offset(offset: number) { call.offset = offset; return builder; },
    groupBy() { return builder; },
    leftJoin() { return builder; },
    then(resolve: (value: unknown[]) => unknown) {
      const kind = call.table === users ? ("total" in projection ? "count" : "rows")
        : call.table === projectTable ? "projects" : call.table === shipTable ? "ships" : "shadow";
      started.push(kind);
      // These checks fail if the handler serializes count/rows or related reads behind trust.
      return Promise.resolve().then(() => {
        if (kind === "count") expect(started).toContain("rows");
        if (kind === "ships") expect(started).toContain("trust");
        if (kind === "count") return [{ total: empty ? 0 : 99 }];
        if (empty) return [];
        if (kind === "rows") return rows;
        if (kind === "shadow") return [{ user_id: "green", count: 2 }];
        if (kind === "projects") return [
          { id: 1, user_id: "green", name: "old", created_at: null },
          { id: 2, user_id: "green", name: "new", created_at: date },
        ];
        return [
          { id: 1, user_id: "self", status: "rejected", created_at: date, project_name: null },
          { id: 2, user_id: "green", status: "pending", created_at: null, project_name: null },
          { id: 3, user_id: "green", status: "shipped", created_at: date, project_name: "new" },
        ];
      }).then(resolve);
    },
  };
  return builder;
} } }));
const trustCalls: string[][] = [];
mock.module("../hackatime", () => ({ getTrustLevelsForUsers: async (ids: string[]) => {
  started.push("trust");
  trustCalls.push(ids);
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (ids.length) {
    for (const kind of ["shadow", "ships"]) expect(started).toContain(kind);
    if (calls.some((call) => call.table === projectTable)) expect(started).toContain("projects");
  }
  return new Map([["self", "Red"], ["green", " green "], ["unknown", "unexpected"]]);
} }));
Object.assign(globalThis, {
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: { query: unknown }) => event.query,
});
let handler: (event: unknown) => Promise<{
  users: Array<{
    id: string; canImpersonate: boolean; projects: Array<{ id: number }>;
    ships: Array<{ id: number }>;
  }>; total: number; page: number; limit: number;
}>;
beforeAll(async () => {
  handler = (await import("../../api/internal/users/index.get")).default as unknown as typeof handler;
});
async function list(roles = ["admin"], query: Record<string, unknown> = {}, noRows = false) {
  calls.length = 0;
  started.length = 0;
  trustCalls.length = 0;
  empty = noRows;
  return handler({ context: { user: { id: "self", roles } }, query });
}
const params = (call: typeof calls[number]) => new PgDialect().sqlToQuery(call.filter!).params;

describe("internal users listing", () => {
  test("single ship read, parallel phases, pre-visibility totals and unchanged hydration", async () => {
    const result = await list();
    expect(result).toMatchObject({ total: 99, page: 1, limit: 12 });
    expect(result.users.map((u) => u.id)).toEqual(["green", "unknown"]);
    expect(result.users[0]).toMatchObject({ totalShips: 2, projectCount: 2, isShadowBanned: true,
      trustFactor: "Green", canImpersonate: true, email: "green@example.com" });
    expect(result.users[0]!.projects.map((p: { id: number }) => p.id)).toEqual([2, 1]);
    expect(result.users[0]!.ships.map((s: { id: number }) => s.id)).toEqual([3, 2]);
    expect(result.users[1]).toMatchObject({ totalShips: 0, trustFactor: "Yellow", ships: [], projects: [] });
    expect(trustCalls).toEqual([["self", "green", "unknown"]]);
    const shipCalls = calls.filter((c) => c.table === shipTable);
    expect(shipCalls).toHaveLength(1);
    expect(params(shipCalls[0]!)).toEqual(["self", "green", "unknown"]);
    expect(params(calls.find((c) => c.table === projectTable)!)).toEqual(["green", "unknown"]);
    const rowCall = calls.find((c) => c.table === users && "id" in c.projection)!;
    expect(rowCall.projection).not.toHaveProperty("hackatime_oauth_token");
    expect(rowCall.order!.map((order) => new PgDialect().sqlToQuery(order).sql))
      .toEqual(['"users"."created_at" desc', '"users"."id" asc']);
  });

  test("PII search/output and impersonation remain role gated", async () => {
    const result = await list(["fraudster"], { search: "test" });
    expect(result.users.every((u) => !("email" in u) && !u.canImpersonate)).toBe(true);
    const filter = calls.find((c) => c.table === users)!.filter!;
    expect(new PgDialect().sqlToQuery(filter).sql).not.toContain('"email"');
    await list(["admin"], { search: "test" });
    expect(new PgDialect().sqlToQuery(calls.find((c) => c.table === users)!.filter!).sql).toContain('"email"');
    expect((await list(["support"])).users).toEqual([]);
  });

  test("supaadmin sees self, but cannot impersonate self", async () => {
    const result = await list(["supaadmin"]);
    expect(result.users[0]).toMatchObject({ id: "self", totalShips: 1, canImpersonate: false });
  });

  test("trust filter retains capped scan, visible total and in-memory pagination", async () => {
    const result = await list(["admin"], { trustFactor: " yellow ", page: "2", limit: "1" });
    expect(result).toMatchObject({ total: 1, page: 2, limit: 1, users: [] });
    const rowCall = calls.find((c) => c.table === users && "id" in c.projection)!;
    expect(rowCall.limit).toBe(500);
    expect(rowCall.offset).toBeUndefined();
    expect(rowCall.order).toHaveLength(2);
    expect((await list(["admin"], { trustFactor: "invalid" })).total).toBe(99);
  });

  test("invalid pagination is finite and positive; ordinary pagination and limit cap survive", async () => {
    for (const value of ["NaN", "Infinity", "", "0", "-2", "9".repeat(400)]) {
      expect(await list(["admin"], { page: value, limit: value })).toMatchObject({ page: 1, limit: 12 });
    }
    expect(await list(["admin"], { page: "3", limit: "100" })).toMatchObject({ page: 3, limit: 50 });
    expect(calls.find((c) => c.table === users && "id" in c.projection)!.offset).toBe(100);
  });

  test("empty results skip related SQL", async () => {
    expect(await list(["admin"], {}, true)).toMatchObject({ total: 0, users: [] });
    expect(calls).toHaveLength(2);
    expect(trustCalls).toEqual([[]]);
  });
});
