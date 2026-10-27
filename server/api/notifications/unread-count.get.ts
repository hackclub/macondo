import { and, eq, sql } from "drizzle-orm";

import db from "../../db";
import { notificationTable } from "../../db/schema";
import { getSession } from "../../lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const [row] = await db
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

  return { count: row?.count ?? 0 };
});
