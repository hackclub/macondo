// approving credits real gold or mints a free shop order; denying leaves it re-proposable

import { and, eq } from "drizzle-orm";

import db from "~~/server/db";
import { eventAttendeeTable } from "~~/server/db/schema";
import { approveEventGift, denyEventGift } from "~~/server/lib/events";
import { canDecideEventGifts } from "~~/server/policies/internal";

type Body = { decision?: "approve" | "deny"; reason?: string };

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canDecideEventGifts(actor)) {
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
    .select({ id: eventAttendeeTable.id })
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

  const body = await readBody<Body>(event).catch(() => ({}) as Body);

  if (body.decision === "approve") {
    return { ok: true, ...(await approveEventGift({ attendeeId, actorId: actor.id })) };
  }
  if (body.decision === "deny") {
    await denyEventGift({ attendeeId, actorId: actor.id, reason: body.reason });
    return { ok: true, denied: true };
  }
  throw createError({
    statusCode: 400,
    statusMessage: "decision must be 'approve' or 'deny'",
  });
});
