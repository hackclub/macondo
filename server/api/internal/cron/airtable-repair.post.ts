// idempotent: only fills cells that are empty in airtable, so reviewer hand-edits survive

import { runAirtableRepair } from "../../../lib/airtable-repair";
import { hasRole } from "../../../policies/internal";
import type { users } from "../../../db/schema";

export default defineEventHandler(async (event) => {
  const actor = event.context.user as
    | (typeof users.$inferSelect)
    | null
    | undefined;

  if (!actor || !hasRole(actor, ["supaadmin", "admin"])) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return await runAirtableRepair();
});
