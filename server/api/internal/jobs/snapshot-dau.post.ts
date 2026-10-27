import { captureYesterdayDauSnapshot } from "../../../lib/dau-snapshot";
import { hasRole } from "../../../policies/internal";
import type { users } from "../../../db/schema";

// Idempotent: re-running for the same day overwrites that day's row.

export default defineEventHandler(async (event) => {
  const actor = event.context.user as
    | (typeof users.$inferSelect)
    | null
    | undefined;

  if (!actor || !hasRole(actor, ["supaadmin"])) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return await captureYesterdayDauSnapshot();
});
