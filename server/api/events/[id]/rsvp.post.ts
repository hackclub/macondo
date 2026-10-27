// Writes only the RSVP columns so it never disturbs gift columns an organizer set.

import { eq } from "drizzle-orm";

import db from "~~/server/db";
import { eventAttendeeTable, eventTable } from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";

type Body = { status?: "interested" | "not_interested" };

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid event id" });
  }

  const body = await readBody<Body>(event).catch(() => ({}) as Body);
  const status = body.status === "not_interested" ? "not_interested" : "interested";

  const [ev] = await db
    .select({ status: eventTable.status, starts_at: eventTable.starts_at })
    .from(eventTable)
    .where(eq(eventTable.id, id))
    .limit(1);
  // 404 (not 403) when unpublished so we don't leak draft events.
  if (!ev || ev.status !== "published") {
    throw createError({ statusCode: 404, statusMessage: "Event not found" });
  }
  if (ev.starts_at && ev.starts_at.getTime() <= Date.now()) {
    throw createError({
      statusCode: 400,
      statusMessage: "This event has already started",
    });
  }

  const now = new Date();
  await db
    .insert(eventAttendeeTable)
    .values({
      event_id: id,
      user_id: user.id,
      rsvp_status: status,
      rsvp_source: "self",
      rsvp_at: now,
    })
    .onConflictDoUpdate({
      target: [eventAttendeeTable.event_id, eventAttendeeTable.user_id],
      set: {
        rsvp_status: status,
        rsvp_source: "self",
        rsvp_at: now,
        updated_at: now,
      },
    });

  return { ok: true, status };
});
