import { canAccessNotificationAdmin } from "../../../policies/internal";
import { postSupportSummary } from "../../../lib/support-summary";

// Called by an external cron; notification-admin gating keeps anyone else from spamming Slack.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessNotificationAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const res = await postSupportSummary();
  if (!res.ok) {
    throw createError({ statusCode: 502, statusMessage: res.error });
  }
  return { ok: true, ts: res.ts };
});
