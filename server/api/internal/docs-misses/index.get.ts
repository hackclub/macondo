import { and, desc, isNull, sql } from "drizzle-orm";

import db from "../../../db";
import { docsSearchMissesTable } from "../../../db/schema";
import { canManageInternalFAQ } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canManageInternalFAQ(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const queryParams = getQuery(event);
  const limit = Math.min(
    Math.max(parseInt(String(queryParams.limit ?? "50"), 10) || 50, 1),
    200, // max page size
  );

  const where = queryParams.includeDismissed === "true"
    ? undefined
    : isNull(docsSearchMissesTable.dismissed_at);

  const baseQuery = db
    .select({
      query: docsSearchMissesTable.query,
      locale: docsSearchMissesTable.locale,
      count: sql<number>`count(*)::int`,
      last_seen: sql<Date>`max(${docsSearchMissesTable.created_at})`,
      first_seen: sql<Date>`min(${docsSearchMissesTable.created_at})`,
      signed_in_count: sql<number>`count(${docsSearchMissesTable.user_id})::int`,
    })
    .from(docsSearchMissesTable);

  const rows = await (where ? baseQuery.where(where) : baseQuery)
    .groupBy(docsSearchMissesTable.query, docsSearchMissesTable.locale)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return {
    rows,
    totals: (
      await db
        .select({
          total_misses: sql<number>`count(*)::int`,
          distinct_queries: sql<number>`count(distinct (${docsSearchMissesTable.query}, ${docsSearchMissesTable.locale}))::int`,
          misses_last_24h: sql<number>`count(*) filter (where ${docsSearchMissesTable.created_at} > now() - interval '24 hours')::int`,
        })
        .from(docsSearchMissesTable)
        .where(and(isNull(docsSearchMissesTable.dismissed_at)))
    )[0] ?? {
      total_misses: 0,
      distinct_queries: 0,
      misses_last_24h: 0,
    },
  };
});
