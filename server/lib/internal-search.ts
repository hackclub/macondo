import { and, eq, ne, or, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { projectTable, shipTable } from "../db/schema";
import type { users } from "../db/schema";
import {
  canAccessInternalOrders, canAccessInternalReview, canAccessInternalShopAdmin,
  canAccessInternalUsers, canReviewOwnProjects, canViewAllOrders, canViewUser,
  getReviewableProjectTypes, isAbleToHandlePII,
} from "../policies/internal";
import { isOrderVisibleToFulfiller } from "../policies/shop";

type Actor = typeof users.$inferSelect;
export type SearchEntity = "user" | "project" | "ship" | "shop_item" | "order";

export function escapeSearchTerm(term: string) {
  return term.replace(/[\\%_]/g, "\\$&");
}

// Anchored parsing avoids treating numbers in names (e.g. "board 123") as IDs.
export function parseExactSearchId(search: string):
  | { entity: "user"; id: string }
  | { entity?: Exclude<SearchEntity, "user">; id: number }
  | null {
  const uuid = /^(?:user(?:\s+|:\s*))?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(search.trim());
  if (uuid) return { entity: "user", id: uuid[1]! };
  const match = /^(?:(project|ship|order|shop\s+item|item)[\s:#]+)?#?(\d+)$/i.exec(search.trim());
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return null;
  const label = match[1]?.toLowerCase().replace(/\s+/g, " ");
  const entity = label === "item" || label === "shop item" ? "shop_item" : label as Exclude<SearchEntity, "user"> | undefined;
  return { ...(entity ? { entity } : {}), id };
}

export function searchCandidateFilter(
  search: string, entity: SearchEntity, id: SQLWrapper, fields: SQLWrapper[],
): SQL {
  const exact = parseExactSearchId(search);
  // Copied internal user IDs use the primary-key index, not substring scans.
  if (exact?.entity === "user") return entity === "user" ? sql`${id} = ${exact.id}` : sql`false`;
  if (exact && entity !== "user") {
    return !exact.entity || exact.entity === entity ? sql`${id} = ${exact.id}` : sql`false`;
  }
  if (exact?.entity) return sql`false`;
  // OR preserves the endpoint's MiniSearch OR fallback. Every term is a bound,
  // escaped value, never SQL text. Casts also cover arrays, JSON and enum fields.
  const terms = [...new Set(search.trim().split(/\s+/).filter(Boolean))];
  return or(
    sql`${id}::text = ${search.trim()}`,
    ...terms.flatMap((term) => fields.map((field) =>
      sql`${field}::text ILIKE ${`%${escapeSearchTerm(term)}%`} ESCAPE E'\\\\'`,
    )),
  ) ?? sql`false`;
}

export function exactSearchPriority(search: string, entity: SearchEntity, id: SQLWrapper): SQL {
  const exact = parseExactSearchId(search);
  const value = entity === "user"
    ? exact?.entity === "user" ? exact.id : search.trim()
    : exact && (!exact.entity || exact.entity === entity) ? exact.id : null;
  return value === null ? sql`case when false then 0 else 1 end` : sql`case when ${id} = ${value} then 0 else 1 end`;
}

export function searchPermissions(actor: Actor, ignoreReviewerOwnershipPolicies = false) {
  return {
    users: canAccessInternalUsers(actor), review: canAccessInternalReview(actor),
    shop: canAccessInternalShopAdmin(actor), orders: canAccessInternalOrders(actor),
    pii: isAbleToHandlePII(actor), allOrders: canViewAllOrders(actor),
    reviewOwn: canReviewOwnProjects(actor) || ignoreReviewerOwnershipPolicies,
  };
}

export function canSearchUser(actor: Actor, target: Pick<Actor, "id">) {
  // canViewUser only consumes target.id; don't load tokens to satisfy its broad type.
  return canViewUser(actor, target as Actor);
}

export function reviewSearchConditions(actor: Actor, reviewOwn: boolean, entity: "project" | "ship") {
  const types = getReviewableProjectTypes(actor);
  const conditions: SQL[] = [];
  if (types.length === 1) conditions.push(eq(projectTable.type, types[0]!));
  else if (types.length === 0) conditions.push(sql`false`);
  if (!reviewOwn) conditions.push(entity === "project"
    ? or(isNull(projectTable.user_id), ne(projectTable.user_id, actor.id))!
    : ne(shipTable.user_id, actor.id));
  return and(...conditions);
}

export function canSearchOrder(actor: Actor, order: { status: string; provider: string | null }, isHackatimeRed: boolean) {
  return canAccessInternalOrders(actor) && (canViewAllOrders(actor) ||
    isOrderVisibleToFulfiller(order.status, order.provider, isHackatimeRed));
}
