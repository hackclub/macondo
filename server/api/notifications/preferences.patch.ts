import { sql } from "drizzle-orm";

import db from "../../db";
import { notificationPreferencesTable } from "../../db/schema";
import { getSession } from "../../lib/session";

type ChannelToggle = { in_app?: boolean; slack?: boolean; email?: boolean };
type PrefsShape = {
  ship_decisions?: ChannelToggle;
  payouts?: ChannelToggle;
  tickets?: ChannelToggle;
  events?: ChannelToggle;
};

function coerce(input: unknown): PrefsShape {
  const out: PrefsShape = {};
  if (typeof input !== "object" || input === null) return out;
  const obj = input as Record<string, unknown>;
  for (const cat of ["ship_decisions", "payouts", "tickets", "events"] as const) {
    const catVal = obj[cat];
    if (typeof catVal !== "object" || catVal === null) continue;
    const catObj = catVal as Record<string, unknown>;
    const channel: ChannelToggle = {};
    for (const ch of ["in_app", "slack", "email"] as const) {
      if (typeof catObj[ch] === "boolean") channel[ch] = catObj[ch] as boolean;
    }
    out[cat] = channel;
  }
  return out;
}

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const prefs = coerce((await readBody<{ preferences?: unknown }>(event))?.preferences);

  await db
    .insert(notificationPreferencesTable)
    .values({
      user_id: user.id,
      preferences: prefs,
    })
    .onConflictDoUpdate({
      target: notificationPreferencesTable.user_id,
      set: {
        preferences: prefs,
        updated_at: sql`NOW()`,
      },
    });

  return { preferences: prefs };
});
