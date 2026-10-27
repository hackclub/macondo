import { getJobStatus } from "../../../lib/admin-job";
import { hasRole } from "../../../policies/internal";
import type { users } from "../../../db/schema";

// Shares the lock name with sync-hackatime-all so a run from either button shows as running.

export default defineEventHandler(async (event) => {
  const actor = event.context.user as
    | (typeof users.$inferSelect)
    | null
    | undefined;

  if (!actor || !hasRole(actor, ["supaadmin"])) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return getJobStatus("backfill-streak-days", "hackatime-batch-sync");
});
