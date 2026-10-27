import { and, eq, isNull } from "drizzle-orm";

import db from "../../db";
import { notificationTable } from "../../db/schema";
import { getSession } from "../../lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  return {
    updated: (
      await db
        .update(notificationTable)
        .set({ read_at: new Date() })
        .where(
          and(
            eq(notificationTable.user_id, user.id),
            isNull(notificationTable.read_at),
          ),
        )
        .returning({ id: notificationTable.id })
    ).length,
  };
});
