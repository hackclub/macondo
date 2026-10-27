import { and, eq, gte } from "drizzle-orm";
import db from "~~/server/db";
import { auditLogTable, users } from "~~/server/db/schema";
import { writeAudit } from "~~/server/lib/audit";
import { getSession } from "~~/server/lib/session";

function isValidTimezone(tz: string): boolean {
  if (tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Streak days derive from users.timezone, so free changes let users plant activity on
// days they didn't work. One change a day still covers DST and travel.
const MIN_CHANGE_INTERVAL_HOURS = 24;

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const body = await readBody<{ timezone?: unknown }>(event);
  const timezone = typeof body?.timezone === "string" ? body.timezone : null;
  if (!timezone || !isValidTimezone(timezone)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid timezone" });
  }

  // Acknowledge without burning the rate-limit window on a self-sync.
  if (user.timezone === timezone) {
    return { ok: true, timezone, changed: false };
  }

  // The default UTC sentinel can always be replaced (first-time capture).
  if (user.timezone && user.timezone !== "UTC") {
    const [recent] = await db
      .select({ created_at: auditLogTable.created_at })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actor_id, user.id),
          eq(auditLogTable.action, "update_timezone"),
          gte(auditLogTable.created_at, new Date(Date.now() - MIN_CHANGE_INTERVAL_HOURS * 3600 * 1000)),
        ),
      )
      .limit(1);
    if (recent) {
      throw createError({
        statusCode: 429,
        statusMessage: `Timezone was already changed within the last ${MIN_CHANGE_INTERVAL_HOURS}h. Try again later.`,
      });
    }
  }

  await db.update(users).set({ timezone }).where(eq(users.id, user.id));

  try {
    await writeAudit({
      actor_id: user.id,
      action: "update_timezone",
      entity_type: "user",
      entity_id: user.id,
      old_value: { timezone: user.timezone },
      new_value: { timezone },
      sensitive: false,
      public_message: `Timezone changed from ${user.timezone ?? "(none)"} to ${timezone}`,
      change_summary: `${user.timezone ?? "(none)"} -> ${timezone}`,
    });
  } catch (err) {
    console.error("Failed to write audit log for timezone change", err);
  }

  return { ok: true, timezone, changed: true };
});
