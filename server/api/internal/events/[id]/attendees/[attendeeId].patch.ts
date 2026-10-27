import { and, eq } from "drizzle-orm";

import db from "~~/server/db";
import { eventAttendeeTable } from "~~/server/db/schema";
import { writeAudit } from "~~/server/lib/audit";
import { buildGiftProposalSet } from "~~/server/lib/events";
import { canAccessInternalEvents } from "~~/server/policies/internal";

type Body = {
  is_winner?: boolean;
  attended?: boolean;
  gift_kind?: "gold" | "shop_item" | null;
  gift_gold_amount?: number;
  gift_shop_item_id?: number;
  gift_notes?: string;
};

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

  const body = await readBody<Body>(event).catch(() => ({}) as Body);
  const set: Partial<typeof eventAttendeeTable.$inferInsert> = {};

  if ("is_winner" in body) set.is_winner = !!body.is_winner;

  // attendance unlocks the certificate; unmarking doesn't revoke one already claimed
  if ("attended" in body) {
    set.attended_at = body.attended ? new Date() : null;
    set.attendance_marked_by = body.attended ? actor.id : null;
  }

  if ("gift_kind" in body) {
    if (attendee.gift_status === "approved") {
      throw createError({
        statusCode: 400,
        statusMessage: "An approved gift cannot be changed. Deny it first.",
      });
    }
    const giftSet = await buildGiftProposalSet({
      giftKind: body.gift_kind ?? null,
      goldAmount: body.gift_gold_amount,
      shopItemId: body.gift_shop_item_id,
      notes: body.gift_notes,
      proposerId: actor.id,
    });
    Object.assign(set, giftSet);
  }

  if (Object.keys(set).length === 0) {
    throw createError({ statusCode: 400, statusMessage: "Nothing to update" });
  }
  set.updated_at = new Date();

  await db
    .update(eventAttendeeTable)
    .set(set)
    .where(eq(eventAttendeeTable.id, attendeeId));

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "gift_kind" in body ? "event_gift_proposed" : "event_attendee_updated",
      entity_type: "event_attendee",
      entity_id: String(attendeeId),
      new_value: { event_id: eventId, ...set },
      sensitive: false,
      public_message: `Updated attendee #${attendeeId} on event #${eventId}`,
    });
  } catch (err) {
    console.error("[events] audit attendee patch failed", err);
  }

  return { ok: true };
});
