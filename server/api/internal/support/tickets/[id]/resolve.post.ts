import { eq } from "drizzle-orm";

import db from "../../../../../db";
import { supportTicketTable } from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import {
  fanOutResolveSideEffects,
  markTicketResolved,
} from "../../../../../lib/support-ticket-resolve";
import { canResolveSupportTicket } from "../../../../../lib/support-ticket-slack";
import { canAccessInternalSupport } from "../../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  // Resolving additionally requires being the ticket owner or in #macondo-support-team.
  if (!actor || !canAccessInternalSupport(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ticket id" });
  }

  const [existing] = await db
    .select({ user_id: supportTicketTable.user_id })
    .from(supportTicketTable)
    .where(eq(supportTicketTable.id, id))
    .limit(1);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Ticket not found" });
  }

  if (
    !(await canResolveSupportTicket(
      { id: actor.id, slack_id: actor.slack_id },
      existing,
    ))
  ) {
    throw createError({
      statusCode: 403,
      statusMessage:
        "Only the ticket owner or a member of #macondo-support-team can resolve this ticket.",
    });
  }

  const updated = await markTicketResolved({
    ticketId: id,
    resolvedByUserId: actor.id,
  });
  if (!updated) {
    throw createError({
      statusCode: 409,
      statusMessage: "Ticket cannot be resolved in its current state",
    });
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "support_ticket.resolved",
      entity_type: "support_ticket",
      entity_id: String(updated.id),
      old_value: null,
      new_value: { status: "resolved", resolved_by_user_id: actor.id },
      sensitive: false,
      public_message: `Ticket #${updated.id} resolved`,
      change_summary: updated.subject,
    });
  } catch (err) {
    console.error("[support-ticket] audit resolve failed", err);
  }

  await fanOutResolveSideEffects(updated, {
    resolvedByName: actor.name ?? actor.email,
    resolvedByUserId: actor.id,
    publicThreadText:
      ":white_check_mark: This ticket has been marked resolved. If you still need help, reply here within 7 days to reopen it.",
    notifyBody:
      "Your support ticket has been marked resolved. Rate the response or reply if you still need help.",
  });

  return updated;
});
