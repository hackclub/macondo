import { and, eq, sql } from "drizzle-orm";

import db from "~~/server/db";
import { eventAttendeeTable, eventTable } from "~~/server/db/schema";
import { writeAudit } from "~~/server/lib/audit";
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

  const [existing] = await db
    .select()
    .from(eventTable)
    .where(eq(eventTable.id, id))
    .limit(1);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Event not found" });
  }
  if (existing.status !== "draft") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only draft events can be deleted",
    });
  }

  const [approved] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(eventAttendeeTable)
    .where(
      and(
        eq(eventAttendeeTable.event_id, id),
        eq(eventAttendeeTable.gift_status, "approved"),
      ),
    );
  if ((approved?.c ?? 0) > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot delete an event with approved gifts",
    });
  }

  // attendee rows cascade
  await db.delete(eventTable).where(eq(eventTable.id, id));

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "event_deleted",
      entity_type: "event",
      entity_id: String(id),
      old_value: { title: existing.title, status: existing.status },
      sensitive: false,
      public_message: `Deleted event #${id} (${existing.title})`,
    });
  } catch (err) {
    console.error("[events] audit delete failed", err);
  }

  return { ok: true };
});
