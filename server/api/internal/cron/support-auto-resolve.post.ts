// idempotent: warn and resolve are status-guarded atomic UPDATEs

import { runAutoResolveSweep } from "../../../lib/support-ticket-auto-resolve";
import { canAccessInternalSupport } from "../../../policies/internal";
import type { users } from "../../../db/schema";

export default defineEventHandler(async (event) => {
  const actor = event.context.user as
    | (typeof users.$inferSelect)
    | null
    | undefined;

  if (!actor || !canAccessInternalSupport(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return await runAutoResolveSweep();
});
