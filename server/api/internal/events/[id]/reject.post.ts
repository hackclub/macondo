import { and, eq } from "drizzle-orm";

import db from "~~/server/db";
import { eventTable } from "~~/server/db/schema";
import { writeAudit } from "~~/server/lib/audit";
import { canDecideEventGifts } from "~~/server/policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canDecideEventGifts(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid event id" });
  }

  const body = await readBody<{ reason?: string }>(event).catch(
    () => ({}) as { reason?: string },
  );
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const [claimed] = await db
    .update(eventTable)
    .set({ status: "draft", updated_at: new Date() })
    .where(and(eq(eventTable.id, id), eq(eventTable.status, "pending_review")))
    .returning();
  if (!claimed) {
    throw createError({
      statusCode: 409,
      statusMessage: "Event is not pending review",
    });
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "event_rejected",
      entity_type: "event",
      entity_id: String(id),
      new_value: { status: "draft", reason: reason || null },
      sensitive: false,
      public_message: `Sent event #${id} back to draft`,
    });
  } catch (err) {
    console.error("[events] audit reject failed", err);
  }

  return { ok: true, status: "draft" };
});
