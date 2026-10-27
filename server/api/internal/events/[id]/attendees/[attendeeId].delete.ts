import { and, eq } from "drizzle-orm";

import db from "~~/server/db";
import { eventAttendeeTable } from "~~/server/db/schema";
import { writeAudit } from "~~/server/lib/audit";
import { canAccessInternalEvents } from "~~/server/policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalEvents(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const eventId = Number(getRouterParam(event, "id"));
  const attendeeId = Number(getRouterParam(event, "attendeeId"));
  if (
    !Number.isInteger(eventId) ||
    eventId <= 0 ||
    !Number.isInteger(attendeeId) ||
    attendeeId <= 0
  ) {
    throw createError({ statusCode: 400, statusMessage: "Invalid id" });
  }

  const [attendee] = await db
    .select()
    .from(eventAttendeeTable)
    .where(
      and(
        eq(eventAttendeeTable.id, attendeeId),
        eq(eventAttendeeTable.event_id, eventId),
      ),
    )
    .limit(1);
  if (!attendee) {
    throw createError({ statusCode: 404, statusMessage: "Attendee not found" });
  }
  // an approved gift means a real credit or order already exists
  if (attendee.gift_status === "approved") {
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot remove an attendee whose gift was approved",
    });
  }

  await db.delete(eventAttendeeTable).where(eq(eventAttendeeTable.id, attendeeId));

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "event_attendee_removed",
      entity_type: "event_attendee",
      entity_id: String(attendeeId),
      old_value: { event_id: eventId, user_id: attendee.user_id },
      sensitive: false,
      public_message: `Removed attendee #${attendeeId} from event #${eventId}`,
    });
  } catch (err) {
    console.error("[events] audit attendee delete failed", err);
  }

  return { ok: true };
});
