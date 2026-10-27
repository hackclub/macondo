// deliberately not on a cron: a timer would mass-grant invites the moment a deploy lands

import { runEventAutoQualifySweep } from "../../../lib/event-auto-qualify";
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

  return await runEventAutoQualifySweep({ dryRun: q.dryRun === "1" || q.dryRun === "true" });
});
