import { and, eq, inArray, sql } from "drizzle-orm";

import db from "~~/server/db";
import { eventAttendeeTable, eventTable, users } from "~~/server/db/schema";
import { writeAudit } from "~~/server/lib/audit";
import { canAccessInternalEvents } from "~~/server/policies/internal";

type Body = { user_ids?: string[] };

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalEvents(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid event id" });
  }

  const [ev] = await db
    .select({ id: eventTable.id })
    .from(eventTable)
    .where(eq(eventTable.id, id))
    .limit(1);
  if (!ev) {
    throw createError({ statusCode: 404, statusMessage: "Event not found" });
  }

  const body = await readBody<Body>(event).catch(() => ({}) as Body);
  const requested = Array.isArray(body.user_ids)
    ? [...new Set(body.user_ids.filter((u) => typeof u === "string" && u))]
    : [];
  if (requested.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "user_ids is required" });
  }

  const validIds = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, requested), sql`${users.is_temp} IS NOT TRUE`))
  ).map((v) => v.id);
  if (validIds.length === 0) {
    return { added: 0, skipped: requested.length };
  }

  // existing rows (e.g. RSVPs) are skipped so their RSVP and gift columns stay untouched
  const added = (
    await db
      .insert(eventAttendeeTable)
      .values(
        validIds.map((uid) => ({
          event_id: id,
          user_id: uid,
          added_by: actor.id,
          rsvp_source: "organizer" as const,
        })),
      )
      .onConflictDoNothing({
        target: [eventAttendeeTable.event_id, eventAttendeeTable.user_id],
      })
      .returning({ id: eventAttendeeTable.id })
  ).length;
  const skipped = requested.length - added;

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "event_attendees_added",
      entity_type: "event",
      entity_id: String(id),
      new_value: { added, skipped, user_ids: validIds },
      sensitive: false,
      public_message: `Added ${added} attendee(s) to event #${id}`,
    });
  } catch (err) {
    console.error("[events] audit attendees add failed", err);
  }

  return { added, skipped };
});
