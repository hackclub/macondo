import { eq } from "drizzle-orm";

import db from "../../db";
import { notificationPreferencesTable } from "../../db/schema";
import { getSession } from "../../lib/session";

const DEFAULT_PREFS = {
  ship_decisions: { in_app: true, slack: true, email: true },
  payouts: { in_app: true, slack: true, email: true },
  tickets: { in_app: true, slack: true, email: true },
  events: { in_app: true, slack: true, email: true },
} as const;

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const [row] = await db
    .select({ preferences: notificationPreferencesTable.preferences })
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.user_id, user.id))
    .limit(1);

  return { preferences: row?.preferences ?? DEFAULT_PREFS };
});
