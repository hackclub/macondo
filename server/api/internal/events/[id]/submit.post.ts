import { and, eq } from "drizzle-orm";

import db from "~~/server/db";
import { eventTable } from "~~/server/db/schema";
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

  const [claimed] = await db
    .update(eventTable)
    .set({ status: "pending_review", updated_at: new Date() })
    .where(and(eq(eventTable.id, id), eq(eventTable.status, "draft")))
    .returning();
  if (!claimed) {
    throw createError({
      statusCode: 409,
      statusMessage: "Only a draft event can be submitted for review",
    });
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "event_submitted",
      entity_type: "event",
      entity_id: String(id),
      new_value: { status: "pending_review" },
      sensitive: false,
      public_message: `Submitted event #${id} for the second pass`,
    });
  } catch (err) {
    console.error("[events] audit submit failed", err);
  }

  return { ok: true, status: "pending_review" };
});
