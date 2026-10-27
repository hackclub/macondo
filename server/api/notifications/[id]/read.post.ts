import { and, eq, isNull } from "drizzle-orm";

import db from "../../../db";
import { notificationTable } from "../../../db/schema";
import { getSession } from "../../../lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid notification id" });
  }

  // Already-read is a no-op, not an error, so the UI can call this idempotently.
  const [updated] = await db
    .update(notificationTable)
    .set({ read_at: new Date() })
    .where(
      and(
        eq(notificationTable.id, id),
        eq(notificationTable.user_id, user.id),
        isNull(notificationTable.read_at),
      ),
    )
    .returning({ id: notificationTable.id });

  return { id, updated: !!updated };
});
