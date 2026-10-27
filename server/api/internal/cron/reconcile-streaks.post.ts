import {
  reconcileAllActiveUsers,
  reconcileOpenReviewProtection,
} from "../../../lib/streak-reconcile";
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

  const report = await reconcileAllActiveUsers();
  return {
    ...report,
    // like the cron, also heal streak_days stranded inside an open review window
    review_protection: await reconcileOpenReviewProtection({
      actorId: actor.id,
    }),
  };
});
