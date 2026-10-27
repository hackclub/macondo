// Drafts return 404 so they aren't leaked.

import { and, eq } from "drizzle-orm";

import db from "~~/server/db";
import { eventAttendeeTable, eventTable } from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid event id" });
  }

  const [ev] = await db
    .select({
      id: eventTable.id,
      title: eventTable.title,
      description: eventTable.description,
      location: eventTable.location,
      image_url: eventTable.image_url,
      starts_at: eventTable.starts_at,
      ends_at: eventTable.ends_at,
      timezone: eventTable.timezone,
      status: eventTable.status,
    })
    .from(eventTable)
    .where(eq(eventTable.id, id))
    .limit(1);
  if (!ev || ev.status !== "published") {
    throw createError({ statusCode: 404, statusMessage: "Event not found" });
  }

  let rsvpStatus: string | null = null;
  const user = await getSession(event);
  if (user) {
    const [att] = await db
      .select({ rsvp_status: eventAttendeeTable.rsvp_status })
      .from(eventAttendeeTable)
      .where(
        and(
          eq(eventAttendeeTable.event_id, id),
          eq(eventAttendeeTable.user_id, user.id),
        ),
      )
      .limit(1);
    rsvpStatus = att?.rsvp_status ?? null;
  }

  return { ...ev, rsvp_status: rsvpStatus };
});
