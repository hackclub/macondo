import { eq } from "drizzle-orm";

import db from "../../../../../db";
import { supportTicketTable } from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import { publishStatusChanged } from "../../../../../lib/support-ticket-realtime";
import { canAccessInternalSupport } from "../../../../../policies/internal";

// Terminal, unlike resolve (7-day reopen): replies can't reopen it. For spam and duplicates.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalSupport(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ticket id" });
  }

  const [updated] = await db
    .update(supportTicketTable)
    .set({
      status: "closed",
      resolved_by_user_id: actor.id,
      resolved_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(supportTicketTable.id, id))
    .returning();

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "Ticket not found" });
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "support_ticket.closed",
      entity_type: "support_ticket",
      entity_id: String(updated.id),
      old_value: null,
      new_value: { status: "closed" },
      sensitive: false,
      public_message: `Ticket #${updated.id} closed`,
      change_summary: updated.subject,
    });
  } catch (err) {
    console.error("[support-ticket] audit close failed", err);
  }

  void publishStatusChanged(updated.id, updated.user_id, {
    status: "closed",
    resolved_by_user_id: actor.id,
    actorUserId: actor.id,
  });

  return updated;
});
