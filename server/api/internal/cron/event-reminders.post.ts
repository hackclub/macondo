// ?eventId=N ignores the time band; ?force=1 re-sends to already-reminded attendees

import { runEventReminderSweep } from "../../../lib/event-reminders";
import { hasRole } from "../../../policies/internal";
import type { users } from "../../../db/schema";

export default defineEventHandler(async (event) => {
  const actor = event.context.user as
    | (typeof users.$inferSelect)
    | null
    | undefined;
  if (!actor || !hasRole(actor, ["supaadmin"])) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const q = getQuery(event);
  const eventIdNum = q.eventId ? Number(q.eventId) : NaN;

  return await runEventReminderSweep({
    eventId: Number.isInteger(eventIdNum) ? eventIdNum : undefined,
    force: q.force === "1" || q.force === "true",
  });
});
