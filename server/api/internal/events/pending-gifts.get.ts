import { asc, eq } from "drizzle-orm";

import db from "~~/server/db";
import {
  eventAttendeeTable,
  eventTable,
  shopItemTable,
  users,
} from "~~/server/db/schema";
import { canDecideEventGifts } from "~~/server/policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canDecideEventGifts(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return await db
    .select({
      attendee_id: eventAttendeeTable.id,
      event_id: eventAttendeeTable.event_id,
      event_title: eventTable.title,
      user_id: eventAttendeeTable.user_id,
      user_name: users.name,
      user_username: users.username,
      user_image: users.image,
      gift_kind: eventAttendeeTable.gift_kind,
      gift_gold_amount: eventAttendeeTable.gift_gold_amount,
      gift_shop_item_name: shopItemTable.name,
      gift_notes: eventAttendeeTable.gift_notes,
      gift_proposed_at: eventAttendeeTable.gift_proposed_at,
      proposed_by: eventAttendeeTable.gift_proposed_by,
    })
    .from(eventAttendeeTable)
    .innerJoin(eventTable, eq(eventTable.id, eventAttendeeTable.event_id))
    .leftJoin(users, eq(users.id, eventAttendeeTable.user_id))
    .leftJoin(
      shopItemTable,
      eq(shopItemTable.id, eventAttendeeTable.gift_shop_item_id),
    )
    .where(eq(eventAttendeeTable.gift_status, "proposed"))
    .orderBy(asc(eventAttendeeTable.gift_proposed_at));
});
