import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import db from "../../../db";
import { currencyTransactionTable, projectTable } from "../../../db/schema";
import { getSession } from "../../../lib/session";

// Pending gold awaits a build-complete approval (see internal/ships/[id]/review.post.ts).
// The fruits path is kept for app/pages/profile.vue.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  return {
    projects: (
      await db
        .select({
          project_id: currencyTransactionTable.pending_for_project_id,
          project_name: projectTable.name,
          project_thumbnail_url: projectTable.thumbnail_url,
          total: sql<number>`COALESCE(SUM(
        CASE WHEN ${currencyTransactionTable.type} = 'increase'
          THEN ${currencyTransactionTable.amount}
          ELSE -${currencyTransactionTable.amount}
        END
      ), 0)`.mapWith(Number),
        })
        .from(currencyTransactionTable)
        .leftJoin(
          projectTable,
          eq(projectTable.id, currencyTransactionTable.pending_for_project_id),
        )
        .where(
          and(
            eq(currencyTransactionTable.user_id, user.id),
            eq(currencyTransactionTable.counts, true),
            isNull(currencyTransactionTable.unlocked_at),
            isNotNull(currencyTransactionTable.pending_for_project_id),
          ),
        )
        .groupBy(
          currencyTransactionTable.pending_for_project_id,
          projectTable.name,
          projectTable.thumbnail_url,
        )
    )
      .map((row) => ({
        project_id: row.project_id ?? null,
        project_name: row.project_name ?? null,
        project_thumbnail_url: row.project_thumbnail_url ?? null,
        total_gold: Number(row.total ?? 0),
      }))
      .filter((p) => p.project_id != null && p.total_gold > 0),
  };
});
