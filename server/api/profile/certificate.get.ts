// `eligible` requires an Event Invite purchase and confirmed attendance; hours are display-only.

import { getSession } from "~~/server/lib/session";
import { getCertificateEligibility } from "~~/server/lib/certificates";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }
  return await getCertificateEligibility(user.id);
});
