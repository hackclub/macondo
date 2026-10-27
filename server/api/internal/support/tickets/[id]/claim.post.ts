import { and, eq, sql } from "drizzle-orm";

import db from "../../../../../db";
import { supportTicketTable, users } from "../../../../../db/schema";
import { writeAudit } from "../../../../../lib/audit";
import { publishStatusChanged } from "../../../../../lib/support-ticket-realtime";
import { updateBtsMessage } from "../../../../../lib/support-ticket-slack";
import { canAccessInternalSupport } from "../../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalSupport(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ticket id" });
  }

  // Conditional on status so a concurrent claim or resolve isn't overwritten.
  const [updated] = await db
    .update(supportTicketTable)
    .set({
      status: "claimed",
      claimed_by_user_id: actor.id,
      claimed_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(supportTicketTable.id, id),
        sql`${supportTicketTable.status} IN ('open')`,
      ),
    )
    .returning();

  if (!updated) {
    const [current] = await db
      .select()
      .from(supportTicketTable)
      .where(eq(supportTicketTable.id, id))
      .limit(1);
    if (!current) {
      throw createError({ statusCode: 404, statusMessage: "Ticket not found" });
    }
    throw createError({
      statusCode: 409,
      statusMessage: `Cannot claim: ticket is ${current.status}`,
    });
  }

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "support_ticket.claimed",
      entity_type: "support_ticket",
      entity_id: String(updated.id),
      old_value: { status: "open" },
      new_value: { status: "claimed", claimed_by_user_id: actor.id },
      sensitive: false,
      public_message: `Ticket #${updated.id} claimed`,
      change_summary: updated.subject,
    });
  } catch (err) {
    console.error("[support-ticket] audit claim failed", err);
  }

  const [authorRow] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, updated.user_id))
    .limit(1);
  void updateBtsMessage({
    id: updated.id,
    subject: updated.subject,
    body: updated.body,
    status: updated.status,
    priority: updated.priority,
    category: updated.category,
    claimed_by_name: actor.name ?? actor.email,
    resolved_by_name: null,
    author_display_name: authorRow?.name ?? null,
    author_avatar_url: null,
    slack_channel_id: updated.slack_channel_id,
    slack_thread_ts: updated.slack_thread_ts,
    bts_message_ts: updated.bts_message_ts,
  });

  void publishStatusChanged(updated.id, updated.user_id, {
    status: "claimed",
    claimed_by_user_id: actor.id,
    actorUserId: actor.id,
  });

  return updated;
});
