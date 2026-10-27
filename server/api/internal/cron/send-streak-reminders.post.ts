import { sendDueReminders } from "../../../lib/streak-reminders";
import { hasRole } from "../../../policies/internal";
import type { users } from "../../../db/schema";

// ?force=1 bypasses the post-Macondo no-op and really DMs students
export default defineEventHandler(async (event) => {
  const actor = event.context.user as
    | (typeof users.$inferSelect)
    | null
    | undefined;

  if (!actor || !hasRole(actor, ["supaadmin"])) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);
  const hourRaw = query.hour;
  let hourOverride: number | undefined;
  if (typeof hourRaw === "string") {
    const parsed = Number.parseInt(hourRaw, 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 23) {
      hourOverride = parsed;
    }
  }

  return await sendDueReminders({
    hourOverride,
    force: query.force === "1" || query.force === "true",
  });
});
