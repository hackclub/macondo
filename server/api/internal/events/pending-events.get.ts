import { asc, eq, sql } from "drizzle-orm";

import db from "~~/server/db";
import { eventAttendeeTable, eventTable, users } from "~~/server/db/schema";
import { formatEventForResponse } from "~~/server/lib/events";
import { canDecideEventGifts } from "~~/server/policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canDecideEventGifts(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const rows = await db
    .select({ event: eventTable, creator_name: users.name })
    .from(eventTable)
    .leftJoin(users, eq(users.id, eventTable.created_by))
    .where(eq(eventTable.status, "pending_review"))
    .orderBy(asc(eventTable.id));

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      event_id: eventAttendeeTable.event_id,
      attendees: sql<number>`count(*)::int`,
      winners: sql<number>`count(*) filter (where ${eventAttendeeTable.is_winner})::int`,
      proposed: sql<number>`count(*) filter (where ${eventAttendeeTable.gift_status} = 'proposed')::int`,
    })
    .from(eventAttendeeTable)
    .groupBy(eventAttendeeTable.event_id);
  const countMap = new Map(counts.map((c) => [c.event_id, c]));

  return rows.map((r) =>
    formatEventForResponse(r.event, {
      attendee_count: countMap.get(r.event.id)?.attendees ?? 0,
      winner_count: countMap.get(r.event.id)?.winners ?? 0,
      proposed_gift_count: countMap.get(r.event.id)?.proposed ?? 0,
      creator_name: r.creator_name,
    }),
  );
});
