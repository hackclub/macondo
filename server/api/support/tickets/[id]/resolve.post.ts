import { and, eq, sql } from "drizzle-orm";

import db from "../../../../db";
import { supportTicketTable, users } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { notify } from "../../../../lib/notify";
import { getSession } from "../../../../lib/session";
import { draftKbSuggestionFromResolvedTicket } from "../../../../lib/support-kb-curation";
import { ensureTicketEmbedded } from "../../../../lib/support-ticket-embedding";
import { publishStatusChanged } from "../../../../lib/support-ticket-realtime";
import {
  canResolveSupportTicket,
  postPublicThreadReply,
  reactResolvedOnOriginal,
  updateBtsMessage,
} from "../../../../lib/support-ticket-slack";

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

export default defineEventHandler(async (event) => {
  const actor = await getSession(event);
  if (!actor) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ticket id" });
  }

  const [ticket] = await db
    .select()
    .from(supportTicketTable)
    .where(eq(supportTicketTable.id, id))
    .limit(1);
  if (!ticket) {
    throw createError({ statusCode: 404, statusMessage: "Ticket not found" });
  }

  if (
    !(await canResolveSupportTicket(
      { id: actor.id, slack_id: actor.slack_id },
      ticket,
    ))
  ) {
    throw createError({
      statusCode: 403,
      statusMessage:
        "Only the ticket owner or a member of #macondo-support-team can resolve this ticket.",
    });
  }

  const [updated] = await db
    .update(supportTicketTable)
    .set({
      status: "resolved",
      resolved_by_user_id: actor.id,
      resolved_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(supportTicketTable.id, id),
        sql`${supportTicketTable.status} IN ('open', 'claimed')`,
      ),
    )
    .returning();

  if (!updated) {
    throw createError({
      statusCode: 409,
      statusMessage: "Ticket cannot be resolved in its current state",
    });
  }

  const isSelfResolve = actor.id === ticket.user_id;

  try {
    await writeAudit({
      actor_id: actor.id,
      action: isSelfResolve
        ? "support_ticket.self_resolved"
        : "support_ticket.resolved",
      entity_type: "support_ticket",
      entity_id: String(updated.id),
      old_value: null,
      new_value: {
        status: "resolved",
        resolved_by_user_id: actor.id,
        via: "web_student",
      },
      sensitive: false,
      public_message: isSelfResolve
        ? `Ticket #${updated.id} resolved by the ticket owner`
        : `Ticket #${updated.id} resolved`,
      change_summary: updated.subject,
    });
  } catch (err) {
    console.error("[support-ticket] audit student resolve failed", err);
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
    claimed_by_name: null,
    resolved_by_name: actor.name ?? actor.email,
    author_display_name: authorRow?.name ?? null,
    author_avatar_url: null,
    slack_channel_id: updated.slack_channel_id,
    slack_thread_ts: updated.slack_thread_ts,
    bts_message_ts: updated.bts_message_ts,
  });

  const hasPublicThread =
    !!updated.slack_channel_id && !!updated.slack_thread_ts;
  if (hasPublicThread) {
    void postPublicThreadReply({
      channel: updated.slack_channel_id!,
      thread_ts: updated.slack_thread_ts!,
      text: isSelfResolve
        ? ":white_check_mark: Ticket marked resolved by the user. If you still need help, reply here within 7 days to reopen it."
        : ":white_check_mark: This ticket has been marked resolved. If you still need help, reply here within 7 days to reopen it.",
    });
    void reactResolvedOnOriginal({
      slack_channel_id: updated.slack_channel_id,
      slack_thread_ts: updated.slack_thread_ts,
    });
  }

  void publishStatusChanged(updated.id, updated.user_id, {
    status: "resolved",
    resolved_by_user_id: actor.id,
    actorUserId: actor.id,
  });

  // Only resolved tickets surface as Capybara suggestions, so a missing embedding silently excludes this one.
  void ensureTicketEmbedded(updated.id);

  // Never auto-promoted; no-ops without a substantive support reply.
  void draftKbSuggestionFromResolvedTicket(updated.id);

  if (!isSelfResolve) {
    const ticketUrl = `${publicBaseUrl()}/dashboard?support=1&ticketId=${updated.id}`;
    void notify({
      user_id: updated.user_id,
      type: "ticket_resolved",
      title: `Ticket resolved: ${updated.subject}`,
      body: "Your support ticket has been marked resolved. Rate the response or reply if you still need help.",
      action_url: ticketUrl,
      entity_type: "support_ticket",
      entity_id: String(updated.id),
      skip_channels: hasPublicThread ? ["slack"] : undefined,
      slack: hasPublicThread
        ? undefined
        : {
            text: `:white_check_mark: Ticket resolved: *${updated.subject}*\n<${ticketUrl}|Open ticket>`,
          },
      email: {
        template: "ticket_resolved",
        data: { ticket_subject: updated.subject, ticket_url: ticketUrl },
      },
    });
  }

  return updated;
});
