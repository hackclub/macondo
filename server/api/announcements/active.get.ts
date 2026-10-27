// Body is pre-snapshotted in the user's locale; dismissal goes through POST /api/notifications/[id]/read.

import { and, desc, eq, isNull } from "drizzle-orm";

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
      id: notificationTable.id,
      title: notificationTable.title,
      body: notificationTable.body,
      created_at: notificationTable.created_at,
      entity_type: notificationTable.entity_type,
      entity_id: notificationTable.entity_id,
    })
    .from(notificationTable)
    .where(
      and(
        eq(notificationTable.user_id, user.id),
        eq(notificationTable.type, "admin_announcement"),
        isNull(notificationTable.read_at),
      ),
    )
    .orderBy(desc(notificationTable.id))
    .limit(1);

  return { announcement: row ?? null };
});
