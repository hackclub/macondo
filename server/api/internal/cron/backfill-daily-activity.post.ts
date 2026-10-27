import { runBatchDailyActivityBackfill } from "../../../lib/daily-activity";
import { hasRole } from "../../../policies/internal";
import type { users } from "../../../db/schema";

// idempotent: seconds are recomputed from source, not incremented

export default defineEventHandler(async (event) => {
  const actor = event.context.user as
    | (typeof users.$inferSelect)
    | null
    | undefined;

  if (!actor || !hasRole(actor, ["supaadmin"])) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return await runBatchDailyActivityBackfill();
});
