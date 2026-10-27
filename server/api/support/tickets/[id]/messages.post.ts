import { and, eq } from "drizzle-orm";

import db from "../../../../db";
import {
  supportTicketAttachmentTable,
  supportTicketMessageTable,
  supportTicketTable,
  users,
} from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { notify } from "../../../../lib/notify";
import { getSession } from "../../../../lib/session";
import { getDisplayName } from "../../../../lib/user";
import {
  publishMessageAdded,
  publishStatusChanged,
} from "../../../../lib/support-ticket-realtime";
import {
  postPublicThreadReply,
  updateBtsMessage,
} from "../../../../lib/support-ticket-slack";

type ReplyBody = {
  body?: string;
  client_dedup_key?: string;
  attachments?: Array<{
    url: string;
    filename: string;
    size_bytes?: number;
    mime_type?: string;
    sha?: string;
  }>;
};

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ticket id" });
  }

  const body = await readBody<ReplyBody>(event);
  const text = body?.body?.trim();
  if (!text) {
    throw createError({ statusCode: 400, statusMessage: "Message body is required" });
  }

  const dedupKey =
    typeof body?.client_dedup_key === "string" &&
    body.client_dedup_key.length > 0 &&
    body.client_dedup_key.length <= 64 // max dedup key length
      ? body.client_dedup_key
      : null;

  const [ticket] = await db
    .select()
    .from(supportTicketTable)
    .where(eq(supportTicketTable.id, id))
    .limit(1);

  if (!ticket || ticket.user_id !== user.id) {
    throw createError({ statusCode: 404, statusMessage: "Ticket not found" });
  }

  // A retried dedup key returns the original; the reopen flow already ran on first submit.
  if (dedupKey) {
    const [existing] = await db
      .select({ id: supportTicketMessageTable.id })
      .from(supportTicketMessageTable)
      .where(
        and(
          eq(supportTicketMessageTable.ticket_id, id),
          eq(supportTicketMessageTable.client_dedup_key, dedupKey),
        ),
      )
      .limit(1);
    if (existing) {
      return { ok: true, id: existing.id, reopened: false, deduped: true };
    }
  }

  // Resolved tickets reopen on a reply within 7 days; closed tickets never reopen.
  let didReopen = false;
  if (ticket.status === "closed") {
    throw createError({
      statusCode: 409,
      statusMessage: "This ticket is closed. Please file a new ticket.",
    });
  }

  if (ticket.status === "resolved") {
    if (Date.now() - (ticket.resolved_at?.getTime() ?? 0) > 7 * 24 * 60 * 60 * 1000) { // 7-day reopen window
      throw createError({
        statusCode: 409,
        statusMessage: "This ticket was resolved more than 7 days ago. Please file a new ticket.",
      });
    }
    didReopen = true;
  }

  // Parallel submits can beat the dedup pre-check; on the unique violation, read back the winner.
  let message: { id: number } | undefined;
  try {
    const [inserted] = await db
      .insert(supportTicketMessageTable)
      .values({
        ticket_id: id,
        author_user_id: user.id,
        body: text,
        is_internal_note: false,
        client_dedup_key: dedupKey,
      })
      .returning({ id: supportTicketMessageTable.id });
    message = inserted;
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } }).code
      ?? (err as { cause?: { code?: string } }).cause?.code;
    if (dedupKey && code === "23505") {
      const [existing] = await db
        .select({ id: supportTicketMessageTable.id })
        .from(supportTicketMessageTable)
        .where(
          and(
            eq(supportTicketMessageTable.ticket_id, id),
            eq(supportTicketMessageTable.client_dedup_key, dedupKey),
          ),
        )
        .limit(1);
      if (existing) {
        return { ok: true, id: existing.id, reopened: false, deduped: true };
      }
    }
    throw err;
  }

  const hasAttachments = !!(body?.attachments && body.attachments.length > 0);
  if (message && hasAttachments) {
    await db.insert(supportTicketAttachmentTable).values(
      body!.attachments!.map((a) => ({
        message_id: message.id,
        url: a.url,
        filename: a.filename,
        size_bytes: a.size_bytes ?? null,
        mime_type: a.mime_type ?? null,
        sha: a.sha ?? null,
      })),
    );
  }

  const slackText = hasAttachments
    ? [text, ...body!.attachments!.map((a) => a.url)].join("\n")
    : text;

  const claimedByBefore = ticket.claimed_by_user_id;
  if (didReopen) {
    await db
      .update(supportTicketTable)
      .set({
        status: "open",
        updated_at: new Date(),
        // The owner just replied, so cancel any pending auto-resolve warning.
        auto_resolve_warned_at: null,
      })
      .where(eq(supportTicketTable.id, id));

    // Re-ping the previous claimer so the ticket isn't lost.
    if (claimedByBefore && claimedByBefore !== user.id) {
      void notify({
        user_id: claimedByBefore,
        type: "ticket_reopened",
        title: `Ticket #${ticket.id} reopened: ${ticket.subject}`,
        body: `${getDisplayName(user)} sent a new reply on a ticket you previously resolved.`,
        action_url: `/internal/support/${ticket.id}`,
        entity_type: "support_ticket",
        entity_id: String(ticket.id),
        slack: {
          text: `:arrows_counterclockwise: Ticket #${ticket.id} (${ticket.subject}) reopened by <@${user.slack_id ?? user.id}>`,
        },
        email: {
          template: "ticket_reopened",
          data: { ticket_subject: ticket.subject, ticket_url: `${publicBaseUrl()}/internal/support/${ticket.id}` },
        },
      });
    }
  } else {
    // The owner just replied, so cancel any pending auto-resolve warning.
    await db
      .update(supportTicketTable)
      .set({ updated_at: new Date(), auto_resolve_warned_at: null })
      .where(eq(supportTicketTable.id, id));

    // Slack DM only without a public thread; thread participation already pings a Slack claimer.
    const hasPublicThread = !!ticket.slack_channel_id && !!ticket.slack_thread_ts;
    if (claimedByBefore && claimedByBefore !== user.id) {
      void notify({
        user_id: claimedByBefore,
        type: "ticket_reply",
        title: `New reply on #${ticket.id}: ${ticket.subject}`,
        body: text.length > 180 ? `${text.slice(0, 180)}...` : text, // notification preview length
        action_url: `/internal/support/${ticket.id}`,
        entity_type: "support_ticket",
        entity_id: String(ticket.id),
        slack: hasPublicThread
          ? undefined
          : {
              text: `:speech_balloon: ${getDisplayName(user)} replied on *${ticket.subject}* (#${ticket.id}):\n>${text}\n<${publicBaseUrl()}/internal/support/${ticket.id}|Open ticket>`,
            },
      });
    }
  }

  try {
    await writeAudit({
      actor_id: user.id,
      action: didReopen
        ? "support_ticket.reopened"
        : "support_ticket.student_reply",
      entity_type: "support_ticket",
      entity_id: String(ticket.id),
      old_value: didReopen ? { status: ticket.status } : null,
      new_value: { message_id: message?.id, body: text },
      sensitive: false,
      public_message: didReopen
        ? `Ticket #${ticket.id} reopened by user reply`
        : `User replied on ticket #${ticket.id}`,
      change_summary: ticket.subject,
    });
  } catch (err) {
    console.error("[support-ticket] audit student reply failed", err);
  }

  // Mirror web replies into the public Slack thread so it doesn't read as unanswered.
  // Bot posts carry a bot_id the events webhook skips, so this can't loop back.
  if (ticket.slack_channel_id && ticket.slack_thread_ts) {
    void postPublicThreadReply({
      channel: ticket.slack_channel_id,
      thread_ts: ticket.slack_thread_ts,
      text: slackText,
      username: getDisplayName(user),
      icon_url: user.image ?? undefined,
    });
  }

  // Sync the BTS card status without echoing the body into the support-team thread.
  if (ticket.bts_message_ts) {
    if (didReopen) {
      void (async () => {
        const [refreshed] = await db
          .select()
          .from(supportTicketTable)
          .where(eq(supportTicketTable.id, id))
          .limit(1);
        const [authorRow] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, ticket.user_id))
          .limit(1);
        if (refreshed) {
          await updateBtsMessage({
            id: refreshed.id,
            subject: refreshed.subject,
            body: refreshed.body,
            status: refreshed.status,
            priority: refreshed.priority,
            category: refreshed.category,
            claimed_by_name: null,
            resolved_by_name: null,
            author_display_name: authorRow?.name ?? null,
            author_avatar_url: null,
            slack_channel_id: refreshed.slack_channel_id,
            slack_thread_ts: refreshed.slack_thread_ts,
            bts_message_ts: refreshed.bts_message_ts,
          });
        }
      })();
    }
  }

  if (message) {
    void publishMessageAdded(id, message.id);
  }
  if (didReopen) {
    void publishStatusChanged(id, ticket.user_id, {
      status: "open",
      claimed_by_user_id: claimedByBefore,
      actorUserId: user.id,
    });
  }

  return { ok: true, id: message?.id, reopened: didReopen };
});
