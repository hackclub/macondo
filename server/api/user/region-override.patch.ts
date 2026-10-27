import { eq } from "drizzle-orm";

import db from "../../db";
import { users } from "../../db/schema";
import { isShopRegion } from "../../lib/regions";
import { getSession } from "../../lib/session";

// Only consulted when users.country is unset; see resolveBrowsingRegion.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const body = (await readBody<{ region?: string | null }>(event)) ?? {};
  const nextRegion = body.region == null ? null : body.region;

  if (nextRegion != null && !isShopRegion(nextRegion)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid region code",
    });
  }

  await db
    .update(users)
    .set({ region_override: nextRegion })
    .where(eq(users.id, user.id));

  return { ok: true as const, region_override: nextRegion };
});
