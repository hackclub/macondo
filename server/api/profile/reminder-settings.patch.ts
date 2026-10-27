import { eq } from "drizzle-orm";

import db from "../../db";
import { users } from "../../db/schema";
import { writeAudit } from "../../lib/audit";
import { getSession } from "../../lib/session";

// The cron resolves reminder_hours_before_day_end (N) to local hour 24 - N.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const body = await readBody<{
    reminder_hours_before_day_end?: unknown;
    reminder_local_hours?: unknown;
    streak_slack_notifications?: unknown;
  }>(event);

  const updates: {
    reminder_hours_before_day_end?: number;
    reminder_local_hours?: number[];
    streak_slack_notifications?: boolean;
  } = {};

  if (body?.reminder_hours_before_day_end !== undefined) {
    const n = body.reminder_hours_before_day_end;
    // The cron clamps N to 1..23, so other values never fire at a useful hour.
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 23) {
      throw createError({
        statusCode: 400,
        statusMessage: "reminder_hours_before_day_end must be an integer 1-23",
      });
    }
    updates.reminder_hours_before_day_end = n;
  }

  // Capped so a user can't queue an unbounded number of DMs.
  if (body?.reminder_local_hours !== undefined) {
    const raw = body.reminder_local_hours;
    if (!Array.isArray(raw)) {
      throw createError({
        statusCode: 400,
        statusMessage: "reminder_local_hours must be an array",
      });
    }
    const cleaned: number[] = [];
    for (const h of raw) {
      if (typeof h !== "number" || !Number.isInteger(h) || h < 1 || h > 23) {
        throw createError({
          statusCode: 400,
          statusMessage: "reminder_local_hours entries must be integers 1-23",
        });
      }
      if (!cleaned.includes(h)) cleaned.push(h);
    }
    if (cleaned.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "Select at least one reminder time",
      });
    }
    if (cleaned.length > 8) {
      throw createError({
        statusCode: 400,
        statusMessage: "Too many reminder times (max 8)",
      });
    }
    cleaned.sort((a, b) => a - b);
    updates.reminder_local_hours = cleaned;
  }

  if (body?.streak_slack_notifications !== undefined) {
    if (typeof body.streak_slack_notifications !== "boolean") {
      throw createError({
        statusCode: 400,
        statusMessage: "streak_slack_notifications must be a boolean",
      });
    }
    updates.streak_slack_notifications = body.streak_slack_notifications;
  }

  if (Object.keys(updates).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No reminder fields to update",
    });
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));

  try {
    await writeAudit({
      actor_id: user.id,
      action: "update_streak_reminder",
      entity_type: "user",
      entity_id: user.id,
      old_value: {
        reminder_hours_before_day_end: user.reminder_hours_before_day_end,
        streak_slack_notifications: user.streak_slack_notifications,
      },
      new_value: updates,
      sensitive: false,
      public_message: "Updated streak reminder settings",
      change_summary: "streak_reminder_settings",
    });
  } catch (err) {
    console.error("Failed to write audit log for streak reminder update", err);
  }

  return { ok: true, ...updates };
});
