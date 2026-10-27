import { isolatedHandlerTests } from "./test-fixtures/isolated-handler-tests";
import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { projectTable, shopOrderTable, users } from "../db/schema";
import {
  canSearchOrder, canSearchUser, escapeSearchTerm, exactSearchPriority,
  parseExactSearchId, reviewSearchConditions, searchCandidateFilter, searchPermissions,
} from "./internal-search";

const dialect = new PgDialect();
const compile = (query: SQL) => dialect.sqlToQuery(query);
const actor = (roles: string[], id = "staff") => ({ id, roles }) as typeof users.$inferSelect;

describe("internal search SQL helpers", () => {
  test("escapes wildcard and escape characters without interpolating input", () => {
    const input = "50%_\\' OR 1=1 --";
    expect(escapeSearchTerm(input)).toBe("50\\%\\_\\\\' OR 1=1 --");
    const query = compile(searchCandidateFilter(input, "user", users.id, [users.name]));
    expect(query.sql).not.toContain(input);
    expect(query.sql).toContain("ILIKE $");
    expect(query.sql).toContain("ESCAPE E'\\\\'");
    expect(query.params).toEqual([input, "%50\\%\\_\\\\'%", "%OR%", "%1=1%", "%--%"]);
  });

  test("searches multiple terms across fields with OR for ranking fallback", () => {
    const query = compile(searchCandidateFilter("old widget", "project", projectTable.id, [projectTable.name, projectTable.description]));
    expect(query.params).toEqual(["old widget", "%old%", "%old%", "%widget%", "%widget%"]);
    expect(query.sql).toContain(" or ");
  });

  test("parses exact numeric entity IDs, not embedded numbers or overflow", () => {
    for (const input of ["123", "#123", " #00123 "]) expect(parseExactSearchId(input)).toEqual({ id: 123 });
    for (const [input, entity] of [["order 123", "order"], ["Order #123", "order"], ["project:123", "project"], ["ship #123", "ship"], ["shop item 123", "shop_item"], ["item #123", "shop_item"]]) {
      expect(parseExactSearchId(input!)).toEqual({ entity, id: 123 });
    }
    for (const input of ["board 123", "order 123 extra", "#0", "-1", "1.5", "2147483648", "9007199254740993"]) expect(parseExactSearchId(input)).toBeNull();
  });

  test("UUID user IDs parse and bind primary-key equality without casts or text scans", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    for (const input of [uuid, ` user ${uuid} `, `user:${uuid}`, `USER: ${uuid}`]) {
      expect(parseExactSearchId(input)).toEqual({ entity: "user", id: uuid });
      const query = compile(searchCandidateFilter(input, "user", users.id, [users.id, users.name, users.email]));
      expect(query.sql).toBe('"users"."id" = $1');
      expect(query.params).toEqual([uuid]);
      expect(compile(exactSearchPriority(input, "user", users.id)).params).toEqual([uuid]);
      for (const entity of ["project", "ship", "shop_item", "order"] as const) {
        const excluded = compile(searchCandidateFilter(input, entity, projectTable.id, [projectTable.name]));
        expect(excluded.sql).toBe("false");
        expect(excluded.params).toEqual([]);
        expect(compile(exactSearchPriority(input, entity, projectTable.id)).params).toEqual([]);
      }
    }
    expect(parseExactSearchId(uuid.toUpperCase())).toEqual({ entity: "user", id: uuid.toUpperCase() });
  });

  test("other user identifiers and malformed UUIDs retain substring matching", () => {
    for (const input of ["old-user-id", "U12345678", "maker@example.com", "@maker", "user:maker", "550e8400-e29b-41d4-a716", "550e8400-e29b-41d4-a716-44665544000z", "user 550e8400-e29b-41d4-a716-446655440000 extra"]) {
      expect(parseExactSearchId(input)).toBeNull();
      const query = compile(searchCandidateFilter(input, "user", users.id, [users.username]));
      expect(query.sql).toContain("ILIKE");
      expect(query.params).toEqual([input, ...input.split(/\s+/).map((term) => `%${escapeSearchTerm(term)}%`)]);
      expect(compile(exactSearchPriority(input, "user", users.id)).params).toEqual([input]);
    }
  });

  test("exact IDs use bound equality and cannot select a different entity", () => {
    const query = compile(searchCandidateFilter("order #123", "order", shopOrderTable.id, [users.name]));
    expect(query.params).toEqual([123]);
    expect(query.sql).not.toContain("ILIKE");
    expect(compile(searchCandidateFilter("order 123", "project", projectTable.id, [])).sql).toBe("false");
    expect(compile(exactSearchPriority("#123", "order", shopOrderTable.id)).params).toEqual([123]);
    expect(compile(exactSearchPriority("old-user-id", "user", users.id)).params).toEqual(["old-user-id"]);
    expect(compile(exactSearchPriority("widget", "project", projectTable.id)).sql).toBe("case when false then 0 else 1 end");
  });
});

