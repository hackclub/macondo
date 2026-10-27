import { asc, eq } from "drizzle-orm";

import db from "~~/server/db";
import {
  eventAttendeeTable,
  eventTable,
  shopItemTable,
  users,
} from "~~/server/db/schema";
import {
  formatAttendeeForResponse,
  formatEventForResponse,
} from "~~/server/lib/events";
import { canAccessInternalEvents } from "~~/server/policies/internal";

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
    .select()
    .from(eventTable)
    .where(eq(eventTable.id, id))
    .limit(1);
  if (!ev) {
    throw createError({ statusCode: 404, statusMessage: "Event not found" });
  }

  const rows = await db
    .select({
      attendee: eventAttendeeTable,
      uid: users.id,
      uname: users.name,
      uusername: users.username,
      uimage: users.image,
      gift_item_name: shopItemTable.name,
    })
    .from(eventAttendeeTable)
    .leftJoin(users, eq(users.id, eventAttendeeTable.user_id))
    .leftJoin(
      shopItemTable,
      eq(shopItemTable.id, eventAttendeeTable.gift_shop_item_id),
    )
    .where(eq(eventAttendeeTable.event_id, id))
    .orderBy(asc(eventAttendeeTable.id));

  const [creator] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, ev.created_by))
    .limit(1);

  return {
    ...formatEventForResponse(ev, {
      creator_name: creator?.name ?? null,
      attendee_count: rows.length,
      winner_count: rows.filter((r) => r.attendee.is_winner).length,
      proposed_gift_count: rows.filter((r) => r.attendee.gift_status === "proposed")
        .length,
    }),
    attendees: rows.map((r) =>
      formatAttendeeForResponse(
        r.attendee,
        r.uid
          ? { id: r.uid, name: r.uname, username: r.uusername, image: r.uimage }
          : null,
        r.gift_item_name,
      ),
    ),
  };
});
