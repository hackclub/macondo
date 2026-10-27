import { and, eq, inArray, isNull, or } from "drizzle-orm";

import db from "~~/server/db";
import { eventAttendeeTable } from "~~/server/db/schema";
import { writeAudit } from "~~/server/lib/audit";
import { buildGiftProposalSet } from "~~/server/lib/events";
import { canAccessInternalEvents } from "~~/server/policies/internal";

type Body = {
  attendee_ids?: number[];
  gift_kind?: "gold" | "shop_item";
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
  if (!Number.isInteger(eventId) || eventId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid event id" });
  }

  const body = await readBody<Body>(event).catch(() => ({}) as Body);
  const attendeeIds = Array.isArray(body.attendee_ids)
    ? [...new Set(body.attendee_ids.filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  if (attendeeIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "attendee_ids is required" });
  }
  if (body.gift_kind !== "gold" && body.gift_kind !== "shop_item") {
    throw createError({
      statusCode: 400,
      statusMessage: "gift_kind must be 'gold' or 'shop_item'",
    });
  }

  const giftSet = await buildGiftProposalSet({
    giftKind: body.gift_kind,
    goldAmount: body.gift_gold_amount,
    shopItemId: body.gift_shop_item_id,
    notes: body.gift_notes,
    proposerId: actor.id,
  });

  const applied = (
    await db
      .update(eventAttendeeTable)
      .set(giftSet)
      .where(
        and(
          eq(eventAttendeeTable.event_id, eventId),
          inArray(eventAttendeeTable.id, attendeeIds),
          or(
            isNull(eventAttendeeTable.gift_status),
            eq(eventAttendeeTable.gift_status, "denied"),
          ),
        ),
      )
      .returning({ id: eventAttendeeTable.id })
  ).length;

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "event_gift_proposed",
      entity_type: "event",
      entity_id: String(eventId),
      new_value: { bulk: true, applied, gift_kind: body.gift_kind },
      sensitive: false,
      public_message: `Bulk-proposed a gift to ${applied} attendee(s) on event #${eventId}`,
    });
  } catch (err) {
    console.error("[events] audit bulk-propose failed", err);
  }

  return { applied, skipped: attendeeIds.length - applied };
});
