import MiniSearch from "minisearch";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import db from "../../db";
import {
  projectTable,
  shipTable,
  shopItemTable,
  shopOrderTable,
  users,
} from "../../db/schema";
import { getDevDebugFlags } from "../../lib/dev-debug-flags";
import { GOLD_PER_HOUR } from "../../lib/shop";
import { getBannedUserIds } from "../../lib/hackatime";
import {
  canSearchOrder, canSearchUser, exactSearchPriority, reviewSearchConditions,
  searchCandidateFilter, searchPermissions,
} from "../../lib/internal-search";

type InternalSearchResultType =
  | "user"
  | "project"
  | "ship"
  | "shop_item"
  | "order";

type InternalSearchDocument = {
  id: string;
  entityId: string;
  type: InternalSearchResultType;
  title: string;
  subtitle: string;
  description: string;
  keywords: string;
  href: string;
  image: string | null;
  badge: string;
  sortTime: number;
};

function compact(parts: Array<string | number | null | undefined | false>) {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== false && String(part).trim().length > 0)
    .map((part) => String(part))
    .join(" - ");
}

function timestamp(value: Date | string | null | undefined) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function translationText(value: Record<string, string> | null | undefined) {
  return value ? Object.values(value).join(" ") : "";
}

function formatStatus(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Permissions and dev ownership flags must be evaluated on every request.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  const devDebugFlags = getDevDebugFlags(event);
  const query = getQuery(event);
  const search = (typeof query.q === "string" ? query.q : "").trim();
  const limit = Math.min(20, Math.max(1, Number.parseInt((query.limit as string) ?? "10", 10) || 10));

  if (!search) {
    return { results: [] };
  }

  const documents: InternalSearchDocument[] = [];
  const permissions = searchPermissions(actor, devDebugFlags.ignoreReviewerOwnershipPolicies);
  const showPii = permissions.pii;
  // At most five concurrent entity queries, each capped AFTER candidate filtering.
  const MAX_ROWS_PER_ENTITY = 100;
  const tasks: Array<Promise<void>> = [];

  if (permissions.users) tasks.push((async () => {
    const rows = await db
      .select({
        id: users.id, name: users.name, username: users.username,
        slack_id: users.slack_id, hackatime_id: users.hackatime_id,
        email: showPii ? users.email : sql<string>`''`, image: users.image,
        last_seen_at: users.last_seen_at, updatedAt: users.updatedAt, createdAt: users.createdAt,
      })
      .from(users)
      .where(and(
        searchCandidateFilter(search, "user", users.id, [
          users.id, users.name, users.username, users.slack_id, users.hackatime_id,
          ...(showPii ? [users.email] : []),
        ]),
        canSearchUser(actor, { id: actor.id }) ? undefined : ne(users.id, actor.id),
      ))
      .orderBy(asc(exactSearchPriority(search, "user", users.id)), desc(users.last_seen_at))
      .limit(MAX_ROWS_PER_ENTITY);

    for (const user of rows) {
      if (!canSearchUser(actor, user)) continue;

      documents.push({
        id: `user:${user.id}`,
        entityId: user.id,
        type: "user",
        title: user.name,
        subtitle: compact([
          user.username ? `@${user.username}` : null,
          user.slack_id,
          user.hackatime_id != null ? `Hackatime ${user.hackatime_id}` : null,
        ]) || "User",
        description: showPii ? user.email : "",
        keywords: compact([
          "user",
          user.id,
          user.name,
          user.username,
          user.slack_id,
          user.hackatime_id,
          showPii ? user.email : null,
        ]),
        href: `/internal/users/${user.id}`,
        image: user.image,
        badge: "User",
        sortTime: timestamp(user.last_seen_at ?? user.updatedAt ?? user.createdAt),
      });
    }
  })());

  if (permissions.review) tasks.push((async () => {

    const projectRows = await db
      .select({
        id: projectTable.id,
        name: projectTable.name,
        description: projectTable.description,
        type: projectTable.type,
        level: projectTable.level,
        fruit: projectTable.fruit,
        thumbnail_url: projectTable.thumbnail_url,
        repository_url: projectTable.repository_url,
        demo_url: projectTable.demo_url,
        hackatime_projects: projectTable.hackatime_projects,
        created_at: projectTable.created_at,
        updated_at: projectTable.updated_at,
        owner_name: users.name,
        owner_username: users.username,
      })
      .from(projectTable)
      .leftJoin(users, eq(projectTable.user_id, users.id))
      .where(and(
        reviewSearchConditions(actor, permissions.reviewOwn, "project"),
        searchCandidateFilter(search, "project", projectTable.id, [
          projectTable.name, projectTable.description, projectTable.type, projectTable.level,
          projectTable.fruit, projectTable.repository_url, projectTable.demo_url,
          projectTable.hackatime_projects, users.name, users.username,
        ]),
      ))
      .orderBy(asc(exactSearchPriority(search, "project", projectTable.id)), desc(projectTable.updated_at), desc(projectTable.created_at))
      .limit(MAX_ROWS_PER_ENTITY);

    for (const project of projectRows) {
      documents.push({
        id: `project:${project.id}`,
        entityId: String(project.id),
        type: "project",
        title: project.name,
        subtitle: compact([
          `Project #${project.id}`,
          project.type,
          project.level ? `Level ${project.level}` : null,
          project.owner_name,
        ]),
        description: project.description ?? "",
        keywords: compact([
          "project",
          `project ${project.id}`,
          `#${project.id}`,
          project.name,
          project.description,
          project.type,
          project.level,
          project.fruit,
          project.repository_url,
          project.demo_url,
          project.hackatime_projects?.join(" "),
          project.owner_name,
          project.owner_username,
        ]),
        href: `/internal/projects/${project.id}`,
        image: project.thumbnail_url,
        badge: "Project",
        sortTime: timestamp(project.updated_at ?? project.created_at),
      });
    }

  })());

  if (permissions.review) tasks.push((async () => {

    const shipRows = await db
      .select({
        id: shipTable.id,
        status: shipTable.status,
        hackatime_projects: shipTable.hackatime_projects,
        hackatime_hours: shipTable.hackatime_hours,
        override_hours: shipTable.override_hours,
        created_at: shipTable.created_at,
        reviewed_at: shipTable.reviewed_at,
        project_id: projectTable.id,
        project_name: projectTable.name,
        project_type: projectTable.type,
        project_level: projectTable.level,
        project_thumbnail_url: projectTable.thumbnail_url,
        author_name: users.name,
        author_username: users.username,
      })
      .from(shipTable)
      .leftJoin(projectTable, eq(shipTable.project_id, projectTable.id))
      .leftJoin(users, eq(shipTable.user_id, users.id))
      .where(and(
        reviewSearchConditions(actor, permissions.reviewOwn, "ship"),
        searchCandidateFilter(search, "ship", shipTable.id, [
          shipTable.status, shipTable.hackatime_projects, projectTable.name,
          projectTable.type, projectTable.level, users.name, users.username,
        ]),
      ))
      .orderBy(asc(exactSearchPriority(search, "ship", shipTable.id)), desc(shipTable.reviewed_at), desc(shipTable.created_at))
      .limit(MAX_ROWS_PER_ENTITY);

    for (const ship of shipRows) {
      const approvedHours = ship.override_hours ?? ship.hackatime_hours;

      documents.push({
        id: `ship:${ship.id}`,
        entityId: String(ship.id),
        type: "ship",
        title: ship.project_name
          ? `Ship #${ship.id}: ${ship.project_name}`
          : `Ship #${ship.id}`,
        subtitle: compact([
          formatStatus(ship.status),
          ship.author_name,
          ship.project_type,
          ship.project_level ? `Level ${ship.project_level}` : null,
          approvedHours != null ? `${approvedHours}h` : null,
        ]),
        description: compact([
          ship.project_name,
          ship.hackatime_projects?.join(" "),
          ship.author_username,
        ]),
        keywords: compact([
          "ship",
          `ship ${ship.id}`,
          `#${ship.id}`,
          ship.status,
          ship.project_id ? `project ${ship.project_id}` : null,
          ship.project_name,
          ship.project_type,
          ship.project_level,
          ship.hackatime_projects?.join(" "),
          ship.author_name,
          ship.author_username,
        ]),
        href: ship.project_id ? `/internal/projects/${ship.project_id}` : `/internal/shipped`,
        image: ship.project_thumbnail_url,
        badge: "Ship",
        sortTime: timestamp(ship.reviewed_at ?? ship.created_at),
      });
    }
  })());

  if (permissions.shop) tasks.push((async () => {
    const shopItems = await db
      .select({
        id: shopItemTable.id, name: shopItemTable.name, description: shopItemTable.description,
        name_translations: shopItemTable.name_translations,
        description_translations: shopItemTable.description_translations,
        kind: shopItemTable.kind, fulfillment_provider: shopItemTable.fulfillment_provider,
        source: shopItemTable.source, price_hours: shopItemTable.price_hours,
        price_fruit_type: shopItemTable.price_fruit_type, price_fruit_level: shopItemTable.price_fruit_level,
        price_fruit_category: shopItemTable.price_fruit_category, available: shopItemTable.available,
        coming_soon: shopItemTable.coming_soon, image_url: shopItemTable.image_url,
        updated_at: shopItemTable.updated_at, created_at: shopItemTable.created_at,
      })
      .from(shopItemTable)
      .where(searchCandidateFilter(search, "shop_item", shopItemTable.id, [
        shopItemTable.name, shopItemTable.description, shopItemTable.name_translations,
        shopItemTable.description_translations, shopItemTable.kind, shopItemTable.fulfillment_provider,
        shopItemTable.source, shopItemTable.price_fruit_type, shopItemTable.price_fruit_level,
        shopItemTable.price_fruit_category,
      ]))
      .orderBy(asc(exactSearchPriority(search, "shop_item", shopItemTable.id)), desc(shopItemTable.updated_at), desc(shopItemTable.created_at))
      .limit(MAX_ROWS_PER_ENTITY);

    for (const item of shopItems) {
      documents.push({
        id: `shop_item:${item.id}`,
        entityId: String(item.id),
        type: "shop_item",
        title: item.name,
        subtitle: compact([
          `Shop item #${item.id}`,
          item.kind,
          item.fulfillment_provider,
          `${item.price_hours * GOLD_PER_HOUR} gold`,
          item.available === false ? "Archived" : item.coming_soon ? "Coming soon" : "Live",
        ]),
        description: item.description ?? "",
        keywords: compact([
          "shop",
          "shop item",
          `shop item ${item.id}`,
          `item ${item.id}`,
          item.name,
          item.description,
          translationText(item.name_translations),
          translationText(item.description_translations),
          item.kind,
          item.fulfillment_provider,
          item.source,
          item.price_fruit_type,
          item.price_fruit_level != null && item.price_fruit_category
            ? `Level ${item.price_fruit_level} ${item.price_fruit_category}`
            : null,
        ]),
        href: `/internal/shop/${item.id}`,
        image: item.image_url,
        badge: "Shop",
        sortTime: timestamp(item.updated_at ?? item.created_at),
      });
    }

  })());

  if (permissions.orders) tasks.push((async () => {
    const snapshotName = sql<string | null>`${shopOrderTable.item_snapshot}->>'name'`;
    const snapshotProvider = sql<string | null>`${shopOrderTable.item_snapshot}->>'fulfillment_provider'`;
    const orderRows = await db
      .select({
        id: shopOrderTable.id,
        status: shopOrderTable.status,
        snapshot_name: snapshotName,
        provider: snapshotProvider,
        user_id: shopOrderTable.user_id,
        external_reference: shopOrderTable.external_reference,
        created_at: shopOrderTable.created_at,
        updated_at: shopOrderTable.updated_at,
        item_name: shopItemTable.name,
        user_name: users.name,
        user_username: users.username,
        user_slack_id: users.slack_id,
        user_email: showPii ? users.email : sql<string>`''`,
      })
      .from(shopOrderTable)
      .leftJoin(shopItemTable, eq(shopOrderTable.item_id, shopItemTable.id))
      .leftJoin(users, eq(shopOrderTable.user_id, users.id))
      .where(and(
        searchCandidateFilter(search, "order", shopOrderTable.id, [
          snapshotName, shopItemTable.name, shopOrderTable.status,
          shopOrderTable.external_reference, users.name, users.username, users.slack_id,
          ...(showPii ? [users.email] : []),
        ]),
        // Cheap prefilter mirrors shop policy; the red gate is rechecked below.
        permissions.allOrders ? undefined : sql`(${snapshotProvider} is null or ${snapshotProvider} <> ${"theseus"}) and ${shopOrderTable.status} in (${"shipped"}, ${"pending_internal_fulfillment"})`,
      ))
      .orderBy(asc(exactSearchPriority(search, "order", shopOrderTable.id)), desc(shopOrderTable.created_at))
      .limit(MAX_ROWS_PER_ENTITY);

    const banned = permissions.allOrders ? new Set<string>() : await getBannedUserIds(
      [...new Set(orderRows.filter((order) => order.status !== "shipped").map((order) => order.user_id))],
    );
    for (const order of orderRows) {
      if (!canSearchOrder(actor, order, banned.has(order.user_id))) continue;
      const itemName = order.snapshot_name ?? order.item_name ?? null;

      documents.push({
        id: `order:${order.id}`,
        entityId: String(order.id),
        type: "order",
        title: itemName ? `Order #${order.id}: ${itemName}` : `Order #${order.id}`,
        subtitle: compact([
          `Order #${order.id}`,
          formatStatus(order.status),
          order.user_name,
        ]),
        description: showPii ? order.user_email ?? "" : "",
        keywords: compact([
          "order",
          `order ${order.id}`,
          `#${order.id}`,
          itemName,
          order.status,
          order.external_reference,
          order.user_name,
          order.user_username,
          order.user_slack_id,
          showPii ? order.user_email : null,
        ]),
        href: `/internal/orders/${order.id}`,
        image: null,
        badge: "Order",
        sortTime: timestamp(order.updated_at ?? order.created_at),
      });
    }
  })());

  await Promise.all(tasks);

  if (documents.length === 0) {
    return { results: [] };
  }

  const searchOptions = {
    boost: { title: 4, subtitle: 2.5, keywords: 2, description: 1 },
    prefix: true,
    fuzzy: (term: string) => (term.length >= 5 ? 0.2 : term.length >= 3 ? 0.1 : false), // longer terms tolerate more typos
    combineWith: "AND" as const,
  };

  const index = new MiniSearch<InternalSearchDocument>({
    idField: "id",
    fields: ["title", "subtitle", "description", "keywords"],
    storeFields: ["id"],
    searchOptions,
  });
  index.addAll(documents);

  const byId = new Map(documents.map((document) => [document.id, document]));
  let matches = index.search(search, searchOptions);
  if (matches.length < Math.min(3, limit) && search.includes(" ")) { // too few and-matches, retry with or
    matches = index.search(search, { ...searchOptions, combineWith: "OR" });
  }

  return {
    results: matches
      .map((match) => {
        const document = byId.get(String(match.id));
        if (!document) return null;
        return {
          id: document.entityId,
          type: document.type,
          title: document.title,
          subtitle: document.subtitle,
          href: document.href,
          image: document.image,
          badge: document.badge,
          score: match.score,
          sortTime: document.sortTime,
        };
      })
      .filter((result): result is NonNullable<typeof result> => result != null)
      .sort((a, b) => b.score - a.score || b.sortTime - a.sortTime)
      .slice(0, limit)
      .map(({ sortTime: _sortTime, ...result }) => result),
  };
});
