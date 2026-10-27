// Posted on every app mount so users.timezone tracks where the user actually is.

import { eq } from "drizzle-orm";
import { z } from "zod";
import db from "../../db";
import { users } from "../../db/schema";
import { writeAudit } from "../../lib/audit";
import { getSession } from "../../lib/session";

// Only a plausibility check; Intl.DateTimeFormat rejects genuinely invalid zones.
const BodySchema = z.object({
  timezone: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_+\-/]+$/, "Invalid IANA timezone string"),
});

function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const parsed = BodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid timezone body",
    });
  }
  const incoming = parsed.data.timezone;
  if (!isValidIanaTimezone(incoming)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Unrecognized IANA timezone",
    });
  }

  // Hackatime's tz is authoritative; browser detection falls back to UTC when it fails.
  if (user.hackatime_timezone) {
    return {
      updated: false,
      timezone: user.timezone ?? user.hackatime_timezone,
      source: "hackatime",
    };
  }

  const stored = user.timezone ?? "UTC";
  if (stored === incoming) {
    return { updated: false, timezone: stored };
  }

  await db
    .update(users)
    .set({ timezone: incoming })
    .where(eq(users.id, user.id));

  // Lets staff spot sudden tz flips; tz alone isn't PII.
  try {
    await writeAudit({
      actor_id: user.id,
      action: "user_timezone_browser_sync",
      entity_type: "user",
      entity_id: user.id,
      old_value: { timezone: stored },
      new_value: { timezone: incoming, source: "browser" },
      sensitive: false,
      public_message: `Browser-detected timezone updated (${stored} -> ${incoming})`,
      change_summary: "user_timezone_browser_sync",
    });
  } catch (err) {
    // Audit failure must not block the sync itself.
    console.error("[auth/timezone] writeAudit failed", err);
  }

  return { updated: true, timezone: incoming };
});