describe("internal search permissions", () => {
  test("permissions are recomputed including PII and dev ownership", () => {
    const staff = actor(["admin"]);
    expect(searchPermissions(staff)).toMatchObject({ users: true, review: true, pii: true, reviewOwn: false, orders: false });
    staff.roles = ["fraudster"];
    expect(searchPermissions(staff)).toMatchObject({ pii: false, reviewOwn: false });
    expect(searchPermissions(staff, true).reviewOwn).toBe(true);
    staff.roles = ["support"];
    expect(searchPermissions(staff)).toMatchObject({ users: false, review: false, orders: false, shop: false });
  });

  test("retains canViewUser self restriction", () => {
    expect(canSearchUser(actor(["admin"]), { id: "staff" })).toBe(false);
    expect(canSearchUser(actor(["admin"]), { id: "other" })).toBe(true);
    expect(canSearchUser(actor(["supaadmin"]), { id: "staff" })).toBe(true);
    expect(canSearchUser(actor(["fulfiller"]), { id: "other" })).toBe(false);
  });

  test("review type and ownership filters stay bound; dev bypass only removes ownership", () => {
    const reviewer = actor(["software_reviewer"]);
    const restricted = compile(reviewSearchConditions(reviewer, false, "project")!);
    expect(restricted.params).toEqual(["software", "staff"]);
    expect(restricted.sql).toContain('"projects"."user_id" is null');
    expect(compile(reviewSearchConditions(reviewer, true, "project")!).params).toEqual(["software"]);
    expect(compile(reviewSearchConditions(reviewer, false, "ship")!).params).toEqual(["software", "staff"]);
    expect(compile(reviewSearchConditions(actor(["support"]), true, "ship")!).sql).toBe("false");
  });

  test("fulfillers only see actionable orders according to shop policy", () => {
    const fulfiller = actor(["fulfiller"]);
    expect(canSearchOrder(fulfiller, { status: "shipped", provider: "internal" }, true)).toBe(true);
    expect(canSearchOrder(fulfiller, { status: "shipped", provider: "theseus" }, false)).toBe(false);
    expect(canSearchOrder(fulfiller, { status: "pending_internal_fulfillment", provider: null }, false)).toBe(true);
    expect(canSearchOrder(fulfiller, { status: "pending_internal_fulfillment", provider: "internal" }, true)).toBe(false);
    expect(canSearchOrder(fulfiller, { status: "cancelled", provider: "internal" }, false)).toBe(false);
    expect(canSearchOrder(actor(["hq"]), { status: "cancelled", provider: "theseus" }, true)).toBe(true);
    expect(canSearchOrder(actor(["support"]), { status: "shipped", provider: null }, false)).toBe(false);
  });
});

await isolatedHandlerTests(
  import.meta.url,
  new URL("./test-fixtures/internal-search-handler.ts", import.meta.url).href,
  "internal search handler",
  [
    "empty queries and support-only actors do not fetch entities",
    "every entity query filters before its bounded limit and users never select tokens",
    "PII is excluded from projections and SQL for fraudsters; current roles are not cached",
    "dev ownership changes are evaluated each request without widening type scope",
    "older exact IDs reach MiniSearch and hidden fulfiller orders never reach results",
    "existing UUID user IDs reach MiniSearch without scanning other entities",
  ],
);
