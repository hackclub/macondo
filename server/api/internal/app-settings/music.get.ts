import { hasRole } from "../../../policies/internal";
import { isMusicEnabled } from "../../../lib/app-settings";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!hasRole(actor, ["supaadmin"])) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const enabled = await isMusicEnabled();
  return { enabled };
});
