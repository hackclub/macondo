import db from "../../../db";
import { projectTable, shadowBanTable, shipTable, users } from "../../../db/schema";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getTrustLevelsForUsers } from "../../../lib/hackatime";
import { canImpersonateUser, canViewUser, isAbleToHandlePII } from "../../../policies/internal";

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, Number.MAX_SAFE_INTEGER) : fallback;
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  const query = getQuery(event);
  const normalizedTrustFactor = typeof query.trustFactor === "string" && query.trustFactor.trim()
    ? query.trustFactor.trim().charAt(0).toUpperCase() + query.trustFactor.trim().slice(1).toLowerCase()
    : null;

  const search = (query.search as string) ?? "";
  const page = positiveInteger(query.page, 1);
  const limit = Math.min(50, positiveInteger(query.limit, 12));
  const offset = (page - 1) * limit;
  const showPii = isAbleToHandlePII(actor);

  const searchTerms = [
    ilike(users.name, `%${search}%`),
    ilike(users.slack_id, `%${search}%`),
    ilike(users.username, `%${search}%`),
    sql`CAST(${users.hackatime_id} AS TEXT) = ${search}`,
  ];

  if (showPii) {
    searchTerms.push(ilike(users.email, `%${search}%`));
  }

  const searchCondition = search
    ? or(...searchTerms)
    : undefined;

  // Trust comes from the Hackatime API per user, so SQL can't filter on it; with a
  // trust filter we scan every match and paginate in memory instead.
  const hasTrustFilter =
    normalizedTrustFactor === "Green" ||
    normalizedTrustFactor === "Blue" ||
    normalizedTrustFactor === "Yellow" ||
    normalizedTrustFactor === "Red";

  const rowSelect = {
    id: users.id,
    name: users.name,
    email: users.email,
    image: users.image,
    slack_id: users.slack_id,
    username: users.username,
    hackatime_id: users.hackatime_id,
    roles: users.roles,
    createdAt: users.createdAt,
    last_seen_at: users.last_seen_at,
  } as const;

  const orderedRows = db.select(rowSelect).from(users).where(searchCondition)
    .orderBy(desc(users.createdAt), asc(users.id));
  const [[{ total: searchTotal }], rows] = await Promise.all([
    db.select({ total: sql<number>`COUNT(*)`.mapWith(Number) }).from(users).where(searchCondition),
    hasTrustFilter
      ? orderedRows.limit(500) // preserves the capped trust-filter scan
      : orderedRows.limit(limit).offset(offset),
  ]);

  const pageUserIds = rows.map((r) => r.id);
  const userIds = rows
    .filter((u) => canViewUser(actor, u as unknown as typeof users.$inferSelect))
    .map((u) => u.id);
  const [trustLevels, shadowBanCounts, projects, ships] = await Promise.all([
    getTrustLevelsForUsers(pageUserIds),
    pageUserIds.length > 0
      ? db.select({
          user_id: shadowBanTable.user_id,
          count: sql<number>`COUNT(*)`.mapWith(Number),
        }).from(shadowBanTable)
          .where(and(inArray(shadowBanTable.user_id, pageUserIds), eq(shadowBanTable.active, true)))
          .groupBy(shadowBanTable.user_id)
      : [],
    userIds.length > 0
      ? db.select({
          id: projectTable.id,
          user_id: projectTable.user_id,
          name: projectTable.name,
          created_at: projectTable.created_at,
        }).from(projectTable).where(inArray(projectTable.user_id, userIds))
      : [],
    // Count every ship before visibility filtering, using the same rows for hydration.
    pageUserIds.length > 0
      ? db.select({
          id: shipTable.id,
          user_id: shipTable.user_id,
          status: shipTable.status,
          created_at: shipTable.created_at,
          project_name: projectTable.name,
        }).from(shipTable)
          .leftJoin(projectTable, eq(shipTable.project_id, projectTable.id))
          .where(inArray(shipTable.user_id, pageUserIds))
      : [],
  ]);
  const shadowBanCountByUserId = new Map(shadowBanCounts.map((row) => [row.user_id, row.count]));
  const totalShipsByUserId = new Map<string, number>();
  for (const ship of ships) {
    totalShipsByUserId.set(ship.user_id, (totalShipsByUserId.get(ship.user_id) ?? 0) + 1);
  }

  function normalizeTrustFactor(level: string | null): string {
    if (!level) return "Yellow";
    const t = level.trim();
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }

  let result = rows.map((u) => {
    const trustFactor = normalizeTrustFactor(trustLevels.get(u.id) ?? null);
    const isKnownLevel =
      trustFactor === "Green" ||
      trustFactor === "Blue" ||
      trustFactor === "Yellow" ||
      trustFactor === "Red";
    return {
      id: u.id,
      name: u.name,
      slack_id: u.slack_id,
      hackatime_id: u.hackatime_id,
      image: u.image,
      username: u.username,
      roles: u.roles,
      createdAt: u.createdAt,
      last_seen_at: u.last_seen_at,
      totalShips: totalShipsByUserId.get(u.id) ?? 0,
      isShadowBanned: (shadowBanCountByUserId.get(u.id) ?? 0) > 0,
      canImpersonate: canImpersonateUser(actor, u as unknown as typeof users.$inferSelect),
      projectCount: 0,
      trustFactor: isKnownLevel ? trustFactor : "Yellow",
      projects: [] as {
        id: number;
        name: string;
        created_at: Date | null;
      }[],
      ships: [] as {
        id: number;
        status: string;
        created_at: Date | null;
        project_name: string | null;
      }[],
      ...(showPii ? { email: u.email } : {}),
    };
  });

  result = result.filter((u) => canViewUser(actor, u as unknown as typeof users.$inferSelect));

  const projectsByUserId = new Map<
    string,
    {
      id: number;
      name: string;
      created_at: Date | null;
    }[]
  >();
  const shipsByUserId = new Map<
    string,
    {
      id: number;
      status: string;
      created_at: Date | null;
      project_name: string | null;
    }[]
  >();

  for (const project of projects) {
    const existing = projectsByUserId.get(project.user_id) ?? [];
    existing.push({
      id: project.id,
      name: project.name,
      created_at: project.created_at,
    });
    projectsByUserId.set(project.user_id, existing);
  }

  for (const ship of ships) {
    const existing = shipsByUserId.get(ship.user_id) ?? [];
    existing.push({
      id: ship.id,
      status: ship.status,
      created_at: ship.created_at,
      project_name: ship.project_name,
    });
    shipsByUserId.set(ship.user_id, existing);
  }

  result = result.map((user) => {
    const projects = (projectsByUserId.get(user.id) ?? []).sort(
      (a, b) => (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0),
    );
    const ships = (shipsByUserId.get(user.id) ?? []).sort(
      (a, b) => (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0),
    );

    return {
      ...user,
      projectCount: projects.length,
      projects,
      ships,
    };
  });

  if (hasTrustFilter) {
    result = result.filter((u) => u.trustFactor === normalizedTrustFactor);
  }

  return {
    users: hasTrustFilter ? result.slice(offset, offset + limit) : result,
    page,
    limit,
    total: hasTrustFilter ? result.length : searchTotal,
  };
});
