import { and, desc, eq, lt, sql } from "drizzle-orm";

import db from "../../db";
import { notificationTable } from "../../db/schema";
import { getSession } from "../../lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const query = getQuery(event);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const cursor = query.cursor ? Number(query.cursor) : null;

  const rows = await db
    .select()
    .from(notificationTable)
    .where(
      cursor
        ? and(eq(notificationTable.user_id, user.id), lt(notificationTable.id, cursor))
        : eq(notificationTable.user_id, user.id),
    )
    .orderBy(desc(notificationTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const [unreadCountResult] = await db
    .select({
      count: sql<number>`COUNT(*)`.mapWith(Number),
    })
    .from(notificationTable)
    .where(
      and(
        eq(notificationTable.user_id, user.id),
        sql`${notificationTable.read_at} IS NULL`,
      ),
    );

  return {
    items,
    unread_count: unreadCountResult?.count ?? 0,
    next_cursor: hasMore ? items[items.length - 1]?.id : null,
  };
});
