import { desc, or, eq, sql } from "drizzle-orm";
import db from "../../../db";
import { shipTable, projectTable, users } from "../../../db/schema";
import { canAccessInternalShippedProjects } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  if (!canAccessInternalShippedProjects(event.context.user)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);
  const page = Math.max(1, parseInt((query.page as string) ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt((query.limit as string) ?? "50")));

  const whereClause = or(
    eq(shipTable.status, "shipped"),
    eq(shipTable.status, "shipped_missing_airtable"),
  );

  const [rows, totals] = await Promise.all([
    db
      .select({
        ship_id: shipTable.id,
        ship_status: shipTable.status,
        shipped_at: shipTable.reviewed_at,
        hackatime_hours: shipTable.hackatime_hours,
        override_hours: shipTable.override_hours,
        project_id: projectTable.id,
        project_name: projectTable.name,
        project_type: projectTable.type,
        project_level: projectTable.level,
        author_id: users.id,
        author_username: users.username,
        author_image: users.image,
        // just the id: the full missing-fields check costs one Airtable GET per ship
        airtable_record_id: shipTable.airtable_record_id,
      })
      .from(shipTable)
      .leftJoin(projectTable, eq(shipTable.project_id, projectTable.id))
      .leftJoin(users, eq(shipTable.user_id, users.id))
      .where(whereClause)
      .orderBy(desc(shipTable.reviewed_at))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ total: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(shipTable)
      .where(whereClause),
  ]);

  return {
    items: rows,
    page,
    limit,
    total: totals[0]?.total ?? 0,
  };
});
